// Private receiver adapter. The only audible connection is into the caller's
// existing gain/lease graph on its default-rate context. No permit is created.
export function createOwnedPcmReceiver(Queue,worklet,context,track,nativeSource,delayMs) {
  const worker=window.__encodedTimingProbe?.receiverWorker(track)
  const workerId=window.__encodedTimingProbe?.workerId(worker)
  if(!worker||!Number.isSafeInteger(workerId)||delayMs<200||delayMs>800)throw new Error('PLAYOUT_PCM_RECEIVER')
  const node=context.createGain();node.gain.value=0
  let pcmContext,pcmNode,capture,input,url,timer,closed=false,ready=false,error=null,anchor
  let lastCursor=-Infinity
  let clock=null
  let queue=null
  let badOutputSince=null
  let badOutputCode=null
  function row(){return window.__encodedTimingProbe.pcmStates.findLast(item=>item.worker===workerId)}
  function close(){
    if(closed)return
    closed=true;ready=false;queue=null;clearInterval(timer);node.gain.value=0;node.disconnect()
    worker.postMessage({type:'pcm-stop'});pcmNode?.port.postMessage({type:'stop'});pcmNode?.disconnect();input?.disconnect()
    capture?.stream.getTracks().forEach(value=>value.stop());if(url)URL.revokeObjectURL(url);void pcmContext?.close()
  }
  function fail(code){error=code;close()}
  function invalidOutput(code,now){
    // Never estimate a cursor or emit PCM from an invalid native sample.
    // A brief timestamp quantization outlier can be rechecked while silent;
    // sustained failure remains terminal and no output permit is renewed here.
    node.gain.value=0
    if(badOutputSince===null){badOutputSince=now;badOutputCode=code}
    if(!Number.isFinite(now)||now<badOutputSince||now-badOutputSince>=50)fail(code)
    return null
  }
  void(async()=>{
    try{
      pcmContext=new AudioContext({sampleRate:48000});await pcmContext.resume()
      if(closed){await pcmContext.close();return}
      url=URL.createObjectURL(new Blob([`(${worklet.toString()})(${Queue.toString()});`],{type:'text/javascript'}))
      await pcmContext.audioWorklet.addModule(url)
      if(closed)return
      pcmNode=new AudioWorkletNode(pcmContext,'party-owned-pcm',{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[2]})
      pcmNode.port.onmessage=({data})=>{
        if(closed)return
        if(data?.type==='silent')fail('PLAYOUT_PCM_RENDER')
        else if(data?.type==='queue-state'){
          if(!Number.isSafeInteger(data.queued)||data.queued<0||data.queued>48||
            !Number.isSafeInteger(data.bytes)||data.bytes<0||data.bytes>1024*1024||
            !Number.isSafeInteger(data.bufferedFrames)||data.bufferedFrames<0||data.bufferedFrames>48*5760){fail('PLAYOUT_PCM_RENDER');return}
          queue={queued:data.queued,bytes:data.bytes,bufferedFrames:data.bufferedFrames,observedAt:performance.now()}
        }
      }
      pcmNode.onprocessorerror=()=>fail('PLAYOUT_PCM_RENDER')
      capture=pcmContext.createMediaStreamDestination();pcmNode.connect(capture)
      input=nativeSource.call(context,capture.stream);input.connect(node)
      const channel=new MessageChannel()
      pcmNode.port.postMessage({type:'bind',port:channel.port1},[channel.port1])
      anchor={wall:Date.now(),frame:Math.round(pcmContext.currentTime*48000)}
      worker.postMessage({type:'pcm-bind',configuration:{port:channel.port2,renderFrame:anchor.frame,
        wallUnixMs:anchor.wall,delayMs,expiryUnixMs:Date.now()+9000}},[channel.port2])
      ready=true;node.gain.value=1
      timer=setInterval(()=>{
        if(closed)return
        const state=row()
        if(state?.closed){fail('PLAYOUT_PCM_DECODER');return}
        // Resource housekeeping only. Output authority remains with the app's
        // existing source-bound receive permit and final deadline guard.
        worker.postMessage({type:'pcm-renew',expiryUnixMs:Date.now()+9000})
      },1000)
    }catch{fail('PLAYOUT_PCM_CREATE')}
  })()
  return {node,close,snapshot(){const state=row();return {ready,closed,error,delayMs,
    pcmRate:pcmContext?.sampleRate||null,outputRate:context.sampleRate,decoder:state||null,clock,queue,validatingOutput:badOutputSince!==null}},
    captureCursor(){
      const state=row(),now=performance.now()
      if(closed||!ready||!state?.configured||state.closed||state.decoded<2)return null
      if(now-state.observedAt>5000||!Number.isFinite(state.lastCaptureUnixMs)||Date.now()-state.lastCaptureUnixMs>5000){fail('PLAYOUT_PCM_CLOCK');return null}
      const output=context.getOutputTimestamp(),age=now-output.performanceTime
      clock={ageMs:age,latencyMs:(context.currentTime-output.contextTime)*1000}
      // The existing native-source freshness contract allows a reported sample
      // timestamp up to 20 ms ahead of observation due to clock quantization.
      if(!Number.isFinite(output.contextTime)||output.contextTime<=0||!Number.isFinite(age)||age< -20||age>200)return invalidOutput('PLAYOUT_PCM_OUTPUT_AGE',now)
      const latency=(context.currentTime-output.contextTime)*1000
      if(!Number.isFinite(latency)||latency<0||latency>200)return invalidOutput('PLAYOUT_PCM_OUTPUT_LATENCY',now)
      if(badOutputSince!==null){
        if(now<badOutputSince||now-badOutputSince>=50){fail(badOutputCode);return null}
      }
      const scheduledCursor=anchor.wall+(pcmContext.currentTime*48000-anchor.frame)/48-delayMs-latency
      // Use a phase observation at or before the audible sample position,
      // rather than a newer packet still waiting in the PCM hold queue.
      const phase=window.__encodedTimingProbe.pcmStates.findLast(item=>item.worker===workerId&&
        Number.isFinite(item.scheduledCaptureUnixMs)&&item.scheduledCaptureUnixMs<=scheduledCursor)
      const offset=phase?.captureOffsetMs??0
      if(!Number.isFinite(offset)||Math.abs(offset)>200){fail('PLAYOUT_PCM_CLOCK');return null}
      const cursor=scheduledCursor+offset
      clock.captureOffsetMs=offset
      clock.cursorStepMs=Number.isFinite(lastCursor)?cursor-lastCursor:null
      if(!Number.isFinite(cursor)||cursor<lastCursor-80){fail('PLAYOUT_PCM_OUTPUT_REVERSE');return null}
      lastCursor=Math.max(lastCursor,cursor)
      if(badOutputSince!==null){badOutputSince=null;badOutputCode=null;node.gain.value=1}
      return cursor
    }}
}
