// Private native timing probe. Forward every frame unchanged and retain only
// allowlisted timing/codec scalars, never payloads, grants, identities or URLs.
export function encodedTimingWorker(createAudioProbe = null, primaryPayload = null, packetFrames = null,createVideoProbe=null) {
  const Stream = self.TransformStream
  const counts = { audio: 0, video: 0 }, captureSamples = { audio: 0, video: 0 }
  let audioProbe,videoProbe
  function observe(frame, kind) {
    if (!['audio','video'].includes(kind)) return
    if(kind==='audio'&&self.__encodedTimingDirection==='receive'&&typeof self.__observeOwnedPcm==='function') {
      let metadata={};try{metadata=frame.getMetadata?.() || {}}catch{}
      self.__observeOwnedPcm(frame,metadata)
    }
    if(kind==='video'&&self.__encodedTimingDirection==='receive'&&typeof createVideoProbe==='function'){
      let metadata={};try{metadata=frame.getMetadata?.()||{}}catch{}
      videoProbe??=createVideoProbe();videoProbe.observe(frame,metadata)
    }
    if(kind==='video'&&self.__encodedTimingDirection==='receive'&&typeof self.__observeOwnedVideo==='function'){
      let metadata={};try{metadata=frame.getMetadata?.()||{}}catch{}
      self.__observeOwnedVideo(frame,metadata)
    }
    const count = ++counts[kind]
    if (count > 4000) return
    const regular = count <= 8 || count % 100 === 0
    if (!regular && captureSamples[kind] >= 8) return
    let metadata = {}, metadataSupported = false
    try { if(typeof frame.getMetadata==='function'){metadata=frame.getMetadata()||{};metadataSupported=true} } catch {}
    if (kind === 'audio' && self.__encodedTimingDirection === 'receive' && typeof createAudioProbe === 'function') {
      audioProbe ??= createAudioProbe(primaryPayload, packetFrames)
      audioProbe.observe(frame, metadata)
    }
    const capture = Number.isFinite(metadata.captureTime) && captureSamples[kind] < 8
    if (!regular && !capture) return
    if (capture) captureSamples[kind]++
    const values = {}
    for (const key of ['rtpTimestamp', 'timestamp', 'captureTime', 'receiveTime', 'senderCaptureTimeOffset',
      'width', 'height', 'spatialIndex', 'temporalIndex']) {
      if (Number.isFinite(metadata[key])) values[key] = metadata[key]
    }
    if(kind==='video'){
      values.frameIdPresent=Number.isSafeInteger(metadata.frameId)&&metadata.frameId>=0?1:0
      if(Array.isArray(metadata.dependencies)&&metadata.dependencies.length<=8&&
        metadata.dependencies.every(id=>Number.isSafeInteger(id)&&id>=0))values.dependencyCount=metadata.dependencies.length
    }
    const mimeType = /^(audio|video)\/[a-zA-Z0-9-]+$/.test(metadata.mimeType || '') ? metadata.mimeType : null
    self.postMessage({ type: 'encoded-timing', kind, count, time: performance.timeOrigin + performance.now(),
      realmTimeOrigin: performance.timeOrigin,
      rtpTimestamp: Number.isFinite(frame.timestamp) ? frame.timestamp : null,
      frameType: ['key', 'delta'].includes(frame.type) ? frame.type : null, mimeType, metadataSupported, values })
  }
  self.TransformStream = class extends Stream {
    constructor(transformer = {}, ...args) {
      const transform = transformer.transform
      const kind = self.__encodedTimingKind
      let firstFrame = true
      self.postMessage({type:'timing-probe-state',state:'stream',kind:['audio','video'].includes(kind)?kind:'missing'})
      super({ ...transformer, transform(frame, controller) {
        if(firstFrame){firstFrame=false;self.postMessage({type:'timing-probe-state',state:'frame',kind})}
        try { observe(frame, kind) } catch { self.postMessage({ type: 'timing-probe-error' }) }
        return transform ? transform.call(transformer, frame, controller) : controller.enqueue(frame)
      } }, ...args)
    }
  }
}

