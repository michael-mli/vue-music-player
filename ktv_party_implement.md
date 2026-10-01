# KTV Party — Implementation Plan and Progress

Created: 2026-09-29

Last updated: 2026-10-01

Design reference: [ktv_party.md](ktv_party.md)

Current status: The durable-room preview is deployed at
`https://music.micstec.com/party`. Members can connect a shared screen or phone
controller with a short-lived code; a display has read-only room access, and a
controller inherits the member's current permissions. Hosts can appoint co-hosts,
transfer ownership, reject or block guests, and restore access. Co-hosts can manage
ordinary members, queue requests, and routine settings. Full local acceptance and
online streaming remain open release work.
Singer nomination/acceptance, selected-turn readiness, and room clock negotiation
are live. A singer can accept a nominated song and confirm a host-selected turn
from a paired phone. Readiness is a human confirmation; it does not start audio.
Scheduled stage playback, pinned lyrics, pause/resume/seek/skip, output leases and
a private original guide are live and pass a production-build journey
with three isolated Chrome sessions. Physical audio alignment and streaming remain
unverified for physical devices and public streaming. Required-guide gating/recovery, fair next-turn readiness
and automatic host-loss transfer were first deployed as `323c922` (`main-Ccfld-0j.js`).
The preceding combined phone/audio-recovery preview was deployed as `f701e9a`
(`main-1-asbyg9.js`). It adds persistent Songs/Queue/Sing/People tabs, local invitation
and pairing QR codes, host-controlled common-screen invitations, fullscreen exit,
and rendered-drift/output recovery. It passes 65 backend tests, 15 clock/audio
checks, a 42-check production Chrome journey, 18 public recovery protocol checks
and 10 public deployment checks. Public checks include the default 30-second host
grace, pending-next recovery, role revocation, drift/output faults and invitation
visibility while locked. Physical timing and online/hybrid streaming remain open.

The durable-room milestone was deployed as `f1e21da` (`main-l1KzzXwT.js`). General room/device command
receipts, encrypted pairing response recovery, returning invitation recovery and
room lifecycle/retention are live. Release checks pass: backend 76/76, frontend
19/19, exact-release foreground Chrome 49/49, public protocol 24/24 and deployment
10/10. P02 room-domain software criteria are complete; physical timing, remaining
queue/UI/PWA work and online/hybrid streaming still need implementation/acceptance.

The current preview is `49bd4d2` (`main-BLgb8FvF.js`, `main-B17ntvAM.css`). Queue
request cancellation, nomination decline and priority approval cannot change an
entry after performance preparation begins. The phone hides request-removal
controls for that entry; hosts use performance controls. The release passes 77
backend checks, the unchanged 19 frontend unit checks, an exact-release foreground
Chrome journey of 50 checks, 25 public protocol checks and 10 deployment checks.

The previous queue/audio-ownership preview is `34fc55c` (`main-7EC2G4Bt.js`,
`main-CsXF3blB.css`) at the same URL. It adds persistent host ordering/fair-order
restoration, held-song reassignment, per-room singer caps, duplicate warnings, and
solo/party audio ownership. Verified: backend 81/81 (54 KTV + 27 dig), party units
20/20, solo-player units 10/10, exact-release foreground Chrome 59/59, public
protocol 30/30 and deployment 10/10. Public temporary rooms were closed. Consistent
DB/static/previous-code backup: `/tmp/ktv-party-queue-controls-predeploy.6j7f1h_o`
(previous live build `49bd4d2`). Physical timing/browser acceptance and online/hybrid
remain open; the next work continues into streaming rather than ending here.

The current streaming-foundation preview is `4a216be` (`main-D4pM4JGY.js`,
`main-Be17GLqV.css`) at the same URL. It includes the streaming code and room
cache protection with online media disabled. The release build, PWA upgrade
check 6/6, public HTTP/room/WSS smoke checks 10/10, SQLite integrity and foreign
keys passed. The local browser journey passed 59/59 with the same source before
the release-SHA build; two exact-build reruns encountered the host's virtual
audio clock stalling at different steps, so exact-build audio acceptance is not
claimed. Public rooms from release checks were closed. Backup:
`/tmp/ktv-party-media-predeploy.sSNSC8`.

P07 streaming implementation is now in progress. A real
loopback LiveKit/Chrome spike passed 23 checks: one mixed backing/mic track, private
guide exclusion, captured lyric video, two receivers, client silence deadlines,
forced TURN relay, provider removal, publisher replacement, server lease expiry, old-token denial,
persisted revocation and room close. The negative control confirms that an old JWT
can rejoin the private SFU directly after removal; production signaling must go
through the authorization gateway. This is synthetic browser evidence, not a
public-network or physical microphone acceptance result.

Room media grants and HTTP routes now use actual admission, paired-device scope,
the selected singer, generation and live output lease. A separate supervisor owns
the SFU and stops it if backend authorization or provider revocation fails. The
media container builds successfully. The backing engine now exposes a scoped
pre-monitor instrumental tap; original-guide buffers cannot obtain that tap.
The integrated room UI now offers host-controlled local, online, and hybrid modes,
performer microphone capture, an isolated original-vocal guide, captured lyric
video and audience playback. The publisher and audience use one synchronized
received media stream; lost publisher connections enter room recovery. The mode
is still disabled in production. Current checks: backend 104/104, frontend 40/40,
private-config 2/2, real process/SFU failure 9/9, local built-app Chrome 59/59,
PWA upgrade/offline Chrome 6/6, production build and type check pass. A built-app loopback journey has confirmed
provider-ready audio/video tracks, a public mix with microphone and backing only,
and decoded lyric video. Its complete guide/handover run remains open; the host's
virtual audio output stalled in the test and the safety recovery stopped capture.
Direct ICE/TURN, physical alignment and the browser support matrix remain open.
The isolated PWA check installs a synthetic legacy caching worker, upgrades it,
and confirms old cached room authority is purged; an actual field-installed
older PWA is still part of release acceptance.
`ktv_party_deploy.md` records the configuration and release procedure. The public
release is `4a216be`, with online mode unavailable until relay and physical gates pass.

## 1. How to use this tracker

- Mark work items `[x]` only when implemented and verified. Documentation of an
  approach does not mean that functionality exists.
- Phase status: `Not started`, `In progress`, `Blocked`, or `Complete`.
- A phase is complete only when its exit criteria have evidence. Include commit/PR,
  commands/results, device/browser versions where relevant, and remaining limits.
- Update the phase table, evidence log, decisions, and next action after each work
  session. If scope changes, update [ktv_party.md](ktv_party.md) in the same change.
- Keep unfinished work visible when shipping an intermediate release. Local KTV
  completion does not imply that online/hybrid streaming is complete.
- Avoid counting tasks as a percentage: a checked UI task and an unvalidated audio
  system do not represent equal amounts of progress.

## 2. Phase overview

| Phase | Deliverable | Depends on | Status | Evidence |
| --- | --- | --- | --- | --- |
| P00 | Scope baseline and technical contracts | Design | In progress | Baseline tag and source inventory; contracts remain open |
| P01 | Two-device audio feasibility prototype | P00 minimum timing contract | In progress | Monotonic clock estimator tested; audio prototype and acoustic measurements open |
| P02 | Rooms, identities, invitations, permissions, persistence | P00 | Complete | Transactional general/encrypted receipts, restart/rollback, guest recovery, expiry/retention, permissions and configured bounds pass backend/browser/public checks |
| P03 | Realtime state, commands, queue, leases | P02 | In progress | Versioned playback timeline, checkpoints, presence, renewable stage leases and turn history tested; fair automatic next turns and host-loss grace/transfer tested |
| P04 | Stage, phone controller, host UI | P02–P03 | In progress | Entry/join/pairing, Songs/Queue/Sing/People tabs, local invitation/pairing QR, moderation, readiness and guide controls; broad accessibility/physical coverage open |
| P05 | Scheduled playback, private guide, shared lyrics | P01, P03–P04 | In progress | Stage/guide/lyrics/controls pass Chrome journey; required-guide and rendered-drift/output recovery tested; physical timing open |
| P06 | Recovery, browser coverage, local release readiness | P02–P05 | In progress | Guide/stage loss, host transfer, restart and revocation have automated evidence; physical/device coverage open |
| P07 | Online performance streaming and hybrid operation | P01, stable P03/P05 contracts | In progress | SFU/capture spike, room authorization and mode/capture/audience UI implemented; full app handover, public network and device acceptance open |
| P08 | Deployment, monitoring, and release verification | P06 for local; P07 for online | In progress | Intermediate previews deployed; private config generator, nginx snippet and runbook added; public media and release acceptance open |
| P09 | Optional enhancements | Released foundation | Not started | — |

