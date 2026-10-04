// Owned browser experiment only. The app's source/gain/deadline worklet remain
// the sole audible path. Delay is inserted before that existing output guard.
export function installControlledReceiver(Clock, FrameQueue, delayMs = 800, createPcm = null, verifyEpoch = null,createVideo=null) {
  if (!Number.isInteger(delayMs) || delayMs < 200 || delayMs > 1000) throw new Error('PLAYOUT_DELAY')
  const ownedPcm=typeof createPcm==='function'
  const ownedVideo=typeof createVideo==='function'
  if(ownedVideo&&!ownedPcm)throw new Error('PLAYOUT_VIDEO_CONFIG')
  if(ownedPcm&&(delayMs>800||typeof verifyEpoch!=='function'))throw new Error('PLAYOUT_PCM_CONFIG')
  const Context = window.AudioContext, nativeSource = Context.prototype.createMediaStreamSource
  const sources = new WeakMap(), activeSources = new Set(), history = []
  let controller = null, stopped = false, sequence = 0
  const receivers = () => window.__peers.flatMap(peer => peer.getReceivers())
  function source(receiver, now) {
    const value = receiver.getSynchronizationSources().find(item => Number.isFinite(item.captureTimestamp) &&
      Number.isInteger(item.rtpTimestamp) && Number.isFinite(item.timestamp))
    if (!value) return null
    // Chromium's actual source delivery timestamp is epoch milliseconds. A
    // performance-relative implementation must explicitly satisfy that domain.
    const wallAge = Date.now() - value.timestamp, relativeAge = now - value.timestamp
    const age = wallAge >= -20 && wallAge <= 120 ? wallAge : relativeAge >= -20 && relativeAge <= 120 ? relativeAge : null
    return age === null ? null : { ...value, age: Math.max(0, age) }
  }
  function create(original, state, videoReceiver, audioReceiver) {
    const session = ++sequence
    if (typeof MediaStreamTrackGenerator !== 'function' || typeof VideoFrame !== 'function') throw new Error('PLAYOUT_GENERATOR')
    const outputTrack = new MediaStreamTrackGenerator({ kind: 'video' }), writer = outputTrack.writable.getWriter()
    const output = new MediaStream([outputTrack])
    const player = document.createElement('video'); player.dataset.partyControlledVideo = ''
    player.autoplay = true; player.playsInline = true; player.muted = true; player.srcObject = output
    player.style.width = '100%'; player.style.borderRadius = '12px'
    let video,clone,reader
    try { video=ownedVideo?createVideo(videoReceiver.track):null;clone=ownedVideo?null:videoReceiver.track.clone()
      reader = ownedVideo?video.readable.getReader():new MediaStreamTrackProcessor({ track: clone, maxBufferSize: 4 }).readable.getReader() }
    catch (failure) { video?.close();clone?.stop(); outputTrack.stop(); void writer.abort().catch(() => {}); player.srcObject = null; throw failure }
    const audioClone = audioReceiver.track.clone()
    let audioReader
    try { audioReader = new MediaStreamTrackProcessor({ track: audioClone, maxBufferSize: 1 }).readable.getReader() }
    catch (failure) { video?.close();clone?.stop(); audioClone.stop(); void reader.cancel().catch(()=>{}); outputTrack.stop(); void writer.abort().catch(() => {}); player.srcObject = null; throw failure }
    original.after(player); const oldDisplay = original.style.display; original.style.display = 'none'
    // Four pending codec outputs reserve full RGBA allocations. Owned outputs
    // strictly admit I420/NV12 at <= 1.5 bytes/pixel, including two transfers,
    // writer and generator. 42.5 MiB + 4 RGBA + 4 YUV + 2 MiB PCM/encoded
    // is 63.83 MiB; 32 queued + eight reserved frames remains <= 40.
    const queue = new FrameQueue(ownedVideo?32:34, (ownedVideo?42.5:ownedPcm?41:42) * 1024 * 1024), videoClock = new Clock(90000), audioClock = new Clock(48000)
    let epochOffset=null
    function pcmClock(){const data=state.pcm.snapshot(),decoder=data.decoder;return {status:data.closed?'lost':decoder?.decoded>=2?'ready':'waiting',
      anchors:decoder?.decoded||0,ageMs:decoder?Date.now()-decoder.lastCaptureUnixMs:null,maximumResidualMs:decoder?.maximumResidualMs||0}}
    let closed = false, frameId, presentationId, presented = 0, drawn = 0, missing = 0, maximumBytes = 0, maximumQueued = 0
    let firstPresentation = null, lastPresentation = null, error = null, ready = false, writing = false, lastOutputTimestamp = -Infinity
    let decodedAudio = 0
    const videoArrival={count:0,totalMs:0,maximumMs:0,afterHold:0}
    const videoRelease={count:0,totalLateMs:0,maximumLateMs:0,over150:0,over250:0}
    const item = { original, state, snapshot() { return { session, ready, closed, error,
      delayMs, audioDelayMs: ownedPcm?delayMs:state.delay.delayTime.value * 1000,
      ...(ownedPcm?{pcm:state.pcm.snapshot(),epochOffset}:{}),
      ...(ownedVideo?{ownedVideo:video.snapshot()}:{}),
      drawn, presented, missing, decodedAudio, maximumBytes, maximumQueued,
      ...(ownedPcm?{videoArrival:{...videoArrival,meanMs:videoArrival.count?videoArrival.totalMs/videoArrival.count:null},
        videoRelease:{...videoRelease,meanLateMs:videoRelease.count?videoRelease.totalLateMs/videoRelease.count:null}}:{}),
      firstPresentation, lastPresentation, width: player.videoWidth, height: player.videoHeight, ...queue.snapshot(),
      audioClock: ownedPcm?pcmClock():audioClock.snapshot(performance.now()), videoClock: videoClock.snapshot(performance.now()) } },
      close() {
        if (closed) return
        closed = true; state.sync.gain.value = 0
        state.pcm?.close()
        cancelAnimationFrame(frameId); player.cancelVideoFrameCallback(presentationId)
        queue.close();video?.close(); clone?.stop(); audioClone.stop()
        void reader.cancel().catch(() => {}); void audioReader.cancel().catch(() => {})
        void writer.abort().catch(() => {}).finally(() => writer.releaseLock())
        player.pause(); player.srcObject = null; player.remove(); outputTrack.stop()
        original.style.display = oldDisplay
        history.push(item.snapshot()); if (history.length > 8) history.shift()
      } }
    function fail(code) { if (closed) return; error = code; state.terminal = true; state.sync.gain.value = 0; state.delay.disconnect(); state.pcm?.close();item.close() }
    function presentation(now, metadata) {
      if (closed) return
      if (!Number.isSafeInteger(metadata.presentedFrames) || !Number.isFinite(metadata.expectedDisplayTime)) { fail('PLAYOUT_PRESENTATION'); return }
      presented = metadata.presentedFrames; firstPresentation ??= metadata.expectedDisplayTime; lastPresentation = metadata.expectedDisplayTime
      presentationId = player.requestVideoFrameCallback(presentation)
    }
    presentationId = player.requestVideoFrameCallback(presentation)
    void player.play().catch(() => fail('PLAYOUT_AUTOPLAY'))
    // Drain decoded audio without reading PCM or creating an output. This keeps
    // native delivery metadata advancing while the startup sync gain is closed.
    void (async () => {
      try { while (!closed) { const { value, done } = await audioReader.read(); if (done) break; value.close(); decodedAudio++ } }
      catch { if (!closed) fail('PLAYOUT_AUDIO_READ') }
      finally { audioReader.releaseLock() }
    })()
    void (async () => {
      try {
        while (!closed) {
          const { value, done } = await reader.read()
          if (done) break
          const frame=ownedVideo?value.frame:value
          if (closed) { frame.close(); break }
          const now = performance.now(), stamp = source(videoReceiver, now)
          let capture = null
          try {
            if(ownedVideo){
              videoClock.observe(value.rtpTimestamp,value.captureUnixMs,now)
              capture=videoClock.estimate(value.rtpTimestamp,now)
            }else{
              const rtp = frame.metadata()?.rtpTimestamp
              if (stamp) videoClock.observe(stamp.rtpTimestamp, stamp.captureTimestamp, now)
              capture = videoClock.estimate(rtp, now)
            }
          } catch { frame.close(); throw new Error('PLAYOUT_VIDEO_METADATA') }
          if (videoClock.snapshot(now).status === 'lost') { frame.close(); throw new Error('PLAYOUT_VIDEO_CLOCK') }
          if (capture === null) { frame.close();video?.consumed(value); missing++; continue }
          if(ownedPcm){
            if(epochOffset===null){
              const probe=window.__encodedTimingProbe
              const workerIds=[audioReceiver.track,videoReceiver.track].map(track=>probe.workerId(probe.receiverWorker(track)))
              const epochs=verifyEpoch(probe.records.filter(row=>workerIds.includes(row.worker)),original.srcObject,window.__peers,Clock)
              if(epochs.length!==2||epochs.some(row=>row.status!=='verified')||epochs[0].epoch!==epochs[1].epoch){frame.close();video?.consumed(value);missing++;continue}
              epochOffset=epochs[0].epoch==='ntp'?2208988800000:0
            }
            if(!ownedVideo)capture-=epochOffset
            const age=Date.now()-capture
            if(!Number.isFinite(age)||age< -80||age>5000){frame.close();throw new Error('PLAYOUT_VIDEO_AGE')}
            videoArrival.count++;videoArrival.totalMs+=age
            videoArrival.maximumMs=Math.max(videoArrival.maximumMs,age)
            if(age>delayMs)videoArrival.afterHold++
          }
          if ((ownedPcm?pcmClock():audioClock.snapshot(now)).status === 'waiting') queue.discardPending()
          queue.push(frame, capture)
          video?.consumed(value)
          const snapshot = queue.snapshot()
          maximumBytes = Math.max(maximumBytes, snapshot.bytes); maximumQueued = Math.max(maximumQueued, snapshot.queued)
        }
      } catch (failure) { if (!closed) fail(/^PLAYOUT_[A-Z_]+$/.test(failure.message) ? failure.message : 'PLAYOUT_VIDEO_READ') }
      finally { reader.releaseLock() }
    })()
    function render(now) {
      if (closed) return
      try {
        const stamp = ownedPcm?null:source(audioReceiver, now)
        if (stamp) audioClock.observe(stamp.rtpTimestamp, stamp.captureTimestamp, now)
        if ((ownedPcm?pcmClock():audioClock.snapshot(now)).status === 'lost') throw new Error('PLAYOUT_AUDIO_CLOCK')
        const capture = ownedPcm?state.pcm.captureCursor():stamp ? audioClock.estimate(stamp.rtpTimestamp, now) : null
        if (capture !== null && state.context.state === 'running') {
          const latency = (state.context.outputLatency + state.context.baseLatency) * 1000
          if (!Number.isFinite(latency) || latency < 0 || latency > 200) throw new Error('PLAYOUT_OUTPUT_CLOCK')
          const selected = writing ? null : queue.take(ownedPcm?capture:capture + stamp.age - delayMs - latency)
          if (selected) {
            if(ownedPcm){
              const late=Math.max(0,capture-selected.captureTime)
              videoRelease.count++;videoRelease.totalLateMs+=late
              videoRelease.maximumLateMs=Math.max(videoRelease.maximumLateMs,late)
              if(late>150)videoRelease.over150++
              if(late>250)videoRelease.over250++
            }
            let frame
            try {
              lastOutputTimestamp = Math.max(lastOutputTimestamp + 1, Math.round(performance.now() * 1000))
              frame = new VideoFrame(selected.frame, { timestamp: lastOutputTimestamp })
              writing = true
              void writer.write(frame).then(() => { frame.close(); writing = false; drawn++; ready = true },
                () => { frame.close(); writing = false; fail('PLAYOUT_VIDEO_WRITE') })
            }
            finally { selected.frame.close() }
          }
          state.sync.gain.value = ready ? 1 : 0
        } else state.sync.gain.value = 0
      } catch (failure) { fail(/^PLAYOUT_[A-Z_]+$/.test(failure.message) ? failure.message : 'PLAYOUT_RENDER') }
      if (!closed) frameId = requestAnimationFrame(render)
    }
    frameId = requestAnimationFrame(render)
    return item
  }
  Context.prototype.createMediaStreamSource = function(stream) {
    const node = nativeSource.call(this, stream), track = stream.getAudioTracks()[0]
    if (stopped || !receivers().some(receiver => receiver.track === track)) return node
    let state = null
    const connect = node.connect.bind(node), disconnect = node.disconnect.bind(node)
    node.connect = (...args) => {
      // The app's guarded graph connects its source to a gain. Private spectrum
      // probes connect to an analyser and must never claim the audible path.
      if (!state) {
        if (stopped || sources.has(track) || !(args[0] instanceof GainNode)) return connect(...args)
        state = { context: this, track, delay: ownedPcm?this.createGain():this.createDelay(1.1), sync: this.createGain(), active: true, terminal: false }
        if(ownedPcm)state.pcm=createPcm(this,track,nativeSource,delayMs)
        else state.delay.delayTime.value = delayMs / 1000
        state.sync.gain.value = 0
        sources.set(track, state); activeSources.add(state)
      }
      if(ownedPcm)state.pcm.node.connect(state.delay)
      else connect(state.delay)
      state.delay.connect(state.sync); return state.sync.connect(...args)
    }
    node.disconnect = (...args) => {
      if (!state) return disconnect(...args)
      state.active = false; state.sync.gain.value = 0; state.delay.disconnect(); state.sync.disconnect(); activeSources.delete(state)
      state.pcm?.close()
      if (controller?.state === state) { controller.close(); controller = null }
      return disconnect(...args)
    }
    return node
  }
  function maybeStart() {
    if (stopped || typeof MediaStreamTrackProcessor !== 'function') return
    const original = document.querySelector('[data-party-media-screen] video:not([data-party-controlled-video])')
    const stream = original?.srcObject, audio = stream?.getAudioTracks?.()[0], video = stream?.getVideoTracks?.()[0]
    const state = sources.get(audio)
    if (!state?.active || state.terminal || !video || controller?.state === state) return
    const audioReceiver = receivers().find(receiver => receiver.track === audio), videoReceiver = receivers().find(receiver => receiver.track === video)
    if (!audioReceiver || !videoReceiver) return
    controller?.close()
    try { controller = create(original, state, videoReceiver, audioReceiver) }
    catch { state.terminal = true; state.sync.gain.value = 0; state.delay.disconnect(); history.push({ error: 'PLAYOUT_CREATE' }) }
  }
  const timer = setInterval(maybeStart, 100)
  window.__controlledReceiver = { snapshot() { return { delayMs, active: controller?.snapshot() || null, history: history.slice(), sources: activeSources.size } },
    close() { stopped = true; clearInterval(timer); controller?.close(); controller = null
      for (const state of activeSources) { state.sync.gain.value = 0; state.delay.disconnect(); state.sync.disconnect();state.pcm?.close() }
      activeSources.clear(); Context.prototype.createMediaStreamSource = nativeSource
    } }
}

