import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
import { ref, effectScope } from 'vue'
const data = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
const vue = new URL('../node_modules/vue/dist/vue.runtime.esm-bundler.js', import.meta.url).href
const vueModule = data(`export {ref,watch} from ${JSON.stringify(vue)}; export const onUnmounted = fn => globalThis.__wakeDispose = fn`)
const moduleSource = ts.transpileModule(fs.readFileSync(new URL('../src/composables/usePartyWakeLock.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 }
}).outputText.replace("'vue'", JSON.stringify(vueModule))
const { usePartyWakeLock } = await import(data(moduleSource))
const settle = async () => { for(let i=0;i<8;i++) await Promise.resolve() }
function fixture(t, { stored=null, inRoom=true, unsupported=false, denied=false, delayed=false }={}) {
  const saved = Object.fromEntries(['navigator','document','window','localStorage'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]))
  const events = new Map(), locks = [], storage = new Map(stored === null ? [] : [['party-keep-screen-awake',stored]])
  const scope = effectScope(), room = ref(inRoom)
  let requests = 0, resolveRequest
  function lock() {
    const listeners = [], handle = { released:false, releases:0, addEventListener: (type,fn)=>listeners.push(fn),
      async release() { this.releases++; this.released=true; for(const fn of listeners)fn() },
      revoke() { this.released=true; for(const fn of listeners)fn() } }
    locks.push(handle); return handle
  }
  const doc = { hidden:false, addEventListener: (name,fn)=>events.set(name,fn), removeEventListener:name=>events.delete(name) }
  const nav = unsupported ? {} : { wakeLock:{request:async type=>{
    assert.equal(type,'screen');requests++
    if(denied)throw new Error('Denied')
    if(delayed)return new Promise(resolve=>{resolveRequest=()=>resolve(lock())})
    return lock()
  }}}
  const globals = { navigator:nav,document:doc,window:{addEventListener:(name,fn)=>events.set(name,fn),removeEventListener:name=>events.delete(name)},
    localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)} }
  for(const[key,value]of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true})
  const awake = scope.run(()=>usePartyWakeLock(room))
  const dispose = ()=>{globalThis.__wakeDispose();scope.stop()}
  t.after(()=>{dispose();delete globalThis.__wakeDispose;for(const[key,desc]of Object.entries(saved))if(desc)Object.defineProperty(globalThis,key,desc);else delete globalThis[key]})
  return { awake,room,doc,events,locks,storage,dispose,requests:()=>requests,resolve:()=>resolveRequest() }
}
test('party defaults to screen awake even when no song is playing',async t=>{
  const e=fixture(t);await settle();assert.equal(e.awake.enabled.value,true);assert.equal(e.awake.active.value,true);assert.equal(e.requests(),1)
})
test('off is a persisted device choice and does not affect the solo preference',async t=>{
  const e=fixture(t);await settle();e.awake.setEnabled(false);await settle()
  assert.equal(e.locks[0].released,true);assert.equal(e.storage.get('party-keep-screen-awake'),'false');assert.equal(e.storage.has('keep-screen-awake'),false)
  e.doc.hidden=true;e.events.get('visibilitychange')();e.doc.hidden=false;e.events.get('visibilitychange')();await settle();assert.equal(e.requests(),1)
})
test('a returning device with an off preference does not acquire a wake lock',async t=>{
  const e=fixture(t,{stored:'false'});await settle();assert.equal(e.awake.enabled.value,false);assert.equal(e.requests(),0)
})
test('hide releases the lock and visibility return reacquires it only for an enabled room',async t=>{
  const e=fixture(t);await settle();e.doc.hidden=true;e.events.get('visibilitychange')();await settle()
  assert.equal(e.awake.active.value,false);assert.equal(e.locks[0].released,true)
  e.doc.hidden=false;e.events.get('visibilitychange')();await settle();assert.equal(e.requests(),2);assert.equal(e.awake.active.value,true)
  e.room.value=false;await settle();assert.equal(e.locks[1].released,true)
})
test('off during an in-flight browser request releases the late handle',async t=>{
  const e=fixture(t,{delayed:true});e.awake.setEnabled(false);e.resolve();await settle()
  assert.equal(e.locks[0].released,true);assert.equal(e.awake.active.value,false);assert.equal(e.requests(),1)
})
test('leaving the room during an in-flight request cannot retain a lock',async t=>{
  const e=fixture(t,{delayed:true});e.dispose();e.resolve();await settle()
  assert.equal(e.locks[0].released,true);assert.equal(e.awake.active.value,false);assert.equal(e.events.size,0)
})
test('OS revocation respects the platform and an explicit retry may acquire again',async t=>{
  const e=fixture(t);await settle();e.locks[0].revoke();await settle()
  assert.equal(e.awake.active.value,false);assert.equal(e.requests(),1)
  await e.awake.retry();assert.equal(e.requests(),2);assert.equal(e.awake.active.value,true)
  e.events.get('pagehide')();await settle();assert.equal(e.awake.active.value,false)
  e.events.get('pageshow')();await settle();assert.equal(e.awake.active.value,true)
})
test('unsupported and denied devices report inactive without retry loops',async t=>{
  const e=fixture(t,{unsupported:true});await settle();assert.equal(e.awake.supported.value,false);assert.equal(e.awake.active.value,false);assert.equal(e.requests(),0)
})
test('denied requests remain an enabled preference without claiming an active lock',async t=>{
  const e=fixture(t,{denied:true});await settle();assert.equal(e.awake.enabled.value,true);assert.equal(e.awake.active.value,false);assert.equal(e.awake.requesting.value,false);assert.equal(e.requests(),1)
})
test('a loading, closed or unadmitted room does not acquire a wake lock',async t=>{
  const e=fixture(t,{inRoom:false});await settle();assert.equal(e.requests(),0)
  e.room.value=true;await settle();assert.equal(e.awake.active.value,true)
  e.room.value=false;await settle();assert.equal(e.locks[0].released,true)
})