P01 is an early risk gate. P02 can proceed while audio experiments run because its
membership and queue work does not depend on a particular audio engine. P07 may
start with a spike before the local release; its public release depends on P06.

Proposed milestones:

| Milestone | Completion gate |
| --- | --- |
| M0 — Feasible | P00–P01 evidence, selected audio approach and supported reference setup |
| M1 — Shared room demo | P02–P04, several devices share one moderated room and queue |
| M2 — Local KTV beta | P05–P06, private guide and recovery pass on supported devices |
| M3 — Online/hybrid beta | P07, remote audience hears and sees aligned performance |
| M4 — Released | Applicable P08 gate passes and limitations are published |

## 3. P00 — Scope baseline and contracts

Status: In progress

Deliverables: implementation baseline, precise terminology, protocol/schema draft,
and reference device setup. Use the design's defaults where a routine decision is
needed; record assumptions without presenting them as user-confirmed decisions.

- [ ] P00.1 Record whether the first public release is local, online, or hybrid;
  retain all required later modes in the milestone list.
- [ ] P00.2 Record reference desktop/phone browsers, speaker path, headphone path,
  network setup, sample tracks, and existing deployment topology.
- [ ] P00.3 Confirm the source inventory, Node runtime required by current SQLite
  usage, migration conventions, auth flow, media URL/CORS/Range behavior, and PWA cache.
- [ ] P00.4 Specify command/snapshot schemas, room vs member vs device IDs,
  permission matrix, queue states, playback generations, clock IDs, and error codes.
- [ ] P00.5 Finalize default limits, readiness/grace/lease timeouts, queue fairness,
  invitation/pairing lifetime, and retention policy as configurable values.
- [ ] P00.6 Sketch create/join/waiting, stage, Songs/Queue/Sing/People, and host flows,
  including audio enablement, loading, rejection, removal, and reconnect states.

Exit criteria:

- [ ] The contracts cover R01–R14 and identify which release supplies each one.
- [ ] No room control path relies on global app-admin privileges or client-only checks.
- [ ] Every timing field has a unit and clock origin; role and device capability
  rules are unambiguous enough to implement.

Evidence: `ktv-party-baseline-2026-09-29` points to `6e8504b` on main and was
pushed to origin before implementation. The current work is on `feat/ktv-party`.
Source inventory was reviewed; protocol, support matrix, and all exit criteria
remain open.

## 4. P01 — Audio synchronization feasibility

Status: In progress

Deliverables: a small disposable or reusable developer harness, recorded timing
measurements, and an audio-engine decision. Validate before building the full guide UI.

- [ ] P01.1 Prepare original/instrumental pairs and click-track fixtures; measure
  decoded alignment, duration, encoder offsets, and any variable drift.
- [x] P01.2 Implement monotonic clock probes, offset/uncertainty estimates, future
  starts, and mapping from server time to each device's audio clock.
- [ ] P01.3 Play the instrumental on one laptop and original on one phone; require
  a user tap to unlock audio on both.
- [ ] P01.4 Measure audible alignment through recorded outputs; distinguish clock
  estimates, output delay, and real measured guide-to-stage error.
- [ ] P01.5 Validate pause/resume, seek, late join, small drift, large-drift recovery,
  source cancellation, and expired output gain deadlines.
- [ ] P01.6 Add `Earlier`/`Later` calibration with documented sign and persistence;
  test output-device changes and avoid double-applying latency estimates.
- [ ] P01.7 Measure decode time and peak memory for representative and long tracks;
  compare one required buffer versus preloading another track on real phones.
- [ ] P01.8 Evaluate wired and Bluetooth outputs separately, plus foreground,
  lock/unlock, network interruption, and suspended AudioContext behavior.
- [ ] P01.9 Record the chosen engine, drift thresholds, start lead, memory budget,
  supported device combinations, and fallback behavior in the architecture document.

Exit criteria:

- [ ] Repeated five-minute reference runs report p50/p95/max acoustic timing error
  and discontinuities; proposed supported-setup target is p95 at or below 50 ms.
- [ ] Alignment remains acceptable after pause/resume and seek, with no stale
  source continuing after cancellation or lease expiration.
- [ ] Memory/decode results are acceptable on the selected phone baseline.
- [ ] If the target fails, revise the engine or explicitly narrow supported setups;
  keep R08 unresolved until a usable guide experience is demonstrated.

Evidence: `server/ktv-clock.js`, `src/utils/partyClock.ts`, and
`scripts/party-clock.test.mjs` cover monotonic origins, low-delay sample selection,
new epochs, stale estimates, and invalid/delayed probes. `partyTimeline.ts` and
`partyAudioEngine.ts` map future starts into the output audio clock. Audio tests
compare client/server timeline boundaries, output timestamp/fallback mapping,
hash validation, memory limits, renewable scheduled stop deadlines and seek source
adoption. Three isolated Chrome 146.0.7680.71 sessions play a generated 45-second
fixture through the production build. This verifies software scheduling, not
acoustic timing or physical phone memory/browser support.

## 5. P02 — Room domain, storage, admission, and devices

Status: Complete

Likely files: `server/ktv/schema.js`, `repository.js`, `permissions.js`, `routes.js`,
integration in `server/db.js` and `server/index.js`. These paths are proposals.

- [x] P02.1 Add additive, restart-safe SQLite migrations for rooms, members,
  invitations, pairings/device grants, queue, playback, receipts, and bounded audit history.
- [x] P02.2 Add create/join/read/close endpoints using existing guest and Google
  identities; preserve one membership per room/user. Require a chosen room display
  name for a guest's first join, assign a server-generated random UUID membership
  ID, and reuse that ID/session on reconnect. Keep the internal user key separate.
- [x] P02.3 Generate and redeem secure invitation codes; support expiry, rotation,
  room lock, join limits, and optional approval.
- [x] P02.4 Implement admission waiting, approve/reject, remove/block, role changes,
  ownership transfer, and co-host restrictions from the permission matrix.
- [x] P02.5 Implement one-time room device pairing, display/controller scopes,
  credential hashing, expiry, and revocation without sharing global account tokens.
- [x] P02.6 Define authorized snapshots for host, member, paired display, and pending
  guest; omit secrets and private identity details.
- [x] P02.7 Persist durable mutations and idempotency receipts in one transaction;
  cover room creation and invitation redemption as well as room commands.
- [x] P02.8 Add room expiry/cleanup and constraints preventing conflicting host
  memberships, invalid foreign keys, and stale invitation reuse.
- [x] P02.9 Return typed errors and apply room-specific origin/rate/message limits.

Exit criteria:

- [x] Fresh and existing databases migrate correctly; restart retains room state.
- [x] A guest can create/join a room and pair a display without registering.
- [x] A direct invitation asks a new guest for a name, then admits them or shows
  approval waiting. Duplicate names remain distinct, and refresh preserves identity.
- [x] Pending, removed, expired, and unauthorized users cannot access admitted room state
  or execute controls through direct API calls.
- [x] Host transfer is atomic; removing a member revokes all room device grants.
- [x] Duplicate requests cannot create duplicate membership or duplicate rooms.

