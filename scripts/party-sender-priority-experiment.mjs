// Private nominal-profile allocation comparison. The production SDK gives
// audio high local allocation priority and video low. Only video's local
// priority changes; packet DSCP priority, caps and media bytes stay untouched.
export function installSenderPriorityExperiment() {
  let stopped=false,pending=false,applied=0,transactions=0
  const failures=[]
  const fail=code=>{if(stopped)return;failures.push(code);stopped=true;clearInterval(timer)}
  const fingerprint=parameters=>JSON.stringify({degradationPreference:parameters.degradationPreference,
    encodings:parameters.encodings.map(e=>({active:e.active,maxBitrate:e.maxBitrate,maxFramerate:e.maxFramerate,
      networkPriority:e.networkPriority,scaleResolutionDownBy:e.scaleResolutionDownBy,scalabilityMode:e.scalabilityMode}))})
  async function update(){
    if(stopped||pending)return
    pending=true
    try{
      const peers=window.__peers||[]
      if(peers.length>16){fail('SOURCE_PRIORITY_BOUND');return}
      const senders=peers.flatMap(peer=>peer.getSenders()).filter(sender=>sender.track?.kind==='video'&&sender.track.readyState==='live')
      if(senders.length>16){fail('SOURCE_PRIORITY_BOUND');return}
      for(const sender of senders){
        if(stopped)return
        const parameters=sender.getParameters(),encoding=parameters.encodings?.[0]
        // Wait for SDK publication to install the nominal single encoding.
        if(parameters.encodings?.length!==1||encoding.maxBitrate!==350000||encoding.maxFramerate!==25)continue
        if(!['very-low','low','medium','high'].includes(encoding.priority)||
          !['very-low','low','medium','high'].includes(encoding.networkPriority)){
          fail('SOURCE_PRIORITY_API');return
        }
        if(encoding.priority==='high')continue
        const before=fingerprint(parameters)
        encoding.priority='high';transactions++
        await sender.setParameters(parameters)
        if(stopped)return
        const actual=sender.getParameters()
        if(actual.encodings?.length!==1||actual.encodings[0].priority!=='high'||fingerprint(actual)!==before){
          fail('SOURCE_PRIORITY_READBACK');return
        }
        applied++
      }
    }catch{fail('SOURCE_PRIORITY_SETTER')}
    finally{pending=false}
  }
  const timer=setInterval(()=>void update(),200)
  window.__avSenderPriority={snapshot:()=>({applied,transactions,pending,stopped,failures:failures.slice()}),
    close(){stopped=true;clearInterval(timer)}}
}
