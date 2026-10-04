import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import {installVp8FrameWorker} from './party-vp8-frame-worker.mjs'

function fixture(){
  let wall=1000,mono=0,listener,timer,delivered,decoded=0,streamClosed=false
  const reports=[]
  class Port{constructor(){this.messages=[]}postMessage(packet){this.messages.push(packet)}start(){}close(){this.closed=true}}
  const port=new Port()
  const createStream=(deliver,report)=>{delivered=deliver;return {observe(){decoded++},snapshot:()=>({closed:streamClosed,decoded}),
    close(reason){if(streamClosed)return;streamClosed=true;report({reason})}}}
  const realm={MessagePort:Port,Date:{now:()=>wall},performance:{now:()=>mono},
    __encodedTimingDirection:'receive',addEventListener:(name,callback)=>{listener=callback},
    setInterval:callback=>{timer=callback;return 1},clearInterval:()=>{timer=null},postMessage:row=>reports.push(row),createStream}
  realm.self=realm;vm.runInNewContext(`(${installVp8FrameWorker.toString()})(createStream)`,realm)
  const message=data=>listener({data})
  return {realm,port,reports,message,bind(){message({type:'video-bind',port,expiryUnixMs:10000})},
    send(id){realm.__observeOwnedVideo({},{});return delivered?.({},{id,bytes:1,captureUnixMs:wall})},
    advance(ms){wall+=ms;mono+=ms;timer?.()},get decoded(){return decoded}}
}
test('worker decoding warms before binding and transfers at most two credited frames without pausing codec state',()=>{
  const f=fixture();assert.equal(f.send(1),false);f.bind()
  assert.equal(f.send(2),true);assert.equal(f.send(3),true);assert.equal(f.send(4),false)
  assert.equal(f.decoded,4);assert.equal(f.port.messages.filter(row=>row.type==='video-frame').length,2)
  f.port.onmessage({data:{type:'video-consumed',id:2,bytes:1}});assert.equal(f.send(5),true)
  f.message({type:'video-stop'});assert.equal(f.port.closed,true)
  assert.equal(f.reports.at(-1).closed,true);assert.equal(f.reports.at(-1).inFlight,0)
})
test('forged frame credits and expiry permanently close the port and cannot rebind or renew it',()=>{
  const f=fixture();f.bind();f.send(1)
  f.port.onmessage({data:{type:'video-consumed',id:1,bytes:2}})
  assert.equal(f.reports.at(-1).reason,'VIDEO_PORT_CREDIT');f.bind()
  assert.equal(f.reports.at(-1).type,'video-port-error')
  const expiry=fixture();expiry.bind();expiry.send(1);expiry.advance(9000)
  assert.equal(expiry.reports.at(-1).reason,'VIDEO_PORT_CLOCK')
  expiry.message({type:'video-renew',expiryUnixMs:20000});assert.equal(expiry.send(2),false)
})
