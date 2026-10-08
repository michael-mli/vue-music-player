// Receiver-only experiment. Encoded RTC frames keep flowing unchanged while
// a caller explicitly binds an owned PCM renderer to this worker.
export function installOpusPcmWorker(bindPort,createStream,primaryPayload,packetFrames) {
  let adapter=null,bound=false
  self.__observeOwnedPcm=(frame,metadata)=>adapter?.observe(frame,metadata)
  self.addEventListener('message',({data})=>{
    if(data?.type==='pcm-renew'){adapter?.renew(data.expiryUnixMs);return}
    if(data?.type==='pcm-stop'){adapter?.close();return}
    if(data?.type!=='pcm-bind')return
    if(self.__encodedTimingDirection!=='receive'||bound){self.postMessage({type:'pcm-port-error'});return}
    bound=true
    try {
      adapter=bindPort(createStream,primaryPayload,packetFrames,data.configuration)
      const timer=setInterval(()=>{
        const snapshot=adapter.snapshot()
        self.postMessage({type:'pcm-port-state',...snapshot})
        if(snapshot.closed){clearInterval(timer);adapter.close()}
      },100)
    } catch {self.postMessage({type:'pcm-port-error'})}
  })
}
