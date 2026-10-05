import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import {createPcmBufferScheduler,isOwnedPcmBufferSource} from './party-pcm-buffer-scheduler.mjs'

function fixture(){
  const sources=[],buffers=[],messages=[]
  const context={sampleRate:44100,currentTime:1,destination:{},
    createBuffer(numberOfChannels,length,sampleRate){const planes=Array.from({length:numberOfChannels},()=>new Float32Array(length))
      const buffer={numberOfChannels,length,sampleRate,planes,copyToChannel(data,index){planes[index].set(data)}};buffers.push(buffer);return buffer},
    createBufferSource(){const source={buffer:null,playbackRate:{value:1},detune:{value:0},connections:[],starts:[],stops:0,
      connect(value){this.connections.push(value)},disconnect(){this.connections=[]},start(...values){this.starts.push(values)},stop(){this.stops++}}
      sources.push(source);return source}}
  const node={context,__partyOwnedPcmSink:true}
  class Port{postMessage(data){messages.push(data)}start(){}close(){this.closed=true}}
  const port=new Port(),realm={MessagePort:Port,Float32Array,Array,Map,Number,Object,performance:{now:()=>1000}}
  const make=vm.runInNewContext('('+createPcmBufferScheduler.toString()+')',realm),scheduler=make(context,node,port)
  const send=(id,startFrame,frames=960,changes={})=>{
    const data={type:'pcm',id,startFrame,planes:[new Float32Array(frames).fill(.25),new Float32Array(frames).fill(-.5)],creditBytes:frames*16,...changes}
    port.onmessage({data});return data
  }
  return {context,node,port,scheduler,sources,buffers,messages,send}
}
test('native buffers preserve samples, rate, capture schedule and the sole guarded sink until actual completion',()=>{
  const f=fixture(),data=f.send(1,60000,1920),source=f.sources[0]
  assert.equal(f.context.sampleRate,44100);assert.equal(source.buffer.sampleRate,48000)
  assert.ok(source.buffer.planes[0].every(value=>value===.25));assert.ok(source.buffer.planes[1].every(value=>value===-.5))
  assert.deepEqual(source.starts[0],[1.25,0,.04]);assert.deepEqual(source.connections,[f.node])
  assert.equal(data.planes.length,0);assert.equal(f.messages.length,0)
  assert.equal(f.scheduler.snapshot().bytes,30720);assert.equal(f.scheduler.snapshot().maximumBytes,76800)
  assert.equal(f.scheduler.snapshot().bufferedFrames,1920)
  source.onended();assert.deepEqual({...f.messages[0]},{type:'consumed',id:1,bytes:30720})
  assert.equal(source.buffer,null);assert.equal(f.scheduler.snapshot().bytes,0)
  f.scheduler.close();assert.equal(f.port.closed,true)
})
test('late native buffers skip elapsed content and account for fully late samples without replaying their audio',()=>{
  const f=fixture();f.send(1,46080)
  assert.equal(f.sources.length,0);assert.equal(f.scheduler.snapshot().latePackets,1)
  assert.equal(f.messages[0].bytes,15360)
  f.send(2,47520);assert.equal(f.sources[0].starts[0][0],1)
  assert.ok(Math.abs(f.sources[0].starts[0][1]-.01)<1e-10);assert.ok(Math.abs(f.sources[0].starts[0][2]-.01)<1e-10)
  assert.equal(f.scheduler.snapshot().trimmedFrames,480)
  assert.equal(f.scheduler.snapshot().bufferedFrames,480);f.scheduler.close()
})
test('stalled completion stays within credit and copy reservations and closes every native source without forged returns',()=>{
  const f=fixture();for(let i=1;i<=49;i++)f.send(i,60000+(i-1)*960)
  assert.equal(f.scheduler.snapshot().closed,true);assert.equal(f.scheduler.snapshot().error,'PLAYOUT_PCM_BUFFER_BOUND')
  assert.equal(f.scheduler.snapshot().maximumQueued,48);assert.ok(f.scheduler.snapshot().maximumBytes<=1024*1024)
  assert.ok(f.sources.every(source=>source.stops===1&&source.buffer===null&&source.connections.length===0))
  assert.equal(f.messages.filter(item=>item.type==='consumed').length,0);assert.equal(f.scheduler.snapshot().bytes,0)
  f.send(50,110000);assert.equal(f.sources.length,48)
})
test('maximal native buffers reach the original byte cap before extra copy or source allocation',()=>{
  const f=fixture();for(let i=1;i<=12;i++)f.send(i,60000+(i-1)*5760,5760)
  assert.equal(f.scheduler.snapshot().error,'PLAYOUT_PCM_BUFFER_BOUND');assert.equal(f.sources.length,10)
  assert.equal(f.scheduler.snapshot().maximumBytes,967680);assert.equal(f.buffers.length,10)
})
test('invalid credits, overlap, NaN and frame dimensions close before an unsafe native allocation',()=>{
  for(const changes of [{creditBytes:7680},{planes:[new Float32Array([NaN])]},{startFrame:1.5}]){
    const f=fixture();f.send(1,60000,960,changes)
    assert.equal(f.scheduler.snapshot().closed,true);assert.equal(f.buffers.length,0)
  }
  const overlap=fixture();overlap.send(1,60000);overlap.send(2,60001)
  assert.equal(overlap.scheduler.snapshot().error,'PLAYOUT_PCM_BUFFER_CLOCK');assert.equal(overlap.sources.length,1)
})
test('terminal closure removes callbacks and delayed completion cannot duplicate credit or revive sources',()=>{
  const f=fixture();f.send(1,60000);const callback=f.sources[0].onended
  f.scheduler.close();callback();f.send(2,60960)
  assert.equal(f.sources.length,1);assert.equal(f.messages.filter(row=>row.type==='consumed').length,0)
  assert.equal(f.sources[0].onended,null);assert.equal(f.sources[0].buffer,null)
})
test('upstream stops preserve only fixed diagnostic causes and close all sources without returning stale credits',()=>{
  for(const reason of [undefined,null,'PCM_BOUND','PCM_PORT_CLOCK','PCM_CREDIT']){
    const f=fixture();f.send(1,60000);f.port.onmessage({data:{type:'stop',reason}})
    assert.equal(f.scheduler.snapshot().closed,true);assert.equal(f.scheduler.snapshot().error,null)
    assert.equal(f.scheduler.snapshot().upstreamReason,reason??null)
    assert.equal(f.scheduler.snapshot().bytes,0);assert.equal(f.messages.filter(row=>row.type==='consumed').length,0)
    assert.equal(f.sources[0].buffer,null)
  }
  const invalid=fixture();invalid.port.onmessage({data:{type:'stop',reason:'secret-token'}})
  assert.equal(invalid.scheduler.snapshot().error,'PLAYOUT_PCM_BUFFER_FORMAT')
  assert.equal(JSON.stringify(invalid.scheduler.snapshot()).includes('secret-token'),false)
})
test('graph evidence rejects markers on backing, cross-context or direct hardware sources',()=>{
  const context={destination:{}},sink={context,__partyOwnedPcmSink:true}
  const source={__partyOwnedPcmSource:true,__partyOwnedPcmSink:sink,__state:{context,connections:[sink],ended:false}}
  assert.equal(isOwnedPcmBufferSource(source),true)
  assert.equal(isOwnedPcmBufferSource({...source,__partyOwnedPcmSource:false}),false)
  assert.equal(isOwnedPcmBufferSource({...source,__state:{context,connections:[context.destination],ended:false}}),false)
  assert.equal(isOwnedPcmBufferSource({...source,__state:{context:{destination:{}},connections:[sink],ended:false}}),false)
})
