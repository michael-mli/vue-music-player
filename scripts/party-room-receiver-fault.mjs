// Integrated built-app/HTTP/gateway/SFU fault acceptance. Native output monitors
// remain independent of the blocked pages; this does not measure physical sound.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

export async function runRoomReceiverFault({ mode, phone, audience, host, origin, pathRoom,
  firstPublisher, api, evaluate, click, poll, check, db, provider, replacementBrowser, receiverBrowser,
  controlledDelayMs = null,ownedPcm=false }) {
  const label = `SFU receiver/${mode}`
  const view = await api(1,pathRoom)
  const clock = await evaluate(audience, `(async()=>{
    const samples=[];
    for(let i=0;i<5;i++){
      const before=performance.now();
      const response=await fetch(${JSON.stringify(origin+'/api/ktv'+pathRoom)},
        {cache:'no-store',headers:{Authorization:'Bearer 1'}});
      const reply=await response.json(),after=performance.now();
      samples.push({offsetMs:reply.data.clock.serverNowMs-(before+after)/2,uncertaintyMs:(after-before)/2});
    }
    return samples.sort((a,b)=>a.uncertaintyMs-b.uncertaintyMs)[0];
  })()`)
  assert.ok(clock.uncertaintyMs<=80,'Fault fixture measures the actual backend clock')
  const context = await evaluate(audience, `(()=>{
    const video=document.querySelector('[data-party-media-screen] video');
    const trackId=video.srcObject.getAudioTracks()[0].id;
    const receivers=__peers.filter(peer=>peer.connectionState==='connected').flatMap(peer=>peer.getReceivers())
      .filter(item=>item.track.kind==='audio'&&item.track.readyState==='live'&&item.track.id===trackId);
    for(const receiver of ${ownedPcm}?[]:receivers){
      if(!('jitterBufferTarget' in receiver))throw new Error('RECEIVER_TARGET_UNSUPPORTED');
      receiver.jitterBufferTarget=1000;
    }
    // The controlled output already holds an additional decoded-video delay.
    // For its deep-buffer expiry variant, request the same native video target
    // so the bounded decoded queue can remain active until the actual stall.
    // The ordinary production fault test keeps its original audio-only target.
    const videoReceivers=${controlledDelayMs !== null && !ownedPcm} ? __peers.filter(peer=>peer.connectionState==='connected')
      .flatMap(peer=>peer.getReceivers()).filter(item=>item.track.id===video.srcObject.getVideoTracks()[0].id) : [];
    for(const receiver of videoReceivers){
      if(!('jitterBufferTarget' in receiver))throw new Error('RECEIVER_VIDEO_TARGET_UNSUPPORTED');
      receiver.jitterBufferTarget=1000;
    }
    const receivedContexts=__contexts.filter(item=>item.state==='running'&&item.__mediaSourceTrackIds?.includes(trackId));
    window.__faultReceiveContext=receivedContexts[0];
    const pcmContexts=${ownedPcm}?__contexts.filter(item=>item.state==='running'&&item.sampleRate===48000&&item!==__faultReceiveContext):[];
    window.__faultPcmContext=pcmContexts[0];
    const controlled=window.__controlledReceiver?.snapshot().active;
    return {muted:video.muted,targets:receivers.map(item=>item.jitterBufferTarget),contexts:receivedContexts.length,
      videoTargets:videoReceivers.map(item=>item.jitterBufferTarget),pcmContexts:pcmContexts.length,
      controlled:controlled?{session:controlled.session,ready:controlled.ready,error:controlled.error,audioDelayMs:controlled.audioDelayMs,
        videoWidth:controlled.width,videoHeight:controlled.height}:null,
      backingSources:__bufferSources.length};
  })()`)
  console.log('Integrated received output topology:',JSON.stringify(context))
  check(context.muted&&context.targets.length===1&&(ownedPcm?context.pcmContexts===1:context.targets[0]===1000)&&context.contexts===1&&context.backingSources===0,
    `${label}: actual SFU audience uses one guarded output context and ${ownedPcm?'a separate owned PCM renderer':'a 1000-ms native receive target'}`)
  if(controlledDelayMs !== null) check(context.controlled?.ready && !context.controlled.error &&
    (ownedPcm||context.videoTargets.length===1 && context.videoTargets[0]===1000) &&
    Math.abs(context.controlled.audioDelayMs-controlledDelayMs)<1 &&
    context.controlled.videoWidth===1280 && context.controlled.videoHeight===720,
    `${label}: actual capture-controlled output has the requested additional audio delay and native video`)
  await poll(async()=> (await receiverBrowser.audioEvidence()).some(item=>item.captureHeartbeat&&item.rmsAmplitude>.02),
    'actual SFU received audio before page stall')
  // A target getter alone does not establish queued audio. Observe an interval
  // of native jitter-buffer counters after requesting the larger target.
  const buffer = ownedPcm?await poll(()=>evaluate(audience, `(()=>{
    const pcm=__controlledReceiver.snapshot().active?.pcm,queue=pcm?.queue;
    if(!pcm?.ready||pcm.closed||!queue)return false;
    const age=performance.now()-queue.observedAt;
    if(age<0||age>200)return false;
    // Subtract report age: only samples still ahead of the current renderer
    // count as evidence. Silent gaps and native queues are excluded.
    const meanMs=queue.bufferedFrames/48-age;
    return meanMs>=500?{meanMs,queued:queue.queued,bytes:queue.bytes,ageMs:age,rate:pcm.pcmRate}:false;
  })()`),'owned PCM renderer retains at least 500 ms of future decoded samples',20000):await poll(()=>evaluate(audience, `(async()=>{
    const stream=document.querySelector('[data-party-media-screen] video')?.srcObject;
    if(!stream)return false;
    const track=stream.getAudioTracks()[0];
    if(!track)return false;
    const trackId=track.id;
    for(const peer of __peers.filter(item=>item.connectionState==='connected')){
      const receiver=peer.getReceivers().find(item=>item.track.id===trackId);
      if(!receiver)continue;
      const stats=[...await receiver.getStats()].map(([,item])=>item);
      const row=stats.find(item=>item.type==='inbound-rtp'&&item.kind==='audio');
      if(!row||!Number.isFinite(row.jitterBufferDelay)||!Number.isFinite(row.jitterBufferEmittedCount))continue;
      const now=performance.now(),prior=window.__faultBufferSample;
      if(prior&&now-prior.now<750)return false;
      window.__faultBufferSample={now,delay:row.jitterBufferDelay,emitted:row.jitterBufferEmittedCount};
      if(!prior)return false;
      const emitted=row.jitterBufferEmittedCount-prior.emitted;
      const meanMs=emitted>0?1000*(row.jitterBufferDelay-prior.delay)/emitted:null;
      return meanMs>=500?{meanMs,emitted,intervalMs:now-prior.now,targetMs:receiver.jitterBufferTarget}:false;
    }
    return false;
  })()`),'native received audio has measured buffered residence beyond the expiry margin',20000)
  console.log(ownedPcm?'Integrated owned PCM buffer:':'Integrated native received buffer:',JSON.stringify(buffer))
  check(buffer.meanMs>=500&&(ownedPcm?buffer.queued>0&&buffer.bytes>0&&buffer.rate===48000:buffer.emitted>0&&buffer.targetMs===1000),
    `${label}: ${ownedPcm?'renderer counters confirm at least 500 ms of future owned PCM':'native counters confirm at least 500 ms mean audio residence after the 1000-ms target'}`)
  if(controlledDelayMs !== null) check(await evaluate(audience, `(()=>{
    const controlled=__controlledReceiver.snapshot().active;
    return controlled?.ready&&!controlled.closed&&!controlled.error;
  })()`), `${label}: controlled output remains active after native buffering builds`)
  if(controlledDelayMs !== null) {
    const bufferedAt=await evaluate(audience,'performance.timeOrigin+performance.now()');
    await poll(async()=> (await receiverBrowser.audioEvidence()).some(item=>item.captureHeartbeat&&
      item.time>=bufferedAt&&item.rmsAmplitude>.02), 'fresh controlled audible output after native buffering builds');
  }
  const issued = await poll(()=>evaluate(audience, `(()=>{
    const latest=__receivedPermits.at(-1);
    return latest&&latest.permit.publisherIdentity===${JSON.stringify(firstPublisher.identity)}&&
      performance.now()-latest.received<200&&latest.permit.expiresServerMs-performance.now()-${clock.offsetMs}>3000?latest:false;
  })()`),'fresh output permit actually delivered to the built audience')
  if(controlledDelayMs !== null) {
    const beforeStall=await evaluate(audience,'performance.timeOrigin+performance.now()');
    const evidence=await receiverBrowser.audioEvidence();
    const active=await evaluate(audience,'__controlledReceiver.snapshot().active');
    check(active?.ready&&!active.closed&&!active.error &&
      evidence.filter(item=>typeof item.audible==='boolean'&&item.time<=beforeStall).at(-1)?.audible===true &&
      evidence.some(item=>item.captureHeartbeat&&item.time>=beforeStall-1200&&item.time<=beforeStall&&item.rmsAmplitude>.02),
      `${label}: controlled output is active and independently audible immediately before the actual stall`)
  }
  const expiredSession=controlledDelayMs!==null?await evaluate(audience,'__controlledReceiver.snapshot().active.session'):null
  const start = await evaluate(audience, 'performance.timeOrigin+performance.now()')
  const deadline = await evaluate(audience, `performance.timeOrigin+${issued.permit.expiresServerMs}-${clock.offsetMs}`)
  let stalled, sourceStalled
  try {
    stalled=evaluate(audience, `(()=>{
      const context=__faultReceiveContext,before=context.currentTime,begin=performance.timeOrigin+performance.now();
      const pcmBefore=${ownedPcm?'__faultPcmContext.currentTime':'null'};
      window.__faultContextRequests=[];
      ${mode==='suspend-task-stall'?"context.suspend().catch(error=>__faultContextRequests.push({operation:'suspend',name:error.name}));"+(ownedPcm?"__faultPcmContext.suspend().catch(error=>__faultContextRequests.push({operation:'suspend',name:error.name}));":""):''}
      while(performance.timeOrigin+performance.now()<${deadline}+750){}
      const frozen=context.currentTime,resume=performance.timeOrigin+performance.now();
      const pcmFrozen=${ownedPcm?'__faultPcmContext.currentTime':'null'};
      ${mode==='suspend-task-stall'?"context.resume().catch(error=>__faultContextRequests.push({operation:'resume',name:error.name}));"+(ownedPcm?"__faultPcmContext.resume().catch(error=>__faultContextRequests.push({operation:'resume',name:error.name}));":""):''}
      const until=performance.now()+20000;while(performance.now()<until){}
      return {before,frozen,after:context.currentTime,pcmBefore,pcmFrozen,pcmAfter:${ownedPcm?'__faultPcmContext.currentTime':'null'},begin,resume,finish:performance.timeOrigin+performance.now()};
    })()`,35000)
    stalled.catch(()=>{})
    if(mode==='source-task-stall') {
      sourceStalled=evaluate(phone, `(()=>{
        const begin=performance.timeOrigin+performance.now();
        while(performance.timeOrigin+performance.now()<${deadline}+750){}
        return {begin,finish:performance.timeOrigin+performance.now()};
      })()`,15000)
      sourceStalled.catch(()=>{})
    } else await click(phone,'Stop streaming on this device')
    const recovered=await poll(async()=>{
      const current=await api(1,pathRoom);
      return current.playback.state==='recovering'&&current.playback.lease?current:false;
    },'actual room enters recovery with retained old output lease')
    check(recovered.playback.lease.safeAfterServerMs>=issued.permit.expiresServerMs+view.timing.outputMarginMs,
      `${label}: HTTP playback retains the delivered listener cutoff and safety margin`)
    if(mode!=='source-task-stall') check(recovered.playback.lease.expiresServerMs<issued.permit.expiresServerMs,
      `${label}: the built source acknowledges stopping before listener authority expires`)
    await poll(async()=>db.prepare('SELECT state FROM ktv_media_grants WHERE identity = ?').get(firstPublisher.identity)?.state==='revoked',
      'actual worker acknowledges old publisher removal')
    check(!(await provider.listParticipants(`ktv-${firstPublisher.room_id}`)).some(item=>item.identity===firstPublisher.identity),
      `${label}: the old publisher is removed from the actual SFU`)
    // This independent listener is silent until the new publisher exists. Its
    // monitor measures transmitted microphone audio during the countdown,
    // rather than waiting for the performer's later local backing output.
    await click(host,'Watch and listen')
    await poll(()=>evaluate(host,"document.querySelector('[data-party-media-status]')?.textContent.includes('Connected to the live performance')"),
      'independent replacement listener is connected before the fresh publisher')
    if(sourceStalled){
      const sourceObservation=await sourceStalled
      check(sourceObservation.begin<deadline&&sourceObservation.finish>=deadline+750,
        `${label}: the built source page cannot renew or stop before delivered output authority expires`)
      await evaluate(phone, `(()=>{
        const button=[...document.querySelectorAll('button')].find(item=>item.textContent.trim()==='Stop streaming on this device');
        if(button&&!button.disabled)button.click();
      })()`)
    }
    await poll(()=>evaluate(phone,'__micStreams.every(stream=>stream.getTracks().every(track=>track.readyState===\'ended\'))'),
      'old capture is released before explicit replacement preparation')
    await click(phone,'Enable microphone and prepare')
    await poll(()=>evaluate(phone,"document.querySelector('[data-party-media-status]')?.textContent.includes('Microphone ready')"),
      'replacement microphone is explicitly prepared')
    // Recovery keeps the selected song and advances its generation. The app
    // decodes that generation when capture is explicitly enabled again; a new
    // readiness offer/prepare command belongs to a subsequent queue turn.
    await poll(async()=>{
      const current=await api(1,pathRoom);
      return current.presence.devices.some(item=>item.id===current.playback.stageDeviceId&&item.ready&&item.readyGeneration===current.playback.generation);
    },'replacement generation is decoded by the built source')
    const ready=await api(1,pathRoom)
    if(mode!=='source-task-stall') {
      // A fast replacement preparation must remain unable to bypass the prior
      // listener reservation, even though source/provider stop was acknowledged.
      check(ready.clock.serverNowMs<recovered.playback.lease.safeAfterServerMs,
        `${label}: fresh preparation completes before the reserved silence boundary`)
      const response=await fetch(origin+'/api/ktv'+pathRoom+'/playback/start',{method:'POST',
        headers:{'Content-Type':'application/json',Authorization:'Bearer 1'},
        body:JSON.stringify({commandId:randomUUID(),clockId:ready.clock.clockId,baseRevision:ready.room.revision,
          performanceId:ready.playback.performanceId,generation:ready.playback.generation})})
      const denied=await response.json()
      check(response.status===409&&denied.code==='OUTPUT_STOPPING',
        `${label}: actual HTTP start refuses replacement before the reserved boundary`)
    }
    await poll(async()=> (await api(1,pathRoom)).clock.serverNowMs>=recovered.playback.lease.safeAfterServerMs,
      'reserved old-output boundary')
    await click(host,'Resume with countdown')
    await poll(()=>evaluate(phone,"document.querySelector('[data-party-media-status]')?.textContent.includes('Sending live singing')"),
      'replacement is provider-ready through the actual app')
    const replacement=db.prepare("SELECT * FROM ktv_media_grants WHERE scope='publisher' AND state='active'").get()
    check(replacement.identity!==firstPublisher.identity&&replacement.generation>firstPublisher.generation&&replacement.lease_id!==firstPublisher.lease_id,
      `${label}: real replacement has a fresh nonce, generation and output lease`)
    const newAudible=await poll(async()=> (await replacementBrowser.audioEvidence()).find(item=>item.audible===true&&item.time>=start),
      'independent actual replacement SFU mix output')
    const newPlayback=(await api(1,pathRoom)).playback
    const anchorWall=newPlayback.anchorServerMs+deadline-issued.permit.expiresServerMs
    check(newAudible.time+clock.uncertaintyMs+newAudible.analysisWindowMs+newAudible.fragmentMs<anchorWall,
      `${label}: replacement microphone audio is actually received before the backing countdown finishes`)
    check(await evaluate(host,"(()=>{const video=document.querySelector('[data-party-media-screen] video');return video?.muted&&video.srcObject?.getAudioTracks().length===1&&video.srcObject.getVideoTracks().length===1&&__bufferSources.length===0})()"),
      `${label}: measured replacement is the guarded SFU mix without a local backing player`)
    const observation=await stalled
    if(mode==='suspend-task-stall') check(observation.frozen-observation.before<.2,
      `${label}: the received audio render clock actually freezes`)
    if(mode==='suspend-task-stall') check(observation.after-observation.frozen>10,
      `${label}: the expired received context actually renders again while page callbacks remain blocked`)
    if(mode==='suspend-task-stall'&&ownedPcm)check(observation.pcmFrozen-observation.pcmBefore<.2&&
      observation.pcmAfter-observation.pcmFrozen>10,
      `${label}: the owned PCM context also freezes and resumes while page callbacks remain blocked`)
    check(newAudible.time<observation.finish,
      `${label}: replacement output starts while the listener page is still blocked`)
    const receiverEvidence=(await receiverBrowser.audioEvidence()).filter(item=>item.time>=start&&item.time<observation.finish)
    const quietAtNew=receiverEvidence.filter(item=>typeof item.audible==='boolean'&&item.time<=newAudible.time).at(-1)
    const afterNew=receiverEvidence.filter(item=>item.time>=newAudible.time&&(item.captureHeartbeat||typeof item.audible==='boolean'))
    const replacementEvidence=(await replacementBrowser.audioEvidence()).filter(item=>item.captureHeartbeat&&item.time>=newAudible.time&&item.time<observation.finish)
    console.log('Integrated SFU receiver fault:',JSON.stringify({mode,clock,start,deadline,issued:issued.permit,
      stoppedLease:recovered.playback.lease,newAudible,quietAtNew,observation,
      anchorWall,receiverHeartbeats:afterNew.filter(item=>item.captureHeartbeat).length,replacementHeartbeats:replacementEvidence.length,
      replacementQuietHeartbeats:replacementEvidence.filter(item=>item.rmsAmplitude<=.02).length,
      replacementMinimumRms:Math.min(...replacementEvidence.map(item=>item.rmsAmplitude)),
      replacementMaximumRms:Math.max(...replacementEvidence.map(item=>item.rmsAmplitude)),
      replacementFirstQuietMs:replacementEvidence.find(item=>item.rmsAmplitude<=.02)?.time-newAudible.time,
      replacementLastQuietMs:replacementEvidence.findLast(item=>item.rmsAmplitude<=.02)?.time-newAudible.time}))
    check(quietAtNew?.audible===false&&afterNew.filter(item=>item.captureHeartbeat).length>=5&&
      afterNew.every(item=>!(item.audible===true||item.rmsAmplitude>.005)),
      `${label}: buffered old SFU output stays silent throughout replacement and render resume`)
    check(replacementEvidence.length>=5&&replacementEvidence.every(item=>item.rmsAmplitude>.02),
      `${label}: actual replacement output stays audible during the blocked-listener observation`)
    check([quietAtNew,newAudible].every(item=>Math.abs(item.captureQueueMs)<100&&item.captureCallMs<20&&item.analysisWindowMs<24),
      `${label}: independent output captures retain their timing bounds`)
    const quietUncertainty=quietAtNew.analysisWindowMs+quietAtNew.fragmentMs+quietAtNew.captureCallMs/2+clock.uncertaintyMs
    check(quietAtNew.time+quietUncertainty<=deadline+150,
      `${label}: actual buffered output becomes silent within the unchanged 150-ms expiry margin`)
    const uncertainty=[quietAtNew,newAudible].reduce((sum,item)=>sum+item.analysisWindowMs+item.fragmentMs+item.captureCallMs/2,0)
    check(newAudible.time-quietAtNew.time-uncertainty>=view.timing.outputMarginMs,
      `${label}: actual old/new output edges preserve the configured separation`)
    await poll(()=>evaluate(audience,"document.querySelector('[data-party-media-status]')?.textContent.includes('Connected to the live performance')"),
      'audience recovers after its page resumes')
    const requests=await evaluate(audience,'({requests:__faultContextRequests,oldContextState:__faultReceiveContext.state})')
    console.log('Fixture context request outcomes:',JSON.stringify(requests))
    check(requests.requests.every(item=>item.operation==='resume'&&item.name==='InvalidStateError'&&requests.oldContextState==='closed'),
      `${label}: fixture context requests settle or are canceled by terminal app cleanup`)
    await click(phone,'Stop streaming on this device')
    await poll(async()=>db.prepare('SELECT state FROM ktv_media_grants WHERE identity = ?').get(replacement.identity)?.state==='revoked',
      'replacement publisher is revoked during fixture cleanup')
    // Every owned-PCM fault above has independently proved old-output silence,
    // deadline bounds and replacement separation. Frozen-context/page stalls
    // can also deliver stale reader callbacks after that exact session expires.
    // The final classifier still rejects early, current or unrelated closures.
    return ownedPcm?{
      expiredSession,expiredAfterUnixMs:deadline,silenceVerified:true
    }:null
  } finally {
    // Pending evaluations settle naturally within the bounded stall. Closing
    // the fixture early must not leave rejected CDP promises unobserved.
    if(sourceStalled)await sourceStalled.catch(()=>{})
    if(stalled)await stalled.catch(()=>{})
  }
}
