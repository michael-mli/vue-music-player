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

export function installEncodedTimingProbe(workerSource) {
  const Worker = window.Worker
  const receiverUrl = URL.createObjectURL(new Blob([`self.__encodedTimingDirection='receive';\n` + workerSource + `
    self.postMessage({type:'timing-probe-state',state:'boot'});
    const attach=(readable,writable,kind)=>{
      self.__encodedTimingKind=kind;
      const stream=new TransformStream({transform(frame,controller){controller.enqueue(frame)}});
      self.__encodedTimingKind=null;
      readable.pipeThrough(stream).pipeTo(writable).catch(()=>self.postMessage({type:'timing-probe-error'}));
    };
    self.onrtctransform=({transformer})=>{self.__encodedTimingCodecs=transformer.options.codecs;attach(transformer.readable,transformer.writable,transformer.options.kind)};
    self.onmessage=({data})=>{if(data?.type?.startsWith('pcm-'))return;self.__encodedTimingCodecs=data.codecs;attach(data.readable,data.writable,data.kind)};
  `], { type: 'text/javascript' }))
  const records = [], states=[], audioDecoders=[],videoDecoders=[], workers = new Set(), urls = new Set([receiverUrl]), observedReceivers=new WeakSet()
  const receiverWorkers=new WeakMap(),workerIds=new WeakMap(),pcmStates=[]
  let errors = 0, sequence = 0, wrappedSenders = 0
  const failures = { worker:0, pipe:0, occupied:0, unsupported:0 }
  function track(worker, direction) {
    const id = ++sequence
    workerIds.set(worker,id)
    workers.add(worker)
    worker.addEventListener('message', ({ data }) => {
      if(direction==='receive'&&data?.type==='pcm-port-state') {
        const row={worker:id,closed:data.closed===true,configured:data.configured===true,observedAt:performance.now()}
        for(const key of ['decoded','gaps','duplicates','chunks','encodedBytes','pcmBytes','maximumChunks','maximumBytes','recovered','reordered','heldPackets','maximumHeld'])
          if(Number.isSafeInteger(data[key])&&data[key]>=0)row[key]=data[key]
        for(const key of ['lastCaptureUnixMs','maximumResidualMs','scheduledCaptureUnixMs','captureOffsetMs','maximumOffsetMs'])if(Number.isFinite(data[key]))row[key]=data[key]
        pcmStates.push(row);if(pcmStates.length>64)pcmStates.shift();return
      }
      if(direction==='receive'&&data?.type==='pcm-port-error'){errors++;failures.pipe++;return}
      if(direction==='receive'&&data?.type==='encoded-video-decode'&&['complete','error','unsupported','timeout','closed'].includes(data.status)){
        const row={worker:id,status:data.status,
          reason:[null,'API','CONFIG','DECODE','OUTPUT','CODEC','CLOCK','BOUND','TIMEOUT'].includes(data.reason)?data.reason:'OUTPUT',records:[]}
        if(data.captureMode==='rtp-projected')row.captureMode=data.captureMode
        for(const key of ['inputCount','decodedCount','maximumBytes','captureAnchors'])if(Number.isSafeInteger(data[key])&&data[key]>=0)row[key]=data[key]
        for(const key of ['maximumCaptureResidualMs','maximumProjectionMs'])if(Number.isFinite(data[key])&&data[key]>=0)row[key]=data[key]
        for(const record of (Array.isArray(data.records)?data.records:[]).slice(0,8)){
          const safe={}
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
      if(data?.type==='timing-probe-state'&&['boot','stream','frame'].includes(data.state)) {
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
  const legacyReceiver = typeof RTCRtpReceiver.prototype.createEncodedStreams === 'function'
  window.RTCPeerConnection = class extends Peer {
    setConfiguration(configuration) {
      // LiveKit reapplies the configuration after joining. Preserve the same
      // immutable encoded-stream opt-in used when this private peer was made.
      return super.setConfiguration(legacyReceiver?{...configuration,encodedInsertableStreams:true}:configuration)
    }
    constructor(...args) {
      super(...(legacyReceiver ? [{...args[0],encodedInsertableStreams:true},...args.slice(1)] : args))
      this.addEventListener('track', ({ receiver }) => {
        if(observedReceivers.has(receiver))return
        if(receiver.transform){errors++;failures.occupied++;return}
        const worker=track(new Worker(receiverUrl,{type:'module'}),'receive'),kind=receiver.track.kind
        receiverWorkers.set(receiver.track,worker)
        if(legacyReceiver&&typeof receiver.createEncodedStreams==='function') {
          const {readable,writable}=receiver.createEncodedStreams()
          const codecs=(receiver.getParameters?.().codecs || []).filter(item=>Number.isInteger(item.payloadType)&&
            item.payloadType>=0&&item.payloadType<=127&&['audio/opus','audio/red','video/vp8'].includes(item.mimeType?.toLowerCase()))
            .slice(0,16).map(item=>({payloadType:item.payloadType,mimeType:item.mimeType.toLowerCase()}))
          worker.postMessage({kind,codecs,readable,writable},[readable,writable])
        } else if(!legacyReceiver&&scriptTransform) {
          const codecs=(receiver.getParameters?.().codecs || []).filter(item=>Number.isInteger(item.payloadType)&&
            item.payloadType>=0&&item.payloadType<=127&&['audio/opus','audio/red','video/vp8'].includes(item.mimeType?.toLowerCase()))
            .slice(0,16).map(item=>({payloadType:item.payloadType,mimeType:item.mimeType.toLowerCase()}))
          receiver.transform=new RTCRtpScriptTransform(worker,{kind,codecs})
        }
        else {errors++;failures.unsupported++}
        observedReceivers.add(receiver)
      })
    }
  }
  window.__encodedTimingProbe = { records,states,audioDecoders,videoDecoders,pcmStates,
    receiverWorker(track){return receiverWorkers.get(track)},workerId(worker){return workerIds.get(worker)}, features:{scriptTransform,
    legacySender:typeof RTCRtpSender.prototype.createEncodedStreams==='function',
    legacyReceiver, receiverApi:legacyReceiver?'legacy':scriptTransform?'standard':'unsupported'},
    failures,get wrappedSenders(){return wrappedSenders},get workerCount(){return workers.size},
    get errors() { return errors }, close() {
    for (const worker of workers) worker.terminate()
    for (const url of urls) URL.revokeObjectURL(url)
  } }
}