export function installEncodedTimingProbe(workerSource,receiverApi='native') {
  if(!['native','standard'].includes(receiverApi))throw new Error('TIMING_RECEIVER_API')
  if(receiverApi==='standard'&&typeof RTCRtpScriptTransform!=='function')throw new Error('TIMING_RECEIVER_API')
  const Worker = window.Worker
  const receiverUrl = URL.createObjectURL(new Blob([`self.__encodedTimingDirection='receive';\n` + workerSource + `
    self.postMessage({type:'timing-probe-state',state:'boot'});
    const attach=(readable,writable,kind)=>{
      self.__encodedTimingKind=kind;
      const stream=new TransformStream({transform(frame,controller){controller.enqueue(frame)}});
      self.__encodedTimingKind=null;
      readable.pipeThrough(stream).pipeTo(writable).catch(()=>self.postMessage({type:'timing-probe-error'}));
    };
    self.onrtctransform=({transformer})=>{
      self.__encodedTimingCodecs=transformer.options.codecs;
      if(transformer.options.kind==='video'){
        self.__requestOwnedVideoKeyframe=typeof transformer.sendKeyFrameRequest==='function'?()=>transformer.sendKeyFrameRequest():null;
        self.postMessage({type:'timing-probe-state',state:self.__requestOwnedVideoKeyframe?'keyframe-api':'keyframe-unsupported',kind:'video'});
      }
      attach(transformer.readable,transformer.writable,transformer.options.kind)
    };
    self.onmessage=({data})=>{if(data?.type?.startsWith('pcm-')||data?.type?.startsWith('video-'))return;self.__encodedTimingCodecs=data.codecs;attach(data.readable,data.writable,data.kind)};
  `], { type: 'text/javascript' }))
  const records = [], states=[], audioDecoders=[],videoDecoders=[], workers = new Set(), urls = new Set([receiverUrl]), observedReceivers=new WeakSet()
  const receiverWorkers=new WeakMap(),workerIds=new WeakMap(),pcmStates=[],videoStates=[]
  let errors = 0, sequence = 0, wrappedSenders = 0
  const failures = { worker:0, pipe:0, occupied:0, unsupported:0 }
  function track(worker, direction) {
    const id = ++sequence
    workerIds.set(worker,id)
    workers.add(worker)
    worker.addEventListener('message', ({ data }) => {
      if(direction==='receive'&&data?.type==='pcm-port-state') {
        const row={worker:id,closed:data.closed===true,configured:data.configured===true,observedAt:performance.now()}
        for(const key of ['decoded','gaps','duplicates','chunks','encodedBytes','pcmBytes','maximumChunks','maximumBytes','recovered','reordered','heldPackets','maximumHeld','pressureDrains','backpressureEvents','batchPackets','groupedChunks','maximumGroupPackets','groupCopyFallbacks','pendingGroupPackets','concealedPackets','concealedSamples','codecBytes','creditScale','copyReservationBytes','pcmLimitBytes'])
          if(Number.isSafeInteger(data[key])&&data[key]>=0)row[key]=data[key]
        if(data.creditScale!==undefined&&(![1,2].includes(row.creditScale)||row.copyReservationBytes!==(row.creditScale===2?46080:0)||
          row.pcmLimitBytes!==1024*1024-row.copyReservationBytes||row.pcmBytes>row.pcmLimitBytes||row.maximumBytes>1024*1024)){
          row.copyReservationError='PCM_COPY_DIAGNOSTIC';errors++;failures.pipe++
        }
        if(['webcodecs','libopus'].includes(data.decoderBackend))row.decoderBackend=data.decoderBackend
        for(const key of ['codecInitMs','codecTotalDecodeMs','codecMaximumDecodeMs'])if(Number.isFinite(data[key])&&data[key]>=0)row[key]=data[key]
        if(data.decoderBackend!==undefined&&(!row.decoderBackend||![0,524288].includes(row.codecBytes)||
          row.decoderBackend==='webcodecs'&&(row.codecBytes!==0||row.concealedPackets!==0||row.concealedSamples!==0)||
          row.decoderBackend==='libopus'&&row.configured&&!row.closed&&row.codecBytes!==524288||
          !Number.isSafeInteger(row.concealedPackets)||!Number.isSafeInteger(row.concealedSamples)||
          row.concealedPackets>row.decoded||row.concealedSamples>row.gaps||row.concealedSamples>row.concealedPackets*960)){
          row.concealmentError='PCM_PLC_DIAGNOSTIC';errors++;failures.pipe++
        }
        if(data.batchPackets!==undefined&&(![1,2].includes(row.batchPackets)||
          !Number.isSafeInteger(row.decoded)||!Number.isSafeInteger(row.groupedChunks)||
          !Number.isSafeInteger(row.maximumGroupPackets)||!Number.isSafeInteger(row.pendingGroupPackets)||
          row.maximumGroupPackets>row.batchPackets||row.pendingGroupPackets>=row.batchPackets||
          row.groupedChunks>Math.floor(row.decoded/2)||row.batchPackets===1&&row.groupedChunks!==0)){
          row.groupingError='PCM_GROUP_DIAGNOSTIC';errors++;failures.pipe++
        }
        for(const key of ['lastCaptureUnixMs','maximumResidualMs','scheduledCaptureUnixMs','captureOffsetMs','maximumOffsetMs'])if(Number.isFinite(data[key]))row[key]=data[key]
        row.reason=[null,'PCM_CLOCK','PCM_BOUND','PCM_PACKET','PCM_OUTPUT','PCM_API','PCM_CONFIG','PCM_DECODE','PCM_CREDIT',
          'PCM_PORT_CLOCK','PCM_PORT_SCHEDULE','PCM_PORT_MESSAGE','PCM_PORT_DECODER'].includes(data.reason)?data.reason:'PCM_PORT_DECODER'
        pcmStates.push(row);if(pcmStates.length>64)pcmStates.shift();return
      }
      if(direction==='receive'&&data?.type==='pcm-port-error'){errors++;failures.pipe++;return}
      if(direction==='receive'&&data?.type==='video-port-error'){errors++;failures.pipe++;return}
      if(direction==='receive'&&data?.type==='video-port-state'){
        const row={worker:id,closed:data.closed===true,configured:data.configured===true,observedAt:performance.now()}
        if(['vp8','vp9'].includes(data.codec))row.codec=data.codec
        if(data.markerProbe!==undefined){
          const input=data.markerProbe,keys=['reads','invalid','transitions','regressions']
          if(!input||keys.some(key=>!Number.isSafeInteger(input[key])||input[key]<0)||
            input.invalid>input.reads||input.transitions>input.reads||input.regressions>input.transitions){
            row.markerProbeError='VIDEO_MARKER_DIAGNOSTIC';errors++;failures.pipe++
          }else row.markerProbe=Object.fromEntries(keys.map(key=>[key,input[key]]))
        }
        if(data.outputDiagnostic){
          const input=data.outputDiagnostic,value={associated:input.associated===true}
          for(const key of ['codedWidth','codedHeight','displayWidth','displayHeight'])
            if(Number.isSafeInteger(input[key])&&input[key]>=0&&input[key]<=8192)value[key]=input[key]
          if(Number.isSafeInteger(input.bytes)&&input.bytes>=0&&input.bytes<=16*1024*1024)value.bytes=input.bytes
          if(['I420','I420A','I422','I444','I420P10','I422P10','I444P10','NV12','RGBA','RGBX','BGRA','BGRX'].includes(input.format))value.format=input.format
          row.outputDiagnostic=value
        }
        for(const key of ['decoded','decodedKeyFrames','discarded','encodedBytes','pending','maximumBytes','maximumPending','maximumReady','committedGaps','contiguousDrains','transferWaits','normalizedOutputs','maximumCopyBytes','dependencyPackets','referenceMisses','keyframeDrains','referenceRepairDrains','missingReferenceWaitMs','inFlight',
          'heldPackets','maximumHeld','heldLimit','duplicates','lateFrames','reordered','pressureDrains','reorderMs','recoveryMs','keyframeRequests','keyframeFulfilled','keyframeEarlyRequests'])
          if(Number.isSafeInteger(data[key])&&data[key]>=0)row[key]=data[key]
        if(Number.isFinite(data.maximumResidualMs))row.maximumResidualMs=data.maximumResidualMs
        row.recovery=data.recovery===true;row.keyframePending=data.keyframePending===true;row.gapAware=data.gapAware===true
        row.dependencyAware=data.dependencyAware===true
        row.reason=[null,'VIDEO_API','VIDEO_CONFIG','VIDEO_DECODE','VIDEO_PACKET','VIDEO_REFERENCE','VIDEO_CLOCK','VIDEO_BOUND','VIDEO_OUTPUT',
          'VIDEO_PORT_CLOCK','VIDEO_PORT_TRANSFER','VIDEO_PORT_MESSAGE','VIDEO_PORT_CREDIT','VIDEO_RECOVERY_API','VIDEO_RECOVERY_REQUEST'].includes(data.reason)?data.reason:'VIDEO_OUTPUT'
        videoStates.push(row);if(videoStates.length>64)videoStates.shift();return
      }
      if(direction==='receive'&&data?.type==='encoded-video-decode'&&['complete','error','unsupported','timeout','closed'].includes(data.status)){
        const row={worker:id,status:data.status,
          reason:[null,'API','CONFIG','DECODE','OUTPUT','CODEC','CLOCK','BOUND','TIMEOUT'].includes(data.reason)?data.reason:'OUTPUT',records:[]}
        if(data.captureMode==='rtp-projected')row.captureMode=data.captureMode
        for(const key of ['inputCount','decodedCount','maximumBytes','captureAnchors'])if(Number.isSafeInteger(data[key])&&data[key]>=0)row[key]=data[key]
        for(const key of ['maximumCaptureResidualMs','maximumProjectionMs'])if(Number.isFinite(data[key])&&data[key]>=0)row[key]=data[key]
        for(const record of (Array.isArray(data.records)?data.records:[]).slice(0,8)){
          const safe={}
          if(['I420','I420A','I422','I444','NV12','RGBA','RGBX','BGRA','BGRX'].includes(record?.format))safe.format=record.format
          for(const key of ['timestamp','rtpTimestamp','captureUnixMs','width','height','allocationBytes','encodedArrivalMs','decodeDelayMs'])
            if(Number.isFinite(record?.[key]))safe[key]=record[key]
          row.records.push(safe)
        }
        videoDecoders.push(row);if(videoDecoders.length>8)videoDecoders.shift();return
      }
      if (direction === 'receive' && data?.type === 'encoded-audio-decode' &&
        ['complete','error','unsupported','timeout'].includes(data.status)) {
        const row = { worker: id, status: data.status,
          reason: [null,'API','CONFIG','PAYLOAD_TYPE','PAYLOAD_SIZE','RED_PACKET','TIMESTAMP','DECODE','OUTPUT','OUTPUT_COUNT','TIMEOUT'].includes(data.reason) ? data.reason : 'OUTPUT',
          records: (Array.isArray(data.records) ? data.records.slice(0,8) : []).map(record =>
            Object.fromEntries(['timestamp','duration','sampleRate','numberOfChannels','numberOfFrames','captureUnixMs','captureTimestamp','rtpTimestamp']
              .filter(key => Number.isFinite(record?.[key])).map(key => [key, record[key]]))),
          packetModes: (Array.isArray(data.packetModes) ? data.packetModes : []).filter(value => ['opus','red'].includes(value)).slice(0,2) }
        for (const key of ['inputCount','decodedCount','maximumPacketBytes','maximumTimestampDifferenceUs']) if (Number.isSafeInteger(data[key])) row[key] = data[key]
        audioDecoders.push(row); if (audioDecoders.length > 16) audioDecoders.shift()
        return
      }
      if(data?.type==='timing-probe-state'&&['boot','stream','frame','keyframe-api','keyframe-unsupported'].includes(data.state)) {
        states.push({worker:id,direction,state:data.state,kind:['audio','video'].includes(data.kind)?data.kind:null})
        if(states.length>64)states.shift()
        return
      }
      if (data?.type === 'timing-probe-error') { errors++; failures.pipe++; return }
      if (data?.type !== 'encoded-timing' || !['audio', 'video'].includes(data.kind) ||
        !Number.isFinite(data.time) || !Number.isSafeInteger(data.count)) return
      const values = {}
      for (const key of ['rtpTimestamp', 'timestamp', 'captureTime', 'receiveTime', 'senderCaptureTimeOffset',
        'width', 'height', 'spatialIndex', 'temporalIndex']) {
        if (Number.isFinite(data.values?.[key])) values[key] = data.values[key]
      }
      if([0,1].includes(data.values?.frameIdPresent))values.frameIdPresent=data.values.frameIdPresent
      if(Number.isSafeInteger(data.values?.dependencyCount)&&data.values.dependencyCount>=0&&data.values.dependencyCount<=8)
        values.dependencyCount=data.values.dependencyCount
      records.push({ worker: id, direction, kind: data.kind, count: data.count, time: data.time, values,
        realmTimeOrigin: Number.isFinite(data.realmTimeOrigin) ? data.realmTimeOrigin : null,
        rtpTimestamp: Number.isFinite(data.rtpTimestamp) ? data.rtpTimestamp : null,
        frameType: ['key', 'delta'].includes(data.frameType) ? data.frameType : null,
        metadataSupported:data.metadataSupported===true,
        mimeType: /^(audio|video)\/[a-zA-Z0-9-]+$/.test(data.mimeType || '') ? data.mimeType : null })
      if (records.length > 256) records.shift()
    })
    worker.addEventListener('error', () => {errors++;failures.worker++})
    return worker
  }
  window.Worker = class extends Worker {
    constructor(...args) {
      let original
      try { original = new URL(args[0], location.href) } catch { super(...args); return }
      if (original.origin !== location.origin || !/^\/assets\/partyEncodedLease\.worker-[A-Za-z0-9_-]+\.js$/.test(original.pathname)) {
        super(...args); return
      }
      // Native import is asynchronous. Hold init/transform events until the
      // original lease handlers exist, then replay their actual objects.
      const bootstrap = workerSource + `
        self.postMessage({type:'timing-probe-state',state:'boot'});
        const messages=[],transforms=[];
        self.onmessage=event=>messages.push(event);
        self.onrtctransform=event=>transforms.push(event);
        import(${JSON.stringify(original.href)}).then(()=>{
          const message=self.onmessage,transform=self.onrtctransform;
          self.onmessage=event=>{self.__encodedTimingKind=event.data.kind;try{message(event)}finally{self.__encodedTimingKind=null}};
          self.onrtctransform=event=>{self.__encodedTimingKind=event.transformer.options.kind;try{transform(event)}finally{self.__encodedTimingKind=null}};
          for(const event of messages)self.onmessage(event);
          for(const event of transforms)self.onrtctransform(event);
        }).catch(()=>self.postMessage({type:'timing-probe-error'}));
      `
      const url = URL.createObjectURL(new Blob([bootstrap], { type: 'text/javascript' }))
      super(url, { ...args[1], type: 'module' })
      wrappedSenders++;urls.add(url); track(this, 'send')
    }
  }
  const Peer = window.RTCPeerConnection
  const scriptTransform = typeof RTCRtpScriptTransform === 'function'
  const reserveEncodedStreams=typeof RTCRtpReceiver.prototype.createEncodedStreams === 'function'
  const legacyReceiver = receiverApi!=='standard'&&reserveEncodedStreams
  window.RTCPeerConnection = class extends Peer {
    setConfiguration(configuration) {
      // LiveKit reapplies the configuration after joining. Preserve the same
      // immutable encoded-stream opt-in used when this private peer was made.
      return super.setConfiguration(reserveEncodedStreams?{...configuration,encodedInsertableStreams:true}:configuration)
    }
    constructor(...args) {
      super(...(reserveEncodedStreams ? [{...args[0],encodedInsertableStreams:true},...args.slice(1)] : args))
      this.addEventListener('track', ({ receiver }) => {
        if(observedReceivers.has(receiver))return
        if(receiver.transform){errors++;failures.occupied++;return}
        const worker=track(new Worker(receiverUrl,{type:'module'}),'receive'),kind=receiver.track.kind
        receiverWorkers.set(receiver.track,worker)
        if(legacyReceiver&&typeof receiver.createEncodedStreams==='function') {
          const {readable,writable}=receiver.createEncodedStreams()
          const codecs=(receiver.getParameters?.().codecs || []).filter(item=>Number.isInteger(item.payloadType)&&
            item.payloadType>=0&&item.payloadType<=127&&['audio/opus','audio/red','video/vp8','video/vp9'].includes(item.mimeType?.toLowerCase()))
            .slice(0,16).map(item=>({payloadType:item.payloadType,mimeType:item.mimeType.toLowerCase()}))
          worker.postMessage({kind,codecs,readable,writable},[readable,writable])
        } else if(!legacyReceiver&&scriptTransform) {
          const codecs=(receiver.getParameters?.().codecs || []).filter(item=>Number.isInteger(item.payloadType)&&
            item.payloadType>=0&&item.payloadType<=127&&['audio/opus','audio/red','video/vp8','video/vp9'].includes(item.mimeType?.toLowerCase()))
            .slice(0,16).map(item=>({payloadType:item.payloadType,mimeType:item.mimeType.toLowerCase()}))
          receiver.transform=new RTCRtpScriptTransform(worker,{kind,codecs})
        }
        else {errors++;failures.unsupported++}
        observedReceivers.add(receiver)
      })
    }
  }
  window.__encodedTimingProbe = { records,states,audioDecoders,videoDecoders,pcmStates,videoStates,
    receiverWorker(track){return receiverWorkers.get(track)},workerId(worker){return workerIds.get(worker)}, features:{scriptTransform,
    legacySender:typeof RTCRtpSender.prototype.createEncodedStreams==='function',
    legacyReceiver, receiverApi:legacyReceiver?'legacy':scriptTransform?'standard':'unsupported'},
    failures,get wrappedSenders(){return wrappedSenders},get workerCount(){return workers.size},
    get errors() { return errors }, close() {
    for (const worker of workers) worker.terminate()
    for (const url of urls) URL.revokeObjectURL(url)
  } }
}
