import test from 'node:test'
import assert from 'node:assert/strict'
import { setImmediate as tick } from 'node:timers/promises'
import { installSourceMarkerProbe } from './party-source-marker-probe.mjs'

function frame(id, { format = 'RGBA', pending = false } = {}) {
  const bits=[1,0,1,0,...Array.from({length:8},(_,i)=>id>>(7-i)&1)];bits.push(bits.slice(4).reduce((sum,bit)=>sum^bit,0))
  let finish
  return { format,codedWidth:1280,codedHeight:720,visibleRect:{x:0,y:0,width:1280,height:720},closes:0,
    close(){this.closes++},allocationSize:()=>format==='I420'?19968:53248,
    copyTo(data,{rect}){
      assert.deepEqual(rect,{x:64,y:360,width:416,height:32})
      for(let i=0;i<13;i++)data[16*1664+(i*32+16)*4]=bits[i]?255:0
      const layout=[{offset:0,stride:1664}]
      return pending?new Promise(resolve=>{finish=()=>resolve(layout)}):Promise.resolve(layout)
    },finish(){finish()} }
}
function fixture(t,{constructFailure=false}={}) {
  const previous={window:globalThis.window,processor:globalThis.MediaStreamTrackProcessor}
  t.after(()=>{globalThis.window?.__sourceMarkerProbe?.close();
    globalThis.window?.__nativeReceiverMarkerProbe?.close();
    if(previous.window===undefined)delete globalThis.window;else globalThis.window=previous.window
    if(previous.processor===undefined)delete globalThis.MediaStreamTrackProcessor;else globalThis.MediaStreamTrackProcessor=previous.processor})
  const originals=[],clones=[],readers=[]
  function track(){const original={kind:'video',readyState:'live',stops:0,stop(){this.stops++},clone(){
    const clone={stops:0,stop(){this.stops++}};clones.push(clone);return clone}};originals.push(original);return original}
  const peer={senders:[{track:track()}],getSenders(){return this.senders}}
  globalThis.window={__peers:[peer]}
  globalThis.MediaStreamTrackProcessor=class {
    constructor({maxBufferSize}){
      assert.equal(maxBufferSize,1);if(constructFailure)throw new Error('private-native-details')
      let waiting;const values=[]
      const reader={released:0,canceled:0,read(){return values.length?Promise.resolve(values.shift()):new Promise(resolve=>{waiting=resolve})},
        async cancel(){this.canceled++;if(waiting){waiting({done:true});waiting=null}},releaseLock(){this.released++},
        push(value){const packet={done:false,value};if(waiting){waiting(packet);waiting=null}else values.push(packet)}}
      readers.push(reader);this.readable={getReader:()=>reader}
    }
  }
  return {peer,originals,clones,readers,track,get probe(){return globalThis.window.__sourceMarkerProbe}}
}
test('publisher probe counts raw RGB marker order, scopes one clone and leaves original publishing track live',async t=>{
  const f=fixture(t);installSourceMarkerProbe(async()=>({valid:true,id:0}))
  const frames=[frame(0),frame(1),frame(0),frame(1)]
  for(const value of frames)f.readers[0].push(value)
  await tick();assert.deepEqual(f.probe.snapshot(),{closed:false,error:null,reads:4,invalid:0,transitions:3,regressions:1,maximumCopyBytes:53248})
  assert.ok(frames.every(value=>value.closes===1));assert.equal(f.originals[0].stops,0)
  installSourceMarkerProbe(async()=>({valid:false}));assert.equal(f.clones.length,1)
  f.peer.senders=[{track:f.track()}];installSourceMarkerProbe(async()=>({valid:false}));await tick()
  assert.equal(f.clones[0].stops,1);assert.equal(f.readers[0].released,1);assert.equal(f.originals[0].stops,0)
  f.probe.close();await tick();assert.equal(f.clones[1].stops,1);assert.equal(f.originals[1].stops,0)
})
test('stop during borrowed pixel copy closes once and suppresses late diagnostic results',async t=>{
  const f=fixture(t);installSourceMarkerProbe(async()=>({valid:false}))
  const value=frame(0,{pending:true});f.readers[0].push(value);await tick()
  f.probe.close();assert.equal(value.closes,1);value.finish();await tick()
  assert.equal(value.closes,1);assert.equal(f.probe.snapshot().reads,0);assert.equal(f.readers[0].released,1)
})
test('unsupported source formats and processor construction failures clean owned resources without raw errors',async t=>{
  const f=fixture(t);installSourceMarkerProbe(async()=>({valid:false}))
  const value=frame(0,{format:'private-format'});f.readers[0].push(value);await tick()
  assert.equal(f.probe.snapshot().error,'SOURCE_MARKER_READ');assert.equal(value.closes,1);assert.equal(f.clones[0].stops,1)
  assert.equal(JSON.stringify(f.probe.snapshot()).includes('private'),false)
})
test('YUV source reads share the checked diagnostic and report actual bounded copy allocation',async t=>{
  const f=fixture(t);let calls=0
  installSourceMarkerProbe(async value=>{assert.equal(value.format,'I420');calls++;return {valid:false}})
  const value=frame(0,{format:'I420'});f.readers[0].push(value);await tick()
  assert.equal(calls,1);assert.equal(f.probe.snapshot().invalid,1);assert.equal(f.probe.snapshot().maximumCopyBytes,19968)
  assert.equal(value.closes,1);f.probe.close()
})
test('failed native processor creation stops only the private clone',t=>{
  const f=fixture(t,{constructFailure:true})
  assert.throws(()=>installSourceMarkerProbe(async()=>({valid:false})),/^Error: SOURCE_MARKER_PROCESSOR$/)
  assert.equal(f.clones[0].stops,1);assert.equal(f.originals[0].stops,0)
})
test('native receiver probe samples only the received track and keeps publisher diagnostics separate',async t=>{
  const f=fixture(t), received=f.track()
  f.peer.getReceivers=()=>[{track:received}]
  installSourceMarkerProbe(async()=>({valid:false}))
  installSourceMarkerProbe(async()=>({valid:false}),'native-receiver')
  const source=frame(2), native=frame(1)
  f.readers[0].push(source);f.readers[1].push(native);await tick()
  assert.equal(f.probe.snapshot().reads,1)
  const receiver=window.__nativeReceiverMarkerProbe
  assert.equal(receiver.sameSource(received),true);assert.equal(receiver.sameSource(f.originals[0]),false)
  assert.equal(receiver.snapshot().reads,1)
  installSourceMarkerProbe(async()=>({valid:false}),'native-receiver');assert.equal(f.clones.length,2)
  receiver.close();await tick();assert.equal(f.probe.snapshot().closed,false)
  assert.equal(received.stops,0);assert.equal(source.closes,1);assert.equal(native.closes,1)
  assert.throws(()=>installSourceMarkerProbe(async()=>({valid:false}),'unknown'),/^Error: SOURCE_MARKER_ROLE$/)
})
