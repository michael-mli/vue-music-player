import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import ts from 'typescript'

const source = await fs.readFile(new URL('../src/services/pwaUpdate.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText
const { applyPwaUpdate } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
class Worker extends EventTarget {
  state = 'installed'; messages = []; listeners = 0
  addEventListener(...args) { this.listeners++; super.addEventListener(...args) }
  removeEventListener(...args) { this.listeners--; super.removeEventListener(...args) }
  postMessage(message) { this.messages.push(message) }
  change(state) { this.state = state; this.dispatchEvent(new Event('statechange')) }
}
test('update timeout preserves the current page and cleans activation listeners', async () => {
  const worker = new Worker(); let reloads = 0
  await assert.rejects(applyPwaUpdate({ getRegistration: async () => ({ waiting: worker }) }, () => reloads++, 10), /PWA_UPDATE_TIMEOUT/)
  assert.equal(reloads, 0);assert.equal(worker.listeners, 0)
  worker.change('activated');assert.equal(reloads, 0)
})
test('activation reloads once and retry after timeout can use the same worker', async () => {
  const worker = new Worker(), registration = { waiting: worker, active: null }; let reloads = 0
  const container = { getRegistration: async () => registration }
  await assert.rejects(applyPwaUpdate(container, () => reloads++, 5), /TIMEOUT/)
  const pending = applyPwaUpdate(container, () => reloads++, 1000)
  await Promise.resolve()
  registration.active = worker;worker.change('activated');await pending
  assert.equal(reloads, 1);assert.equal(worker.listeners, 0)
  assert.deepEqual(worker.messages, [{ type: 'SKIP_WAITING' }, { type: 'SKIP_WAITING' }])
})
test('replacement, missing registration and unfinished installation cannot reload old code', async () => {
  let reloads = 0
  const worker = new Worker()
  const pending = applyPwaUpdate({ getRegistration: async () => ({ waiting: worker }) }, () => reloads++, 1000)
  await Promise.resolve();worker.change('redundant');await assert.rejects(pending, /REPLACED/)
  assert.equal(worker.listeners, 0)
  await assert.rejects(applyPwaUpdate({ getRegistration: async () => undefined }, () => reloads++), /UNAVAILABLE/)
  await assert.rejects(applyPwaUpdate({ getRegistration: async () => ({ installing: worker }) }, () => reloads++), /PENDING/)
  assert.equal(reloads, 0)
  const active = new Worker();active.state = 'activated'
  await applyPwaUpdate({ getRegistration: async () => ({ active }) }, () => reloads++)
  assert.equal(reloads, 1)
})
