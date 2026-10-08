import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { initDb } from './db.js'
import { initKtvSchema } from './ktv-schema.js'
import { createKtvPlayback } from './ktv-playback.js'
import { createKtvAutomation } from './ktv-automation.js'
import { invalidateReadiness } from './ktv-readiness.js'

function fixture(t, { resolveAssets, ready = true, assigned = true, displayStage = false } = {}) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ktv-auto-')),db=initDb(root),now=new Date().toISOString()
  const roomId=randomUUID(),memberId=randomUUID(),entryId=randomUUID(),performanceId=randomUUID()
  let nowMs=0,lookups=0
  const clock={id:randomUUID(),nowMs:()=>nowMs}
  db.prepare("INSERT INTO users(username,kind,created_at) VALUES('auto-host','guest',?)").run(now)
  db.prepare('INSERT INTO ktv_rooms(id,name,created_at,expires_at) VALUES(?,?,?,?)').run(roomId,'Automatic room',now,new Date(Date.now()+60000).toISOString())
  db.prepare("INSERT INTO ktv_members(id,room_id,user_id,display_name,role,admission,joined_at,updated_at) VALUES(?,?,1,'Host','host','admitted',?,?)").run(memberId,roomId,now,now)
  db.prepare('INSERT INTO ktv_queue_entries(id,room_id,song_id,title,requester_member_id,singer_member_id,accepted_at,created_at,updated_at) VALUES(?,?,1,?,?,?,?,?,?)').run(entryId,roomId,'Song',memberId,memberId,now,now,now)
  db.prepare('INSERT INTO ktv_readiness(room_id,entry_id,performance_id,generation,clock_id,state,updated_at) VALUES(?,?,?,1,?,?,?)').run(roomId,entryId,performanceId,clock.id,ready?'ready':'awaiting-singer',now)
  const transaction=(database,work)=>{database.exec('BEGIN IMMEDIATE');try{const value=work();database.exec('COMMIT');return value}catch(error){database.exec('ROLLBACK');throw error}}
  const events=[],broadcasts=[]
  const playback=createKtvPlayback({db,clock,transaction,bump:(database,id)=>database.prepare('UPDATE ktv_rooms SET revision=revision+1 WHERE id=?').run(id),event:(_db,_room,_actor,action)=>events.push(action),broadcast:id=>broadcasts.push(id)})
  nowMs=9000
  const assets={version:'fixture-assets',durationMs:60000,instrumental:{durationMs:60000},original:{durationMs:60000},lyrics:{mode:'missing'}}
  const automation=createKtvAutomation({db,clock,playback,transaction,event:(_db,_room,_actor,action)=>events.push(action),broadcast:id=>broadcasts.push(id),resolveAssets:async song=>{lookups++;return resolveAssets?resolveAssets(song):assets}})
  const authorized={self:{id:memberId,admission:'admitted'}, ...(displayStage ? {deviceScope:'display'} : {})}
  const ws={roomId,clientDeviceId:randomUUID(),principal:{},readyState:1,send(){}}
  function status(socket=ws,purpose='stage',audioEnabled=true){playback.deviceMessage(socket,{type:'device.status',purpose,label:'Device',audioEnabled,clockHealthy:true},authorized)}
  const controller = displayStage ? {...ws,clientDeviceId:randomUUID()} : ws
  if(displayStage)playback.deviceMessage(controller,{type:'device.status',purpose:'viewer',label:'Host controller',audioEnabled:false,clockHealthy:true},{self:{id:memberId,admission:'admitted'}})
  status();if(assigned)transaction(db,()=>playback.assign(roomId,ws.clientDeviceId))
  function deviceReady(socket=ws){const p=playback.snapshot(roomId);playback.deviceMessage(socket,{type:'device.ready',clockId:clock.id,performanceId:p.performanceId,generation:p.generation,assetVersion:assets.version,durationMs:assets.durationMs},authorized)}
  async function prepare(){automation.sweep();await automation.pending(roomId)}
  const state=()=>playback.snapshot(roomId).state
  t.after(()=>{automation.close();playback.close();db.close();fs.rmSync(root,{recursive:true,force:true})})
  return {db,clock,roomId,entryId,memberId,performanceId,assets,ws,controller,playback,automation,events,transaction,status,deviceReady,prepare,state,lookups:()=>lookups,time:value=>{nowMs=value},setAuto:value=>db.prepare('UPDATE ktv_rooms SET automatic_playback=? WHERE id=?').run(Number(value),roomId),guide:()=>{const socket={...ws,clientDeviceId:randomUUID()};status(socket,'guide');return socket}}
}
test('default-on automation prepares and schedules exactly once after singer readiness and actual stage readiness',async t=>{
  const f=fixture(t,{ready:false});await f.prepare();assert.equal(f.lookups(),0)
  f.db.prepare("UPDATE ktv_readiness SET state='ready' WHERE room_id=?").run(f.roomId)
  await f.prepare();assert.equal(f.state(),'preparing');assert.equal(f.lookups(),1)
  f.automation.sweep();assert.equal(f.state(),'preparing');assert.equal(f.automation.snapshot(f.roomId).state,'waiting-audio')
  f.deviceReady();f.automation.sweep();assert.equal(f.state(),'scheduled');f.playback.sweep()
  f.automation.sweep();assert.equal(f.events.filter(x=>x==='automation.started').length,1);assert.equal(f.events.filter(x=>x==='automation.prepared').length,1)
  f.time(11000);f.status();f.playback.sweep();assert.equal(f.state(),'playing')
})
test('automation waits for explicit enabled stage selection rather than choosing an arbitrary device',async t=>{
  const f=fixture(t,{assigned:false});await f.prepare();assert.equal(f.lookups(),0);assert.equal(f.automation.snapshot(f.roomId).state,'waiting-stage')
  f.transaction(f.db,()=>f.playback.assign(f.roomId,f.ws.clientDeviceId));await f.prepare();assert.equal(f.state(),'preparing')
})
test('a required guide holds the countdown until the correct guide has decoded its generation',async t=>{
  const f=fixture(t);await f.prepare();const guide=f.guide();f.playback.guide(f.roomId,f.memberId,true,guide.clientDeviceId)
  f.deviceReady();f.automation.sweep();assert.equal(f.state(),'preparing');assert.equal(f.automation.snapshot(f.roomId).state,'waiting-guide')
  f.deviceReady(guide);f.automation.sweep();assert.equal(f.state(),'scheduled')
})
test('host disabling automation preserves the manual prepare/start flow',async t=>{
  const f=fixture(t);f.setAuto(false);await f.prepare();assert.equal(f.lookups(),0);assert.equal(f.automation.snapshot(f.roomId).state,'off')
  f.playback.prepare(f.roomId,{state:'ready',entryId:f.entryId,performanceId:f.performanceId},f.assets);f.deviceReady();f.automation.sweep();assert.equal(f.state(),'preparing')
  f.playback.start(f.roomId);assert.equal(f.state(),'scheduled')
})
test('disabling during asset lookup prevents late preparation and scheduling',async t=>{
  let resolve;const f=fixture(t,{resolveAssets:()=>new Promise(done=>{resolve=done})})
  f.automation.sweep();const pending=f.automation.pending(f.roomId);await Promise.resolve();f.setAuto(false);resolve(f.assets);await pending
  assert.equal(f.state(),'idle');assert.equal(f.events.includes('automation.prepared'),false)
})
test('cancelled or replaced readiness cannot be prepared by an earlier asset lookup',async t=>{
  let resolve;const f=fixture(t,{resolveAssets:()=>new Promise(done=>{resolve=done})})
  f.automation.sweep();const pending=f.automation.pending(f.roomId);await Promise.resolve()
  invalidateReadiness(f.db,f.roomId,f.clock);f.playback.invalidate(f.roomId);resolve(f.assets);await pending
  assert.equal(f.state(),'idle');assert.equal(f.events.includes('automation.prepared'),false)
})
test('asset failure stops automatic retry loops and exposes an attention state',async t=>{
  const f=fixture(t,{resolveAssets:()=>{throw new Error('Fixture missing asset')}})
  await f.prepare();assert.equal(f.automation.snapshot(f.roomId).state,'attention')
  await f.prepare();await f.prepare();assert.equal(f.lookups(),1);assert.equal(f.state(),'idle')
})
test('prepared audio cannot auto-start without an available moderator controller',async t=>{
  const f=fixture(t,{displayStage:true});await f.prepare();f.deviceReady()
  f.playback.disconnected(f.controller)
  f.automation.sweep();assert.equal(f.state(),'preparing');assert.equal(f.automation.snapshot(f.roomId).state,'waiting-host')
})
test('paused and recovering performances never restart automatically',async t=>{
  const f=fixture(t);await f.prepare();f.deviceReady();f.automation.sweep();f.playback.sweep()
  f.time(11000);f.status();f.playback.sweep();f.playback.transition(f.roomId,'pause');f.time(15000);f.status();f.playback.sweep()
  assert.equal(f.state(),'paused');f.automation.sweep();assert.equal(f.state(),'paused');assert.equal(f.automation.snapshot(f.roomId).state,'attention')
  f.db.prepare("UPDATE ktv_playback SET state='recovering', recovery_reason='stage.decode' WHERE room_id=?").run(f.roomId)
  f.deviceReady();f.automation.sweep();assert.equal(f.state(),'recovering')
})
test('service shutdown releases in-flight authority without committing late asset results',async t=>{
  let resolve;const f=fixture(t,{resolveAssets:()=>new Promise(done=>{resolve=done})})
  f.automation.sweep();const pending=f.automation.pending(f.roomId);await Promise.resolve();f.automation.close();resolve(f.assets);await pending
  assert.equal(f.state(),'idle');assert.equal(f.events.includes('automation.prepared'),false)
})
test('the additive automation migration defaults existing rooms on and preserves room rows',t=>{
  const f=fixture(t);f.automation.close();f.db.exec('ALTER TABLE ktv_rooms DROP COLUMN automatic_playback');initKtvSchema(f.db)
  assert.equal(f.db.prepare('SELECT automatic_playback FROM ktv_rooms WHERE id=?').get(f.roomId).automatic_playback,1)
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM ktv_queue_entries').get().n,1)
  assert.equal(f.db.prepare('PRAGMA foreign_key_check').all().length,0)
})

