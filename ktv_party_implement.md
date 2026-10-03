# KTV Party — Implementation Plan and Progress

Created: 2026-09-29

Last updated: 2026-10-03

Design reference: [ktv_party.md](ktv_party.md)

Implemented contracts: [ktv_party_protocol.md](ktv_party_protocol.md)

## Remaining release work

The core room, invitation/guest, moderation, queue, shared-screen, phone-control,
scheduled playback and private-guide software is implemented. The deployed app
is a preview; public online media is still disabled.

1. **Audio reliability:** finish stalled/early-stop handover safety and release the
   receiver output guard. The deployed raw receiver can remain audible until expiry
   +273.08 ms with a 1000-ms target. The private guard passes 20 isolated native
   checks and a 64-check clean room/recovery/handover journey. Early stage-stop
   acknowledgments now preserve already issued receiver deadlines before replacement
   output starts; backend regressions and 31 native direct-WebRTC checks pass.
   Full SFU fault acceptance, sustained/physical output and the earlier render-clock
   stall remain open. Legacy media clients are now refused streaming credentials;
   an unchanged deployed version-1 browser retains room access without receiving
   an unguarded media connection.
2. **Streaming timing:** resolve impaired-network A/V timing, measure handover
   timing and longer outages, and verify source-clock stability. Functional
   reconnect/handover passes do not establish acceptable audible/video alignment.
3. **Physical stage/phone measurements:** demonstrate five-minute guide/stage
   acoustic alignment at p95 <= 50 ms; test pause/seek, calibration, output changes,
   lease-expiry silence, wired/Bluetooth outputs, microphone delay and leakage.
4. **Device acceptance:** test iOS/Android/Safari, autoplay, lock/background/resume,
   installed-PWA upgrades and representative long-song memory/decode behavior.
5. **Capacity and real networks:** validate nominal-quality 59-audience and
   representative multi-room loads, plus distinct physical Wi-Fi/LTE paths.
6. **Release:** complete a real multi-device party, deploy the persistent supervised
   SFU/TURN service, run release/post-release checks and enable public media after
   the applicable P06/P07/P08 gates pass.

Recording/export, reactions, themes and remote duets remain optional P09 work.

Current status: The encoded publisher expiry preview is deployed at
`https://music.micstec.com/party` with frontend `d33b209`, backend `f58a8f3`
(`main-DU8DSm-f.js`, `main-DnE6rWx5.css`,
`partyLeaseGuard.worklet-BWdT3O5D.js`, `partyEncodedLease.worker-BxVsrNxp.js`).
Online media remains disabled. Native render and encoded-frame gates now pass
**15/15** independent lease checks on both Chrome 137 and 154, including an actual
separate WebRTC receiver after source clock freeze/resume. This replaces the
earlier same-context publisher observation that missed a late burst.
Exact `d33b209` build/type-check, UI **45/45**, PWA **10/10**, full clean native
streaming/recovery/handover **56/56** and public release **23/23** pass; party units
**105/105** pass. The same stage engine in committed `28bde60` also passes **41/41**
integrated native stage replacement checks: two independent outputs, actual room
backend and blocked/frozen/resumed clocks. Physical output acceptance is open. A subsequent buffered-receiver test fails
the deployed expiry boundary. A private receiver output candidate now passes
20 isolated native checks and a 64-check clean room journey; it has not been
released.
The PWA activation fix is deployed: failed updates retain the current page and
allow retry; empty catalogs no longer trigger phantom song downloads. Exact-build
UI/PWA checks also reject malformed room responses without losing the form.
Lyric capture cadence and authorized screen-content classification are deployed;
clean native A/V passes 40 transitions with no unmatched edges, p95 **70.36 ms**
and maximum **97.70 ms**, after a real **50.21-ms** output interruption.
Impaired timing still fails. Matching worker image `ktv-party-media:f58a8f3`
passes supervisor and public direct/TLS-TURN revocation checks; no persistent
media container is running.
Output lease renewal and bounded provider-readiness retries are deployed.
Continuous TCP/UDP impairment passes functional audience recovery and full hybrid
handovers; shared receiver CNAME/MSID passes. Impaired A/V timing, sustained native
publisher drift and physical/mobile acceptance remain open.
Members can connect a shared screen or phone
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

The queue safeguard preview was `49bd4d2` (`main-BLgb8FvF.js`, `main-B17ntvAM.css`). Queue
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

The streaming-foundation preview used backend `6c73d58` and frontend `4a216be`
(`main-D4pM4JGY.js`, `main-Be17GLqV.css`) at the same URL. It includes the streaming code and room
cache protection with online media disabled. The release build, PWA upgrade
check 6/6, public HTTP/room/WSS smoke checks 10/10, SQLite integrity and foreign
keys passed. The local browser journey passed 59/59 with the same source before
the release-SHA build; two exact-build reruns encountered the host's virtual
audio clock stalling at different steps, so exact-build audio acceptance is not
claimed. Public rooms from release checks were closed. Backup:
`/tmp/ktv-party-media-predeploy.sSNSC8`.
The queue-only 25 ms broadcast batch was subsequently deployed as `6c73d58`,
with public queue/WSS/replay/cleanup checks 4/4 and backend tests 104/104.
Its backup is `/tmp/ktv-party-queue-fanout-predeploy.2dFKHO`.

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
frontend at that milestone was `4a216be` and backend was `6c73d58`, with online mode unavailable until relay and physical gates pass.

TURN deployment preparation now uses `ktv-turn.3.219.116.105.sslip.io`, resolving
directly to this server. A trusted Let's Encrypt certificate, restricted ACME
challenge route, six-hour renewal timer and AWS/IPv4 UFW media rules are installed.
Certificate tests 4/4, the actual renewal service and staging renewal dry run pass.
The supervised public media service and different-network transport acceptance
remain open; provisioning network access is not a streaming release.

Audio startup now waits for three stable native render-clock intervals, with a
bounded eight-second timeout, before declaring the device enabled. Pending startup
can be cancelled by disabling audio, output changes or navigation. Switching off
a private guide during startup cannot decode stale audio or stop the microphone.
The UI shows startup timing checks. Party unit checks 46/46, type check and build
pass. The integrated SFU journey still reaches provider-ready audio/video and
guide-free audience audio, then the native virtual output loses seconds and
correctly enters drift recovery. A separately owned PulseAudio sink reproduces
the same failure; complete guide/handover and physical acceptance remain open.

The next UI/capture checkpoint adds cancellation before microphone acquisition,
English/Chinese recovery messages that omit arbitrary provider error text, 44 px
touch controls, keyboard focus and wrapping of long room/member/song names.
Party units pass 49/49 and the built-app UI checker passes 29/29. Protocol and
reference contracts now live in `ktv_party_protocol.md`. This checkpoint is
deployed; it does not resolve streaming/device acceptance.

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
| P00 | Scope baseline and technical contracts | Design | Complete | Protocol/reference inventory, configurable limits/timing, coordinated validation and durable restart-silence policy documented and verified |
| P01 | Two-device audio feasibility prototype | P00 minimum timing contract | In progress | Monotonic clock estimator tested; audio prototype and acoustic measurements open |
| P02 | Rooms, identities, invitations, permissions, persistence | P00 | Complete | Transactional general/encrypted receipts, restart/rollback, guest recovery, expiry/retention, permissions and configured bounds pass backend/browser/public checks |
| P03 | Realtime state, commands, queue, leases | P02 | Complete (software) | Three real socket clients converge after concurrent edits/reconnect; durable queue command replay survives service/database restart; revision, permission, timeline and lease authority verified |
| P04 | Stage, phone controller, host UI | P02–P03 | In progress | Entry/join/pairing, Songs/Queue/Sing/People tabs, local invitation/pairing QR, moderation, readiness and guide controls; broad accessibility/physical coverage open |
| P05 | Scheduled playback, private guide, shared lyrics | P01, P03–P04 | In progress | Stage/guide/lyrics/controls pass Chrome journey; required-guide and rendered-drift/output recovery tested; physical timing open |
| P06 | Recovery, browser coverage, local release readiness | P02–P05 | In progress | Guide/stage loss, host transfer, restart and revocation have automated evidence; physical/device coverage open |
| P07 | Online performance streaming and hybrid operation | P01, stable P03/P05 contracts | In progress | Capture/authorization, continuous TCP/UDP impairment through audience recovery and hybrid handover, 19-audience fanout verified in synthetic tests; sustained A/V/native drift, failed device-ceiling setup, representative networks and physical/mobile acceptance open |
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

Status: Complete

Deliverables: implementation baseline, precise terminology, protocol/schema draft,
and reference device setup. Use the design's defaults where a routine decision is
needed; record assumptions without presenting them as user-confirmed decisions.

- [x] P00.1 Record whether the first public release is local, online, or hybrid;
  retain all required later modes in the milestone list.
- [x] P00.2 Record reference desktop/phone browsers, speaker path, headphone path,
  network setup, sample tracks, and existing deployment topology.
- [x] P00.3 Confirm the source inventory, Node runtime required by current SQLite
  usage, migration conventions, auth flow, media URL/CORS/Range behavior, and PWA cache.
- [x] P00.4 Specify command/snapshot schemas, room vs member vs device IDs,
  permission matrix, queue states, playback generations, clock IDs, and error codes.
- [x] P00.5 Finalize default limits, readiness/grace/lease timeouts, queue fairness,
  invitation/pairing lifetime, and retention policy as configurable values.
- [x] P00.6 Sketch create/join/waiting, stage, Songs/Queue/Sing/People, and host flows,
  including audio enablement, loading, rejection, removal, and reconnect states.

Exit criteria:

- [x] The contracts cover R01–R14 and identify which release supplies each one.
- [x] No room control path relies on global app-admin privileges or client-only checks.
- [x] Every timing field has a unit and clock origin; role and device capability
  rules are unambiguous enough to implement.

Evidence: `ktv_party_protocol.md` records the deployed local milestone, required
online/hybrid delivery, chosen desktop/phone/headphone reference and unverified
physical matrix, identities, permissions, schemas and clock origins. Node 25.2.1,
additive SQLite migrations and scoped auth are verified in this deployment.
A read-only production instrumental probe returned HTTP 206, an exact 16-byte
body and matching Content-Range; party assets use same-origin URLs. PWA/cache
behavior has the separate six-check upgrade test. Synthetic fixtures use a
45-second 440 Hz local track and 60-second streaming tones (backing 440 Hz,
mic 880 Hz, private guide 1729 Hz); these are not acoustic evidence. P00.5 now
uses validated runtime preparation/start/lease/margin/host/pairing/ticket/auth
timing, existing room lifetime/retention/limits, and persisted fairness/host-order
controls. `ktv_output_safety` retains the greatest lease/margin across restarts
and decreases in settings. Backend 121/121, party units 49/49, type check and
built-app UI 29/29 pass. P01/device and online release gates remain separate.

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

Status: Complete (software). Physical output silence/alignment remains in P01/P05/P06.

Likely files: `server/ktv/room-service.js`, `queue.js`, `realtime.js`, `clock.js`,
`src/types/party.ts`, `src/services/partyService.ts`, `src/stores/party.ts`.

- [x] P03.1 Attach `ws` to the HTTP server and add Vite/nginx WebSocket routing.
  Authenticate first-message tickets with timeout and explicit origin checks.
- [x] P03.2 Serialize commands by room; enforce revisions, payload validation,
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
- [x] P03.8 Implement store command status, conflict recovery, snapshot replacement,
  and separate local preferences from authoritative room state.
- [x] P03.9 Exercise simultaneous queue edits, retries after lost acknowledgments,
  duplicated `ended`, stale skips, and role revocation on open sockets.

Exit criteria:

- [x] Three clients converge to one queue after simultaneous requests and reconnects.
- [x] A command applies once when resent after reconnect, reload, or restart.
  The implemented protocol uses HTTP mutations and WebSocket snapshots/control
  messages; this does not claim a second WebSocket mutation endpoint.
- [x] The same song can appear in distinct entries without confusing completion.
- [x] Only one current output lease exists, with a defined safe replacement boundary.
- [x] Server restarts yield paused state and reject all old-clock readiness/schedules.

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
The checklist audit confirms the existing single-owner synchronous SQLite
transactions and post-commit broadcasts, revision checks, encrypted/durable
receipts, browser command journal, busy/error feedback, monotonic snapshot
replacement and separate device preferences. A new real HTTP/WebSocket test
connects three admitted clients, commits concurrent same-song requests, verifies
identical queues, edits during one client's disconnect, reconnects with a fresh
ticket, restarts all server/socket/database instances, replays an already
committed queue command, and checks convergence under a new clock epoch.
Existing tests cover duplicate completion, stale generation/revision rejection,
role changes on open sockets, one lease and restart safety boundaries.

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
- [x] P04.9 Complete Chinese/English strings, keyboard/focus support, touch targets,
  small-screen layout, large-screen readability, and fullscreen fallback.

Software evidence: the built-app UI checker passes 29/29 with English/Chinese,
320 px entry/pairing/host/guest pages, long names/song titles, 1280 px stage,
44 px controls, native keyboard tab focus and accessible names. Fullscreen exit
and fallback were exercised in the earlier 59-check Chrome journey. These are
desktop Chrome/viewport checks; physical readability, assistive technology and
the broader browser/device matrix remain phase exit gates.

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

- [x] P05.1 Integrate the P01 engine with real room snapshots and playback commands;
  acquire/release application audio ownership and clean up sources/listeners.
- [x] P05.2 Resolve and pin original/instrumental/lyric versions and timing offsets,
  including imported songs, missing stems, and manual-lyric catalog entries.
- [x] P05.3 Implement bounded preload/decode, required-device readiness, preparation
  timeout/retry, future countdown start, and optional-guide late attachment.
- [x] P05.4 Implement scheduled pause/resume/seek/skip, generation cancellation,
  exactly-once completion, and preparation of the next singer's entry.
- [x] P05.5 Wire private original playback, guide volume, calibration and output
  change handling; other phones remain silent until enabled.
- [x] P05.6 Wire room lyric correction and pinned lyrics; separate device audio
  calibration from lyric correction and existing solo local-storage settings.
- [x] P05.7 Add measured drift policy, fade/recovery, buffer health, clock uncertainty,
  and clear required-guide versus optional-guide failure behavior.
- [ ] P05.8 Enforce output-lease silence using audio scheduling and recovery guards;
  test a suspended old stage while a replacement is designated. Native rendering
  guards cover blocked tasks and suspended stage/publisher clocks. Integrated
  built-app replacement passes 41/41 with two actual native outputs; physical
  speaker/output-buffer silence evidence remains open.
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
- [x] P06.7 Run permission/admission abuse cases, origin validation, bounded message
  sizes/rates, and escaped user-supplied room/member text.
  Backend admission, device scopes, untrusted origins, oversized HTTP bodies and
  rate-bucket tests pass in the 127-check release suite. Native built-app UI **42/42**
  now includes literal rendering of supplied HTML in room lists, participant names,
  queue titles and shared stages; `/tmp/ktv-ui-escaped-text.log`. No supplied event
  handler is installed or executed. This completes software abuse/escaping scope;
  physical/browser support criteria remain separate.
- [x] P06.8 Measure the planning load of 20 members and bounded device/queue counts;
  record socket memory, command latency, snapshot fanout, and database behavior.
  `npm run test:party:load` passes with a separate isolated server: 20 members,
  60 sockets, 100 songs; excess counts are denied and foreign keys stay valid.
  One capacity run of 80 commands in bursts of 20 measured p95 623 ms/max 972 ms,
  server RSS 114.7 MiB, heap 17.6 MiB and DB/WAL 368,640 bytes. These are local
  control-plane measurements; public transport and SFU load remain separate gates.
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

- [x] P07.1 Spike an established SFU, initially evaluate LiveKit; record hosted or
  self-hosted choice, cost/capacity assumptions, region, TURN, and network requirements.
- [x] P07.2 Build separate local-monitor and publish graphs: guide remains private;
  published audio contains instrumental plus microphone exactly once.
- [ ] P07.3 Measure microphone/input/output delay and calibrate published backing
  alignment; verify actual singing alignment rather than only matching graph clocks.
- [x] P07.4 Generate scoped media tokens from room authorization; audience subscribes,
  the current generation's performer publishes, and other members cannot publish.
- [x] P07.5 Integrate active revocation with the media server for removal, room close,
  lease expiry, performer replacement, and reconnect using an old unexpired token.
- [ ] P07.6 Implement publisher-captured lyric video synchronized with the published
  mix; validate mobile capture support and received A/V sync under jitter.
- [x] P07.7 Build audience connection/playback states, audio enablement, and recovery;
  prevent an independently playing instrumental under the received performance.
- [x] P07.8 Implement local-to-remote and remote-to-local performer handover with
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
P07.2/P07.4/P07.5/P07.7 software scope is complete: exact frontend `d6d4041`
passes the full built-app remote Chrome journey 20/20 with actual isolated room
policy/SFU, a native private-guide source, received mix/video, room-issued old-JWT
denial, provider-acknowledged nonce handover and one current audience player.
Evidence: `/tmp/ktv-stream-release-room-media.log`; party units 53/53 include lease
arrival/cancellation and delayed SDK unsubscribe/subscription regressions. The
app/CDP route uses loopback SSH forwards; direct media connects to the SFU host.
P07.1 selects the supervised self-hosted us-east-1 service and documents
capacity/transfer/operating-cost assumptions in design section 10.3.
Other P07 items and physical/network exit criteria remain open; this does not
prove mobile support, acoustic alignment or distinct access networks.

## 11. P08 — Deployment and release verification

Status: In progress. Track local and online releases separately within this phase.

- [x] P08.1 Add configuration/feature flags for rooms, guide, and online publishing;
  validate required runtime values without exposing secrets to frontend builds.
  Strict startup booleans, room HTTP/WSS denial, guide redaction/recovery, media
  revocation and local-mode fallback are implemented; public flags are no-store.
- [x] P08.2 Document database backup/migration, additive compatibility, HTTP/WSS proxy
  configuration, TLS/origin settings, and single room-process ownership.
- [ ] P08.3 For online release, provision and validate SFU/TURN endpoints, credentials,
  allowed origins, network paths, and media-server revocation integration.
- [x] P08.4 Add bounded metrics/logs, readiness and drift diagnostics, alert thresholds,
  room expiry cleanup, and a practical support troubleshooting flow.
  Aggregate admin health, fixed-label HTTP histograms, socket counts and private
  media readiness pass backend checks; log rotation is installed and validated.
  Deployment/support procedure and thresholds are in `ktv_party_deploy.md`.
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

Results distinguish automated software evidence from physical-device acceptance.
Completed software checks do not close a hardware or acoustic gate.

