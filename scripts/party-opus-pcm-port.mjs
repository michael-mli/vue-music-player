// Private transport between an encoded receiver worker and the PCM worklet.
// Its deadline only stops decoding; the downstream app guard owns permission.
export function bindOpusPcmPort(createStream, primaryPayload, packetFrames, configuration) {
  const {port,renderFrame,wallUnixMs,delayMs,expiryUnixMs}=configuration || {}
  let expiry=expiryUnixMs,lastWall=Date.now(),lastMono=performance.now(),closed=false,stream,timer
  if (!(port instanceof MessagePort) || !Number.isSafeInteger(renderFrame) || renderFrame<0 ||
    !Number.isFinite(wallUnixMs) || Math.abs(lastWall-wallUnixMs)>250 ||
    !Number.isInteger(delayMs) || delayMs<200 || delayMs>800 ||
    !Number.isFinite(expiry) || expiry<=lastWall || expiry-lastWall>10000) throw new Error('PCM_PORT_CONFIG')
  function close(reason=null) {
    if(closed)return
    closed=true;clearInterval(timer);stream?.close(reason)
    try{port.postMessage({type:'stop'})}catch{}
    port.close()
  }
  function check() {
    if(closed)return false
    const wall=Date.now(),mono=performance.now()
    if(!Number.isFinite(wall)||!Number.isFinite(mono)||wall<lastWall||mono<lastMono||
      Math.abs((wall-lastWall)-(mono-lastMono))>250||wall>=expiry){close('PCM_PORT_CLOCK');return false}
    lastWall=wall;lastMono=mono;return true
  }
  stream=createStream(primaryPayload,packetFrames,packet=>{
    if(!check())return
    const startFrame=renderFrame+Math.round((packet.captureUnixMs+delayMs-wallUnixMs)*48)
    if(!Number.isSafeInteger(startFrame)||startFrame<0){close('PCM_PORT_SCHEDULE');return}
    port.postMessage({type:'pcm',id:packet.id,startFrame,planes:packet.planes},packet.planes.map(plane=>plane.buffer))
  },()=>close('PCM_PORT_DECODER'))
  // A synchronous unsupported/configuration failure can precede assignment.
  if(closed)stream.close()
  port.onmessage=({data})=>{
    if(!check())return
    if(data?.type==='consumed')stream.consumed(data)
    else if(data?.type==='stop')close()
    else if(data?.type==='renew'&&Number.isFinite(data.expiryUnixMs)&&data.expiryUnixMs>=expiry&&
      data.expiryUnixMs>Date.now()&&data.expiryUnixMs-Date.now()<=10000)expiry=data.expiryUnixMs
    else close('PCM_PORT_MESSAGE')
  }
  port.start()
  if(!closed)timer=setInterval(check,100)
  return {observe(frame,metadata){if(check())stream.observe(frame,metadata)},close,
    snapshot(){return {closed,...stream.snapshot()}}}
}
