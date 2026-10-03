import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { CapturePcmQueue, pcmSourceWorklet } from './party-capture-pcm-queue.mjs'

const output = size => [new Float32Array(size).fill(99),new Float32Array(size).fill(99)]
test('PCM deadlines preserve channel samples, gaps and monotonic rendering across quantum boundaries',()=>{
  const consumed=[], queue=new CapturePcmQueue(48000,packet=>consumed.push(packet))
  queue.push({id:1,startFrame:2,planes:[new Float32Array([1,2,3]),new Float32Array([-1,-2,-3])]})
  queue.push({id:2,startFrame:7,planes:[new Float32Array([4,5])]})
  const first=output(4);queue.render(0,first)
  assert.deepEqual(Array.from(first[0]),[0,0,1,2]);assert.deepEqual(Array.from(first[1]),[0,0,-1,-2])
  const second=output(6);queue.render(4,second)
  assert.deepEqual(Array.from(second[0]),[3,0,0,4,5,0]);assert.deepEqual(Array.from(second[1]),[-3,0,0,4,5,0])
  assert.deepEqual(consumed,[{id:1,bytes:24},{id:2,bytes:8}])
  assert.equal(queue.snapshot().bytes,0)
  assert.throws(()=>queue.render(9,output(1)),/RENDER_CLOCK/)
})
test('48-kHz rendering preserves a continuous music waveform without resampling or packet seams',()=>{
  const queue=new CapturePcmQueue(48000), rendered=[]
  for(let packet=0;packet<50;packet++){
    const plane=Float32Array.from({length:960},(_,index)=>Math.sin(2*Math.PI*660*(packet*960+index)/48000))
    queue.push({id:packet+1,startFrame:packet*960,planes:[plane]})
    const block=output(960);queue.render(packet*960,block);rendered.push(...block[0])
    assert.deepEqual(block[0],plane);assert.deepEqual(block[1],plane)
  }
  let crossings=0;for(let i=1;i<rendered.length;i++)if(rendered[i-1]<=0&&rendered[i]>0)crossings++
  assert.equal(crossings,660)
  assert.equal(queue.snapshot().queued,0)
  assert.throws(()=>new CapturePcmQueue(44100),/RATE/)
})
test('chunk and byte ceilings reject overflow without retaining malformed or unowned memory',()=>{
  const queue=new CapturePcmQueue(48000)
  for(let i=0;i<48;i++)queue.push({id:i+1,startFrame:i,planes:[new Float32Array(1)]})
  assert.throws(()=>queue.push({id:49,startFrame:48,planes:[new Float32Array(1)]}),/BOUND/)
  assert.equal(queue.snapshot().queued,48)
  const large=new CapturePcmQueue(48000)
  for(let i=0;i<22;i++)large.push({id:i+1,startFrame:i*5760,planes:[new Float32Array(5760),new Float32Array(5760)]})
  assert.throws(()=>large.push({id:23,startFrame:22*5760,planes:[new Float32Array(5760),new Float32Array(5760)]}),/BOUND/)
  assert.ok(large.snapshot().bytes<=1024*1024)
  for(const planes of [[new Float32Array([NaN])],[new Float32Array(2),new Float32Array(1)],
    [new Float32Array(new ArrayBuffer(1048576),0,1)]]){
    const invalid=new CapturePcmQueue(48000)
    assert.throws(()=>invalid.push({id:1,startFrame:0,planes}),/FORMAT/)
    assert.equal(invalid.snapshot().bytes,0)
  }
})
test('stop releases credit once and cannot revive; worklet failure clears its final quantum',()=>{
  const consumed=[], queue=new CapturePcmQueue(48000,packet=>consumed.push(packet.id))
  queue.push({id:1,startFrame:10,planes:[new Float32Array([1])]});queue.close();queue.close()
  const block=output(4);queue.render(0,block)
  assert.ok(block.every(plane=>plane.every(value=>value===0)));assert.deepEqual(consumed,[1])
  assert.throws(()=>queue.push({id:2,startFrame:11,planes:[new Float32Array([1])]}),/CLOCK/)
  let Processor
  const messages=[], realm={Float32Array,sampleRate:48000,currentFrame:0,
    AudioWorkletProcessor:class{constructor(){this.port={postMessage:message=>messages.push(message)}}},
    registerProcessor:(name,processor)=>{Processor=processor}}
  vm.runInNewContext(`(${pcmSourceWorklet.toString()})(${CapturePcmQueue.toString()})`,realm)
  const node=new Processor()
  node.port.onmessage({data:{type:'pcm',id:1,startFrame:0,planes:[new Float32Array([1])]}})
  const first=output(2);assert.equal(node.process([], [first]),true)
  node.port.onmessage({data:{type:'pcm',id:1,startFrame:2,planes:[new Float32Array([1])]}})
  const last=output(2);assert.equal(node.process([], [last]),false)
  assert.ok(last.every(plane=>plane.every(value=>value===0)))
  assert.equal(messages.filter(message=>message.type==='silent').length,1)
})
