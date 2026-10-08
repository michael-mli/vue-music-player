import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { setImmediate as nextTick } from 'node:timers/promises'
import { createOpusDecodeProbe, primaryOpusPayload, opusPacketFrames } from './party-opus-decode-probe.mjs'

const codecs = [{ payloadType: 111, mimeType: 'audio/opus' }, { payloadType: 63, mimeType: 'audio/red' }]
test('negotiated Opus/RED payload parsing keeps primary bytes and rejects malformed bounded packets', () => {
  const raw = new Uint8Array([239,0,0,2,239,0,0,3,111,10,11,20,21,22,30,31]), before = raw.slice()
  const primary = primaryOpusPayload(raw, 63, codecs)
  assert.deepEqual(Array.from(primary.data), [30,31]); assert.equal(primary.redundantBlocks, 2)
  assert.deepEqual(raw, before)
  assert.equal(primaryOpusPayload(raw, 111, codecs).data, raw)
  for (const packet of [new Uint8Array(), new Uint8Array(65537), new Uint8Array([239,0,0,2]),
    new Uint8Array([239,0,3,255,111,1]), new Uint8Array([239,0,0,0,239,0,0,0,239,0,0,0,239,0,0,0,111,1])]) {
    assert.throws(() => primaryOpusPayload(packet, 63, codecs))
  }
  assert.throws(() => primaryOpusPayload(new Uint8Array([1]), 99, codecs), /PAYLOAD_TYPE/)
  assert.throws(() => primaryOpusPayload(new Uint8Array([13,1]), 63, codecs), /PAYLOAD_TYPE/)
})

test('RED blocks expose bounded views with their RFC sample-clock timestamp offsets without changing payload bytes',()=>{
  const raw=new Uint8Array([239,15,0,2,239,30,0,1,111,1,2,3,4]),before=raw.slice()
  const parsed=primaryOpusPayload(raw,63,codecs)
  assert.deepEqual(parsed.redundant.map(block=>block.timestampOffset),[960,1920])
  assert.deepEqual(parsed.redundant.map(block=>Array.from(block.data)),[[1,2],[3]])
  assert.deepEqual(Array.from(parsed.data),[4]);assert.deepEqual(raw,before)
  assert.equal(parsed.redundant[0].data.buffer,raw.buffer)
})

test('Opus packet sample counts cover TOC durations and reject invalid or excessive frame counts', () => {
  for (let config=0;config<32;config++) {
    const durations=config<12?[10,20,40,60]:config<16?[10,20]:[2.5,5,10,20]
    const duration=durations[config<16&&config>=12?config&1:config&3]
    assert.equal(opusPacketFrames(new Uint8Array([config<<3])), duration*48)
  }
  assert.equal(opusPacketFrames(new Uint8Array([131,48])), 5760)
  for (const bytes of [[],[131],[131,0],[131,49],[27,3]]) assert.throws(()=>opusPacketFrames(new Uint8Array(bytes)))
})

function fixture({ supported = true, fail = false, invalidOutput = false, continuousTimestamp = false } = {}) {
  const messages = [], chunks = [], outputs = [], decoders = []
  class Decoder {
    static async isConfigSupported(config) { return { supported, config } }
    constructor(callbacks) { this.callbacks = callbacks; this.state = 'unconfigured'; decoders.push(this) }
    configure(config) { this.config = config; this.state = 'configured' }
    decode(chunk) {
      if (fail) throw new Error('decoder internals must not escape')
      chunks.push(chunk)
      const output = { timestamp: continuousTimestamp ? chunks[0].timestamp+(chunks.length-1)*20000 : chunk.timestamp,
        duration: 20000, sampleRate: invalidOutput ? 8000 : 48000,
        numberOfChannels: 2, numberOfFrames: 960, closes: 0, close() { this.closes++ },
        copyTo() { throw new Error('Do not read PCM') } }
      outputs.push(output); this.callbacks.output(output)
    }
    close() { this.state = 'closed' }
  }
  const realm = { Number, ArrayBuffer, Uint8Array, Set, setTimeout, clearTimeout,
    AudioDecoder: Decoder, EncodedAudioChunk: class { constructor(config) { Object.assign(this,config); this.data = config.data.slice() } },
    performance: { timeOrigin: 1000 }, __encodedTimingCodecs: codecs,
    postMessage: row => messages.push(row) }
  realm.self = realm
  const probe = vm.runInNewContext(`(${createOpusDecodeProbe.toString()})(${primaryOpusPayload.toString()},${opusPacketFrames.toString()})`, realm)
  return { probe, realm, messages, chunks, outputs, decoders }
}
test('native-decoder probe preserves capture timestamps, closes every output and never reads PCM', async () => {
  const f = fixture(), bytes = new Uint8Array([1,2,3]), before = bytes.slice()
  let reads = 0
  for (let i=0;i<100;i++) f.probe.observe({ timestamp: i*960, get data() { reads++; return bytes.buffer } },
    { captureTime: -10 + i*20, payloadType: 111 })
  await nextTick()
  assert.equal(reads, 8); assert.equal(f.messages.length, 1)
  const result = f.messages[0]
  assert.equal(result.status, 'complete'); assert.equal(result.inputCount, 8); assert.equal(result.decodedCount, 8)
  assert.equal(result.records[0].timestamp, -10000); assert.equal(result.records[0].captureUnixMs, 990)
  assert.ok(f.outputs.every(output => output.closes===1)); assert.ok(f.decoders.every(decoder=>decoder.state==='closed'))
  assert.deepEqual(bytes, before)
  assert.ok(!JSON.stringify(result).includes('data'))
})
test('packet capture/RTP metadata stays distinct when decoder output follows a continuous sample clock', async () => {
  const f=fixture({continuousTimestamp:true})
  for(let i=0;i<8;i++) f.probe.observe({timestamp:i*960,data:new Uint8Array([1]).buffer},
    {captureTime:1+i*22,payloadType:111})
  await nextTick()
  const result=f.messages[0]
  assert.equal(result.status,'complete')
  assert.equal(result.records[1].timestamp,21000)
  assert.equal(result.records[1].captureTimestamp,23000)
  assert.equal(result.records[1].rtpTimestamp,960)
  assert.equal(result.records[1].captureUnixMs,1023)
  assert.equal(result.maximumTimestampDifferenceUs,14000)
})
test('unsupported configurations and decode/output failures terminate safely with fixed diagnostics', async () => {
  for (const options of [{ supported: false }, { fail: true }, { invalidOutput: true }]) {
    const f = fixture(options)
    f.probe.observe({ timestamp:0, data: new Uint8Array([1]).buffer }, { captureTime: 1, payloadType: 111 })
    await nextTick()
    assert.equal(f.messages.length, 1)
    assert.ok(['unsupported','error'].includes(f.messages[0].status))
    assert.ok(f.outputs.every(output => output.closes===1))
    assert.ok(f.decoders.every(decoder=>decoder.state==='closed'))
    assert.equal(JSON.stringify(f.messages).includes('internals'), false)
  }
})
test('absent capture metadata never reads payload and invalid payload closes pending configuration', async () => {
  const f = fixture(); let reads=0
  f.probe.observe({ get data() { reads++; throw new Error('secret') } }, {})
  assert.equal(reads, 0)
  f.probe.observe({ timestamp:0, data: new Uint8Array(65537).buffer }, { captureTime: 1, payloadType: 111 })
  await nextTick()
  assert.equal(f.messages[0].reason, 'PAYLOAD_SIZE')
  assert.equal(f.decoders.length, 0)
})
