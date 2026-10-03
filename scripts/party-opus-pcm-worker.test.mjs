import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { installOpusPcmWorker } from './party-opus-pcm-worker.mjs'

test('only explicit receiver binding starts copied decoding and a closed adapter clears diagnostics',()=>{
  const messages=[],bindings=[],observed=[]
  let receive,timer,cleared=0,closed=false
  const realm={__encodedTimingDirection:'send',postMessage:row=>messages.push(row),
    addEventListener:(type,listener)=>{assert.equal(type,'message');receive=listener},
    setInterval:callback=>{timer=callback;return 1},clearInterval:()=>{cleared++}}
  realm.self=realm
  const bind=(...args)=>{bindings.push(args);return {observe:(frame,metadata)=>observed.push({frame,metadata}),
    snapshot:()=>({closed,decoded:1}),close:()=>{closed=true}}}
  const install=vm.runInNewContext(`(${installOpusPcmWorker.toString()})`,realm)
  install(bind,()=>{},()=>{},()=>{})
  realm.__observeOwnedPcm({},{});assert.equal(observed.length,0)
  receive({data:{type:'pcm-bind',configuration:{}}})
  assert.equal(bindings.length,0);assert.equal(messages[0].type,'pcm-port-error')
  realm.__encodedTimingDirection='receive'
  receive({data:{type:'pcm-bind',configuration:{}}});assert.equal(bindings.length,1)
  const frame={},metadata={};realm.__observeOwnedPcm(frame,metadata)
  assert.equal(observed[0].frame,frame);assert.equal(observed[0].metadata,metadata)
  timer();assert.equal(messages.at(-1).type,'pcm-port-state')
  receive({data:{type:'pcm-bind',configuration:{}}});assert.equal(bindings.length,1)
  closed=true;timer();assert.equal(cleared,1)
})
