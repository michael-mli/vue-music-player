import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import vm from 'node:vm'

const source = await fs.readFile('src/services/partyLeaseGuard.worklet.js', 'utf8')
function fixture(expiry = 5000) {
  let wall = 1000, Processor
  const scope = { currentTime: 1, Date: { now: () => wall },
    AudioWorkletProcessor: class { constructor() { this.port = { messages: [], postMessage(message) { this.messages.push(message) } } } },
    registerProcessor(name, value) { assert.equal(name, 'party-lease-guard'); Processor = value } }
  vm.runInNewContext(source, scope)
  const processor = new Processor({ processorOptions: { expiry } })
  const render = () => {
    const input = [[new Float32Array([.2, -.3]), new Float32Array([.4, -.5])]], output = [[new Float32Array(2), new Float32Array(2)]]
    const alive = processor.process(input, output)
    return { alive, input, output }
  }
  return { processor, scope, render, step(wallDelta, renderDelta = wallDelta / 1000) { wall += wallDelta; scope.currentTime += renderDelta },
    send(data) { processor.port.onmessage({ data }) } }
}
test('render guard passes both channels unchanged and latches silence at expiry before late renewal', () => {
  const f = fixture(), first = f.render()
  assert.equal(first.alive, true); assert.deepEqual(first.output, first.input)
  f.step(3999); assert.equal(f.render().alive, true)
  f.step(1); assert.equal(f.render().alive, false)
  f.send({ type: 'renew', sequence: 1, expiry: 8000 })
  const last = f.render(); assert.equal(last.alive, false); assert.deepEqual(Array.from(last.output[0][0]), [0, 0])
  assert.deepEqual(f.processor.port.messages.map(message => message.reason), ['expired'])
})
test('render guard rejects suspended clocks and backward wall-clock jumps before copying any samples', () => {
  for (const [wallDelta, renderDelta] of [[3000, 0], [-1, .003], [0, -1], [1000, .003]]) {
    const f = fixture(); f.step(wallDelta, renderDelta)
    const result = f.render(); assert.equal(result.alive, false); assert.deepEqual(Array.from(result.output[0][0]), [0, 0])
    f.send({ type: 'renew', sequence: 1, expiry: 6000 }); assert.equal(f.render().alive, false)
  }
})
test('valid renewal extends a live source and replayed, invalid or overlong grants cannot revive it', () => {
  const f = fixture(); f.step(1000)
  f.send({ type: 'renew', sequence: 1, expiry: 7000 }); f.step(3000)
  assert.equal(f.render().alive, true)
  f.send({ type: 'renew', sequence: 1, expiry: 8000 }); assert.equal(f.render().alive, false)
  for (const expiry of [NaN, Infinity, 1000, 20000]) {
    const invalid = fixture(); invalid.send({ type: 'renew', sequence: 1, expiry }); assert.equal(invalid.render().alive, false)
  }
  const stopped = fixture(); stopped.send({ type: 'stop' }); assert.equal(stopped.render().alive, false)
})
test('the native processor supports the existing fifteen-second stage lease ceiling', () => {
  const f = fixture(16000)
  assert.equal(f.render().alive, true)
  f.step(14999); assert.equal(f.render().alive, true)
  f.step(1); assert.equal(f.render().alive, false)
})
