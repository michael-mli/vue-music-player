// Private two-frame transfer adapter. Returned frames belong to the caller's
// bounded presentation queue; this adapter has no player or audio connection.
export function createOwnedVideoReceiver(track){
  const worker=window.__encodedTimingProbe?.receiverWorker(track)
  const workerId=window.__encodedTimingProbe?.workerId(worker)
  if(!worker)throw new Error('PLAYOUT_VIDEO_RECEIVER')
  const channel=new MessageChannel(),owned=new Map()
  let controller,closed=false,timer,closeTimer,error=null,lastId=0,lastCapture=-Infinity,maximumInFlight=0
  function close(reason=null){
    if(closed)return
    closed=true;error=reason;clearInterval(timer)
    for(const packet of owned.values())packet.frame.close()
    owned.clear()
    try{controller.error(new Error(reason||'PLAYOUT_VIDEO_CLOSED'))}catch{}
    worker.postMessage({type:'video-stop'})
    // Drain already transferred frames until the worker's terminal acknowledgment.
    closeTimer=setTimeout(()=>channel.port1.close(),1000)
  }
  const readable=new ReadableStream({start(value){controller=value},cancel(){close()}},{highWaterMark:0})
  channel.port1.onmessage=({data})=>{
    if(data?.type==='video-stop'){close('PLAYOUT_VIDEO_DECODER');clearTimeout(closeTimer);channel.port1.close();return}
    if(closed){if(data?.frame instanceof VideoFrame)data.frame.close();return}
    try{
      if(data?.type!=='video-frame'||!(data.frame instanceof VideoFrame)||
        !Number.isSafeInteger(data.id)||data.id<=lastId||owned.size>=2||
        !Number.isInteger(data.rtpTimestamp)||data.rtpTimestamp<0||data.rtpTimestamp>0xffffffff||
        !Number.isFinite(data.captureUnixMs)||data.captureUnixMs<=lastCapture||
        data.frame.codedWidth!==1280||data.frame.codedHeight!==720||
        !['I420','NV12'].includes(data.frame.format)||!Number.isSafeInteger(data.bytes)||data.bytes<1||data.bytes>1280*720*3/2||data.frame.allocationSize()!==data.bytes){
        if(data?.frame instanceof VideoFrame)data.frame.close();throw new Error('PLAYOUT_VIDEO_TRANSFER')
      }
      lastId=data.id;lastCapture=data.captureUnixMs
      const packet={id:data.id,bytes:data.bytes,frame:data.frame,captureUnixMs:data.captureUnixMs,rtpTimestamp:data.rtpTimestamp}
      owned.set(packet.id,packet);maximumInFlight=Math.max(maximumInFlight,owned.size)
      controller.enqueue(packet)
    }catch{close('PLAYOUT_VIDEO_TRANSFER')}
  }
  channel.port1.start()
  worker.postMessage({type:'video-bind',port:channel.port2,expiryUnixMs:Date.now()+9000},[channel.port2])
  timer=setInterval(()=>{if(!closed)worker.postMessage({type:'video-renew',expiryUnixMs:Date.now()+9000})},1000)
  return {readable,close,snapshot:()=>({closed,error,inFlight:owned.size,maximumInFlight,
    decoder:window.__encodedTimingProbe.videoStates?.findLast(row=>row.worker===workerId)||null}),
    consumed(packet){
      if(closed)return
      if(owned.get(packet.id)!==packet){close('PLAYOUT_VIDEO_TRANSFER');return}
      owned.delete(packet.id);channel.port1.postMessage({type:'video-consumed',id:packet.id,bytes:packet.bytes})
    }}
}
