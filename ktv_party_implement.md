# KTV Party — Implementation Plan and Progress

Created: 2026-09-29

Last updated: 2026-10-05

Design reference: [ktv_party.md](ktv_party.md)

Implemented contracts: [ktv_party_protocol.md](ktv_party_protocol.md)

## Remaining release work

The core room, invitation/guest, moderation, queue, shared-screen, phone-control,
scheduled playback and private-guide software is implemented. The deployed app
is a preview; public online media is still disabled.

1. **Audio reliability:** release the receiver output guard and complete sustained/
   physical output acceptance and investigation of the earlier render-clock stall.
   The deployed raw receiver can remain audible until expiry +273.08 ms with a
   1000-ms target. The version-2 candidate passes 31 native direct-WebRTC checks,
   69 clean room/legacy checks and **78 integrated SFU fault checks** across early
   source stop, listener render freeze/resume and source page stall. Actual buffered
   residence exceeds 500 ms; reservations, expiry silence and replacement separation
   pass. Legacy clients retain local controls without receiving streaming tokens.
   A later Chrome encoded-gate fix reserves streams before publication instead of
   relying on a late standard transform. Its `acb583b` production candidate passes
   actual frame observation/clean A/V **35/35**, SFU source-stall **24/24**, and
   independent source-clock freeze/expiry **16/16**; it is now deployed with media disabled.
2. **Streaming timing:** resolve impaired-network A/V timing, measure handover
   timing and longer outages, and verify source-clock stability. Functional
   reconnect/handover passes do not establish acceptable audible/video alignment.
   Native capture extension/clock observation and decoded-frame access are now
   verified in private fixtures; timestamp negotiation alone still fails impaired
   timing. A bounded private receiver controller now passes clean timing/quality
   and functional handover; impaired acceptance, product integration and minimum
   practical latency remain open.
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

### Latest private receiver candidate

| Check | Current evidence | Status |
| --- | --- | --- |
| Timing/capability fixtures | 244/244 previous full suite; latest temporal/stream/worker change passes 43/43 focused checks | Pass |
| Buffered expiry after render/guard clock freeze/resume | 51/51 with shared-context libopus buffers at the 500-ms target, including 524.23-ms retained PCM | Pass for tested digital topology |
| Buffered expiry while source and listener pages stall | 46/46, latest reader/revalidation | Pass for digital fixture |
| Latest qualified clean 40-pair A/V regression | Explicit VP8 L1T1 / floor / supported RTP ordering / shared-context libopus / 500-ms target: 55/55, p95 54.78 ms / max 62.91 ms, no unmatched edges | Pass for tested digital topology |
| Continuous impaired-network A/V and nominal frame rate | Explicit VP8 L1T1 matches 40 impaired and 40 next-singer pairs with no missing edges and nominal cadence; maximum skew 427.44 / 250.63 ms fails | Fail |
| Product integration and physical/mobile/capacity acceptance | Required work remains | Open |

These scripts are private. The deployed preview remains `acb583b`, with public
online media disabled. The original video cadence and timing requirements are
unchanged; the optional adaptive-video preference question has no answer yet.

Recording/export, reactions, themes and remote duets remain optional P09 work.

Current status: The receiver-safe encoded activation preview is deployed at
`https://music.micstec.com/party` with frontend/backend **`acb583b`**
(`main-iUMKk7ov.js`, `main-DnE6rWx5.css`,
`partyLeaseGuard.worklet-BWdT3O5D.js`, `partyEncodedLease.worker-BxVsrNxp.js`).
The coupled update includes media protocol 2, durable issued-output reservations,
the receiver post-buffer deadline guard and Chrome stream reservation before
publication. Public online media remains disabled; no persistent SFU is running.
Exact UI **45/45**, PWA **10/10**, backend **143/143** and public release **23/23**
checks pass; party units **125/125** and timing/capability fixtures **166/166** pass.
The candidate passes native clean A/V/frame checks **35/35**, independent SFU
source-stall **24/24** and separate native stage/source freeze/expiry **16/16**.
Private capture-clock experiments pass clean **42/42** and decoded capability
**39/39** checks, but continuous impaired A/V still fails. Those experiments are
not enabled by the deployed build. Physical/sustained output acceptance is open.
Private rollback backup: `/home/mli/ktv-party-receiver-safe-predeploy.ehv22v0u`.

The PWA activation fix is deployed: failed updates retain the current page and
allow retry; empty catalogs no longer trigger phantom song downloads. Exact-build
UI/PWA checks also reject malformed room responses without losing the form.
Lyric capture cadence and authorized screen-content classification are deployed.
The previous `d33b209` preview passed 40 clean A/V transitions with p95 **70.36 ms**
and maximum **97.70 ms** after a **50.21-ms** output interruption. The corrected
`acb583b` default clean run has p95 **93.22 ms**, maximum **104.50 ms** and zero
unmatched transitions; this does not close impaired timing acceptance.
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

Public preview remains frontend/backend `acb583b`, with rooms/private guide
enabled and online media disabled. The receiver guard and encoded activation
fix are deployed; private decoder/controller experiments remain unpublished.
Current timing/capability fixtures pass 95 checks. Direct receiver-worker/PCM
render credits pass 41 built-app checks, including actual SFU audio and a blocked
page task. The native 48-kHz decoder/default-rate final-output layout passes ten
expiry checks with both contexts frozen and page callbacks blocked. Forced
48-kHz final-output variants still replay a brief stale burst in this setup.

The owned audible PCM/video prototype now passes clean 40-transition timing and
nominal quality at 800-ms and 200-ms holds, plus singer handover and cleanup.
Complete redundant-packet recovery, impaired timing, sustained native
output and impaired-network A/V timing. Preserve the 150-ms p95 / 250-ms maximum targets,
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
| Receiver-safe encoded activation preview | Frontend/backend `acb583b` (`main-iUMKk7ov.js`); media protocol 2 | `https://music.micstec.com/party` | 2026-10-03 | Backend 143/143, party 125/125, fixtures 54/54, exact UI 45/45, PWA 10/10, public release 23/23; native clean/frame 35/35, SFU source-stall 24/24, independent freeze/expiry 16/16; private capture clean 42/42 and decoded capability 39/39 | Media disabled, no persistent SFU; impaired A/V, controlled receiver playout, sustained/physical clocks, mobile/PWA, capacity, real networks and online release remain open |
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

### 2026-10-03 — Integrated SFU buffered-output fault acceptance

The production-config receiver-safe candidate now passes the actual built app,
HTTP room API, media gateway, worker and SFU fault journeys. Three owned Chrome
154.0.8037.92 processes isolate performer, receiver and host outputs. Private
PulseAudio monitors observe actual output while page callbacks are blocked.
Clock samples, source grants, worker removal, room recovery and replacement are
real; no synthesized timestamps or direct domain-service substitutes are used.

| Fault | Checks | Measured native buffered residence | Quiet / replacement samples |
| --- | --- | --- | --- |
| Early source stop, blocked listener page | 23/23 | 503.82 ms | 14 / 14 |
| Early stop, frozen/resumed listener render clock and blocked page | 25/25 | 519.71 ms | 14 / 14 |
| Source page stall across issued authority expiry, blocked listener | 22/22 | 515.14 ms | 10 / 11 |

All **70 checks** pass. The receiving audio track has a native 1000-ms target,
and interval jitter-buffer counters must demonstrate at least **500 ms** actual
mean residence before the fault starts. The media element remains muted, with
one graph context bound to its actual received track and no local backing source.
Previously closed peers and the idle playback context are excluded by native
connection state and track ID; they are not mistaken for the received output.

Early-stop source acknowledgments precede the listener cutoff. HTTP playback
retains that cutoff plus the default 500-ms output margin; a freshly prepared
replacement receives `409 OUTPUT_STOPPING` before the boundary. The SFU removes
the old publisher, and explicit **Resume with countdown** creates a fresh nonce,
generation and output lease. Independent monitors show the old output stays
quiet while replacement output remains audible throughout listener blockage.
Measured capture queue/call/window and old/new separation bounds remain enforced.
The source-stall run explicitly verifies silence within the unchanged **150-ms**
expiry margin: its quiet edge is **47.84 ms before** the deadline, with **45.32 ms**
combined clock/capture uncertainty. The earlier two trace edges also satisfy that
bound by more than three seconds.

The frozen context advances **0 seconds** while suspended, then renders for
approximately **20 seconds** after native resume while page callbacks remain
blocked. The fixture observes both context-operation promises. On page recovery,
the app terminally closes the expired context, which can cancel the pending
fixture resume promise with `InvalidStateError`; that cancellation is recorded
and accepted only for a resume request whose old context is closed. Native clock
advance and output silence remain mandatory. Runtime exception count is **zero**
in every final journey. The source-stall app automatically releases capture;
explicit re-enabling is required for replacement.

Evidence:

- `/tmp/ktv-protocol2-sfu-fault-task-stall-final-20261003.log`
- `/tmp/ktv-protocol2-sfu-fault-suspend-task-stall-final-20261003.log`
- `/tmp/ktv-protocol2-sfu-fault-source-expiry-final-20261003.log`
- The earlier three-case runner log is
  `/tmp/ktv-protocol2-sfu-fault-suite-20261003.log`; its 21-check source case is
  superseded by the 22-check explicit-expiry run above.

The fixture option `KTV_ROOM_TEST_RECEIVER_FAULT` accepts `task-stall`,
`suspend-task-stall` or `source-task-stall`, requires the production build and
owned remote topology, and runs separately from codec, A/V marker, impairment,
hybrid and legacy journeys. It uses the frozen artifact
`/tmp/ktv-party-candidate-protocol2-20261003`; all tested product code is unchanged
from the version-2 checkpoint. Initial fixture attempts counted idle contexts/
closed receivers, used new-turn buttons during recovery, or did not observe a
fixture resume promise. Those attempts are failed runs, not release evidence.

These are software/native SFU fault passes. Sustained and physical output,
impaired A/V, mobile/installed-PWA, capacity and real networks remain required.
Public features were rechecked: rooms/guide enabled, media disabled. Deployed
`dist` index SHA256 remains
`22029bb64d1efd421e73be97a3b681b238b8267424e5af9c7a42855202abf1d5`.
No public deployment or persistent media service was started.

### 2026-10-03 — Measure received replacement microphone output and UDP timing

The preceding 70-check fault checkpoint monitored the replacement performer's
local backing output. That output starts after the countdown; transmitted
microphone audio can arrive earlier. The strengthened fixture now uses the host's
independent SFU listener and private output monitor for the replacement mix.
The source sink remains isolated but its unused monitor is disabled. No product
code, default SFU policy, transport, codec, audio clock or expiry margin changes.

| Fault | Final checks | Actual received mean buffer | Old quiet / new received samples | New mic precedes backing by |
| --- | --- | --- | --- | --- |
| Early stop and blocked listener | 26/26 | 555.00 ms | 19 / 18 | 4547.07 ms |
| Early stop and frozen/resumed listener | 28/28 | 524.17 ms | 19 / 19 | 4563.59 ms |
| Source task stall across expiry | 24/24 | 508.29 ms | 16 / 16 | 4545.32 ms |

All **78 checks** pass. The replacement listener receives exactly the guarded
SFU audio/video mix and creates no local backing source. Its first audible edge
must precede the actual backing anchor, so the safety check covers transmitted
microphone output during the countdown. Native old/new edge separation remains
at least the configured 500-ms margin after capture uncertainty. Each case now
explicitly checks the unchanged 150-ms expiry limit. In the stalled-source case,
old output goes quiet **41.61 ms before expiry**, with **37.97 ms** combined
clock/capture uncertainty. All final runtime exception counts are zero. The
received-mix result supersedes the earlier replacement-backing measurement.

Final evidence:

- `/tmp/ktv-protocol2-sfu-received-replacement-task-stall-20261003.log`
- `/tmp/ktv-protocol2-sfu-received-mix-suspend-task-stall-final-20261003.log`
- `/tmp/ktv-protocol2-sfu-received-mix-source-task-stall-final-20261003.log`
- `/tmp/ktv-protocol2-sfu-received-mix-suite-20261003.log`

The same frozen production candidate was also measured with continuous **UDP**
impairment: 150-ms delay, 0–40-ms jitter and 5% loss per leg remain active through
recovery and subsequent singers. The run **fails**, exit 1,
`/tmp/ktv-protocol2-production-continuous-udp-20261003.log`:

| Phase | Matched pairs / unmatched audio / video | p95 / max skew | Measured source / receiver fps |
| --- | --- | --- | --- |
| Clean baseline before impairment | 6 / 0 / 0 | 125.47 / 125.47 ms | 25.02 / 25.10 |
| Impaired | 40 / 0 / 0 | 493.03 / 625.49 ms | 22.57 / 22.49 |
| Next singer under impairment | 40 / 0 / 0 | 683.17 / 732.60 ms | 25.00 / 24.95 |
| Venue-to-remote | Incomplete | No accepted timing result | No accepted quality result |

The first three phases retain nominal encoding/resolution/cadence and capture/
matching/video-delay bounds. The impaired phases fail the unchanged 150-ms p95 /
250-ms maximum skew target. Before failure, **65 functional checks** pass,
including real UDP loss, media-only outage/recovery, fresh audience/publisher
nonces, guide exclusion, singer replacement and venue routing. During the final
venue-to-remote measurement, the source audio engine enters drift recovery after
three out-of-bound samples; recorded phase error reaches **88.6 ms**. The fixture
correctly rejects `Publisher audio recovery interrupted A/V observation` and its
partial phase cannot establish nominal quality or timing. No drift threshold,
quality target, matching window, settle interval or expiry bound was relaxed.

Next: diagnose the varying received audio/video playout and sustained source
clock behavior under this load. Complete remaining physical/mobile, capacity,
real-network and release gates. Public frontend/backend and media-disabled
configuration remain unchanged; all owned native fixture ports are released.


### 2026-10-03 — Prove encoded frame processing before synchronization changes

Added a private, bounded encoded timing probe and frame-preservation checks.
It forwards each original frame without reading its payload, collects only
allowlisted timing/codec scalars, preserves the lease worker, and checks actual
send/receive audio and video callbacks. Worker boot/stream events are separate
from frame evidence. Repeated track events cannot install a second receiver
transform. SDK configuration updates preserve the immutable private receiver
encoded-stream opt-in.

The current Chrome 154 standard API path attaches workers but yields **zero frame
callbacks**, despite RTP continuing. Those diagnostic runs fail; exposed APIs and
worker startup are insufficient evidence of an active encoded gate. A controlled
legacy API experiment passes **30/30** built-app checks, with actual timestamp
samples: send audio/video **19/17**, receive audio/video **19/17**. Source audio
exposes capture timing; received audio/video expose RTP/arrival timing, with no
shared received capture clock. This is diagnostic evidence, not impaired A/V
acceptance. Log: `/tmp/ktv-protocol2-encoded-timing-legacy-config-20261003.log`.

The product adapter now prefers legacy streams when both APIs are exposed and
sets `encodedInsertableStreams` before publisher peer creation. A late standard
transform cannot silently replace a lost selected legacy API. Standard-only
browsers retain their path. The changed production build must verify actual frame
processing, clean A/V and independent expiry/recovery behavior before release.
Previous receiver output/fault passes still describe actual observed output;
they do not independently prove the modern encoded worker processed frames.

No public deployment or media enablement occurred. Impaired synchronization,
sustained clocks, physical/mobile, capacity, distinct networks and release gates
remain open.


The exact corrected production candidate is **`acb583b`**, built at
`/tmp/ktv-party-candidate-encoded-activation-20261003` with
`main-iUMKk7ov.js` / `main-DnE6rWx5.css`, index SHA256
`19c5921520411deb8728b7975dd8d7a6b362eb33cdb0a0fc46852aee52ecb9ed`.
Build/type-check passes, party tests **125/125**, timing/codec fixtures **41/41**,
and focused encoded adapter/observer tests **15/15** pass.

With normal Chrome 154 API availability (no API suppression), the candidate
passes **35/35** native built-app streaming checks. The observer sees actual send
and receive audio/video timestamps; no probe or browser runtime errors occur.
Clean A/V retains **40 matched transitions, zero unmatched**, p95 **93.22 ms** /
maximum **104.50 ms**. Measured source/receiver cadence is **24.97/24.97 fps** with
nominal 1280x720 VP8 quality. Log:
`/tmp/ktv-encoded-activation-clean-av-20261003.log`.

Without any timing probe or API override, the same artifact passes **24/24**
integrated SFU stalled-source checks. Actual received mean buffer is **508.86 ms**;
old output is quiet **47.73 ms before expiry**. The received replacement microphone
starts **4484.86 ms before the backing anchor**; **16 old-quiet / 15 new-audible**
heartbeats retain the expiry and configured separation bounds. Final runtime
exceptions are zero. Log:
`/tmp/ktv-encoded-activation-sfu-source-stall-20261003.log`.

Continuous UDP impairment/recovery/handover verification of this exact artifact
runs separately, without encoded timing probes or API suppression. It **fails**,
exit 1, with the same 150-ms delay / 0–40-ms jitter / 5% loss per leg retained
through recovery and singer replacement:

| Phase | Matched / unmatched audio / video | p95 / max skew | Source / receiver fps |
| --- | --- | --- | --- |
| Clean baseline | 6 / 0 / 0 | 103.02 / 103.02 ms | 24.96 / 25.04 |
| Impaired | 40 / 0 / 0 | 425.17 / 698.12 ms | 21.50 / 21.47 |
| Next singer | 40 / 3 / 2 | 393.90 / 565.00 ms | 24.97 / 23.84 |
| Venue-to-remote | Not reached | No accepted result | No accepted result |

The fixture rejects next-singer matching immediately because unmatched counts
exceed the unchanged allowance. Both impaired phase timing summaries also exceed
150-ms p95 / 250-ms maximum; nominal quality diagnostics do not make them passes.
There are **45 functional passes before failure**, with real UDP drops, media-only
outage and audience recovery, fresh grants, guide exclusion, publisher revocation
and singer replacement. Runtime exception count is zero; playback remains playing.
Maximum observed absolute source phase errors are **2.0/4.7/72.2 ms** for baseline,
impaired and next singer. Sustained clock acceptance remains open. Loss traces
vary across runs, so comparisons with previous failures do not prove a timing
improvement. Log: `/tmp/ktv-encoded-activation-continuous-udp-20261003.log`.

Public features were rechecked: rooms/guide enabled, media disabled. The deployed
`dist/index.html` hash is unchanged. The corrected encoded gate is a source safety
fix; impaired synchronization still requires implementation and acceptance.


The corrected source adapter also passes **16/16** independent native lease checks
on Chrome 154: stage and publisher task stalls, real source render-clock
freeze/resume, and actual output observed after the deadline. Publisher output
is measured at a separate native WebRTC receiver; no receiver guard or SFU is
used in this run. Every expired/resumed output remains silent and runtime
exceptions are zero. Log: `/tmp/ktv-encoded-activation-native-freeze-20261003.log`.
This closes the immediate source-freeze regression check for the API selection
change; sustained and physical output acceptance remain open. All owned native
fixture listener ports were verified closed locally and remotely after cleanup.

Next work: investigate received media clock mapping and playout under loss, with
actual output/video timing as the gate. Release the coupled media-disabled
preview after its applicable UI/PWA/public checks, then complete the remaining
physical/mobile, capacity, network and streaming release gates.

### 2026-10-03 — Actual capture clocks and decoded receiver capabilities

Added a private native Absolute Capture Time negotiation experiment, bounded
capture observation, RTP-to-capture clock analysis and cloned decoded-track
capability probing. Native extension requests retain other capabilities and
offer/answer identity; unsupported APIs do not fabricate SDP. The observer
forwards every original encoded frame without reading payloads. Its first-eight
capture sample window is bounded at 56 messages per kind, with 256 retained
records and 64 worker states. The clock analysis handles RTP rollover, duplicate/
late packets, missing/stale anchors and permanent discontinuity explicitly.
Timing/codec/capability fixture units pass **54/54**:
`/tmp/ktv-absolute-capture-all-fixtures-20261003.log`.

The unchanged `acb583b` artifact with private native capture requests passes
**42/42** clean built-app A/V checks. Audio/video received capture sample counts
are **47/29**; 40 matched transitions have zero unmatched, p95 **104.23 ms** /
maximum **116.84 ms**, source/receiver **25.00/25.00 fps**, nominal 1280x720 VP8
and zero runtime errors. Capture requests succeed without browser feature flags,
API suppression, codec changes or SFU patches. Log:
`/tmp/ktv-absolute-capture-native-clean-av-20261003.log`.

The initial shorter capture probe failed its eight-sample requirement because
headers arrived after the old observer's initial sample window. It is not a
passing result. After a bounded sparse-header sampling correction, actual
capture fields are required before timing observation; timing settling, matching
and quality requirements are unchanged.

The same private experiment under continuous 150-ms delay / 0–40-ms jitter /
5% loss per leg **fails**, exit 1. Loss remains through media outage, audience
recovery, next singer and venue-to-remote handover:

| Phase | Matched / unmatched audio / video | p95 / maximum skew | Source / receiver fps |
| --- | --- | --- | --- |
| Clean baseline | 6 / 0 / 0 | 110.84 / 110.84 ms | 24.97 / 25.06 |
| Impaired | 40 / 1 / 1 | 450.91 / 631.18 ms | 21.44 / 21.34 |
| Next singer | 40 / 1 / 1 | 661.48 / 718.19 ms | 25.00 / 25.01 |
| Venue-to-remote | Incomplete; 40 matched pairs time out | No accepted timing result | 24.98 / 22.55 |

There are **66 functional passes**, zero browser runtime exceptions, playing
room state and nominal quality diagnostics without errors. These are functional
and capability evidence, not impaired timing acceptance. Retained actual capture
anchors have maximum RTP projection residuals up to **58.1 ms** for audio and
**0 ms** for video; this does not establish acoustic or presented alignment.
SFU capture-time normalization and per-worker clock origins must be respected.
Log: `/tmp/ktv-absolute-capture-continuous-udp-20261003.log`.

The separate decoded capability journey passes **39/39**, with no A/V observer
running concurrently. Eight actual native `VideoFrame` objects expose advancing
timestamps, RTP timestamps and nominal 1280x720 dimensions. Eight decoded audio
objects contain 480 frames each at 48 kHz, two channels and 10-ms duration. Their
timestamps do not share the decoded video's clock; no common origin is assumed.
Every frame/reader/clone is released; original performance tracks and guarded
output remain unchanged. Log:
`/tmp/ktv-decoded-capture-capability-20261003.log`.

No controlled receiver renderer has shipped. Chromium source inspection rules
out assuming its MediaStream player can safely feed a Web Audio element source;
this is source evidence, not a cross-browser runtime acceptance result.
P07 remains in progress. Implement explicit capture-to-output mapping and bounded
receiver playout while preserving deadline guards, then repeat the unchanged
impaired timing, quality, recovery and source-clock gates. Physical/mobile,
capacity, real networks and persistent SFU/TURN release remain required.

### 2026-10-03 — Coupled receiver-safe preview rollout

Deployed the exact `acb583b` frontend and matching backend to
`https://music.micstec.com/party`. Backend tracked sources match the tested commit;
`server/ktv-media-protocol.js` is present and included in the private candidate
archive. PM2 was restarted with its existing command/cwd, watch remains off,
and backend health plus rooms/guide enabled and media disabled were checked
before static publication. Hashed assets were published first, then index and
service worker atomically; previous hashed assets are retained for open clients.

Required exact UI **45/45**, PWA **10/10** and backend **143/143** checks passed
before rollout. Public release checks pass **23/23**: trusted public route and
asset bytes/MIME/SHA marker, service worker/native guard precaching, feature
switches, health, real authorized WSS, timing/pairing/ticket defaults, safety
record, database integrity/FKs and cleanup. The temporary room is closed and no
account was added. Logs:
`/tmp/ktv-activation-exact-ui-final-20261003.log`,
`/tmp/ktv-activation-exact-pwa-final-20261003.log`,
`/tmp/ktv-coupled-preview-backend-20261003.log`,
`/tmp/ktv-receiver-safe-preview-public-20261003.log`.

Private backup **`/home/mli/ktv-party-receiver-safe-predeploy.ehv22v0u`** (0700;
files 0600) includes a consistent verified SQLite online backup, previous static
archive, previous `f58a8f3` and candidate `acb583b` server archives, runtime
configuration and nginx configuration. No active performance existed before
backup/restart/publication. Preserve current additive schema/data during software
rollback; the original main baseline tag remains `ktv-party-baseline-2026-09-29`.

The first local UI launcher failed before application checks because it supplied
the CDP origin instead of `/json/version`; corrected launcher UI/PWA runs exited
0. This was fixture startup configuration, not a passing application result.
The public update does not enable the private capture negotiation/probes. It
ships output safety and protocol compatibility work; full P07/P08 release is open.

### 2026-10-03 — Implement bounded native receiver playout prototype

Added a private capture-time frame queue and controlled receiver in the owned
built-app browser fixture. Audio delay is before the existing app output guard;
the original receiver permit/nonce/deadline contract is retained. Native RTP/
capture source observations drive the audio cursor and decoded frame scheduling.
The queue rejects missing/backwards clocks, unexpected resolution and frame/byte
overflow at the unchanged 40-frame / 64-MiB bounds. All discarded/consumed frames
are closed. Diagnostic spectrum sources cannot claim the guarded audible path.
Controller identity and bounded histories are kept separately for every new
received stream; stale players or a second audible source fail the fixture.

Initial canvas-output prototype: clean 40-pair timing p95 **54.35 ms**, maximum
**75.22 ms**, no unmatched edges, actual displayed **24.30 fps**, video delay
maximum **1031.60 ms**. That journey **fails** its raw-player handover assertion;
it is not a completed clean run. The assertion was updated to require one visible
performance, one hidden original stream only in the private controller mode,
one current guarded source, no unmuted raw stream and no stale players. Default
builds still require exactly one native player.
Log: `/tmp/ktv-controlled-receiver-clean-av-20261003.log`.

The canvas variant's continuous UDP run **fails**, exit 1, after **32 functional
checks**, at fresh audience recovery. Impaired 40-pair matching has no unmatched
edges, p95 **204.10 ms**, maximum **273.45 ms**, video delay maximum **1848.60 ms**.
Actual controlled presentation averages **16.62 fps**, below the required 20–30;
the original decoder's 20.18 fps does not substitute for that failed output gate.
A new stream waits for its audio clock and reaches the 40-frame queue bound.
There are no browser runtime exceptions. Both timing and output quality remain
failures. Log: `/tmp/ktv-controlled-receiver-continuous-udp-20261003.log`.

