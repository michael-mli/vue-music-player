// Private receiver worker. Decoding starts at the first received keyframe;
// binding a port only transfers ownership, never permission to present output.
export function installVp8FrameWorker(createStream,reorderMs=80,recover=false,recoveryMs=5000,gapAware=false,codec='vp8',dependencyAware=false,markerProbe=null,recoveryWaitMs=350,sourceReferences=false){
  if(!['vp8','vp9'].includes(codec))throw new Error('VIDEO_CODEC_CONFIG')
  if(typeof sourceReferences!=='boolean'||sourceReferences&&(!dependencyAware||codec!=='vp8'))throw new Error('VIDEO_REFERENCE_CONFIG')
  if(typeof dependencyAware!=='boolean'||dependencyAware&&(!gapAware||codec!=='vp9'&&!sourceReferences))throw new Error('VIDEO_REORDER_CONFIG')
  if(!Number.isInteger(recoveryMs)||recoveryMs<1000||recoveryMs>5000)throw new Error('VIDEO_RECOVERY_CONFIG')
  if(![100,350].includes(recoveryWaitMs)||recoveryWaitMs!==350&&(!recover||!dependencyAware))throw new Error('VIDEO_RECOVERY_CONFIG')
  let stream,port,timer,bound=false,closed=false,reason=null,expiry,lastWall=Date.now(),lastMono=performance.now()
  let lastKey=-Infinity,lastRequest=-Infinity,keyframePending=false,keyframeRequests=0,keyframeFulfilled=0,keyframeEarlyRequests=0
  let seenDamage=0
  const credits=new Map()
  const recovery=()=>({recovery:recover,recoveryMs,recoveryWaitMs,keyframeRequests,keyframeFulfilled,keyframePending,keyframeEarlyRequests})
  function requestRecovery(after){
    const damage=dependencyAware?(after.referenceMisses||0):(after.lateFrames||0),newDamage=damage>seenDamage
    seenDamage=damage
    const waiting=dependencyAware&&after.missingReferenceWaitMs>=recoveryWaitMs,now=performance.now()
    if(closed||after.closed||!recover||!newDamage&&!waiting||keyframePending||now-lastRequest<recoveryMs||now-lastKey<1000)return
    keyframePending=true;keyframeRequests++;if(waiting&&!newDamage)keyframeEarlyRequests++;lastRequest=now
    void Promise.resolve().then(()=>{if(!check())return;return self.__requestOwnedVideoKeyframe()})
      .then(()=>{if(!closed)keyframeFulfilled++})
      .catch(()=>close('VIDEO_RECOVERY_REQUEST')).finally(()=>{keyframePending=false})
  }
  function close(code=null){
    if(closed)return
    closed=true;reason=code;clearInterval(timer);stream?.close(code);credits.clear()
    self.postMessage({type:'video-port-state',...stream?.snapshot(),...recovery(),closed,reason,inFlight:0})
    try{port?.postMessage({type:'video-stop'})}catch{}
    port?.close()
  }
  function check(){
    if(closed)return false
    const wall=Date.now(),mono=performance.now()
    if(!Number.isFinite(wall)||!Number.isFinite(mono)||wall<lastWall||mono<lastMono||
      Math.abs((wall-lastWall)-(mono-lastMono))>250||wall>=expiry){close('VIDEO_PORT_CLOCK');return false}
    lastWall=wall;lastMono=mono;return true
  }
  function ensure(){
    if(stream||closed)return
    if(recover&&typeof self.__requestOwnedVideoKeyframe!=='function'){close('VIDEO_RECOVERY_API');return}
    expiry??=Date.now()+10000
    stream=createStream((frame,packet)=>{
      if(!check()||!port)return false
      if(credits.size>=2)return 'wait'
      credits.set(packet.id,packet.bytes)
      try{port.postMessage({type:'video-frame',frame,...packet},[frame]);return true}
      catch{credits.delete(packet.id);close('VIDEO_PORT_TRANSFER');return false}
    },row=>close(row.reason),{reorderMs,gapAware,codec,dependencyAware,markerProbe,sourceReferences})
    if(closed){stream.close();return}
    timer=setInterval(()=>{
      if(!check())return
      requestRecovery(stream.snapshot())
      self.postMessage({type:'video-port-state',...stream.snapshot(),...recovery(),closed,reason,inFlight:credits.size})
    },100)
  }
  self.__observeOwnedVideo=(frame,metadata)=>{
    if(self.__encodedTimingDirection!=='receive'||closed)return
    ensure();if(!check())return
    const before=stream.snapshot();stream.observe(frame,metadata)
    const after=stream.snapshot(),now=performance.now()
    // RTP spacing also grows when the encoder intentionally omits frames.
    // Request recovery only for an actual received reference discarded as late.
    if(closed||after.closed)return
    if(frame.type==='key'&&after.lateFrames===before.lateFrames&&after.duplicates===before.duplicates)lastKey=now
    requestRecovery(after)
  }
  self.__failOwnedVideoReference=()=>close('VIDEO_REFERENCE')
  self.addEventListener('message',({data})=>{
    if(data?.type==='video-stop'){close();return}
    if(data?.type==='video-renew'){
      if(!bound||!check())return
      if(!Number.isFinite(data.expiryUnixMs)||data.expiryUnixMs<expiry||data.expiryUnixMs<=Date.now()||
        data.expiryUnixMs-Date.now()>10000){close('VIDEO_PORT_MESSAGE');return}
      expiry=data.expiryUnixMs;return
    }
    if(data?.type!=='video-bind')return
    if(self.__encodedTimingDirection!=='receive'||bound||closed||!(data.port instanceof MessagePort)||
      !Number.isFinite(data.expiryUnixMs)||data.expiryUnixMs<=Date.now()||data.expiryUnixMs-Date.now()>10000){
      close('VIDEO_PORT_MESSAGE');self.postMessage({type:'video-port-error'});return
    }
    bound=true;port=data.port;expiry=data.expiryUnixMs
    port.onmessage=({data:credit})=>{
      if(!check())return
      if(credit?.type==='video-stop'){close();return}
      if(credit?.type!=='video-consumed'||!Number.isSafeInteger(credit.id)||credits.get(credit.id)!==credit.bytes){close('VIDEO_PORT_CREDIT');return}
      credits.delete(credit.id)
      stream?.resume?.()
    }
    port.start();ensure()
  })
}
