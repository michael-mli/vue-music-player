import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { probeCaptureEpoch } from './party-capture-epoch-probe.mjs'
import { RtpCaptureClock } from './party-rtp-capture-clock.mjs'

function fixture(epochOffset = 2208988800000) {
  const tracks=['audio','video'].map(kind=>({kind})), sources=tracks.map(track=>({
    rtpTimestamp:track.kind==='audio'?960:1800,captureTimestamp:10000+epochOffset,timestamp:10010 }))
  const records=tracks.flatMap((track,index)=>[0,1].map(count=>({direction:'receive',kind:track.kind,worker:index+1,
    rtpTimestamp:count*(track.kind==='audio'?960:1800),realmTimeOrigin:9000,values:{captureTime:980+count*20}})))
  const peers=[{getReceivers:()=>tracks.map((track,index)=>({track,getSynchronizationSources:()=>[sources[index]]}))}]
  const realm={Date:{now:()=>10010},performance:{now:()=>100},records,peers,stream:{getTracks:()=>tracks}}
  const run=()=>vm.runInNewContext(`(${probeCaptureEpoch.toString()})(records,stream,peers,${RtpCaptureClock.toString()})`,realm)
  return {sources,records,run}
}
test('audio/video workers independently relate capture time to explicit NTP or Unix delivery epochs',()=>{
  for(const [offset,epoch]of[[2208988800000,'ntp'],[0,'unix']]){
    const rows=fixture(offset).run()
    assert.ok(rows.every(row=>row.status==='verified'&&row.epoch===epoch&&row.residualMs===0&&row.captureAgeMs===10))
    assert.ok(!JSON.stringify(rows).includes('rtpTimestamp'))
  }
})
test('unknown epochs, stale delivery, worker ambiguity and invalid capture clocks cannot become verified',()=>{
  for(const mutate of[
    f=>{f.sources[0].captureTimestamp+=3600000},
    f=>{f.sources[0].timestamp-=121},
    f=>{f.records[1].worker=99},
    f=>{f.records[1].values.captureTime+=500},
    f=>{delete f.records[1].realmTimeOrigin},
  ]){
    const f=fixture();mutate(f)
    assert.notEqual(f.run()[0].status,'verified')
  }
})
