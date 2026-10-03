// Owned native worklet/output test. Synthetic PCM stays on the remote browser;
// only numeric output evidence returns. This is not physical or SFU acceptance.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import http from 'node:http'
import { once } from 'node:events'
import WebSocket from '../server/node_modules/ws/wrapper.mjs'
import { createOwnedRemoteBrowser } from './party-remote-browser.mjs'
import { CapturePcmQueue, pcmSourceWorklet } from './party-capture-pcm-queue.mjs'

const mode=process.env.KTV_PCM_RENDER_FAULT || 'task-stall'
assert.ok(['task-stall','suspend-task-stall'].includes(mode),'Unknown native PCM output fault')
const guardLifetime=process.env.KTV_PCM_GUARD_LIFETIME || 'production'
assert.ok(['production','persistent-silence'].includes(guardLifetime),'Unknown private guard lifetime experiment')
const outputGraph=process.env.KTV_PCM_OUTPUT_GRAPH || 'same-context'
assert.ok(['same-context','separate-context'].includes(outputGraph),'Unknown private PCM output graph')
let guardSource=await fs.readFile('src/services/partyLeaseGuard.worklet.js','utf8')
if(guardLifetime==='persistent-silence') {
  // Hypothesis only: keep clearing every quantum after failure instead of
  // ending processor lifetime. The production source remains untouched.
  assert.equal(guardSource.split('    return alive\n').length,2,'Guard experiment must replace exactly the process return')
  guardSource=guardSource.replace('    return alive\n','    return true\n')
}
const modules={
  '/pcm.js':`(${pcmSourceWorklet.toString()})(${CapturePcmQueue.toString()});`,
  '/guard.js':guardSource,
  '/stream.js':await fs.readFile('scripts/party-opus-pcm-stream.mjs','utf8'),
  '/payload.js':await fs.readFile('scripts/party-opus-decode-probe.mjs','utf8'),
}
const connections=new Set(), server=http.createServer((req,res)=>{
  res.setHeader('Cache-Control','no-store')
  if(modules[req.url]) {res.setHeader('Content-Type','text/javascript');res.end(modules[req.url])}
  else {res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Owned PCM output fixture</title>')}
})
server.on('connection',connection=>{connections.add(connection);connection.once('close',()=>connections.delete(connection))})
let browser,socket,session,contextId,nextId=0,passed=0
const pending=new Map(),errors=[]
function cdp(method,params={},sessionId) {
  return new Promise((resolve,reject)=>{
    const id=++nextId,timer=setTimeout(()=>{pending.delete(id);reject(new Error('PCM_CDP_TIMEOUT'))},15000)
    pending.set(id,{resolve(value){clearTimeout(timer);resolve(value)},reject(error){clearTimeout(timer);reject(error)}})
    socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}))
  })
}
async function evaluate(expression) {
  const result=await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true},session)
  if(result.exceptionDetails)throw new Error('PCM_BROWSER_EXCEPTION')
  return result.result.value
}
async function poll(work,label,timeout=10000) {
  const end=Date.now()+timeout
  while(Date.now()<end){const value=await work();if(value)return value;await new Promise(resolve=>setTimeout(resolve,50))}
  throw new Error(`PCM_TIMEOUT_${label}`)
}
function check(value,label){assert.ok(value,label);passed++;console.log('PASS',label)}
try {
  server.listen(0,'127.0.0.1');await once(server,'listening')
  browser=await createOwnedRemoteBrowser({host:process.env.KTV_ROOM_TEST_SSH_HOST,knownHosts:process.env.KTV_ROOM_TEST_KNOWN_HOSTS,
    frontendPort:server.address().port,debugPort:9243,isolatedOutput:true,captureActivity:true})
  const info=await(await fetch(browser.debuggerUrl+'/json/version')).json()
  console.log('Owned PCM native browser:',info.Browser,'; guard lifetime:',guardLifetime)
  socket=new WebSocket(info.webSocketDebuggerUrl);await once(socket,'open')
  socket.on('message',raw=>{
    const message=JSON.parse(raw)
    if(message.id){const item=pending.get(message.id);if(!item)return;pending.delete(message.id);
      message.error?item.reject(new Error('PCM_CDP_ERROR')):item.resolve(message.result)}
    else if(message.method==='Runtime.exceptionThrown')errors.push('PCM_RUNTIME_EXCEPTION')
  })
  ;({browserContextId:contextId}=await cdp('Target.createBrowserContext'))
  const {targetId}=await cdp('Target.createTarget',{browserContextId:contextId,url:`http://127.0.0.1:${server.address().port}`})
  ;({sessionId:session}=await cdp('Target.attachToTarget',{targetId,flatten:true}))
  await cdp('Runtime.enable',{},session)
  await poll(()=>evaluate('document.readyState==="complete"'),'PAGE')
  await poll(async()=>(await browser.audioEvidence()).some(row=>row.ready),'DETECTOR')
  const timing=await evaluate(`(async()=>{
    window.context=new AudioContext({sampleRate:48000});await context.resume();
    await context.audioWorklet.addModule('/pcm.js');await context.audioWorklet.addModule('/guard.js');
    window.outputContext=${outputGraph==='separate-context'?'new AudioContext()':'context'};
    if(outputContext!==context){await outputContext.resume();await outputContext.audioWorklet.addModule('/guard.js')}
    const {createOpusPcmStream}=await import('/stream.js');
    const {primaryOpusPayload,opusPacketFrames}=await import('/payload.js');
    const encoded=[];let encodedBytes=0;
    const encoder=new AudioEncoder({output:chunk=>{
      if(encoded.length>=48||encodedBytes+chunk.byteLength>512*1024)throw new Error('PCM_ENCODER_BOUND');
      const bytes=new Uint8Array(chunk.byteLength);chunk.copyTo(bytes);encoded.push(bytes);encodedBytes+=bytes.byteLength;
    },error:()=>{throw new Error('PCM_ENCODER_ERROR')}});
    encoder.configure({codec:'opus',sampleRate:48000,numberOfChannels:2,bitrate:64000});
    for(let packet=0;packet<45;packet++){
      const data=new Float32Array(1920);
      for(let channel=0;channel<2;channel++)for(let sample=0;sample<960;sample++)
        data[channel*960+sample]=.15*Math.sin((packet*960+sample)*2*Math.PI*440/48000);
      const frame=new AudioData({format:'f32-planar',sampleRate:48000,numberOfFrames:960,numberOfChannels:2,timestamp:packet*20000,data});
      encoder.encode(frame);frame.close();
    }
    await encoder.flush();encoder.close();
    if(encoded.length<45)throw new Error('PCM_ENCODER_PACKETS');
    await new Promise(resolve=>setTimeout(resolve,500));
    window.start=Date.now();window.expiry=start+600;window.credits=[];window.silent=[];
    window.source=new AudioWorkletNode(context,'party-owned-pcm',{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[2]});
    window.guard=new AudioWorkletNode(outputContext,'party-lease-guard',{outputChannelCount:[2],processorOptions:{expiry}});
    source.port.onmessage=({data})=>{credits.push(data);if(data.type==='consumed')stream.consumed(data)};
    guard.port.onmessage=({data})=>silent.push(data);
    if(outputContext===context)source.connect(guard);
    else {
      window.pcmCapture=context.createMediaStreamDestination();source.connect(pcmCapture);
      window.finalInput=outputContext.createMediaStreamSource(pcmCapture.stream);finalInput.connect(guard);
    }
    guard.connect(outputContext.destination);
    const first=Math.ceil(context.currentTime*48000)+4800;
    const capture=performance.now();window.streamReports=[];self.__encodedTimingCodecs=[{payloadType:111,mimeType:'audio/opus'}];
    window.stream=createOpusPcmStream(primaryOpusPayload,opusPacketFrames,packet=>{
      source.port.postMessage({type:'pcm',id:packet.id,startFrame:first+Math.round((packet.captureUnixMs-performance.timeOrigin-capture)*48),
        planes:packet.planes},packet.planes.map(plane=>plane.buffer));
    },row=>streamReports.push(row));
    for(let packet=0;packet<45;packet++){
      stream.observe({timestamp:packet*960,data:encoded[packet].buffer},{captureTime:capture+packet*20,payloadType:111});
    }
    return {start,expiry,rate:context.sampleRate,queuedFrames:45*960,queueEndMs:start+(first/48000-context.currentTime)*1000+900};
  })()`)
  check(timing.rate===48000&&timing.queuedFrames===43200,'native PCM worklet receives 900 ms at the required 48-kHz rate')
  try {await poll(async()=>(await browser.audioEvidence()).some(row=>row.captureHeartbeat&&row.time>timing.start&&row.onAmplitude>.02),'AUDIBLE',1500)}
  catch(error){
    const state=await evaluate('({state:context.state,render:context.currentTime,latency:context.outputLatency,credits:credits.length,sourceSilent:credits.some(row=>row.type==="silent"),guard:silent})')
    const rows=(await browser.audioEvidence()).filter(row=>row.captureHeartbeat&&row.time>=timing.start)
    console.log('Native PCM startup diagnostic:',JSON.stringify({state,samples:rows.length,maximumRms:Math.max(0,...rows.map(row=>row.rmsAmplitude)),
      maximumQueueMs:Math.max(0,...rows.map(row=>row.captureQueueMs)),maximumTone:Math.max(0,...rows.map(row=>row.onAmplitude))}))
    throw error
  }
  check(Date.now()<timing.expiry,'actual native output contains the tone before expiry')
  const stalled=await evaluate(`(async()=>{const before=context.currentTime,outputBefore=outputContext.currentTime;
    ${mode==='suspend-task-stall'?'await context.suspend();':''}
    const suspended=context.currentTime;while(Date.now()<expiry+2500){};
    const frozen=context.currentTime;
    ${mode==='suspend-task-stall'?'await context.resume();const until=Date.now()+1500;while(Date.now()<until){};':''}
    return {before,suspended,frozen,after:context.currentTime,outputBefore,outputAfter:outputContext.currentTime,finish:Date.now()};})()`)
  if(mode==='suspend-task-stall')check(stalled.frozen-stalled.suspended<.1&&stalled.after-stalled.frozen>.7,
    'native render clock actually freezes and resumes after lease expiry')
  else check(stalled.after-stalled.before>.7,'audio render thread continues while the page task is blocked')
  if(outputGraph==='separate-context')check(stalled.outputAfter-stalled.outputBefore>2.5,
    'separate final output context keeps rendering while only the PCM context freezes')
  await new Promise(resolve=>setTimeout(resolve,250))
  const evidence=await browser.audioEvidence()
  const late=evidence.filter(row=>row.captureHeartbeat&&row.time>timing.expiry+150&&row.time<=stalled.finish)
  const lateActivity=evidence.filter(row=>row.time>timing.expiry+150&&row.time<=stalled.finish&&
    (row.audible===true||row.onAmplitude>.015||row.rmsAmplitude>.015))
  const boundary=evidence.filter(row=>typeof row.audible==='boolean'&&row.time<=timing.expiry+150).at(-1)
  console.log('Native PCM expiry diagnostic:',JSON.stringify({lateSamples:late.length,boundaryAudible:boundary?.audible,
    activityEdges:evidence.filter(row=>typeof row.audible==='boolean'&&row.time>=timing.start)
      .map(row=>({offsetMs:row.time-timing.expiry,audible:row.audible})),
    state:await evaluate('({render:context.currentTime,latency:context.outputLatency,baseLatency:context.baseLatency,guard:silent,consumed:credits.filter(row=>row.type==="consumed").length})')}))
  check(late.length>=2&&boundary?.audible===false,'independent output detector observes silence by expiry plus 150 ms')
  check(lateActivity.length===0,'queued PCM stays silent after expiry including short output bursts between heartbeats')
  check(await evaluate('silent.length===1&&silent[0].type==="silent"'),'existing downstream lease guard latches silence once')
  check(await evaluate('credits.filter(row=>row.type==="consumed").length===45'),'native PCM renderer releases every queued chunk')
  check(await evaluate('!stream.snapshot().closed&&stream.snapshot().decoded===45&&stream.snapshot().chunks===0&&stream.snapshot().pcmBytes===0&&stream.snapshot().encodedBytes===0'),
    'native Opus decoder transfers all PCM through renderer credits without retained packets')
  console.log('Native PCM output summary:',JSON.stringify({mode,guardLifetime,outputGraph,rate:timing.rate,queuedFrames:timing.queuedFrames,
    postExpirySamples:late.length,maximumPostExpiryRms:Math.max(...late.map(row=>row.rmsAmplitude)),
    renderAdvanceMs:(stalled.after-stalled.before)*1000}))
  await evaluate("stream.close();source.port.postMessage({type:'stop'});source.disconnect();guard.disconnect();window.finalInput?.disconnect();window.pcmCapture?.stream.getTracks().forEach(track=>track.stop());if(outputContext!==context)outputContext.close();context.close()")
  check(errors.length===0,'native worklet fixture completes without runtime exceptions')
  console.log(`${passed} native PCM output checks passed; physical and SFU integration remain open`)
} finally {
  if(socket?.readyState===WebSocket.OPEN&&contextId)await cdp('Target.disposeBrowserContext',{browserContextId:contextId}).catch(()=>{})
  socket?.close();for(const item of pending.values())item.reject(new Error('PCM_FIXTURE_CLOSED'));pending.clear()
  try{await browser?.close()}finally{for(const connection of connections)connection.destroy();
    if(server.listening)await new Promise(resolve=>server.close(resolve))}
}
