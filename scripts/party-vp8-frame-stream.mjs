// Private continuous decoder. The caller owns delivered VideoFrames; neither
// decoding nor capture-clock metadata grants permission to present them.
export function createVp8FrameStream(deliver,report=()=>{},{reorderMs=80}={}) {
  if(!Number.isInteger(reorderMs)||reorderMs<0||reorderMs>500)throw new Error('VIDEO_REORDER_CONFIG')
  const heldLimit=reorderMs>240?20:8
  const expected=new Map(),pending=[]
  const held=new Map(),seen=new Set()
  let reorderTimer,flushing=false,maximumHeld=0,duplicates=0,lateFrames=0,reordered=0,pressureDrains=0,highestRtp=null
  let decoder,configured=false,closed=false,sequence=0,encodedBytes=0
  let lastRtp=null,lastTimestamp=0,captureAnchor=null,decoded=0,decodedKeyFrames=0,discarded=0,maximumBytes=0,maximumPending=0,maximumResidualMs=0
  const delta=(value,anchor)=>((value-anchor+0x80000000)>>>0)-0x80000000
  function snapshot(){return {closed,configured,decoded,decodedKeyFrames,discarded,encodedBytes,pending:expected.size,
    maximumBytes,maximumPending,maximumResidualMs,heldPackets:held.size,maximumHeld,heldLimit,duplicates,lateFrames,reordered,pressureDrains,reorderMs}}
  function close(reason=null){
    if(closed)return
    closed=true;clearTimeout(reorderTimer);held.clear();seen.clear();pending.length=0;expected.clear();encodedBytes=0
    try{if(decoder?.state!=='closed')decoder?.close()}catch{}
    report({reason,...snapshot()})
  }
  function output(frame){
    let transferred=false
    try{
      if(closed)return
      const packet=expected.get(frame.timestamp)
      if(!packet||frame.codedWidth!==1280||frame.codedHeight!==720||frame.displayWidth!==1280||frame.displayHeight!==720)throw new Error('VIDEO_OUTPUT')
      expected.delete(frame.timestamp);encodedBytes-=packet.bytes
      const bytes=frame.allocationSize()
      if(!['I420','NV12'].includes(frame.format)||!Number.isSafeInteger(bytes)||bytes<1||bytes>1280*720*3/2)throw new Error('VIDEO_OUTPUT')
      decoded++
      if(packet.type==='key')decodedKeyFrames++
      if(!captureAnchor||performance.now()-captureAnchor.observedAt>5000){discarded++;return}
      const offset=delta(packet.rtp,captureAnchor.rtp)/90
      if(Math.abs(offset)>5000){discarded++;return}
      transferred=deliver(frame,{id:++sequence,bytes,rtpTimestamp:packet.rtp,
        captureUnixMs:performance.timeOrigin+captureAnchor.capture+offset})===true
      if(!transferred)discarded++
    }catch{close('VIDEO_OUTPUT')}
    finally{if(!transferred)frame.close();if(!closed)flush()}
  }
  function decode(packet){
    const chunk=new EncodedVideoChunk({type:packet.type,timestamp:packet.timestamp,data:packet.data})
    // Once WebCodecs owns the chunk copy, expected output needs metadata only.
    packet.data=null
    decoder.decode(chunk)
  }
  function accept(packet){
    const step=lastRtp===null?0:delta(packet.rtp,lastRtp)
    if(Number.isFinite(packet.capture)){
      const residual=captureAnchor?packet.capture-(captureAnchor.capture+delta(packet.rtp,captureAnchor.rtp)/90):0
      maximumResidualMs=Math.max(maximumResidualMs,Math.abs(residual))
      if(Math.abs(residual)>80)throw new Error('VIDEO_CLOCK')
      captureAnchor={rtp:packet.rtp,capture:packet.capture,observedAt:packet.arrivedAt}
    }
    packet.timestamp=lastTimestamp+Math.round(step/90*1000)
    if(!Number.isSafeInteger(packet.timestamp))throw new Error('VIDEO_CLOCK')
    expected.set(packet.timestamp,packet);lastRtp=packet.rtp;lastTimestamp=packet.timestamp
    maximumPending=Math.max(maximumPending,expected.size)
    if(configured)decode(packet);else pending.push(packet)
  }
  function failure(error){close(['VIDEO_PACKET','VIDEO_CLOCK','VIDEO_BOUND'].includes(error.message)?error.message:'VIDEO_DECODE')}
  function flush(forceOne=false){
    if(closed||flushing)return
    flushing=true;clearTimeout(reorderTimer);reorderTimer=null
    try{
      while(!closed&&held.size&&expected.size<4){
        const packet=[...held.values()].sort((a,b)=>delta(a.rtp,b.rtp))[0]
        const firstArrival=Math.min(...[...held.values()].map(item=>item.arrivedAt))
        const remaining=reorderMs-(performance.now()-firstArrival)
        if(remaining>0&&!forceOne){reorderTimer=setTimeout(flush,Math.max(1,remaining));break}
        if(remaining>0)pressureDrains++
        forceOne=false
        held.delete(packet.rtp);accept(packet)
      }
    }catch(error){failure(error)}
    finally{flushing=false}
  }
  if(typeof VideoDecoder!=='function'||typeof EncodedVideoChunk!=='function')close('VIDEO_API')
  else void VideoDecoder.isConfigSupported({codec:'vp8',codedWidth:1280,codedHeight:720,optimizeForLatency:true}).then(result=>{
    if(closed)return
    if(!result.supported){close('VIDEO_CONFIG');return}
    decoder=new VideoDecoder({output,error:()=>close('VIDEO_DECODE')});decoder.configure(result.config);configured=true
    while(!closed&&pending.length)decode(pending.shift())
  }).catch(()=>close('VIDEO_CONFIG'))
  return {snapshot,close,observe(frame,metadata){
    if(closed)return
    if(lastRtp===null&&frame.type!=='key')return
    try{
      const rtp=frame.timestamp
      if(!Number.isInteger(rtp)||rtp<0||rtp>0xffffffff||!['key','delta'].includes(frame.type)||
        self.__encodedTimingCodecs?.find(codec=>codec.payloadType===metadata?.payloadType)?.mimeType!=='video/vp8')throw new Error('VIDEO_PACKET')
      const step=lastRtp===null?0:delta(rtp,lastRtp)
      if(seen.has(rtp)){discarded++;duplicates++;return}
      seen.add(rtp);if(seen.size>64)seen.delete(seen.values().next().value)
      if(lastRtp!==null&&step<=0){discarded++;lateFrames++;return}
      if(step>450000)throw new Error('VIDEO_CLOCK')
      const data=frame.data
      if(!(data instanceof ArrayBuffer)||data.byteLength<1||data.byteLength>256*1024)throw new Error('VIDEO_PACKET')
      // A network burst can fill the time-based queue before its deadline.
      // Decode the oldest retained packet before exceeding the encoded count.
      // A stalled decoder still fails closed at the same queue/input bounds.
      if(held.size>=heldLimit)flush(true)
      if(closed)return
      if(lastRtp!==null&&delta(rtp,lastRtp)<=0){discarded++;lateFrames++;return}
      if(held.size>=heldLimit||encodedBytes+data.byteLength>512*1024||reorderMs===0&&expected.size>=4)throw new Error('VIDEO_BOUND')
      const packet={rtp,type:frame.type,bytes:data.byteLength,data:data.slice(0),capture:metadata?.captureTime,arrivedAt:performance.now()}
      if(highestRtp!==null&&delta(rtp,highestRtp)<0)reordered++
      else highestRtp=rtp
      encodedBytes+=packet.bytes;maximumBytes=Math.max(maximumBytes,encodedBytes)
      if(lastRtp===null)accept(packet)
      else{held.set(rtp,packet);maximumHeld=Math.max(maximumHeld,held.size);flush()}
    }catch(error){failure(error)}
  }}
}
