import test from 'node:test'
import assert from 'node:assert/strict'
import {createVideoReferenceEnvelope} from './party-video-reference-envelope.mjs'

function frame(type='key',size=20){
  const bytes=new Uint8Array(size);bytes[0]=type==='key'?0:1
  if(type==='key')bytes.set([0x9d,1,0x2a,0,5,0xd0,2],3)
  for(let i=10;i<size;i++)bytes[i]=i&255
  return {type,data:bytes.buffer}
}
test('actual sender declarations round trip without changing codec bytes or leaving the original payload live',()=>{
  const sender=createVideoReferenceEnvelope(),receiver=createVideoReferenceEnvelope()
  for(const [type,frameId,dependencies] of [['key',1,[]],['delta',2,[1]],['delta',Number.MAX_SAFE_INTEGER,[1,2]]]){
    const f=frame(type),original=f.data,before=new Uint8Array(original).slice()
    sender.wrap(f,{frameId,dependencies});assert.equal(original.byteLength,0)
    const wire=f.data;assert.deepEqual(new Uint8Array(wire,0,before.length),before)
    assert.deepEqual(receiver.unwrap(f),{frameId,dependencies,sourceReferences:true})
    assert.equal(wire.byteLength,0);assert.deepEqual(new Uint8Array(f.data),before)
  }
  assert.equal(sender.snapshot().wrapped,3);assert.equal(receiver.snapshot().unwrapped,3)
  assert.equal(sender.snapshot().maximumTrailerBytes,46)
})
test('source declarations require real bounded ordered references and valid nominal VP8 headers',()=>{
  for(const [type,metadata] of [['delta',{frameId:2,dependencies:[]}],['key',{frameId:2,dependencies:[1]}],
    ['delta',{frameId:2,dependencies:[2]}],['delta',{frameId:2,dependencies:[1,1]}],
    ['delta',{frameId:NaN,dependencies:[1]}],['delta',{frameId:10,dependencies:Array.from({length:9},(_,i)=>i)}]]){
    const e=createVideoReferenceEnvelope(),f=frame(type),original=f.data
    assert.throws(()=>e.wrap(f,metadata),/VIDEO_ENVELOPE_REFERENCE/)
    assert.equal(original.byteLength,20);assert.equal(e.snapshot().closed,true)
  }
  const malformed=frame();new Uint8Array(malformed.data)[3]=0
  assert.throws(()=>createVideoReferenceEnvelope().wrap(malformed,{frameId:1,dependencies:[]}),/VIDEO_ENVELOPE_CODEC/)
})
test('total frame budget includes the full trailer and failures occur before transfer',()=>{
  const e=createVideoReferenceEnvelope(),f=frame('delta',256*1024-94)
  e.wrap(f,{frameId:9,dependencies:[0,1,2,3,4,5,6,7]})
  assert.equal(f.data.byteLength,256*1024);assert.equal(e.snapshot().maximumBytes,256*1024)
  const rejected=frame('delta',256*1024-93),original=rejected.data
  assert.throws(()=>createVideoReferenceEnvelope().wrap(rejected,{frameId:9,dependencies:[0,1,2,3,4,5,6,7]}),/VIDEO_ENVELOPE_BOUND/)
  assert.equal(original.byteLength,256*1024-93)
})
test('payload corruption, missing trailers and malformed headers fail closed without stripping or inventing references',()=>{
  for(const corrupt of [bytes=>{bytes[11]^=1},bytes=>{bytes[bytes.length-1]^=1},
    bytes=>{bytes[24]=255},bytes=>{bytes[27]=1},bytes=>{bytes[26]=9}]){
    const f=frame(),sender=createVideoReferenceEnvelope(),receiver=createVideoReferenceEnvelope()
    sender.wrap(f,{frameId:1,dependencies:[]});corrupt(new Uint8Array(f.data));const wire=f.data
    assert.throws(()=>receiver.unwrap(f),/VIDEO_ENVELOPE_/)
    assert.equal(receiver.snapshot().closed,true);assert.equal(wire.byteLength,50)
    assert.throws(()=>receiver.unwrap(frame()),/VIDEO_ENVELOPE_/)
  }
  assert.throws(()=>createVideoReferenceEnvelope().unwrap(frame()),/VIDEO_ENVELOPE_FORMAT/)
})
test('snapshots contain fixed scalars only and unsupported transfer capability or explicit closure cannot revive',()=>{
  const e=createVideoReferenceEnvelope(),f=frame();Object.defineProperty(f.data,'transferToFixedLength',{value:undefined})
  assert.throws(()=>e.wrap(f,{frameId:1,dependencies:[],token:'secret-token'}),/VIDEO_ENVELOPE_INPUT/)
  assert.equal(JSON.stringify(e.snapshot()).includes('secret-token'),false)
  const closed=createVideoReferenceEnvelope();closed.close()
  assert.throws(()=>closed.wrap(frame(),{frameId:1,dependencies:[]}),/VIDEO_ENVELOPE_CLOSED/)
})
test('checksums bind reference declarations as well as codec bytes, without asserting cryptographic authentication',()=>{
  const f=frame('delta'),e=createVideoReferenceEnvelope();e.wrap(f,{frameId:3,dependencies:[1]})
  new DataView(f.data).setFloat64(20+24,2)
  assert.throws(()=>createVideoReferenceEnvelope().unwrap(f),/VIDEO_ENVELOPE_INTEGRITY/)
})
test('a rejected native data assignment closes the primitive and cannot expose arbitrary failure details',()=>{
  const original=frame(),data=original.data,e=createVideoReferenceEnvelope()
  Object.defineProperty(original,'data',{get:()=>data,set(){throw new Error('secret-token')}})
  assert.throws(()=>e.wrap(original,{frameId:1,dependencies:[]}),/VIDEO_ENVELOPE_TRANSFER/)
  assert.equal(e.snapshot().closed,true);assert.equal(e.snapshot().error,'VIDEO_ENVELOPE_TRANSFER')
  assert.equal(JSON.stringify(e.snapshot()).includes('secret-token'),false)
})
test('one source cannot double-wrap or reverse its declarations, while actual received reordering remains available to the decoder',()=>{
  const sender=createVideoReferenceEnvelope(),receiver=createVideoReferenceEnvelope(),key=frame(),delta=frame('delta')
  sender.wrap(key,{frameId:1,dependencies:[]});sender.wrap(delta,{frameId:2,dependencies:[1]})
  assert.equal(receiver.unwrap(delta).frameId,2);assert.equal(receiver.unwrap(key).frameId,1)
  const duplicate=createVideoReferenceEnvelope(),f=frame();duplicate.wrap(f,{frameId:1,dependencies:[]})
  const wire=f.data
  assert.throws(()=>duplicate.wrap(f,{frameId:1,dependencies:[]}),/VIDEO_ENVELOPE_REFERENCE/)
  assert.equal(wire.byteLength,50)
})