test('a changed speaker wins over an older in-flight preparation',async t=>{
  let resolve;const f=fixture(t,{resolveAssets:()=>new Promise(done=>{resolve=done})})
  f.automation.sweep();const pending=f.automation.pending(f.roomId);await Promise.resolve()
  const next={...f.ws,clientDeviceId:randomUUID()};f.status(next);f.playback.assign(f.roomId,next.clientDeviceId)
  resolve(f.assets);await pending
  assert.equal(f.state(),'idle');assert.equal(f.playback.snapshot(f.roomId).stageDeviceId,next.clientDeviceId)
  assert.equal(f.events.includes('automation.prepared'),false)
})

test('manual preparation wins over an older automatic asset result',async t=>{
  let resolve;const f=fixture(t,{resolveAssets:()=>new Promise(done=>{resolve=done})})
  f.automation.sweep();const pending=f.automation.pending(f.roomId);await Promise.resolve()
  f.playback.prepare(f.roomId,{state:'ready',entryId:f.entryId,performanceId:f.performanceId},f.assets)
  const generation=f.playback.snapshot(f.roomId).generation;resolve(f.assets);await pending
  assert.equal(f.state(),'preparing');assert.equal(f.playback.snapshot(f.roomId).generation,generation)
  assert.equal(f.events.includes('automation.prepared'),false)
})
