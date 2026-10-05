import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { bindOpusPcmPort } from './party-opus-pcm-port.mjs'

function fixture(overrides={}) {
  let wall=1000,mono=0,interval,decoder,report,options
  const packets=[],messages=[],credits=[],closes=[]
  class Port {postMessage(data,transfer){messages.push({data,transfer})}start(){}close(){this.closed=true}}
  const port=new Port()
  const factory=(primary,frames,deliver,onClose,configuration)=>{
    options=configuration
    report=onClose
    decoder={observe(){deliver(packets.shift())},consumed:credit=>credits.push(credit),
      close(reason){if(this.closed)return;this.closed=true;closes.push(reason);report()},snapshot(){return {closed:!!this.closed}}}
    return decoder
  }
  const realm={MessagePort:Port,Date:{now:()=>wall},performance:{now:()=>mono},
    setInterval:callback=>{interval=callback;return 1},clearInterval:()=>{interval=null}}
  const bind=vm.runInNewContext(`(${bindOpusPcmPort.toString()})`,realm)
  const config={port,renderFrame:48000,wallUnixMs:1000,delayMs:800,expiryUnixMs:2000,...overrides}
  const adapter=bind(factory,()=>{},()=>{},config)
  return {adapter,port,packets,messages,credits,closes,options,advance(w,m){wall=w;mono=m;interval?.()},report:()=>report()}
}
test('worker channel schedules capture time into render frames and transfers owned planes directly',()=>{
  const f=fixture(),plane=new Float32Array([.5])
  f.packets.push({id:1,captureUnixMs:1010,planes:[plane]});f.adapter.observe({}, {})
  assert.equal(f.messages[0].data.startFrame,86880)
  assert.equal(f.messages[0].transfer[0],plane.buffer)
  f.port.onmessage({data:{type:'consumed',id:1,bytes:4}})
  assert.deepEqual(f.credits,[{type:'consumed',id:1,bytes:4}]);f.adapter.close()
  assert.equal(f.port.closed,true);assert.equal(f.closes.length,1)
})

test('explicit concealment reaches the decoder without changing scheduling or allowing unsupported configuration',()=>{
  const f=fixture({plc:true,batchPackets:2});assert.equal(f.options.plc,true)
  assert.equal(f.options.batchPackets,2)
  f.packets.push({id:1,captureUnixMs:1010,planes:[new Float32Array([.5])]});f.adapter.observe({}, {})
  assert.equal(f.messages[0].data.startFrame,86880);f.adapter.close()
  assert.throws(()=>fixture({plc:'yes'}),/PCM_PORT_CONFIG/)
})

test('shared-context scheduling retains the capture mapping and transfers doubled consumption credits',()=>{
  const f=fixture({renderer:'buffers'}),planes=[new Float32Array([.5])]
  assert.equal(f.options.creditScale,2)
  f.packets.push({id:1,captureUnixMs:1010,planes,creditBytes:8});f.adapter.observe({}, {})
  assert.equal(f.messages[0].data.startFrame,86880);assert.equal(f.messages[0].data.creditBytes,8)
  f.port.onmessage({data:{type:'consumed',id:1,bytes:8}});assert.equal(f.credits[0].bytes,8)
  f.adapter.close();assert.throws(()=>fixture({renderer:'unknown'}),/PCM_PORT_CONFIG/)
})
test('expired or discontinuous worker clocks close the renderer port and cannot renew it',()=>{
  for(const values of [[2000,1000],[999,1],[1400,1]]){
    const f=fixture();f.advance(...values)
    assert.equal(f.adapter.snapshot().closed,true);assert.equal(f.port.closed,true)
    f.port.onmessage({data:{type:'renew',expiryUnixMs:9000}})
    assert.equal(f.closes.length,1);assert.equal(f.messages.at(-1).data.type,'stop')
  }
})
test('bounded valid renewal extends decoding; invalid controls and malformed mapping fail closed',()=>{
  const f=fixture();f.port.onmessage({data:{type:'renew',expiryUnixMs:3000}})
  f.advance(2100,1100);assert.equal(f.adapter.snapshot().closed,false)
  f.port.onmessage({data:{type:'renew',expiryUnixMs:2000}})
  assert.equal(f.adapter.snapshot().closed,true)
  for(const overrides of [{delayMs:1000},{expiryUnixMs:11001},{wallUnixMs:749},{renderFrame:-1},{batchPackets:3}])assert.throws(()=>fixture(overrides),/PCM_PORT_CONFIG/)
})
test('two-packet grouping reaches the decoder without changing capture mapping or expiry',()=>{
  const f=fixture({batchPackets:2}),plane=new Float32Array(1920)
  assert.equal(f.options.batchPackets,2)
  f.packets.push({id:2,captureUnixMs:1010,planes:[plane]});f.adapter.observe({}, {})
  assert.equal(f.messages[0].data.startFrame,86880);assert.equal(f.messages[0].data.id,2)
  f.advance(2000,1000);assert.equal(f.adapter.snapshot().closed,true)
  assert.equal(f.port.closed,true);assert.equal(f.adapter.renew(3000),false)
})