| ID | Scenario | Expected outcome | Phase | Result |
| --- | --- | --- | --- | --- |
| A01 | Guest creates room; second guest joins by code | One host, one admitted/pending member according to setting | P02 | Software pass: [HTTP/admission tests](server/ktv.test.js); public preview checks |
| A02 | Pending guest calls room APIs and opens stage URL | No admitted room data or controls | P02 | API/socket redaction passes [room tests](server/ktv.test.js); full device acceptance open |
| A03 | Same member pairs phone and TV | One participant, distinct restricted devices | P02/P04 | Software scope/revocation passes [pairing tests](server/ktv.test.js); physical phone/TV open |
| A04 | Two guests request simultaneously; one retries after lost ack | Both accepted requests appear once or explicit conflict prompts retry | P03 | Software pass: concurrent clients, retries and restart in [room tests](server/ktv.test.js) |
| A05 | Request next, host approval, then normal turns | Current song continues; visible override followed by fair rotation | P03/P04 | Software pass: queue/active-turn safeguards in [room tests](server/ktv.test.js) and [playback tests](server/ktv-playback.test.js) |
| A06 | Same song appears twice and multiple clients report completion | Exactly one entry completes; next entry remains distinct | P03/P05 | Software pass: distinct entries and completion idempotency in [playback tests](server/ktv-playback.test.js) |
| A07 | Stage and phone guide run for five minutes | Measured p95 error meets supported-setup target | P01/P05 | Unrun |
| A08 | Host pauses, seeks, resumes; old ready/ended packet arrives | One valid timeline; obsolete packet ignored | P05 | Software pass: [playback boundaries](server/ktv-playback.test.js) and [built-app journey](scripts/party-browser.test.mjs); physical timing open |
| A09 | Optional guide fails; repeat with guide marked required | Guide-only recovery, then room pause in required case | P05 | Software pass: [guide policy](server/ktv-playback.test.js) and [built-app recovery](scripts/party-browser.test.mjs); physical output open |
| A10 | Stage loses connectivity and another device takes over | Old lease stops output before replacement becomes audible | P05/P06 | Isolated native expiry 15/15; integrated native blocked-task/suspended-clock replacement 41/41 with actual backend and two outputs; physical output/network acceptance open; [replacement fixture](scripts/party-stage-replacement-browser.test.mjs) |
| A11 | Backend restarts during a song | Paused checkpoint, new clock ID, explicit readiness/resume | P06 | Software pass: restart/checkpoint and new generation in [playback tests](server/ktv-playback.test.js) |
| A12 | Host disconnects with/without co-host | Documented transfer or pause-before-next policy | P06 | Software pass: grace, co-host choice, return and rollback in [playback tests](server/ktv-playback.test.js) |
| A13 | Kick member with several devices; reuse grants and tickets | All revoked room capabilities fail | P06 | Software pass: real socket revocation and paired-device scope in [room tests](server/ktv.test.js) |
| A14 | Background/lock/unlock or change headphones | Honest suspended state, recalibration/recovery as needed | P06 | Unrun |
| A15 | No instrumental, no LRC, changed asset version | Clear fallback/error; no silent original substitution | P05/P06 | Unrun |
| A16 | Old installed PWA reconnects and new build becomes available | No stale authorized data; safe version/reload handling | P06/P08 | Synthetic old-worker upgrade/blocked-activation retry passes 10/10; field-installed PWA open; [fixture](scripts/party-pwa-browser.test.mjs) |
| A17 | Remote singer enables original guide | Singer hears guide; audience gets backing and live mic only | P07 | Native synthetic room/mix isolation passes; physical singing/leakage open; [journey](scripts/party-room-media-browser.test.mjs) |
| A18 | Add network jitter to remote audience | Received lyric video and audio remain aligned within measured support limits | P07 | Controlled TCP/UDP timing fails; field acceptance open |
| A19 | Force TURN; remove active performer; reuse old media token | Relay works; publishing/access revocation is enforced | P07 | Public transport/revocation passes 14/14; distinct access networks open; [fixture](scripts/party-public-transport.test.mjs) |
| A20 | Switch local singer to remote singer and back | Correct stage routing, one active performance and backing source | P07 | Native synthetic continuous TCP/UDP handover passes; physical/multi-network session open; [journey](scripts/party-room-media-browser.test.mjs) |
| A21 | Close/expire room and reopen old invitation/display links | Playback stops; access and new joins denied | P06/P08 | Software pass: atomic expiry and open-socket closure in [room tests](server/ktv.test.js); physical silence open |
| A22 | Exit party and use existing solo karaoke | Solo controls/lyrics work; party audio and listeners are released | P05/P06 | Unrun |
| A23 | Open invitation in a fresh browser; enter name; join; refresh; another guest uses the same name | No registration required; random participant ID persists on refresh; duplicate names have distinct IDs; blank names rejected | P02/P04 | Guest name/random ID/returning admission software checks pass [room tests](server/ktv.test.js); complete fresh physical-browser journey open |

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

Public preview remains frontend `d33b209`, backend `f58a8f3`, with rooms/private
guide enabled and online media disabled. The unpublished receiver-safe version-2
production candidate passes 143 backend, 124 party, 69 native room/legacy, 45 UI
and 10 PWA checks. All three clean 40-pair A/V phases retain nominal quality.

Complete full SFU stalled/early-stop fault checks, sustained native output and
impaired-network A/V timing. Preserve the 150-ms p95 / 250-ms maximum targets,
nominal 1280x720/25-fps policy and all capture/matching bounds. Failed private codec,
transport and buffer experiments do not justify changing production policy.

Complete acoustic stage/guide and microphone/backing alignment, physical stale-stage
silence, Android/iOS/Safari, background/lock, output-switch/Bluetooth, installed-PWA
and real Wi-Fi/LTE acceptance. Validate the full nominal-quality device ceiling
and representative multi-room load. Synthetic EC2 runs do not close physical or
access-network gates. A coupled frontend/backend preview may keep media disabled;
persistent online/hybrid media requires the P07/P08 release gates.

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
| B05 | Public relay transport and physical lyric capture support remain unverified | Start the supervised media service and verify public ICE/TURN and physical capture | Direct IP-derived DNS, trusted certificate, renewal timer and AWS/UFW rules installed; public transport/device gate open |
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

| 2026-10-01 | P06.8 bounded load and queue fanout deployment | Backend `6c73d58`; `scripts/party-load.test.mjs` and separate server fixture; public frontend remains `4a216be` | Backend 104/104; public queue/WSS/idempotent replay/cleanup 4/4; separate-process local capacity probe passes at 20 members/60 sockets/100 songs, cap excess denied, no foreign-key errors | At capacity, 80 command samples in bursts of 20: p50 217 ms, p95 623 ms, max 972 ms; server RSS 114.7 MiB/heap 17.6 MiB; 420 queue snapshots/18,165,047 bytes; DB/WAL 368,640 bytes, 102 receipts and 122 events. Local control only, no streaming/media or internet capacity claim. Backend rollback backup `/tmp/ktv-party-queue-fanout-predeploy.2dFKHO`; public test room closed. |

### Work-session update template

Audio startup preview `1dfa35c` was deployed on 2026-10-01 with frontend
`main-B8OVLbnL.js`, retaining previous assets. Party checks 46/46, type check,
production build, exact-build PWA checks 6/6 and public deployment checks 7/7 pass.
Backend remains `6c73d58`, online flag off. Consistent backup:
`/home/mli/ktv-party-audio-predeploy.kb3dou1p`.

P08.4 diagnostics candidate passes backend 107/107
(`/tmp/ktv-observability-backend-final.log`): bounded counters/windows, completion
deduplication, aborted requests, alert thresholds, admin-only no-store access,
disabled-media schema compatibility and private-provider error redaction.
The installed logrotate rule passes dry-run validation; the existing timer is
active. No new streaming or physical-device acceptance is claimed.

The diagnostics backend `09879ac` was deployed with frontend `1dfa35c`.
Public checks 6/6 pass: anonymous and ordinary-role operator access denied,
authenticated no-store aggregate health, media flag disabled, backend health and
SQLite integrity/foreign keys. No public room or user was changed by these checks.
The backend restart was performed when no open room had preparing/scheduled/playing
audio. Backup: `/home/mli/ktv-party-diagnostics-predeploy.qm5g_kj6`.

Latest deployment preparation and audio startup evidence (2026-10-01):
`652affe` provisions the TURN certificate renewal tooling. Certbot staging renewal
passed (`/tmp/ktv-turn-renew-dry-run.log`); installed service returned success;
certificate tests 4/4 (`/tmp/ktv-turn-renew-tests-final.log`). Audio readiness and
guide cancellation tests pass 46/46 (`/tmp/ktv-audio-readiness-units-final.log`),
type check passes (`/tmp/ktv-audio-readiness-types-final.log`). Native Chrome probes
showed a running context stalled for about two seconds before clock progression.
Integrated default and isolated-sink journeys remain failed at rendered drift,
with provider-confirmed mixed audio/lyric video verified before recovery
(`/tmp/ktv-audio-readiness-room-media-final.log`,
`/tmp/ktv-audio-readiness-room-media-sink.log`). No physical alignment claim.

UI/capture and protocol checkpoint (2026-10-01): party units 49/49
(`/tmp/ktv-ui-errors-units.log`), build/type check
(`/tmp/ktv-ui-layout-build.log`) and real built-app Chrome UI checks 29/29
(`/tmp/ktv-ui-layout-browser.log`). Owned temporary SQLite rooms and browser
contexts were removed. P00.1–4/P00.6 contract documentation and P04.9 software
work were complete at that checkpoint; P00.5 runtime timing policy and
physical/browser phase exits were still open. Neither an exactly silent output node nor temporarily raising the
owned PulseAudio process priority resolved virtual render-clock stalls; both
experiments were reverted. The integrated SFU guide/handover journey still fails
its real drift guard (`/tmp/ktv-pulse-priority-room-media-final.log`).

UI/capture release `3e76e15` is now deployed (`main-B_OYznt7.js`,
`main-D0gBov56.css`), backend unchanged at `09879ac`. Exact-release UI checks pass
29/29 and PWA checks pass 6/6 on both owned Chrome processes after two update
timeouts during earlier runs; failure-state diagnostics were added to the PWA
checker, without claiming a product fix for those transient failures. Public
route/asset/SHA/health/SQLite checks pass 8/8; no public users/rooms were mutated.
Private backup: `/home/mli/ktv-party-ui-predeploy.ha8yz1jq`. Old hashed assets
remain available. The three nginx media locations are installed and validated;
isolated supervised transport checks follow below; this is not a live media release.

Public-origin transport validation found and fixed a deployment error: the pinned
LiveKit server advertises integrated TURN TLS at 443 regardless of its 5349
listener. `ktv-media-ice.js` now corrects only the configured URL in provider
join/reconnect replies, preserving temporary credentials and unknown fields.
Backend checks pass 115/115 (including binary/JSON and real WebSocket adapter
checks), party units 49/49, and the supervised same-host public-origin transport
probe passes 14/14: direct media, forced TLS relay (`relayProtocol: tls`, TLS-only
ICE servers), decoded video and provider-acknowledged revocation. The public
gateway also rejects revoked unexpired audience/publisher JWTs. Evidence:
`/tmp/ktv-public-transport-final.log`, `/tmp/ktv-ice-backend-tests.log`,
`/tmp/ktv-ice-party-tests.log`. The rebuilt release image also passes supervisor
process/SFU failure checks 9/9 (`/tmp/ktv-ice-supervisor-final.log`); TLS tooling
checks pass 4/4. Image ID:
`sha256:aa9ca968d91ba5f021d1986d3b1065e38f5a4419dd0de71f87cbef39aceb7811`.
The public
5349 certificate handshake validates with TLS 1.3. Production nginx exact media
routes are installed, private worker flags updated and the media image built;
the public room flag is still disabled and temporary containers are removed.
This does not establish different-network or physical/integrated-room acceptance.
The initial inventory of a second EC2 host stopped at a changed IP host-key
entry. The identical key was subsequently found in the existing trusted SSH
records; a scoped temporary known-hosts file pinned that already trusted key
without changing the original trust records. A temporary, isolated Chrome
137.0.7151.68 client on that host passed the public-origin transport probe
14/14 (`/tmp/ktv-public-transport-remote-first.log`): direct media, strictly
TLS-only relay, received audio/video bytes, ten decoded video frames, provider
revocation and rejection of revoked unexpired JWTs. Both media endpoints were
browser contexts on the second EC2 host, separate from the SFU host. This is
separate-host evidence, not Wi-Fi/LTE, acoustic or integrated-room acceptance.
The owned browser/profile, SSH forward, temporary SFU and private fixture files
were removed; existing services and production users/rooms were unchanged.

Timing policy checkpoint (2026-10-01): `ktv-timing.js` centralizes bounded
preparation/start/output/host/pairing/ticket/authentication durations; admitted
snapshots publish the operator policy without changing room permissions.
The additive singleton `ktv_output_safety` protects older leases through repeated
restarts and lower settings. Defaults remain 30 s preparation, 2 s local/6 s online
lead, 8 s lease and 500 ms margin. Tests cover exact preparation/pause boundaries,
custom local/online leads, lease/margin changes, repeated restart safety, bounded
pairing expiry, snapshot redaction and actual unauthenticated socket expiry.
Verified: backend 121/121 (`/tmp/ktv-timing-backend-final.log`), party units 49/49,
type check and current built-app UI 29/29 (`/tmp/ktv-timing-ui-final.log`).
P00 contracts/policy are complete; physical/browser and online acceptance remain
open. Deployment backup: `/home/mli/ktv-party-timing-predeploy.xkgmym9r`.

Timing backend `0e0c7aa` is deployed, frontend remains `3e76e15`. Public release
checks pass 11/11 (`/tmp/ktv-timing-public-release-final.log`): default timing in
HTTP and real WSS snapshots, pairing/ticket lifetime, media flag disabled,
operator no-store diagnostics, additive safety record and SQLite integrity/FKs.
The temporary room was closed and no public account/identity was added. One
initial probe omitted the admin role claim and was correctly denied before any
room mutation; the corrected fixture uses the existing app-admin role and DB
check. Backend warmup required connection retries. There was no active room
performance at restart. Defaults and the durable bound are 8000/500 ms.

Feature-switch checkpoint (2026-10-01): room, guide and media switches are strict,
immutable startup booleans. Room disablement blocks actual HTTP actions/socket
upgrades without closing durable rooms. Guide disablement clears requirements,
redacts original descriptors and preserves backing. Media disablement returns
open online/hybrid rooms to local mode and leaves old grants pending provider
removal; enabling it again does not resume old audio. Entry/join/pairing disabled
states and guide hints are bilingual. Backend checks pass 126/126
(`/tmp/ktv-feature-backend-final.log`), party units 49/49
(`/tmp/ktv-feature-party-final.log`), build/type check, built-app UI 38/38
(`/tmp/ktv-feature-ui-final.log`) and PWA 8/8 (`/tmp/ktv-feature-pwa.log`), including
live feature changes and offline refusal of cached flags. An initial UI fixture
failed because it did not open the Sing tab before checking the visible guide
hint; the fixture was corrected and final checks pass. P08.1 software is complete;
physical and integrated streaming acceptance remain open. Private predeployment
backup: `/home/mli/ktv-party-features-predeploy.r517kc57`.

Feature release `9b74e8f` is deployed. Exact-commit build UI checks pass 38/38
(`/tmp/ktv-feature-release-ui-final.log`) and PWA checks 8/8
(`/tmp/ktv-feature-release-pwa-final.log`). The first exact-build attempt found
that the owned Chrome watchdog had expired; a new isolated browser was started,
then both suites completed. Public release checks pass 18/18
(`/tmp/ktv-feature-public-release.log`): anonymous no-store flags, admin/HTTP/WSS
snapshot agreement, original timing defaults, exact asset bytes/SHA, temporary
room closure and SQLite integrity/FKs. There were no active performances at
restart, default rooms/guide remain enabled, media remains disabled and no user
identity was created. Backend warmup required two connection retries.

Integrated streaming checkpoint (2026-10-01): an owned Chrome 137 client on the
second EC2 host runs the built app, synthetic microphone, actual room policy and
SFU through private SSH app/CDP forwards and direct media ports. Native output
clocks and all existing drift/permission gates remain enabled. The first run
reached guide separation, then exposed a fixture race that confirmed the next
singer before Skip committed. Later runs exposed an application race: requesting
a publisher token from the scheduled snapshot before its lease arrived produced
403. The client now waits for a matching live lease; its regression covers
missing, foreign, stale and expired leases plus cancellation during issuance.
A subsequent handover received new media but retained an empty old player because
SDK detach could return no elements. Transport ownership now guarantees old
player cleanup and denies delayed subscriptions after close. Three regression
cases cover empty detach, replacement/old-event order and close/unauthorized tracks.

Candidate checks: party units 53/53 (`/tmp/ktv-stream-handover-party.log`), build/type
check (`/tmp/ktv-stream-handover-build.log`), integrated remote journey 18/18
(`/tmp/ktv-room-media-remote-handover-fixed.log`). Original guide scheduling is
confirmed from its actual 1729 Hz buffer source and native output timestamps;
received backing/microphone are present and guide tone stays at least 25 dB below
both. Handover leaves one authorized nonce and releases both microphone captures.
Owned remote profile/browser, SSH forwards, SFU and private fixtures were removed.
This closes the earlier virtual-host stall as a software test-environment limit;
it does not establish physical alignment, mobile support or Wi-Fi/LTE acceptance.
The original host's failed native-clock journeys remain historical evidence.
Final exact-commit release verification is complete: `d6d4041` build/type check,
UI 38/38 (`/tmp/ktv-stream-release-ui.log`), PWA 8/8
(`/tmp/ktv-stream-release-pwa.log`), and full remote room-media 20/20
(`/tmp/ktv-stream-release-room-media.log`). The final journey additionally denies
an unexpired room-issued publisher JWT after provider removal and requires ten
decoded replacement-video frames with exactly one audience player. Candidate
failure logs remain `/tmp/ktv-room-media-remote-first.log` (fixture Skip race),
`...-second.log`/`...-third.log` (scheduled-without-lease token race), and
`...-lease-fixed.log` (empty old player after replacement).

Frontend `d6d4041` is deployed, backend remains `9b74e8f`; no backend restart was
needed for these client fixes. Public release checks pass 18/18
(`/tmp/ktv-stream-public-release.log`): HTTP/WSS/default flags/timing, exact
`main-Df1mhgtD.js`/CSS bytes, source SHA, temporary room closure and database
integrity/FKs. No public user was added. The private predeployment backup is
`/home/mli/ktv-party-stream-predeploy.srose93n`; old hashed assets remain. Owned
local/remote browsers/profiles, SSH forwards and media fixtures were removed.
P07.2/P07.4/P07.5/P07.7 software items are complete. Physical alignment, mobile
capture/jitter and wider network/load scope remain open; public media stays disabled.
Hybrid software stage-route handover is verified in the following checkpoint.


Hybrid handover checkpoint (2026-10-01): the deployed `d6d4041` frontend and
current unchanged backend sources pass the extended built-app journey **38/38**
(`/tmp/ktv-hybrid-room-final.log`, process exit 0). An owned Chrome 137 browser
on the second EC2 runs a venue → remote → venue sequence against isolated actual
room policy, SQLite and SFU. Each turn requires readiness, a new generation,
a fresh provider-confirmed nonce and terminal old-publisher revocation before
replacement. The common-screen host captures synthetic venue input, switches to
received remote audio/video with every previous native backing source stopped,
and restores native local backing on the return venue turn. Each receiver has
one decoded video player. Venue input has no added digital backing/private-vocal
tone; remote input contains backing and microphone while private vocals stay absent.
Final capture stop leaves no publisher capability active. No runtime exceptions.
The initial extension passed 37/37 (`/tmp/ktv-hybrid-room-first.log`); the final run
adds actual native source-stop verification. Owned remote browser/profile, SSH
forwards, SFU and temporary database/assets were removed; no production state was
mutated. Repeat with the documented remote fixture configuration and
`KTV_ROOM_TEST_ROUTE_HANDOVER=1`.

P07.8 software implementation is complete. Physical venue feedback, headphone
leakage, actual mixer/input alignment, mobile capture, access-network impairments
and one-to-many streaming measurements remain required gates. Synthetic EC2
capture and separate browser contexts do not prove those criteria. No application
change or deployment was required; public media remains disabled.


