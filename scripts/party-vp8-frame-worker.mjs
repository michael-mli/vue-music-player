// Private receiver worker. Decoding starts at the first received keyframe;
// binding a port only transfers ownership, never permission to present output.
export function installVp8FrameWorker(createStream){
  let stream,port,timer,bound=false,closed=false,reason=null,expiry,lastWall=Date.now(),lastMono=performance.now()
  const credits=new Map()
  function close(code=null){
    if(closed)return
    closed=true;reason=code;clearInterval(timer);stream?.close(code);credits.clear()
    self.postMessage({type:'video-port-state',...stream?.snapshot(),closed,reason,inFlight:0})
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
    expiry??=Date.now()+10000
    stream=createStream((frame,packet)=>{
      if(!check()||!port||credits.size>=2)return false
      credits.set(packet.id,packet.bytes)
      try{port.postMessage({type:'video-frame',frame,...packet},[frame]);return true}
      catch{credits.delete(packet.id);close('VIDEO_PORT_TRANSFER');return false}
    },row=>close(row.reason))
    if(closed){stream.close();return}
    timer=setInterval(()=>{
      check()
      self.postMessage({type:'video-port-state',...stream.snapshot(),closed,reason,inFlight:credits.size})
    },100)
  }
  self.__observeOwnedVideo=(frame,metadata)=>{
    if(self.__encodedTimingDirection!=='receive'||closed)return
    ensure();if(check())stream.observe(frame,metadata)
  }
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
    }
    port.start();ensure()
  })
}
