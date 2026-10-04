// Private continuous decoder. The caller owns delivered VideoFrames; neither
// decoding nor capture-clock metadata grants permission to present them.
export function createVp8FrameStream(deliver,report=()=>{}) {
  const expected=new Map(),pending=[]
  let decoder,configured=false,closed=false,sequence=0,encodedBytes=0
  let lastRtp=null,lastTimestamp=0,captureAnchor=null,decoded=0,discarded=0,maximumBytes=0,maximumPending=0,maximumResidualMs=0
  const delta=(value,anchor)=>((value-anchor+0x80000000)>>>0)-0x80000000
  function snapshot(){return {closed,configured,decoded,discarded,encodedBytes,pending:expected.size,
    maximumBytes,maximumPending,maximumResidualMs}}
  function close(reason=null){
    if(closed)return
    closed=true;pending.length=0;expected.clear();encodedBytes=0
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
      if(!Number.isSafeInteger(bytes)||bytes<1||bytes>1280*720*4)throw new Error('VIDEO_OUTPUT')
      decoded++
      if(!captureAnchor||performance.now()-captureAnchor.observedAt>5000){discarded++;return}
      const offset=delta(packet.rtp,captureAnchor.rtp)/90
      if(Math.abs(offset)>5000){discarded++;return}
      transferred=deliver(frame,{id:++sequence,bytes,rtpTimestamp:packet.rtp,
        captureUnixMs:performance.timeOrigin+captureAnchor.capture+offset})===true
      if(!transferred)discarded++
    }catch{close('VIDEO_OUTPUT')}
    finally{if(!transferred)frame.close()}
  }
  function decode(packet){
    const chunk=new EncodedVideoChunk({type:packet.type,timestamp:packet.timestamp,data:packet.data})
    // Once WebCodecs owns the chunk copy, expected output needs metadata only.
    packet.data=null
    decoder.decode(chunk)
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
      if(lastRtp!==null&&step<=0){discarded++;return}
      if(step>450000)throw new Error('VIDEO_CLOCK')
      if(Number.isFinite(metadata?.captureTime)){
        const residual=captureAnchor?metadata.captureTime-(captureAnchor.capture+delta(rtp,captureAnchor.rtp)/90):0
        maximumResidualMs=Math.max(maximumResidualMs,Math.abs(residual))
        if(Math.abs(residual)>80)throw new Error('VIDEO_CLOCK')
        captureAnchor={rtp,capture:metadata.captureTime,observedAt:performance.now()}
      }
      const data=frame.data
      if(!(data instanceof ArrayBuffer)||data.byteLength<1||data.byteLength>256*1024)throw new Error('VIDEO_PACKET')
      if(expected.size>=4||encodedBytes+data.byteLength>512*1024)throw new Error('VIDEO_BOUND')
      const timestamp=lastTimestamp+Math.round(step/90*1000)
      if(!Number.isSafeInteger(timestamp))throw new Error('VIDEO_CLOCK')
      const packet={rtp,timestamp,type:frame.type,bytes:data.byteLength,data:data.slice(0)}
      expected.set(timestamp,packet);encodedBytes+=packet.bytes;lastRtp=rtp;lastTimestamp=timestamp
      maximumBytes=Math.max(maximumBytes,encodedBytes);maximumPending=Math.max(maximumPending,expected.size)
      if(configured)decode(packet);else pending.push(packet)
    }catch(error){close(['VIDEO_PACKET','VIDEO_CLOCK','VIDEO_BOUND'].includes(error.message)?error.message:'VIDEO_DECODE')}
  }}
}