export function analyseReceiverKeyframeRecovery(samples,phase){
  const rows=samples.filter(item=>item.phase===phase),errors=[]
  const decoders=rows.map(item=>item.receiver?.controlledReceiver?.active?.ownedVideo?.decoder)
  const sources=rows.map(item=>item.source?.reports?.filter(row=>row.type==='outbound-rtp'&&row.kind==='video')||[])
  const first=decoders[0],last=decoders.at(-1)
  if(rows.length<2||decoders.some(row=>!row?.recovery||row.closed||row.worker!==first?.worker||
    ['keyframeRequests','keyframeFulfilled','decodedKeyFrames'].some(key=>!Number.isSafeInteger(row[key])||row[key]<0))||
    sources.some(row=>row.length!==1||!Number.isSafeInteger(row[0].keyFramesEncoded)||row[0].keyFramesEncoded<0))
    return {phase,errors:['PLAYOUT_KEYFRAME_EVIDENCE']}
  const requests=last.keyframeRequests-first.keyframeRequests,fulfilled=last.keyframeFulfilled-first.keyframeFulfilled,
    decodedKeys=last.decodedKeyFrames-first.decodedKeyFrames,encodedKeys=sources.at(-1)[0].keyFramesEncoded-sources[0][0].keyFramesEncoded
  if([requests,fulfilled,decodedKeys,encodedKeys].some(value=>value<0))errors.push('PLAYOUT_KEYFRAME_RESET')
  if(requests>0&&(fulfilled<1||decodedKeys<1||encodedKeys<1))errors.push('PLAYOUT_KEYFRAME_RESPONSE')
  return {phase,requests,fulfilled,decodedKeys,encodedKeys,errors}
}