Revised the controller to produce a native generated video track from the queued
decoded frames, retaining original pixels without canvas recapture. Startup drops
unpresentable queued frames until an audio clock exists, within the same bounds.
A cloned audio processor is drained without reading PCM or adding audio output.
Delay ownership is deferred until the app source connects to its receive gain;
analysers keep their original path. Failure remains latched during cleanup so a
subsequent aborted playback promise cannot replace the original cause.

Revised native clean run passes **47/47**, exit 0: **40 matched transitions, zero
unmatched**, p95 **43.55 ms**, maximum **50.06 ms**, maximum video observation
delay **965.30 ms**, actual generated-player presentation **24.95 fps**. Native
RTP codec/dimension/cadence, guide exclusion, publication/revocation, fresh singer
handover, deadline binding, queue bounds and runtime checks pass. Maximum held
native queue is **24 frames / 33,177,600 bytes**; all controllers close without
error and the original performance source is released. A fresh singer waits for
its own capture clock and presents the replacement player without stale output.
Log: `/tmp/ktv-controlled-generator-clean-av-20261003.log`.

This is a private prototype applied to the unchanged `acb583b` artifact. It is
not deployed or selected by the product transport. The experimental 800-ms delay
is not the final minimum-latency policy. Full continuous UDP timing/cadence,
recovery and hybrid-handover evidence is being gathered; guarded expiry, sustained
clock checks, adaptive delay, product integration and physical/mobile/capacity/
network/release gates remain open. Do not treat the failed canvas results or clean
generated-track success as completion of P07.

The generated-track 800-ms continuous UDP run is terminal **exit 1**, after
**78 functional checks**. It completes actual outage, automatic audience
recovery, singer replacement and both hybrid routes with fresh nonces, one visible
performance and no stale source. All four timing phases finish their matching
requirements under the continuously held loss profile:

| Phase | Matched / unmatched audio / video | p95 / maximum skew | Controlled presentation fps |
| --- | --- | --- | --- |
| Clean baseline | 6 / 0 / 0 | 20.67 / 20.67 ms | 24.88 |
| Impaired | 40 / 0 / 0 | 131.46 / 412.52 ms | 17.40 |
| Next singer | 40 / 1 / 0 | 34.19 / 251.07 ms | 21.50 |
| Venue-to-remote | 40 / 1 / 0 | 50.21 / 187.74 ms | 20.68 |

The unchanged maximum-skew gate fails for impaired and next-singer phases;
impaired controlled cadence also fails. Native source/decoder cadence is
**19.43/19.10 fps**, below the original nominal target. Source target bitrate
ranges **30,000–172,775 bit/s** after the sudden profile transition, while the
later singers maintain nominal source cadence. This is observed estimator/rate
behavior, not proof of its cause. Receiver native decoder versus processor deltas
also show dropped frames before the private queue: impaired **1485 decoded vs
1369 received by the processor**, plus only **16** deliberate queue discards.
The downstream queue alone does not explain the output cadence deficit. All
controllers close without clock/renderer errors, source clocks remain bounded,
runtime exceptions are zero and buffering bounds remain intact.
Log: `/tmp/ktv-controlled-generator-continuous-udp-20261003.log`.

The next private revision raises the native video processor depth from one to
four frames. It reduces the downstream queue to **34 frames / 42 MiB** and
reserves the rest of the original **40 frames / 64 MiB** for the native processor,
current read and pending generated-frame write. Unsupported oversized native
frame allocations are rejected. This preserves the resource ceilings while
addressing burst delivery drops. Full timing/capability fixture units pass
**64/64**: `/tmp/ktv-controlled-generator-fixtures-20261003.log`.
The one-second hold is tested with the original timing, matching, quality,
source-clock, maximum-video-delay and recovery requirements. Random loss traces
vary between runs; earlier failures remain recorded and the parameter experiment
does not establish a final adaptive/minimum-latency policy.

The four-frame processor / 1000-ms hold run is terminal **exit 1**, after
**78 functional checks**. Its actual timing summaries meet the unchanged
150-ms p95 / 250-ms maximum across all phases, each impaired/handover phase has
40 matched transitions and no unmatched edges, and maximum video observation
delay stays below two seconds. Cadence remains a failed required gate:

| Phase | Matched / unmatched audio / video | p95 / maximum skew | Source / decoder / presented fps |
| --- | --- | --- | --- |
| Clean baseline | 6 / 0 / 0 | 17.00 / 17.00 ms | 25.09 / 24.99 / 24.91 |
| Impaired | 40 / 0 / 0 | 75.84 / 129.35 ms | 18.88 / 18.70 / 18.36 |
| Next singer | 40 / 0 / 0 | 27.03 / 51.77 ms | 25.00 / 24.95 / 23.84 |
| Venue-to-remote | 40 / 0 / 0 | 71.55 / 98.73 ms | 24.98 / 24.87 / 23.86 |

Maximum impaired video observation delay is **1931.70 ms**; this leaves limited
headroom under the original 2000-ms limit. Peak held downstream queue is
**30 frames / 41,472,000 bytes**, within its reduced bounds. All seven controller
sessions across host/audience routes close without errors, source clocks remain
bounded and browser runtime exceptions are zero. Actual impaired receiver
decoded/processor/presented deltas are **1464/1458/1438**, with **14** deliberate
queue discards. Source cadence is below 20 fps, so matching and timing success
cannot establish nominal performance or release acceptance. The new native
video-source capture counters will distinguish capture from encoding in the next
investigation; no publishing policy or codec has changed.
Log: `/tmp/ktv-controlled-generator-buffer4-1000-continuous-udp-20261003.log`.

Maximum observed absolute source phase errors are **3.2/9.7/32.1/50.7 ms** for
baseline/impaired/next-singer/venue-to-remote; this is bounded synthetic run
evidence and does not close sustained or physical clock acceptance. The final
fixture suite, including separate native source-capture counters and privacy
checks, passes **65/65**:
`/tmp/ktv-controlled-generator-final-fixtures-20261003.log`.

P07 is still in progress: fix nominal source cadence during abrupt network
changes, establish minimum practical/adaptive latency, integrate the controller
into the product transport, and verify delayed receiver expiry, sustained source/
output clocks and longer recovery. Physical/mobile, capacity, distinct networks
and persistent online release gates remain part of the original objective.
Public preview remains `acb583b`, media disabled; these controller experiments
are private and no further public deployment occurred.

### Native capture isolation and buffered expiry work — 2026-10-03

The follow-up actual input-counter run is terminal exit 1. Baseline capture and
encoding are **25.00/25.00 fps**; impaired native capture remains **25.01 fps at
1280×720**, but encoding/decoding/presentation falls to **13.78/13.71/13.45 fps**.
Capture produces **1987** frames during the measured impaired interval while the
encoder produces **1095**. Capture scheduling is not the observed cadence loss.
The impaired 40-pair result has one unmatched edge of each kind, skew **208.91-ms
p95 / 309.62-ms maximum**, and **2114.40-ms maximum video delay**. Timing, video
latency and quality fail. Do not generalize the earlier passing timing summaries
to another loss trace. Log:
`/tmp/ktv-controlled-source-capture-counters-20261003.log`.

Added a bounded native `text` / `L1T2` sender experiment, preserving caller/native
objects, audio/receive paths, 350-kbit/s/25-fps caps and 720p dimensions. Native
sender parameters verify both settings throughout collected phases. Actual
impaired capture/encoding/decoding/presentation is **25.01/11.01/10.92/10.61 fps**.
It obtains 40 impaired pairs without unmatched edges, skew **120.43-ms p95 /
334.78-ms maximum**, and **1981.70-ms maximum video delay**. Source clock recovery
interrupts the next-singer observation; the run is terminal exit 1. The setting
does not resolve cadence and is not applied to the product. Log:
`/tmp/ktv-controlled-text-l1t2-continuous-udp-20261003.log`.

Added a compact native capture-versus-encoding analyzer. It rejects missing or
ambiguous input paths, resets, source replacement and invalid observation clocks,
keeps capture dimensions explicit, and returns no raw track identifiers. The
timing/capability suite passes **68/68**:
`/tmp/ktv-controlled-capture-expiry-fixtures-20261003.log`.

The controlled receiver can now enter the independent native expiry fixtures
without installing A/V markers or encoded timing observers. Its snapshot includes
the actual native DelayNode value. The fixture verifies that value, decoded
1280×720 output, native buffered audio residence and fresh audible output before
stalling the listener. It preserves all original permit, silence, separation and
capture-uncertainty requirements.

The first controlled 1000-ms / audio-only native deep-buffer run is terminal
exit 1 after 21 functional checks. Actual audio residence reaches **511.89 ms**,
but the video queue reaches its byte bound and the controller closes before the
stall begins. The old output is already silent during the measured fault interval;
this cannot establish expiry silence. Queue limits are not raised. Log:
`/tmp/ktv-controlled-buffer-expiry-task-stall-20261003.log`.

Controlled deep-buffer variants now request the same native 1000-ms target for
video so the additional one-second decoded hold can remain within its queue.
The original production fault fixture keeps its audio-only request. The first
symmetric run is terminal exit 1 before the stall: publisher clock recovery
removes the stream during native-buffer observation. Controller closure is
error-free with peak **28 frames / 38,707,200 bytes**; this is not fault acceptance.
Log: `/tmp/ktv-controlled-buffer-expiry-symmetric-task-stall-20261003.log`.
The corrected fixture handles a removed stream explicitly and requires a fresh
post-buffer audible heartbeat, preventing pre-fault silence from counting as a
successful expiry test.

The next 1000-ms symmetric run still closes at the bounded video queue before
the actual stall. It is terminal exit 1; the old output is already silent and no
new silence edge occurs during the stalled interval. Log:
`/tmp/ktv-controlled-buffer-expiry-symmetric-fresh-task-stall-20261003.log`.
An additional pre-stall check now requires an active, error-free controller,
current audible state and a recent independent audible heartbeat. A failed
controller cannot enter the fault measurement as a successful silent output.

With the unchanged queue ceilings and a **200-ms** additional controller delay,
native deep-buffer task-stall acceptance passes **36/36**, and actual audio-clock
freeze/resume acceptance passes **38/38**. Both request native 1000-ms audio/video
targets and independently measure **508.33/506.11-ms** mean audio residence before
the stall. Fresh output is audible immediately before each stall; old output
stays silent through replacement, and replacement remains audible while page
callbacks are blocked. The frozen context genuinely resumes rendering for
**20.004 seconds** without expired buffered audio leaking. Original 150-ms expiry,
output-separation and independent capture-uncertainty checks pass, all controllers
close without errors and browser exceptions are zero. These results establish
the tested 200-ms buffered path, not the unsupported 1000-ms deep-buffer variant,
mobile behavior, impaired A/V quality or product integration. Logs:

- `/tmp/ktv-controlled-200-buffer-expiry-task-stall-20261003.log`
- `/tmp/ktv-controlled-200-buffer-expiry-suspend-task-stall-20261003.log`

Review of earlier codec counters gives a concrete reason for the next comparison:
the H.264 raw-output impaired run retained **25.00/24.66 fps** source/decoder at
1280×720, although its A/V timing and later hybrid readiness failed. VP9 retained
21.78-fps source but failed 16.90-fps decoding. Neither is a release result.
The next experiment combines H.264's observed source cadence with the bounded
capture controller and corrected encoded-stream reservation. Its private build
marker disables backup codecs; production remains default VP8 with backup enabled.
Native frame observers now permit such explicitly marked comparisons and still
require their declared codec, dimensions, caps, counters and timing gates.

The 200-ms source-page-stall run is terminal exit 1 after its output-safety
assertions pass: actual native residence is **552.16 ms**, the built source cannot
renew or stop before the delivered cutoff, old output stays silent through
replacement, and separation/expiry/capture bounds pass. Final controller checks
reject a replacement listener's **89-ms audio capture-clock residual**, above the
unchanged **80-ms** limit. That controller closes safely; the original listener
closes without error. This is not a complete source-stall pass. Log:
`/tmp/ktv-controlled-200-buffer-expiry-source-task-stall-20261003.log`.

The H.264 comparison build is isolated at
`/tmp/ktv-codec-candidate-controlled-h264-20261003`; the builder verifies that
product sources and every production dist file remain unchanged. Both production
and frozen `acb583b` index hashes remain
`19c5921520411deb8728b7975dd8d7a6b362eb33cdb0a0fc46852aee52ecb9ed`.
Build log: `/tmp/ktv-controlled-h264-private-build-20261003.log`.

The combined H.264/controller run is terminal **exit 1** during impaired
acceptance. Baseline capture/encoding/decoding/presentation is
**25.00/25.00/25.08/24.87 fps**, with six matched pairs, no unmatched edges and
**16.69-ms p95 / maximum**. Under continuous UDP impairment, native capture stays
**25.00 fps**, while encoding/decoding/presentation drops to
**17.22/17.29/16.30 fps**. Forty pairs are matched with one unmatched edge of each
kind, skew **86.08-ms p95 / 520.67-ms maximum**, and maximum video delay
**2081.50 ms**. Quality, maximum skew and maximum video-delay gates fail; handover
timing is not reached. The earlier H.264 source-cadence observation does not
generalize across these loss traces. No codec is selected by this evidence.
Log: `/tmp/ktv-controlled-h264-continuous-udp-20261003.log`.

Current remaining P07 work includes publisher congestion/rate behavior, reliable
capture-clock handling, the one-second/deep-buffer queue interaction, adaptive
minimum latency and product integration. The private 200-ms task-stall and
freeze/resume results remain valid for their measured setup. Sustained clocks,
physical/mobile/capacity/distinct networks and persistent release remain open.
Public preview is still `acb583b`, with media disabled.

The private comparison builder now accepts a declared **64–350-kbit/s** video
ceiling. A smaller ceiling does not change 720p, requested 25 fps, actual required
20–30 fps, codec matching, timing, expiry or queue bounds. The quality analyzer
requires the actual sender cap to match the artifact declaration and rejects
anything above the original 350-kbit/s ceiling. Undeclared cap changes and slow
encoded/decoded cadence still fail. The fixture suite passes **69/69**:
`/tmp/ktv-controlled-bitrate-cap-fixtures-20261003.log`.

The H.264 **175-kbit/s** / 1000-ms controller run is terminal exit 1 in the
impaired phase. Capture remains **24.99 fps**, but source/decoder/presented rates
fall to **14.03/14.12/13.72 fps**. Forty transitions match with no unmatched edges;
skew is **161.78-ms p95 / 511.48-ms maximum**, and maximum video delay is
**2031.50 ms**. Cadence, timing and video-delay gates fail. A smaller cap does not
establish reliable source or output behavior in this run; no cap or codec change
is applied to production. Logs:

- `/tmp/ktv-controlled-h264-175k-private-build-20261003.log`
- `/tmp/ktv-controlled-h264-175k-continuous-udp-20261003.log`

