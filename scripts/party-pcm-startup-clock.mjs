// Private readiness gate. resume() alone does not prove a moving device clock.
// Keep the receiver muted and unbound until three native intervals agree with
// wall time. The returned anchor is fixed for the entire subsequent session.
export async function waitForOwnedPcmClock(context,current,sleep=()=>new Promise(resolve=>setTimeout(resolve,100))){
  const started=performance.now()
  let mono=started,wall=Date.now(),audio=context.currentTime,windowMono=mono,windowAudio=audio,stable=0
  if(!Number.isFinite(mono)||mono<0||!Number.isFinite(wall)||!Number.isFinite(audio)||audio<0)throw new Error('PLAYOUT_PCM_CLOCK')
  while(true){
    await sleep()
    if(!current()||context.state!=='running')throw new Error('PLAYOUT_PCM_STARTUP_CANCELLED')
    const now=performance.now(),unix=Date.now(),render=context.currentTime
    if(!Number.isFinite(now)||!Number.isFinite(unix)||!Number.isFinite(render)||now<mono||unix<wall||render<audio||
      Math.abs((unix-wall)-(now-mono))>250)throw new Error('PLAYOUT_PCM_CLOCK')
    if(now-started>=8000)throw new Error('PLAYOUT_PCM_STARTUP_TIMEOUT')
    const output=context.getOutputTimestamp(),age=now-output.performanceTime,latency=(render-output.contextTime)*1000
    const valid=Number.isFinite(output.contextTime)&&output.contextTime>0&&Number.isFinite(age)&&age>=-20&&age<=200&&
      Number.isFinite(latency)&&latency>=0&&latency<=200
    const interval=now-mono,elapsed=(render-audio)*1000
    if(valid&&interval>=50&&interval<=250&&Math.abs(elapsed-interval)<=35)stable++
    else{stable=0;windowMono=now;windowAudio=render}
    mono=now;wall=unix;audio=render
    if(stable>=3){
      if(Math.abs((render-windowAudio)*1000-(now-windowMono))<=25)return {wall:unix,frame:Math.round(render*48000)}
      stable=0;windowMono=now;windowAudio=render
    }
  }
}