Evidence: `server/ktv-routes.js`, `server/ktv-schema.js`, and `server/ktv.test.js`.
The domain now includes transactional receipts for room creation/join, settings,
rotation, closure, pairing creation/redemption and device revocation, alongside the
existing queue/moderation/readiness/playback receipts. Encrypted pairing replies
survive a full service/database restart; replay rechecks current admission and
revocation. Rollback injection proves that identity or pairing receipt failures
cannot leave a partial room or consumed code/grant. The tab-scoped browser journal
keeps bounded pending IDs/hashes through reload without storing names or codes.

UTC room expiry and empty-since recovery, grant/code revocation, socket closure,
24-hour receipts, seven-day closed-room retention and per-room audit caps are
implemented. Startup validates configured member/song/device and retention bounds.
HTTP origin/body/rate checks complement the existing WebSocket limits. Returning
invitation lookup is read-only; new guests still choose a name, duplicate names get
distinct random member IDs, and pending guests recover only the approval screen.
Release `f1e21da` passes 76 full backend checks, 19 frontend unit checks and a
49-check exact-release production Chrome journey, plus 24 public protocol and
10 deployment checks. Physical browser/device acceptance remains open.

## 6. P03 — Realtime state, queue, and playback authority

Status: In progress

Likely files: `server/ktv/room-service.js`, `queue.js`, `realtime.js`, `clock.js`,
`src/types/party.ts`, `src/services/partyService.ts`, `src/stores/party.ts`.

- [x] P03.1 Attach `ws` to the HTTP server and add Vite/nginx WebSocket routing.
  Authenticate first-message tickets with timeout and explicit origin checks.
- [ ] P03.2 Serialize commands by room; enforce revisions, payload validation,
  current permissions, idempotency, and transaction-before-broadcast ordering.
- [x] P03.3 Broadcast authorized full snapshots; keep presence/telemetry separate.
  Implement reconnect/backoff, fresh ticket, snapshot, and clock negotiation.
- [x] P03.4 Implement queue entries, singer acceptance, request cancellation,
  request-next approval, fair rounds, host overrides, caps, and held entries.
- [x] P03.5 Add readiness and playback states with entry/performance/generation IDs;
  define effective transition times and reject obsolete ready/ended messages.
- [x] P03.6 Add device presence, designated output leases, stop acknowledgment,
  expiry, and host/co-host disconnect policy.
- [x] P03.7 Implement timeline/checkpoint persistence and new-clock paused recovery
  on process restart; persist no per-frame playhead writes.
- [ ] P03.8 Implement store command status, conflict recovery, snapshot replacement,
  and separate local preferences from authoritative room state.
- [ ] P03.9 Exercise simultaneous queue edits, retries after lost acknowledgments,
  duplicated `ended`, stale skips, and role revocation on open sockets.

Exit criteria:

- [ ] Three clients converge to one queue after simultaneous requests and reconnects.
- [ ] A command applies once even if resent over another transport after restart.
- [ ] The same song can appear in distinct entries without confusing completion.
- [ ] Only one current output lease exists, with a defined safe replacement boundary.
- [ ] Server restarts yield paused state and reject all old-clock readiness/schedules.

Evidence: `server/ktv-queue.js`, `server/ktv-realtime.js`, queue/receipt tables in
`server/ktv-schema.js`, and queue routes in `server/ktv-routes.js`. Members can add up to three pending
karaoke-ready songs, request next, and cancel their own unstarted entries. Hosts
can approve priority and move accepted requests next or back to fair order. Hosts
and co-hosts can remove/reassign unstarted requests, including held requests;
reassignment keeps requester attribution and requires recipient acceptance. The
host can set each singer's cap from one to ten without dropping existing requests.
Selected/active entries stay protected; ordering and assignment enforce revisions.
One-use tickets authorize short-lived WebSocket connections. Pending viewers get
waiting-only snapshots, admission/removal and queue changes broadcast after commit,
and removed/closed viewers lose their sockets. The browser reconnects with a fresh
ticket and randomized backoff; HTTP polling remains a fallback when disconnected.
Clock probes and browser offset/uncertainty estimates are implemented. Singer
nominations require acceptance, host/co-host invitations pin the selected turn,
and the singer confirms readiness against a performance ID, generation, clock
epoch, and room revision. Queue cancellation, removal, replacement, and restart
invalidate obsolete confirmations. The playback service adds device readiness,
scheduled transitions, renewable stage leases, stopped acknowledgment, restart
checkpoints and durable served-turn history. Completed/skipped/declined turns
automatically offer the next eligible fair turn and wait for readiness. Host-loss
graces, earliest connected co-host transfer and waiting without a moderator are
implemented; paired displays cannot preserve controlling host presence.
Core playback browser checks pass; physical multi-device testing remains open; latest
automated and deployment evidence is recorded in section 15.

## 7. P04 — Stage, phone controller, and moderation UI

Status: In progress

Likely files: `src/views/party/{PartyHome,PartyJoin,PartyRoom,PartyStage,PartyPair}.vue`,
`src/components/Party/*`, router/App integration, and `src/locales/{en,zh}.json`.

- [x] P04.1 Add routes, entry navigation, create room, typed invitation, share link,
  QR display, paired device setup, and waiting/admission screens. Direct invitations
  prefill the code and ask unregistered guests for `Your name`, with no signup step;
  returning admitted members reconnect directly.
- [x] P04.2 Build the common stage with readable lyrics, singer, progress, countdown,
  up-next entries, muted-viewer state, and host-controlled invitation visibility.
- [x] P04.3 Build phone Songs and Queue tabs using existing catalog/search helpers;
  show requester/singer attribution, caps, priority request status, and readiness.
- [x] P04.4 Build People and host controls for approval, removal, roles, stage
  assignment, invitation rotation, room locking, and settings.
- [x] P04.5 Build the Sing tab shell: enable guide, personal volume, timing correction,
  required/optional guide preference, lyric view, and connection status.
- [x] P04.6 Add scoped action availability and server-error feedback; a disabled
  button is presentation, with the server retaining authority.
- [x] P04.7 Extract/inject the lyric playback interface so stage rendering uses
  party state and permitted callbacks rather than the solo player store.
- [x] P04.8 Add party layout/audio ownership hooks in App; handle global controls,
  keyboard/media-session actions, floating recorder, and solo-player restoration.
- [ ] P04.9 Complete Chinese/English strings, keyboard/focus support, touch targets,
  small-screen layout, large-screen readability, and fullscreen fallback.

Exit criteria:

- [ ] A host and two guests complete the room/queue journey across laptop and phones.
- [ ] Multiple devices for one member display one person in the participant list.
- [ ] Host-only commands remain inaccessible through ordinary participant controls.
- [ ] Entering party mode cannot accidentally start a competing solo queue/recorder.
- [ ] Audio readiness is visibly pending until P05 is wired; no simulated success
  is presented as working playback.

Evidence: `src/views/PartyHome.vue`, `PartyJoin.vue`, `PartyRoom.vue`, navigation,
party API client, English/Chinese strings, and party mode in `src/App.vue`.
The room now searches the existing karaoke catalog and shows the shared plan;
the stage displays pinned lyrics, song progress and countdowns for prepared playback.
`npm run type-check` and `npm run build` pass. Room state now uses WebSocket
snapshots when connected and HTTP polling every three seconds while disconnected.
A waiting view remains until a song is prepared. A pairing page,
scoped screen/controller views, and device disconnect controls are implemented.
The People panel includes co-host roles, transfer, decline, block/unblock, and
restoration with role-specific action availability. Paired displays omit pending
guests and excluded-member history; declined guests see only their own state.
The controller can nominate singers, accept/decline songs and confirm a selected
turn; the stage shows that singer/song and the human readiness state. Connection
details show clock estimates, explicitly separate from headphone/speaker timing.
Stage selection, explicit audio enablement, personal guide volume/calibration and
host prepare/start/pause/resume/seek/skip/lyric-correction controls are wired.
Three isolated Chrome sessions pass 42 playback/recovery/output and phone-UI checks without runtime exceptions. Stage and singer use separate Chrome 146.0.7680.71 processes with headless foreground scheduling flags.
The controller has four persistent tabs with arrow/Home/End keyboard focus, a singer turn prompt and server-provided request caps. Local invitation/pairing QR codes have accessible links; an independent OpenCV decoder matches both links. The host controls common-screen invitation visibility, which defaults off, follows rotation and hides when locked. Fullscreen has an explicit exit and a separate refusal state. Broader accessibility, returning-invite recovery and physical acceptance remain open.