export function analyseControlledReceiverQuality(samples, phase) {
  const values = samples.filter(item => item.phase === phase).map(item => item.receiver.controlledReceiver?.active)
  const errors = [], first = values[0], last = values.at(-1)
  if (values.length < 2 || values.some(item => !item?.ready || item.closed || item.error ||
    item.width !== 1280 || item.height !== 720 || !Number.isSafeInteger(item.presented) ||
    !Number.isFinite(item.lastPresentation) || !Number.isFinite(item.maximumBytes) || !Number.isFinite(item.maximumQueued)))
    errors.push('PLAYOUT_NATIVE_EVIDENCE')
  if (values.some(item => item && (item.maximumBytes > 64 * 1024 * 1024 || item.maximumQueued > 40))) errors.push('PLAYOUT_QUEUE_BOUND')
  if (values.some(item => item?.session !== first?.session)) errors.push('PLAYOUT_SESSION')
  const durationMs = last?.lastPresentation - first?.lastPresentation
  const fps = durationMs > 0 ? (last.presented - first.presented) / durationMs * 1000 : null
  if (!Number.isFinite(fps) || fps < 20 || fps > 30) errors.push('PLAYOUT_NOMINAL_FPS')
  const ownedVideo=values.some(item=>item?.ownedVideo)
  let decodedFps=null,drawnFps=null
  if(ownedVideo){
    const decoderFirst=first?.ownedVideo?.decoder,decoderLast=last?.ownedVideo?.decoder
    if(values.some(item=>!item?.ownedVideo||item.ownedVideo.closed||!item.ownedVideo.decoder?.configured||
      item.ownedVideo.decoder.closed||item.ownedVideo.maximumInFlight>2||item.ownedVideo.decoder.maximumPending>4||
      ![8,20].includes(item.ownedVideo.decoder.heldLimit)||!Number.isSafeInteger(item.ownedVideo.decoder.maximumHeld)||
      item.ownedVideo.decoder.maximumHeld<0||item.ownedVideo.decoder.maximumHeld>item.ownedVideo.decoder.heldLimit||
      item.ownedVideo.decoder.maximumBytes>512*1024||item.maximumQueued>32||item.maximumBytes>42.5*1024*1024||
      item.ownedVideo.decoder.worker!==decoderFirst?.worker))errors.push('PLAYOUT_OWNED_VIDEO_EVIDENCE')
    const decoderDuration=decoderLast?.observedAt-decoderFirst?.observedAt
    decodedFps=decoderDuration>0?(decoderLast.decoded-decoderFirst.decoded)/decoderDuration*1000:null
    drawnFps=durationMs>0?(last.drawn-first.drawn)/durationMs*1000:null
    if(!Number.isFinite(decodedFps)||decodedFps<20||decodedFps>30||!Number.isFinite(drawnFps)||drawnFps<20||drawnFps>30)
      errors.push('PLAYOUT_OWNED_VIDEO_FPS')
  }
  return { phase, samples: values.length, fps, ...(ownedVideo?{decodedFps,drawnFps}:{}),durationMs: Number.isFinite(durationMs) ? durationMs : null, errors }
}

// The private controller keeps a hidden native decoder and one visible video
// sink. Both paths must retain exactly one current native performance stream.
export function hasSingleAudienceOutput() {
  const all = [...document.querySelectorAll('[data-party-media-screen] video')]
  const native = all.filter(element => !element.hasAttribute('data-party-controlled-video'))
  if (native.length !== 1 || native[0].paused || !native[0].muted ||
    native[0].srcObject?.getAudioTracks().length !== 1 || native[0].srcObject.getVideoTracks().length !== 1) return false
  if (!window.__controlledReceiver) return all.length === 1 && native[0].videoWidth > 0
  const output = all.filter(element => element.hasAttribute('data-party-controlled-video'))
  const state = window.__controlledReceiver.snapshot()
  return all.length === 2 && output.length === 1 && state.sources === 1 && state.active?.ready && !state.active.error &&
    getComputedStyle(native[0]).display === 'none' && getComputedStyle(output[0]).display !== 'none' &&
    !output[0].paused && output[0].muted && output[0].videoWidth === 1280 && output[0].videoHeight === 720 &&
    output[0].srcObject?.getAudioTracks().length === 0 && output[0].srcObject.getVideoTracks().length === 1
}