Public fanout checkpoint (2026-10-01): `test:party:public-transport` now supports
an owned remote Chrome/CDP fixture without an app reverse tunnel or microphone
upload, plus bounded concurrent audiences (0–59) and measurement duration
(10–180 seconds). Load mode uses the app's single-video 350 kbit/s, 25 fps,
maintain-resolution settings and 64 kbit/s Opus/RED audio settings. Each receiver
plays actual audio. Reconnect clears old peer counters, and route classification
uses each peer transport's selected candidate pair, resolved within its own
stats report ([WebRTC stats definition](https://www.w3.org/TR/webrtc-stats/#dom-rtctransportstats-selectedcandidatepairid)).

Final run **21/21**, process exit 0: `/tmp/ktv-public-fanout-playout.log`.
One publisher and 19 remote Chrome 137 audience contexts (10 direct, 9 strict
TLS-only TURN) stayed connected over a 62.7-second simultaneous window. All
received 1280×720 video and played audio; each emitted at least 2,859,840 audio
samples. Reported RTP packet loss and dropped video frames were zero. Decoded
video averaged **12.89–12.94 fps**, below the nominal 25-fps capture setting.
Audio jitter-buffer averages were **230.41–358.73 ms**, video **165.10–247.31 ms**;
these are receiver buffer statistics, not measured end-to-end or A/V alignment.
Aggregate received RTP payload was about **5.30 Mbit/s**. Sampled supervisor/SFU
container CPU peaked at **50.83%** (Docker scale: 100% = one CPU), memory at
**183.2 MiB**. Host-network Docker NetIO was unavailable; RTP deltas supply the
transfer observation. Client CPU was not measured, so the FPS limit is not
attributed to a particular component.

An authorized audience deliberately disconnected, rejoined using its valid
credential, decoded new video and resumed actual audio playout. Every audience
then received provider-acknowledged removal and its old token was denied at the
public gateway; the publisher was likewise removed and denied. Owned browser,
profile, CDP tunnel, media container and private fixtures were removed. Ports
9243/3103/7880/7881/5349 were empty afterward. Public features still report
rooms=true, guide=true, media=false. Production users/rooms were not touched.

Earlier runs: `/tmp/ktv-public-fanout-first.log` and `...-final.log` passed 20
RTP/video-only checks with SDK default encoding. `...-measured.log` failed the
final nominated-pair route assertion while media continued; insufficient route
details were retained to determine that run's cause. `...-diagnostic.log` passed
20/20 with route details but decoded 960×540 under default simulcast; it is not
720p app-settings evidence. `...-app-settings.log` passed 20/20 at 1280×720 before
actual audio playout was added. Those historical runs do not substitute for the
final playout measurement or prove the intermittent assertion's root cause.

P07.1 is complete with the initial supervised self-hosted LiveKit choice in
us-east-1, capacity assumptions and operating-cost worksheet in design section
10.3. P07.10 remains open: short synthetic fanout and deliberate reconnect are
verified, but sustained/multi-room/device-ceiling load, nominal frame-rate under
representative clients, automatic network-drop recovery, imposed jitter/loss,
physical devices, real access networks, end-to-end latency and A/V timing remain
required. This one-browser separate-EC2 workload is not 19 physical devices or a
production support claim. No application deployment was needed; public media
remains disabled.


Audience recovery implementation checkpoint (2026-10-01): network loss now removes
the old audience player and requests fresh authorization after revocation, with
bounded attempts and a localized reconnecting state. SDK nonce reuse stays off;
the gateway still revokes a signaling connection's nonce and requires provider
acknowledgment. Stop/navigation/hidden page, admission/control loss, mode change,
explicit provider removal and HTTP authorization denial cancel recovery. Singer
loss still releases capture and enters explicit room recovery. Transport guards
reject terminal late tracks and prevent an audio-enable reply after Stop from
playing an old element. Recovery attempts do not nest when initial connect fails.

Candidate native remote integrated journey passes **46/46**
(`/tmp/ktv-room-reconnect-fresh.log`, exit 0), including actual audience and singer
signaling socket interruption, fresh audience nonce, old unexpired JWT denial,
automatic decoded playback and subsequent venue → remote → venue handover.
Party units pass **64/64** (`/tmp/ktv-reconnect-release-units.log`), including
provider-acknowledgment waits, Stop cancellation, bounded pending-removal retries,
undocumented HTTP denial and late audio-enable/connection replies. The initial
SDK-retry candidate failed (`/tmp/ktv-room-reconnect-first.log`): reconnecting with
a revoked nonce is intentionally denied; the final approach obtains a fresh nonce.
A test teardown originally restored its mocked API before pending revocation
finished; the fixture now awaits Stop before cleanup. Final exact-source release verification is complete: frontend `b9fbb91`
build/type check (`/tmp/ktv-reconnect-release-build.log`), UI **38/38**
(`/tmp/ktv-reconnect-release-ui.log`), PWA **8/8**
(`/tmp/ktv-reconnect-release-pwa.log`) and remote room journey **47/47**
(`/tmp/ktv-room-reconnect-release.log`, exit 0). The extra check confirms actual
received backing/microphone tones after automatic reauthorization, with the
private original still at least 25 dB below both. It includes native guide timing,
singer interruption and subsequent hybrid stage handover without runtime errors.

Frontend `b9fbb91` is deployed (`main-C3F6BNH-.js`, `main-D0gBov56.css`); backend
remains `9b74e8f`, with no backend restart. Public release checks **18/18**
(`/tmp/ktv-reconnect-public-release.log`, exit 0) verify actual HTTP/WSS/default
flags/timing, exact asset bytes/source SHA, temporary-room closure and database
integrity/FKs; no public identity was added. The private rollback backup is
`/home/mli/ktv-party-reconnect-predeploy.jsu4hbq7`; old hashed assets remain.
Owned local and remote browsers/profiles, tunnels and SFU/database fixtures were
removed and their listener ports were empty. Physical, access-network outage,
imposed jitter/loss and A/V gates remain open. Public media remains disabled.

#### 2026-10-01 — Controlled media impairment and P03 checklist audit

Media harness commit: `c0bf06e`; tested frontend remains `b9fbb91`, backend
implementation remains `9b74e8f`. These are test/document changes and require no
production rebuild or restart. Public media remains disabled.

Owned proxies forward unmodified encrypted TCP bytes or UDP datagrams to the
isolated SFU's actual interface. The remote Chrome 137.0.7151.68 fixture filters
and remaps only its remote ICE candidates, then verifies the actual selected
routes. Delay/jitter is injected on both publisher and audience media paths;
control HTTP/WebSocket traffic is independent. No host firewall/routing, native
audio clock, permission, output lease or drift guard was altered.

Final checks, all exit 0:

- Proxy behavior: **8/8**, `/tmp/ktv-media-proxy-final-units.log`.
- TCP full built-app sequence: **54/54**, `/tmp/ktv-media-tcp-release.log`.
- UDP full built-app sequence: **56/56**, `/tmp/ktv-media-udp-release.log`.
- Backend suite with new three-client convergence/restart test: **127/127**,
  `/tmp/ktv-convergence-backend-final.log`; targeted test also passes in
  `/tmp/ktv-three-client-convergence.log`.

The measured segment injects a 150 ms base plus 0–40 ms jitter per proxy leg;
UDP drops datagrams with 5% probability per leg. Both decode at least forty
additional video frames, retain backing/microphone tones and exclude the private
guide. The audience-only outage lasts **1,778 ms TCP / 1,786 ms UDP**, with a
three-second fixture safety bound. Video stops, the actual room-control socket
stays connected, and audio/video resume without changing the singer or room
playback state. Queues remain bounded without overflow. The profile remains
active through private-guide verification, then resets to zero before automatic
fresh-nonce audience recovery, publisher interruption and venue → remote → venue
handover. Those later steps pass through the same proxy.

UDP receiver sample: audio **374 received / 8 lost**, video **231 received / 6
lost / 147 decoded frames**; RTP jitter **13 ms audio / 26 ms video**; cumulative
average jitter buffers **54.68 ms audio / 67.37 ms video**. TCP sample reports
zero lost RTP packets and **87.35 ms audio / 37.39 ms video** average buffers.
These are software counters spanning initial and impaired playback, not acoustic,
end-to-end or A/V latency measurements. UDP proxy totals include deliberate
outage drops; they do not estimate a measured end-to-end loss percentage.

Fixture development failures remain recorded: loopback TCP forwarding received
no SFU replies until it used the advertised local interface; a UDP profile
assignment bug was caught by proxy tests; earlier 180-second WAV/continuously
impaired combined runs stopped before later recovery/handover completed, with
native output-timing recovery observed in one run. The final fixture retains the
existing 60-second song and scopes impairment to its measured segment. This does
not resolve sustained impairment during handover. Automatic fair-turn selection
also exposed a revision conflict in a fixture host request; the fixture now
refreshes that conflict with a fresh command ID and waits for genuine current
generation decode readiness. No application safety check was weakened.

P03.2/P03.8/P03.9 and P03 software exit criteria are now checked against existing
implementation and the new three-real-socket test. HTTP command replay applies
once after a complete service/database restart; WebSocket remains the snapshot,
clock and device-control transport. P05.1/P05.6 now reflect existing wired audio
ownership/pinned lyrics/room correction and separate device calibration. Physical
output silence, timing, browser and access-network criteria remain open.

All owned SFU containers, databases, proxies, browser profiles and SSH tunnels
were cleaned. Local TCP/UDP fixture ports and remote CDP 9243 were empty;
the three existing production containers remain running.

Next: measure A/V/end-to-end delay with explicit source/receiver markers, longer
media outages and continued impairment during handover, then sustained and
representative load. Complete physical/mobile and distinct Wi-Fi/LTE acceptance
before enabling persistent production media.

### 2026-10-02 — Sustained publishing fix, A/V measurement and failed impairment gate

A/V marker development exposed a real application defect: the public mix muted
roughly six seconds into a turn while the UI continued to say it was publishing.
The gate used the initial room-snapshot lease, while the backing engine received
new heartbeat leases over WebSocket. `301d5c3` exposes that current validated lease
from the playback controller and uses it for publishing and private originals.
Current device/clock/performance/generation and expiry remain enforced. A rejected
render-gate renewal now tears down capture and displays a permission error.
Eight added lifecycle tests cover renewed leases after snapshot expiry, each
invalid lease identity/expiry, missing authority and render-gate rejection.
`29a62cf` adds an explicit regression test for the already-existing shared audio/
video synchronization stream. No stream grouping change was necessary.

A/V instrumentation observes actual pinned lyric transitions and the real received
player. Receiver output is isolated in a separate private PulseAudio daemon;
public native stream APIs retain signed latency instead of the simple API's
negative-latency clamp. The monitor assembles 10 ms hops across irregular capture
fragments and detects 440/660 Hz with a 23.22 ms window. The receiver's additional
spectral analyser is attached only after timing observation. Source/receiver
browsers share one host clock domain; video uses expected display time. These are
software observations, not physical acoustic measurements or cross-host clock
synchronization claims. Logs retain markers/metrics without raw audio or tokens.

Checks and evidence:

- Party units **73/73**, `/tmp/ktv-av-final-party-units.log`.
- A/V fixture units **3/3**, including **3 Python DSP cases** for transitions,
  silence and capture-fragment invariance, `/tmp/ktv-av-final-fixture-units.log`.
- Build/type-check passes, `/tmp/ktv-av-signed-release-build.log`.
- Same application change in candidate build: UI **38/38**, PWA **8/8**,
  `/tmp/ktv-output-lease-release-ui.log`, `/tmp/ktv-output-lease-release-pwa.log`.
- Full no-impairment A/V/reconnect/hybrid candidate **51/51**,
  `/tmp/ktv-av-output-lease-release.log`: six transitions, no unmatched markers;
  observed skew p50 **23.86 ms**, p95/max **90.59 ms**. This precedes the improved
  signed-monitor/fragment handling and is retained as candidate evidence.
- Exact build `29a62cf`, clean-player signed-monitor UDP run:
  `/tmp/ktv-av-clean-output-udp-release.log`, **exit 1**. Baseline six pairs,
  skew p50 **49.30 ms**, p95/max **67.74 ms**; impaired six pairs, p50
  **157.97 ms**, p95/max **357.25 ms**, one unmatched video and audio edge.
  Source-to-video delay p95 **977.30 ms**; audio observation delay p95
  **819.33 ms**. **63 assertions pass before the impaired timing failure**.
- Exact-build TCP run: `/tmp/ktv-av-clean-output-tcp-release.log`, **exit 1**.
  Baseline six pairs, skew p50 **72.44 ms**, p95/max **81.77 ms**; impaired six
  pairs, p50 **251.78 ms**, p95/max **285.07 ms**, no unmatched edges.
  Source-to-video delay p95 **548.00 ms**; audio observation delay p95
  **783.07 ms**. **61 assertions pass before the impaired timing failure**.

The impairment profile remains 150 ms base delay plus uniform 0–40 ms jitter per
proxy leg, with UDP 5% datagram loss per leg. Both functional journeys complete
short audience outage/resume, private-guide separation, fresh audience grants,
publisher revocation and venue/remote/venue handover. The profile returns to zero
before signaling recovery/handover. They are **failed timing runs**, not acceptance
passes. The diagnostic limits remain **150 ms p95 / 250 ms maximum**; six samples
provide limited evidence, and these limits do not replace the 50 ms physical
stage/guide requirement. An earlier simple-monitor UDP run failed baseline at
188 ms; a signed run with the spectral tap attached failed impairment at 549 ms.
Those failures remain in `/tmp/ktv-av-udp-release.log` and
`/tmp/ktv-av-signed-udp-release.log`. Native application clocks, readiness, leases,
permissions and drift guards were not weakened. P07.10/A18 remain open.

A final receiver-buffer diagnostic run also fails (`exit 1`),
`/tmp/ktv-av-receiver-buffer-diagnostic.log`: impaired six matched pairs,
three unmatched edges in each medium, worst skew **596.5 ms**. Interval receiver
statistics report mean audio/video jitter-buffer residence **331.01/133.41 ms**,
**93/6** lost audio/video packets, and **4** video freezes totaling **9.033 s**.
Baseline residence is **139.78/38.44 ms**, with no loss or freezes. The harness now
records before/after native receiver counters for each timing phase. These are
interval diagnostics, not additional end-to-end measurements. They identify
uneven buffering and video starvation as concrete areas to investigate; no browser
or SFU root cause is yet established. Incomplete marker accounting still fails
immediately, and any failed skew phase fails the completed run.

Frontend `29a62cf` is deployed at `https://music.micstec.com/party`, assets
`main-_4MVKaX7.js` / `main-D0gBov56.css`. Exact public HTTP/WSS/assets/SHA/SQLite/
cleanup checks **18/18**, `/tmp/ktv-output-lease-public-release.log`; temporary
room closed and no account added. Backend stays `9b74e8f`, with no restart.
Private online SQLite/frontend/server/config backup is
`/home/mli/ktv-party-output-lease-predeploy.fxlAxE`; old assets are retained.
Public rooms/guide stay enabled and media disabled.

Cleanup verification finds no owned remote browser/monitor/output process and
no CDP 9243/9244 or local fixture listeners. The shared remote default output
remains `auto_null`. All owned SFUs, databases, profiles and tunnels are removed;
the original three production containers remain running.

Next: resolve and measure impaired receiver A/V playout, longer outages and
continued impairment during handover, then representative sustained/multi-room
load. Physical/mobile, output changes/Bluetooth and distinct Wi-Fi/LTE acceptance
remain necessary before persistent online/hybrid enablement.

### 2026-10-02 — SFU synchronization policy and sustained publisher diagnostics

Pinned LiveKit source identified a configuration omission: the shared published
`performance` name did not enable synchronized subscriber identities while
`room.sync_streams` was false. Config generation and isolated SFU fixtures now
enable it, with adaptive video playout hints bounded to 0–500 ms. The integrated
receiver verifies shared negotiated MSID and RTCP CNAME. This fixes the grouping
configuration; it does not establish successful impaired timing. The pinned
server excludes Firefox from this synchronization path, so browser coverage remains
open. See the linked primary implementation in the design's streaming section.

Timing fixtures now default to 40 transitions, with six baseline transitions when
impairment is selected. The default generated song lasts 132 seconds; marker IDs
use eight bits plus parity and retain source/receiver bounds. Both browsers have
separate private PulseAudio outputs. Bounded per-second phase, native output-clock,
server clock and playback samples distinguish publisher failures from receiver
buffering. A publisher recovery fails the observation promptly; it cannot become
a passing partial sample. Native clocks, audio start scheduling and drift limits
are unchanged.

Checks and retained failed evidence:

- Party units **73/73**, `/tmp/ktv-sfu-sync-policy-units.log`.
- A/V fixture units **4/4**, including three Python DSP cases and byte-ID/parity
  round trips, `/tmp/ktv-sfu-sync-av-final-units.log`.
- Supervisor/SFU lifecycle **9/9**, `/tmp/ktv-sfu-sync-supervisor.log`.
- Public-origin remote direct/trusted TLS TURN/revocation **14/14**,
  `/tmp/ktv-sfu-sync-public-transport.log`, exit 0.
- Sync-only TCP six-pair candidate: impaired p95/max **219.37 ms**, exit 1,
  `/tmp/ktv-sfu-sync-tcp-candidate.log`.
- Sync plus adaptive hints TCP six-pair candidate: baseline p95/max **28.23 ms**,
  impaired p95/max **220.19 ms**, exit 1,
  `/tmp/ktv-sfu-sync-playout-tcp-candidate.log`.
- Same-policy UDP candidate: baseline p95/max **78.89 ms**, impaired p95/max
  **282.97 ms**, exit 1, `/tmp/ktv-sfu-sync-playout-udp-candidate.log`.
- Forty-edge TCP attempts fail at native publisher drift before collecting the
  required impaired phase. Shared-source/private-receiver output reaches **118 ms**
  largest calculated error over 47 samples,
  `/tmp/ktv-sfu-sync-playout-tcp-sustained.log`. Both private outputs reach
  **124.8 ms** over 38 samples, `/tmp/ktv-sfu-sync-private-tcp-sustained.log`.
  Its six-pair baseline p95/max is **39.20 ms**. Both exit 1.
- A clean-network sustained diagnostic also fails: largest calculated error
  **98.4 ms**, 15 samples, recovery approximately 14 seconds into the performance,
  `/tmp/ktv-sfu-sync-clean-sustained-diagnostic.log`, exit 1. Server offset samples
  remain near 9750 ms while rendered audio progressively falls behind. This
  reproduces publisher drift without the impairment proxy; the underlying native
  output/render resource cause is not yet established.

Prepared private configuration `/home/mli/ktv-media-private/livekit.yaml` has the
verified policy; keys are unchanged, files remain mode 0600 and parent mode 0700.
Atomic replacement retains private rollback
`/home/mli/ktv-media-private/livekit.before-sync-20261002.yaml`. No persistent
media service was started. Frontend remains deployed `29a62cf`, backend `9b74e8f`,
rooms/guide enabled and media disabled. No application rebuild or backend restart
was necessary for these fixture/configuration changes.

Next: diagnose sustained native publisher clock behavior, then repeat complete
timing phases with unchanged p95/max limits. Continued impairment during handover,
longer outages, sustained representative/multi-room load and physical/mobile/
distinct-access-network acceptance remain open. P07.10/A18 are not closed.

### 2026-10-02 — Continuous impairment handover and provider readiness correction

The room fixture can now retain delay/jitter/loss through audience reconnection,
publisher replacement and venue → remote → venue handovers. It verifies both
the active profile and selected ICE proxy route for fresh connections. The first
UDP run fails after 36 checks at replacement publisher readiness,
`/tmp/ktv-sfu-sync-continuous-udp-handover.log`, exit 1. Audience recovery had
already succeeded under continuing impairment with a fresh nonce and denied old
JWT. The replacement's readiness response was collapsed into HTTP 503 even
though the policy worker remained available.

The backend now preserves provider-pending confirmation as HTTP 409
`MEDIA_NOT_READY`. The client retries only that exact code/status, at most four
attempts with 0/200/400/800 ms delays, under its existing nonce and current lease.
Stop/permission loss/expiry cancel the wait; all worker-unavailable and permission
denials remain terminal. Neither provider readiness nor countdown recovery is
bypassed. Eight new lifecycle checks cover successful pending confirmation,
attempt exhaustion, Stop, lease expiry, unavailable/revoked/forbidden responses
and a pending code incorrectly paired with HTTP 403.

Candidate evidence: party **81/81** (`/tmp/ktv-provider-ready-party-final.log`),
backend **127/127** (`/tmp/ktv-provider-ready-backend-full.log`), focused readiness
routes **8/8** and final lifecycle **31/31** before the added HTTP-status negative
case. Type-check/build passes (`/tmp/ktv-provider-ready-final-candidate-build.log`).
The built-app continuous UDP journey passes **65/65**, exit 0,
`/tmp/ktv-provider-ready-continuous-udp-candidate.log`: 150 ms delay, 0–40 ms jitter
and 5% datagram loss per proxy leg remain active through automatic audience
recovery and all three hybrid turns. Provider removal, old-token denial, exactly
one player/publisher, private-guide exclusion and venue duplicate-backing checks
pass. This is functional synthetic evidence; no A/V marker measurement or physical
input/leakage measurement was performed in this run.

A separate 59-audience/180-second public probe fails during client setup after
30 audience admissions, before its sustained measurement phase; **12 checks**
pass, `/tmp/ktv-sfu-sync-59-audience-load.log`, exit 1. The next client's actual
received audio playout times out. This establishes neither a supported 30-device
capacity nor the 59-device ceiling. A read-only, owned-session `/proc` sampler
records 24 samples late in setup (`/tmp/ktv-sfu-sync-59-client-resources.jsonl`):
renderer CPU peak **261.9%** and mean **214.6%**, audio-service peak **32.5%**,
other browser processes peak **56.0%** (100% = one CPU); four-core host busy
peaks at **99.0%**. Summed renderer RSS peaks at **5759.4 MiB**, which can double
count shared pages. This shows client-host pressure, but does not establish the
audio timeout's cause or SFU capacity. Failed transport probes now retain bounded
track/player and receiver RTP diagnostics, without credentials.

The source browser's private output no longer runs an unused PCM detector; the
receiver retains actual output capture. This reduces observer work while keeping
native clocks and all application recovery guards. Longer marker runs, representative
multi-client/multi-room load, mobile/physical devices and distinct access networks
remain open. Production remains frontend `29a62cf` / backend `9b74e8f`, media off,
until a subsequent verified deployment is recorded.

The provider-readiness preview `e88783a` is deployed at
`https://music.micstec.com/party`, assets `main-CXsosxfb.js` /
`main-D0gBov56.css`. Exact release type-check/build, UI **38/38**, PWA **8/8** and
continuous TCP handover **63/63** pass; the UDP candidate with the same application
source passes **65/65**. Logs: `/tmp/ktv-provider-ready-release-build.log`,
`/tmp/ktv-provider-ready-release-ui.log`, `/tmp/ktv-provider-ready-release-pwa.log`,
`/tmp/ktv-provider-ready-continuous-tcp-release.log`. Public HTTP/WSS, effective
feature flags, asset bytes/commit, SQLite integrity/foreign keys and cleanup pass
**18/18**, `/tmp/ktv-provider-ready-public-release.log`. Temporary room closed;
no account added. Backend restarted only after confirming zero active audio rooms.
Private online database/frontend/old backend route/config/process backup:
`/home/mli/ktv-party-provider-ready-predeploy.pvof0w47`. Old assets are retained.
Public rooms/guide remain enabled and media disabled.

Exact preview clean-network sustained A/V observation now passes **26/26**, exit
0, `/tmp/ktv-provider-ready-clean-av-release.log`: **40 matched transitions**, no
unmatched edges, absolute skew p50 **24.71 ms**, p95 **61.83 ms**, maximum
**91.52 ms**. Source-to-video observation delay p95 **173.70 ms**; audio observation
delay p95 **161.53 ms**. The source's unused PCM detector is absent, while receiver
output monitoring and all native recovery guards remain intact. This is progress
over the retained earlier native-drift failures, not proof of their underlying
cause or physical/device reliability.

The same exact preview with continuous TCP impairment and 40 impaired transitions
still fails (`/tmp/ktv-provider-ready-sustained-tcp-av-release.log`, exit 1).
Baseline six pairs: p95/max **47.93 ms**. Impaired 40 pairs, no unmatched edges:
p50 **158.87 ms**, p95 **393.70 ms**, max **575.75 ms**. Source-to-video delay p95
**1064.10 ms**, audio observation delay p95 **789.52 ms**. Interval mean audio/video
buffer residence is **195.60/263.54 ms**, with no reported packet loss and five
video freezes. Functional recovery/handover completes; timing remains a failure.
A fixture-only `KTV_ROOM_TEST_PLAYOUT_HINTS=off` comparison now isolates the
adaptive video hint from stream grouping without changing prepared configuration.
The impairment sample starts after the existing two-second settling interval;
thresholds and marker accounting are unchanged.

The no-hints comparison also fails, exit 1,
`/tmp/ktv-provider-ready-sustained-tcp-no-hints.log`: baseline six-pair p95/max
**72.25 ms**; impaired 40 pairs with no unmatched edges, p50 **131.06 ms**, p95
**468.94 ms**, max **632.47 ms**. Mean audio/video buffer residence is
**232.22/264.38 ms**, no reported packet loss and five video freezes. Disabling
the hint does not resolve this run; the prepared adaptive policy remains unchanged.
Both sustained TCP runs complete the functional recovery/handover sequence and
fail the final timing assertion.

Read-only client process samples for the no-hints run
(`/tmp/ktv-provider-ready-no-hints-resources.jsonl`, 65 active samples) report
aggregate renderer CPU mean/peak **125.73/180.53%**, audio-service **5.72/14.16%**,
other browser processes **38.42/139.46%**, receiver monitor **9.38/12.63%**
(100% = one CPU). Four-core host busy mean/peak is **60.5/78.7%**. These are
owned-process diagnostics, not proof of a root cause or a production resource
budget. Next investigation: correlate source encoded-frame cadence and RTCP clock
mapping with receiver buffer/freezes through the impairment transition. Preserve
the clean-network pass and both failed comparisons; physical/mobile, representative
load and distinct access-network gates remain open.

Final cleanup verifies no owned remote browser/output/monitor process, CDP
9243/9244, local UI browser 9253 or fixture media/control listener. Shared remote
output remains `auto_null`; only the original three production Docker containers
are running. Unrelated PM2 process PIDs are unchanged. The production backend is
one online process with watching disabled.

### 2026-10-02 — Capture cadence and bounded A/V diagnostics

Added a bounded source/receiver RTC timeline sampled once per second, including
encoded/sent frames, codec, encode/send delay, buffer residence, retransmission
and quality-limitation counters. Optional received-frame arrival, decode and
presentation metadata remains absent when unsupported. The whitelist excludes
SDP, candidate addresses and credentials; tests cover redaction, missing fields,
unsupported receiver hints and bounded peer history.

The pre-fix UDP diagnostic fails during native publisher clock recovery at
**116.8 ms**, 97 native samples (`/tmp/ktv-av-timeline-udp-diagnostic.log`, exit 1).
Its baseline six pairs have p95/max **27.12 ms**, no unmatched edges. The impaired
40-pair phase is incomplete and cannot establish a timing pass. Clean source
video reports **19–21 fps**; impaired source video often reports **2–9 fps**,
then returns to about 20 fps. Reported quality limitation remains `none`; frame
decode metadata is generally a few milliseconds. These observations do not
prove where the impaired delay originates.

Fixed a concrete drawing-cadence error: resetting each 40 ms interval to the
current animation callback rounds 25 fps to 20 fps on a 60 Hz display. Preserve
the fractional interval and draw only the current frame after a stall. Use manual
canvas capture where supported, requesting a frame after the complete draw;
otherwise release the probe track and retain automatic capture. Resolution,
bitrate, native audio recovery, permission and timing thresholds are unchanged.

Party units **84/84**, A/V fixture units **6/6**, type-check/production build pass:
`/tmp/ktv-capture-cadence-party.log`, `/tmp/ktv-capture-cadence-av-fixtures.log`,
`/tmp/ktv-capture-cadence-build.log`. Cadence checks cover 60/120 Hz, stall behavior,
fallback cleanup and background blanking. Built-app UI **38/38** and PWA **8/8**
pass (`/tmp/ktv-capture-cadence-ui.log`, `/tmp/ktv-capture-cadence-pwa.log`). The
continuous UDP timing run fails, exit 1 (`/tmp/ktv-capture-cadence-udp-av.log`):
baseline source **24–26 encoded fps**, six pairs p95/max **103.32 ms**. Impaired
40 matched pairs, one unmatched video/audio edge: skew p50 **168.41 ms**, p95
**590.93 ms**, maximum **690.50 ms**. Functional recovery/handover completes;
the final timing gate fails. Under impairment, video target bitrate falls near
**30–36 kbit/s** and encoded cadence is commonly **3–5 fps**, with 28 video
freezes by the phase end. The cadence fix corrects the baseline setting but does
not resolve the impaired A/V failure. Next, compare encoder resolution/framerate
adaptation with timing and readability evidence. This candidate is not deployed. Production
remains `e88783a`, media disabled. Encoded cadence and impaired A/V must be measured
before claiming improvement; physical/mobile/load/network gates remain open.

An isolated `maintain-framerate` encoder comparison also fails, exit 1,
`/tmp/ktv-capture-framerate-udp-av.log`. Baseline six pairs p95/max **109.01 ms**;
source cadence **23–25 fps**, encoded resolution **640×360 / 960×540**. The
impaired phase stops after 25 timeline samples when native publisher drift reaches
**248.3 ms**, 50 samples. Its pre-stop source cadence is roughly **13–24 fps** at
**960×540**, but the required 40-pair timing result and readability acceptance are
incomplete. This comparison does not establish a better release policy; the app
retains `maintain-resolution`. The SDK's resolution/framerate tradeoff is documented
in [TrackPublishOptions](https://docs.livekit.io/reference/client-sdk-js/interfaces/TrackPublishOptions.html).
Selected transport RTT and bandwidth-estimate counters were added to the diagnostic
whitelist for subsequent runs, with redaction tests; no candidate IDs/addresses
are exported. Next check: sustained clean timing with the capture cadence fix,
then investigate failed transport timing with complete observation windows.

The clean sustained check also stops on native publisher recovery: **86.4 ms**,
43 native samples, 22 source markers; no complete 40-pair result
(`/tmp/ktv-capture-cadence-clean-av.log`, exit 1). Source reports **21–25 fps**.
The measurement poll previously opened a new SSH/Python process for every
receiver-evidence read. Replaced those reads with one owned timing-event stream;
PCM stays on the receiver, numeric timestamps stay unchanged, and evidence history
and line sizes are bounded. Channel loss or malformed evidence fails the run;
intentional teardown closes the owned channel and monitor. Fixture units **9/9**
pass (`/tmp/ktv-av-evidence-stream-units.log`), including fragmented input, unchanged
timestamps, redaction, bounded history, oversized/malformed input, stream loss and
startup failure cleanup. The clean sustained run with the new reader passes
**26/26**, exit 0 (`/tmp/ktv-capture-cadence-stream-clean-av.log`): **40 matched
transitions**, no unmatched edges, absolute skew p50 **27.51 ms**, p95 **60.88 ms**,
maximum **61.61 ms**, source-to-video delay p95 **113.70 ms**, maximum **114.90 ms**.
Source reports **24–26 encoded fps** throughout 76 timeline samples. This reduces
probe process churn and establishes a clean run for the capture fix; the earlier
native failures remain evidence and their underlying cause is unproven.

With the event stream, the `maintain-framerate`/500 ms SFU comparison completes
40 impaired pairs, no unmatched edges, but still fails the final timing gate:
**140.48 ms p50 / 358.84 ms p95 / 526.59 ms maximum**
(`/tmp/ktv-capture-framerate-stream-udp-av.log`, exit 1). Baseline six pairs p95/max
**67.34 ms**. Impaired source maintains **24–26 fps**, at **960×540 / 1280×720**;
baseline includes **640×360 / 960×540**. Functional continuous handover completes.
For several late markers, arrival-to-presentation is **344–590 ms**, while reported
decode processing is **1–5.5 ms**; other late markers have short post-arrival delay.
Source selected transport RTT is **311–377 ms**. These timings indicate multiple
delay components; they do not prove decoding or the adaptive hint is the cause.
An isolated `KTV_ROOM_TEST_PLAYOUT_MAX_MS=150` comparison also fails, exit 1,
`/tmp/ktv-capture-framerate-stream-150ms-udp-av.log`: baseline six-pair p95/max
**83.35 ms**; impaired 40 matched pairs, one unmatched video/audio edge, skew
**132.91 ms p50 / 377.65 ms p95 / 560.74 ms maximum**. Functional recovery and
hybrid handover complete before the final timing assertion fails. The
fixture accepts 50–500 ms, defaults to 500 and prints the effective value. Prepared
production SFU policy and timing acceptance thresholds remain unchanged.
The resolution adaptation candidate is reverted; the app retains its existing
encoder policy. Next investigation: negotiated playout extension behavior and
packet repair versus frame presentation timing. Online release remains gated.

Capture cadence preview **`ea986cd`** is deployed at
`https://music.micstec.com/party`, assets **`main-1zcZhmf9.js` /
`main-D0gBov56.css`**; backend implementation remains **`e88783a`**, no restart.
Exact release build, UI **42/42**, PWA **8/8**, and native clean sustained room
journey **26/26** pass. Forty matched transitions, no unmatched edges: absolute
skew p50 **18.39 ms**, p95 **57.30 ms**, maximum **57.97 ms**; source-to-video delay
p95 **138.50 ms**, maximum **161.30 ms**. Source video reports mostly **24–26 fps**,
one sample **21 fps**, across 76 timeline points. Logs:
`/tmp/ktv-capture-cadence-release-build.log`,
`/tmp/ktv-capture-cadence-release-ui.log`,
`/tmp/ktv-capture-cadence-release-pwa.log`,
`/tmp/ktv-capture-cadence-release-clean-av.log`.

Public release verification passes **18/18**, exit 0,
`/tmp/ktv-capture-cadence-public-release.log`: HTTP/WSS, effective flags, exact
asset bytes/commit, SQLite integrity/foreign keys, room cleanup and no added
account. Private online SQLite/frontend/config backup:
`/home/mli/ktv-party-cadence-predeploy.rbaklp_4`. Confirmed zero active audio rooms
before publication; old hashed assets retained, index/worker replaced atomically.
Rooms/guide remain enabled and media disabled. This is a preview; physical/mobile,
distinct-network, sustained representative capacity and impaired A/V gates remain
open. P06.7 software abuse/escaping acceptance is complete; all failed comparisons
above remain part of the evidence.

### 2026-10-02 — Lyric screen source contract and packet-loss diagnosis

Identified a source classification mismatch: lyrics were published as camera
video. In pinned LiveKit v1.13.7, the receiver-report handler adjusts the video
playout minimum from jitter for camera sources; screen-share sources skip that
adjustment because bursty screen traffic can inflate jitter. Candidate code now
declares the canvas as `screen_share`, explicitly retaining 350 kbit/s, 25 fps,
1280×720 and resolution preference. Grant signing, gateway source checks,
provider readiness, audience filtering and media fixtures use that same contract.
Tests reject declared camera/screen-audio grants and a camera lyric track at
readiness. No desktop capture prompt or extra audio publication is introduced.
Source: [pinned downtrack handler](https://github.com/livekit/livekit/blob/v1.13.7/pkg/sfu/downtrack.go),
[playout controller](https://github.com/livekit/livekit/blob/v1.13.7/pkg/sfu/playoutdelay.go).

Party units **84/84**, backend **128/128**, type-check/production build pass:
`/tmp/ktv-lyric-source-party-units.log`, `/tmp/ktv-lyric-source-backend-units.log`,
`/tmp/ktv-lyric-source-build.log`. Native continuous UDP run completes functional
recovery/handover and fails the final timing gate after 71 passing checks,
`/tmp/ktv-lyric-source-udp-av.log`, exit 1. Baseline six pairs, no unmatched edges:
p95/max **72.35 ms**. Impaired **40 pairs**, no unmatched edges: skew p50
**138.32 ms**, p95 **328.88 ms**, maximum **562.56 ms**. Source preserves full
**1280×720**, reports **23–26 fps** and **267.8–350 kbit/s** video target under
impairment; baseline **24–26 fps**, 350 kbit/s. Receiver interval mean audio/video
buffer residence is **206.6/283.9 ms**, 91 video freezes and 114 reported video
packets lost. The real video section negotiates the playout-delay extension;
audio does not. No SDP or credentials are logged.

The classification corrects encoding and SFU semantics while impaired timing
remains a failure. An isolated `KTV_ROOM_TEST_RECEIVER_TARGET_MS=500` experiment
sets native targets on the two current receiver tracks before measurement. Its
range is 0–1000 ms, requires A/V timing, and defaults to no override. It tests
whether coordinated native buffering can cover repair stalls; it is not a
production delay policy, nor proof of handover timing on later receiver tracks.
No acceptance threshold or marker-accounting rule changes. Production remains
frontend `ea986cd`, backend `e88783a`, media disabled. The new source contract
requires a coordinated media-disabled frontend/backend/worker rollout.

The first native receiver-target experiment stops before the target setter or
A/V observer starts: native publisher drift **373 ms**, one sample, room enters
`stage.unavailable` (`/tmp/ktv-lyric-source-500ms-receiver-udp-av.log`, exit 1).
It provides no evidence for or against the buffer target. The process is terminal
and fixture ports are free; a fresh experiment is running with the same target
and unchanged native recovery guard. The failed startup remains recorded.

The receiver-target retry applies **500 ms** to the two current tracks, then fails
on native publisher recovery (`/tmp/ktv-lyric-source-500ms-receiver-udp-av-retry.log`,
exit 1): publisher drift **90.2 ms**, 72 native samples, 55 impaired timeline
points. Baseline six matched pairs, no unmatched edges: p95/max **249.49 ms**,
source-to-video delay p95 **588.90 ms**. The impaired phase is incomplete. Thus
coordinated target support is verified, but this run does not establish an impaired
timing improvement and its baseline exceeds the diagnostic target. No receiver
delay policy is added to the app. Next measurement uses the screen source under
continuous TCP delay/jitter with native receiver defaults, to separate added loss
from ordered transport impairment.

### 2026-10-02 — Screen-content release verification and TCP timing diagnosis

Native continuous TCP run `/tmp/ktv-lyric-source-tcp-av.log`, exit 1, completes
functional recovery and hybrid handover, then fails unchanged timing acceptance.
Baseline six matched pairs, no unmatched edges: p95/max **103.00 ms**. Impaired
**40 matched pairs**, no unmatched edges: absolute skew p50 **67.99 ms**,
p95 **257.96 ms**, maximum **392.66 ms**. Receiver reports zero packet loss and
NACKs, four video freezes, and interval mean audio/video buffer residence
**204.7/268.3 ms**. Source preserves **1280×720**, but encoded frame rate varies
**7–26 fps** after the TCP profile is applied, versus 25 fps at baseline.
This is a source cadence limitation as well as a timing failure.

The worst pair has signed skew **−392.66 ms** (video before audio); later pairs
include approximately **+214 ms** (video after audio). Receiver video arrival to
display and native sender-domain estimated playout timestamps vary across the
same interval. These are diagnostics, not an independent lyric clock or proof of
physical output timing. Packet repair alone cannot explain this TCP failure.
Next timing investigation must distinguish source capture/encoding, native audio
buffer convergence and native A/V synchronization. Neither this result nor the
incomplete 500 ms experiment justifies a production fixed receiver delay.

Exact committed frontend/backend **`f58a8f3`** is deployed at the public party URL,
assets **`main-CedlFAY-.js` / `main-D0gBov56.css`**. Matching media image is tagged
`ktv-party-media:f58a8f3` and `ktv-party-media:lyric-source`, local image ID
`sha256:8c5ad85c703d975f77ed63fca30c367973be503d665f988308b9a5f40bf3ad11`.
All four shipped gateway/ICE/worker/supervisor file SHA-256 hashes match repository
files. Supervisor **9/9** and public remote direct/trusted TLS-TURN/revocation
**14/14** pass (`/tmp/ktv-lyric-source-supervisor.log`,
`/tmp/ktv-lyric-source-public-transport.log`); neither run uses production room
policy or changes the persistent media flag.

Exact release build/type check, UI **42/42**, PWA **8/8**, clean native room journey
**26/26** and public release **18/18** pass. Evidence:
`/tmp/ktv-lyric-source-release-build.log`,
`/tmp/ktv-lyric-source-release-ui-final.log`,
`/tmp/ktv-lyric-source-release-pwa-diagnostic.log`,
`/tmp/ktv-lyric-source-release-clean-av.log`,
`/tmp/ktv-lyric-source-public-release.log`. Clean **40 matched transitions**, no
unmatched edges: absolute skew p50 **28.58 ms**, p95 **58.48 ms**, maximum
**75.30 ms**; source-to-presented-video p95 **114.90 ms**, maximum **125.80 ms**.
Party units **84/84** and backend **128/128** remain the source-contract evidence
recorded above. Physical/mobile and distinct access-network acceptance remain open.

Two initial UI launches supplied the CDP base URL where that fixture expects
`/json/version` and failed before any UI check; failed logs are retained as
`/tmp/ktv-lyric-source-release-ui.log` and
`/tmp/ktv-lyric-source-release-ui-retry.log`. The corrected launch passes 42 checks.
The first subsequent PWA run fails at worker-controlled entry reload
(`/tmp/ktv-lyric-source-release-pwa-final.log`); the worker is activated but the
entry is absent. A fresh owned browser passes all eight checks with the same app
build. The cause of that intermittent reload failure remains unresolved.
PWA fixture diagnostics now retain bounded own-origin failed request paths/types,
generic runtime failure text and synthetic page state, without queries, headers
or credentials. Its CDP setting accepts the base URL or `/json/version` URL.
No acceptance deadline, state assertion or cache exclusion is weakened.

Predeployment backup **`/home/mli/ktv-party-lyric-source-predeploy.kih_i_94`** holds
the consistent SQLite backup, prior frontend archive and private backend config;
directory mode 0700, files 0600, SQLite integrity/foreign keys pass. The previous
release was frontend `ea986cd`, backend `e88783a`. Backend restart and atomic
entry/worker publication occur with zero preparing/scheduled/playing rooms. A
health probe initially used unrelated port 3003 and halted entry publication;
the actual `karaoke-auth` listener is **127.0.0.1:3101**, where health and flags
pass before publication. No unrelated service is changed. Old hashed assets
are retained. Public HTTP/WSS, asset bytes/source SHA, timing defaults, SQLite
integrity/foreign keys and no-account-creation checks pass; the probe room closes.
Rooms/guide remain enabled, media disabled, and no persistent SFU is started.

### 2026-10-02 — PWA activation/cold-catalog fixes and native buffer experiments

Reproduced the PWA failure after a UI journey. A diagnostic series passes once,
then fails explicit upgrade (`/tmp/ktv-pwa-reload-cache-diagnostic-2.log`): cache
operations finish in approximately 15 ms, the app shell mounts, the legacy worker
still controls the page and the new worker remains installed/waiting. This rules
out unfinished cache cleanup for that occurrence. The Update handler previously
reloaded after its eight-second timeout even when activation had not completed.

Candidate implementation awaits activation of the exact requested worker, checks
that it becomes registration.active, removes listeners on every outcome and
keeps the current page on timeout/replacement/pending installation. The UI disables
duplicate update clicks, shows progress, and offers a translated failure/retry
message. Update listeners attach before catalog/auth downloads. Three focused
unit checks pass (`npm run test:pwa:update`): timeout cannot reload; a retry can
activate/reload exactly once; missing/replaced/pending workers cannot reload.

Also corrected authoritative empty catalogs: count `0` previously triggered the
fallback to 1282 phantom songs and background lyric downloads. Both primary and
fallback count paths now accept zero. Two native-fetch catalog unit checks pass
(`npm run test:songs`), including no fallback request for a valid primary zero.
The PWA fixture keeps its original empty catalog. The combined candidate passes
UI **42/42** and **three consecutive PWA 10/10 runs**, including a deliberately
blocked native worker activation, unchanged current page/time origin, restored
retry button, successful real retry and purge of cached legacy authority:
`/tmp/ktv-pwa-activation-catalog-candidate-ui.log`,
`/tmp/ktv-pwa-activation-catalog-candidate-{1,2,3}.log`.
Cache API tracing is opt-in (`KTV_PWA_TEST_CACHE_DIAGNOSTICS=1`); those three runs
use the original Cache API. Bounded diagnostics capture own-origin HTTP/mime
failures, generic console/runtime errors and the matched route without headers,
query strings or credentials. The earlier guard-only candidate passes timeout
safety but fails retry (`/tmp/ktv-pwa-activation-candidate-1.log`); the catalog
correction is included in the passing candidate. Physical installed-PWA coverage
remains open. Type-check/build and party units **84/84** pass.

Two **fixture-only** native buffer experiments retain the native renderer,
audio/video stream, clock/lease/generation checks, resolution preference,
1280×720/25 fps/350 kbit/s publication settings and unchanged timing thresholds.
Neither adds an independent lyric clock or a production delay controller.
`KTV_ROOM_TEST_RECEIVER_SYNC` defaults to `off`, requires native A/V mode when
enabled, and excludes the fixed-target experiment. Hints scope to the two actual
player receivers; originals are restored on completion/failure, before recovery
and handover. Their timing is not handover timing evidence.

- `ntp`: bounded relative hints from same-source sender NTP estimates, report-time
  corrected, 40 ms deadband, 100 ms maximum update, no accumulated common delay.
  **Rejected for production**: `/tmp/ktv-native-sync-tcp-av.log`, exit 1, full
  impaired 40 matched pairs/no unmatched: p95 **337.50 ms**, maximum **655.16 ms**.
  Baseline p95 **28.24 ms**. Hints oscillate and increase video observation delay.
- `network`: equal audio/video hints derived from interval native
  `jitterBufferMinimumDelay / jitterBufferEmittedCount`, rounded upward to 5 ms,
  bounded at 500 ms. This avoids feeding estimated playout timing/AV-sync delay
  back into the buffer controller. `/tmp/ktv-native-network-tcp-av.log`, exit 0,
  **72/72** functional/timing checks. Baseline six matched, p95/max **77.49 ms**;
  impaired **40 matched**, no unmatched: p95 **100.54 ms**, maximum **144.73 ms**,
  source-to-video p95 **847.30 ms**, maximum **915.20 ms**.

The corresponding UDP experiment still fails:
`/tmp/ktv-native-network-catalog-udp-av.log`, exit 1. Baseline six matched,
no unmatched, p95/max **36.76 ms**. Impaired **40 matched**, one unmatched audio
and video edge, p95 **349.68 ms**, maximum **699.93 ms**; source-to-video p95
**913.40 ms**, maximum **1248.30 ms**. Receiver interval mean audio/video buffers
**207.5/282.7 ms**, 390/98 reported audio/video packets lost, 77 video freezes.
Full 1280×720 remains; source encoded cadence is 24–26 fps at baseline and
6–26 fps under impairment. Hints range 120–400 ms under impairment. The TCP pass
does not justify enabling this controller or online media; UDP repair stalls
and source cadence still require investigation.

Two earlier UDP runs stop during browser-context creation, before timing
measurement (`/tmp/ktv-native-network-udp-av.log`,
`/tmp/ktv-native-network-udp-av-retry.log`). The media fixture had omitted its
one-song count and requested the phantom fallback catalog. It now serves count
`1`, matching its actual asset and metadata; the third run above reaches full
measurement. This is a correction to the one-song fixture, not audience-capacity
evidence or a reduced media-quality/clock gate. All failures remain recorded.

Primary semantics: [native jitter buffer target](https://w3c.github.io/webrtc-pc/#dom-rtcrtpreceiver-jitterbuffertarget),
[native stats](https://www.w3.org/TR/webrtc-stats/#dom-rtcinboundrtpstreamstats-estimatedplayouttimestamp).
Targets are hints; the browser may clamp them and synchronized tracks should use
the larger target. Estimated playout timestamps are sender NTP time and can
extrapolate when no audio is playing. Fixture units **12/12** pass, including the
final finite-counter guard. The exact release results are recorded below. Public
preview is frontend `fe4f216`, backend `f58a8f3`, media disabled. P01/P05 physical
alignment, P06 physical/mobile/installed-PWA, UDP and handover timing, representative
capacity and persistent online release remain open.


### 2026-10-02 — PWA activation preview published

Committed and pushed application build **`fe4f216`** is published at
`https://music.micstec.com/party`, with **`main-9fvbdGW2.js`** and
**`main-DnE6rWx5.css`**. Backend remains **`f58a8f3`**, without a restart;
rooms/guide are enabled, media is disabled, and no persistent SFU is running.

Exact committed build/type check passes (`/tmp/ktv-pwa-activation-release-build.log`).
Built-app UI **42/42** (`/tmp/ktv-pwa-activation-release-ui.log`), native PWA
blocked-activation/retry/cache isolation **10/10**
(`/tmp/ktv-pwa-activation-release.log`) and clean native A/V **26/26**
(`/tmp/ktv-pwa-activation-release-clean-av.log`) pass. A/V matches all **40**
transitions, with no unmatched edges: absolute skew p50 **2.97 ms**, p95
**58.98 ms**, maximum **75.70 ms**; source-to-video p95 **112.40 ms**, maximum
**131.50 ms**. Source checks pass: party **84/84**, update helper **3/3**, catalog
**2/2**, A/V fixture **12/12**. Earlier failures and candidate evidence remain
recorded above; physical installed-PWA acceptance is still open.

Public release **18/18** (`/tmp/ktv-pwa-activation-public-release.log`) verifies
HTTP/WSS admission, effective flags, no-store diagnostics, default timing,
pair/ticket lifetimes, exact asset bytes and committed source SHA. The probe's
own temporary room is closed; no account is added; SQLite integrity and foreign
keys pass. Private rollback backup
**`/home/mli/ktv-party-pwa-activation-predeploy.4pj04fvs`** includes consistent
SQLite, previous static frontend and private backend configuration. Previous
frontend/backend were `f58a8f3`; old hashed assets remain available. Entry HTML
and service worker were atomically replaced with zero preparing/scheduled/playing
rooms. Native buffering experiments remain fixture-only; impaired UDP timing,
physical/mobile, handover timing, capacity and online release remain open.


### 2026-10-02 — Native lease-silence fix and repair-delay diagnosis

Native private-output probe `/tmp/ktv-native-lease-boundary.log` exposes a real
source-lifetime bug in the previous engine (SHA256
`7f23c581f15f794466a90e93e09927f0aa5c52600cc750fe88588f2b3cb5e128`).
A blocked page task with a running render clock stops on schedule. When the task
requests context suspension, remains blocked past the lease, then resumes audio
while still blocking, the old backing becomes audible for the observed **2.2 s**
resume window. State-change callbacks arrive afterward. A stop scheduled only
against `AudioContext.currentTime` cannot cover a frozen render clock.

The production engine now requires a native worklet lease guard for each backing
or guide source, before personal monitoring and its publisher tap. The publish
mix adds its own guard after the limiter/gain, covering live mic as well as backing.
Each guard checks a bounded wall expiry derived from the validated room clock,
uncertainty and output margin; backwards wall time, render discontinuities above
250 ms, invalid/replayed renewals and expiry latch silence. A renewal cannot
revive that guard. Native source stops/gain schedules, generation/asset/clock and
room authorization checks remain in place. The guard retains the existing
**15-second maximum stage lease**; publishing still retains its existing tighter
permit validation. Modules use a hashed asset included in PWA precaching.
Failed module loads cannot enable audio, and a subsequent successful load can
recover; failed preflight does not require registering an existing module twice.

`/tmp/ktv-native-stage-publisher-lease-guard.log` passes **15/15** native checks:
actual private output contains the authorized tone, then remains silent after
wall expiry for stage and published mic, with both running and suspended render
clocks under blocked page tasks. No runtime exception. This isolates the engine
and graph; it does not prove physical replacement timing or mobile compatibility.
`/tmp/ktv-lease-render-guard-party-complete.log` passes **88/88** before the added
15-second-ceiling check. The earlier invalid zero-input/zero-output preflight
attempt is preserved in `/tmp/ktv-native-lease-render-guard.log`; the corrected
native run is `/tmp/ktv-native-lease-render-guard-retry.log` (8/8 stage checks).

Built candidate `/tmp/ktv-lease-guard-final-candidate-clean-av.log` passes
**53/53**, including real capture, private guide/mix separation, signaling
recovery and complete hybrid handovers. All **40** clean marker transitions
match with no unmatched edges: p95 **59.26 ms**, maximum **66.27 ms**;
source-to-video p95 **114.80 ms**, maximum **122.60 ms**. This candidate precedes
the later room-response guard and ceiling check; exact committed verification
is still required before publication.

The receiver repair experiment remains fixture-only and defaults off.
`/tmp/ktv-native-repair-udp-av.log` completes all 40 impaired matches, no unmatched,
but fails p95 **445.47 ms**, maximum **470.41 ms**. Source-to-video p95
**1113.40 ms**, maximum **1531.60 ms**. The common hint uses interval network
minimum plus one measured RTT for each hop with recent video NACK progress;
it does not use marker skew/IDs or a new lyric clock. Audio accepts approximately
745–1100 ms while native video target stays near **482–486 ms**, consistent with
our sender maximum of 500 ms. The pinned Chrome 137 WebRTC source
(`cec4daea7ed5da94fc38d790bd12694c86865447`) explicitly gives frame maximum delay
priority over receiver and synchronization minimum delays:
[UpdatePlayoutDelays](https://webrtc.googlesource.com/src/+/cec4daea7ed5da94fc38d790bd12694c86865447/video/video_receive_stream2.cc).
[The WebRTC specification](https://w3c.github.io/webrtc-pc/#dom-rtcrtpreceiver-jitterbuffertarget)
also states that a clamped effective target need not change the getter.

`/tmp/ktv-native-repair-no-sfu-hint-udp-av.log` removes only the isolated SFU's
sender hint, retaining loss/jitter, quality and timing limits. Video now accepts
larger targets (e.g. ~1054 ms alongside audio ~1070 ms), confirming the clamp
conflict. The run still fails before 40 impaired matches: source rendered drift
reaches ~101 ms and the unchanged recovery guard stops publication; the experiment
correctly refuses the replaced receiver pair. This is neither a timing pass nor
justification to ship the controller or alter prepared SFU policy.

A concurrent PWA candidate run fails with a bounded Vue console diagnostic
(`/tmp/ktv-lease-guard-final-candidate-pwa.log`): the owned fixture omitted
`GET /api/ktv/rooms` and served HTML, so the list became undefined and the view
failed during render. This explains a fixture race beyond the earlier worker and
catalog issues. The fixture now serves the real empty-array envelope with no-store.
The app additionally rejects invalid response envelopes and non-array room lists,
retaining the form and a translated recovery message. Native built-app coverage
includes malformed HTML/list payloads and recovery on a valid reload. All earlier
failed PWA evidence remains recorded; real installed-PWA acceptance stays open.

Public frontend/backend remain **`fe4f216` / `f58a8f3`** until exact committed
verification and publication. Online media remains disabled; no persistent SFU.


### 2026-10-02 — Exact native lease-guard preview published

Application commit **`ca6c757`** is pushed and published at
`https://music.micstec.com/party`. Assets: **`main-CgZ1TyOk.js`**,
**`main-DnE6rWx5.css`**, **`partyLeaseGuard.worklet-5od8dAEf.js`**. Backend stays
**`f58a8f3`**, without restart. Rooms and private guide remain enabled; online
media remains disabled, with no persistent SFU. The matching worker contract is
unchanged. The original main rollback tag remains intact.

Exact source/build checks:

- Party units **90/90** (`/tmp/ktv-lease-guard-final-units.log`), including native
  processor expiry/clock/renewal rules and the configured 15-second stage ceiling.
- Type check and exact committed build pass (`/tmp/ktv-lease-guard-exact-build.log`).
- UI **45/45** (`/tmp/ktv-lease-guard-exact-pwa-ui.log`), including malformed HTML
  and non-array room payloads, retained form and valid-response reload recovery.
- Native PWA **10/10** (`/tmp/ktv-lease-guard-exact-pwa.log`), with the corrected
  no-store room-list fixture; blocked activation/retry and authority-cache purge
  remain covered. Real installed-PWA acceptance stays open.
- Exact-source native lease **15/15** (`/tmp/ktv-lease-guard-exact-native-lease.log`):
  private stage and published-mic output remain silent past expiry while page
  tasks are blocked, including actual frozen/resumed render clocks.
- Exact built full streaming/recovery/handover **53/53**
  (`/tmp/ktv-lease-guard-exact-clean-av.log`). All **40** clean transitions match,
  with no unmatched edges: skew p50 **29.34 ms**, p95 **59.73 ms**, maximum
  **99.50 ms**; source-to-video p95 **131.40 ms**, maximum **164.90 ms**. Handover
  has functional evidence here, not a measured handover-timing pass.
- Receiver diagnostic fixture checks **13/13**
  (`/tmp/ktv-native-repair-final-fixtures.log`); the repair experiments remain off
  in production and their failed UDP evidence remains above.

Public release **21/21** (`/tmp/ktv-lease-guard-public-release.log`) verifies
HTTP/WSS, effective flags, no-store diagnostics, unchanged timing/pair/ticket
lifetimes, exact app/CSS/worklet bytes, worklet JavaScript MIME, exact worker bytes
and worklet precaching, committed source SHA, SQLite integrity/FKs and no new
account. The probe's temporary room is closed. Private rollback backup
**`/home/mli/ktv-party-lease-guard-predeploy.073ojqew`** contains consistent
SQLite, preceding frontend and private backend configuration; files are 0600 in
a 0700 directory. Previous frontend/backend are `fe4f216` / `f58a8f3`.
Old hashed assets remain available; entry HTML and worker use atomic replacement,
with zero preparing/scheduled/playing rooms. Local owned listener ports are free
and no owned SFU container remains.

This closes the identified native suspended-clock source leak in software.
P05.8/A10 still require integrated replacement/physical output evidence. UDP and
handover timing, source drift under impairment, physical/microphone alignment,
Safari/iOS/Android and field PWA behavior, real access networks, full representative
capacity and persistent online release remain open.

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

### 2026-10-02 — Integrated native stage replacement verified

The unchanged deployed application build `ca6c757` now has an integrated native
replacement regression, [party-stage-replacement-browser.test.mjs](scripts/party-stage-replacement-browser.test.mjs).
It serves the actual built app with an isolated real room backend/database and
uses two separate Chrome 137.0.7151.68 processes/private Pulse outputs on the
same EC2 client. A third room page keeps the host controller present. No live
rooms, production identities, app audio clocks or output timestamps are modified.

**41/41 pass**, `/tmp/ktv-integrated-stage-replacement-final.log`:

- The old stage plays a real 44.1 kHz tone, then its page task blocks for 22 seconds.
  Both running-render-clock and actual suspend/resume cases are exercised.
- Replacement designation preserves the selected song/singer/performance and
  paused checkpoint under a new generation. The actual replacement decodes audio.
- An early start returns `OUTPUT_STOPPING`. The default 8,000 ms lease,
  500 ms safety margin and 2,000 ms countdown remain unchanged.
- The replacement becomes audible while old-page callbacks are still blocked.
  Measured quiet-to-new-output gaps are **2,613.10 ms** (running clock) and
  **10,032.70 ms** (suspended clock). Subtracting the conservative DSP/capture
  timing uncertainty of **66.45 ms** still preserves the 500 ms margin.
- In the running-clock case old output becomes quiet approximately **36.92 ms
  before** the estimated lease deadline. The suspension case freezes native
  `currentTime` exactly, then advances **10.02 seconds** after resume while the
  page remains blocked. The old sink has RMS **0** on all 10 resume heartbeats;
  the new sink stays audible on all 10 corresponding heartbeats in each case.
- Queued old-page callbacks and an explicitly replayed stale heartbeat cannot
  regain current authority or reactivate the old output. Browser exceptions: zero.
- Edge analysis uses a 23.22 ms window/10 ms hop and signed native capture latency;
  capture queue/call bounds remain enforced. PCM stays on the owned remote client.

Activity measurement is opt-in in the remote fixture. Its .005 RMS quiet threshold
describes digital fixture output, not physical acoustic silence. Existing frequency
marker behavior remains unchanged when activity observation is disabled. Observer/
receiver fixtures pass **14/14**, including **5/5 Python PCM checks**:
`/tmp/ktv-integrated-stage-replacement-final-fixtures.log`. The first wrapper run
failed solely because it still expected three Python tests after two were added;
the explicit expected count is corrected. Initial browser proof was 39/39 before
adding conservative gap uncertainty and post-callback output observations.

This closes the integrated native software replacement gap. P05.8/A10 physical
speaker/output-buffer and real-network acceptance remain open. The app/backend,
production flags, public release, prepared SFU policy and rollback tag are unchanged;
no deployment is needed for these fixture/documentation changes. UDP timing/source
drift, timing through streaming handover, physical audio alignment, mobile/Safari/
field PWA, representative capacity and Wi-Fi/LTE release gates remain open.
Final cleanup verifies no owned remote profiles/processes or CDP listeners, and
no local CDP listeners. A fresh public read confirms the party entry and exact
`ca6c757` app/CSS/worklet bytes. The original main rollback tag still resolves to
`6e8504bf0c68e7253286e3c7a1db2b5bd8c1b718`.

### 2026-10-02 — Bounded source-phase correction and native rate verification

Unpublished candidate adds a bounded source actuator for persistent small rendered
errors. The room clock/generation, lease deadline, output-change detection and
large-error recovery thresholds are unchanged. Three same-sign samples above
15 ms, no sample above 80 ms and clock uncertainty at most 25 ms authorize feedback.
The local rate stays within 0.995–1.005, with at most .0005 change per one-second
sample and a half-second ramp. The source's actual scheduled-rate integral feeds
both delayed-output diagnostics and publisher lyric capture; a new source has a
fresh history. Physical pitch/listening and acoustic alignment are still open.

Candidate evidence:

- Party **93/93**, `/tmp/ktv-bounded-rate-candidate-units.log`: rate feedback sign,
  persistence/uncertainty/large-error rejection, ramp integration across delayed
  output timestamps and rendered capture; prior large-error/lease tests still pass.
- Type-check/build pass, `/tmp/ktv-bounded-rate-candidate-build.log`.
- Native rate integral **13/13**, `/tmp/ktv-bounded-rate-native-integral.log`:
  Chrome 137's actual offline PCM rendering retains all nine transitions for each
  fast/slow/reversed rate profile. Every marker and source completion matches the
  scheduled-rate integral within **3 ms**. No PCM is exported. This validates the
  media-position calculation independently of mocked AudioParams.
- Full native built streaming/output-pause/recovery/handover **56/56**,
  `/tmp/ktv-bounded-rate-native-output-pause-clean-av.log`. Pausing only the owned
  source Pulse output for **50.20 ms** activates actual native rate feedback;
  source phase returns below **20 ms**, with no new source or playback generation.
  All **40** clean A/V transitions match with no unmatched edges: p50 **31.56 ms**,
  p95 **63.12 ms**, maximum **87.82 ms**; source-to-video p95 **115 ms**.
- Native lease **15/15**, `/tmp/ktv-bounded-rate-native-lease.log`.
- Candidate UI **45/45** and PWA **10/10**,
  `/tmp/ktv-bounded-rate-candidate-pwa-ui.log` and
  `/tmp/ktv-bounded-rate-candidate-pwa.log`.

The first attempted source fault used an actual AudioContext suspend/resume rather
than an output-process pause. It correctly triggers `stage.suspended` and requires
explicit recovery: `/tmp/ktv-bounded-rate-native-stall-clean-av.log`. No state-change
guard is bypassed to make this a small-drift case. That experiment is replaced
with the separately owned output-process pause, preserving native browser/room
clocks and their guards. The new pause helper verifies private Pulse ownership,
limits its duration and always resumes it; owned cleanup also sends SIGCONT before
termination. The fault is opt-in; normal fixtures do not pause any output.

UDP repair experiment remains a failure, `/tmp/ktv-bounded-rate-no-sfu-hint-udp-av.log`.
All **40** impaired pairs match without unmatched edges; functional recovery and
full continuously impaired handovers pass before the final timing gate fails.
Skew p95 **326.23 ms**, maximum **527.44 ms**; source-to-video p95 **1548.20 ms**.
Source rate stays exactly 1 in that run (phase −9.9 to +7.6 ms), so it does not
prove feedback activation or resolve the earlier intermittent source-drift issue.
The largest skews are early after impairment: actual audio buffering rises from
~243 to ~955 ms over ten seconds while video rises to ~1054 ms much sooner,
despite equal requested targets near 1100 ms. This identifies unequal native
buffer growth as the next receiver investigation. No longer settle window,
different pair selection, relaxed 150/250 ms gate, reduced quality, or production
SFU-policy change is used. Public media stays disabled.

#### Exact candidate failure and native control work

Commit `8429a9b` is not published. Exact build passes;
`/tmp/ktv-bounded-rate-exact-pwa-ui.log` **45/45**,
`/tmp/ktv-bounded-rate-exact-pwa.log` **10/10**, and
`/tmp/ktv-bounded-rate-exact-stage-replacement.log` **41/41** pass.
`/tmp/ktv-bounded-rate-exact-output-pause-clean-av.log` fails: a later actual
render/wall interval loses approximately **181.28 ms** after about 66 seconds,
calculated phase reaches **214.6 ms**, and the unchanged large-error guard enters
room recovery. It does not complete the required 40-transition timing phase.
The earlier 56/56 candidate pass is not used to waive this failure.

The source synchronizer also performs unnecessary native `stop()` rescheduling
and worklet renewals every animation frame for an unchanged lease/clock mapping.
These are now deduplicated. A real deadline, clock offset or uncertainty change
still renews both; every frame still validates authority, expiry and playback.
The first source always gets its native deadline and worklet grant. **94/94**
units pass (`/tmp/ktv-rate-renewal-dedup-units.log`), including 120 unchanged
frame calls followed by real renewal and mapping changes. Native diagnostics now
retain bounded stop-call counts and recent main-thread long tasks. This reduces
known redundant control work; it is not yet proven to explain the larger stall.

Read-only infrastructure checks show the four-vCPU/16-GiB `t3a.xlarge` client is
in unlimited credit mode, has approximately **2302–2304 credits**, no surplus-credit
balance, and five-minute mean CPU below 30% over the checked hour. Post-fixture
sampling shows zero steal and no cgroup throttling, with over 10 GiB available.
This does not establish what happened during the 181 ms interval, but depleted
CPU credits are not supported by those records. No instance size, credit mode,
scheduling priority or other infrastructure setting is changed.

No publication has occurred. Production remains frontend `ca6c757`, backend
`f58a8f3`, rooms/guide on, media off, no persistent SFU. Private pre-publication
backup `/home/mli/ktv-party-bounded-rate-predeploy.n51pw2j0` contains consistent
SQLite (integrity/FKs pass), the current frontend and private backend config;
all files are 0600 under a 0700 directory. The original rollback tag is unchanged.
All temporary fixture browser/output profiles and owned SFU containers are cleaned.

#### Native verification of lease-control deduplication

Exact candidate `7c1f583` builds and type-checks successfully
(`/tmp/ktv-rate-renewal-dedup-exact-build.log`). Its native foreground Chrome
streaming fixture passes **56/56**
(`/tmp/ktv-rate-renewal-dedup-native-stream-20261002.log`), including a real
**50.19 ms** pause of the owned output process, bounded rate correction below
20 ms without replacing the song source, signaling recovery, token revocation
and full hybrid handovers. All **40** baseline marker pairs are accounted for,
with no unmatched audio/video edges: absolute A/V skew p50 **11.97 ms**, p95
**64.46 ms**, maximum **86.51 ms**; source-to-video delay p95 **114.10 ms**,
maximum **134.00 ms**. Resolution, frame rate and timing gates are unchanged.
The fixture exits successfully and its local forwarding ports/SFU are cleaned.

This run does not establish the cause of the earlier larger render stall or
close sustained stability, impaired UDP, measured handover timing or physical
acceptance. Exact native lease **15/15**, integrated stage replacement **41/41**,
UI **45/45** and PWA **10/10** subsequently pass:
`/tmp/ktv-rate-renewal-dedup-native-lease-20261002.log`,
`/tmp/ktv-rate-renewal-dedup-stage-replacement-20261002.log`,
`/tmp/ktv-rate-renewal-dedup-ui-pwa-20261002-ui.log` and
`/tmp/ktv-rate-renewal-dedup-ui-pwa-20261002.log`.

Frontend `7c1f583` is now published as `main-BRuMNKuZ.js`; CSS/worklet and
backend remain unchanged. **21/21 public checks** pass
(`/tmp/ktv-rate-preview-public-20261002.log`), including exact app/worker bytes,
source SHA, HTTP/WSS/flags, pairing defaults, database integrity/FKs and temporary
room cleanup without adding accounts. Private backup
`/home/mli/ktv-party-rate-preview-predeploy.kodqxyuw` holds the consistent database,
previous frontend and private config under 0700/0600 permissions. Publication
preserves old hashed assets and atomically replaces entry/worker with zero active
performances and no backend restart. Rooms/guide remain on; public media remains
off and no persistent SFU is running. The original stable main tag is unchanged.

#### Post-handover native A/V measurements

The owned room fixture now supports `KTV_ROOM_TEST_HANDOVER_AV=1` together with
remote native A/V and full hybrid handover. It adds a third independently owned
Chrome/Pulse output for the host, preventing simultaneous host/common-screen
players from contaminating the receiver's captured output. Receiver policy,
native clocks, recovery guards, 40-pair phases, marker matching and timing limits
are unchanged. Each new performance gets a fresh frame observer; repeated marker
IDs resolve to the latest preceding source capture, rather than an earlier singer
or a future redraw. A regression covers this attribution and future-only rejection.
The default 180-sample diagnostic bound remains; the additional-phase mode is
bounded at 400 samples. All three browser/output fixtures are owned and cleaned.

Fixture units **15/15** pass (`/tmp/ktv-post-handover-av-fixtures-20261002.log`).
On the unchanged deployed frontend `7c1f583`, the extended clean native journey
passes **61/61** (`/tmp/ktv-post-handover-native-av-20261002.log`):

| Phase | Matched pairs | Unmatched audio/video | Absolute skew p95 / maximum |
| --- | --- | --- | --- |
| Initial performer | 40 | 0 / 0 | 69.24 / 81.85 ms |
| Replacement singer | 40 | 0 / 0 | 42.67 / 54.51 ms |
| Venue-to-remote singer | 40 | 0 / 0 | 60.43 / 75.72 ms |

All observed source frame sizes remain 1280×720 using VP8 with the unchanged
25-fps/350-kbit/s screen-share request. Native reported rates span 20–26 fps in
the initial phase, 23–26 after singer replacement and 24–26 after venue-to-remote.
This is post-handover playback timing after track attachment, not a measurement
of the transition's audible gap or physical venue-mixer alignment. The synthetic
venue microphone contains a continuous 880-Hz input, so it cannot prove
remote-to-venue A/V alignment. Those gaps, continuously impaired post-handover
timing, physical devices and representative capacity remain open. No new frontend
publication, backend restart or persistent SFU is required for this fixture work.

#### Continuous UDP handover and current-browser comparison

The extended fixture was run with the unchanged deployed `7c1f583` app,
default SFU stream sync/adaptive 500-ms policy, 1280×720/25-fps/350-kbit/s
screen-share request and actual UDP 150-ms delay, up to 40-ms extra jitter and
5% packet loss retained through singer replacement. Baseline remains six pairs;
each impaired/new-singer phase requires 40, with the same unmatched-edge and
150-ms p95/250-ms maximum limits. No clock, source guard or receiver policy is
replaced.

Chrome **137.0.7151.68** fails
(`/tmp/ktv-continuous-post-handover-udp-av-20261002.log`). Initial impaired phase
has 40 pairs/no unmatched edges, absolute skew p95 **485.76 ms**, maximum
**684.39 ms**. The replacement singer then enters native drift recovery after
20 diagnostic samples, largest calculated source error **114.4 ms**; the phase
does not complete. Stop-call counts are **12–14**, not one per animation frame;
recent main-thread long tasks are empty until a final 52-ms task. Smaller repeated
native render/wall deficits are present. This proves deduplication reduced the
redundant calls, not that those calls caused or resolved the remaining stalls.

An independently cached, official Chrome for Testing **154.0.8037.92** also
fails (`/tmp/ktv-cft154-continuous-post-handover-udp-av-20261002.log`):

| Phase | Matched pairs | Unmatched audio/video | Absolute skew p95 / maximum |
| --- | --- | --- | --- |
| Baseline | 6 | 0 / 0 | 65.30 / 65.30 ms |
| Initial impaired performer | 40 | 0 / 0 | 347.30 / 380.53 ms |
| Replacement singer | 40 | 2 / 2 | 502.52 / 630.89 ms |

The replacement phase fails its unmatched-edge gate; venue-to-remote measurement
is not reached. Native source phase ranges **4.3–12.9 ms** in the impaired phase
and **0.3–11.1 ms** after replacement; the room is still playing without recovery
and there are no browser runtime exceptions. The comparison is not controlled
for the randomly generated loss sequence, so different skew values are not proof
of a browser improvement. It establishes a current-browser run with healthy
measured source timing and failed received A/V timing. Selected decoded
multi-packet frame assembly intervals average approximately **421–523 ms**,
supporting further investigation of packet recovery separately from source drift.

Fixture diagnostics now retain finite packet-assembly/keyframe/FEC counters and
bounded source timing/stop-call/long-task observations without SDP, credentials,
addresses or raw PCM. Missing browser counters remain missing. **15/15** fixture
units pass (`/tmp/ktv-assembly-diagnostics-fixtures-20261002.log`). The runner
accepts an explicit private build directory so future candidates can be built
without replacing an artifact another fixture is serving.

`scripts/party-install-test-chrome.py --version 154.0.8037.92` installs or verifies
only the current user's isolated cache. The owned remote helper accepts
`KTV_ROOM_TEST_CHROME_BIN` while retaining `/usr/bin/google-chrome` by default;
profiles, Pulse output, capture, loopback forwarding and watchdog ownership stay
unchanged. The observed binary version is verified, with archive SHA-256
`ff43322f335e436b2f4dcdfeeec5db032299e335a7e8c1c618b326e100ce8732`
and **196,202,491 bytes** recorded. Both test browser profiles/SFUs are cleaned;
the reusable versioned binary cache remains. System Chrome, public app/backend,
feature flags and infrastructure sizing are unchanged. Impaired handover timing,
native sustained stability, physical/browser/mobile and full release gates remain
open.

#### Independent publisher expiry and encoded-frame gate

The native lease fixture now publishes to a separate native WebRTC receiver with
its own private output detector, rather than playing the MediaStream back through
the AudioContext that the source freezes. Continuous RMS activity edges accompany
the heartbeat observations. Clocks, expiry and the 150-ms silence margin are
unchanged. This fixture is an actual point-to-point publisher path, not a full SFU
authorization or physical-device test.

Chrome **154.0.8037.92** confirms a roughly **30-ms** output burst after context
resume, approximately **818 ms after permit expiry**
(`/tmp/ktv-cft154-independent-native-lease-blank-receiver-20261002.log`, exit 1).
Explicitly clearing reused worklet output buffers adds useful hardening and passes
95 unit checks, but the independent native failure persists
(`/tmp/ktv-cft154-expired-output-clear-native-lease-20261002.log`). PCM expiry alone
does not close the encoded publication boundary.

The candidate installs a dedicated worker on both actual publisher RTP senders.
It drops encoded frames before packetization until armed by a validated permit;
independent wall/monotonic clock checks, a timer and per-frame deadline checks
permanently close expired, stopped, replayed or mismatched permits. Modern
`RTCRtpScriptTransform` and legacy transferred encoded streams use the same worker.
Only publisher connections request the legacy insertable-streams configuration.
Main-thread renewals use the same minimum of the media permit and current output
lease as the PCM graph. Server/provider revocation remains authoritative.

Closing PCM and RTP at the same early deadline removed the late burst but left
receiver concealment audible beyond the unchanged silence boundary
(`/tmp/ktv-cft154-encoded-lease-native-20261002.log`, exit 1). The revised RTP deadline
is uncertainty plus **10 ms** before expiry; PCM remains uncertainty plus **100 ms**
early, allowing encoded silence to reach the receiver before RTP closes. This
candidate passes **15/15** independent native lease checks on both Chrome 154
and Chrome 137, including running and frozen/resumed publisher contexts
(`/tmp/ktv-cft154-encoded-silence-drain-native-20261002.log`,
`/tmp/ktv-chrome137-encoded-silence-drain-native-20261002.log`). Party units pass
**105/105** (`/tmp/ktv-encoded-lease-final-units-20261002.log`), including both
adapter paths, unsupported publishers, worker failure and composable rejection.
The private production build/type-check passes
(`/tmp/ktv-encoded-lease-candidate-build-20261002.log`). The same candidate's full
native Chrome 154 SFU journey passes **56/56**
(`/tmp/ktv-encoded-lease-candidate-full-room-20261002.log`): provider confirmation,
received lyric video, private-guide exclusion, audience recovery, singer change,
revocation and both hybrid handover directions. After a real **50.18-ms** source
output pause, the baseline has **40 pairs**, no unmatched edges, absolute skew
p95 **68.02 ms**, maximum **88.69 ms**. Post-handover timing is not measured in
this run; it is functional handover evidence. Owned profiles, SFU and forwarding
ports are cleaned. Exact committed release/UI/PWA/stage-replacement and public
publication checks remain before deployment. Public app,
backend and disabled media flag are unchanged. Arbitrarily buffered network audio
and physical output remain acceptance work.

The committed `28bde60` production build also passes **41/41** integrated native
Chrome 154 stage-replacement checks
(`/tmp/ktv-encoded-expiry-release-replacement-20261002.log`): the expired output
stays quiet through native clock suspension, reassignment, resume and queued old
callbacks. Release inspection found the small encoded worker was inlined as a
data URL. The build now emits `.worker.js` as a separate hashed same-origin asset,
like the rendering worklet, for explicit JavaScript delivery and PWA precaching.
Final UI/PWA and actual publisher checks must exercise that emitted asset before
publication. The initial local foreground launcher used the wrong display; the
owned desktop uses `:2`, not the unauthenticated login display `:0`.

#### Encoded publisher expiry preview published

Frontend **`d33b209`** is deployed at `https://music.micstec.com/party`; backend
**`f58a8f3`** and the single `karaoke-auth` process remain unchanged. Exact assets
are `main-DU8DSm-f.js`, `main-DnE6rWx5.css`,
`partyLeaseGuard.worklet-BWdT3O5D.js` and
`partyEncodedLease.worker-BxVsrNxp.js`. Both native modules are emitted as hashed
same-origin JavaScript and precached by the generated worker.

- Exact committed build/type-check passes
  (`/tmp/ktv-encoded-worker-release-build-20261002.log`).
- Owned foreground Chrome 146 UI **45/45** and PWA **10/10** pass
  (`/tmp/ktv-encoded-expiry-release-ui-20261002.log`,
  `/tmp/ktv-encoded-expiry-release-pwa-20261002.log`), including failed activation,
  retry and removal of legacy cached room authority.
- Exact Chrome 154 full native SFU journey passes **56/56**
  (`/tmp/ktv-encoded-worker-release-full-room-20261002.log`): decoded emitted-worker
  publication, private guide exclusion, audience recovery, singer replacement,
  revoked-token rejection and both hybrid handover directions. After an actual
  **50.21-ms** output pause, baseline **40 pairs**, zero unmatched edges, absolute
  skew p95 **70.36 ms**, maximum **97.70 ms**. This run does not measure handover
  transition timing or impaired-network alignment.
- Public HTTP/WSS, effective flags, exact asset bytes, module JavaScript MIME,
  generated worker precaching and committed build identity pass **23/23**
  (`/tmp/ktv-encoded-expiry-public-release-20261002.log`). Temporary public room is
  closed, no user identity added, database integrity and foreign keys pass.

Independent native lease tests pass **15/15** on both Chrome 137 and 154 using the
unchanged guard source in `28bde60`; integrated stage replacement passes **41/41**
on that committed candidate. Party units **105/105** pass. Public room/guide
features remain enabled, media disabled and no persistent SFU running. All owned
test profiles, SFU containers and forwarding ports are cleaned. Static publication
retained older hashed assets and took a consistent private rollback backup at
`/home/mli/ktv-party-encoded-expiry-predeploy.p_7g43dq` (0700 directory, 0600 files),
containing previous frontend `7c1f583`, backend `f58a8f3`, checked SQLite backup,
frontend archive and runtime configuration. Original main tag remains
`ktv-party-baseline-2026-09-29` at `6e8504b`. Impaired timing, sustained/physical
audio, mobile/installed-PWA, nominal audience and multi-room capacity, distinct
networks and persistent online release remain open.

### 2026-10-02 — Private codec comparisons and measured quality gates

The current public preview remains frontend `d33b209`, backend `f58a8f3`, with
room and guide enabled, media disabled and no persistent SFU. Clean native
playback passes; impaired received A/V timing remains the primary software
release gate. The target remains p95 **150 ms**, maximum **250 ms**, with 40
matched transitions and at most one unmatched audio/video edge each.

`scripts/party-codec-experiment-build.mjs` creates an isolated real-app build only
under a fresh `/tmp/ktv-codec-candidate-*` directory. It retains the production
1280×720 / 25-fps capture and 350-kbit/s video ceiling, replaces exactly one
publisher option literal, and disables secondary backup encoding for the private
comparison. That setting is not a public compatibility decision: any future
secondary encoder needs its own publication lease guard. The builder records
source/effective module hashes and verifies production sources, commit and all
`dist` bytes remain unchanged. The root `ktv-codec-experiment.json` marks the
artifact as private and incompatible with the normal publication whitelist.

Native counters now establish actual negotiated codec, stable single video path,
dimensions, sender settings and whole-phase source/receiver frame cadence. Both
measured frame rates must remain 20–30 fps, without selecting a favorable window.
Missing/reset counters, SSRC changes, hidden additional encoders, lower resolution
or codec fallback remain failed evidence. Diagnostics retain bounded whitelisted
sender settings without labels, RID, SDP or credentials. Runtime failures expose
fixed error categories instead of raw exception text.

All comparisons use native Chrome 154, an independent EC2 audience and continuous
UDP impairment of 150-ms delay, up to 40-ms jitter and 5% datagram loss per leg.
The random loss sequence is not identical across runs; differences in numerical
skew are not a controlled ranking of codecs.

| Private candidate | Baseline absolute p95 / max | Impaired result | Decision |
| --- | --- | --- | --- |
| VP9, native SDK SVC | 99.81 / 99.81 ms, 6 pairs | Timeout before 40 pairs; source 21.78 fps, receiver 16.90 fps across 89.23 seconds; one runtime exception with category unavailable in that older run | Failed completion and nominal receiver cadence |
| H264 | 95.96 / 95.96 ms, 6 pairs | 40 pairs, one unmatched edge each; p95 652.51 / max 735.10 ms; nominal cadence retained; later hybrid provider confirmation also times out | Failed timing and functional completion |
| VP8 plus native NTP receiver controller | 106.89 / 106.89 ms, 6 pairs | 40 pairs, no unmatched edges; p95 391.39 / max 709.46 ms; source 23.44 fps, receiver 23.36 fps; functional recovery/handover passes | Failed timing |

Logs: `/tmp/ktv-vp9-continuous-udp-codec-20261002.log`,
`/tmp/ktv-h264-continuous-udp-codec-20261002.log`,
`/tmp/ktv-vp8-native-ntp-continuous-udp-20261002.log`.
The VP9 runtime count alone does not establish its exact exception category.
Native NTP playout estimates are available in the newer browser runs; successful
buffer-target assignment still does not prove that received markers meet limits.

A fourth private candidate requests a video keyframe every **500 ms** through the
standard encoded-transform worker, independently of test markers. The production
worker is unchanged. Requests require a live permit, serialize pending promises,
and fail closed if the API is unsupported or rejects. Audio does not receive the
timer. Native encoded keyframe counts must establish at least 80% of the requested
cadence; successful API promises alone cannot pass. This tests the hypothesis that
video reference recovery contributes to delay, without claiming a proven cause.
The private build passes and production `dist` is unchanged. Fixture units pass
**21/21** (`/tmp/ktv-codec-keyframe-quality-fixtures-20261002.log`). The native run
at `/tmp/ktv-vp8-keyframe500-continuous-udp-20261002.log` exits 1: publisher
provider confirmation times out before any baseline/impaired marker measurement.
Playback enters `recovering` / `stage.unavailable`, the publisher reports its
performance connection ended, and browser runtime exceptions are zero. No actual
keyframe cadence or A/V improvement is established. The precise worker/provider
failure reason was not retained by this initial run.

The diagnostic follow-up changes only passive fixture instrumentation, retaining
bounded same-origin worker event types and fixed failure reasons, without identity,
grants, URLs, arbitrary worker data or exception text. Native message delivery and
transfer arguments are preserved. Units pass **24/24**
(`/tmp/ktv-encoded-worker-diagnostic-fixtures-20261002.log`). The instrumented
native run `/tmp/ktv-vp8-keyframe500-worker-diagnostic-20261002.log` exits 1 before
readiness again and identifies **`keyframe-unsupported`**: the publisher worker
emits `ready`, then `silent` with that reason. Runtime exception count is zero.
This establishes that the worker method is absent in the tested Chrome 154;
it does not establish that periodic reference recovery itself cannot help.

The next private experiment uses the optional `encodingOptions: [{keyFrame:true}]`
argument on the actual native video sender's `setParameters`. This follows the
[WebRTC extension specification](https://w3c.github.io/webrtc-extensions/#rtcrtpsender-setparameters-keyframe).
Fresh parameters retain the native transaction ID; no encoding settings, tracks,
timestamps, grants or normal encoded-frame lease are modified. One video sender
is required, pending calls are serialized, and ended/replaced tracks or changed
nominal settings stop requests. Successful promises alone still cannot pass:
the same whole-phase native encoded-keyframe cadence gate applies. The fixture
option is `KTV_ROOM_TEST_SENDER_KEYFRAME_MS=500`, requires a marked private codec
artifact without worker keyframe overrides, and defaults off. Timer disposal is
included in owned fixture cleanup. Units pass **27/27**
(`/tmp/ktv-native-sender-keyframe-fixtures-20261002.log`). The native sender path
works in the tested browser: **210/210** requests fulfill, and baseline encodes
23 keyframes over 11.62 seconds. That is actual encoder evidence, independent of
the worker API failure.

The 500-ms sender run exits 1
(`/tmp/ktv-vp8-sender-keyframe500-continuous-udp-20261002.log`):

| Phase | Matched pairs / unmatched audio-video | Absolute p95 / max | Measured source / receiver fps | Actual keyframes per second |
| --- | --- | --- | --- | --- |
| Baseline | 6 / 0-0 | 109.50 / 109.50 ms | 25.05 / 24.94 | 1.98 |
| Impaired | 40 / 0-0 | 360.71 / 478.16 ms | 13.50 / 10.83 | 2.00 |

Resolution remains 1280×720 and requested settings remain 25 fps / 350 kbit/s.
The measured cadence and timing both fail; a lower actual frame rate cannot pass
through the requested nominal settings. Browser runtime exceptions are zero;
functional recovery and both hybrid directions finish before the quality gate
rejects the run. The original sender ends normally after 210 requests. Native
video target bitrate varies during impairment; this run does not establish a
unique cause for frame-rate loss. The distinct one-second sender interval also
exits 1 (`/tmp/ktv-vp8-sender-keyframe1000-continuous-udp-20261002.log`):

| Phase | Matched pairs / unmatched audio-video | Absolute p95 / max | Measured source / receiver fps | Actual keyframes per second |
| --- | --- | --- | --- | --- |
| Baseline | 6 / 0-0 | 80.15 / 80.15 ms | 24.97 / 25.05 | 0.96 |
| Impaired | 40 / 1-1 | 344.20 / 672.72 ms | 16.25 / 14.94 | 1.00 |

All **104/104** requests fulfill, both phases retain 1280×720 and requested
25-fps / 350-kbit/s settings, and runtime exceptions are zero. Functional audience
recovery, singer replacement and both hybrid directions finish; the unchanged
whole-phase nominal cadence gate rejects the run, with timing independently also
outside limits. Source/receiver encode/decode cadence changes are measured;
random loss sequences preclude a controlled claim of improvement between periods.
Periodic keyframes alone have not satisfied the release contract. The next
investigation should use measured native delay/frame progress for demand-driven
recovery and retain nominal quality, rather than repeat either unchanged periodic
candidate. No public app, backend, codec, guard, feature flag or infrastructure
sizing changes. Owned profiles, SFU and forwarding ports are cleaned.

Remaining acceptance: impaired and post-handover timing; sustained source/output
stability and longer outages; five-minute physical phone/stage guide alignment,
headphone calibration and microphone/venue isolation; Safari/iOS/Android,
background/lock/autoplay and field-installed PWA; full nominal audience and
multi-room load; distinct Wi-Fi/LTE access networks; persistent SFU/TURN and final
online/hybrid publication. Optional P09 enhancements follow the core release.

### 2026-10-02 — Demand-driven native keyframe recovery experiment

The fixed-interval results motivated a distinct private hypothesis: request
recovery only on native video lag or stalled decoded-frame progress. The pure
`scripts/party-keyframe-recovery.mjs` step receives native audio/video RTP reports
and sample time; it never receives marker IDs, pixel values, lyric state, marker
skew or source test transitions. It seeds a fresh progress window, validates
stable SSRCs and nondecreasing counters, and rejects missing/stale evidence.

The trigger is video behind audio by more than 150 ms on aligned native NTP
playout estimates, bounded to two seconds, or no decoded-frame progress across
a valid 500–2500-ms sample interval. Requests are separated by at least five
seconds and suppressed when a new keyframe has just been decoded. Missing NTP
estimates cannot produce a delay trigger; independently measured frame stalls
can still qualify. Fresh phase windows preserve the request cooldown across
network setup/settling gaps.

The native sender helper now supports explicit requests without a periodic
timer, preserving its single-video-sender check, exact fresh parameters, pending
serialization and closed/ended/policy-failure behavior. The normal encoded-frame
lease remains authoritative. The fixture records fixed recovery reasons and
observes newly encoded keyframes after requests on the same sender. This is
encoder-progress evidence; it does not uniquely attribute an individual keyframe
when native provider recovery could also request one.

`KTV_ROOM_TEST_DEMAND_KEYFRAMES=1` requires actual native A/V capture and a private
marked codec artifact, rejects competing keyframe policies, and defaults off.
This first experiment measures baseline and initial impaired publication only;
its request delivery uses owned test coordination. Functional singer/hybrid
handover is still exercised afterward, but production recovery signaling and
post-handover timing are not implemented or proven by this fixture option.
All original full-release requirements remain open.

Fixture units pass **31/31**
(`/tmp/ktv-demand-keyframe-fixtures-20261002.log`), including pending/closed manual
requests, five-second cooldown, recent-keyframe suppression, missing estimates,
counter resets, SSRC changes and stale samples. The native continuous UDP run
`/tmp/ktv-vp8-demand-keyframe-continuous-udp-20261002.log` exits 1:

- Baseline: six pairs, no unmatched edges, p95/max **100.50 ms**; measured source
  **25.06 fps**, receiver **24.95 fps**.
- Impaired phase times out before 40 matches. Across **85 samples / 89.00
  seconds**, measured source **2.37 fps**, receiver **2.42 fps**; both nominal
  cadence gates fail. Six requests fulfill and six later source samples show
  newly encoded keyframes on the same sender.
- Initial impaired source sample is already **13 fps / 38-kbit/s target**, before
  the first recovery request. Available outgoing bitrate falls from **83,076**
  to **30,000 bit/s**, with video target near 30 kbit/s. The network/encoder rate
  collapse therefore precedes demand recovery; the run does not establish its
  unique cause or prove the recovery rule caused it.
- Playback remains `playing`, publisher still reports sending, encoded worker
  reports `ready` without a silent fault, and browser runtime exceptions are zero.
  Functional audience/singer/hybrid recovery after the timed-out phase is not
  reached. This is failed evidence, not an impaired sync or nominal quality pass.

The next investigation separates bandwidth-estimation behavior from reference
recovery. The pinned SDK's `singlePeerConnection` defaults to true but can fall
back; the effective transport must be observed rather than inferred from options.
Passive `scripts/party-rtc-feedback.mjs` now records only fixed peer/description
types, media kinds/directions and negotiated feedback/extension booleans, with
bounded peer, section and SDP sizes. No SDP, payload/stream IDs, credentials,
addresses or track labels are retained. Units pass **33/33**
(`/tmp/ktv-feedback-demand-fixtures-20261002.log`). The native clean negotiation
and functional run `/tmp/ktv-native-feedback-clean-20261002.log` passes **49/49**,
using unchanged release `dist` with no recovery/impairment policy: provider
readiness, private guide exclusion, audience/publisher capability recovery,
singer replacement and both hybrid directions, with zero browser exceptions.
This run does not measure A/V marker timing.

The publisher has one observed native peer. Its local `sendonly` video offer and
corresponding remote `recvonly` answer both negotiate **transport-cc and
goog-remb feedback**, with transport-wide sequence and absolute-send-time
extensions. The audience's active video answer negotiates **goog-remb without
transport-cc feedback**. Reserved receive sections also exist; their advertised
capabilities must not be mistaken for active delivery. The next distinct
hypothesis is a scoped publisher feedback comparison, retaining a negotiated
supported estimator, rather than disabling all congestion feedback. The pinned
[server direction configuration](https://raw.githubusercontent.com/livekit/livekit/v1.13.7/pkg/rtc/config.go)
distinguishes consolidated and legacy publisher capabilities, so capability
assumptions alone are insufficient. No feedback override is implemented or shipped
by this checkpoint. Native owned profiles, SFU and forwarding ports are cleaned.

Public frontend `d33b209`, backend `f58a8f3`, media disabled, production artifacts
and infrastructure are unchanged. All candidates retain the nominal measured
quality and original 150-ms p95 / 250-ms maximum received A/V gates. Physical,
mobile, post-handover timing, longer outages, full audience/multi-room capacity,
distinct access networks and persistent online/hybrid release remain open.

### 2026-10-02 — Private transport comparisons and buffered receiver expiry regression

The fixture now supports a scoped private REMB feedback comparison and an actual
SDK dual-peer transport build. Neither option changes production sources or the
published `dist`. Private artifacts retain the non-release marker and all original
measured cadence, dimension, bitrate and A/V timing gates.

The REMB rewrite targets only an explicit publisher `sendonly` video section,
requires existing REMB and absolute-send-time capabilities, and preserves all
other SDP bytes. Owned offer/answer wrappers preserve native arguments and close
without removing another owner's wrapper. Fixtures pass **36/36**
(`/tmp/ktv-publisher-remb-fixtures-20261002.log`). Actual negotiation in
`/tmp/ktv-vp8-publisher-remb-continuous-udp-20261002.log` fails the strict gate:
the local offer drops transport-cc feedback, but the provider answer retains it.
There is no measured estimator comparison or baseline A/V result in this run.
Capability advertisements do not prove an active REMB estimator.

`--transport dual` inserts the SDK's supported `singlePeerConnection: false`
option into a private build. Artifact
`/tmp/ktv-codec-candidate-vp8-dual-20261002` records codec VP8, backup disabled,
SDK 2.22.3, source commit `80880e0` and the unchanged encoded lease worker.
Its build verifies production source and `dist` digests remain unchanged.
The native run observes exactly two peers, one with the audio/video sender pair.

All comparisons retain continuous UDP impairment of 150-ms delay, up to 40-ms
jitter and 5% loss on each leg, plus functional recovery and both hybrid directions:

| Private run | Baseline | Impaired result | Outcome |
| --- | --- | --- | --- |
| Dual peers, default buffers/policy | Six pairs, no unmatched edges; p95/max 73.41 ms; source/receiver 24.98/24.99 fps | 40 pairs, one unmatched edge each; p95 325.73 ms, max 374.16 ms; source/receiver 22.25/22.12 fps | Nominal quality and functional recovery pass; impaired timing fails |
| Dual peers, both native targets 1000 ms, SFU hints off | Six pairs, one unmatched edge each; p95/max 593.09 ms; source/receiver 24.97/23.44 fps | 40 pairs, no unmatched edges; p95 274.96 ms, max 333.82 ms; source/receiver 18.81/18.62 fps | Startup/impaired timing and impaired nominal quality fail; functional recovery finishes |

Logs: `/tmp/ktv-vp8-dual-continuous-udp-20261002.log` and
`/tmp/ktv-vp8-dual-fixed1000-nohint-continuous-udp-20261002.log`. Both report zero
browser exceptions. Packet loss is random; these runs do not prove dual transport
causes better bandwidth estimation. Equal requested audio/video buffer targets
do not establish equal actual playout, particularly during initial buffer growth.
No longer settling window or omitted startup markers were used to hide failures.

A distinct native expiry regression sets the independent WebRTC receiver's actual
`jitterBufferTarget` to 1000 ms. This receiver is separate from the blocked or
suspended publisher page, with continuous native PulseAudio output observation.
`/tmp/ktv-cft154-buffered-receiver-lease-20261002.log` exits 1:

- Both direct stage-output cases pass their unchanged expiry boundary.
- Publisher/task-stall remains continuously audible at expiry +150 ms. Its quiet
  edge arrives at **expiry +273.08 ms**. The capture call is 0.005 ms, queue
  approximately -0.75 ms, analysis window 23.22 ms: a delayed observer does not
  account for the violation. Counting only later positive heartbeat events would
  miss the continuous audible state and is not a valid pass criterion.
- The native receiver getter verifies the 1000-ms target. Measured audio buffer
  counters show actual buffering; the requested target is not the measured delay.
- All four profiles are recorded before assertions. The assertion loop stops at
  publisher/task-stall, so the later suspended publisher record is not a completed
  final gate. Browser runtime exceptions are zero.

The source PCM and encoded-frame guards remain unchanged. Source transmission
expiry cannot remove samples already in a receiver's native buffer. The next
implementation must enforce the authoritative source deadline at receiver output,
including blocked tasks, frozen/resumed audio clocks, nonce/performance changes
and stale renewal rejection. Increasing buffering cannot be released without it.

Public frontend `d33b209`, backend `f58a8f3`, media disabled and no persistent SFU
remain unchanged. These results do not close P06/P07/P08, physical/device,
post-handover timing, sustained/capacity, real access-network or final release gates.

### 2026-10-02 — Receiver output deadline candidate

`src/services/partyReceiveGraph.ts` applies the source deadline after native
WebRTC buffering, reusing the existing absolute-clock render worklet. Its single
received-audio input passes through a closed gain and the guard to the destination.
It retains the 100-ms early cutoff, bounded clock uncertainty and ten-second
permit ceiling. Publisher nonce, clock, performance and generation must match.
A previous expired deadline, shorter authority, ended track, suspended context,
wall-clock discontinuity or render fault permanently closes that graph. A delayed
renewal cannot build another processor and revive old output. The caller owns
and retains the received track and context; closing the graph disconnects its
nodes without stopping the caller's inputs.

The backend's admitted, device-owned `POST /media/:identity/output` endpoint
returns only the current provider-ready source's identity/deadline or null.
The deadline is bounded by the exact monotonic permit last returned to that
publisher, the stage lease and the listener's own expiry. An in-memory per-source
bound avoids recomputing a slightly different source deadline from wall timestamps
for each listener; removal/pruning deletes it, and a restarted service returns no
source authority until a current publisher permit is actually returned.
No new database migration, token, member name or guide asset is returned.

The audience transport subscribes only to that authorized source, keeps one shared
always-muted video element containing both tracks and makes the post-buffer graph
the sole audible path. It owns element binding directly because the SDK's audio
attachment/start method can unmute raw received audio. Element/graph ownership
prevents delayed old-source subscriptions from clearing a replacement. Admission,
room/mode, generation, visibility, clock and connection loss close old output.
Output authority is refreshed once per second with one request per active attempt;
late replies after Stop/navigation are ignored. SDK subscription requests are sent
only when desired state changes, rather than on every deadline recheck.

The first full-room attempt exits 1 before receiving tracks
(`/tmp/ktv-receiver-output-native-room-final-20261002.log`), with a permission
failure and zero browser exceptions. A real startup race was identified: the
100-ms listener timer could poll while the asynchronously loaded transport was
still absent, then treat that absence as rejected authority. Polling now requires
an initialized transport. The lifecycle regression explicitly delays loading,
ticks the timer and proves no premature request or revocation.

Evidence so far:

- Final type check passes (`/tmp/ktv-receiver-output-typecheck-final2-20261002.log`).
- Targeted graph/transport/lifecycle checks pass 59/59 after the subscription
  deduplication and countdown continuity checks
  (`/tmp/ktv-receiver-integrated-targeted-final4-20261002.log`).
- Final full party checks pass **123/123**
  (`/tmp/ktv-receiver-output-party-final2-20261002.log`). The earlier parallel run
  fails one unrelated 300-ms existing audio-decode fixture wait; that fixture
  passes 26/26 in isolation and the subsequent full run passes.
- Backend grant/HTTP scope checks pass 22/22
  (`/tmp/ktv-receiver-authority-backend-final2-20261002.log`), covering exact source
  deadline, readiness, nonce replacement, generation/revocation, restart, foreign
  member/device/room and paired-display scope.
- Independent Chrome 154 buffered-output regression passes **20/20** with actual
  1000-ms target, separate native output capture and both publisher and receiver
  page tasks blocked (`/tmp/ktv-cft154-buffered-receiver-guard-context-20261002.log`).
  The task-stall quiet edge is **35.27 ms before** the source deadline. The
  suspended receiver's render clock actually freezes, no late output occurs after
  resume, and later renewal cannot revive either graph. Both direct stage cases
  also pass; no browser exception. Earlier receiver bootstrap attempts fail before
  measuring publisher output; a fresh owned browser context resolves that setup.
- Private artifact `/tmp/ktv-codec-candidate-receiver-output-race-20261002` builds
  successfully and preserves production sources/`dist`. It uses a marked VP8,
  backup-disabled comparison, 1280x720/25 fps/350 kbit/s and default SDK transport;
  the encoded lease worker remains unchanged. This artifact predates the small
  subscription-request deduplication guard; its evidence must not be described as
  an exact final release build.

The first corrected room journey (`/tmp/ktv-receiver-output-native-room-race-20261002.log`)
passes the 40-pair baseline, guide isolation, fresh audience recovery and functional
singer replacement, then times out measuring 40 next-singer pairs. Source cadence
is 24.99 fps; receiver diagnostics show a path/counter change; playback remains
playing and browser exceptions are zero. An unnecessary player replacement on
scheduled-to-playing was identified: that state change retains the same valid
source, clock and generation. The watcher now retains that output and only closes
it on lost authority or a real binding change. A late play rejection from a removed
old element also cannot mark a new player's audio blocked. A lifecycle regression
checks countdown completion retains the same authority. The candidate is rebuilt
with these changes and subscription-request deduplication.

The corrected native room journey passes **64/64**
(`/tmp/ktv-receiver-output-native-room-handover-20261002.log`), using
`/tmp/ktv-codec-candidate-receiver-output-handover-20261002` with subscription
requests deduplicated and countdown output preserved:

| Phase | Matched / unmatched audio / unmatched video | p95 / maximum received skew | Measured source / receiver fps |
| --- | --- | --- | --- |
| Baseline | 40 / 0 / 0 | 81.37 / 98.70 ms | 24.99 / 24.98 |
| Replacement singer | 40 / 0 / 0 | 101.26 / 102.61 ms | 25.00 / 25.00 |
| Venue-to-remote | 40 / 0 / 0 | 123.62 / 125.82 ms | 25.00 / 24.98 |

All original matching, observation-delay, native capture queue, nominal dimensions
and actual source/receiver cadence gates pass. Browser exceptions are zero.
The actual room policy/provider confirms one publisher, mix and captured lyrics;
private vocal guide exclusion, fresh audience recovery, source revocation,
replacement, and both hybrid directions pass. The result does not measure acoustic
alignment, transition-gap timing or continuously impaired post-handover timing.
The final typed artifact `/tmp/ktv-codec-candidate-receiver-output-typed-20261002`
builds successfully. Its main runtime matches the measured artifact after
normalizing only the existing informational Sidebar build timestamp; other
compiled assets are byte-identical. That timestamp changes the main filename and
its index/service-worker references. The type annotation does not change media
runtime behavior. These are private VP8 comparison artifacts, not a published
release. Production `dist/index.html` remains SHA256
`22029bb64d1efd421e73be97a3b681b238b8267424e5af9c7a42855202abf1d5`.

**Next safety requirement (code review; fault test pending):** issued audience
deadlines must be reserved by backend
handover scheduling. `device.stopped` currently can shorten a stage's safe-after
bound while a blocked listener still holds a later deadline and queued samples.
Scheduled pause/seek boundaries must likewise account for already issued receiver
authority. Client snapshot handling works when tasks run, but cannot replace a
server reservation when a listener task is stalled. This new requirement remains
open; do not claim buffered early-stop/replacement safety from clean handovers or
from expiry-only isolated checks. The existing durable restart bound must continue
to cover any receiver authorization ceiling.

Impaired-network, stalled handover, physical, old-client, Safari/mobile,
long-outage, nominal capacity and public-release acceptance remain open.

Public frontend `d33b209`, backend `f58a8f3`, production assets and media-disabled
configuration remain unchanged; no persistent SFU is running.

### 2026-10-03 UTC — Reserve received audio across early source stop

Two real playback/grant regressions initially fail: a source-stop acknowledgment
shortens the stage safe-after bound below an already delivered receiver cutoff,
and a planned pause changes generation before that cutoff
(`/tmp/ktv-receiver-reservation-red-20261003.log`).

The listener output API now reserves authority in the actual playback lease
before returning it. Reservations bind room, lease, clock, performance and
generation, reject past/non-finite/overlong deadlines and retain the greatest
issued cutoff. Source-stop acknowledgments, pending-pause sweep and heartbeat
renewal retain that cutoff plus the configured output margin. Transitions wait
until previously issued authority expires; output permits also observe a pending
boundary before sweep, preventing a renewal race. Provider removal cannot discard
an already delivered reservation. Publisher expiry and reservation ceilings share
the existing five-second constant; the durable stage restart bound covers it even
after a shorter new configuration. No timing/quality gate is relaxed.

Evidence:

- Targeted playback/grant/HTTP checks pass **50/50**
  (`/tmp/ktv-receiver-reservation-final-20261003.log`). The full backend suite,
  including an actual HTTP-output-to-stop reservation assertion, passes **138/138**
  (`/tmp/ktv-receiver-reservation-backend-all-20261003.log`).
- The native early-stop fixture passes **31/31**
  (`/tmp/ktv-receiver-early-stop-native-final-20261003.log`), using
  Chrome **154.0.8037.92**, actual SQLite playback/grant services, separate native
  peer/output contexts and the receiver's verified **1000-ms** buffer target.
  The native source closes before acknowledging stop. The listener page remains
  blocked, including a separate suspended/resumed-render-clock case. Replacement
  is refused before the actual reserved safe-after boundary and receives a fresh
  lease/generation afterward. Six independently captured old-output samples per
  case remain silent through replacement; the replacement stays actually audible
  under renewed real source permits. Output edges retain the unchanged **500-ms**
  safety margin, edge capture satisfies its queue/call/analysis bounds, and late
  renewal cannot revive the old graph. No browser exception. The earlier 29-check
  pass is retained in `/tmp/ktv-receiver-early-stop-native-long-observation-20261003.log`.
- Initial native attempts fail the observer's five-sample requirement because
  its window contains only two samples; observed old output is already silent.
  The corrected fixture extends its blocked observation and renews the new source,
  preserving the sample requirement. The real device-message service is called
  directly; this fault fixture does **not** establish HTTP/SFU fault acceptance
  or physical speaker/phone behavior.
- The full clean SFU room/recovery/handover rerun passes **64/64**
  (`/tmp/ktv-receiver-reserved-room-handover-20261003.log`) using the unchanged
  private typed receiver artifact and the new actual backend. All three phases
  match **40** markers, with **zero** unmatched audio/video edges. Received p95/
  maximum skew is **67.39/67.78 ms** at baseline, **87.87/107.57 ms** for the next
  singer and **75.22/76.01 ms** after venue-to-remote handover. Actual source/
  receiver cadence is approximately **25 fps** throughout; all nominal resolution,
  cadence, capture and timing gates pass, and browser exceptions are zero. This
  remains a clean-network private VP8 comparison, not impaired/SFU-fault release
  acceptance or an approved production codec change.

Native fault command: `KTV_LEASE_TEST_RECEIVER_HANDOVER=1` with
`KTV_LEASE_TEST_RECEIVER_GUARD=1` and `KTV_LEASE_TEST_RECEIVER_TARGET_MS=1000`.
Optional `KTV_LEASE_TEST_RECEIVER_HANDOVER_ONLY=1` selects those two fault journeys;
the default continues to run the existing stage/publisher expiry journeys.

The backend reservation requirement recorded above is now implemented and has
native direct-WebRTC evidence. Full SFU fault, old-client compatibility, impaired
A/V, physical/mobile, capacity and release acceptance remain open. Public frontend
`d33b209`, backend `f58a8f3` and disabled-media configuration remain unchanged.

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
| Queue fanout backend update | Backend `6c73d58`, frontend `4a216be` | `https://music.micstec.com/party` | 2026-10-01 | Backend 104/104; public queue/WSS/replay/cleanup 4/4; isolated 20-member/60-socket/100-song capacity probe and cap denials pass | Online flag disabled; physical/browser and public media acceptance remain open |
| Mobile UI/capture preview | Frontend `3e76e15`, backend `09879ac` | `https://music.micstec.com/party` | 2026-10-01 | Party units 49/49; exact-build UI 29/29, PWA 6/6 on both owned Chrome processes; public assets/routes/SHA/health/SQLite 8/8 | Online flag disabled; transient earlier PWA update timeouts recorded; physical/browser and full streaming acceptance open |
| Timing policy backend | Backend `0e0c7aa`, frontend `3e76e15` | `https://music.micstec.com/party` | 2026-10-01 | Backend 121/121; party units 49/49; type check and UI 29/29; public HTTP/WSS/timing/schema/cleanup 11/11 | Online flag disabled; physical/browser and integrated/different-network streaming acceptance remain open |
| Feature-switch preview | Frontend/backend `9b74e8f` (`main-B6kwN6KJ.js`) | `https://music.micstec.com/party` | 2026-10-01 | Backend 126/126, party units 49/49, exact-build UI 38/38 and PWA 8/8; public flags/HTTP/WSS/assets/SHA/cleanup 18/18 | Media remains disabled; integrated streaming, physical timing and browser/device acceptance remain open |
| Streaming lease/handover preview | Frontend `d6d4041` (`main-Df1mhgtD.js`), backend `9b74e8f` | `https://music.micstec.com/party` | 2026-10-01 | Party units 53/53; exact-build UI 38/38, PWA 8/8, full remote Chrome room-media 20/20; public HTTP/WSS/assets/SHA/cleanup 18/18 | Public media disabled; physical/mobile/jitter, local/online route handover and distinct access-network/load acceptance remain open |
| Audience recovery preview | Frontend `b9fbb91` (`main-C3F6BNH-.js`), backend `9b74e8f` | `https://music.micstec.com/party` | 2026-10-01 | Party units 64/64; exact-build UI 38/38, PWA 8/8, remote room/media-signaling interruption/hybrid handover 47/47; public HTTP/WSS/assets/SHA/cleanup 18/18 | Public media disabled; physical/mobile, media packet impairments, A/V/end-to-end timing and sustained representative load remain open |
| Output lease correction preview | Frontend `29a62cf` (`main-_4MVKaX7.js`), app fix `301d5c3`, backend `9b74e8f` | `https://music.micstec.com/party` | 2026-10-02 | Party 73/73; candidate UI 38/38, PWA 8/8 and no-impairment A/V/reconnect/hybrid 51/51; exact public 18/18 | TCP/UDP impaired A/V fails; media disabled; physical/mobile, distinct networks, continuing impairment/handover and sustained representative load open |
| Provider confirmation preview | Frontend/backend `e88783a` (`main-CXsosxfb.js`) | `https://music.micstec.com/party` | 2026-10-02 | Backend 127/127, party 81/81, exact UI 38/38, PWA 8/8, continuous TCP handover 63/63, same-source UDP candidate 65/65, public 18/18 | Media disabled; sustained native drift/A/V, physical/mobile, longer outages, representative/multi-room load and distinct networks open; 59-audience setup failed |
| Capture cadence preview | Frontend `ea986cd` (`main-1zcZhmf9.js`), backend `e88783a` | `https://music.micstec.com/party` | 2026-10-02 | Party 84/84, fixture 9/9, exact UI 42/42, PWA 8/8, native clean 40-transition journey 26/26, public 18/18; P06.7 software acceptance complete | Media disabled; impaired A/V still fails; physical/mobile, longer outages, representative/multi-room load and distinct networks open |
| Lyric screen source preview | Frontend/backend `f58a8f3` (`main-CedlFAY-.js`); matching worker image `ktv-party-media:f58a8f3` | `https://music.micstec.com/party` | 2026-10-02 | Party 84/84, backend 128/128, exact UI 42/42, PWA 8/8, clean native 40-transition journey 26/26, supervisor 9/9, public direct/TLS-TURN 14/14, public release 18/18 | Media disabled, no persistent SFU; TCP/UDP impaired timing fails, intermittent PWA reload remains unresolved; physical/mobile, longer outages, representative/multi-room load and distinct networks open |
| PWA activation preview | Frontend `fe4f216` (`main-9fvbdGW2.js`), backend `f58a8f3` | `https://music.micstec.com/party` | 2026-10-02 | Exact UI 42/42, PWA 10/10, clean native 40-transition journey 26/26, public release 18/18; party 84/84, update 3/3, catalog 2/2, fixture 12/12 | Media disabled, no persistent SFU; UDP impaired timing fails; physical/mobile, installed PWA, handover timing, representative capacity and distinct networks open |
| Native lease guard preview | Frontend `ca6c757` (`main-CgZ1TyOk.js`, `partyLeaseGuard.worklet-5od8dAEf.js`), backend `f58a8f3` | `https://music.micstec.com/party` | 2026-10-02 | Party 90/90; exact UI 45/45, PWA 10/10, native lease 15/15, full clean 40-transition streaming/recovery/handover 53/53, public release 21/21; post-release integrated replacement 41/41 and fixture 14/14 | Media disabled, no persistent SFU; UDP timing and impaired source drift, physical replacement, mobile/field PWA, timing through handover, representative capacity and distinct networks remain open |
| Bounded audio drift preview | Frontend `7c1f583` (`main-BRuMNKuZ.js`), backend `f58a8f3` | `https://music.micstec.com/party` | 2026-10-02 | Party 94/94; exact UI 45/45, PWA 10/10, native lease 15/15, integrated replacement 41/41, native output-interruption/full recovery/handover 56/56 and public release 21/21; 40 clean A/V pairs p95 64.46 ms/max 86.51 ms | Media disabled, no persistent SFU; unexplained earlier large render stall, sustained/UDP stability, physical/mobile, measured handover, real networks and representative capacity open |
| Encoded publisher expiry preview | Frontend `d33b209` (`main-DU8DSm-f.js`), backend `f58a8f3` | `https://music.micstec.com/party` | 2026-10-02 | Party 105/105; exact UI 45/45, PWA 10/10, full native SFU/recovery/handover 56/56, public release 23/23; 40 clean A/V pairs p95 70.36 ms/max 97.70 ms; same guard source in `28bde60` passes independent Chrome 137/154 lease 15/15 each and native stage replacement 41/41 | Media disabled, no persistent SFU; UDP timing and sustained/physical audio, mobile/field PWA, handover timing, nominal/multi-room capacity and distinct networks remain open |
| Local beta | — | — | — | Pending M2/local P08 gate | Online/hybrid |
| Online/hybrid beta | — | — | — | Pending M3/online P08 gate | Optional P09 enhancements |

### 2026-10-03 — Require receiver-safe media clients

Media contract **2** is shared by the backend and frontend. Both audience and
publisher credentials require this version. Legacy status versions 0/1 remain
accepted for local room controls and local playback, but streaming requests return
`409 MEDIA_CLIENT_UPDATE` before creating a nonce or command receipt. A downgrade
invalidates renewal, gateway admission and output authority; an active online
stage recovers while retaining its previously issued receiver deadline. Signing
rechecks the version after asynchronous token creation. The local-only schema
continues to work without a media-mode column. New clients show a translated
update/reopen message; the unchanged older app displays its existing stopped state.

Verification against the production-config candidate:

- Backend **143/143**, party tests **124/124**, targeted media lifecycle **37/37**,
  type check and build pass. Logs are `/tmp/ktv-media-protocol2-backend-final-20261003.log`,
  `/tmp/ktv-media-protocol2-party-final-20261003.log`,
  `/tmp/ktv-media-protocol2-lifecycle-final-20261003.log` and
  `/tmp/ktv-media-protocol2-typecheck-final-20261003.log`.
- Actual native SFU room plus unchanged deployed version-1 browser: **69/69**
  (`/tmp/ktv-media-protocol2-production-room-legacy-final-20261003.log`). The old
  entry bundle reports version 1, receives no token/nonce, opens no peer/output and
  retains its room connection. This is browser compatibility evidence, not a
  physical installed-PWA upgrade test.
- Every A/V run now checks nominal quality, including production artifacts with
  no private codec marker. Default SDK VP8, transport and buffer policies remain
  unchanged. Baseline, next-singer and venue-to-remote phases each pass **40 pairs,
  zero unmatched audio/video edges**, with p95/max skew **89.09/105.67 ms**,
  **104.84/116.00 ms** and **79.28/107.16 ms** respectively. Source and receiver
  cadence remain approximately **25 fps**; resolution/encoding/capture/timing gates
  pass and runtime exceptions are zero. No impaired-network acceptance is claimed.
- Version-2 native early-stop authority rerun **31/31** passes with actual
  1000-ms received buffering, blocked and suspended/resumed listener clocks,
  reserved deadlines and independently captured replacement output
  (`/tmp/ktv-protocol2-receiver-early-stop-final-20261003.log`). The first rerun
  expired its five-second credential while launching the receiver. Setup now
  renews real authority every second, before either output graph is armed;
  credential deadlines and measurement gates remain unchanged. This still uses
  direct WebRTC, not a full SFU fault.
- Exact candidate UI **45/45**, PWA **10/10** pass
  (`/tmp/ktv-media-protocol2-ui-candidate-20261003.log`,
  `/tmp/ktv-media-protocol2-pwa-candidate-20261003.log`). Fixtures can serve a
  distinct immutable candidate without replacing the deployed `dist` directory.
- Frozen production build: `/tmp/ktv-party-candidate-protocol2-20261003`, entry
  `main-DSLM9Z0k.js`, CSS `main-DnE6rWx5.css`, index SHA256
  `7f5428020ca55c0c2636ee568fb1efd6665a1b80fea99e77c720707d8569a03b`.

This candidate is not deployed. Public frontend `d33b209`, backend `f58a8f3`,
media-disabled configuration and absence of a persistent SFU remain unchanged.
Deploy the frontend and backend together, including `server/ktv-media-protocol.js`.
Full SFU stalled/early-stop faults, impaired timing, sustained and physical/device
acceptance, capacity and public streaming release remain open.