Queue action availability now matches the active-performance boundary and typed
server denials. `PartyPlaybackPanel` receives a typed `usePartyPlayback` interface:
lyrics/progress come from the authoritative party timeline and pinned assets,
with `parseLrc`/`singingGuideState` shared helpers. Controls emit permitted callbacks
to the room API; the panel does not import the solo player store. Scope/error and
party lyric interface software items are complete. Full audio ownership/media
session, PWA upgrade, broad accessibility/browser and physical-device checks remain
open in P04.8/P04.9 and P06.

## 8. P05 — Production playback and private vocal guide

Status: In progress

Likely files: `src/services/partyAudioEngine.ts`, `src/composables/usePartyClock.ts`,
`usePartyAudio.ts`, asset descriptor support, and lyric-view integration.

- [ ] P05.1 Integrate the P01 engine with real room snapshots and playback commands;
  acquire/release application audio ownership and clean up sources/listeners.
- [x] P05.2 Resolve and pin original/instrumental/lyric versions and timing offsets,
  including imported songs, missing stems, and manual-lyric catalog entries.
- [x] P05.3 Implement bounded preload/decode, required-device readiness, preparation
  timeout/retry, future countdown start, and optional-guide late attachment.
- [x] P05.4 Implement scheduled pause/resume/seek/skip, generation cancellation,
  exactly-once completion, and preparation of the next singer's entry.
- [x] P05.5 Wire private original playback, guide volume, calibration and output
  change handling; other phones remain silent until enabled.
- [ ] P05.6 Wire room lyric correction and pinned lyrics; separate device audio
  calibration from lyric correction and existing solo local-storage settings.
- [x] P05.7 Add measured drift policy, fade/recovery, buffer health, clock uncertainty,
  and clear required-guide versus optional-guide failure behavior.
- [ ] P05.8 Enforce output-lease silence using audio scheduling and recovery guards;
  test a suspended old stage while a replacement is designated.
- [x] P05.9 Add player diagnostics with no credentials/audio capture in logs and
  distinguish acoustic measurements from calculated timing estimates.

Exit criteria:

- [ ] Stage instrumental and phone guide pass the P01 acoustic target using the
  integrated application, including seek and mid-song guide enablement.
- [ ] Every admitted stage sees the same song/queue; only the designated local
  stage outputs room audio by default.
- [ ] Device preferences never change the public backing mix or another guide.
- [ ] Required-device failures prevent unsafe starts; optional viewers do not block.
- [ ] Solo playback and existing lyric behavior still work after leaving the room.

Evidence: `server/ktv-assets.js`, `server/ktv-playback.js`,
`src/services/partyAudioEngine.ts`, `src/composables/usePartyPlayback.ts`,
`src/components/Party/PartyPlaybackPanel.vue`, fifteen clock/audio tests, seventeen
playback/asset backend tests, one real HTTP/WSS playback integration test and a
27-check Chrome production-build journey. Pinned originals, backings and lyrics,
private guide, calibration, scheduled controls, lease stops, checkpoint
recovery and source cancellation are implemented. Required-guide gating/failure,
current-generation guide heartbeats, guide readiness across seeks, served-turn
declines, fair next readiness and host-loss transfer are implemented. Timestamp
phase diagnostics, estimate-only fallback, drift/output faults, explicit retries,
headphone correction reset and slow-output late attachment are implemented and
tested. Physical alignment and real device-change coverage remain open. This is a preview; the P01/P05 exit criteria are not complete.

## 9. P06 — Recovery and local beta validation

Status: In progress

- [ ] P06.1 Verify network drop/reconnect for controller, guide, and designated stage;
  include losing an acknowledgment immediately after a successful command.
- [ ] P06.2 Verify host loss with and without co-host, host transfer, singer removal,
  room expiry, invitation rotation, and stale paired-device credentials.
- [ ] P06.3 Restart the backend while playing; validate paused checkpoints, new clock
  identity, revoked leases, and deliberate resumption.
- [ ] P06.4 Validate Chrome desktop, Safari desktop, iOS Safari, and Android Chrome
  as available; record actual OS/browser versions and unsupported combinations.
- [ ] P06.5 Check autoplay refusal, locked screen, background/foreground, output
  changes, Bluetooth, low-memory decode, and long songs on physical devices.
- [ ] P06.6 Add explicit no-store/service-worker exclusions for all room state,
  tickets, grants, and media tokens; validate upgrades with an installed old PWA.
  Software exclusions, offline behavior and a synthetic installed-old-worker
  upgrade pass 6/6 locally; field-installed old PWA validation remains open.
- [ ] P06.7 Run permission/admission abuse cases, origin validation, bounded message
  sizes/rates, and escaped user-supplied room/member text.
- [ ] P06.8 Measure the planning load of 20 members and bounded device/queue counts;
  record socket memory, command latency, snapshot fanout, and database behavior.
- [ ] P06.9 Complete the local acceptance scenarios and support/limitation notes.

Exit criteria:

- [ ] R01–R11 and R14 pass on the supported local setup.
- [ ] No stale device continues audible output after its tested lease boundary.
- [ ] No removed participant can rejoin with an existing room grant or socket ticket.
- [ ] No cached stale room snapshot is presented as live state after reconnect.
- [ ] Load/browser results and all remaining defects have evidence and severity.

Evidence: Backend tests cover required/optional guide loss, current/stale guide
heartbeats, seek-boundary readiness, device replacement silence, checkpoint
restart, host grace/return/multiple controllers, co-host choice and atomic role
rollback. Real HTTP/WSS verifies guide command permissions and durable retries,
next readiness and declined-turn receipts. Physical and broader browser gates remain open.

## 10. P07 — Online and hybrid performance

Status: In progress

Deliverables: a media transport decision, performance capture/publishing, remote
audience playback, and tested performer handover. This phase implements R12–R13.

- [ ] P07.1 Spike an established SFU, initially evaluate LiveKit; record hosted or
  self-hosted choice, cost/capacity assumptions, region, TURN, and network requirements.
- [ ] P07.2 Build separate local-monitor and publish graphs: guide remains private;
  published audio contains instrumental plus microphone exactly once.
- [ ] P07.3 Measure microphone/input/output delay and calibrate published backing
  alignment; verify actual singing alignment rather than only matching graph clocks.
- [ ] P07.4 Generate scoped media tokens from room authorization; audience subscribes,
  the current generation's performer publishes, and other members cannot publish.
- [ ] P07.5 Integrate active revocation with the media server for removal, room close,
  lease expiry, performer replacement, and reconnect using an old unexpired token.
- [ ] P07.6 Implement publisher-captured lyric video synchronized with the published
  mix; validate mobile capture support and received A/V sync under jitter.
- [ ] P07.7 Build audience connection/playback states, audio enablement, and recovery;
  prevent an independently playing instrumental under the received performance.
- [ ] P07.8 Implement local-to-remote and remote-to-local performer handover with
  readiness, generation change, old-publisher stop/revocation, and stage routing.
- [ ] P07.9 Validate venue-mixer versus clean-mic capture, headphone leakage, feedback,
  no duplicate backing, and monitor/publish volume independence.
- [ ] P07.10 Measure real networks, forced TURN, reconnect, one-to-many load,
  performance latency, A/V timing, loss, and device resource usage.

Exit criteria:

- [ ] A remote guest hears backing and live singing aligned, while original guide
  audio is absent from the digital publish graph and leakage is assessed physically.