Further cap/codec variations are deferred pending a different causal finding.
Primary source review identifies an explicit pre-jitter-buffer audio access point:
the receiver encoded-frame transformer returns payloads to
`ChannelReceive::OnReceivedPayloadData`, which then inserts them into NetEq.
Native delivery-source observations alone therefore do not provide an owned PCM
playout schedule. The next capability investigation should verify actual received
Opus/RED payload identification, bounded WebCodecs decoding and preservation of
capture timestamps, without producing audio or changing the existing output path.
Any later PCM scheduling must retain the deadline worklet after all buffering
and pass the same quality, timing and expiry requirements.
[Native receive/NetEq ordering](https://webrtc.googlesource.com/src/+/refs/heads/main/audio/channel_receive.cc),
[Opus WebCodecs packet registration](https://www.w3.org/TR/webcodecs-opus-codec-registration/).

### Native Opus capture association — 2026-10-03

Added an eight-packet receiver capability probe. It reads payloads only in the
explicit private Opus experiment, identifies negotiated payload types, extracts
primary Opus from bounded RFC 2198 RED packets, and decodes with native WebCodecs.
It does not read PCM samples, create an output path, alter forwarded RTC frames,
or change permits. Pending packets are limited to eight / 512 KiB; every decoded
frame closes immediately. Decoder resources close on completion, error,
unsupported configuration or timeout. Ordinary timing observation never reads
payloads.

The first native run decodes a valid 20-ms / 960-sample / 48-kHz stereo frame but
fails an assumed exact decoder/header timestamp match on the next frame. A
diagnostic rerun shows native decoded PCM advancing **20 ms** while the encoded
capture header advances **22 ms**. Both runs are terminal exit 1 and identify a
clock distinction. Logs:

- `/tmp/ktv-opus-decode-native-capability-20261003.log`
- `/tmp/ktv-opus-decode-native-timestamp-diagnostic-20261003.log`

The corrected probe keeps encoded capture/RTP metadata separate from native PCM
timestamps. It associates ordered decoder output with packet metadata and
requires decoded sample counts/durations to match each packet's RFC 6716 TOC.
PCM timestamps never substitute for capture headers. This revises the capability
hypothesis; existing A/V, quality, source-clock and expiry gates are unchanged.
Reordering, recovery and packet-loss concealment are not established by this probe.

Fixture checks pass **75/75**, covering RED bounds, Opus durations, distinct
capture/PCM clocks, original frame/payload preservation, fixed diagnostics,
unsupported configurations and cleanup:
`/tmp/ktv-opus-clock-association-fixtures-20261003.log`.

The native association run passes **39/39** built-app checks, including guide
exclusion, real SFU publication/readiness, revocation, fresh publisher handover and
zero browser exceptions. Eight actual RED-wrapped packets each decode to
**960 stereo samples / 20 ms at 48 kHz**, with a largest encoded packet of
**327 bytes**. RTP advances by 960 samples per packet; PCM follows its continuous
sample clock, with a largest **5-ms** difference from capture-header time.
Capture/RTP metadata remain attached to their decoded sample counts:
`/tmp/ktv-opus-capture-association-native-20261003.log`.

Next: verify a common capture-clock epoch, build a bounded owned PCM schedule
paired with decoded video, and retain the existing deadline worklet after all
buffering. Output alignment, native source cadence under loss, adaptive delay,
deep-buffer expiry, sustained clocks, physical/mobile/capacity and release remain
open. No product source or public deployment changed.
[RED payload structure](https://www.rfc-editor.org/rfc/rfc2198.html),
[Opus packet TOC/sample durations](https://www.rfc-editor.org/rfc/rfc6716.html).

### Independent audio/video capture epoch — 2026-10-03

Timing workers now include their numeric realm time origin, allowing each
worker's capture timestamp to be converted independently. A new probe projects
encoded capture/RTP observations to actual native delivery sources using the
existing 48-kHz/90-kHz clock mapper. It accepts only explicitly verified Unix or
NTP epochs, rejects arbitrary offsets, stale sources, worker ambiguity, invalid
clocks and implausible capture ages, and emits no source identifiers.

Fixture checks pass **77/77**:
`/tmp/ktv-capture-epoch-fixtures-20261003.log`.
The native probe passes **40/40** built-app/SFU/decoder/authority checks:
`/tmp/ktv-opus-common-capture-epoch-native-20261003.log`.
Actual audio/video sources both use the NTP epoch. Audio has nine advancing
anchors, **9-ms maximum anchor residual** and **33.90-ms** encoded-to-native
delivery residual; video has eight anchors and **0-ms** residuals. Native source
age is fresh, with projected capture ages **98.90/97 ms**. Eight RED-wrapped Opus
packets again decode successfully, with a maximum **6-ms** native PCM/header
timestamp difference. The unchanged 80-ms clock bound is preserved.

This verifies clock-domain conversion for the tested foreground Chrome setup,
not exact audible alignment, sustained drift or other browsers. The next private
prototype should schedule decoded PCM and video against that common clock,
apply backpressure across worker/renderer queues, and keep the current lease
guard after the final PCM buffer. Codec/source cadence, recovery, adaptive minimum
latency and all physical/mobile/release acceptance remain open.

### Bounded streaming PCM and native output expiry — 2026-10-03

Added private `CapturePcmQueue` and `createOpusPcmStream` primitives. The decoder
associates native PCM with packet sample counts, maintains an RTP sample timeline
across capture-header jitter and timestamp wrap, and retains capture metadata
separately. It limits outstanding PCM reservations to **48 chunks / 1 MiB** and
encoded payloads to **512 KiB**. Renderer consumption releases explicit credits;
invalid credits, malformed PCM, clock discontinuities and overflow close the
stream. Missing packets currently produce silence; RED recovery, reordering and
Opus concealment are not implemented or accepted.

The AudioWorklet renders exact 48-kHz sample positions without a custom music
resampler, duplicates mono into stereo, returns silence for gaps and releases
all owned chunks on stop. The browser handles hardware-rate conversion. The
existing production lease worklet remains downstream and supplies all output
authority. These primitives are not connected to the product receive graph.

All timing/capability fixtures pass **85/85**, including eight new PCM/decoder
checks for waveform continuity, sample deadlines, RTP wrap, gaps, decoder/render
stalls, memory ceilings, malformed output, duplicate payload exclusion and
cleanup: `/tmp/ktv-opus-pcm-fixtures-20261003.log`.

An isolated Chrome **154.0.8037.92** fixture natively encodes and decodes 45 stereo
Opus packets, transfers **900 ms** of PCM into the actual worklet, and observes
the isolated output through independent PulseAudio capture. The strict page-task
stall run passes **9/9**, detects silence **72.02 ms** after expiry, observes two
post-expiry heartbeats with zero RMS, and verifies all 45 credits are released:
`/tmp/ktv-opus-pcm-render-native-buffered-expiry-strict-20261003.log`.
This is synthetic native decoder/render evidence, not actual SFU playout or
physical acoustic alignment.

Suspension/resume **fails**. The strict run confirms the render clock actually
freezes, resumes after expiry and the guard latches silence, but the independent
detector observes an approximately **20-ms** audible burst at expiry +2535 ms:
`/tmp/ktv-opus-pcm-render-native-frozen-expiry-strict-20261003.log` (exit 1).
The burst's location within native buffers is not established. A first version
of the fixture checked only periodic heartbeat amplitudes and incorrectly
reported a pass; it now rejects every post-expiry audible edge, including bursts
between heartbeats. That earlier suspension result is superseded and is not
acceptance evidence. Initial unwarmed startup and too-short heartbeat observation
runs also failed and remain recorded in `/tmp/ktv-pcm-render-native-20261003.log`,
`/tmp/ktv-pcm-render-native-warmed-20261003.log` and
`/tmp/ktv-pcm-render-native-expiry-diagnostic-20261003.log`.

Next: locate and eliminate post-resume stale output without loosening expiry,
integrate direct worker/renderer credits and actual received Opus with controlled
video, then re-run output timing, loss, handover and resource gates. Source FPS
under loss, minimum practical latency, sustained clocks, physical/mobile/capacity
and public-media release remain open. No product source or deployment changed.

#### Output-context isolation experiment

Keeping the final guard alive and clearing every quantum after failure does
**not** remove the burst. That private lifetime hypothesis fails with another
approximately 20-ms post-resume audible edge:
`/tmp/ktv-opus-pcm-render-native-persistent-guard-expiry-20261003.log` (exit 1).
The production worklet is unchanged.

A separate-context layout passes **10/10** native checks: a 48-kHz PCM render
context feeds a captured MediaStream into an independently running output
context, with the original production lease guard after that receive boundary.
Only the PCM context is suspended in this experiment. It actually freezes and
resumes after expiry; the final output context keeps rendering, emits no late
audible edges, and four post-expiry heartbeat samples have zero RMS. All decoder
packets and 45 PCM credits release:
`/tmp/ktv-opus-pcm-render-native-separated-context-expiry-20261003.log`.

This isolates the tested PCM-context freeze from the final output guard; it does
not establish safety when the final output context or all browser audio contexts
freeze. The earlier same-context suspension failure remains a release gate.
The fixture explicitly labels graph/lifetime variants; neither changes product
sources or public deployment. Actual SFU integration, continuous worker credits,
end-to-end latency and aggregate native-buffer bounds still need verification.

### Direct receiver PCM credits and output-rate boundary — 2026-10-03

Implemented a direct MessageChannel from the encoded receiver worker to the PCM
AudioWorklet. PCM planes transfer to the renderer; consumption credits return
without page callbacks. The adapter validates render/capture mapping, bounded
delay, deadline extension and wall/monotonic continuity. Invalid controls,
expired or reversed clocks, decoder failure and stop close both endpoints.
The final application receive graph retains output authority. Ordinary timing
observation still leaves encoded payloads unread and forwards the original
frames unchanged; copied PCM observes every receiver frame beyond the sparse
timing-record ceiling. Diagnostic records contain bounded scalar counters.

`KTV_ROOM_TEST_PCM_PORT=1` explicitly enables an inaudible native received-audio
probe. It copies actual SFU Opus into the owned worklet behind zero gain, leaving
the app's guarded audible graph in place. The full journey passes **41/41**:
`/tmp/ktv-received-pcm-port-native-20261003.log`. The decoder advances from
**22 to 87 packets** across a **1.2-second** blocked page task, with a maximum
**11 chunks / 84,480 bytes** of PCM. Copied backing/microphone peaks are
**-36.41/-32.77 dB** and original-guide leakage is **-125.05 dB**. Stop closes the
decoder after 91 packets with zero outstanding PCM/encoded bytes and credits.
Provider readiness, guide exclusion, revocation, replacement publisher and
ordinary forwarding checks also pass. This proves component transport and
cleanup; copied PCM has not replaced the product's audible source.

Fixtures pass **91/91**:
`/tmp/ktv-received-pcm-port-fixtures-20261003.log`. New checks cover direct-port
credits/control stop, mapping, expiry/non-revival, monotonic continuity, invalid
renewals, receiver-only binding and continuous copying beyond sparse diagnostics.

The native PCM fixture now exercises the **actual production PartyReceiveGraph**,
including its scheduled gain, 100-ms early margin, source identity/clock checks,
context-state handling and final worklet. Both decoder and final output contexts
are independently verified frozen, then resumed after expiry; the stricter fault
blocks page callbacks immediately after suspend/resume requests. The default-rate
separate layout passes **10/10** with no late audible edges and four zero-RMS
post-expiry heartbeats. Its measured rates are **48,000 Hz for PCM decode/render**
and **44,100 Hz for the final output context**:
`/tmp/ktv-opus-pcm-native-device-rate-production-graph-frozen-20261003.log`.
The prior yielding and blocked versions also pass:

- `/tmp/ktv-opus-pcm-native-production-graph-both-frozen-20261003.log`
- `/tmp/ktv-opus-pcm-native-production-graph-blocked-frozen-20261003.log`

Forcing the final context to 48 kHz on this 44.1-kHz owned output again **fails**,
even with the production graph and both contexts frozen: an approximately 20-ms
burst appears at expiry +2535 ms. Log:
`/tmp/ktv-opus-pcm-native-forced-rate-production-graph-frozen-20261003.log` (exit 1).
This comparison associates the failure with the forced output-rate layout; it
does not locate the exact retained native buffer. Keeping the guard processor
alive after failure was already refuted. The next owned renderer should keep
48-kHz decode scheduling separate from the browser's default output context and
place the original receive graph after the captured-media boundary.

This is tested native synthetic output safety on Chrome 154 and the owned
44.1-kHz sink. Real SFU audible PCM/video timing, other output rates/browsers,
OS background/lock, physical outputs, long-song drift and aggregate native-buffer
bounds still require acceptance. Impaired source FPS, adaptive minimum latency,
handover timing, capacity and public-media release remain open. Product sources,
the frozen public artifact and deployment are unchanged.

### Owned audible PCM with common-clock video — 2026-10-03

The private controller now accepts an owned PCM adapter. Its 48-kHz decoder
worklet feeds a captured MediaStream into the existing default-rate application
receive graph. The original raw receiver source remains available for inaudible
instrumentation and is not connected to the audible gain. The application gain,
source-bound permit and final lease worklet retain all output authority. Adapter
shutdown closes only owned nodes/context/capture tracks and never stops the
caller's received track or output context. Worker housekeeping renewals cannot
authorize audible output.

Video release follows the PCM capture-clock cursor, accounting for the default
output context's native output timestamp. Native decoded video timestamps are
converted only after independent encoded/delivery epoch verification. That
verification is scoped to the current audio/video receiver workers, including
singer handover. The owned video queue is capped at 34 frames / **41 MiB**,
reserving space for the existing native frame allowance and bounded PCM/encoded
reservations within the original 40-frame / 64-MiB ceiling. Aggregate unmanaged
native audio/codec buffer acceptance still needs measurement.

Initial runs fail safely and remain recorded:

- `/tmp/ktv-owned-pcm-room-native-20261003.log`: output-clock validation closes
  the adapter. The corrected freshness check accepts the already established
  20-ms forward timestamp tolerance; it preserves the 80-ms capture bound and
  fails on larger clock discontinuities.
- `/tmp/ktv-owned-pcm-room-clock-diagnostic-20261003.log`: audible PCM, guide
  exclusion and revocation pass, but replacement video never becomes ready because
  epoch evidence mixes old and current receiver workers. Current-worker scoping
  fixes this lifecycle error.

The corrected audible/hand-over journey passes **43/43** with independent native
output detection, one visible performance, fresh publisher authority, bounded
queues and cleanup:
`/tmp/ktv-owned-pcm-room-current-epoch-native-20261003.log`.
Fixtures pass **95/95**:
`/tmp/ktv-owned-pcm-receiver-fixtures-20261003.log`, including owned-resource
teardown, module-startup cancellation, native-clock cursor validation and a
check that the original raw source never claims the guarded audible connection.

Both native clean 40-transition runs pass **49/49**, preserve 1280×720, the
25-fps/350-kbit/s VP8 source policy and the original matching/expiry limits:

| PCM hold | A/V p95 / maximum | Audio observation p95 | Video observation maximum | Source / decoded / presented fps |
| --- | --- | --- | --- | --- |
| 800 ms | 29.35 / 31.15 ms | 901.34 ms | 913.40 ms | 24.99 / 24.99 / 24.92 |
| 200 ms | 35.26 / 38.28 ms | 272.33 ms | 298.70 ms | 25.00 / 25.00 / 24.93 |

Each run matches all **40 pairs**, with zero unmatched audio/video edges. Logs:

- `/tmp/ktv-owned-pcm-clean-av-native-20261003.log`
- `/tmp/ktv-owned-pcm-200-clean-av-native-20261003.log`

The 200-ms setting proves a lower tested clean latency, not adaptive minimum
latency or impaired acceptance. Opus redundancy recovery, loss/reordering,
native source FPS under impairment, long-term clocks, actual integrated buffered
expiry, phone-guide/physical/mobile/capacity and release remain open. The adapter
and controller are private fixture code; no product source or deployment changed.

### Owned PCM redundancy and advancing capture clocks — 2026-10-03

RFC 2198 redundancy headers now retain their timestamp offsets and bounded
payload views. The private decoder recovers missing Opus packets in RTP order,
ignores history before startup or already decoded samples, and preserves the
48-chunk / 1-MiB PCM and 512-KiB encoded limits. Frames and credits are released
on failure. This is packet recovery, not an implemented reorder window or PLC.

The first full UDP run with this recovery remains a **failure**:
`/tmp/ktv-owned-pcm-red-full-udp-av-native-20261003.log`. Impaired timing is
113.44-ms p95 / 292.91-ms maximum; next-singer timing is 495.42 / 676.67 ms;
venue-to-remote matching times out. The decoder recovers hundreds of redundant
packets but still records missing samples. Impaired encoding averages 21.43 fps
with source capture near 25 fps. Encoded receiver video delivery can exceed one
second after capture, and native video jitter buffering also adds delay. Neither
the timing nor the full quality/recovery acceptance is complete.

The venue decoder incorrectly compared every capture header with its first
header and closed at 82 ms of cumulative phase change. Independent advancing
capture-clock evidence remains healthy, with maximum per-anchor residuals below
24 ms. The decoder now applies the original **80-ms discontinuity bound to
advancing primary anchors**, retaining its continuous first-anchor PCM sample
schedule. Accumulated phase is separately measured and capped at **200 ms**;
larger drift still closes because rate correction is not implemented. Video
uses the bounded phase history at the audible PCM position, excluding newer
packets still waiting in the hold queue. Clock jumps, duplicate authority,
overflow and cumulative drift have explicit fixtures.

All timing fixtures pass **100/100**:
`/tmp/ktv-owned-pcm-red-clock-fixtures-20261003.log`. Native acceptance of this
clock correction is pending. Product sources and the public deployment remain
unchanged; late video, bounded packet reordering/PLC, rate correction and all
previous physical/mobile/capacity/release gates remain open.

### Bounded Opus packet reorder window — 2026-10-03

The advancing-clock UDP rerun does not satisfy full acceptance:
`/tmp/ktv-owned-pcm-red-rolling-clock-full-udp-native-20261003.log`. Initial
impairment matches 40 pairs with zero unmatched edges and passes timing at
76.07-ms p95 / 186.53-ms maximum. Next singer matches 40 pairs but reaches
280.43 / 380.78 ms and stops at the unchanged capture-monitor queue-age gate
(106.127 ms, limit below 100 ms). Its decoder remains open with a 34.10-ms
maximum advancing residual and 32-ms maximum cumulative phase. Later handover
phases were not reached, so the original venue clock failure is not yet
verified fixed by native evidence.

The private decoder now holds an out-of-order primary for up to **80 ms**,
allowing missing earlier primaries or contiguous RED repairs before committing
a gap. This wait uses the existing PCM hold; it does not raise the configured
200–800-ms delay. The held queue has at most **8 encoded packets**, charged
against the existing shared **512-KiB encoded budget**, alongside pending decoder
input. A later packet cannot extend an earlier packet's wait. Late/duplicate
packets cannot refresh capture authority. Timeout, stop, overflow, invalid
repair and decoder failure clear held buffers and timers. Unrecoverable samples
remain silence; PLC and rate correction are still pending.

Native decoded-video arrival and release counters now distinguish frames
already late at the processor from lateness added after queue release. Only
bounded scalar counts, means and maxima are retained; no extra frame history is
allocated. The full timing fixtures pass **102/102**:
`/tmp/ktv-owned-pcm-reorder-fixtures-20261003.log`. Native reordering acceptance
and the new causal video measurements are pending. No product or public
deployment changes are included.

### Owned PCM buffered expiry and native reorder evidence — 2026-10-03

The full reorder run reaches all four timing phases without a decoder clock
shutdown: `/tmp/ktv-owned-pcm-reorder-full-udp-native-20261003.log`. It still
**fails acceptance**:

| Phase | Matched pairs | Skew p95 / maximum |
| --- | --- | --- |
| Baseline | 6 | 22.63 / 22.63 ms |
| Impaired | 40 | 447.76 / 552.48 ms |
| Next singer | 40 | 275.49 / 707.65 ms |
| Venue to remote | 40 | 197.44 / 597.56 ms |

Next singer has one unmatched audio edge; other phases have zero unmatched
edges. Venue capture-monitor queue age reaches 116.098 ms and fails its unchanged
100-ms bound. Impaired capture stays near 25 fps but encoding is **18.62 fps**
and presentation **16.99 fps**, also below the original nominal-quality gate.
Neither the monitor nor quality limits are relaxed.

The final two receivers reorder 188 and 203 late primary packets, recover 938
and 972 RED packets, and retain bounded queues (maximum held 7 and 6). Missing
samples total 0.90 / 0.92 seconds during these receiver generations; this is a
different run from the prior failures, not a controlled improvement ratio.
Advancing residuals remain at most 45 ms and cumulative phase at most 76.10 ms.
Native decoded-video arrival averages 634–646 ms and peaks at 2000–2040 ms;
hundreds of frames arrive after the configured hold. Maximum late release exceeds
1100 ms. This establishes late processor delivery as one remaining cause; it
does not prove which upstream transport/repair/native-buffer stage owns it.

The owned worklet now reports bounded future PCM sample counts, excluding gaps
and already rendered samples. Buffer proof subtracts report age. Output-fault
fixtures can use this layout without requesting a larger unused native audio
target, and the suspend fixture freezes/resumes both owned PCM and final output
contexts while page tasks remain blocked. Track instrumentation retains both raw
receiver and captured-boundary track IDs so it identifies the actual final graph.

The integrated both-context expiry run passes **50/50**:
`/tmp/ktv-owned-pcm-integrated-both-context-expiry-native-20261003.log`. Measured
future PCM exceeds **737 ms** before the stall. Native monitors confirm expired
old output stays silent through render resume and replacement, the unchanged
150-ms expiry margin and configured output separation hold, and replacement
microphone output is independently audible. This is real SFU synthetic/native
output acceptance, not physical or mobile acceptance. Source-stall acceptance
with this owned layout also passes **45/45**:
`/tmp/ktv-owned-pcm-integrated-source-task-expiry-native-20261003.log`. The actual
source page cannot renew or stop until after listener authority expires; native
output silence, retained reservations, provider removal and independently audible
replacement still meet their original bounds.

Timing fixtures pass **103/103**:
`/tmp/ktv-owned-pcm-buffer-fault-fixtures-20261003.log`. Product integration and
public enablement remain unchanged and incomplete.

### Received VP8 decode capability — 2026-10-03

The next private comparison can decode received video before native decoded-track
playout. The encoded receiver still forwards each original RTC frame unchanged.
An opt-in eight-frame capability probe retains at most 512 KiB of encoded input,
validates 1280×720 output and allocation bounds, closes every decoded frame and
creates no visible output. Default timing observation never reads payloads.
Codec/clock/output/configuration/timeout failures clear buffers and cannot revive.
Worker diagnostics retain allowlisted scalars and bounded frame/generation counts.

The initial run times out with zero inputs:
`/tmp/ktv-vp8-received-decode-native-20261003.log`. Its first received keyframe has
no capture header; later capture-bearing frames are delta frames. Startup now
decodes from that keyframe using its 90-kHz RTP sample clock, retains eight small
output records, then associates capture time using two advancing actual header
anchors. These capture values are explicitly **RTP projections**, not direct
headers on the first eight frames. Residuals retain the 80-ms limit and projection
is bounded to five seconds. No additional keyframe requests or encoder changes
are introduced.

The corrected native journey passes **39/39**:
`/tmp/ktv-vp8-received-startup-decode-native-20261003.log`. Eight actual received
VP8 frames decode with maximum encoded reservation **1590 bytes**, zero anchor
residual, maximum projection **1066 ms**, and maximum observed decode callback
delay **8.70 ms**. Outputs retain the nominal dimensions and are all closed. This
is native capability evidence only: sustained owned-video scheduling, impaired
timing/FPS and aggregate buffer acceptance remain pending.

Timing fixtures pass **110/110**:
`/tmp/ktv-vp8-capture-startup-fixtures-20261003.log`, including timestamp association,
startup without capture headers, bounded pending configuration, invalid output,
clock discontinuity, diagnostic privacy and unchanged sender/receiver frame flow.
The bytes/codec interpretation follows the [W3C VP8 WebCodecs registration](https://www.w3.org/TR/webcodecs-vp8-codec-registration/)
and the [encoded receiver transform boundary](https://www.w3.org/TR/webrtc-encoded-transform/).
Product sources and the public deployment remain unchanged.

### Continuous owned video prototype — 2026-10-04

The private receiver now optionally warms a continuous VP8 decoder from the first
keyframe, closes startup frames without capture metadata, and transfers later
capture-associated VideoFrames into the existing PCM-clock presentation queue.
Original RTC frames still flow unchanged. Video does not connect another audio
output; the existing default-rate final lease graph retains audible authority.
Decoder errors, clock discontinuity, forged credits and resource deadlines close
owned frames, buffers and ports without allowing renewal to revive them.

The decoder initially allowed two pending frames. Functional room/handover checks
pass **43/43** (`/tmp/ktv-owned-av-functional-clock-diagnostic-native-20261003.log`),
but two clean A/V attempts close during startup. The diagnostic run establishes
`VIDEO_BOUND`, with two pending frames and no capture discontinuity:
`/tmp/ktv-owned-av-clean-200-decoder-diagnostic-native-20261003.log`. The earlier
failure remains recorded at `/tmp/ktv-owned-av-clean-200-native-20261003.log`.

The pending decoder allowance is now four, with at most two transferred frames.
The presentation queue is reduced to **32 frames / 33 MiB**. Including four
decoder-pending frames, two transfers, one writer and one generator preserves the
original **40-frame** ownership bound. Reserving eight full RGBA frames, 1 MiB
PCM and two 512-KiB encoded budgets with the 33-MiB queue stays below **64 MiB**.
Native codec/platform buffers outside this ownership accounting still require
aggregate measurement. Expected decoder output retains metadata rather than a
second JavaScript payload after WebCodecs takes its chunk copy.

Quality checks require actual owned decoder output and unique draws, as well as
presented frames, to remain **20–30 fps**. Synthetic presented counters cannot
substitute for a slow decoder or repeated draws. Tests retain the smaller owned
queue/codec limits. All timing fixtures pass **119/119**:
`/tmp/ktv-owned-video-isolated-host-fixtures-20261004.log`.

The four-pending clean attempt does not pass:
`/tmp/ktv-owned-av-clean-200-four-pending-native-20261004.log`. The source enters
audio recovery after calculated phase reaches approximately **141 ms**. Existing
rate correction is active (up to 1.005); clock RTT is low. This does not prove
shared-host CPU load caused the source-clock failure. No source drift, marker,
quality or expiry gate is relaxed.

The native harness can now place the receiver on a separate SSH host with an
independent loopback debug-forward port and binary path. The next comparison uses
the same verified Chrome **154.0.8037.92** on separate four-CPU source/receiver
hosts to distinguish shared-host effects. Source settings, capture evidence and
acceptance gates remain unchanged. Clean timing, impaired timing, sustained
clocks, owned-video integrated expiry and product/release acceptance are pending.

### Owned audio/video clean timing on separate hosts — 2026-10-04

The separate-host clean run passes **50/50**:
`/tmp/ktv-owned-av-clean-200-isolated-host-native-20261004.log`. All 40 marker
pairs match with zero unmatched audio/video edges. Skew is **35.89-ms p95 /
52.37-ms maximum**. Source capture/encoding is **24.99 fps**, owned decoding
**25.01 fps**, unique draws **24.68 fps** and actual presentation **24.66 fps**,
with the original 1280×720 / 25-fps / 350-kbit/s policy and unchanged quality gates.

The configured hold is 200 ms; actual audio observation is **415.37-ms median /
455.83-ms p95 / 457.61-ms maximum**, and video observation reaches **480.30 ms**.
The hold setting is not total latency. This confirms clean relative alignment,
not minimum practical latency, impaired acceptance, sustained clocks or physical
guide alignment. The prior shared-host source-clock failure remains recorded;
one passing isolated run does not establish its cause. The next full UDP and
handover run retains 150-ms delay, 40-ms jitter and 5% loss on both proxy legs,
40 impaired pairs, nominal quality and all capture/matching gates.

### Encoded video order and impaired owned decoding — 2026-10-04

The first separate-host full UDP attempt fails to collect 40 impaired pairs:
`/tmp/ktv-owned-av-full-udp-isolated-host-native-20261004.log`. Baseline six pairs
have 41.75-ms maximum skew. Impaired source encoding remains **23.49 fps**, but
owned decoding falls to **19.51 fps**, unique draws/presentation to **19.23 fps**,
and only 13 video transitions are observed. All original FPS/matching gates fail
the run. The controller remains live with no capture discontinuity, maximum
pending decoder count three and bounded input bytes. Decoded video arrives with
307-ms mean / 525-ms maximum age, with no arrival after the 800-ms hold; late
release stays below 45 ms. This differs from the previous native-video late
delivery failure and does not establish acceptable visual decoding.

The decoder had dropped every non-advancing RTP timestamp, combining duplicates
with previously unseen late frames. It now distinguishes those cases using a
64-entry numeric history and adds a bounded **80-ms encoded reorder window**
before owned decoding. At most eight held packets share the same **512-KiB**
encoded budget with pending native decoder input. A newly arrived earlier frame
cannot extend the first queued arrival's deadline. Decoder completion drains the
ordered queue without exceeding four pending outputs. The first keyframe still
warms the codec immediately. Stop/error clears all held copies and timers.
Original RTC frames are forwarded in their original order and remain unchanged.

Timing fixtures pass **121/121**:
`/tmp/ktv-owned-video-reorder-fixtures-20261004.log`, including RTP wrap, late
ordering, fixed wait deadlines, byte/count overflow and cleanup. The next native
comparison preserves the full UDP profile and every timing/quality limit; native
reorder and visual-recovery acceptance remain pending.

### Repair window within the existing hold — 2026-10-04

The 80-ms video reorder run still fails to collect 40 impaired pairs:
`/tmp/ktv-owned-av-video-reorder-full-udp-native-20261004.log`. It reorders 107
frames but records **189 previously unseen late frames** and 43 duplicates.
Source encoding is 20.08 fps; owned decoding 17.88 fps and presentation 17.67 fps,
below the unchanged gates. Thirty video transitions are detected. The decoder
remains live, with maximum held queue six and input bytes 16,383; native source/
receiver counters show no new keyframe over the measured impaired interval.

The private longer-hold layout now uses a **240-ms encoded reorder window** when
configured PCM hold is at least 500 ms; the 200-ms layout retains an 80-ms window.
This allocates time inside the existing hold and does not increase PCM hold.
Held packets remain capped at eight, share the original 512-KiB encoded budget,
and keep a fixed first-arrival deadline. The codec/presentation ownership and
64-MiB limits are unchanged. This is a repair-window comparison, not an accepted
adaptive latency policy. Keyframe/dependency recovery remains open.

Timing fixtures pass **122/122**:
`/tmp/ktv-owned-video-long-reorder-fixtures-20261004.log`, including a 180-ms late
repair decoded in RTP order at the fixed 240-ms deadline. Native acceptance of
the longer window remains pending; no product or deployment changes are made.


### Bounded video burst pressure — 2026-10-04

The first 240-ms run fails during startup, before UDP impairment:
`/tmp/ktv-owned-av-video-long-reorder-full-udp-native-20261004.log`.
Eight held encoded packets exhaust the count bound and close with `VIDEO_BOUND`;
no video arrived after the existing hold. This is not impaired acceptance.

The decoder now drains the oldest RTP packet when a burst fills its eight-packet
queue before the timer. It retains the fixed arrival deadline for remaining
packets, four pending decode outputs, 512-KiB shared encoded budget and permanent
closure when a stalled decoder prevents bounded admission. A separate numeric
pressure counter records early drains. No count, memory, timing or quality gate
is increased. Timing fixtures pass **123/123** in
`/tmp/ktv-owned-video-pressure-fixtures-20261004.log`, including burst admission
and saturated-decoder closure. A full native UDP/recovery/handover rerun is in
progress. Product integration and all remaining release gates remain open.


### Native decoded-frame memory reservation — 2026-10-04

The burst-pressure rerun reaches audible PCM/video startup, then fails the clean
baseline with `PLAYOUT_QUEUE_BOUND`:
`/tmp/ktv-owned-av-video-pressure-full-udp-native-20261004.log`.
Source/encoded rates are 25.03/24.98 fps; owned decode/draw are 25.09/24.33 fps.
The queue retains 25 I420 frames (34,560,000 bytes) before the next frame exceeds
the earlier 33-MiB suballocation. Impaired phases are not reached.

A separate native eight-frame probe passes **39/39** in
`/tmp/ktv-vp8-received-format-native-20261004.log`: every output is I420 and
allocates **1,382,400 bytes** at 1280×720. Output-format telemetry admits only
known enum values and retains the existing eight-record cap.

The private continuous decoder and transfer adapter now strictly admit I420/NV12
outputs at no more than 1.5 bytes per pixel, rejecting other/unknown formats
before transfer. The presentation suballocation becomes **32 frames / 42.5 MiB**.
Four codec-pending outputs still reserve full RGBA; the two transferred frames,
writer and generator reserve bounded YUV allocations. Including 1 MiB of PCM and
two 512-KiB encoded budgets, retained payload reservation is **63.84 MiB / 40
frames**, within the original gates. Opaque codec/platform storage and sustained
memory acceptance remain open; this is a private format restriction, not a
claim of mobile compatibility or deployment. Fixtures pass **125/125** in
`/tmp/ktv-owned-video-yuv-budget-fixtures-20261004.log`. Full native UDP evidence
with the redistributed budget remains pending.


### Local receiver route isolation — 2026-10-04

The redistributed-budget run passes six clean baseline pairs with maximum skew
**62.14 ms**, source-to-video maximum **1046.30 ms** and a live bounded decoder:
`/tmp/ktv-owned-av-yuv-budget-full-udp-native-20261004.log`. It stops at the
unchanged no-bypass gate before any packet-loss phase. With the receiver on the
SFU host, server-initiated local ICE checks can establish a direct peer-reflexive
path outside the proxy; rewriting signaled candidates alone cannot isolate it.

An explicit private `KTV_ROOM_TEST_BLOCK_LOCAL_ICE_BYPASS=1` option now installs
one uniquely identified output rule for new UDP connections from fixture source
port 17902 to local destinations. Established proxy-created replies remain
allowed. The independent 15-minute watchdog and stdin closure remove the exact
rule; normal cleanup verifies its absence. No existing policy is replaced.
Native datagram checks verify proxy replies, blocked unsolicited local traffic
and restored traffic after removal. Selected route logging contains only protocol
and port, and the original no-bypass gate remains required. A full guarded-route
UDP/recovery/handover run is in progress. Earlier bypassed runs provide no
impaired-network acceptance.


### Verified-route owned video impairment — 2026-10-04

`/tmp/ktv-owned-av-yuv-isolated-route-full-udp-native-20261004.log` exits 1.
Both selected paths are verified UDP proxy port 7882. Baseline maximum skew is
89.69 ms, with nominal source/decode/draw rates and no queue failure. The impaired
phase times out collecting 40 pairs: only **13 video transitions** are detected.
The live decoder reorders 89 frames, discards 155 unique late frames and performs
14 bounded pressure drains. Source capture/encode rates are **25.00/19.44 fps**;
owned decode/presentation are **17.66/17.47 fps**, below the unchanged 20-fps
floor. Arrival mean/max are 540.80/836 ms; release maximum lateness is 47.63 ms.
There is no codec/clock shutdown or memory overflow, but this is failed timing/
quality evidence. Normal cleanup verifies that the local ICE rule is removed.

The existing native sender-keyframe experiment can now run with the private
owned-video layout on the original VP8/350-kbps/25-fps policy, without a marked
alternate-codec build or competing keyframe policy. A 1000-ms request interval
is being tested to recover codec references lost through missing/late frames.
Actual native keyframe counters, full marker matching and nominal quality remain
required; a fulfilled API request alone is insufficient. Previous native-video
keyframe experiments did not establish acceptance. Product integration remains
open. The retained-frame reservation regression passes with the full fixtures
**126/126** in `/tmp/ktv-owned-video-memory-reservation-fixtures-20261004.log`.


### Bounded owned-video keyframe demand — 2026-10-04

The 1000-ms periodic run exits 1:
`/tmp/ktv-owned-av-yuv-keyframe1000-full-udp-native-20261004.log`.
Actual native encoder counters show 0.994 keyframes/s under impairment and
104 accepted/fulfilled API requests. Fifty video marker transitions appear,
but 40 matched pairs are not collected. Source capture remains 24.99 fps while
encoding falls to **1.06 fps**; owned decode/presentation are **1.02/1.07 fps**.
The decoder remains open with six unique late frames, but nominal quality fails.
Keyframe API completion is therefore not acceptance.

The existing private demand-recovery policy now accepts the owned decoder's
monotonic unique-late-frame counter. A newly discarded reference can trigger a
manual sender keyframe request, with the original five-second cooldown and
recent-decoded-keyframe suppression. Missing/closed/switched/reset decoder
evidence is rejected. Decisions use only native transport/decoder progress,
not marker IDs, pixels, lyric state or observed marker skew. Encoder counters
must independently show new keyframes after requests.

Fixtures pass **128/128** in
`/tmp/ktv-owned-video-demand-recovery-fixtures-20261004.log`. A 40-pair impaired
run is in progress, retaining route isolation, original codec/bitrate, memory
bounds and timing/quality thresholds. Demand timing remains scoped to the initial
publisher as in the earlier private demand experiment; full post-handover timing
remains a separate required gate. Product integration and release stay open.


### Extended encoded repair within the existing PCM hold — 2026-10-04

The owned demand run also exits 1:
`/tmp/ktv-owned-av-yuv-demand-full-udp-native-20261004.log`.
Eleven requests complete, 39 video transitions appear, but 40 impaired matched
pairs are not collected; native source/receiver rates fall to **2.88/2.79 fps**.
The owned decoder remains open with 25 unique late frames. Neither periodic
nor five-second demand recovery satisfies the current nominal policy.

The next private experiment retains copied encoded packets for up to **500 ms**
inside the existing **800-ms PCM hold**. Longer packet retention uses at most
**20 compressed packets**, still sharing the unchanged **512-KiB encoded budget**
with pending codec inputs. The earlier eight-packet count could drain before
repairs arriving after 240 ms; byte bounds continue to reject oversized/burst
input. Shorter holds retain the previous 80/240-ms windows and eight-packet cap.
First-arrival deadlines, four pending decode outputs, two transfers, 32 queued
decoded frames, 40 total decoded frames and 64-MiB payload reservation remain
bounded. No PCM hold, bitrate or timing/FPS acceptance threshold is increased.

Fixtures pass **129/129** in
`/tmp/ktv-owned-video-extended-repair-fixtures-20261004.log`, including a 350-ms
late burst decoded in RTP order without pressure drains. Additional quality
checks pass **8/8** in
`/tmp/ktv-owned-video-extended-repair-quality-fixtures-20261004.log`, rejecting
encoded count above the selected cap. A full UDP/recovery/handover run without
keyframe requests is in progress. Native acceptance and product integration
remain pending; all physical/mobile/capacity/persistent-SFU release work remains.


### Extended-window startup output failure — 2026-10-04

`/tmp/ktv-owned-av-extended-repair-full-udp-native-20261004.log` exits 1 before
baseline matching: owned PCM closes with `PLAYOUT_PCM_OUTPUT_LATENCY` when
measured default-context output latency reaches **202.99 ms**, beyond the existing
200-ms safety bound. The controller reports `PLAYOUT_AUDIO_CLOCK` after the
adapter closes. Video remains healthy until that teardown: maximum held encoded
queue 16, pending decode outputs three, input bytes 30,347, presentation queue
16 frames / 22,118,400 bytes; release maximum lateness 32.05 ms. There is no
encoded timing error, frame-clock jump or video allocation overflow.

This run establishes neither clean nor impaired acceptance. One unchanged
repeat is in progress to determine whether the output-latency failure recurs;
no clock limit, output timestamp, PCM hold or timing/FPS threshold is adjusted.
Native output stability and the extended packet-repair policy remain pending.


### Extended repair repeat and native receiver feedback capability — 2026-10-04

The unchanged repeat exits 1:
`/tmp/ktv-owned-av-extended-repair-repeat-full-udp-native-20261004.log`.
Baseline maximum skew is **72.57 ms**, with both selected paths verified through
UDP proxy port 7882. No output-latency shutdown recurs. During impairment, native
source/receiver rates are **20.63/20.51 fps**; the owned decoder remains open,
reorders **263 frames** and discards **20 unique late frames**, with no pressure
drains. Maximum held queue is 17/20 and encoded input 29,946/524,288 bytes.
Arrival maximum is 1039 ms; release maximum lateness is 118.51 ms. Owned presentation is **19.97 fps**, below the unchanged 20-fps floor.
Only **seven video marker transitions** are detected, so 40 matched pairs are not collected.
Longer packet retention improves reordering but does not establish reliable
codec-reference recovery or impaired acceptance.

A private `KTV_ROOM_TEST_RECEIVER_ENCODED_API=standard` selector now permits
testing the standard receive transform when Chrome exposes both APIs. Defaults
continue using the existing native choice. The standard worker observes whether
its actual transformer exposes `sendKeyFrameRequest`, without requesting a
frame yet. The API is defined by the
[encoded-transform specification](https://www.w3.org/TR/webrtc-encoded-transform/#dom-rtcrtpscripttransformer-sendkeyframerequest).
This is a capability study of receiver feedback through the SFU, not accepted
recovery or a product source/encoder policy change. Existing fixtures pass
**129/129**; explicit dual-API standard selection also passes in
`/tmp/ktv-standard-receiver-api-selection-fixtures-20261004.log`. A native
eight-frame standard receiver probe is in progress. Invocation, actual encoded
keyframe responses, original nominal cadence and full impaired/handover timing
still require proof.


### Standard receiver reservation diagnostic — 2026-10-04

`/tmp/ktv-vp8-standard-receiver-native-20261004.log` exits 1 before decoding:
standard worker streams and the keyframe-request method are observed, but no
received frame/capture timestamps appear. There are no worker/pipe exceptions.
API exposure is not a working receive path.

The private selector now retains constructor-time encoded-stream reservation
when Chrome exposes its legacy API, even when the requested receive attachment
is standard. It continues selecting exactly one receive API, preserves the
SDK's configuration updates and does not overwrite existing transforms.
Fixtures pass **130/130** in
`/tmp/ktv-standard-receiver-reserved-fixtures-20261004.log`. A separate native
reserved-standard probe is in progress; no capture, keyframe invocation or
impaired recovery acceptance is claimed yet.


### Working standard receive path and bounded native feedback — 2026-10-04

The reserved standard receiver probe passes **40/40**:
`/tmp/ktv-vp8-standard-reserved-receiver-native-20261004.log`. Eight actual
received VP8 frames decode with two capture anchors, and the worker observes
the native `sendKeyFrameRequest` method. This is capability evidence only.

An explicit private `KTV_ROOM_TEST_RECEIVER_KEYFRAME_RECOVERY=1` option now
requests a keyframe through that actual standard receiver transformer after a
new unique late-frame discard. Requests have one pending promise at most, a
five-second cooldown and one-second suppression after an admitted keyframe.
Missing native methods or rejected requests permanently close owned resources.
The policy follows each current receiver worker across handover and does not
call source `setParameters`, grant publication or increase buffering/bitrate.

Scalar diagnostics record requested/fulfilled counts and actual owned decoded
keyframes. The native acceptance gate independently requires advancing encoder
and decoded keyframe counters when requests occur; fulfilled API calls alone
are insufficient. Fixture checks pass **133/133** in
`/tmp/ktv-native-receiver-keyframe-evidence-fixtures-20261004.log`, covering
cooldown, recent-key suppression, stop, missing API and missing/reset native
keyframe response evidence. A full 40-pair UDP/recovery/handover run is in
progress on the unchanged nominal profile and memory/timing limits. Impaired
acceptance, product integration and remaining release requirements stay open.


### PCM credit backpressure during native feedback testing — 2026-10-04

`/tmp/ktv-owned-av-native-receiver-recovery-full-udp-20261004.log` exits 1.
Clean baseline maximum skew is **80.99 ms**, with both UDP proxy routes verified.
The owned PCM decoder closes near the start of impairment (`PLAYOUT_PCM_DECODER`
at the adapter), before any receiver keyframe request; maximum PCM credits are
48. Default output latency at closure is 41.05 ms, so this is a different failure
from the earlier 202.99-ms output guard closure. Native source/receiver video
rates remain **22.79/22.51 fps**, while closed owned presentation supplies no
valid impaired evidence. The Native receiver feedback hypothesis is untested.

The PCM decoder previously treated a full 48-credit render queue as a terminal
bound violation. It now pauses decoding inside the existing **eight-packet /
512-KiB shared encoded queue**, then resumes on exact consumed credits. Partial
RED repairs retain their remaining primary/history until credits become available
and do not decode recovered samples twice. PCM remains at **48 chunks / 1 MiB**;
continued decoder/render stalls still overflow the unchanged encoded bound and
close permanently. Fixed capture scheduling, source/clock/expiry limits and all
video/memory/timing gates remain unchanged. Terminal decoder/port reasons are
now propagated as allowlisted error codes for the next native diagnosis.

Fixtures pass **133/133** in
`/tmp/ktv-owned-pcm-credit-backpressure-fixtures-20261004.log`, including staged
RED credit return and stalled render/decode overflow without resurrection.
A full standard-receiver UDP/recovery/handover rerun is in progress. Buffered
expiry with the updated owned video/PCM path, sustained output, recovery, product
integration and the full physical/mobile/capacity/release gates remain pending.


### Actual native feedback responses with live PCM — 2026-10-04

`/tmp/ktv-owned-av-receiver-recovery-pcm-backpressure-full-udp-20261004.log`
exits 1, but both owned decoders remain live. Baseline maximum skew is **28.44
ms**. Impaired native source/receiver rates are **24.99/20.55 fps**, with owned
decode/presentation **24.39/23.74 fps**. Twelve native receiver requests fulfill;
encoder and owned decoded key counters advance by **19 and 16**, satisfying
the independent feedback-response gate. The decoder reorders 316 frames and
discards 41 unique late frames. PCM retains at most 43 chunks; no backpressure
is needed in this run, so native credit-pressure recovery is not yet proven.

Full marker acceptance still fails: there are 37 impaired video transitions
(43 includes six baseline transitions), fewer than the required 40 matched pairs.
A diagnostic reconstruction from saved observations finds 34 pairs, absolute
p95/max **468.23/690.86 ms**, three unmatched video transitions and at least
11 unmatched audio edges. The diagnostic audio cutoff uses the first recorded
phase stats sample (and a separate -1000-ms comparison), rather than the exact
start callback, so unmatched-audio counts are diagnostic only. Both comparisons
retain 34 pairs and the same skew. No timing or quality gate is relaxed.

A private bounded receiver-feedback interval now permits **1000–5000 ms**; the
default remains five seconds, with one pending request and recent-key suppression.
A one-second interval is being tested because five-second recovery still leaves
missing/delayed marker transitions. It uses actual receiver RTCP feedback and
does not call source parameter APIs. Fixtures pass **134/134** in
`/tmp/ktv-native-receiver-faster-recovery-fixtures-20261004.log`, including faster
cooldown, recent keys and terminal rejection. Full native timing/recovery/handover,
updated buffered expiry and all remaining release requirements remain open.


### Gap-aware video repair and decoded transfer pressure — 2026-10-04

The one-second receiver-feedback run also exits 1:
`/tmp/ktv-owned-av-native-receiver1000-backpressure-full-udp-20261004.log`.
Baseline maximum skew is 21.39 ms. During impairment, eight requests fulfill
with nine new owned decoded and 11 encoded keys, but source/receiver rates fall
to **2.68/2.75 fps**, and owned presentation to **2.59 fps**. Both decoders remain
open; the original nominal quality gate fails. Faster feedback is not accepted.
The default five-second interval remains unchanged.

The next explicit private `KTV_ROOM_TEST_VIDEO_REORDER=gap` mode decodes RTP
steps up to **54 ms** immediately (nominal 25-fps capture, allowing cadence
quantization), and waits up to **700 ms** only on larger gaps at an 800-ms PCM
hold. Earlier RTP repairs drain the ordered chain immediately; an unrepaired
gap commits at the fixed original arrival deadline, with numeric diagnostics.
This threshold is a pacing hypothesis, not a codec dependency declaration;
encoder frame thinning can also create RTP gaps. Committed gaps and unique late
discards can trigger the existing bounded native feedback policy.

Decoded frames now wait for exact transfer credits inside the existing **four
pending-output reservation**, rather than being discarded during a two-frame
port burst. Native decode inputs and ready outputs share that same four-frame
cap. Stop closes every retained ready frame; resume transfers in RTP order and
cannot revive a closed decoder. The encoded queue remains **20 packets / 512
KiB**, transfers two, presentation 32, total owned decoded frames 40 and payload
reservation below 64 MiB. Original RTC bytes keep flowing unchanged.

Fixtures pass **137/137** in
`/tmp/ktv-owned-video-gap-transfer-backpressure-fixtures-20261004.log`, covering
wrap, immediate contiguous decode, repaired gaps, fixed gap expiry, four-frame
transfer pressure, exact close and no resurrection. The full UDP/recovery/handover result is recorded below. Full timing, updated
expiry, product integration and all remaining physical/mobile/capacity/release
gates remain open.


### Gap experiment result and measured bandwidth allocation — 2026-10-04

`/tmp/ktv-owned-av-gap-reorder-transfer-backpressure-full-udp-20261004.log`
exits 1. Baseline maximum skew is **93.45 ms**, and both proxy routes are
verified. During impairment source/receiver rates fall to **1.25/1.28 fps**;
owned decode/presentation are **1.35/1.26 fps**, failing the unchanged nominal
quality gate. Sixteen native requests fulfill during the phase, with 22 new
encoded and 21 decoded keys. Both decoders stay open. The video worker reports
121 committed pacing gaps, one unique late frame, three transfer waits, at most
two ready outputs, four pending outputs and 20 held packets. Release lateness
reaches **2201.11 ms**. Forty matched transitions are not obtained.

Pacing gaps are not proof of missing VP8 references: encoder thinning can create
the same RTP spacing. Treating these gaps as damage may cause extra feedback.
That causal hypothesis needs an isolated comparison; API fulfillment and live
decoders do not establish usable timing or cadence.

Measured outbound byte deltas across impairment also expose a bandwidth
allocation difference. Rates include encoded transport payload overhead:

| Private run | Audio sent / median target (kbps) | Video sent / median target (kbps) |
| --- | --- | --- |
| Five-second feedback, PCM backpressure | 130.78 / 64 | 181.31 / 350 |
| One-second feedback | 130.82 / 64 | 27.56 / 45.74 |
| Gap reorder, five-second feedback | 130.83 / 64 | 21.53 / 30 |

Audio RED contributes overhead beyond the 64-kbps primary Opus target. Video
allocation falls near its floor in the failed cadence runs. These observations
do not isolate feedback as the cause; impaired packet schedules differ between
runs. The prescribed Opus target, RED policy, video cap, resolution and acceptance
thresholds remain unchanged. Updated owned audio/video buffered-expiry validation
is running separately before further timing changes.


### Updated owned queues pass both-context expiry — 2026-10-04

`/tmp/ktv-owned-av-ready-queue-both-context-expiry-20261004.log` exits 0 with
**51/51** checks. The standard encoded receiver uses both owned VP8 video and
owned PCM with the updated ready-output/credit backpressure. The renderer
retains **691.97 ms** of actual future PCM (40 chunks / 307,200 bytes after
subtracting the 96.80-ms report age). Both the PCM and final output audio clocks
actually freeze, then resume for more than ten seconds while page callbacks
remain blocked. Independent native capture confirms old buffered audio stays
silent during replacement, meets the unchanged 150-ms expiry margin and
preserves the configured old/new output separation. Replacement output stays
audible. This is digital browser-output evidence, not physical acoustic proof.

The feedback policy now follows unique received frames discarded as late and
ignores committed RTP pacing gaps, which do not distinguish reference loss
from encoder thinning. The former `gapRepairs` counter is named
`contiguousDrains`: it measures contiguous held-chain draining, not uniquely
identified network repairs. Fixtures pass **138/138** in
`/tmp/ktv-owned-video-pacing-feedback-fixtures-20261004.log`. Sender diagnostics
also retain allowlisted native priority/networkPriority and finite bitratePriority
values for the next allocation comparison; focused diagnostics tests pass 2/2
in `/tmp/ktv-sender-priority-diagnostics-fixtures-20261004.log`. No source
allocation, audio RED or bitrate policy has changed. Source-task expiry is
being checked next; full impaired timing and release acceptance remain open.


### Source-task expiry retest needs replacement-output diagnosis — 2026-10-04

`/tmp/ktv-owned-av-ready-queue-source-task-expiry-20261004.log` exits 1 after
25 checks. It measures **762.24 ms** of future PCM, removes the old publisher
and confirms that the source cannot renew before authority expires. The old
buffered output stays silent throughout replacement. The independent replacement
listener produces 14 heartbeats over the remaining 13.42-second blocked-page
window, but fails the requirement that every heartbeat remains above RMS 0.02.
The replacement is not accepted; bounded heartbeat level diagnostics are added
for a causal rerun. This does not invalidate the separate 51/51 both-context
result or prove source-stall acceptance. No timing or audible threshold changes.

The full updated timing/capability fixture suite passes **139/139** in
`/tmp/ktv-owned-video-pacing-feedback-all-fixtures-20261004.log`, including the
new sender-allocation allowlist checks.


### Exact expired-session classification after a blocked callback — 2026-10-04

The diagnostic source-task rerun
`/tmp/ktv-owned-av-ready-queue-source-task-expiry-diagnostic-20261004.log`
exits 1 after 36 checks. All 13 replacement-output heartbeats remain audible
(minimum RMS **0.07652**, no samples below 0.02); old output remains silent
and the unchanged expiry/separation checks pass. The final resource check rejects
the old controller's `PLAYOUT_VIDEO_AGE` / PCM `PLAYOUT_PCM_CLOCK` terminal
closure when stale queued callbacks run after the blocked page resumes.
This is a different result from the earlier replacement-output interruption;
the earlier failure remains recorded and is not reclassified.

The private controller now records its terminal Unix time. Only the exact old
controller session captured immediately before the source fault can accept a
terminal `PLAYOUT_VIDEO_AGE` or `PLAYOUT_AUDIO_CLOCK` result after the delivered
cutoff. This classification is available only after every independent native
silence, replacement-audibility, timing and separation assertion succeeds. Both
owned adapters must be closed, the decoded frame queue empty, and the original
frame/byte maxima within bounds. Earlier closures, other sessions, current
replacement errors, memory overflows and incomplete cleanup still fail. Normal
timing runs have no expiry exception. Fixtures pass **140/140** in
`/tmp/ktv-owned-expiry-session-classification-fixtures-20261004.log`; negative
cases cover every classification condition. An integrated source-task rerun
with the recorded closure time is in progress.


### Updated owned queues pass source-task expiry — 2026-10-04

`/tmp/ktv-owned-av-source-task-expiry-bound-session-20261004.log` exits 0
with **46/46** checks. The real standard receiver retains **769.67 ms** of
future PCM (41 chunks / 314,880 bytes after 34-ms report age). The old source
cannot renew before the output cutoff; provider removal and a fresh replacement
publisher occur while the old listener page remains blocked. Independent capture
confirms old buffered output stays silent within the unchanged expiry and
separation limits. All 14 replacement heartbeats remain audible (minimum RMS
**0.07824**); bounded resources and the exact expired-session classification pass.
Together with the separate **51/51** both-context freeze/resume result, this
closes these digital buffered-expiry regressions for the updated owned queue
path. It does not establish sustained, physical, mobile or impaired timing
acceptance. The previous intermittent replacement-output failure remains a
recorded limitation until sustained testing explains or excludes recurrence.

The next full UDP/recovery/handover run uses gap-only reorder with five-second
feedback for unique late received references only. Source/audio/video profiles
and all original 40-pair, nominal cadence and timing thresholds remain intact.


### Late-reference feedback result and allocation comparison — 2026-10-04

`/tmp/ktv-owned-av-gap-reorder-late-reference-feedback-full-udp-20261004.log`
exits 1. Clean baseline maximum skew is **43.15 ms**. Impaired source/native
receiver rates are **7.10/7.02 fps**, with owned decode/presentation **6.92/6.75
fps**; nominal cadence and 40 matched transitions still fail. Both owned
decoders stay live. Six requests fulfill with ten new encoded and decoded
keys. The worker sees 513 pacing gaps, eight unique late frames, 90 reordered
frames, 148 contiguous drains and 13 transfer waits. Release lateness averages
**19.46 ms** but reaches **620.08 ms**. Fewer requests do not establish usable
cadence or complete timing acceptance.

Native sender readback now confirms audio `priority=high` /
`networkPriority=high` and video `priority=low` / `networkPriority=low`. Audio
sends **130.75 kbps**, median primary target **64 kbps**; video sends **54.62
kbps**, median target **59 kbps** despite its unchanged 350-kbps cap. This
supports investigating relative allocation as a separate hypothesis.

The explicit private `KTV_ROOM_TEST_SOURCE_PRIORITY=equal` comparison changes
only the nominal video's local priority to high. Native transactions preserve
networkPriority (packet DSCP), 350-kbps/25-fps caps, degradation preference,
encoding shape and all audio parameters. Readback failure closes the experiment;
phase evidence requires an actual successful transaction and current high video
priority. No source keyframe parameter API is used. The distinction between
local allocation priority and packet network priority follows the
[W3C WebRTC Priority Control API](https://www.w3.org/TR/webrtc-priority/#dom-rtcrtpencodingparameters-priority).
This is a private comparison, not a production policy or acceptance claim.

Fixtures pass **143/143** in
`/tmp/ktv-source-priority-allocation-fixtures-20261004.log`, including unchanged
audio/caps/network priority, unsupported/rejected/readback failure, exact-profile
admission and permanent stop. A full original-profile UDP/recovery/handover run
is in progress. All original timing, 40-pair, nominal cadence and memory gates
remain in force.


### Equal local allocation does not close impaired cadence — 2026-10-04

`/tmp/ktv-owned-av-equal-allocation-gap-reorder-full-udp-20261004.log` exits 1.
Native readback confirms an actual successful transaction: video local priority
is high, packet network priority remains low, and the 350-kbps/25-fps caps remain
unchanged. Audio remains high/high at 64 kbps. Baseline maximum skew is
**37.72 ms**. Impaired source/native receiver rates are **3.67/3.67 fps**;
owned decode/presentation are **3.63/3.21 fps**. Forty matched transitions
time out. Both decoders stay live. Seven requests fulfill, with nine new decoded
and ten encoded keys. Video sends **32.46 kbps**, median target **48 kbps**;
audio sends **130.79 kbps**, median primary target **64 kbps**. Release lateness
reaches **746.84 ms**. Equal local priority does not resolve the observed
allocation/cadence collapse and is not selected for production.

Prior codec evidence is reviewed before another comparison: native VP9
previously encoded 21.78 fps but decoded 16.90 fps, while H.264 cadence was
unstable across traces. Owned bounded packet ordering is a new mechanism since
those earlier native-output comparisons. No codec, priority or bitrate policy
change is justified for deployment yet.


### Declared VP9 through the owned reorder/decoder path — 2026-10-04

A scoped comparison extends the private continuous decoder to declared VP9
using `vp09.00.31.08`, while the default remains VP8. It requires native codec
support, exact received payload MIME matching, 1280×720 output and the existing
I420/NV12 allocation ceiling. Unknown codecs and fallback payloads fail before
transfer. Four pending/ready outputs, two transferred outputs, 20 held encoded
packets / 512 KiB and the 32-frame presentation queue remain unchanged. The
[VP9 WebCodecs registration](https://www.w3.org/TR/webcodecs-vp9-codec-registration/)
describes frame payloads and qualified codec strings; native capability and
actual output still need the browser run.

The harness admits owned PCM with an advanced codec only for an explicitly
marked nominal VP9 comparison artifact: 350 kbps, requested 25 fps, default
transport, no source keyframe override, and backup codec disabled by the private
builder. This comparison retains the original Opus/RED policy, output permission
guard, expiry and acceptance limits. Equal-priority tuning is not combined with
this codec comparison. Fixtures pass **144/144** in
`/tmp/ktv-owned-vp9-nominal-decoder-fixtures-20261004.log`. The separate build completes
at `/tmp/ktv-codec-candidate-owned-vp9-20261004` with production source and
every dist byte preserved (log `/tmp/ktv-owned-vp9-private-build-20261004.log`).
Production and frozen preview index SHA256 remain
`19c5921520411deb8728b7975dd8d7a6b362eb33cdb0a0fc46852aee52ecb9ed`.
A full native UDP/recovery/handover run is in progress using the declared decoder,
original source priorities and five-second late-reference feedback. No codec
choice or release acceptance is claimed.


### VP9 startup exposes a private worker codec allowlist omission — 2026-10-04

`/tmp/ktv-owned-av-vp9-gap-reorder-full-udp-20261004.log` exits 1 before
baseline timing: `VIDEO_PACKET`, no decoded video. Native sender and receiver
metadata both identify **video/VP9**, while the worker receives no matching codec
entry. The private receiver attachment still filters its native codec parameters
to Opus/RED/VP8. This omitted VP9 from the worker before its exact payload-MIME
validation; it does not establish a codec capability or timing failure.

Both reserved-legacy and standard attachment paths now allowlist native VP9
codec parameters as payloadType plus normalized MIME only, excluding fmtp and
arbitrary fields. The decoder still rejects any mismatch with the artifact's
declared codec. The suite before this admission fix passes **145/145** in
`/tmp/ktv-owned-vp9-declared-codec-state-fixtures-20261004.log`; the added native
codec-admission fixture verifies both API paths and secret-field exclusion. A
corrected full run will follow fixture verification.


The corrected codec-admission suite passes **146/146** in
`/tmp/ktv-owned-vp9-codec-admission-fixtures-20261004.log`. The full corrected
native run is in progress at
`/tmp/ktv-owned-av-vp9-admitted-gap-reorder-full-udp-20261004.log`.


### Declared VP9 first output fails the native frame contract — 2026-10-04

`/tmp/ktv-owned-av-vp9-admitted-gap-reorder-full-udp-20261004.log` exits 1
before timing, with a configured VP9 decoder and `VIDEO_OUTPUT` on its first
output. No frame is transferred or presented. This differs from the corrected
codec-parameter omission. The exact timestamp association, dimensions, known
format and allocation ceiling remain strict. A single bounded output-shape
diagnostic is added to distinguish these contract failures without recording
image bytes. VP9 timing and cadence remain untested on the owned path.


### Native codec padding normalized inside the existing reservation — 2026-10-04

`/tmp/ktv-owned-av-vp9-output-shape-native-20261004.log` exits 1 before timing
and identifies the first output precisely: associated timestamp, I420, coded
**1344×720**, displayed **1280×720**, visible-plane allocation **1,382,400
bytes**. Chrome's coded-width padding triggers the strict 1280 coded-width
check; the visible image and nominal presentation resolution match the profile.

The private decoder now copies an exact 1280×720 native visible rectangle into
a nominal native VideoFrame, preserving pixel format, timestamp and color space.
There is no image scaling. It accepts at most 64 pixels of coded padding per
dimension, with the exact visible/display size and existing I420/NV12 byte
ceiling. The original closes before constructing the replacement. One decoded
frame remains owned per pending slot; padded YUV plus its temporary visible copy
fit inside the existing full-RGBA slot reservation. No queue, aggregate frame
count or 64-MiB payload ceiling grows. Stop closes originals during async copies
and completed copies cannot transfer or construct replacement frames afterward.

Fixtures pass **148/148** in
`/tmp/ktv-owned-video-padding-normalization-fixtures-20261004.log`, including
exact nominal transfer and four pending copies closed once without resurrection.
The full VP9 UDP/recovery/handover run is in progress at
`/tmp/ktv-owned-av-vp9-normalized-gap-reorder-full-udp-20261004.log`. Actual
VP9 output/cadence/timing and all release requirements remain open.


### Normalized VP9 runs, but impaired timing/cadence still fail — 2026-10-04

`/tmp/ktv-owned-av-vp9-normalized-gap-reorder-full-udp-20261004.log` exits 1.
All 1905 decoded outputs normalize successfully, with maximum visible copy
**1,382,400 bytes**, at most four pending/ready outputs and 20 held packets.
Both decoders remain live. Baseline source/native/owned/presented rates are
**25.10/24.91/25.12/24.46 fps**, with maximum skew **77.40 ms**. Impaired
rates are **17.46/12.18/16.05/11.81 fps**; the required 40 matched transitions
time out. Three native requests fulfill, with five new encoded/decoded keys.
Release lateness averages **80.74 ms**, reaches **1528.68 ms**, and exceeds
250 ms on 105 releases. Codec normalization is proven on actual output;
VP9 is not accepted for timing or cadence and is not selected for production.

VP9 observations expose native spatial/temporal indices. A bounded dependency
capability counter is added next: presence of a valid frame ID and an optional
0–8 dependency count, without retaining IDs or reference arrays. This checks
whether native dependency declarations can distinguish missing required
references from omitted higher temporal layers before any ordering change.
No dependency-based decode or feedback policy is enabled yet.


Dependency capability fixtures pass **149/149** in
`/tmp/ktv-video-dependency-capability-fixtures-20261004.log`; focused observer
forwarding checks also pass. Both worker and page retain only a 0/1 frame-ID
presence flag and a validated 0–8 dependency count. Raw reference IDs are
excluded. A native VP9 run is collecting these capabilities at
`/tmp/ktv-owned-av-vp9-reference-capability-full-udp-20261004.log` without any
dependency-based policy change.


### Native reference declarations verified; explicit dependency ordering — 2026-10-04

`/tmp/ktv-owned-av-vp9-reference-capability-full-udp-20261004.log` exits 1
for timing/cadence. Baseline source/native rates are **25.03/24.77 fps**;
impaired source/native rates are **19.77/14.72 fps**, and owned presentation
fails. All 37 sampled received VP9 packets expose a valid frame ID: one
independent header and 36 headers with one declared reference. This supports
a dependency-specific ordering experiment; it is not full timing acceptance.

The explicit private `KTV_ROOM_TEST_VIDEO_REORDER=dependency` mode requires
the marked nominal VP9 artifact and native standard-receiver keyframe recovery.
It decodes across RTP gaps when declared references have already been submitted
to the same decoder. Required references wait inside the original fixed 700-ms
arrival deadline and encoded bounds. A missing required reference at deadline
is discarded without decoding its payload, increments a reference-miss counter
and can request bounded native recovery. Unique late higher-layer frames alone
do not trigger global keyframes in this mode. Absent/malformed declarations
close permanently, avoiding timing-based dependency guesses.

Submitted reference IDs are bounded to 256 recent IDs plus the current key,
cleared at keyframes and stop. Reference metadata does not create output
authority or alter RTC payloads. The original RTP/capture-clock checks, strict
nominal output, 40 decoded-frame/64-MiB payload reservation and all timing/cadence
gates remain intact. Fixtures pass **153/153** in
`/tmp/ktv-video-required-reference-recovery-fixtures-20261004.log`, covering
independent gap traversal, required-reference repair, fixed missing-reference
expiry, unsupported declarations and feedback only for missing references.
A full native run is in progress at
`/tmp/ktv-owned-av-vp9-required-references-full-udp-20261004.log`.


### Presentation credit pressure after declared-reference decode — 2026-10-04

`/tmp/ktv-owned-av-vp9-required-references-full-udp-20261004.log` exits 1
before completing the six-pair baseline: the presentation queue reaches its
unchanged bound and closes with `PLAYOUT_QUEUE_BOUND`. The source/native
receiver retain **24.98/24.72 fps**. All 389 copied/decoded packets expose
usable declarations; there are no missing references, late or reordered frames.
This demonstrates reference-mode startup decoding but not baseline timing or
impaired acceptance.

The owned-video reader now waits for presentation space while retaining the
existing transfer credit for its borrowed frame. One pending producer propagates
pressure through the two-flight adapter and four pending decoder slots; the
presentation queue stays **32 frames / 42.5 MiB**, with the same 40-frame /
64-MiB payload reservation. Byte pressure also waits. Rendering or startup
discard returns space; close resolves a waiting producer without admission,
and the adapter releases its borrowed frame. Capture age is checked again
after waiting. A second pending producer and invalid byte reservation are
rejected. Native receive payloads and output permission remain unchanged.

Fixtures pass **154/154** in
`/tmp/ktv-video-presentation-credit-backpressure-fixtures-20261004.log`, covering
frame/byte pressure, exact release and stop without resurrection. The integrated
reference-mode rerun is in progress at
`/tmp/ktv-owned-av-vp9-reference-presentation-backpressure-full-udp-20261004.log`.
Updated buffered-expiry regression checks are required after this reader change.


### Reference ordering with presentation pressure: clean baseline, impaired failure — 2026-10-04

`/tmp/ktv-owned-av-vp9-reference-presentation-backpressure-full-udp-20261004.log`
exits 1. The six-pair baseline completes with maximum skew **73.14 ms**,
source/native/owned/presented rates **24.96/24.86/25.00/24.61 fps**. Impaired
rates fall to **13.86/8.92/8.34/8.40 fps** and the required 40 matched
transitions time out. Both owned decoders remain active. Eleven phase requests
fulfill, with 17 new decoded and 21 encoded keys. The stream reports 298 missing
declared references, 49 unique late frames and 115 reordered frames. Release
lateness averages **14.84 ms** but reaches **1112.04 ms**, with four releases
above 250 ms. Maximum presentation occupancy is 25; this particular run never
requires presentation backpressure, so its native pressure behavior remains
unproven despite passing bounded fixtures. Source allocation/cadence and complete
impaired timing remain open.

Updated both-context expiry is being checked on the nominal production VP8
artifact after the asynchronous reader change, followed by source-task expiry.
The previously accepted 51/51 and 46/46 results predate that change. Neither VP9
nor dependency ordering is selected for product integration or deployment.


### Presentation-reader expiry regressions and silent timestamp revalidation — 2026-10-04

The updated reader has not yet passed both native expiry regressions.
`/tmp/ktv-owned-av-presentation-backpressure-both-context-expiry-20261004.log`
exits 1 after 31 checks. It observes **824.37 ms** of future owned PCM,
47 chunks / 360,960 bytes, old-output silence and 16 audible replacement
heartbeats. Its independent monitor reports **200.121 ms** of queued capture
at the replacement boundary, exceeding the unchanged **100 ms** measurement
bound. These observations do not establish accepted expiry timing.

`/tmp/ktv-owned-av-presentation-backpressure-source-task-expiry-20261004.log`
exits 1 after 12 checks, before the source fault. The native output timestamp is
**20.8 ms ahead** of observation, outside the existing 20-ms allowance. The
owned PCM adapter closes with `PLAYOUT_PCM_OUTPUT_AGE`; this run provides no
source-task expiry result.

The private adapter now mutes output and returns no capture cursor while an
invalid native timestamp is rechecked. A valid observation within **50 ms** can
restore output only after all original freshness, phase and cursor checks pass.
Invalid observations continuing for 50 ms, or a healthy observation arriving
later, permanently close the adapter. Age (-20 to 200 ms), latency (0 to 200 ms),
capture freshness and cursor bounds remain unchanged. The adapter creates no
output permission; the existing final deadline guard remains authoritative.
Fixtures verify immediate silence/no cursor, bounded recovery, terminal failure
and inability to revive after timeout. Native expiry and audible continuity
remain required before selecting this behavior for product integration.

The original 720p / 20–30-fps release requirement remains in force. A user
preference question about adaptive video cadence is pending; no requirement has
been changed on the basis of elapsed time.


### Silent-revalidation candidate passes both-context expiry — 2026-10-04

`/tmp/ktv-owned-av-output-revalidation-both-context-expiry-20261004.log`
exits 0 with **51/51** native built-app checks. At the fault boundary the owned
PCM renderer retains **817.5 ms** of future samples, 45 chunks / 345,600 bytes,
with 68.5-ms report age deducted. Both render contexts freeze and resume while
page callbacks remain blocked. Old output stays silent, 15 replacement
heartbeats remain audible (minimum RMS **0.07724**), and unchanged expiry,
separation and resource checks pass. Independent monitor queues at the old/new
edges are **-0.353 ms / 1.051 ms**, inside the 100-ms bound. This validates the
latest reader/revalidation combination for this digital fault; it does not
prove physical timing, impaired A/V acceptance or audible revalidation quality.
Source-task expiry is being checked separately.


### Silent-revalidation candidate passes source-task expiry — 2026-10-04

`/tmp/ktv-owned-av-output-revalidation-source-task-expiry-20261004.log`
exits 0 with **46/46** native built-app checks. Before the blocked source/page
fault the owned renderer retains **855.63 ms** of future PCM, 44 chunks /
337,920 bytes, with 12.70-ms report age deducted. Expired output remains silent;
13 replacement heartbeats remain audible (minimum RMS **0.07828**).
Independent capture queues are **0.127 ms / 1.436 ms**. The unchanged 150-ms
expiry margin, configured old/new separation and exact-old-session resource
classification pass. Together with the preceding 51/51 run, this closes the
updated asynchronous reader's two digital buffered-expiry regression checks.
It does not establish impaired A/V timing, physical/device acceptance or
click-free audible timestamp revalidation. A fresh 40-pair clean A/V regression
is being checked before committing this private adapter change.


The final timestamp-revalidation fixture run passes **156/156** in
`/tmp/ktv-output-revalidation-final-fixtures-20261004.log`. Product source,
production dist, timing limits and public media configuration are unchanged.


### Updated reader/revalidation passes clean 40-pair A/V regression — 2026-10-04

`/tmp/ktv-owned-av-output-revalidation-clean-800-20261004.log` exits 0
with **50/50** native built-app checks on the nominal VP8 720p / 25-fps profile
and 800-ms owned PCM/video hold. All **40** transitions match, with zero
unmatched audio/video markers, absolute skew p95 **52.44 ms**, maximum
**54.11 ms**. Source/native/owned-decoded/drawn/presented rates are
**25.01/24.99/25.00/24.79/24.79 fps**, inside the original 20–30-fps bound.
Median observed audio/video delays are **962.27/930.20 ms**, so this result does
not establish minimum practical latency. Codec and presentation quality checks
report no errors. The original independent monitor and memory bounds pass.

Two additional negative fixtures verify that a valid output timestamp cannot
restore gain when capture phase is invalid or the observation clock reverses.
The completed fixture suite passes **158/158** in
`/tmp/ktv-output-revalidation-capture-safety-fixtures-20261004.log`.
These results close the fresh clean and digital expiry regressions for this
private change. Continuously impaired timing/cadence, actual revalidation
listening quality, product integration and the remaining physical/mobile/
capacity/release gates remain open. No deployed product asset changes.


### Bounded allocation evidence separates capture from encoding — 2026-10-04

The existing native capture diagnostic is extended with a separate allocation
summary in successful and failed A/V runs. It reports actual sent audio/video
rates, video target bitrate, the selected video transport's estimated outgoing
capacity and RTT, and the browser's enumerated quality-limitation counters.
It verifies a stable media path, monotonic byte counters, one matching selected
transport and all samples' estimates. Missing/ambiguous/reset evidence fails the
diagnostic. Output contains only fixed numeric summaries and enums; no candidate
IDs, track identifiers, SDP or arbitrary report properties. It creates no new
release exception or sender policy. Distinct audio/video peers are identified
rather than assuming a common allocation budget.

Reanalysis of the existing full failed UDP runs with the new helper gives:

| Private comparison | Actual captured fps | Encoded fps | Median video target kbps | Median estimated outgoing kbps | Actual video/audio kbps |
| --- | --- | --- | --- | --- | --- |
| VP9 declared references + presentation pressure | 24.99 | 13.86 | 30.00 | 53.65 | 45.52 / 130.80 |
| VP8 gap ordering + late-reference feedback | 25.00 | 7.10 | 59.00 | 126.88 | 54.62 / 130.75 |
| VP8 equal local video priority | 25.01 | 3.67 | 48.00 | 104.16 | 32.46 / 130.79 |

Each impaired phase has 86 samples over approximately 90 seconds, shares its
actual audio/video peer, and has median video-transport RTT **338–344 ms**.
All report the browser limitation enum `none`; this enum alone cannot explain
or clear the observed encoded-frame shortfall. Stable 25-fps capture and low
encoder targets are consistent with sender allocation pressure; these data do
not prove its cause. Browser bandwidth estimates are predictions, not measured
link-capacity limits. Independent random loss schedules prevent ranking the
comparisons by these numbers.

The new diagnostic validates all three retained native timelines without errors;
this is reanalysis, not a new native acceptance run. Fixtures pass **160/160** in
`/tmp/ktv-source-allocation-evidence-fixtures-20261004.log`, including unknown
estimates, ambiguous transport, path/counter resets, distinct audio peers and
private-field exclusion. Native runner syntax and `git diff --check` pass.
Public product assets and all release requirements remain unchanged.


### Private audio redundancy comparison prepared — 2026-10-04

A new marked-artifact option, `--audio-red off`, isolates the observed redundancy
cost. It changes only the exact publisher `red: true` option to `red: false`,
keeping primary Opus **64 kbps**, DTX disabled, 720p / 25-fps video, video ceiling
**350 kbps**, transport, keyframe policy, source leases and timing requirements.
The builder refuses changed/ambiguous production audio source or combinations
with another transport, bitrate or periodic-keyframe experiment. Default builds
retain RED. The comparison artifact remains excluded from static publication;
production source and every production dist byte are preserved by the builder.

The native comparison requires owned PCM/video and the existing nominal VP9
profile. Actual sent and received encoded-frame MIME must both prove Opus without
RED (at least eight observations in each direction), with the real sender's
single 64-kbps encoding verified initially and throughout measured phases.
Primary Opus RTP codec stats alone cannot prove absence of RED wrapping.
The recorded earlier native comparison observes `audio/red` in both directions.
Disabling redundancy can increase unrepaired audio gaps; audible quality, loss
recovery and full timing/cadence acceptance remain required. This is a private
comparison and does not change the selected production policy.

Fixtures pass **162/162** in
`/tmp/ktv-audio-red-comparison-fixtures-20261004.log`, covering exact source
transformation, unknown/missing/mixed MIME evidence, minimum observations,
private-field exclusion and bounded record count. The private artifact is being
built at `/tmp/ktv-codec-candidate-owned-vp9-red-off-20261004`; the next check is
the unchanged full UDP impairment / recovery / handover journey with 40 pairs.


### Removing audio redundancy does not close impaired timing — 2026-10-04

The marked build completes with production source and every dist byte preserved
(log `/tmp/ktv-owned-vp9-audio-red-off-private-build-20261004.log`).
`/tmp/ktv-owned-av-vp9-red-off-required-references-full-udp-20261004.log`
exits 1: the required 40 impaired pairs time out, before recovery/handover checks.
Actual initial sent/received frames prove Opus without RED (11/19 observations),
and the real 64-kbps sender cap passes. The six-pair baseline has maximum skew
**71.01 ms**, zero unmatched markers and nominal capture/encode/decode/presentation.

Across 86 impaired samples / 89.36 seconds, capture stays **25.01 fps**, encoding
falls to **11.95 fps**, native receiver decoding **7.66 fps**, owned decoding
**7.81 fps** and drawn/presented output **7.52 fps**. Actual sent audio falls to
**64.41 kbps**, confirming the intended overhead change, while video sends
**29.86 kbps**. Median video target / browser estimated outgoing capacity remain
**30.00 / 44.71 kbps**; median RTT is **337 ms**. The browser still reports `none`
for its video quality limitation. Eleven recovery requests fulfill, producing
14 new decoded and 18 encoded keys during impairment. Both owned decoders stay
active within their existing reservations. Release lateness averages **35.73 ms**,
reaches **1372.20 ms**, and exceeds 250 ms on 40 releases. No presentation-pressure
wait is exercised (maximum queue 23), so native pressure remains unproven.

The audio decoder reports **407,040 missing sample frames (8.48 seconds at
48 kHz)** over its full observed session, with **zero RED recoveries**. This is
counter evidence of unrepaired gaps, not a physical listening-quality score.
Removing RED has not produced an acceptable cadence/timing result and is not
selected for production. Different random loss schedules do not establish
relative superiority or an isolated causal explanation for the remaining
bandwidth collapse. The selected RED policy, all release requirements and
public media state are unchanged.


### Private bounded native video minimum prepared — 2026-10-04

After the RED-off comparison fails, the next isolated variable is a fixed
**250-kbps minimum** codec bitrate, keeping the selected RED policy and the
existing **350-kbps video ceiling**. The purpose is to test the observed
encoder-target collapse on the fixed delay/jitter/random-loss fixture; it is
not proof of available link capacity or a selected general-network policy.
WebRTC's [native bitrate parser](https://webrtc.googlesource.com/src/+/refs/heads/main/media/engine/webrtc_media_engine.cc)
converts codec minimum parameters from kbps, while its
[video send channel](https://webrtc.googlesource.com/src/+/refs/heads/main/media/engine/webrtc_video_engine.cc)
can feed codec constraints into call allocation. Browser/version support and
actual behavior still require native evidence.

`KTV_ROOM_TEST_VIDEO_MIN_BITRATE=250000` requires the existing marked nominal
VP9/RED build, owned PCM/video, native feedback and default source keyframes.
It cannot combine with RED-off, local-priority, cadence, alternate transport,
bitrate-cap or periodic-keyframe comparisons. The fixture rewrites only actual
publisher answers, normalizing shared VP9 codec parameters in video sections;
audio, media payload types, codec profiles, feedback, authorization and timing
remain unchanged. Actual native answer readback must retain the parameter;
missing/conflicting declarations, ignored application and native rejection fail
the experiment. Listener answers remain untouched. The wrapper restores its
original method on close and never reports raw SDP. Native retention is not
itself evidence that the desired allocation or cadence occurs.

Fixtures pass **166/166** in
`/tmp/ktv-video-floor-recorded-native-policy-fixtures-20261004.log`, covering
both line endings, shared codec normalization, unchanged audio/feedback, absent
fmtp, conflicts, codec/SDP bounds, listener scoping, ignored/rejected application,
terminal failure and closure during an outstanding native call. Native runner
syntax and `git diff --check` pass. The unchanged full 40-pair UDP journey is
running in `/tmp/ktv-owned-av-vp9-250k-floor-required-references-full-udp-20261004.log`.
No new frontend artifact is built or deployed for this injected private test.


### Native floor restores sender cadence; receiver recovery still fails — 2026-10-04

`/tmp/ktv-owned-av-vp9-250k-floor-required-references-full-udp-20261004.log`
exits 1: the 40 impaired pairs time out before recovery/handover acceptance.
Native answer retention passes and remains verified in every sampled phase.
The six-pair baseline has maximum skew **62.00 ms**, zero unmatched audio and
one unmatched video marker, within the original allowances.

Across 85 impaired samples / 89.59 seconds, capture / encoding stay
**24.99 / 24.86 fps**, meeting the source-cadence requirement. Estimated outgoing
capacity is bounded below at the requested **250 kbps**, median **517.46 kbps**;
video target minimum / median / maximum are **132.52 / 333.86 / 350 kbps**.
Actual sent video / audio are **146.93 / 130.78 kbps**; primary Opus/RED and the
350-kbps video cap remain intact. Median RTT is **338 ms**. This is actual native
evidence that the floor affects the sender budget/cadence in this run, while
its exact behavior across real bandwidth limits and other browsers is unproven.

Native receiver decoding is **16.92 fps**, owned decoding **16.44 fps** and
drawn/presented output **15.80 fps**, all below the required nominal receiver
cadence. Thirteen native recovery requests fulfill, with 20 new decoded and
22 encoded keys during impairment. Complete matching and timing remain
unaccepted. The floor is not selected for product integration or deployment.
The next isolated comparison retains this sender budget and shortens the existing
bounded receiver recovery cooldown from 5 seconds to **2.5 seconds**; all source
settings and release criteria remain fixed.


### Shorter recovery with the retained native floor still fails — 2026-10-04

`/tmp/ktv-owned-av-vp9-250k-floor-recovery2500-full-udp-20261004.log`
exits 1: the unchanged 40 impaired matches time out. Native video retains the
250-kbps floor throughout; source encoding remains **24.68 fps**. Over 86
impaired samples / 89.65 seconds, video target median is **282.04 kbps**, estimated
outgoing capacity minimum / median **250 / 402.78 kbps**, and actual sent video /
audio **154.12 / 130.82 kbps**. Recovery requests increase to **23**, all fulfilled,
with **29** new decoded and **35** encoded keys, but native receiver / owned
receiver / presented cadence remain **16.11 / 16.23 / 16.06 fps**. Full A/V,
receiver nominal cadence and post-outage/handover acceptance remain unproved.
This run does not establish that a shorter cooldown solves recovery. Default
production recovery and media policy remain unchanged. The next investigation
checks SFU forwarding/allocation and received dependencies rather than choosing
another cooldown without evidence.

### Passive SFU allocation evidence — 2026-10-04

Added private `KTV_ROOM_TEST_SFU_ALLOCATION_EVIDENCE=1` to the existing nominal
VP9/floor comparison. It enables unsampled subscriber debug JSON in the pinned
SFU without changing allocation, codecs, media profiles, impairment or release
criteria. Each measured phase binds to its exact active audience identity and
the current publisher's single video track. Raw logs stay in the private,
bounded fixture container; parsing occurs after timing stops, before container
removal. The collector accepts at most 16 MiB, 64 KiB per line, 1,024 allocation
changes and eight non-overlapping phase windows. It emits only fixed phase,
layer, pause and reason enums, numeric bandwidth ranges and state durations.
Unknown schema, missing initial state, reversed timestamps, ambiguous scope
and bounds/read failures remain explicit diagnostic failures; no identity,
room, track, raw log or arbitrary server field is returned. The private native
video-floor hook now explicitly restores its original method during cleanup.

The allocation schema and subscriber component come from pinned LiveKit
v1.13.7 source, including its `BandwidthRquested` log key. **169/169** timing /
capability fixtures pass in `/tmp/ktv-sfu-allocation-fixtures-20261004.log`;
runner syntax and whitespace checks pass. The original full UDP journey,
including its five-second recovery interval, is running in
`/tmp/ktv-owned-av-vp9-floor250-sfu-allocation-full-udp-20261004.log`.
This is observability work; it does not establish SFU throttling or resolve
the remaining receiver cadence, recovery and release gates.

### Native SFU evidence excludes layer reduction in this run — 2026-10-04

`/tmp/ktv-owned-av-vp9-floor250-sfu-allocation-full-udp-20261004.log`
exits 1 after the unchanged 40 impaired pairs time out. The passive collector
accepts actual pinned-server JSON with **zero diagnostic errors** and exact
listener/video scope. Across the **11.835-second baseline** and **90.092-second
impaired phase**, the SFU target stays at spatial **0**, temporal **2**:
no allocation changes, deficiency, inactive target or bandwidth pause occur.
The logged maximum temporal layer is 3; this is an allocation ceiling, not a
claim that the actual `L1T3` source emits four layers. Logged requested/needed
bandwidth remains the initial allocation record (**19,759 bps**); those fields
are not continuously measured sender throughput or available bandwidth.

Capture / encoding remain **25.00 / 24.94 fps**, while native receiver decoding
is **14.36 fps**, owned decoding **14.02 fps** and presentation **13.93 fps**.
The original 350-kbps video cap, source dimensions, Opus/RED, impairment, native
five-second recovery policy and timing criteria remain intact. Fourteen recovery
requests fulfill, with 21 new decoded and 27 encoded keys; full matching still
fails. This excludes a logged SFU target-layer reduction as the cause in this
run. It does not prove successful forwarding or identify the packet/reference
repair failure yet. Receiver repair and reordering remain the next investigation;
no SFU minimum-channel-capacity override is justified by this evidence.
The candidate is not selected for deployment. Fixture resources and the scoped
local ICE guard are cleaned up after the failed journey.

### Isolated continuous-RTX SFU comparison — 2026-10-04

Pinned LiveKit v1.13.7 source shows downstream PLI handling sets
`isNACKThrottled` until a keyframe is forwarded; `retransmitPackets` returns
early while that flag is set because `FlagStopRTXOnPLI` is true. A private
comparison changes only that constant to false, keeping native retransmission
available while keyframe recovery is pending. This is a hypothesis about repair
availability, not evidence that it restores receiver cadence. Packet caches,
request queues, layer selection, pacing, codecs, authorization and source caps
remain unchanged.

The builder downloads immutable upstream commit
`8d11efdfcd4220092b6ac7b8a21af28526da5a6b`, verifies the original downtrack file
SHA-256 and the upstream pinned Go image, then builds on the existing pinned
SFU runtime image. It records the resulting immutable image ID, binary hash,
archive hash and comparison policy in a private marker. The runner rejects a
mutable/mismatched image, marker or binary and requires the original full UDP
VP9/RED/floor journey, passive allocation evidence, dependency reordering,
continuous impairment/handover and five-second receiver recovery. There is no
production image or media-policy override. The build's focused upstream SFU
RTX/NACK/retransmission tests and server binary build pass in
`/tmp/ktv-sfu-rtx-continue-build-20261004.log`. The verified private image is
`sha256:b6e2f4febf41a8e6976fa2237fb1ccf4f408ec2d9e477a0a613f5ec5f20864fd`,
with binary SHA-256
`7a681205c45eb422688bf0ade4b1be7d31b2dec3beba9ed848bec0f3e04aca73`.
The build is stored at `/tmp/ktv-sfu-rtx-continue-build-20261004`; no production
artifact is replaced. **171/171** timing/capability fixtures pass in
`/tmp/ktv-sfu-rtx-continue-fixtures-20261004.log`, including rejection of unpinned
source, unexpected policy, toolchain/runtime changes, mutable images and marker
mismatches. Runner/builder syntax and whitespace checks pass. The original full
UDP journey is running in
`/tmp/ktv-owned-av-vp9-floor250-sfu-continue-rtx-full-udp-20261004.log`;
native results remain pending.

### Continuous-RTX first native run stops at clean marker accounting — 2026-10-04

`/tmp/ktv-owned-av-vp9-floor250-sfu-continue-rtx-full-udp-20261004.log`
exits 1 before impairment: six baseline pairs match, but two unmatched video
edges exceed the unchanged allowance of one. Source / native receiver / owned
receiver / presentation remain **24.95 / 24.99 / 25.00 / 24.15 fps**; the matched
baseline skew maximum is **45.06 ms**. SFU allocation evidence is valid and stays
at target temporal 2 throughout the 11.419-second baseline.

The presented pixel marker briefly goes backward while presentation counters,
media timestamps and source marker hook identities remain monotonic. Two extra
video edges occur 66.7 ms apart around a marker transition; those hook records do
not show the reversal. Actual captured pixels were not yet sampled. This is not an impaired-network recovery result and is not excused
by matching only the six aligned edges. Whether the reversal originates in
decoding, frame copying, presentation or pixel observation remains unproved.
One identical full-journey replication is used to check reproducibility and reach
the impairment comparison if its original baseline gates pass. The first failure
remains recorded; no cadence, matching window or unmatched-edge gate is relaxed.

### Continuous-RTX replication exposes PCM reorder admission overflow — 2026-10-04

`/tmp/ktv-owned-av-vp9-floor250-sfu-continue-rtx-full-udp-repeat2-20261004.log`
exits 1 after the original impaired matching window times out. Its six-pair
baseline has no unmatched edges and maximum skew **46.46 ms**. Across 85 impaired
samples / 89.13 seconds, source encoding is **24.99 fps**, native decoding
**18.86 fps**, still below the required 20 fps. Independent random loss schedules
prevent attributing a numerical improvement over earlier runs to the SFU change.
SFU target temporal 2 remains unchanged throughout the valid 90.007-second
allocation window, with no deficiency or bandwidth pause.

The owned PCM decoder closes at `PCM_BOUND` before the first impaired sample,
followed by controller `PLAYOUT_AUDIO_CLOCK`. Evidence shows eight held reorder
packets, maximum **44** decoded PCM credits and **337,920** reserved PCM bytes:
the reorder packet admission limit, rather than exhausted 48-credit / 1-MiB PCM
capacity, is the concrete closure. The impaired native stream continues while
the controlled output is terminal; this does not establish owned repair quality.

The private PCM stream now resolves a full eight-packet reorder queue without
retaining a ninth packet: an incoming contiguous primary repairs it immediately;
otherwise, available decoded credits may commit only the oldest waiting gap
before its 80-ms deadline. `pressureDrains` records early gap commitments,
including RED history. Remaining gaps are still measured; no synthetic waveform
or authority is created. Renderer/decoder stalls, forged credits, invalid clocks,
encoded/PCM byte overflow and the 48-credit bound still fail closed. Tests cover
wraparound, a late contiguous repair, ordered RED recovery with actual missing
samples, late duplicates and terminal stalls. **174/174** fixtures pass in
`/tmp/ktv-sfu-rtx-pcm-pressure-fixtures-20261004.log`.

The full comparison with this fix,
`/tmp/ktv-owned-av-vp9-floor250-sfu-continue-rtx-pcm-pressure-full-udp-20261004.log`,
exits 1 at clean baseline marker accounting: six matched pairs, maximum skew
**48.31 ms**, zero unmatched audio but two unmatched video edges. All measured
cadence remains nominal; impairment is not reached. This second baseline anomaly
must be investigated, not bypassed by changing matching or release criteria.
New PCM admission has unit evidence but still lacks native impaired burst proof.
Its independent buffered-expiry regression is running in
`/tmp/ktv-owned-av-pcm-pressure-both-context-expiry-20261004.log` using the unchanged
production VP8 build and original SFU. No comparison is deployed.

### PCM pressure expiry proof and decoded-marker diagnostics — 2026-10-04

The first buffered-expiry regression passes independently measured silence,
replacement separation and actual context freeze/resume, then rejects an old
controller's `PLAYOUT_VIDEO_AGE` closure in final accounting. That controller
closes **20.76 seconds after** the captured expiry deadline, with zero queued
bytes and both PCM/video decoders closed. The existing strict classifier only
received a verified expiry certificate from the source-page-stall variant.
Frozen-context/page faults now return the same exact-session certificate after
all their existing silence, deadline, timing and replacement proofs pass. The
classifier, output permissions, deadlines, silence margins and negative checks
for early/current/unrelated closures remain intact.

`/tmp/ktv-owned-av-pcm-pressure-verified-both-context-expiry-20261004.log`
passes **51/51** actual built-app streaming checks on the production VP8 build
and original SFU with the new PCM admission logic. This closes that digital
buffered-expiry regression; native impaired burst handling remains unverified.

Added private `KTV_ROOM_TEST_DECODED_MARKER_PROBE=1` for nominal VP9 owned timing.
It reads a bounded 416-by-32 YUV region before frames enter presentation, counting
valid/invalid fixture markers, transitions and backward identities in actual
transfer order. Each read is limited to **32 KiB** and fits inside the existing
full-RGBA decoder reservation. The probe changes neither frame bytes, ordering,
admission nor output authority. Async reads retain the borrowed frame in terminal
cleanup; closure and transfer backpressure cannot leak frames or double-count
markers. Unsupported formats/geometry, oversized regions, invalid layouts and
invalid probe results fail explicitly. No raw pixels or marker IDs are returned
in diagnostics.

**178/178** timing/capability fixtures pass in
`/tmp/ktv-decoded-marker-pcm-pressure-fixtures-20261004.log`. The instrumented
original full UDP journey is running in
`/tmp/ktv-owned-av-vp9-sfu-continue-rtx-pcm-pressure-decoded-markers-full-udp-20261004.log`.
Its six-pair baseline passes the unchanged allowances with maximum skew
**72.19 ms**, zero unmatched audio and one unmatched video edge. This comparison
is intended to locate the recurrent pixel reversal and validate the PCM fix;
it is not a release qualification or deployment approval.


### Recorded decoder markers and the original PCM deadline — 2026-10-04

The first instrumented UDP run,
`/tmp/ktv-owned-av-vp9-sfu-continue-rtx-pcm-pressure-decoded-markers-full-udp-20261004.log`,
exits 1: source / native / owned / presentation cadence is **24.97 / 19.11 /
20.55 / 18.74 fps** during impairment and the original 40-pair window times out.
Both owned decoders remain alive, but the main diagnostic allowlist had dropped
worker marker counters and the new PCM `pressureDrains` count. It therefore gives
no evidence of decoded marker ordering or native pressure-path execution.

The observer now carries only the four bounded marker counters and PCM pressure
count. Invalid counter relationships fail explicitly; unknown properties remain
excluded. Separately, reordered earlier RTP packets no longer restart the PCM
80-ms wait: its deadline uses the earliest retained arrival, with a regression
for an earlier packet arriving midway through the wait. Packet/byte/credit caps,
clock checks and terminal output rules remain unchanged.

`/tmp/ktv-owned-av-vp9-rtx-pcm-deadline-recorded-markers-full-udp-20261004.log`
exits 1. Clean baseline passes its six-pair accounting (maximum skew **64.16 ms**,
zero unmatched edges), while the decoded probe records **260 reads, zero invalid
markers, 12 transitions and four backward identities** between its first and
last baseline samples. The pixel anomaly therefore exists before presentation;
this alone does not distinguish source capture from encoding/decoding. During
impairment, source / native / owned / presentation cadence is **24.86 / 16.62 /
16.41 / 16.04 fps**, below the original requirement. Both owned decoders remain
alive; measured missing PCM is 34,560 samples (0.72 seconds), and `pressureDrains`
is zero. The new pressure branch still has no native execution proof.

Added a private publisher probe that clones the exact existing video track,
reads one frame at a time with processor buffer size one, and samples the same
bounded marker region. Actual YUV/RGB allocation is recorded with a **64-KiB**
ceiling; original tracks are never stopped, altered or republished. Closing during
a copy cannot emit late diagnostics or leak a frame. Only aggregate counts and
fixed error codes are exposed. Five tests cover actual pixel order, exact-track
reuse/replacement, close during copy, allocation accounting and constructor
failure cleanup. **185/185** fixtures pass in
`/tmp/ktv-source-decoded-marker-pcm-deadline-fixtures-20261004.log`.
The unchanged full UDP journey with both probes is running in
`/tmp/ktv-owned-av-vp9-source-decoded-markers-pcm-deadline-full-udp-20261004.log`.
No failed private candidate is deployed, and no timing/cadence gate is relaxed.


### Capture stays ordered; native-versus-owned decoding comparison — 2026-10-04

`/tmp/ktv-owned-av-vp9-source-decoded-markers-pcm-deadline-full-udp-20261004.log`
exits 1 at the unchanged impaired 40-pair timeout. Across the clean baseline,
actual source pixels have **264 additional reads, zero invalid markers and zero
backward identities**. The owned decoder has **262 additional reads, zero new
invalid markers and two backward identities**. Source / native cadence is
**24.99 / 24.91 fps** before impairment. This localizes the clean anomaly after
capture and before presentation; encoding, transport, decoding and normalized
copying have not yet been distinguished.

During impairment, source / native cadence is **24.91 / 17.29 fps**, below the
required native range. The publisher probe still records zero backward identities;
owned decoded counters reach 61 backward identities. Both owned decoders stay
alive; PCM missing samples total **39,360** (0.82 seconds), maximum held packets
is six and `pressureDrains` remains zero. Native pressure handling is still not
exercised. Independent random loss prevents a causal numerical comparison.

The bounded read-only track probe now also supports the exact current native
received video track. Its separate clone and aggregate counters do not modify
or republish either original track. A sixth probe test verifies scope, reuse,
independent cleanup and rejection of unknown roles. **186/186** fixtures pass in
`/tmp/ktv-native-marker-probe-fixtures-20261004.log`. The unchanged full UDP journey
comparing captured, Chrome-native decoded and owned-decoded markers is running
in `/tmp/ktv-owned-av-vp9-source-native-owned-markers-full-udp-20261004.log`.
This comparison cannot qualify a release while the original timing/cadence gates
remain unmet.


The initial native-versus-owned comparison stops before baseline measurement with
`SOURCE_MARKER_TRACK`: LiveKit retains an unused live video receiver as well as
the subscribed receiver, so selecting all live receivers is not exact enough.
It produces no native pixel-order evidence. The diagnostic now requires the one
native video track attached to the current room screen and its exact receiver
object; a test includes an additional unused receiver. **186/186** fixtures pass
in `/tmp/ktv-exact-native-marker-probe-fixtures-20261004.log`. The corrected
comparison is running in
`/tmp/ktv-owned-av-vp9-exact-source-native-owned-markers-full-udp-20261004.log`.


### Both native and owned decoders reproduce the pixel reversal — 2026-10-04

The corrected exact-track comparison,
`/tmp/ktv-owned-av-vp9-exact-source-native-owned-markers-full-udp-20261004.log`,
exits 1 at impaired unmatched-edge accounting. Actual captured pixels have zero
backward identities in both phases; Chrome-native and owned decoding each record
two during the clean baseline. This excludes the presentation observer and an
owned-decoder-only failure as sole explanations. Encoder, forwarding or shared
decoding behavior still need isolation; this is not proof of a particular bug.
All three probes remain live with bounded copies (source **53,248** bytes,
native **19,968** bytes).

The run reaches 40 impaired matched pairs but also has **69 unmatched video and
four unmatched audio edges**, exceeding the original allowance of one per kind.
Matched p95 / maximum skew is **496.33 / 728.31 ms**, above **150 / 250 ms**.
Source / native cadence is **24.74 / 18.50 fps**, with native cadence below 20.
Final native / owned backward marker counts are **47 / 46**; source stays zero.
PCM remains alive with **28,800** measured missing samples (0.60 seconds), maximum
seven held packets and no early pressure drain. This remains a failed run.

Added a private, native-API `KTV_ROOM_TEST_SOURCE_TEMPORAL=L1T1` comparison against
the SDK's actual VP9 `L1T3` sender. It changes only temporal structure: content
hint stays `motion`, resolution stays 1280-by-720, requested cadence stays 25 fps,
max video remains 350 kbps, and audio RED, floor, impairment, ownership/expiry and
all acceptance gates remain intact. Native readback must retain the new structure
and the original caps on every sample. Changed source policies fail explicitly.
This tests a shared source/receive-path hypothesis; no result is assumed.
Capture/native probe snapshots now also fail on closed/error/missing/inconsistent
or oversized diagnostics instead of interpreting failed reads as ordered pixels.
**189/189** fixtures pass in
`/tmp/ktv-temporal-native-marker-fixtures-20261004.log`.
The full comparison is running in
`/tmp/ktv-owned-av-vp9-l1t1-source-native-owned-markers-full-udp-20261004.log`.


### Single temporal layer separates native recovery from owned admission — 2026-10-04

`/tmp/ktv-owned-av-vp9-l1t1-source-native-owned-markers-full-udp-20261004.log`
exits 1 at the original impaired 40-pair timeout. Native readback retains `L1T1`,
25-fps / 350-kbps caps and `motion`. Clean baseline has six pairs, no unmatched
edges, maximum skew **20.09 ms** and nominal rates. Captured, native and owned
probes all report **zero backward identities throughout this run**, including
impairment. This comparison supports temporal structure as a candidate for the
shared reversal; independent random loss and a single run do not establish a
causal reliability improvement or release qualification.

During impairment, source / native rates are **24.88 / 23.99 fps** and satisfy
those original cadence gates. Owned decode / presentation still fail at
**16.24 / 15.89 fps**. The owned decoder records **715 missing-reference
rejections**, 25 pressure drains, 17 late frames and 20 keyframes decoded; all
remain within existing count/byte bounds. Its maximum observed frame arrival age
is **1,434 ms**, and 214 frames arrive after the 800-ms target. Native and owned
outputs are therefore not yet equivalent in recovery or cadence. Measured PCM
missing samples total **48,960** (1.02 seconds); PCM stays alive and early pressure
handling remains unexercised. No input-dependency, clock, timing or frame-rate
criterion is relaxed.

A fresh production-VP8/original-SFU buffered-expiry regression after the PCM
first-arrival deadline fix is running in
`/tmp/ktv-owned-av-pcm-first-arrival-deadline-both-context-expiry-20261004.log`.
The temporal experiment remains private; deployed preview and public media state
remain unchanged.


The fresh production-VP8/original-SFU buffered-expiry regression,
`/tmp/ktv-owned-av-pcm-first-arrival-deadline-both-context-expiry-20261004.log`,
passes **51/51** native streaming checks after the PCM first-arrival deadline
change. Independent output silence, actual freeze/resume and replacement
separation still pass. This establishes a digital expiry regression, not physical
mobile or impaired timing acceptance.

The next private `L1T1` comparison changes only the already bounded native
receiver request cooldown from **5,000 to 2,500 ms**, motivated by 715 observed
missing-reference rejections while native decoding remains nominal. Every decode
still requires its declared references; no damaged input is accepted and output
leases/caps, 800-ms target and original timing/cadence gates remain intact.
This interval was already supported and negatively tested by the worker; the
SFU experiment selector now permits it only with the nominal `L1T1` marker-probed
comparison. It does not change the default interval or deployed product.
The full UDP journey is running in
`/tmp/ktv-owned-av-vp9-l1t1-recovery2500-source-native-owned-full-udp-20261004.log`.


The first 2,500-ms comparison exits 1 before A/V marker observation:
`/tmp/ktv-owned-av-vp9-l1t1-recovery2500-source-native-owned-full-udp-20261004.log`.
PCM reaches its unchanged **48-credit** bound plus **eight held packets**, with
368,640 reserved PCM bytes and nine backpressure events, then closes `PCM_BOUND`;
controller closure is `PLAYOUT_AUDIO_CLOCK`. No keyframe request occurs, so this
is not evidence for or against the faster recovery policy. The safety closure
and startup failure remain recorded. One identical replication is used to reach
the original comparison if startup passes; limits are not increased and failure
is not converted into success. It is running in
`/tmp/ktv-owned-av-vp9-l1t1-recovery2500-source-native-owned-repeat2-full-udp-20261004.log`.


### Faster native recovery remains below owned cadence — 2026-10-04

The identical replication,
`/tmp/ktv-owned-av-vp9-l1t1-recovery2500-source-native-owned-repeat2-full-udp-20261004.log`,
passes clean baseline (six pairs, no unmatched edges, maximum **17.42 ms**) and
exits 1 at the original impaired 40-pair timeout. Captured, native and owned
markers remain ordered throughout. Actual worker readback retains 2,500 ms; ten
native requests are fulfilled. During impairment, source / native / owned decode /
presentation rates are **24.77 / 23.40 / 19.21 / 18.94 fps**. Owned rates still
fail the required 20-fps minimum, despite 21 decoded keyframes. Native impairment
is independently randomized, so numerical differences are not causal proof.

The decoder records **382 missing-reference rejections**, ten late frames and
zero pressure drains. Measured PCM missing samples total **43,200** (0.90 seconds);
PCM stays alive, with maximum five held packets and zero PCM pressure drains.
No missing-reference input is submitted for decoding. Matching, skew, cadence,
buffer bounds and lease/clock gates remain unchanged; this candidate is not
released. Recovery scheduling and actual audio loss concealment remain open.

A fresh clean 40-pair regression of the latest PCM admission/deadline changes
using production VP8 and the original SFU is running in
`/tmp/ktv-owned-av-pcm-first-arrival-deadline-clean40-production-vp8-20261004.log`.


### Fresh clean regression exposes saturated PCM credits — 2026-10-04

`/tmp/ktv-owned-av-pcm-first-arrival-deadline-clean40-production-vp8-20261004.log`
exits 1 at the clean 40-pair timeout. Source / native video remains nominal at
**25.00 / 24.97 fps**, but PCM closes `PCM_BOUND` about **40.44 seconds** into
observation. It reaches the unchanged 48-credit / eight-held-packet limits with
368,640 PCM bytes and 3,982 backpressure events; the controller closes
`PLAYOUT_AUDIO_CLOCK`. The 48-credit cap is already saturated at the first
baseline sample, and the renderer reports roughly 44,900–45,400 buffered samples
(about 0.94 seconds), exceeding the requested 800-ms hold. Capture drift stays
within 20 ms. Whether context mapping, actual render cadence, delivery latency
or another source explains the residence is not established. Safety closure
remains terminal; no credit/byte/deadline cap is raised. The latest clean status
is now failed; earlier 50/50 evidence is historical.

Added bounded, read-only actual worklet `renderFrame` reports and PCM context /
wall anchor snapshots to distinguish the renderer quantum from main-thread
`AudioContext.currentTime`. These diagnostics change no frame, schedule, sample,
output permission or credit. Invalid/non-finite render reports fail explicitly,
unknown properties are excluded, and closed sessions cannot repopulate queues.
Tests cover stale reports versus advancing context frames and actual worklet
quantum reports. **190/190** fixtures pass in
`/tmp/ktv-pcm-actual-render-clock-fixtures-20261004.log`.

The clean production-VP8/original-SFU 40-pair journey with these read-only clocks
is running in
`/tmp/ktv-owned-av-pcm-actual-render-clock-clean40-production-vp8-20261004.log`.
No new production change is deployed and public online media remains disabled.


### Actual PCM context loses wall-clock progress — 2026-10-04

`/tmp/ktv-owned-av-pcm-actual-render-clock-clean40-production-vp8-20261004.log`
exits 1 at final unexpected-controller-closure accounting. Its 40 clean matched
pairs have **zero unmatched edges**, p95 / maximum skew **32.62 / 58.31 ms**,
source / native video **25.00 / 24.98 fps**, owned decode **25.01 fps** and
presentation **24.66 fps**. Those timing/cadence observations pass; the entire
journey does not. Old session 1 later closes at `PCM_BOUND` / `PLAYOUT_AUDIO_CLOCK`
with 6,856 backpressure events. The strict classifier still rejects that
unexpected closure despite later session 2 completing cleanup.

The readonly clocks expose a concrete scheduling problem: secondary 48-kHz PCM
context progress initially lags its wall anchor by about **19–21 ms**, then
**219–221 ms** at 21–32 seconds and about **262–274 ms** later. Worklet-reported
frames remain close to main-thread context frames after report age is accounted
for; this is not merely an old quantum report. Credits rise from 42 to 48 and
held packets from zero to six/seven while queued residence rises from about
802–821 ms to 928–950 ms. The fixed wall-to-render mapping therefore becomes
stale as the context loses progress. The underlying device/timer/load cause is
not yet proven. Capture offset stays within its existing bound. A release still
requires a clock solution or safe recovery within all unchanged output guards;
increasing retained samples would not close that requirement.

Latest state: **190/190 fixtures**, **51/51 digital buffered-expiry checks**, but
latest full clean and impaired streaming journeys fail. All private native jobs
are terminal. Public preview remains `acb583b`, media disabled; no private codec,
SFU or controlled-output experiment is deployed. The active implementation work
continues with the secondary PCM render clock, then impaired recovery, product
integration and the remaining physical/mobile/capacity/release gates.


### Private PCM hardware-clock comparison — 2026-10-04

Testing `KTV_ROOM_TEST_PCM_DEVICE_CLOCK=1` against the measured secondary-context
wall lag. The comparison connects a constant source with **exact offset zero**
to the secondary 48-kHz context's hardware destination before resume. The PCM
worklet has no connection to this destination or constant source; its captured
stream still enters the caller's original default-rate gain/deadline graph.
This tests device-clock scheduling without creating a performance-audio bypass.
It does not grant output permission, change the target, increase any buffer cap,
or alter clock/expiry/acceptance thresholds. Default behavior remains unchanged.

Clock-source startup failures and close during asynchronous module loading stop
and disconnect the private driver, keep output muted and cannot bind PCM late.
Graph tests verify that only the constant zero source reaches the secondary
hardware destination, original tracks/context remain intact, and cleanup is
idempotent. **192/192** fixtures pass in
`/tmp/ktv-pcm-device-clock-fixtures-20261004.log`.
The production-VP8/original-SFU 40-pair comparison is running in
`/tmp/ktv-owned-av-pcm-device-clock-clean40-production-vp8-20261004.log`.
Clock stability, full clean accounting and impaired acceptance remain unproved.


### Silent hardware sink does not resolve PCM saturation — 2026-10-04

`/tmp/ktv-owned-av-pcm-device-clock-clean40-production-vp8-20261004.log`
exits 1 at the original clean 40-pair timeout. Actual driver readback is enabled
and running, but PCM context lag is already about **137–148 ms** at baseline,
queued residence about **913–921 ms**, and PCM closes `PCM_BOUND` after roughly
41 seconds. Maximum credits / held packets remain **48 / eight**, with 32
backpressure events and capture offset below 15 ms. The controller closes
`PLAYOUT_AUDIO_CLOCK`; a running zero sink does not establish a stable enough
schedule. Source/native video remains nominal (**25.00 / 24.99 fps**) before
closure. The experiment stays optional/private, never the default. This failed
result is retained; it provides no expiry or release qualification for the driver.

The next comparison uses the already supported **500-ms** target with the
original production VP8 build, original SFU and default secondary clock (no
hardware driver). It tests lower latency and credit headroom without increasing
retention, changing source quality or relaxing any timing/cadence/clock/expiry
gate. A lower hold alone cannot establish sustained clock recovery or impaired
acceptance; those remain required. The clean 40-pair journey is running in
`/tmp/ktv-owned-av-pcm-target500-clock-clean40-production-vp8-20261004.log`.


### Lower target passes clean timing but exposes premature reference commitment — 2026-10-04

`/tmp/ktv-owned-av-pcm-target500-clock-clean40-production-vp8-20261004.log`
passes **50/50** production-VP8/original-SFU streaming checks. Forty matched pairs
have zero unmatched edges, p95 / maximum skew **75.58 / 92.95 ms**. Source / native /
owned decode / presentation rates are **25.00 / 24.98 / 24.99 / 24.80 fps**.
PCM context still loses up to **222.67 ms** against its original wall anchor;
lower residence keeps observed credits at most **37**, held packets zero and
queued samples at most **711.77 ms**. This establishes a lower-latency clean
operating point, not a sustained render-clock solution.

`/tmp/ktv-owned-av-vp9-l1t1-target500-recovery2500-full-udp-20261004.log`
exits 1 at the original impaired 40-pair timeout. Its six-pair baseline passes
with maximum **52.52 ms** and zero unmatched edges. Impaired source / native
rates are **24.95 / 20.62 fps**, while owned decode / presentation is only
**1.41 / 1.42 fps**. The decoder's hold-derived reorder wait shrank from 700 to
240 ms; it records **1,858 missing-reference rejections**, 242 late frames,
34 fulfilled recovery requests and 40 decoded keyframes. All observed marker
identities remain ordered. PCM stays alive within **27** maximum credits / six
held packets, with 41,280 measured missing samples (0.86 seconds). Lower PCM
residence has not closed video recovery or alignment.

The next private comparison independently retains the existing **700-ms**
decoder reorder bound at the **500-ms** output target. Explicit
`KTV_ROOM_TEST_VIDEO_REORDER_MS=700` is permitted only for the nominal,
marker-probed `L1T1`/floor/dependency profile; actual readback is required on every
sample. Existing 20-held-packet / 512-KiB input, four pending outputs,
32-frame/42.5-MiB presentation bounds and the 40-frame/64-MiB reservation remain
intact. No missing reference is submitted; delayed output still must pass the
original matching, skew, capture-to-presentation, clock and cadence gates.
This separates input repair from output residence rather than changing either
acceptance window. Longer recovery, expiry and physical acceptance remain open.


**192/192** fixtures pass after independently selecting the existing decoder
bound (`/tmp/ktv-independent-reorder-fixtures-20261004.log`). Full UDP comparison
parameters are preserved in owner-only
`/tmp/ktv-owned-l1t1-target500-reorder700-full-udp-20261004.env`.
The unchanged full timing/quality/handover journey is running in
`/tmp/ktv-owned-av-vp9-l1t1-target500-reorder700-full-udp-20261004.log`.


### Independent input repair reaches 40 pairs but timing and cadence still fail — 2026-10-04

`/tmp/ktv-owned-av-vp9-l1t1-target500-reorder700-full-udp-20261004.log`
exits 1 at the original impaired unmatched-edge gate. Actual decoder readback
retains 700 ms while the output target remains 500 ms. Six clean baseline pairs
have no unmatched edges and maximum skew **69.45 ms**. During impairment, 40
pairs match but **two unmatched audio edges** exceed the allowance of one;
one unmatched video edge is within its allowance. Matched p95 / maximum skew is
**591.25 / 745.89 ms**, above the unchanged **150 / 250 ms** gates.

Source / native / owned decode / presentation rates are **24.84 / 23.21 / 18.07 /
16.18 fps**. The owned decoder remains alive and bounded, but nominal owned
cadence still fails. It records **508 missing-reference rejections**, 15 late
frames, one pressure drain, 13 fulfilled requests, 24 decoded keys and maximum
20 held packets. Captured/native/owned markers remain ordered. PCM stays alive
within **33** maximum credits and six held packets, with 36,480 measured missing
samples (0.76 seconds). The secondary context still loses about **287.67 ms**
against its fixed wall anchor by the last impaired sample. Independent randomized
loss prevents attributing numerical improvements between runs to this one change.

Current evidence remains **192/192** fixtures and **50/50** clean streaming checks
at the 500-ms target, plus historical **51/51** buffered-expiry checks for the
latest PCM admission/deadline code. The full impaired/handover journey, sustained
clock recovery, missing-audio concealment and nominal owned video recovery remain
open. All native jobs from this update are terminal; public preview and media
policy are unchanged. No timing, unmatched-edge, source-quality, clock, output
permission or buffer-bound criterion is relaxed.


### Bounded two-packet PCM transfers — 2026-10-04

Added explicit private `KTV_ROOM_TEST_PCM_BATCH_PACKETS=2`. Two consecutive
48-kHz PCM outputs may transfer as one chunk, preserving all samples, channels,
first RTP/capture time and the original schedule. Individual members cannot be
credited before transfer; the combined chunk uses the final member's unique ID
and exact combined bytes. Default single-packet behavior is retained. Groups
never cross an unrepaired RTP gap, exceed the existing 5,760-frame renderer
packet limit, or wait beyond a 40-ms partial-group timer. Gaps remain measured;
no synthetic PCM or loss concealment is introduced.

The temporary combined copy is reserved before allocation, inside the existing
**1-MiB PCM** limit. Original plane references are cleared before releasing their
reservations; all pending decoder/group/transferred credits still share the
unchanged **48-credit** cap. Encoded input remains 512 KiB and reorder admission
eight packets / 80 ms. Close cancels group timers and cannot emit a late chunk.
A real decoder or renderer stall still closes at the original limits. Grouping
creates no output permission and changes no 800-ms target, capture/phase checks,
source-quality setting or expiry rule.

Tests verify exact sample concatenation across RTP wrap, partial flush/terminal
stop, silence across an actual gap, forged/duplicate credits, stalled decode and
rendering, transient-copy overflow, maximum packet duration, decoder configuration
and unchanged port expiry. The main observer carries only bounded scalar group
counters; impossible group/accounting diagnostics fail and payloads are excluded.
**202/202** fixtures pass in
`/tmp/ktv-pcm-bounded-two-packet-group-fixtures-20261004.log`.

The production-VP8/original-SFU clean 40-pair journey at the original 800-ms
target is running in
`/tmp/ktv-owned-av-pcm-group2-clean40-production-vp8-20261004.log`, with owner-only
parameters `/tmp/ktv-owned-pcm-group2-clean40-800-20261004.env`.
Native grouping, long residence, full clean accounting and digital expiry remain
unproved until their actual output checks finish. The experiment is not deployed.


### Grouped PCM passes native clean timing with bounded headroom — 2026-10-04

`/tmp/ktv-owned-av-pcm-group2-clean40-production-vp8-20261004.log`
passes **50/50** native production-VP8/original-SFU streaming checks at the
unchanged **800-ms** target. Forty matched pairs have zero unmatched edges,
p95 / maximum skew **86.31 / 93.25 ms**, source / native / owned decode /
presentation rates **25.00 / 24.99 / 24.99 / 24.65 fps**. Native readback confirms
two-packet grouping; 1,959 additional groups transfer during baseline samples.

The secondary context still loses up to **235.33 ms** against its original wall
anchor, and observed buffered samples reach **1,030.44 ms**. Grouping retains
headroom: observed credits reach at most **27**, held packets zero, and maximum
reserved PCM including temporary combined copies is **430,080 bytes**, within
the original 48-credit / 1-MiB bounds. This establishes bounded clean headroom
and actual grouping without claiming that the render clock is fixed. Sustained
behavior, impaired timing/quality and physical output remain required.

The production-VP8/original-SFU independent both-context buffered-expiry
regression is running in
`/tmp/ktv-owned-av-pcm-group2-both-context-expiry-20261004.log` with the same group
policy and 800-ms target. No private controlled receiver is deployed.


### Grouped PCM preserves independent buffered-expiry acceptance — 2026-10-04

`/tmp/ktv-owned-av-pcm-group2-both-context-expiry-20261004.log`
passes **51/51** native production-VP8/original-SFU checks with two-packet
transfers and the unchanged 800-ms target. Independently recorded old-output
silence, actual both-context freeze/resume, measured buffered residence above
500 ms and replacement separation pass. The exact-session expiry certificate is
still issued only after its existing proofs; unrelated or early closures remain
rejected. This closes that digital grouped-output regression, not physical or
impaired qualification.

The next full impaired comparison keeps the original 800-ms target and 700-ms
input reorder bound, with grouped PCM and the nominal `L1T1` source. It selects
the worker's already supported **1,000-ms** native keyframe-request cooldown,
motivated by missing-reference losses despite nominal native decoding. The
selector permits this interval only for that exact grouped/800-ms marked profile.
Actual receiver readback is required on every sample; the existing recent-key
suppression, one pending request, reference admission, caps, source quality and
all timing/expiry/cadence gates remain intact. No damaged input is decoded and
no default/deployed recovery policy changes.


**202/202** fixtures pass with the declared one-second native recovery selection
(`/tmp/ktv-pcm-group2-recovery1000-fixtures-20261004.log`). Full journey parameters
are preserved in owner-only
`/tmp/ktv-owned-l1t1-group2-target800-recovery1000-full-udp-20261004.env`.
The full comparison in
`/tmp/ktv-owned-av-vp9-l1t1-group2-target800-recovery1000-full-udp-20261004.log`
is terminal **exit 1**, stopping at impaired unmatched-edge accounting before
outage/handover. Source remains 1280-by-720 / 25 fps / max 350 kbps with Opus
64 kbps and RED; all original criteria remain in force.

- Clean baseline: six pairs, no unmatched edges, maximum skew **26.44 ms**;
  source/native/owned decode/presentation all meet 20–30 fps.
- Impaired: 40 pairs, **four unmatched audio / three unmatched video** edges
  (one per kind allowed), matched p95 **423.85 ms** / maximum **723.32 ms**
  (150/250 ms required). Source/native decoding **24.81/22.42 fps** pass;
  owned decode/presentation **15.14/14.78 fps** fail.
- Owned video stays alive but rejects **787** missing-reference frames, with
  28 late frames, 31 pressure drains, at most 20 held packets, and 27 fulfilled
  native keyframe requests. Source/native/owned marker identities never reverse.
- Grouped PCM stays alive: at most **26 credits**, six held packets and
  **368,640 reserved bytes**, including copies; 2,438 grouped transfers.
  Unrepaired gaps total **39,360 samples / 820 ms**. The secondary context's
  measured wall-clock lag reaches **326.67 ms**; grouping does not fix it.

This closes the observed PCM saturation in this comparison, not impaired
qualification. Random independent loss prevents attributing a numerical change
between runs to the faster request cooldown. Dependency recovery, source/render
clock stability, loss concealment, outage/handover and product/release gates
remain open.


### Independent keyframe ends older reference repair wait — 2026-10-04

The owned VP9 dependency queue previously waited up to 700 ms for an older
missing-reference chain even after an independent newer keyframe arrived.
The queue now treats a retained newer keyframe as the end of that older wait:
it visits older packets in RTP order, decodes only inputs whose declared
references are available, releases unsafe payloads without decoding them, and
then admits the keyframe. The four-output reservation still parks decoding;
20 held packets, 512 KiB encoded input, RTP/capture checks and the original
presentation/expiry limits remain unchanged. A scalar `keyframeDrains` counter
separates early recovery drains from queue pressure; no identities/payloads
are exposed. Keyframe independence follows the
[WebCodecs definition](https://www.w3.org/TR/webcodecs/#key-frame).

**204/204 A/V fixtures pass**
(`/tmp/ktv-video-keyframe-repair-all-fixtures-20261004.log`), including early
recovery across RTP wrap, safe independent deltas behind a broken chain,
missing-reference rejection, native-output congestion, stop and timer cleanup.
A full comparison runs with the same grouped/800-ms/L1T1/floor/one-second
feedback/continuous-RTX UDP profile in
`/tmp/ktv-owned-av-vp9-l1t1-group2-keyframe-drain-full-udp-20261004.log`;
owner-only parameters are in
`/tmp/ktv-owned-l1t1-group2-keyframe-drain-full-udp-20261004.env`.
The native comparison is terminal **exit 1**, timing out before 40 matched
impaired transitions and before outage/handover. Baseline six-pair maximum skew
is **27.23 ms**, with all four cadence stages nominal. Impaired source/native
rates remain **24.76/22.96 fps**; owned decode/presentation **17.29/16.98 fps**
fail the unchanged 20–30 fps gate. The stream remains alive with **573** rejected
missing-reference inputs, **163 keyframe drains**, 34 pressure drains, 24 late
frames, at most 20 held packets, 18 fulfilled requests and 26 decoded keys.
Captured/native/owned marker identities never reverse. PCM remains alive at
26 maximum credits, seven held packets and 368,640 maximum reserved bytes;
unrepaired gaps total **54,720 samples / 1,140 ms** and measured context lag
reaches **102.33 ms**. Timeout diagnostics currently omit the final incomplete
pairing summary; pair/skew acceptance cannot be inferred from decoder counters.
The early drain executes on actual traffic, but impaired qualification still
fails. Independent random loss prevents a causal comparison of these numerical
rates with earlier runs. No deployed/default codec changes.


### Request recovery during persistent required-reference wait — 2026-10-04

The next private change requests native recovery after a **350-ms** persistent
missing-dependency wait, before discarding at the unchanged **700-ms** deadline.
The stream exposes only a scalar wait age from its earliest retained arrival;
valid original repair, a retained independent keyframe, or stop clears it.
The existing 100-ms worker check can initiate recovery without a new incoming
frame. Reference admission, four-output reservations and all input/authority
bounds remain intact. The same request cooldown/recent-key suppression and
one pending request apply; defaults still disable private native recovery.
`keyframeEarlyRequests` measures actual early requests without exposing IDs.

The harness now retains one aggregate pairing-progress summary per fixed phase
and emits it on failure, including incomplete pair/unmatched counts and skew/delay
quantiles. Individual IDs, edge timelines and unknown properties are excluded;
matching and acceptance rules are unchanged.

**207/207 A/V fixtures pass**
(`/tmp/ktv-video-reference-early-recovery-all-fixtures-20261004.log`), including
349/350-ms threshold, no-new-input recovery, repaired-wait cancellation, cooldown,
recent keys, disabled/unrelated modes, terminal stop and privacy of incomplete
matching summaries. The full native comparison is running at
`/tmp/ktv-owned-av-vp9-l1t1-group2-early-reference-recovery-full-udp-20261004.log`;
owner-only parameters are in
`/tmp/ktv-owned-l1t1-group2-early-reference-recovery-full-udp-20261004.env`.
Source, impairment, output target, grouping, continuous RTX and every acceptance
criterion are unchanged from the prior keyframe-drain comparison.

The native comparison is now terminal **exit 1**, timing out before 40 impaired
pairs and before outage/handover. The new aggregate diagnostics record:

- Baseline: six pairs, no unmatched edges, maximum skew **14.57 ms**, all
  source/native/owned/presentation cadence stages nominal.
- Impaired: **37 pairs**, **eight unmatched audio / six unmatched video**,
  matched p95 **484.74 ms** / maximum **667.00 ms**; video observation delay
  maximum **1,546.30 ms**. Pairing and skew fail the original criteria.
- Source/native decode **24.72/21.86 fps** pass; owned decode/presentation
  **17.26/16.87 fps** fail. Captured/native/owned marker identities never reverse.
- Owned video stays alive: **606** missing-reference rejections, **277**
  keyframe drains, 43 pressure drains, 21 late frames, at most 20 held packets;
  **41 fulfilled requests, including 35 early requests**, and 48 decoded keys.
- PCM stays alive with **27 maximum credits**, five held packets,
  **391,680 maximum reserved bytes**, no pressure/backpressure events and
  2,456 grouped transfers. Unrepaired gaps total **27,840 samples / 580 ms**;
  the final measured secondary-context wall-clock lag is **169.33 ms**.

This proves early recovery and bounded diagnostics execute in the actual native
journey, not that the policy meets impaired acceptance. Independent random loss
prevents causal numerical comparisons. Earlier requests alone do not establish
reliable dependency recovery; loss concealment, clock stability, sustained /
outage / handover, product integration and physical/mobile/capacity/release
requirements remain open. Public online media remains disabled.

### Fixed-memory codec loss concealment — 2026-10-04

Added an optional private libopus backend and explicit `plc` selection through
worker port and owned PCM adapter. Defaults retain native WebCodecs. The pinned
Opus 1.6.1 source SHA256 is
`6ffcb593207be92584df15b32466ed64bbec99109f007c82205f0194572411a1`;
the Emscripten 4.0.23 image is pinned by digest
`sha256:86537645c51e44899812d29820ee3b64b96c321ebb2aba4416a04ceeb1bcde62`.
The successful owner-only build directory is
`/tmp/ktv-opus-plc-bounded-artifact-v3-20261004`; WASM hash
`4ec4e6f62ecc0ea6ae976b90e43bedbe0b75e44adc4765ed14c28a5fb6805b02`,
139,352 binary bytes, fixed **524,288 codec bytes**. No memory growth, native
API replacement, audible connection or media permission exists in the decoder.
The codec imports only inert WASI descriptor stubs; malformed input shuts it down.
Optional neural PLC/DRED/OSCE are disabled; standard Opus PLC remains active.
The build retains `COPYING.opus` and hashes its wrapper/artifact in `build.json`.
Initial build attempts failed on container ownership; the successful build runs
with the caller's UID/GID and an isolated compiler cache.

Real original/RED repair runs before concealment. Committed missing samples are
concealed by the codec in at most 960-frame chunks at the existing capture/RTP
schedule. Each output uses the same 48-credit / 1-MiB payload budget and group
transfer policy. Credit exhaustion retains the original input and resumes on
actual consumption; there is no ninth reorder entry, new output authority,
clock relaxation or byte-cap increase. The fixed codec memory is accounted
separately from PCM payloads and the encoded 512-KiB budget. Borrowed WASM
scratch is usable only inside the synchronous callback; close wipes it and drops
instance references. Closure cannot revive decoding or leave usable borrowed
output buffers. Browser artifact injection occurs only with the explicit
`KTV_ROOM_TEST_PCM_PLC_BUILD` selection and validates pinned source/compiler,
wrapper and WASM hashes before exposing the private factory.

Evidence:

- **214/214 A/V fixtures** pass in
  `/tmp/ktv-opus-plc-all-fixtures-20261004.log`: timeline/grouping across RTP wrap,
  original/RED repair priority, credit backpressure/resume, invalid sub-frame gaps,
  unsupported capability, guarded graph/port selection and scalar privacy/bounds.
- **5/5 actual-codec tests** pass in
  `/tmp/ktv-opus-plc-actual-codec-fixtures-20261004.log`, using real ffmpeg Opus
  packets: full stereo decode, finite/non-silent codec-generated loss output,
  next-original recovery, fixed memory through long concealment, malformed/loss
  shutdown and borrowed-output lifetime. These test the codec, not room authority.
- Native clean production-VP8/original-SFU / group2 / 800-ms / 40-pair
  qualification runs in
  `/tmp/ktv-owned-av-opus-plc-clean40-production-vp8-20261004.log`; immutable
  owner-only parameters are `/tmp/ktv-owned-opus-plc-clean40-800-20261004.env`.
  Native expiry and impaired qualification follow only after clean acceptance.

Reproduce the separate codec build/test:

```sh
node scripts/party-opus-plc-build.mjs /absolute/new/private-build-directory
KTV_OPUS_PLC_BUILD=/absolute/new/private-build-directory npm run test:party:opus-plc
```

Native/product/physical listening and all original streaming/release gates remain
open; codec tests do not qualify impaired room A/V or authorize public enablement.

The first native PLC run is terminal **exit 1** before initial presentation:
`PLAYOUT_PCM_OUTPUT_AGE` rejects a **262.5-ms** old sample, exceeding the unchanged
200-ms maximum; after the existing bounded recheck it closes. At closure the
codec had decoded 127–128 real packets, no input gaps/concealment, 45–46 maximum
credits and 691,200–706,560 reserved payload bytes. This is an initial
clock/receiver failure, not clean or impaired acceptance. No clock bound changes.

Explicit codec accounting now reduces the owned-video queue to **42 MiB**
(at most 31 largest nominal frames within its existing 32-entry count cap).
512-KiB fixed codec memory plus all other existing reservations remain below
**64 MiB / 40 frames**; no total or individual payload cap increases. Both native
phase readback and quality analysis enforce this selection. Scalar codec
initialisation/total/worst decode costs are added to distinguish codec work from
output-clock failures without retaining sample data or per-packet timelines.
**215/215 A/V fixtures** and **5/5 actual-codec tests** pass in
`/tmp/ktv-opus-plc-accounted-fixtures-20261004.log` and
`/tmp/ktv-opus-plc-accounted-codec-fixtures-20261004.log`.
The current native clean comparison, with the corrected aggregate reservation
and cost diagnostics, runs in
`/tmp/ktv-owned-av-opus-plc-accounted-clock-clean40-production-vp8-20261004.log`.
All timing/expiry criteria and source quality stay unchanged.

The corrected-accounting native clean run is terminal **exit 0, 50/50**:
`/tmp/ktv-owned-av-opus-plc-accounted-clock-clean40-production-vp8-20261004.log`.
It matches **40 pairs with no unmatched edges**, p95 **67.38 ms** / maximum
**73.11 ms**. Source/native/owned decode/presentation are
**24.99 / 24.98 / 24.99 / 24.67 fps**, all nominal. All 76 samples verify the
libopus backend, fixed **524,288 codec bytes** and **44,040,192 presentation
reservation bytes**. Codec initialisation is **0.70 ms**, total decode work
**624.20 ms** and largest decode call **7.80 ms**; no source loss occurs in this
clean run, so actual impaired concealment remains to be qualified. PCM reaches
36 credits and 552,960 maximum reserved payload bytes. This establishes clean
qualification for this comparison without explaining the preceding initial
clock failure or establishing startup/sustained reliability.

The independent both-context buffered expiry journey now runs with this backend
in `/tmp/ktv-owned-av-opus-plc-both-context-expiry-20261004.log`, selecting
`KTV_ROOM_TEST_AV_TIMING=0` and
`KTV_ROOM_TEST_RECEIVER_FAULT=suspend-task-stall` over the same immutable clean
profile. It must retain all existing buffered-residence, silence/deadline and
replacement separation proofs before the full impaired comparison.

Native both-context buffered expiry is terminal **exit 0, 51/51**:
`/tmp/ktv-owned-av-opus-plc-both-context-expiry-20261004.log`.
Actual suspend/resume, independently recorded old-output silence, measured
retained residence above 500 ms and replacement separation pass with the codec
backend. The existing exact-session expiry certificate still requires all those
proofs; early, unrelated or uncertified closures remain invalid. This is digital
expiry qualification, not physical or impaired acceptance.

The full UDP / VP9 L1T1 / 350-kbps cap / floor / original 800-ms target /
700-ms reference reorder / group2 / one-second request cooldown / early recovery /
continuous-RTX journey now selects the verified codec artifact at
`/tmp/ktv-owned-av-vp9-l1t1-opus-plc-full-udp-20261004.log`.
Immutable owner-only parameters are
`/tmp/ktv-owned-l1t1-opus-plc-full-udp-20261004.env`.
The original 150-ms delay, 0–40-ms jitter and 5% loss each direction/leg, 40-pair
matching, original source quality and timing/expiry/cadence gates stay intact.

The full PLC profile is terminal **exit 1 before impairment**, during baseline:
`PCM_BOUND` closes the decoder at **48 credits / eight held inputs**, maximum
reserved PCM 698,880 bytes and 56 backpressure events. No source gaps or PLC
outputs occur. Five pre-closure samples show actual secondary-context wall lag
**838.67–973.67 ms** (998 ms at closure), unlike the smaller lags of earlier
comparisons. Two baseline pairs have maximum skew 9.94 ms but video delay
approaches 1.83 seconds; those two pairs do not qualify the six-pair baseline.
The sampler's fixed codec reservation assertion detects the released decoder;
private closure evidence identifies the underlying bound failure.

Actual codec work is **108.50 ms total for 504 decoded packets**, maximum
**19.10 ms** for one call, with **0.60-ms** instance initialisation. These costs
and the render-clock lag are separate observations, not a causal explanation.
The comparison cannot claim impaired concealment, outage or handover acceptance.
Original credit and clock limits remain intact. The next private comparison
combines the existing constant-zero hardware clock driver with grouped codec PCM
because its earlier single-packet rejection did not test this credit policy.
No performance PCM can connect to that driver; the final guarded graph remains
the only performance output. This combination needs its own full/expiry proofs.

The grouped-libopus / constant-zero hardware driver comparison is also terminal
**exit 1 during baseline, before impairment**:
`/tmp/ktv-owned-av-vp9-l1t1-opus-plc-device-clock-full-udp-20261004.log`.
It closes at `PCM_BOUND` after 282 decoded packets, **48 credits / eight held
inputs**, 683,520 maximum PCM bytes and 45 backpressure events. No input gaps or
concealment occur; no complete baseline pair is recorded. The driver is enabled
and measured running before closure, then stopped by cleanup. At final closure
snapshot the secondary-context wall lag is 1,650.67 ms; closed-context snapshots
cannot establish continuing drift. Codec initialisation is 0.60 ms, accumulated
decode work 66.70 ms and maximum call 7.60 ms. This combination is unqualified
and stays disabled by default. The added zero sink does not establish a render-
clock fix; source quality, credit limits and output-clock checks stay intact.

Next work should remove the independently advancing secondary render clock from
this private comparison by testing native 48-kHz AudioBuffer scheduling on the
existing default-rate guarded AudioContext. It must use the browser's native
resampling, preserve the RTP/capture schedule, reserve both transfer and buffer
copies within the unchanged PCM/aggregate budgets, and prove clean/buffered-
expiry/impaired output before any product integration. This alternative is not
accepted yet. The shared-context comparison is now implemented as recorded below.
Current public deployment remains unchanged with
online media disabled; physical/mobile/capacity and all release gates stay open.

### 2026-10-05 — Shared render context and bounded grouping fallback

Implemented the explicit private `KTV_ROOM_TEST_PCM_RENDERER=buffers` comparison
in `party-pcm-buffer-scheduler.mjs`, the owned-PCM adapter, port/worker accounting,
browser harness and actual receiver-fault topology. It requires the pinned
libopus backend and owned video. Default worklet and deployed playback remain
unchanged. Native 48-kHz buffers use the caller's existing guarded context;
source completion returns credits, and close releases every source without
closing the caller's context. No secondary render context is created. The fault
fixture must therefore suspend/resume the actual shared context once, while
retaining all independent residence/silence/deadline/replacement assertions.

Two copies per live sample buffer plus one fixed 46,080-byte copy window fit
inside the original 1-MiB PCM limit; live quota is 1,002,496 bytes. Input, credit,
video and total memory bounds remain unchanged. Fixture graph evidence checks
the actual recorded connections and context; a PCM marker alone cannot hide a
backing source or bypass the final guard. Elapsed samples are skipped at the
original offset, never replayed under a shifted capture schedule.

Initial fixture regression: **227/227** in
`/tmp/ktv-pcm-shared-buffer-all-fixtures-20261005.log`.
The first native production-VP8/original-SFU clean comparison is terminal
**exit 1** in
`/tmp/ktv-owned-av-opus-plc-shared-buffers-clean40-production-vp8-20261005.log`:
**21 pairs, zero unmatched**, p95 **59.17 ms**, maximum **65.66 ms**.
This does not qualify the 40-pair gate. Actual decoder closure is `PCM_BOUND`;
the sampler detects its released codec reservation. Peak reserved PCM is
**1,044,480 bytes**, at most 35 credits. The grouping copy can exhaust byte
headroom before the 48-credit limit; this identifies a concrete allocation
failure and does not establish long-term shared-clock stability.

The grouping fix transfers already reserved originals separately whenever a
combined temporary copy would exceed the quota. It retains every sample,
capture time, packet duration and credit, performs no additional allocation,
and requires actual native consumption before returning credits. A scalar
`groupCopyFallbacks` counter records this path. Focused checks pass **71/71**;
full timing/capability regression passes **227/227** in
`/tmp/ktv-pcm-shared-buffer-copy-fallback-all-20261005.log`.
The fixture reproduces copy pressure under both worklet and doubled native-
buffer accounting, checks exact original samples/schedules, and verifies that
grouping can resume only after enough actual credits return.

The native copy-fallback comparison is terminal **exit 1** in
`/tmp/ktv-owned-av-opus-plc-shared-buffers-copy-fallback-clean40-20261005.log`,
using the owner-only parameters
`/tmp/ktv-owned-opus-plc-shared-buffers-clean40-20261005.env`.
It records **four pairs, zero unmatched**, p95/max **20.92 ms**. Actual decoder
closure is still `PCM_BOUND`, after 583 decoded packets, 48 credits/eight held
inputs, 62 backpressure events and **69 measured grouping-copy fallbacks**.
PCM peak stays at 1,044,480 bytes. The adapter also reports terminal native
output-age validation failure. Pre-closure snapshots show the shared context
already about **435.52–451.06 ms behind its initial wall anchor**; the first
sample is about 443.33 ms behind. The original shared-context attempt was about
225 ms behind at its first sample. These runs show startup anchoring needs its
own readiness validation; they do not prove a cause for every clock stall or
that removing the secondary context establishes stability.

Added `party-pcm-startup-clock.mjs`: keep gain zero and defer worker binding until
three consecutive 100-ms native intervals agree with wall time (35-ms interval
and 25-ms cumulative startup tolerances, matching local playback). Native output
timestamps must satisfy the existing age and latency limits. The startup wait
is bounded at eight seconds; cancellation/suspension, reversed clocks, inconsistent
wall time and timeout fail before binding. The returned wall/render anchor stays
fixed afterward; no later sample schedule is rebased. Closing during this wait
prevents a late result from binding or creating sources. Fixtures cover startup
stalls, accumulated drift, invalid output timestamps, clock reversal and closure.
Full timing/capability regression is **234/234** in
`/tmp/ktv-pcm-shared-buffer-startup-clock-all-20261005.log`.

Native clean qualification with the startup gate is terminal **exit 1** in
`/tmp/ktv-owned-av-opus-plc-shared-buffers-startup-clock-clean40-20261005.log`,
using the same unchanged 800-ms/production-VP8/original-SFU profile.
It reaches **23 pairs, zero unmatched**, p95 **59.73 ms**, maximum **75.43 ms**.
At the first sample, shared-context wall lag is 124.06 ms; later live samples
rise to **408.46–495.42 ms**. `PCM_BOUND` closes after 2,498 decoded packets,
48 credits/eight held inputs, 207 backpressure events and 42 grouping fallbacks.
Peak PCM stays at 1,044,480 bytes. Startup validation does not solve this later
clock loss, and this remains a failed clean 40-pair qualification.

Hardened startup validation to reject nonfinite initial clocks before waiting,
so an invalid initial observation cannot escape the eight-second bound. Latest
full fixtures pass **235/235** in
`/tmp/ktv-pcm-shared-buffer-startup-clock-final-all-20261005.log`.

A native comparison at the existing supported **500-ms target** is terminal
**exit 0, 50/50** in
`/tmp/ktv-owned-av-opus-plc-shared-buffers-startup-clean40-target500-20261005.log`,
with owner-only parameters
`/tmp/ktv-owned-opus-plc-shared-buffers-startup-clean40-target500-20261005.env`.
Only the explicit playout target differs from the previous native profile;
codec, nominal source, original SFU, memory, clock, marker and cadence bounds
remain unchanged. This tests shorter buffering/headroom, while sustained clock
stability remains a separate required gate. It records **40 pairs, zero
unmatched**, p95 **61.55 ms**, maximum **79.17 ms**. Video capture-to-presentation
maximum is **897.00 ms**. Source/native/owned decode/presentation rates are
**25.02 / 24.97 / 24.99 / 24.86 fps**, meeting the unchanged cadence bounds.
Actual live-context wall lag ranges **138.48–279.02 ms**; peak reserved PCM is
**706,560 bytes**, at most 22 credits. No copy-pressure fallback or concealment
is needed on this clean path. Independent random loss and separate browser
starts prevent attributing the changed numeric results solely to the target.

The same shared-context/500-ms backend completes actual suspend/task-stall expiry
qualification, terminal **exit 0, 51/51**, in
`/tmp/ktv-owned-opus-plc-shared-buffers-startup-target500-expiry-20261005.log`,
over the same owner-only profile with `KTV_ROOM_TEST_AV_TIMING=0` and
`KTV_ROOM_TEST_RECEIVER_FAULT=suspend-task-stall`. This must prove retained PCM
residence above 500 ms, actual shared render/guard clock freeze/resume, independent
old-output silence, deadline enforcement, replacement separation and the existing
expiry certificate. Measured future owned PCM residence is **524.23 ms**,
14 queued sources and 414,720 reserved bytes; the actual one-context graph and
all existing independent output checks pass. This digital expiry proof does not
establish physical-device or impaired-network acceptance.

The full L1T1/floor/impairment
shared-context profile is prepared at
`/tmp/ktv-owned-l1t1-opus-plc-shared-buffers-startup-full-udp-20261005.env`;
it has not been launched or accepted.
An attempted 500-ms full profile is rejected at configuration preflight before
any native journey starts:
`/tmp/ktv-owned-av-vp9-l1t1-opus-plc-shared-buffers-startup-full-udp-target500-20261005.log`.
The historical one-second RTX-recovery tuple requires an 800-ms output target.
Added an explicit 500-ms shared-buffer/libopus tuple that retains the original
independent 700-ms video reorder bound, two-packet grouping and one-second
bounded recovery. All source, SFU, loss, clock, memory, matching and cadence gates
remain intact. Other private/default tuples retain their previous restrictions.
This qualifies a new declared comparison; it does not waive any measured gate.

Full impaired qualification was launched at the 500-ms target with explicitly
retained 700-ms video reorder, using owner-only parameters
`/tmp/ktv-owned-l1t1-opus-plc-shared-buffers-startup-full-udp-target500-reorder700-20261005.env`
and log
`/tmp/ktv-owned-av-vp9-l1t1-opus-plc-shared-buffers-startup-full-udp-target500-reorder700-20261005.log`.
Only the stated clean digital timing/quality and actual buffered-expiry journeys
are accepted so far. Full impairment, sustained clocks, product integration and
physical/mobile/capacity/release gates remain open.

The full shared-context/500-ms comparison is terminal **exit 1** after functional
recovery and venue handover, timing out on the next-singer 40-pair gate. Baseline
passes six pairs with no unmatched markers, p95/max **43.47 ms**. Impaired output
reaches **40 pairs**, one unmatched audio and one unmatched video, but p95 skew
is **631.34 ms**, maximum **738.90 ms**. Eleven pairs exceed the 150-ms bound;
seven have later video and four have later audio. Post-handover output reaches
only **38 pairs**, six unmatched audio/four unmatched video, p95 **668.46 ms**,
maximum **719.19 ms**. Matching, skew and cadence gates remain unchanged.

Source/native/owned decode/presentation rates are **24.69 / 20.15 / 17.32 /
17.00 fps** under impairment, and **24.79 / 20.65 / 15.23 / 11.84 fps** after
handover. Actual source capture remains about 25 fps. Source, native-decoded and
owned-decoded marker probes report **zero backward transitions** throughout.
Impaired owned video records 530 reference misses, 240 keyframe drains, 17 late
frames, 22 pressure drains and 37 fulfilled bounded recovery requests, including
30 early requests. The new receiver remains alive with no terminal PCM/video
error through these phases; its video recovery/cadence still needs work.

This run finally exercises actual codec concealment: by the end of impairment,
**43,200 missing samples (900 ms)** produce 45 bounded codec-loss outputs, with
968 real RED repairs. The new singer's independent receiver records **39,360
missing/concealed samples (820 ms)**, 41 loss outputs and 1,067 RED repairs.
Maximum PCM reservation is **798,720 bytes / 25 credits**, at most six held
inputs, zero PCM backpressure events and zero grouping-copy fallbacks. No codec
or output-clock terminal failures occur. Live-context lag spans **348.77–506.44
ms** during impairment and **78.88–152.71 ms** in the new receiver after handover.
This establishes actual bounded concealment behavior in a failed full journey;
it does not qualify overall impaired timing, nominal owned video or long-term
clock stability. Separate random-loss runs do not establish causal improvements.

Next comparison uses the already prepared **800-ms** shared-context full profile
at `/tmp/ktv-owned-l1t1-opus-plc-shared-buffers-startup-full-udp-20261005.env`.
Its nominal L1T1 source, bitrate floor, real PLC, original 700-ms video reorder,
one-second bounded recovery, continuous RTX, 150-ms/0–40-ms/5% per-leg impairment,
40-pair matching and full recovery/handover scope remain intact. The comparison
tests existing additional buffering against the observed video/audio skew; no
memory, timing, nominal-quality or expiry limit is raised. Native log:
`/tmp/ktv-owned-av-vp9-l1t1-opus-plc-shared-buffers-startup-full-udp-target800-20261005.log`.

The 800-ms full comparison is terminal **exit 1**, timing out before 40 impaired
pairs: **39 pairs**, six unmatched audio/four unmatched video, p95 **652.92 ms**,
maximum **720.58 ms**. Source/native/owned decode/presentation rates are
**24.79 / 21.94 / 16.78 / 16.88 fps**. No terminal PCM or video failure occurs.
Live impaired-context wall lag is **91.52–221.79 ms**; PCM peaks at **798,720
bytes / 25 credits**, no backpressure or grouping-copy fallback. Actual codec
concealment covers **49,920 samples (1,040 ms)** in 52 outputs, with 1,062 RED
repairs. Owned video records 656 reference misses, 270 keyframe drains, 26 late
frames, **26 pressure drains**, and 41 fulfilled recovery requests, 31 early.
The owned marker probe has zero backward transitions. More buffering alone does
not qualify the impaired journey; cadence and matching still fail.

### 2026-10-05 — Repair a full video queue before discarding its missing parent

Found a deterministic input-ordering defect in `party-vp8-frame-stream.mjs`:
when the 20-entry dependency queue is full, an arriving older missing parent
triggers a forced drain first. That can discard the oldest waiting child and
advance the RTP frontier past the parent, which is then rejected as late. The
incoming parent could have repaired the chain within the existing deadline.
The earlier native pressure counts motivate this check, but do not prove how
many such parents occurred in those runs.

The receiver now admits that specific repair into an existing native decoder
slot before forcing a queue drain. It requires a delta that precedes the oldest
held RTP input, matches that input's declared missing dependency, has all its
own references already available, and arrives before the fixed reorder deadline.
The four-output cap and shared 512-KiB encoded budget still apply; no 21st held
entry is allocated. Repair then drains the existing chain in RTP order. Unknown
dependencies, full native output slots, expired waits and stale RTP retain their
previous rejection behavior. Stop/expiry cannot revive decoding.

A scalar `referenceRepairDrains` counter exposes actual use. New fixtures
reproduce the full 20-frame queue under ordinary and wrapped RTP, verify exact
ordered delivery with zero reference/late/pressure loss, and check rejection
under decoder congestion, unknown dependencies and deadline expiry. Full
timing/capability fixtures pass **237/237** in
`/tmp/ktv-video-reference-pressure-repair-all-fixtures-20261005.log`.

The unchanged shared-context/800-ms full UDP profile finishes terminal **exit 1** in
`/tmp/ktv-owned-av-vp9-l1t1-opus-plc-shared-buffers-reference-parent-repair-full-udp-target800-20261005.log`.
It reaches **40 impaired pairs**, one unmatched audio and **two unmatched video**;
the original unmatched-edge gate rejects the run. Skew also fails: p95
**612.96 ms**, maximum **712.57 ms**. Source/native/owned decode/presentation are
**24.44 / 21.59 / 18.31 / 17.76 fps**, below the original owned cadence bounds.
No source/native/owned marker regression occurs. The actual worker reports
**two reference-parent repair drains**, proving the new path is exercised;
this does not establish an overall benefit under independent random loss.
Impaired video records 425 reference misses, 192 keyframe drains, 23 pressure
drains, 18 late frames and 36 fulfilled requests, including 30 early requests.
PCM remains live without backpressure or terminal failure: peak **983,040
bytes / 34 credits**, up to seven held inputs, with 27,840 real missing/concealed
samples and 991 RED repairs. Live-context lag spans **106.35–633.44 ms**.
Functional handover is not reached because the impaired gate rejects first.

### 2026-10-05 — Explicit earlier missing-reference feedback

Added a private **100-ms** missing-reference wait comparison through
`KTV_ROOM_TEST_RECEIVER_KEYFRAME_WAIT_MS=100`. The worker default remains 350 ms.
It requires the declared shared-buffer/libopus, nominal VP9 L1T1 floor,
dependency-aware owned decoder and continuous RTX profile. The one-second
request cooldown, one pending native request, one-second recent-key suppression,
fixed 700-ms reorder deadline and all resource/output gates remain unchanged.
The earlier feedback uses actual declared missing-reference history only;
capture pacing gaps, marker pixels/IDs or measured A/V skew cannot trigger it.
Each actual A/V sample verifies the worker's declared wait and cooldown.

The worker rejects unsupported waits or unrelated decoder/recovery policies.
New fixtures check exact threshold admission, recent-key suppression, request
cooldown and terminal stop. Full timing/capability fixtures pass **239/239** in
`/tmp/ktv-video-earlier-reference-feedback-all-fixtures-20261005.log`.

Full native comparison is running in
`/tmp/ktv-owned-av-vp9-l1t1-opus-plc-shared-buffers-reference-wait100-full-udp-target800-20261005.log`,
with owner-only parameters
`/tmp/ktv-owned-l1t1-opus-plc-shared-buffers-reference-wait100-full-udp-target800-20261005.env`.
The nominal source, bitrate, clock checks, PCM/video budgets, original per-leg
delay/jitter/loss, matching and full recovery/handover scope stay intact.
No native acceptance is assumed. Impaired recovery/cadence, sustained clocks,
product integration and physical/mobile/capacity/release gates remain open.
Public deployment remains unchanged with online media disabled.

The 100-ms feedback comparison is terminal **exit 1**, timing out on impaired
matching: **38 pairs**, seven unmatched audio/seven unmatched video, p95
**618.09 ms**, maximum **733.00 ms**. Actual worker wait is 100 ms in every
observed sample. Source/native/owned decode/presentation rates are **24.83 /
19.20 / 16.92 / 16.81 fps**; native and owned cadence fail. Video records 643
reference misses, zero pressure drains or parent-repair drains, 25 late frames,
55 fulfilled requests and 50 early requests. No marker regression or terminal
receiver error occurs. PCM stays below **768,000 bytes / 24 credits**, with
39,360 missing/concealed samples and no backpressure. This comparison remains
unqualified; default feedback stays 350 ms. Independent random loss prevents
claiming a causal numeric improvement or regression between runs.

### 2026-10-05 — Explicit production-codec floor and supported VP8 RTP ordering

Prepared a private VP8/RED build at
`/tmp/ktv-codec-candidate-owned-vp8-reference-20261005`, using the existing
non-publishable codec builder: 1280×720, 25 fps, 350-kbit video, default transport,
no backup codec or extra periodic keyframes, RED retained. Build exits 0 in
15.92 seconds; its digest check confirms production `dist` is unchanged.
Build log: `/tmp/ktv-vp8-reference-private-build-20261005.log`.

The first declared-reference VP8 trial is terminal **exit 1 before initial
presentation** in
`/tmp/ktv-owned-av-vp8-opus-plc-shared-buffers-floor-reference-clean40-target500-20261005.log`.
The worker fails closed at `VIDEO_REFERENCE` before decoding any video or PCM.
An earlier metadata histogram was misread: **sender** VP8 records expose frame
IDs/dependencies, but **receiver** records in this setup do not. Synthetic
reference fixtures cannot establish this native capability. Reverted the
experimental VP8-reference admission; stream and worker still reject that mode.
New regression fixtures explicitly preserve this rejection.

The private floor helper now accepts an explicit VP8 or VP9 codec and modifies
only that codec's 250-kbit minimum parameter. Default remains VP9. Tests verify
other codec sections, audio, feedback and SDP bytes remain intact, idempotent
normalization and actual native retention. This enables a declared VP8 comparison
using its existing **RTP-gap ordering** and actual late-frame recovery, without
invented reference metadata or a silent dependency fallback. The same 700-ms
input wait, 20 retained packets, four decoder outputs, two transfers, aggregate
memory, capture clock, expiry and nominal source/quality gates remain intact.
The source retains its production temporal policy; no L1T1 override is applied.

Final timing/capability fixtures pass **242/242** in
`/tmp/ktv-vp8-explicit-floor-gap-final-all-fixtures-20261005.log`.
Clean 40-pair qualification at the existing 500-ms output target, with explicitly
retained 700-ms video input reorder, is terminal **exit 1** in
`/tmp/ktv-owned-av-vp8-opus-plc-shared-buffers-floor-gap-clean40-target500-20261005.log`.
Owner-only parameters:
`/tmp/ktv-owned-vp8-opus-plc-shared-buffers-floor-gap-clean40-target500-20261005.env`.
It reaches **40 pairs**, zero unmatched audio/video, p95 **54.23 ms**, maximum
**57.04 ms**. Source/native/owned decode/presentation are **25.00 / 24.97 /
25.01 / 24.86 fps**, with no nominal-quality errors. The declared recovery
profile then correctly rejects: it requires actual fulfilled recovery requests,
while this clean path has zero requests and zero newly encoded/decoded keys.
This is not a complete accepted native journey.

The pure clean VP8 profile now omits receiver recovery and its interval flag,
retaining every clock, codec, source, marker, memory, cadence and skew gate.
It is terminal **exit 0, 55/55** in
`/tmp/ktv-owned-av-vp8-opus-plc-shared-buffers-floor-gap-clean40-no-recovery-target500-20261005.log`,
with owner-only parameters
`/tmp/ktv-owned-vp8-opus-plc-shared-buffers-floor-gap-clean40-no-recovery-target500-20261005.env`.
Full impaired qualification still enables actual bounded native recovery and
requires real response evidence. No recovery gate is waived. No new VP8-floor
release acceptance is assumed; public deployment remains unchanged and all
remaining release gates stay open.

The pure clean run records **40 pairs**, zero unmatched audio/video, p95
**86.40 ms**, maximum **206.45 ms**, within the original 150/250-ms gates.
Source/native/owned decode/presentation rates are **24.99 / 24.97 / 25.04 /
24.74 fps** with no nominal-quality errors. Live-context wall lag spans
**49.90–589.04 ms**; PCM peaks at **936,960 bytes / 30 credits**. This is a clean
digital qualification, not proof of sustained device-clock stability or impaired
operation. The source retains its production temporal policy.

### 2026-10-05 — Preserve a full-queue contiguous RTP repair

Extended the previously verified pressure-order fix to the existing gap-only
decoder path. A delta that fills the next contiguous RTP position, precedes the
oldest held input and arrives before its original deadline can enter an existing
native decoder slot before a forced discard. This uses the gap mode's existing
54-ms contiguity criterion; it supplies no reference IDs or dependency claims.
The 20-held-input, four-output and 512-KiB encoded limits remain intact. Full
native slots or an expired wait retain the original rejection behavior.

`contiguousRepairDrains` reports this separately from actual declared-reference
repairs. Fixtures verify all 22 original frames under ordinary/wrapped RTP,
without extra held slots or a committed gap, and reject native-slot congestion
and expired repairs. Full timing/capability fixtures pass **244/244** in
`/tmp/ktv-vp8-contiguous-pressure-repair-all-fixtures-20261005.log`.

The full VP8-floor/shared-buffer/libopus comparison used the original
800-ms output target, 700-ms input reorder, one-second bounded late-frame
recovery, continuous RTX and original per-leg UDP impairment in
`/tmp/ktv-owned-av-vp8-opus-plc-shared-buffers-floor-gap-contiguous-repair-full-udp-target800-20261005.log`.
Owner-only parameters:
`/tmp/ktv-owned-vp8-opus-plc-shared-buffers-floor-gap-full-udp-target800-20261005.env`.
Actual keyframe response, complete impaired and post-handover matching, original
skew/cadence and all resource gates remain required. No native impaired benefit
is assumed. Public deployment remains unchanged with media disabled; sustained,
product integration and physical/mobile/capacity/release acceptance remain open.

The full run is terminal **exit 1**. Baseline has six pairs with no unmatched
edges, p95/max **57.47 ms**. Impaired matching reaches **40 pairs**, with four
unmatched audio and three unmatched video edges, p95 **145.83 ms**, maximum
**344.70 ms**. Original matching and maximum-skew gates fail. Source/native/owned
decode/presentation rates are **25.00 / 21.71 / 24.71 / 23.67 fps**, within nominal
cadence. Video capture-to-presentation maximum is **1313.50 ms**.

PCM stays below **783,360 bytes / 25 credits**, with **42,240** genuinely concealed
samples (880 ms), 1014 RED repairs, zero backpressure, zero copy fallback and zero
late/trimmed native packets. Live shared-context wall lag is **61.31–123.02 ms**
during impairment. Video has 34 committed gaps, 11 late inputs and eight fulfilled
keyframe requests, with zero pressure or contiguous-repair drains. The new repair
branch is therefore fixture verified, not exercised by this native run.

Source and native-receiver pixel probes remain monotonic; the owned decoder
reports **one backward visual transition**. Thirty-nine matched pairs are within
150 ms; the remaining pair is late video over 250 ms. This identifies a remaining
decoder/reference problem without claiming a causal comparison against earlier
independently randomized runs. The test stops at impaired matching and does not
qualify network recovery or handover.

### 2026-10-05 — Explicit single-layer VP8 source comparison

Extended the existing private temporal experiment to accept an explicit VP8 or
VP9 codec, keeping VP9 as its default. The harness admits VP8 only with the
declared nominal VP8 floor/shared-buffer/libopus/gap-ordering profile. Every
timing sample must read back the actual native **L1T1** encoding, 25-fps and
350-kbit caps and unchanged codec-specific hint. It does not supply unavailable receiver
dependency metadata, relax any queue/deadline or use diagnostic marker IDs to
trigger recovery. Production source policy is unchanged.

Focused temporal/stream/worker fixtures pass **43/43** in
`/tmp/ktv-vp8-l1t1-ordering-fixtures-20261005.log`. They cover explicit VP8,
default VP9, rejected codec names, original caps, wrapped RTP repair and worker
recovery. The first pure clean 40-pair native comparison is terminal **exit 1** in
`/tmp/ktv-owned-av-vp8-l1t1-opus-plc-shared-buffers-floor-gap-clean40-target500-20261005.log`,
with owner-only profile
`/tmp/ktv-owned-vp8-l1t1-opus-plc-shared-buffers-floor-gap-clean40-target500-20261005.env`.
It times out before provider-confirmed publisher readiness, with no A/V samples
or native temporal acceptance established. The publisher reports stage
unavailability; no unhandled runtime exception occurs. This cannot qualify or
numerically compare temporal behavior.

Added fixed policy readback on failure (declared codec/configuration count and
actual sender parameters, without signaling credentials). The next clean
diagnostic run uses the same immutable owner-only profile in
`/tmp/ktv-owned-av-vp8-l1t1-opus-plc-shared-buffers-floor-gap-clean40-policy-diagnostics-target500-20261005.log`.
Actual codec, temporal policy, skew, cadence and resource gates remain required.
No native benefit is assumed; full impairment and handover remain open.

The diagnostic run is terminal **exit 1 before publisher readiness**. All native
temporal snapshots show **zero configurations and zero senders**. Inspection of
the prior successful VP8 timeline shows its actual original policy in all 94
samples: **empty content hint and no explicit scalability mode**. VP9 instead
begins with motion/L1T3. The initial VP8 helper incorrectly reused the VP9
precondition, so it rejected before calling the native API. Corrected the
codec-specific precondition and readback while retaining the original VP8 hint;
only the temporal mode changes. Added regression cases rejecting an unexpected
VP8 hint or original mode. Focused fixtures pass **43/43** in
`/tmp/ktv-vp8-l1t1-native-policy-ordering-fixtures-20261005.log`.

The corrected native clean comparison is terminal **exit 0, 55/55** with the same profile in
`/tmp/ktv-owned-av-vp8-l1t1-opus-plc-shared-buffers-floor-gap-native-policy-clean40-target500-20261005.log`.
No timing or native capability claim is inferred from the rejected trials.

It measures **40 pairs**, zero unmatched audio/video, p95 **54.78 ms**, maximum
**62.91 ms**. Source/native/owned decode/presentation rates are **25.00 / 24.98 /
25.01 / 24.79 fps**, without nominal quality errors. All 75 timing samples read
back the unchanged empty hint and actual **L1T1** sender mode. Source/owned
markers have zero backward transitions. PCM peaks at **691,200 bytes / 21
credits**, with no concealment, backpressure or copy fallback. Live-context wall
lag spans **18.19–270.08 ms**; sustained device-clock acceptance remains open.

The first full native UDP impairment/recovery/handover comparison is terminal **exit 1** in
`/tmp/ktv-owned-av-vp8-l1t1-opus-plc-shared-buffers-floor-gap-full-udp-target800-20261005.log`.
Its owner-only immutable profile is
`/tmp/ktv-owned-vp8-l1t1-opus-plc-shared-buffers-floor-gap-full-udp-target800-20261005.env`.
It retains the original 800-ms output target, 700-ms bounded input ordering,
one-second native recovery cooldown, continuous RTX, nominal source and original
150-ms-plus-jitter/5%-loss impairment per direction/leg. Actual recovery response,
complete impaired/post-handover matching and all original skew/cadence/resource
gates remain required. The public preview remains unchanged with media disabled.

Baseline has six pairs and no unmatched edges, p95/max **57.33 ms**. Impaired
and next-singer phases both measure **40 pairs with zero unmatched audio/video**.
Impaired p95/max is **69.96 / 427.44 ms**; next-singer is **115.86 / 250.63 ms**.
Original maximum-skew limits fail; two impaired observations exceed 250 ms.
Source/native/owned decode/presentation are **24.81 / 24.14 / 24.30 / 23.92 fps**
under impairment and **25.01 / 24.40 / 24.64 / 23.12 fps** after singer handover,
with no nominal quality errors. All source/native/owned marker probes remain
monotonic, unlike the previous default-temporal VP8 run. Independent randomized
loss prevents a causal numeric comparison.

PCM remains bounded, with no terminal error, backpressure, copy fallback or late
native packet: impaired maximum **860,160 bytes / 29 credits**, **36,480** truly
concealed samples, 918 RED repairs; next-singer maximum **552,960 bytes / 17
credits**, **40,320** concealed samples, 915 RED repairs. Live-context wall lag is
**130.85–443.42 ms** impaired and **2.10–66.96 ms** after handover. Ten/twelve
native keyframe requests are fulfilled respectively. Contiguous pressure repair
remains unexercised. Outage recovery and online singer replacement pass their
functional checks. No full journey acceptance is claimed.

### 2026-10-05 — Scope allocation evidence to the measured browser during hybrid turns

The first full L1T1 run stops before venue-to-remote timing because the allocation
collector incorrectly demands a single active audience in the whole fixture.
Hybrid turns permit both the host and common screen to listen. This is a scope
bug in the test, separate from the measured maximum-skew failures.

Added a bounded per-page observer for the exact same-origin successful media-grant
response. It retains only opaque identity, room and scope, never a token, permit
or unknown field. Each phase verifies this page's audience identity against an
active server grant in the current room and an exact provider participant, then
requires the same one-current-publisher and one-current-video-track checks.
Other audiences cannot supply its evidence; no global-first or unscoped fallback
exists. Failed/malformed grants clear the observed scope, and publisher/audience
role replacements update it. Allocation logs remain read only after timing.

Scope/parser/temporal fixtures pass **8/8** in
`/tmp/ktv-sfu-current-browser-scope-fixtures-20261005.log`; harness syntax passes.
The full original L1T1 impairment/handover profile runs again with this corrected
collector in
`/tmp/ktv-owned-av-vp8-l1t1-opus-plc-shared-buffers-floor-gap-scoped-hybrid-full-udp-target800-20261005.log`.
It reuses the immutable full owner-only profile above. No quality, pairing, skew,
memory, authority, outage or full hybrid acceptance gate is waived. Public media
remains disabled; sustained/product/physical/mobile/capacity/release work is open.
