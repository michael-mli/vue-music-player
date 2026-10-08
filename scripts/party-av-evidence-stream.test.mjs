import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { createAvEvidenceStream } from './party-av-evidence-stream.mjs'

function fixture() {
  const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), exitCode: null, signalCode: null, kills: [] })
  child.kill = signal => { child.kills.push(signal); child.signalCode = signal; queueMicrotask(() => child.emit('exit')) }
  return { child, stream: createAvEvidenceStream(child) }
}

test('continuous evidence preserves fragmented marker timestamps and excludes arbitrary data', async () => {
  const { child, stream } = fixture()
  child.stdout.write('{"ready":true,"rate":44100}\n{"on":f')
  child.stdout.write('alse,"time":1234.125,"captureQueueMs":-2,"token":"secret"}\n')
  assert.deepEqual(await stream.audioEvidence(), [{ ready: true, rate: 44100 }, { time: 1234.125, captureQueueMs: -2, on: false }])
  const copy = await stream.audioEvidence(); copy[1].time = 0
  assert.equal((await stream.audioEvidence())[1].time, 1234.125)
  await stream.close(); await stream.close()
  assert.deepEqual(child.kills, ['SIGTERM'])
})

test('continuous evidence retains bounded history and rejects malformed or oversized input', async () => {
  const { child, stream } = fixture()
  for (let time = 0; time < 300; time++) child.stdout.write(JSON.stringify({ captureHeartbeat: true, time }) + '\n')
  const events = await stream.audioEvidence()
  assert.equal(events.length, 258); assert.equal(events[0].time, 42)
  child.stdout.write('{"on":true}\n')
  await assert.rejects(stream.audioEvidence, /AV_EVIDENCE_INVALID_EVENT/)
  await stream.close()
  const oversized = fixture(); oversized.child.stdout.write('x'.repeat(4097))
  await assert.rejects(oversized.stream.audioEvidence, /AV_EVIDENCE_LINE_LIMIT/)
  await oversized.stream.close()
})

test('unexpected evidence channel loss fails instead of reusing stale output events', async () => {
  const { child, stream } = fixture()
  child.exitCode = 0; child.emit('exit')
  await assert.rejects(stream.audioEvidence, /AV_EVIDENCE_STREAM_ENDED/)
  await stream.close()
  const unavailable = fixture(); unavailable.child.emit('error', new Error('spawn failed'))
  await assert.rejects(unavailable.stream.audioEvidence, /AV_EVIDENCE_STREAM_UNAVAILABLE/)
  await unavailable.stream.close()
  assert.deepEqual(unavailable.child.kills, [])
})

test('activity evidence retains quiet edges without inventing frequency markers', async () => {
  const { child, stream } = fixture()
  child.stdout.write('{"audible":true,"time":1000,"rmsAmplitude":0.04}\n')
  child.stdout.write('{"audible":false,"time":2000,"rmsAmplitude":0,"pcm":"discard"}\n')
  assert.deepEqual(await stream.audioEvidence(), [
    { time: 1000, audible: true, rmsAmplitude: 0.04 },
    { time: 2000, audible: false, rmsAmplitude: 0 },
  ])
  child.stdout.write('{"audible":"false","time":2001}\n')
  await assert.rejects(stream.audioEvidence, /AV_EVIDENCE_INVALID_EVENT/)
  await stream.close()
})