- [ ] Remote lyrics track received media delay, including under added jitter.
- [ ] A forced relay connection works and no unauthorized participant can publish.
- [ ] A removed or replaced performer loses publishing promptly at the media server;
  an old token cannot restore unauthorized room access.
- [ ] A physical-room audience and remote audience experience a full performer
  handover without competing backing tracks or an obsolete active publisher.
- [ ] Publish supported-device limits and measured streaming latency; no claim of
  simultaneous remote duet support.

Evidence: `npm run test:party:media` passes 23 synthetic foreground Chrome/SFU
checks with `livekit-client` 2.22.3, server SDK 2.19.1 and LiveKit server v1.13.7
pinned to digest `sha256:6fd3b7088874c4d119160dd688798dfec852bc014786d392caad15f6f63912a3`.
The harness creates and removes an owned loopback-only container, temporary
credentials/database and isolated browser contexts. Separate graph/capture tests
cover private-guide isolation, monitor independence, venue mix, calibration
invalidation and deadline blanking. Room-policy tests cover admission, paired
displays, atomic revocation triggers, lost issuance replies and publisher handover
blocked until provider acknowledgment. HTTP/worker checks cover mode receipt
replay, actor/device impersonation, provider failure and backend failure.
Repeatable commands: `npm test --prefix server`, `npm run test:party`,
`npm run type-check`, and `CHROME_DEBUG_URL=http://127.0.0.1:9231
CHROME_SINGER_DEBUG_URL=http://127.0.0.1:9230 npm run test:party:media`.
The Docker build uses a whitelisted context and copies no credential files.
P07 checklist items remain open until their integrated UI/network/device scope
has passed; component or toy-room spike evidence does not complete those gates.

## 11. P08 — Deployment and release verification

Status: In progress. Track local and online releases separately within this phase.

- [ ] P08.1 Add configuration/feature flags for rooms, guide, and online publishing;
  validate required runtime values without exposing secrets to frontend builds.
- [x] P08.2 Document database backup/migration, additive compatibility, HTTP/WSS proxy
  configuration, TLS/origin settings, and single room-process ownership.
- [ ] P08.3 For online release, provision and validate SFU/TURN endpoints, credentials,
  allowed origins, network paths, and media-server revocation integration.
- [ ] P08.4 Add bounded metrics/logs, readiness and drift diagnostics, alert thresholds,
  room expiry cleanup, and a practical support troubleshooting flow.
- [ ] P08.5 Run release checks, validate the built PWA and old-client upgrade flow,
  and document rollback to the prior build without destructive schema rollback.
- [ ] P08.6 Deploy to a test environment and complete a real multi-device party session.
- [ ] P08.7 Release the local milestone after P06; record URL/build/date and checks.
- [ ] P08.8 Release online/hybrid after P07; record media configuration and checks.
- [ ] P08.9 Verify post-release create/join/approval, queue, guide, pause/skip, reconnect,
  room close, and applicable streaming/host-handover behavior.

Local release gate:

- [ ] P00–P06 complete, relevant P08 work verified, and local limitations published.

Online/hybrid release gate:

- [ ] P07 complete, relevant P08 work verified, and remote support matrix published.

Evidence: Pending.

## 12. P09 — Optional enhancements

Status: Not started; these do not block the agreed core milestones.

- [ ] P09.1 Retain aligned vocal stems in the separation pipeline and expose
  independent backing/guide gain with asset-version compatibility.
- [ ] P09.2 Add opt-in performance recording and export with correct mix alignment.
- [ ] P09.3 Add reactions, voting, themes, or camera views after core controls are stable.
- [ ] P09.4 Investigate native DOM remote lyrics using a verified received-media
  clock mapping, replacing captured lyric video where support permits.
- [ ] P09.5 Evaluate multi-room horizontal scaling with explicit room ownership,
  shared event routing, and migration/failover behavior.
- [ ] P09.6 Study simultaneous remote duets separately; record latency limits and
  feasibility before committing to the feature.

Evidence: Pending.

## 13. Acceptance scenario register

All scenarios are initially unrun. Add evidence links and mark pass/fail when executed.

| ID | Scenario | Expected outcome | Phase | Result |
| --- | --- | --- | --- | --- |
| A01 | Guest creates room; second guest joins by code | One host, one admitted/pending member according to setting | P02 | Unrun |
| A02 | Pending guest calls room APIs and opens stage URL | No admitted room data or controls | P02 | Unrun |
| A03 | Same member pairs phone and TV | One participant, distinct restricted devices | P02/P04 | Unrun |
| A04 | Two guests request simultaneously; one retries after lost ack | Both accepted requests appear once or explicit conflict prompts retry | P03 | Unrun |
| A05 | Request next, host approval, then normal turns | Current song continues; visible override followed by fair rotation | P03/P04 | Unrun |
| A06 | Same song appears twice and multiple clients report completion | Exactly one entry completes; next entry remains distinct | P03/P05 | Unrun |
| A07 | Stage and phone guide run for five minutes | Measured p95 error meets supported-setup target | P01/P05 | Unrun |
| A08 | Host pauses, seeks, resumes; old ready/ended packet arrives | One valid timeline; obsolete packet ignored | P05 | Unrun |
| A09 | Optional guide fails; repeat with guide marked required | Guide-only recovery, then room pause in required case | P05 | Unrun |
| A10 | Stage loses connectivity and another device takes over | Old lease stops output before replacement becomes audible | P05/P06 | Unrun |
| A11 | Backend restarts during a song | Paused checkpoint, new clock ID, explicit readiness/resume | P06 | Unrun |
| A12 | Host disconnects with/without co-host | Documented transfer or pause-before-next policy | P06 | Unrun |
| A13 | Kick member with several devices; reuse grants and tickets | All revoked room capabilities fail | P06 | Unrun |
| A14 | Background/lock/unlock or change headphones | Honest suspended state, recalibration/recovery as needed | P06 | Unrun |
| A15 | No instrumental, no LRC, changed asset version | Clear fallback/error; no silent original substitution | P05/P06 | Unrun |
| A16 | Old installed PWA reconnects and new build becomes available | No stale authorized data; safe version/reload handling | P06/P08 | Unrun |
| A17 | Remote singer enables original guide | Singer hears guide; audience gets backing and live mic only | P07 | Unrun |
| A18 | Add network jitter to remote audience | Received lyric video and audio remain aligned within measured support limits | P07 | Unrun |
| A19 | Force TURN; remove active performer; reuse old media token | Relay works; publishing/access revocation is enforced | P07 | Unrun |
| A20 | Switch local singer to remote singer and back | Correct stage routing, one active performance and backing source | P07 | Unrun |
| A21 | Close/expire room and reopen old invitation/display links | Playback stops; access and new joins denied | P06/P08 | Unrun |
| A22 | Exit party and use existing solo karaoke | Solo controls/lyrics work; party audio and listeners are released | P05/P06 | Unrun |
| A23 | Open invitation in a fresh browser; enter name; join; refresh; another guest uses the same name | No registration required; random participant ID persists on refresh; duplicate names have distinct IDs; blank names rejected | P02/P04 | Unrun |

## 14. Verification strategy

Write tests for the room rules, authorization, concurrent/retried commands, clock
math, generations, and recovery behavior. Use deterministic fake clocks for domain
tests. Use temporary SQLite databases and real WebSocket clients for integration
tests. Browser automation covers flows and message handling; physical audio tests
establish timing and hardware behavior.

Existing checks, when the corresponding code changes:

```bash
npm run type-check
npm run build
npm run test:lyrics
npm run test:party
node --test scripts/player-order.test.mjs
npm --prefix server test
```

