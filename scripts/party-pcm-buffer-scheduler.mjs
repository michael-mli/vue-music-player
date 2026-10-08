// Private scheduler on the caller's existing guarded AudioContext. The browser
// resamples 48-kHz buffers; this primitive creates neither a context nor a permit.
export function createPcmBufferScheduler(context,node,port){
  if(!context||typeof context.createBuffer!=='function'||typeof context.createBufferSource!=='function'||
    !node||!(port instanceof MessagePort))throw new Error('PLAYOUT_PCM_BUFFER_CONFIG')
  const entries=new Map(),copyReservationBytes=46080,limit=1024*1024-copyReservationBytes
  let closed=false,error=null,upstreamReason=null,bytes=0,maximumBytes=0,maximumQueued=0,lastId=0,lastEnd=0,latePackets=0,trimmedFrames=0
  function release(entry,consumed=true){
    if(!entries.delete(entry.id))return
    bytes-=entry.bytes
    entry.source.onended=null;entry.source.disconnect()
    try{entry.source.buffer=null}catch{}
    entry.source=null
    if(consumed&&!closed)port.postMessage({type:'consumed',id:entry.id,bytes:entry.bytes})
  }
  function close(code=null){
    if(closed)return
    closed=true;error=code
    for(const entry of [...entries.values()]){
      try{entry.source.stop()}catch{}
      release(entry,false)
    }
    try{port.postMessage({type:'stop'})}catch{}
    port.close()
  }
  function receive({data}){
    if(closed)return
    let source
    try{
      if(data?.type==='stop'){
        const known=['PCM_API','PCM_CONFIG','PCM_DECODE','PCM_OUTPUT','PCM_CLOCK','PCM_BOUND','PCM_PACKET','PCM_CREDIT',
          'PCM_PORT_CLOCK','PCM_PORT_MESSAGE','PCM_PORT_DECODER','PCM_PORT_SCHEDULE']
        if(data.reason!==undefined&&data.reason!==null&&!known.includes(data.reason))throw new Error('PLAYOUT_PCM_BUFFER_FORMAT')
        upstreamReason=data.reason??null;close();return
      }
      const {id,startFrame,planes,creditBytes}=data||{}
      if(data.type!=='pcm'||!Number.isSafeInteger(id)||id<=lastId||!Number.isSafeInteger(startFrame)||startFrame<lastEnd||
        !Array.isArray(planes)||planes.length<1||planes.length>2)throw new Error('PLAYOUT_PCM_BUFFER_CLOCK')
      const frames=planes[0]?.length
      if(!Number.isInteger(frames)||frames<1||frames>5760||planes.some(plane=>!(plane instanceof Float32Array)||
        plane.length!==frames||plane.byteOffset!==0||plane.buffer.byteLength!==plane.byteLength||plane.some(value=>!Number.isFinite(value))))throw new Error('PLAYOUT_PCM_BUFFER_FORMAT')
      const expected=planes.length*frames*4*2,endFrame=startFrame+frames
      if(creditBytes!==expected||!Number.isSafeInteger(endFrame)||entries.size>=48||bytes+expected>limit)throw new Error('PLAYOUT_PCM_BUFFER_BOUND')
      lastId=id;lastEnd=endFrame
      const start=startFrame/48000,duration=frames/48000
      if(!Number.isFinite(context.currentTime)||context.currentTime<0)throw new Error('PLAYOUT_PCM_BUFFER_CLOCK')
      if(start+duration<=context.currentTime){
        latePackets++;planes.length=0;port.postMessage({type:'consumed',id,bytes:expected});return
      }
      // Two complete copies are reserved until native consumption, plus one
      // shared maximum packet copy window during these synchronous operations.
      bytes+=expected;maximumBytes=Math.max(maximumBytes,bytes+copyReservationBytes)
      const buffer=context.createBuffer(planes.length,frames,48000)
      if(buffer.sampleRate!==48000||buffer.length!==frames||buffer.numberOfChannels!==planes.length)throw new Error('PLAYOUT_PCM_BUFFER_FORMAT')
      for(let channel=0;channel<planes.length;channel++)buffer.copyToChannel(planes[channel],channel)
      source=context.createBufferSource();source.buffer=buffer
      Object.defineProperties(source,{__partyOwnedPcmSource:{value:true},__partyOwnedPcmSink:{value:node}})
      if(source.playbackRate.value!==1||source.detune.value!==0)throw new Error('PLAYOUT_PCM_BUFFER_CLOCK')
      source.connect(node)
      const entry={id,source,bytes:expected,startFrame,endFrame}
      entries.set(id,entry);maximumQueued=Math.max(maximumQueued,entries.size)
      source.onended=()=>release(entry)
      planes.length=0
      const now=context.currentTime,offset=Math.max(0,now-start)
      if(offset>=duration){latePackets++;source.disconnect();release(entry);return}
      trimmedFrames+=Math.min(frames,Math.round(offset*48000))
      source.start(Math.max(start,now),offset,duration-offset)
    }catch(exception){
      // A failed allocation before insertion still belongs to this primitive.
      try{source?.stop()}catch{}source?.disconnect()
      close(['PLAYOUT_PCM_BUFFER_CLOCK','PLAYOUT_PCM_BUFFER_FORMAT','PLAYOUT_PCM_BUFFER_BOUND'].includes(exception.message)?exception.message:'PLAYOUT_PCM_BUFFER_CREATE')
      if(Array.isArray(data?.planes))data.planes.length=0
      bytes=0
    }
  }
  port.onmessage=receive;port.start()
  return {close,snapshot(){
    const renderFrame=Math.round(context.currentTime*48000)
    return {closed,error,upstreamReason,queued:entries.size,bytes,maximumBytes,maximumQueued,copyReservationBytes,
      latePackets,trimmedFrames,renderFrame,observedAt:performance.now(),
      bufferedFrames:[...entries.values()].reduce((sum,item)=>sum+Math.max(0,item.endFrame-Math.max(item.startFrame,renderFrame)),0)}
  }}
}

// Fixture graph evidence: a declared PCM source must actually connect only to
// its owned sink on the same context. A marker alone cannot exclude a backing
// player or a source connected directly to a hardware destination.
export function isOwnedPcmBufferSource(item){
  const state=item?.__state,sink=item?.__partyOwnedPcmSink
  return item?.__partyOwnedPcmSource===true&&sink?.__partyOwnedPcmSink===true&&state&&
    sink.context===state.context&&sink!==state.context.destination&&Array.isArray(state.connections)&&
    ((state.ended||state.started===false||state.stopAt!==null&&Number.isFinite(state.stopAt)&&state.stopAt<=state.context.currentTime)&&state.connections.length===0||
      state.connections.length===1&&state.connections[0]===sink)
}
