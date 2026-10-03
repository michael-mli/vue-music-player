// Private native timing probe. Forward every frame unchanged and retain only
// allowlisted timing/codec scalars, never payloads, grants, identities or URLs.
export function encodedTimingWorker() {
  const Stream = self.TransformStream
  const counts = { audio: 0, video: 0 }, captureSamples = { audio: 0, video: 0 }
  function observe(frame, kind) {
    if (!['audio','video'].includes(kind)) return
    const count = ++counts[kind]
    if (count > 4000) return
    const regular = count <= 8 || count % 100 === 0
    if (!regular && captureSamples[kind] >= 8) return
    let metadata = {}, metadataSupported = false
    try { if(typeof frame.getMetadata==='function'){metadata=frame.getMetadata()||{};metadataSupported=true} } catch {}
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
  const receiverUrl = URL.createObjectURL(new Blob([workerSource + `
    self.postMessage({type:'timing-probe-state',state:'boot'});
    const attach=(readable,writable,kind)=>{
      self.__encodedTimingKind=kind;
      const stream=new TransformStream({transform(frame,controller){controller.enqueue(frame)}});
      self.__encodedTimingKind=null;
      readable.pipeThrough(stream).pipeTo(writable).catch(()=>self.postMessage({type:'timing-probe-error'}));
    };
    self.onrtctransform=({transformer})=>attach(transformer.readable,transformer.writable,transformer.options.kind);
    self.onmessage=({data})=>attach(data.readable,data.writable,data.kind);
  `], { type: 'text/javascript' }))
  const records = [], states=[], workers = new Set(), urls = new Set([receiverUrl]), observedReceivers=new WeakSet()
  let errors = 0, sequence = 0, wrappedSenders = 0
  const failures = { worker:0, pipe:0, occupied:0, unsupported:0 }
  function track(worker, direction) {
    const id = ++sequence
    workers.add(worker)
    worker.addEventListener('message', ({ data }) => {
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
        if(legacyReceiver&&typeof receiver.createEncodedStreams==='function') {
          const {readable,writable}=receiver.createEncodedStreams()
          worker.postMessage({kind,readable,writable},[readable,writable])
        } else if(!legacyReceiver&&scriptTransform) receiver.transform=new RTCRtpScriptTransform(worker,{kind})
        else {errors++;failures.unsupported++}
        observedReceivers.add(receiver)
      })
    }
  }
  window.__encodedTimingProbe = { records,states, features:{scriptTransform,
    legacySender:typeof RTCRtpSender.prototype.createEncodedStreams==='function',
    legacyReceiver, receiverApi:legacyReceiver?'legacy':scriptTransform?'standard':'unsupported'},
    failures,get wrappedSenders(){return wrappedSenders},get workerCount(){return workers.size},
    get errors() { return errors }, close() {
    for (const worker of workers) worker.terminate()
    for (const url of urls) URL.revokeObjectURL(url)
  } }
}
