import test from 'node:test'
import assert from 'node:assert/strict'
import { CaptureFrameQueue } from './party-capture-frame-queue.mjs'

function frame(bytes = 1382400) {
  return { codedWidth: 1280, codedHeight: 720, closed: 0, allocationSize: () => bytes,
    close() { this.closed++ } }
}
test('only due native frames leave the queue; replaced frames and remaining frames are closed exactly once', () => {
  const queue = new CaptureFrameQueue(), frames = [frame(), frame(), frame()]
  frames.forEach((value, index) => queue.push(value, index * 40))
  assert.equal(queue.take(-1), null); assert.equal(queue.take(NaN), null)
  const selected = queue.take(50)
  assert.equal(selected.frame, frames[1]); assert.equal(selected.captureTime, 40)
  assert.equal(frames[0].closed, 1); assert.equal(frames[1].closed, 0)
  selected.frame.close(); queue.close(); queue.close()
  assert.ok(frames.every(value => value.closed === 1))
  assert.deepEqual(queue.snapshot(), { queued: 0, bytes: 0, received: 3, dropped: 1 })
})
test('both byte and frame bounds refuse overflow and close every acquired frame', () => {
  for (const bytes of [1382400, 3 * 1024 * 1024]) {
    const queue = new CaptureFrameQueue(), frames = []
    for (let index = 0; index < 40; index++) {
      const value = frame(bytes); frames.push(value)
      try { queue.push(value, index * 40) } catch (error) { assert.match(error.message, /PLAYOUT_QUEUE_BOUND/); break }
    }
    const overflow = frame(bytes); frames.push(overflow)
    assert.throws(() => queue.push(overflow, 4000), /PLAYOUT_QUEUE_BOUND/)
    assert.ok(queue.snapshot().queued <= 40 && queue.snapshot().bytes <= 64 * 1024 * 1024)
    queue.close(); assert.ok(frames.every(value => value.closed === 1))
  }
})

test('processor, pending read and writer reservations fit the original aggregate frame/byte ceiling', () => {
  assert.throws(() => new CaptureFrameQueue(41), /PLAYOUT_QUEUE_CONFIG/)
  assert.throws(() => new CaptureFrameQueue(40, 64 * 1024 * 1024 + 1), /PLAYOUT_QUEUE_CONFIG/)
  const queue = new CaptureFrameQueue(34, 42 * 1024 * 1024), frames = []
  for (let index = 0; index < 40; index++) {
    const value = frame(); frames.push(value)
    try { queue.push(value, index * 40) } catch (error) { assert.match(error.message, /PLAYOUT_QUEUE_BOUND/); break }
  }
  assert.ok(queue.snapshot().queued + 4 + 1 + 1 <= 40)
  assert.ok(queue.snapshot().bytes + (4 + 1 + 1) * 1280 * 720 * 4 <= 64 * 1024 * 1024)
  queue.close(); assert.ok(frames.every(value => value.closed === 1))
})
test('missing capture clocks, backwards frames and malformed sizes/resolutions cannot enter presentation', () => {
  const queue = new CaptureFrameQueue(), initial = frame()
  queue.push(initial, 100)
  for (const [value, capture] of [[frame(), NaN], [frame(), 99], [frame(), 100], [frame(Infinity), 200],
    [{ ...frame(), codedWidth: 640 }, 200], [{ ...frame(), allocationSize() { throw new Error('Unsupported') } }, 200]]) {
    assert.throws(() => queue.push(value, capture), /PLAYOUT_FRAME/)
    assert.equal(value.closed, 1)
  }
  queue.close()
  const late = frame(); assert.throws(() => queue.push(late, 200), /PLAYOUT_FRAME_CLOCK/)
  assert.equal(late.closed, 1); assert.equal(initial.closed, 1)
})

test('startup can discard unpresentable frames while retaining a monotonic capture clock and fixed ownership', () => {
  const queue = new CaptureFrameQueue(), frames = [frame(), frame()]
  queue.push(frames[0], 100); queue.discardPending()
  assert.equal(frames[0].closed, 1); assert.equal(queue.snapshot().dropped, 1)
  queue.push(frames[1], 200); assert.equal(queue.take(199), null)
  const selected = queue.take(200); assert.equal(selected.frame, frames[1]); selected.frame.close()
  queue.close(); assert.ok(frames.every(value => value.closed === 1))
})