For the isolated production-build browser journey, start an owned disposable
Chrome instance with `--headless=new --no-sandbox --disable-dev-shm-usage
--remote-debugging-port=9229 --user-data-dir=/tmp/ktv-browser-owned-profile`, then
run `npm run test:party:browser`. `CHROME_DEBUG_URL` overrides the local DevTools
endpoint. For the release journey use a second owned Chrome for the singer and set
`CHROME_SINGER_DEBUG_URL` to its DevTools endpoint. Both foreground test processes
use `--disable-background-timer-throttling --disable-renderer-backgrounding
--disable-backgrounding-occluded-windows`. Run CPU-heavy backend/build checks before
the audio journey. These are headless harness conditions, not a physical-device
support claim. The script creates temporary SQLite identities, generated audio fixtures
and three separate browser contexts, then removes them. It verifies UI and source
scheduling; it does not record physical speaker/headphone output.

The backend test script includes both the existing dig suite and the KTV suite.
`test:party` covers clock estimation and monotonic service origins; scheduled audio
tests will be added with the audio engine. Preserve existing checks as room features
are integrated.

Suggested targeted coverage:

| Layer | Meaningful coverage |
| --- | --- |
| Domain | Fair rounds, overrides, admission/roles, single host, active entry transitions |
| Persistence | Additive migration, receipt atomicity, restart recovery, foreign keys |
| Realtime | Lost ack, reconnect snapshot, permissions after removal, ticket replay, revision conflicts |
| Timing | Clock offsets/uncertainty, scheduled boundaries, pause/seek, stale generation, lease deadline |
| Browser | Multi-device journey, audio unlock, UI permissions, old PWA, solo/party ownership |
| Physical audio | Acoustic alignment, output changes, drift, input alignment, guide leakage |
| Streaming | TURN, publish grants/revocation, received A/V sync, performer handover |

For acoustic evidence record track/version, device/OS/browser, wired/BT/TV output
chain, network, calibration values, run duration, sample count, p50/p95/max error,
dropouts, and measurement method. Repeat on the integrated app; a standalone
prototype result is not automatically a release result.

## 15. Progress, decisions, risks, and evidence

### Current next action

The room UI, publisher tap, lifecycle and supervisor shutdown are implemented and
verified in local checks. Complete the integrated guide/handover journey on a
real output device, provision a direct public DNS/certificate/ICE/TURN path, and
run physical phone and network acceptance. Keep the online flag disabled until
those checks pass. Complete remaining local/browser/PWA release gates alongside
streaming.
Physical phone/screen timing, memory, background behavior, broad browser coverage
and real streaming remain acceptance gates. Phone tabs and QR invitations are live;
general receipts, cleanup and returning-invite recovery are now deployed.

### Decision log

| Date | Decision / assumption | State | Revisit |
| --- | --- | --- | --- |
| 2026-09-29 | Build on existing Vue/Express/SQLite app | Proposed | P00 |
| 2026-09-29 | Local-first delivery; online/hybrid remain in scope | Proposed, user has not selected first public mode | P00 / release scope |
| 2026-09-29 | `ws`, full snapshots, server-owned commands/timeline | Proposed | P03 |
| 2026-09-29 | Original mix for first private guide; stems later | Proposed | P01/P05 |
| 2026-09-29 | 50 ms p95 local acoustic alignment target | Unvalidated target | P01/P05 |
| 2026-09-29 | Mixed WebRTC audio plus captured lyric video for remote audiences | Proposed | P07 spike |
| 2026-09-29 | Direct invitation entry; unregistered guests provide a name and receive a random participant ID without signup | Required guest-entry behavior | P02/P04 |
| 2026-09-30 | Former host becomes an ordinary member on explicit transfer; removed/declined members need moderator restoration, and blocked members must first be unblocked | Implemented policy; design section 4.1 | P02/P06 |

### Risk and blocker register

| ID | Risk / unknown | Next action | State |
| --- | --- | --- | --- |
| B01 | Audible phone/stage alignment may vary by output path | P01 measurement and calibration | Open risk, not a confirmed blocker |
| B02 | Whole-song decoding may exceed phone memory budget | P01 memory/decode study | Open risk |
| B03 | Mobile background audio/capture may suspend | P01/P06 support matrix | Open risk |
| B04 | Original and instrumental alignment/lyrics coverage vary | Asset validation and versioned descriptors | Open risk |
| B05 | Public relay DNS/certificate and physical lyric capture support remain unverified | Point the chosen direct DNS hostname at this app server, install a trusted TURN certificate, then run P07 network/device acceptance | Open deployment gate; `turn.micstec.com` currently resolves elsewhere |
| B06 | An older installed PWA may retain cached room authority | Field-upgrade an existing installation after the 6/6 synthetic upgrade/offline checks | Open field acceptance gate; new worker uses NetworkOnly |

### Evidence log

