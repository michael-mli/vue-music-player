// Private eight-frame capability study. Native RTC bytes are forwarded by the
// caller unchanged; decoded frames never enter a visible or audible output.
export function createVp8DecodeProbe() {
  const pending=[],expected=new Map(),records=[]
  let decoder,configured=false,closed=false,timer,inputCount=0,encodedBytes=0,maximumBytes=0
  let firstRtp=null,lastRtp=null,captureAnchor=null,captureAnchors=0,maximumCaptureResidualMs=0,maximumProjectionMs=0
  const delta=(value,anchor)=>((value-anchor+0x80000000)>>>0)-0x80000000
  function finish(status,reason=null){
    if(closed)return
    closed=true;clearTimeout(timer);pending.length=0;expected.clear();encodedBytes=0
    try{if(decoder?.state!=='closed')decoder?.close()}catch{}
    self.postMessage({type:'encoded-video-decode',status,reason,inputCount,decodedCount:records.length,maximumBytes,records,
      captureMode:'rtp-projected',captureAnchors,maximumCaptureResidualMs,maximumProjectionMs})
  }
  function complete(){
    if(records.length!==8||captureAnchors<2)return
    for(const record of records){
      const offset=delta(record.rtpTimestamp,captureAnchor.rtp)/90
      maximumProjectionMs=Math.max(maximumProjectionMs,Math.abs(offset))
      if(Math.abs(offset)>5000){finish('error','CLOCK');return}
      record.captureUnixMs=performance.timeOrigin+captureAnchor.capture+offset
    }
    finish('complete')
  }
  function output(frame){
    try{
      if(closed)return
      const packet=expected.get(frame.timestamp)
      if(!packet||!Number.isSafeInteger(frame.timestamp)||frame.codedWidth!==1280||frame.codedHeight!==720||
        frame.displayWidth!==1280||frame.displayHeight!==720)throw new Error('OUTPUT')
      const bytes=frame.allocationSize()
      if(!Number.isSafeInteger(bytes)||bytes<1||bytes>1280*720*4)throw new Error('OUTPUT')
      expected.delete(frame.timestamp);encodedBytes-=packet.bytes
      records.push({timestamp:frame.timestamp,rtpTimestamp:packet.rtp,captureUnixMs:packet.captureUnixMs,
        width:frame.codedWidth,height:frame.codedHeight,allocationBytes:bytes,
        encodedArrivalMs:packet.arrivalMs,decodeDelayMs:performance.now()-packet.observedAt})
      complete()
    }catch{finish('error','OUTPUT')}
    finally{frame.close()}
  }
  function decode(packet){
    expected.set(packet.timestamp,packet)
    decoder.decode(new EncodedVideoChunk({type:packet.type,timestamp:packet.timestamp,data:packet.data}))
  }
  if(typeof VideoDecoder!=='function'||typeof EncodedVideoChunk!=='function')finish('unsupported','API')
  else{
    timer=setTimeout(()=>finish('timeout','TIMEOUT'),30000)
    void VideoDecoder.isConfigSupported({codec:'vp8',codedWidth:1280,codedHeight:720,optimizeForLatency:true}).then(result=>{
      if(closed)return
      if(!result.supported){finish('unsupported','CONFIG');return}
      decoder=new VideoDecoder({output,error:()=>finish('error','DECODE')})
      decoder.configure(result.config);configured=true
      while(!closed&&pending.length)decode(pending.shift())
    }).catch(()=>finish('error','CONFIG'))
  }
  return {close(){finish('closed')},observe(frame,metadata){
    if(closed)return
    if(inputCount===0&&frame.type!=='key')return
    try{
      if(!['key','delta'].includes(frame.type)||
        self.__encodedTimingCodecs?.find(codec=>codec.payloadType===metadata.payloadType)?.mimeType!=='video/vp8')throw new Error('CODEC')
      const rtp=frame.timestamp
      if(!Number.isInteger(rtp)||rtp<0||rtp>0xffffffff)throw new Error('CLOCK')
      if(Number.isFinite(metadata?.captureTime)){
        if(!Number.isSafeInteger(Math.round(metadata.captureTime*1000)))throw new Error('CLOCK')
        const residual=captureAnchor?metadata.captureTime-(captureAnchor.capture+delta(rtp,captureAnchor.rtp)/90):0
        maximumCaptureResidualMs=Math.max(maximumCaptureResidualMs,Math.abs(residual))
        if(Math.abs(residual)>80)throw new Error('CLOCK')
        if(!captureAnchor||delta(rtp,captureAnchor.rtp)>0){captureAnchor={rtp,capture:metadata.captureTime};captureAnchors++}
        complete();if(closed)return
      }
      if(inputCount>=8)return
      firstRtp??=rtp
      const timestamp=Math.round(delta(rtp,firstRtp)/90*1000)
      if(!Number.isSafeInteger(timestamp)||timestamp<0||timestamp>5000000||
        lastRtp!==null&&delta(rtp,lastRtp)<=0)throw new Error('CLOCK')
      const data=frame.data
      if(!(data instanceof ArrayBuffer)||data.byteLength<1||data.byteLength>256*1024||encodedBytes+data.byteLength>512*1024)throw new Error('BOUND')
      const packet={type:frame.type,timestamp,rtp,bytes:data.byteLength,data:data.slice(0),
        captureUnixMs:null,observedAt:performance.now(),
        arrivalMs:Number.isFinite(metadata?.captureTime)?performance.now()-metadata.captureTime:null}
      lastRtp=rtp
      inputCount++;encodedBytes+=packet.bytes;maximumBytes=Math.max(maximumBytes,encodedBytes)
      if(configured)decode(packet);else pending.push(packet)
    }catch(error){finish('error',['CODEC','CLOCK','BOUND'].includes(error.message)?error.message:'DECODE')}
  }}
}