| Date | Phase / item | Commit or artifact | Verification | Result / limitations |
| --- | --- | --- | --- | --- |
| 2026-09-29 | Planning documents | `ktv_party.md`, `ktv_party_implement.md` | Repository source reviewed for integration points | Documentation only; no party implementation or acoustic results |
| 2026-09-29 | Guest invitation flow | Design section 3.4; P02.2/P04.1/A23 | Name, random participant ID, session reuse, and duplicate-name handling documented | API implementation and tests pass; browser acceptance remains unrun |
| 2026-09-29 | Baseline | `ktv-party-baseline-2026-09-29` at `6e8504b` | Local tag verified and pushed to origin before code edits | Rollback reference for main |
| 2026-09-29 | P02.2/P02.3 and partial P02/P04 | `server/ktv-*`, party views/service/routes, auth/store and app integration | `node --test ktv.test.js` 3/3; `npm --prefix server test` 30/30; `npm run type-check`, `npm run build`, and `git diff --check` pass | Invitation/approval slice only; browser, sync, queue, and stream checks remain open |
| 2026-09-29 | Invitation preview deployment | `https://music.micstec.com/party`, code commit `d1d9253` | Live API create → invite → join pending → approve → admitted → close passed; frontend route, bundle, service worker returned 200; deployed bundle contains `d1d9253`; backend health passed | Host and guest flow available for user testing; headless Chrome timed out in this environment, so UI browser acceptance and audio work remain open |
| 2026-09-29 | P03 queue-planning slice | `4c94e1b`; `server/ktv-queue.js`, queue routes/schema, `src/views/PartyRoom.vue` | KTV tests 5/5; full backend 32/32; type-check and production build pass | No WebSocket, playback, singer acceptance, or audio measurement |
| 2026-09-29 | Queue preview deployment | `https://music.micstec.com/party`, bundle `main-rnQzk0zj.js` | Live join → queue request → idempotent replay → host priority approval → shared snapshot → close passed; route and bundle returned 200; queue table created | Headless Chrome timed out in this environment, so browser UI acceptance remains open; predeployment DB/static backup at `/tmp/ktv-party-queue-predeploy.l0so35h0` |
| 2026-09-29 | P03 room sockets | `server/ktv-realtime.js`, `src/services/partyRealtime.ts`, `server/nginx-ktv-ws.conf` | KTV integration tests cover ticket replay, origin, pending redaction, broadcasts, reconnect, removal, close; frontend build passes | Deployed in realtime queue preview; clock messages, socket commands, presence, and audio timing open |
| 2026-09-29 | Realtime queue preview deployment | Backend `960b03d`, frontend `main-CAq48vee.js`, `https://music.micstec.com/party` | Public WSS upgrade, one-use ticket, pending redaction, approval, queue broadcast, removal revocation pass; backend tests 34/34 and build pass; nginx reload and health check pass | Browser UI acceptance and audio timing remain open; backup at `/tmp/ktv-party-ws-predeploy.jebxjh8t`, nginx backup at `/tmp/music.nginx.pre-ktv-ws.20260929` |
| 2026-09-30 | P02.5/P02.6 paired devices | `4dc9ac1`; `server/ktv-*`, `src/views/PartyPair.vue`, `src/views/PartyRoom.vue`, party API/device services | Backend 37/37, type-check, production build, and `git diff --check` pass | Physical two-device UI acceptance pending; no audio synchronization yet |
| 2026-09-30 | Paired-device preview deployment | `4dc9ac1`, frontend `main-D1bUwwWt.js`, `https://music.micstec.com/party` | Health, route, and bundle return 200; live guest → room → display pair/read-only/WSS/revoke → phone controller host setting → room close passed | Physical browser/phone acceptance pending; transient 502 only during backend restart; backup at `/tmp/ktv-party-pair-predeploy.gE52PwBy` |
| 2026-09-30 | P02.4 moderation and ownership | `b5b89b6`; `server/ktv-*`, `src/views/PartyRoom.vue`, party API and locales; design section 4.1 | KTV 14/14, full backend 41/41, type-check, release production build, and `git diff --check` pass | Physical UI acceptance, automatic host-loss transfer, playback, and streaming remain open |
| 2026-09-30 | Moderation preview deployment | `b5b89b6`, frontend `main-BUbZyAKB.js`, `https://music.micstec.com/party` | Live API/WSS co-host and paired-phone permissions, decline, block/unblock/restore, host transfer, role redaction, and receipt replay pass; temporary room closed | Physical UI acceptance pending; one health retry during restart; backup at `/tmp/ktv-party-moderation-predeploy.UMfCnUHw` |
| 2026-09-30 | Clock and singer readiness implementation | `a7fc3c6`; `server/ktv-clock.js`, `server/ktv-readiness.js`, clock estimator, party services/views and schema | Clock estimator tests 4/4; KTV integration tests 19/19 and full backend 46/46; type-check, production build and `git diff --check` pass | Human readiness only; stage audio, original guide, leases, timeline and acoustic testing remain open |
| 2026-09-30 | Clock and singer readiness preview deployment | `a7fc3c6`, frontend `main-DZatLVFa.js`, `https://music.micstec.com/party` | 13 live API/WSS checks pass: guest join, phone pairing, clock probes, singer-only acceptance, offer/readiness broadcasts, retry, cancellation and stale-generation rejection; seven route/asset checks return 200, deployed SHA verified, additive schema verified and foreign-key errors zero | Physical browser acceptance and acoustic timing unrun; observed 5–7 ms probe round trips are network timing only; temporary room closed; one health retry during restart; backup at `/tmp/ktv-party-readiness-predeploy.a8GJGzoy` |
| 2026-09-30 | Scheduled stage/guide playback implementation | `f87f0ff`; playback/asset services, schema, audio engine, Vue controls, `scripts/party-audio.test.mjs`, `scripts/party-browser.test.mjs` | Backend 54/54; clock/audio tests 8/8; type-check/release build and `git diff --check`; Chrome 146.0.7680.71 production-build journey 13/13 pass | Fixes verified for expired-lease resume and seek source adoption; software graph scheduling only, no acoustic or physical phone evidence |
| 2026-09-30 | Scheduled playback preview deployment | `f87f0ff`, frontend `main-C0oS5LfE.js`, `https://music.micstec.com/party` | 11 public API/WSS checks pass: paired display presence/scope, designation, real pinned assets and range requests, leases, start retry, effective pause, fresh resume lease, seek generation, forbidden member controls, idempotent skip; seven public route/assets return 200 and SHA verified; migration verified, foreign-key errors zero | Temporary room closed; backup at `/tmp/ktv-party-playback-predeploy.cq1lqlm2`; one health retry during restart. Physical alignment, required-guide policy, automatic next turn/host-loss, complete UI and online/hybrid remain open |
| 2026-09-30 | Required-guide, next-turn and host-loss implementation | Playback/schema/turn service, HTTP/WSS commands, guide/host UI and browser journey | Backend 63/63, clock/audio 8/8, Chrome 146.0.7680.71 production-build journey 20/20, type-check/build and diff check pass | Singer-bound required-guide gating, heartbeat/seek recovery, fair automatic next readiness and atomic co-host inheritance verified in software. Physical audio, output changes/drift, full phone UI and online/hybrid remain open |
| 2026-09-30 | Required-guide, next-turn and host-loss preview deployment | `323c922`, frontend `main-Ccfld-0j.js`, `https://music.micstec.com/party` | Backend 63/63; clock/audio 8/8; release Chrome journey 20/20; public recovery protocol 13/13; seven public route/assets, exact frontend SHA/hash, additive schema and zero foreign-key violations verified | Temporary room closed. Backup `/tmp/ktv-party-recovery-predeploy.y3xiwtl9`; health succeeded after two connection retries during restart. Physical audio, output changes/drift, receipts/cleanup, QR/tabs/accessibility and online/hybrid remain open |
| 2026-09-30 | Rendered drift/output recovery implementation | Audio engine/output monitor, device fault status and bilingual UI | Backend 64/64; clock/audio 15/15; production-build Chrome 146.0.7680.71 journey 27/27; type-check/build and diff check pass | Timestamp phase samples, estimate-only fallback, explicit output retry, calibration invalidation and slow-output late attachment implemented. Includes stale decode cancellation and loss of previously available timestamps. Browser sink events are simulated; physical audio/output detection remains unverified |

| 2026-09-30 | Phone tabs, invitation/pairing QR and common-screen controls | `PartyRoom.vue`, `PartyQrCode.vue`, bilingual UI, additive stage invitation preference and production browser journey | Backend 65/65 plus locked-screen invitation regression; clock/audio 15/15; release-candidate Chrome 42/42; independent OpenCV decodes match both QR links; type-check/build pass | Persistent Songs/Queue/Sing/People panels retain guide audio. Keyboard focus, server request caps, host-only stage invitation visibility/rotation/lock hiding and explicit fullscreen exit verified. Headless foreground flags and separate stage/singer processes used; physical timing, broader a11y, returning-invite recovery and streaming remain open |

| 2026-09-30 | Phone/audio-recovery preview deployment | `f701e9a`, frontend `main-1-asbyg9.js`, QR chunk `browser-BXdiCFWD.js` | Backend 65/65; clock/audio 15/15; exact-release foreground Chrome 42/42; public recovery protocol 18/18; public routes/assets/health/schema 10/10; both QR links independently decoded | Temporary public room closed. Backup `/tmp/ktv-party-phone-predeploy.lurd7md3`; one local connection retry during PM2 restart. Static hashes and embedded SHA match; additive invitation column and zero foreign-key violations verified. Physical audio, general receipts/cleanup, broader browser/PWA/a11y and online/hybrid remain open |
| 2026-09-30 | Durable room requests and lifecycle candidate | `server/ktv-receipts.js`, `ktv-lifecycle.js`, `ktv-policy.js`, `ktv-http.js`, invitation resolution, frontend command journal and browser fixture | Backend 76/76; frontend 19/19; production Chrome 48/48; type-check/build and diff check pass | Restart/encrypted reply and rollback, expiry/revocation/socket closure, empty-since persistence, bounded history/configured caps, origin/body/rate guards, duplicate-name guest entry and reload retry verified. Candidate check used a deterministic post-commit gateway 502; bare TCP resets may be transparently retried by Chrome. Exact-release/public gates follow. |
| 2026-09-30 | Durable-room preview deployment | `f1e21da`, `main-l1KzzXwT.js`, lifecycle/policy/receipt additive schema | Backend 76/76; frontend 19/19; exact-release foreground Chrome 49/49; public protocol 24/24 and deployment 10/10; type-check/build/diff checks pass | Both temporary public rooms closed. Backup `/tmp/ktv-party-durable-predeploy.3p9p3hv8` includes consistent SQLite/static/previous source. One restart connection retry. Schema probe uses SQLite busy timeout; public fault probe captures the silence boundary before expired lease cleanup. Backend test waits for committed state rather than unrelated presence snapshots. Physical timing, remaining queue/UI/PWA and streaming remain open. |
| 2026-09-30 | Active-performance queue safeguard deployment | `49bd4d2`, `main-BLgb8FvF.js`, `main-B17ntvAM.css` | Backend 77/77; unchanged frontend unit checks 19/19; exact-release foreground Chrome 50/50; public protocol 25/25 and deployment 10/10; type-check/build/diff pass | Temporary public room closed; backup `/tmp/ktv-party-queue-boundary-predeploy.139w_e17`. One health connection retry. Browser reload test waits for a new document time origin, avoiding its old-DOM race. Current-song request actions cannot stop preparation/playback; pending request cancellation remains allowed. Held reassignment, visible host ordering/caps, player/PWA ownership and streaming remain open. |

| 2026-09-30 | Queue controls and party ownership release | `34fc55c`, host-order/reassignment/caps routes and UI, solo epoch guards, retained recorder result and bounded command journal | Backend 81/81; party units 20/20; solo units 10/10; Chrome 146 foreground release journey 59/59; public protocol 30/30; deployment 10/10; exact assets/additive schema/FKs verified | Backup `/tmp/ktv-party-queue-controls-predeploy.6j7f1h_o`; temporary room closed. Navigation polling retries only destroyed CDP contexts, uses actual Home link and fresh member snapshots. Physical audio/browser and online streaming gates remain open; continue implementation. |

| 2026-10-01 | P07 streaming implementation and P06.6 software upgrade gate | Local P07 branch code, `ktv_party_deploy.md`, private config generator and isolated PWA fixture | Backend 104/104; party units 40/40; media Chrome/SFU 23/23 including forced TURN; supervisor/process 9/9; private config 2/2; existing-app Chrome 59/59; PWA upgrade/offline 6/6; build/type-check pass | Full integrated guide/handover browser journey is incomplete because the host virtual audio output stalled and capture recovery correctly stopped publication. Synthetic loopback and legacy-worker checks are not public network, field-installed PWA or physical phone acceptance. Online remains disabled. `turn.micstec.com` resolves to `54.165.17.203`, not this host's observed public `3.219.116.105`. |
| 2026-10-01 | Streaming-foundation preview deployment | `4a216be`, `main-D4pM4JGY.js`, `main-Be17GLqV.css`, `https://music.micstec.com/party` | Backend 104/104; frontend 40/40; solo 10/10; same-source local Chrome 59/59; exact-build isolated PWA 6/6; public HTTP/room checks 8/8 and WSS/cleanup 2/2; SQLite backup and live integrity/foreign keys pass; embedded SHA/assets verified | Online flag remains off and media routes return 404. Two exact-build Chrome audio reruns encountered unstable virtual output timing at different steps; full exact-build audio journey is not claimed. Both temporary public rooms closed. Backup `/tmp/ktv-party-media-predeploy.sSNSC8`; public TURN DNS/cert and physical phone/network acceptance remain open. |

### Work-session update template

```text
Date:
Phase and item IDs:
Status change:
Commit/PR or artifact:
What changed:
Checks run and results:
Device/audio measurements, if applicable:
Known limits or blocker:
Design/decision changes:
Next action:
```

### Release record

| Release | Build/commit | Environment/URL | Date | Gates and evidence | Remaining scope |
| --- | --- | --- | --- | --- | --- |
| Invitation preview | `d1d9253` (`main-DwOqCxch.js`) | `https://music.micstec.com/party` | 2026-09-29 | Live API smoke test and static route checks passed; browser UI check remains open; this is not the local KTV beta | Queue, audio, pairing, realtime, online/hybrid |
| Queue-planning preview | `4c94e1b` (`main-rnQzk0zj.js`) | `https://music.micstec.com/party` | 2026-09-29 | Live queue smoke test, static route/bundle checks, backend tests and build pass; browser UI acceptance remains open | Audio, WebSocket, singer acceptance, pairing, online/hybrid |
| Realtime queue preview | `960b03d` (`main-CAq48vee.js`) | `https://music.micstec.com/party` | 2026-09-29 | Public WSS flow, backend 34/34, build and route checks pass; browser UI acceptance remains open | Audio, clock negotiation, singer acceptance, pairing, online/hybrid |
| Paired-device preview | `4dc9ac1` (`main-D1bUwwWt.js`) | `https://music.micstec.com/party` | 2026-09-30 | Live pairing/API/WSS scope and revocation pass; backend 37/37, build and route checks pass; physical UI check open | Audio, clock negotiation, singer acceptance, complete moderation, online/hybrid |
| Moderation preview | `b5b89b6` (`main-BUbZyAKB.js`) | `https://music.micstec.com/party` | 2026-09-30 | Live API/WSS role and moderation checks pass; backend 41/41, release build passes; physical UI check open | Audio, clock negotiation, singer acceptance, general receipts, cleanup, automatic host-loss recovery, online/hybrid |
| Clock and singer readiness preview | `a7fc3c6` (`main-DZatLVFa.js`) | `https://music.micstec.com/party` | 2026-09-30 | Live API/WSS 13 checks, backend 46/46, clock tests 4/4, release build and public route/assets pass; physical UI check open | Audio scheduling, leases/timeline, lyrics, private guide, general receipts, cleanup, automatic host-loss recovery, online/hybrid |
| Scheduled playback preview | `f87f0ff` (`main-C0oS5LfE.js`) | `https://music.micstec.com/party` | 2026-09-30 | Backend 54/54, clock/audio 8/8, Chrome journey 13/13, public protocol 11/11, build, static assets and additive schema pass | Physical alignment, required-guide and drift/output recovery, next-turn/host-loss policy, receipts/cleanup, full phone UI, online/hybrid |
| Playback and recovery preview | `323c922` (`main-Ccfld-0j.js`) | `https://music.micstec.com/party` | 2026-09-30 | Backend 63/63, clock/audio 8/8, Chrome 20/20, public recovery protocol 13/13, release build/assets/additive schema verified | Drift/output changes and physical timing, receipts/cleanup, full phone UI and online/hybrid |
| Phone/audio-recovery preview | `f701e9a` (`main-1-asbyg9.js`) | `https://music.micstec.com/party` | 2026-09-30 | Backend 65/65, clock/audio 15/15, foreground Chrome 42/42, public protocol 18/18 and deployment checks 10/10; QR decodes, release assets and additive schema verified | Physical timing, receipts/cleanup, returning-invite flow, broad PWA/browser/a11y and online/hybrid |
| Durable-room preview | `f1e21da` (`main-l1KzzXwT.js`) | `https://music.micstec.com/party` | 2026-09-30 | Backend 76/76, frontend 19/19, exact-release foreground Chrome 49/49, public protocol 24/24 and deployment 10/10; restart/rollback, guest recovery, bounded cleanup and exact assets/schema verified | Queue/UI/PWA completion, physical timing/broader browsers and online/hybrid |
| Queue safeguard preview | `49bd4d2` (`main-BLgb8FvF.js`) | `https://music.micstec.com/party` | 2026-09-30 | Backend 77/77, frontend 19/19, exact-release foreground Chrome 50/50, public protocol 25/25 and deployment 10/10; active performance cannot be interrupted through request actions | Remaining queue/player/PWA integration, physical timing/broader browsers and online/hybrid |
| Queue/ownership preview | `34fc55c` (`main-7EC2G4Bt.js`) | `https://music.micstec.com/party` | 2026-09-30 | Backend 81/81, party units 20/20, solo units 10/10, foreground Chrome 59/59, public protocol 30/30 and deployment 10/10; exact assets/schema/FKs verified | Physical timing, broad PWA/browser/a11y and online/hybrid |
| Streaming-foundation preview | `4a216be` (`main-D4pM4JGY.js`, `main-Be17GLqV.css`) | `https://music.micstec.com/party` | 2026-10-01 | Backend 104/104; party units 40/40; solo 10/10; local Chrome 59/59 on same source before SHA build; exact-build PWA 6/6; public release checks 10/10; DB integrity/FKs and assets/SHA verified | Online flag disabled; exact-build audio journey stalled on host virtual output; public relay and physical phone/network acceptance open |
| Local beta | — | — | — | Pending M2/local P08 gate | Online/hybrid |
| Online/hybrid beta | — | — | — | Pending M3/online P08 gate | Optional P09 enhancements |
