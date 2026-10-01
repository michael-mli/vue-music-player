# KTV Party — Design and Architecture

Created: 2026-09-29

Status: Incremental implementation. Rooms, live queue planning, device pairing,
moderation, singer nomination/readiness, clock negotiation, and a local scheduled
playback/private-guide preview are implemented. Streaming and physical audio
validation remain open. See the progress tracker for
deployment evidence and remaining work.

Progress tracker: [ktv_party_implement.md](ktv_party_implement.md)

## 1. Product goal

Create an invitation-based KTV party with one shared stage, a shared song queue,
phone controls, host moderation, and private original-vocal guidance for singers.
Every admitted participant can open the common page. A TV or laptop can present
that page while people use their phones to choose songs and manage the party.

The experience must support these settings:

| Mode | Performance source | What the audience hears |
| --- | --- | --- |
| Together | One designated stage device plays the instrumental; people sing in the room | Room speakers and the singer in person |
| Online | The active singer's device plays backing locally, captures the microphone, and publishes a performance | A live mix of backing and singing |
| Hybrid | A designated device captures the physical room performance, or a remote singer publishes | Local guests hear the room; remote guests receive the live performance |

The user has not selected which setting ships first. The proposed delivery order
is shared rooms and local playback, private guide synchronization, then online
and hybrid streaming. This is sequencing, not a decision to drop online support.
Do not describe the local release as a completed online KTV product.

## 2. Requirements and release scope

| ID | Requirement | Delivery |
| --- | --- | --- |
| R01 | Create, name, configure, close, and expire a room | Local release |
| R02 | Invite by code, link, and QR; guests enter a name without registration and receive a random participant ID; support optional host approval | Local release |
| R03 | Common stage page accessible to admitted participants | Local release |
| R04 | Phone song search, requests, shared queue, requester and singer attribution | Local release |
| R05 | Request next, fair singer rotation, host queue overrides | Local release |
| R06 | Approve, reject, remove, block, co-host, transfer ownership, lock room | Local release |
| R07 | Shared playback, stage assignment, countdown, pause, seek, skip | Local release |
| R08 | Private original-vocal listening synchronized to the performance | Local release, gated by measured device support |
| R09 | Consistent lyrics, song identity, and progress across views | Local release |
| R10 | Reconnect, buffering, device loss, host loss, and restart recovery | Local release |
| R11 | Several devices per participant, including a paired display | Local release |
| R12 | Live singing for remote audiences using WebRTC | Online release |
| R13 | Switching between physical-room and remote performers | Hybrid release |
| R14 | English/Chinese UI, accessible controls, understandable connection states | Every release |

Later extensions: independent vocal-stem volume, recording/export, reactions,
camera video, voting, and scoring. Simultaneous remote duets require a separate
latency study. One active performance at a time is the initial online model.

## 3. User experience

### 3.1 Routes and views

Use `/party` for the new feature. `/karaoke/` already serves instrumental files,
and `/sing` is the existing solo karaoke view.

| Proposed route | Purpose |
| --- | --- |
| `/party` | Create a room, enter an invitation, reconnect to a joined room |
| `/party/join` | Redeem a typed code or an invitation from the URL fragment |
| `/party/:roomId` | Phone controller; tabs: Songs, Queue, Sing, People |
| `/party/:roomId/stage` | Common stage, usable on desktop, TV browser, or phone |
| `/party/pair` | Pair another device using a short-lived one-time code |

Invitation links can use `/party/join#invite=...`; redeem through an authenticated
POST and remove the fragment afterward. An invitation is not a membership token.
Possessing a stage URL alone does not grant admission to the room.

The implemented controller has Songs, Queue, Sing, and People tabs. Arrow keys,
Home, and End select a tab and move keyboard focus; inactive panels are hidden.
The Sing panel remains mounted, so changing tabs keeps its private audio graph
and calibration. A selected singer sees a turn prompt from the other tabs.
Songs shows the selected singer's pending count against the server's request cap.

Host invitations and short-lived device connections have QR codes generated
locally with `qrcode` and accessible text links. Both URLs carry the code in their
fragment; the join/pair pages also accept legacy `?code=` links and remove the code
from the address after reading it. Scanning a pairing link prefills its form;
connection still requires a tap and the server's one-time redemption check.

The host can expose or hide the invitation on common screens. This preference
defaults to off and persists in `ktv_rooms.stage_invite_visible`. Only admitted
snapshots include `stageInvitationCode` while visible and unlocked; waiting guests
never receive it. Paired displays still omit the private host invitation and cannot execute host
commands. Rotation updates the exposed code, and locking hides it immediately.
The stage's fullscreen control toggles an explicit exit; browser refusal has a
separate message and does not change audio readiness.

### 3.2 Main journey

1. Host creates a room and chooses admission, queue, and audience settings.
2. Host opens or pairs the stage device and explicitly enables its audio.
3. Invitees open the invitation directly, or enter a code on `/party/join`.
   Unregistered guests enter their display name; the app creates/restores their
   guest session and assigns a random participant ID without requiring signup.
4. If approval is enabled, guests see a waiting view; hosts and co-hosts see admission requests.
5. Guests request songs and see who is singing now and next.
6. The next singer confirms readiness. The stage and required singing device prepare audio.
7. A shared countdown leads into the song. Phones can show lyrics and a private guide.
8. At song end, the next entry is offered to its singer; a new readiness cycle begins.

The stage emphasizes large lyrics, current singer, song progress, and upcoming
singers. Invitation display is host-controlled and hidden when the room is locked.
Phone actions should remain usable with one hand. Host controls appear inside
Queue and People, with a separate settings panel.

### 3.3 Queue rules

- `Add to queue` creates a request at the end of the singer's pending list.
- `Request next` creates a priority request for host approval; it never interrupts
  the current song or silently moves itself to the front.
- Store requester and singer separately. A singer must accept a nomination by
  another member before becoming ready; host assignment follows the same readiness step.
  The implemented queue puts unaccepted nominations after eligible songs. Own
  requests are accepted automatically, while nominations count toward the nominated
  singer's three-song cap. Declining a nomination cancels that unique queue entry.
- Default fairness: one song per eligible singer per round, ordered by first
  pending request, with each singer's requests in their own submission order.
  New singers join the end of the current unserved round. A completed, skipped,
  or declined turn counts as served; deleting and re-adding requests does not reset it.
- Materialize and display the actual upcoming order. An accepted `Request next`
  or host move creates a visible manual override, then normal rotation resumes.
- Default cap: three pending requests per singer, configurable by the host.
- Allow the same song for different turns; warn about an existing request.
  Queue entries have unique IDs even when their song IDs match.
- Members may cancel their own unstarted requests. Once performance preparation
  begins, request removal, nomination decline and priority approval cannot change
  that entry; the phone hides those actions and the server returns
  `PERFORMANCE_ACTIVE`. Hosts use the performance controls for the current song.
  Only hosts reorder the room
  queue, remove other requests, or change the current performance.
- Freeze the selected next entry during its readiness countdown. Any replacement
  cancels that preparation and starts a new one.
- Departed singers' pending entries are held. Hosts can reassign or remove them.
  Removing a member holds those entries and stops their active performance.

### 3.4 Direct invitation and guest name entry

An invitation link or QR opens the join page with the invitation already filled
in. Guests do not need to visit the music library or the party landing page first.
Someone with only a code can go directly to `/party/join` and enter it there.

For a new unregistered participant, show a small form:

- Invitation code, prefilled when opened from a link or QR.
- `Your name` — required display name.
- `Join room` — submits the invitation and chosen name.

No email, password, Google login, or registration step is required. Restore an
existing guest session when available; otherwise use the existing guest-identity
bootstrap behind the scenes. A randomly generated default username from that
bootstrap does not replace the guest's explicit name entry for their first join.
After submission, show the waiting screen if approval is enabled, otherwise open
the room controller. Invalid/expired codes keep the guest on the join form with
a clear error. Registered members can use their profile name, with an editable
room display name. A read-only, authenticated invitation resolution request restores
existing admitted or pending membership without changing the chosen name. Admitted
members open the controller directly; pending members return to approval waiting.
New guests still choose a name before membership is created. Rotated/expired codes,
blocked or removed membership, and locks for new guests remain enforced. Codes are
removed from the address bar after reading the link fragment or legacy query.

Store the chosen name on the room membership so it does not unexpectedly rename
the person's global profile. Trim whitespace and require 1–40 characters after
trimming; reject blank input on both client and server. Display names need not be
unique: two guests named Alex remain different participants, with a short ID badge
when needed to distinguish them. Never recover a session or assign permissions by
matching a name.

## 4. Roles, identity, and devices

Room permissions are separate from the application's global `admin`/`user` role.
Device capabilities are separate from member roles.

| Action | Member | Co-host | Host | Display grant |
| --- | --- | --- | --- | --- |
| See admitted room state and queue | Yes | Yes | Yes | Yes |
| Request songs / manage own requests | Yes | Yes | Yes | No |
| Approve/reject/remove/block/restore ordinary members | No | Yes | Yes | No |
| Reorder, pause, seek, skip, assign stage | No | Yes | Yes | No |
| Change routine room settings | No | Yes | Yes | No |
| Change roles, remove co-host, transfer, close | No | No | Yes | No |
| Output stage audio | If designated | If designated | If designated | If designated |
| Publish online performance | Only with active performer grant | Same | Same | Only if explicitly granted capture capability |

Existing Google or guest identity supplies the internal `userId`; room membership
supplies a server-generated random UUID `memberId`, used as the public participant
ID for room operations. Keep the existing internal numeric user key for database
relations. The chosen display name is a label, independent of either identifier.
Generate membership IDs with a cryptographically secure UUID generator and enforce
uniqueness in the database. Guests do not choose or type their IDs.

Restore the same membership and participant ID after refresh/reconnect using the
stored authenticated guest session. Do not create a new guest on every join-page
load. If the session is lost, the same display name alone cannot recover it.
Two devices signed into the same account resolve to one membership. Presence
counts members, with separate device status underneath.

For a guest's second device, offer explicit pairing. The admitted member requests
a code on the first device; redemption creates a revocable, room-scoped device
grant bound to that membership. Pairing never copies the global bearer token.
Default paired capability is display-only. A controller grant requires the member
to select it and inherits only permissions still held by that member. Store the
grant secret hashed; keep the client credential scoped to that device session.

Proposed defaults: pairing expires in two minutes and is single-use; invitations
expire with the room, may be rotated, and cannot bypass a locked room. Generate
human codes cryptographically, enforce uniqueness, and rate-limit redemption.
Use an eight-character unambiguous alphabet for invitation codes as a starting point.

All admission and permission checks run on the server for every command and
subscription. Pending/rejected members receive only their own admission state.
Removal revokes room device grants, closes room subscriptions, and revokes active
media publishing/subscription access. A block is tied to the known identity;
anonymous users can obtain new identities, so approval and invitation rotation
remain useful controls. Do not promise permanent person-level guest bans.

### 4.1 Implemented moderation policy

The People panel lets the host appoint or demote co-hosts and transfer ownership
to any other admitted member. Transfer is atomic: the old host becomes an ordinary
member, the recipient becomes the sole host, and connected views update from the
committed snapshot. Paired phone controllers check the member's current role on
every operation; a role change does not preserve privileges in an old grant.
After host controller loss, the server transfers ownership to the earliest-appointed connected co-host after the configured grace period (30 seconds by default). Paired displays do not count as host controllers. Without a connected host/co-host controller, the queue is preserved and automatic next-turn invitations wait.

Co-hosts can approve or decline pending ordinary guests, remove or block ordinary
members, restore their access, approve queue priority, remove queue entries, and
change the admission/lock settings. They cannot change roles, moderate another
co-host, rotate invitations, transfer ownership, or close the room. Only the
current host sees the invitation code. Paired displays show admitted members and
the queue, with admission requests and moderation history omitted.

Declined guests can read their own admission state, with no admitted room data.
Removed or declined identities cannot rejoin through the invitation alone; a
host or co-host can restore them from the Not in room list. Blocking additionally
requires an explicit unblock before restoration. Unblocking leaves the member
removed. Restoration keeps the original member ID, resets elevated roles, leaves
held songs on hold, and never reactivates revoked device grants or socket tickets.
Device-grant revocation commits with removal, rejection, or block; outstanding
tickets and live sockets are revoked after that transaction commits.

Moderation commands use these POST routes under `/api/ktv/rooms/:id`:

| Route | Payload | Authority |
| --- | --- | --- |
| `/members/:memberId/approve` | `commandId` | Host/co-host; pending or excluded ordinary member; not blocked |
| `/members/:memberId/reject` | `commandId` | Host/co-host; pending ordinary member |
| `/members/:memberId/remove` | `commandId` | Host/co-host; admitted/pending ordinary member |
| `/members/:memberId/block` | `commandId` | Host/co-host; ordinary member |
| `/members/:memberId/unblock` | `commandId` | Host/co-host; blocked ordinary member |
| `/members/:memberId/role` | `role: member or cohost`, `commandId` | Host; admitted member |
| `/members/:memberId/transfer-host` | `commandId` | Host; another admitted member |

The host can also moderate co-hosts. Mutations, audit event, revision, and command
receipt commit in one SQLite transaction. A retry with the same ID and payload
returns the current authorized snapshot without repeating the mutation, including
after the transferring host loses its role. Legacy clients may omit the command
ID for approve/remove; the updated client always supplies it. Co-host appointment
time (`cohost_at`) and block time (`blocked_at`) are additive membership columns,
preserving the original role/admission checks, foreign keys, and unique-host index.

## 5. Existing code and integration constraints

This inventory describes source inspected on 2026-09-29, not production readiness.

| Existing code | Reuse / required change |
| --- | --- |
| `src/views/Karaoke.vue` | Song selection and solo UX reference |
| `src/components/Lyrics/KaraokeGuide.vue` | Reuse presentation and lyric calculations; inject playback position/actions instead of directly controlling the solo store |
| `src/utils/lyricsTiming*`, `src/utils/lyricsOffset*` | Reuse parsing/timing helpers; room timing corrections need shared state |
| `src/services/lyricsService.ts` | Reuse server LRC cache, LRCLIB fallback, and plain lyric support |
| `src/services/karaokeService.ts` | Existing availability manifest; extend with aligned/versioned asset metadata |
| `src/stores/player.ts` | Solo playback reference; its local queue, source swapping, and end handling cannot become room authority |
| `src/stores/auth.ts`, `src/services/api.ts` | Existing guest/account bootstrap and HTTP authentication |
| `src/composables/useMicDevices.ts` | Reuse device selection and microphone lifecycle where appropriate |
| `src/composables/useMicMonitor.ts`, `useKaraokeRecorder.ts` | Audio graph reference; the recorder's documented periodic resync is insufficient as a party synchronization engine |
| `src/config/index.ts` | Reuse media URL helpers, including imported-song routing |
| `server/index.js`, `server/db.js` | Express and built-in Node SQLite; add modular room services and migrations |
| `scripts/karaoke/separate.py` | Instrumental generation; optional later retention of separated vocals |
| `src/App.vue`, `vite.config.ts`, `src/main.ts` | Global player, recorder, shortcuts, PWA updates/cache, and proxy behavior need explicit party handling |

Party audio must acquire application audio ownership: pause solo playback, disable
solo auto-advance/shortcuts and floating recording for the active party view, and
release ownership on exit. Do not automatically resume a previous solo song.
Only the server advances the party queue, even if multiple devices emit `ended`.

Use a playback-view interface for the lyric component: current song, duration,
audible position, lyric offset, state, allowed actions, and callbacks. A member's
tap on a lyric must not bypass host seek permissions.

## 6. Architecture and technology choices

| Component | Proposed implementation | Responsibility |
| --- | --- | --- |
| Party frontend | Existing Vue 3, TypeScript, Pinia, router, i18n | Views, room state, command feedback |
| Control API | Existing Express, modular `/api/ktv` routes | Rooms, admission, snapshots, command submission |
| Realtime control | Node `ws` server + browser native WebSocket | Snapshots, clock samples, readiness, presence, acknowledgments |
| Room domain | Server-side serialized command processing | Permissions, fair queue, revisions, playback transitions |
| Persistence | Existing SQLite with transactions and migrations | Rooms, membership, requests, recovery checkpoints, receipts |
| Audio assets | Existing HTTP media origins and URL resolver | Versioned originals, instrumentals, lyrics, optional vocal stems |
| Party audio engine | Web Audio, initially decoded buffers | Scheduled playback, gains, output timing, drift handling |
| Live performance | WebRTC through an SFU, with TURN fallback | Deliver mixed performance to remote audiences |

The `ws` choice is a proposal: it fits the existing Node service and browser
WebSocket API. Reconnect, authentication, heartbeat, and snapshots are explicit
application responsibilities. [Official ws documentation](https://github.com/websockets/ws)

Start with one room-service process sharing the existing HTTP server. SQLite
persists decisions; in-memory state holds sockets, readiness, clock samples, and
leases. All writes for a room pass through one command processor. A later
multi-process deployment needs a single owner per room plus shared routing/events;
adding more Node workers alone would create competing playback authorities.

## 7. Data model and invariants

Proposed tables; exact migration syntax belongs to implementation.

| Table | Principal fields / constraints |
| --- | --- |
| `ktv_rooms` | `id`, name, mode, lifecycle, settings JSON, revision, created/closed/expires timestamps |
| `ktv_members` | random UUID `id`, room/user IDs, `display_name`, room role, admission state, joined timestamp; unique room/user; at most one host per room |
| `ktv_invitations` | room ID, hashed code/token, expiry, revocation and usage metadata |
| `ktv_device_grants` | membership ID, capabilities, hashed credential, expiry, revocation |
| `ktv_pairings` | membership ID, hashed one-time code, capabilities, expiry, redeemed timestamp |
| `ktv_queue_entries` | unique entry ID, room/song IDs, requester/singer IDs, order/round data, priority request, state |
| `ktv_playback` | room ID, entry ID, performance ID, playback generation, state, checkpoint position, pinned assets/lyrics, room lyric correction |
| `ktv_command_receipts` | scope, actor, command ID, payload hash, outcome/revision, expiry; unique scope/actor/command |
| `ktv_room_events` | bounded audit trail of admissions, moderation, host changes, queue and playback actions |

Foreign keys and indexes cover room/member lookup, invitations, queue ordering,
and receipt lookup. Commit mutation, revision increment, audit event, and receipt
together, then broadcast the committed state. Do not store an audio playhead every
frame. Save checkpoints on transitions and periodically during playback.

Invariants:

1. One host membership and one active performance per open room.
2. One designated physical-room output lease; viewers default to muted.
3. The room server owns queue order and timeline decisions. Devices report observations.
4. All side effects derive from validated membership and capabilities.
5. Entry IDs distinguish repeated performances of the same song.
6. `playbackGeneration` increases whenever scheduled audio becomes obsolete
   (seek, pause/resume, skip, source replacement, or output reassignment).
7. Room state revisions are monotonically increasing, including across restarts.
8. Restart creates a new clock ID, invalidates leases, and restores playback paused.
9. Personal guide volume/calibration never changes another person's mix.
10. Invitation credentials, device secrets, and emails are excluded from room snapshots.

## 8. HTTP and WebSocket contracts

### 8.1 Proposed HTTP surface

| Method / path | Behavior |
| --- | --- |
| `POST /api/ktv/rooms` | Create room and host membership atomically; idempotent command ID |
| `POST /api/ktv/join` | Redeem invitation with validated `displayName`; create/reuse random-ID membership and return pending or admitted state |
| `GET /api/ktv/rooms/:id` | Current caller-authorized snapshot |
| `POST /api/ktv/rooms/:id/commands` | Submit a validated room command |
| `POST /api/ktv/rooms/:id/pairings` | Create a scoped device pairing |
| `POST /api/ktv/pairings/redeem` | Exchange a code for a room device grant |
| `POST /api/ktv/rooms/:id/socket-ticket` | Issue a short-lived, single-use connection ticket |
| `POST /api/ktv/rooms/:id/media-token` | Online phase: issue narrowly scoped SFU access |
| `GET /api/ktv/rooms/:id/assets/:songId` | Authorized asset descriptor with versions and timing metadata |

The room command service is shared by HTTP and WebSocket transports. HTTP is a
control fallback, not a claim that synchronized playback works without realtime
connectivity. Pending membership can obtain only a waiting-room subscription.

Browser WebSocket connections use `wss://.../api/ktv/ws`. Obtain a connection ticket
through authenticated HTTP and send it as the first protocol message. Do not put
long-lived authentication in URLs. Until authentication completes, send no room
data; enforce a short timeout, origin allowlist, and connection/message limits.
Authorize paired device grants independently of the global API bearer interceptor.

### 8.2 Versioned messages

Illustrative command (all times and positions in milliseconds unless named otherwise):

```json
{
  "protocolVersion": 1,
  "type": "command",
  "roomId": "room_...",
  "commandId": "random-uuid",
  "baseRevision": 42,
  "action": "queue.request",
  "payload": { "songId": 42, "singerMemberId": "member_..." }
}
```

Server messages include `snapshot`, `ack`, `error`, `clock.reply`, `presence`,
`prepare`, and `lease`. Client messages include `command`, `clock.probe`,
`device.ready`, `device.status`, and `heartbeat`.

Durable commands cover room settings/close, admission, member removal/roles,
invitations, queue request/cancel/move/priority approval, stage assignment, and
playback prepare/start/pause/resume/seek/skip. Readiness/status messages include
device ID, performance ID, generation, pinned asset version, and clock ID.

Use a full authorized snapshot after each durable room mutation initially. This
keeps recovery simple for small rooms. All admitted subscribers receive the new
revision, with role-dependent fields redacted; presence/telemetry has its own
sequence and does not increment the durable revision. A newer full snapshot can
replace an older one without replaying intermediate revisions. Never apply a
snapshot from another clock epoch to an existing scheduled audio source.

Mutation handling:

1. Authenticate and check current admission/capabilities.
2. Check command receipt. Same ID and payload returns the prior outcome;
   same ID with a different payload returns `COMMAND_CONFLICT`.
3. Validate `baseRevision`, payload, and domain rules.
4. Commit mutation and receipt atomically; acknowledge the committed revision.
5. Broadcast snapshots. On `REVISION_CONFLICT`, fetch state and let the caller
   deliberately resubmit against it; do not blindly replay an obsolete seek/skip.

Use a bounded receipt retention period at least as long as the reconnect retry
window, initially 24 hours. Room creation/join receipts are scoped to authenticated
identity and command UUID; room commands are scoped to room/member/UUID. Pairing
creation and redemption recover the original result, encrypted with AES-256-GCM at
rest. Redemption retries recheck current room, membership and grant revocation
before returning a credential. A different UUID cannot reuse a consumed code.
A closed-room reply can be replayed with its original close UUID, including by its
original paired controller; that narrow reply does not authorize any other action.

The browser keeps at most 100 pending command IDs plus payload hashes in session
storage for 24 hours. It stores no invitation/pairing codes, names, credentials or
room snapshots in this journal. Network failures, 5xx, 408 and 429 retain the ID;
success or definitive denial ends the attempt. Reloading the same tab and explicitly
retrying the same unresolved intent reuses its UUID. A new action after a successful
reply gets a new UUID. Existing queue/readiness/playback commands retain their
explicit UUID and revision/generation contracts. After an unknown outcome outside that window, fetch
state and require a new explicit action. Reconnect uses exponential backoff with
jitter, fresh authentication, a full snapshot, and new clock samples.

Errors include `NOT_ADMITTED`, `ROOM_LOCKED`, `ROOM_CLOSED`, `FORBIDDEN`,
`REVISION_CONFLICT`, `QUEUE_LIMIT`, `ASSET_UNAVAILABLE`, `STALE_GENERATION`,
`DEVICE_NOT_READY`, `LEASE_EXPIRED`, and `PROTOCOL_UNSUPPORTED`.

### 8.3 Implemented clock and singer readiness contracts

HTTP and socket snapshots include `clock: {clockId, serverNowMs}`. The UUID clock
ID identifies one service epoch; `serverNowMs` is monotonic milliseconds since
that service's clock origin. It is independent of wall time. HTTP snapshot time
alone is not a calibration sample. Admitted sockets can send:

```json
{"protocolVersion":1,"type":"clock.probe","probeId":"random-uuid","clientSendMs":1234.5}
```

The `clock.reply` echoes `probeId` and `clientSendMs` and contains `roomId`,
`clockId`, `serverReceiveMs`, and `serverSendMs`. Authorization is rechecked for
each probe; pending/declined guests cannot probe. Each socket allows 20 probes per
10 seconds, with a 1 KiB message cap. Probe traffic does not change room revision.

The browser sends eight initial samples 300 ms apart, then one every 10 seconds.
It matches replies to outstanding probes and captures receive time with
`performance.now()`. The estimator keeps at most 24 samples from the last minute,
prefers samples with low network round trip, and uses their median offset.
Uncertainty includes half the selected median round trip plus offset dispersion.
Three samples and estimated uncertainty at most 50 ms label the room clock healthy;
estimates become stale after 30 seconds without a reply. These are clock health
thresholds, not measured acoustic alignment. New connections/epochs and foreground
recovery collect fresh samples. HTTP polling does not report a healthy audio clock.

Singer readiness has a separate durable `ktv_readiness` row for each room. Its
states are `idle`, `awaiting-singer`, and `ready`. It carries a selected `entryId`,
UUID `performanceId`, monotonically increasing `generation`, and `clockId`.
The UI's ready state confirms the person. Asset decoding, stage readiness, leases
and the playback timeline have separate state in the playback preview (section 9.6).

| POST under `/api/ktv/rooms/:id` | Behavior |
| --- | --- |
| `/queue` with optional `singerMemberId` | Nominate an admitted singer, or default to self |
| `/queue/:entryId/accept` or `/decline` | Only that singer can accept or decline; `commandId` required |
| `/readiness/offer` | Host/co-host selects an eligible accepted entry; requires `entryId`, `clockId`, `baseRevision`, `commandId` |
| `/readiness/respond` | Selected singer confirms `ready: true` or declines the turn; requires current performance/generation/clock, revision and command ID |
| `/readiness/cancel` | Host/co-host cancels the invitation, preserving the queued song; requires current performance/generation/clock, revision and command ID |

The selected entry stays at the front of the materialized queue while awaiting
confirmation or ready. Replacing or cancelling it, declining the turn, cancelling
the queue entry, or removing its singer invalidates the generation. Commands with
a stale epoch, generation, or room revision fail without changing the selection.
Receipts commit with state/revision/audit changes; identical retries return the
current authorized snapshot and never reconfirm an obsolete turn.

Startup preserves eligible selection but replaces the performance ID, increments
generation and room revision, and requires the singer to confirm again under the
new clock. It never restores ready automatically or starts audio. Additive
`accepted_at` metadata backfills prior self-requests as accepted.

## 9. Playback state and synchronized audio

### 9.1 State transitions and authority

Playback states: `idle`, `preparing`, `scheduled`, `playing`, `paused`, and
`recovering`. Completion updates the entry to `finished` and selects a new entry
for readiness; it does not immediately start another song without readiness.

The server selects assets and a new generation, then sends `prepare`. Required
devices are the physical stage or online publisher, plus the active singer's guide
device when the singer marks guidance required. Spectators and optional guides do
not hold up the room. A preparation timeout offers retry, skip, or explicit
continue-without-guide; it never silently substitutes an original for a missing instrumental.

When readiness succeeds, announce a start in the future. Initial scheduling lead
is two seconds, adjustable after measurements. Late or suspended devices do not
start at zero; they request recovery and join the current position when prepared.

Pause/resume/seek use versioned scheduled transitions. The old timeline remains
effective until the new transition time; clients must not jump their UI or audio
when the message arrives early. Pause captures the position at its effective time.
Seeking creates new scheduled sources and cancels old ones. Skip cancels the
current generation and enters the next readiness cycle. Emergency room close or
revocation stops immediately; seamless timing is secondary in that case.

The stage reports actual playback/buffer state; it cannot rewrite the canonical
timeline. An `ended` report must match the active device lease, entry, and
generation. The server accepts completion once, with duration/timeline validation.

### 9.2 Clock mapping and timeline

Use server monotonic milliseconds under a `clockId` unique to the running process.
Use `performance.now()` on clients. Wall-clock timestamps are for history and
expiry, not audio scheduling. A server restart invalidates old clock mappings.

For a probe sent at client `c0`, received at server `s1`, replied at `s2`, and
received at client `c3`:

```text
estimated server-minus-client offset = ((s1 - c0) + (s2 - c3)) / 2
estimated network round trip = (c3 - c0) - (s2 - s1)
estimated server time = client performance.now() + offset
```

Collect several samples, prefer low-round-trip samples, smooth the estimate, and
report uncertainty. Asymmetric network paths can still bias this estimate. Refresh
periodically and after visibility, network, or audio-device changes. Clock health
and hardware calibration are different measurements.

An active timeline contains:

```ts
interface PartyTimeline {
  clockId: string
  performanceId: string
  playbackGeneration: number
  state: 'idle' | 'preparing' | 'scheduled' | 'playing' | 'paused' | 'recovering'
  anchorServerMs: number
  positionMs: number
  rate: number // initially always 1
  durationMs: number
}
```

For the active playing segment:

```text
song position = clamp(positionMs + (serverNowMs - anchorServerMs) * rate,
                      0, durationMs)
```

Before a scheduled start, hold `positionMs`; when paused, hold the captured
position. Store a pending transition separately until it becomes effective.
Never extrapolate through a pause, buffering recovery, or obsolete generation.

### 9.3 Audio engine and assets

Prototype with decoded `AudioBuffer`s and scheduled `AudioBufferSourceNode`s.
Map server time to the local audio clock; render progress from that mapping,
rather than broadcasting `timeupdate` as a clock. Sources are recreated for seeks
and restarts, with short gain ramps to reduce clicks. Web Audio provides scheduled
source starts and output timestamp APIs. [Web Audio specification](https://www.w3.org/TR/webaudio/)

Each asset descriptor pins original, instrumental, lyrics, duration, asset version,
and any measured alignment offset. Use the same source recording. Verify decoded
start alignment and duration; equal filenames/durations alone are insufficient.
Include imported songs and missing LRC/stem cases in validation. Pin one lyric
revision per performance so clients cannot fetch different lyric timing mid-song.

A four-minute stereo float32 buffer at 44.1 kHz occupies about 81 MiB, calculated
as `240 * 44100 * 2 * 4` bytes. Each device loads only its required assets; release
completed buffers and bound preloading. Memory and decode time on real phones are
an early gate. If whole-track decoding is unsuitable, evaluate media-element or
chunked playback behind the same interface and re-measure precision. Do not assume
a fallback has equivalent synchronization.

The private guide initially plays the original mix with a personal volume control.
Optional later vocal stems enable independent guide/backing gain. A controller
does not automatically produce audio. Starting audio requires a user gesture;
provide `Enable stage audio` and `Enable private guide` actions and handle rejected
playback. [Browser autoplay guidance](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay)

### 9.4 Audible alignment and calibration

Track four distinct quantities: network/clock uncertainty, local rendering delay,
external output delay, and recording/input delay. `outputLatency` and
`getOutputTimestamp()` help estimate the local audible timeline; Bluetooth,
HDMI/TV processing, and acoustic distance can require measured correction.
Browser estimates are not proof of end-to-end alignment.
[Audio output latency](https://web.dev/articles/audio-output-latency)

Use one output-time mapping so latency is not counted twice. Asset alignment,
device calibration, and lyric correction are separate values with separate UI.
For private guide calibration, define positive `guideAdvanceMs` as playing the
guide earlier relative to the scheduled audible stage event. `Earlier` increases
that value; `Later` decreases it. Save it for the device/output setup and invalidate
or ask for recalibration after an output change. Provide a click-track comparison.

Room lyric correction applies to the pinned lyric source, shared across devices;
positive correction delays lyric cues. A remote viewer applies that correction
to the received performance timeline. Never use a lyric offset to fix audio delay.

Proposed target: absolute guide-to-stage acoustic timing error at or below 50 ms
for 95% of sampled positions during a five-minute song on a documented supported
setup, with 30 ms as a stretch target. This is unvalidated. Measure outputs using
recorded click tracks/loopback; JavaScript clock agreement alone cannot pass it.
Wired headphones are the first reference setup. Record Bluetooth results separately.

Drift policy: leave small errors alone; for persistent small drift, evaluate bounded
rate adjustment with listening tests for pitch artifacts. For large errors, fade
the guide out, reschedule at the current position, and fade in. Thresholds must
come from the prototype. Stage instability pauses/reprepares the room; an optional
guide failure affects that guide only. Required-guide failure pauses the performance.

### 9.5 Output leases and recovery

The designated stage holds a generation-bound renewable output lease. Other local
views remain muted. A lease expires against the shared clock; the audio engine
schedules a gain-to-zero deadline that is extended only by valid renewals. Merely
checking a JavaScript timer is insufficient when a tab is suspended.

The server grants a replacement only after the old lease expires or its holder
acknowledges stopping. Add a margin for already-buffered hardware audio. Clients
returning from suspension validate the lease before making sound. These rules also
apply to online publishing authority, with media-server revocation as enforcement.

Lease messages carry a monotonically increasing lease sequence, generation, and
absolute expiry. Ignore stale renewals and never extend an obsolete generation.
The replacement start time must allow for clock uncertainty on both devices as
well as the measured output-buffer margin; server expiry alone does not establish
that the previous device has become acoustically silent.

If the stage/publisher disappears, enter recovery, preserve a validated position,
and require ready devices before resuming. A server restart restores the latest
checkpoint paused, never extrapolates downtime, and issues a new clock ID.

Host-device loss does not immediately stop a healthy performance: host is a member,
not a socket. A connected co-host may continue controls. After a configurable grace
period, transfer ownership to the earliest-appointed connected co-host atomically;
without one, preserve the queue and pause before the next song until the host returns
or the room expires. Do not promote an arbitrary guest.

### 9.6 Implemented playback preview

`server/ktv-playback.js` persists the selected performance, pinned descriptor,
timeline, pending transitions, lyric correction and five-second checkpoints.
Host/co-host POST commands under `/rooms/:id/playback` are `assign-stage`,
`prepare`, `start`, `pause`, `seek`, `skip`, and `lyrics`. The selected singer can
use `guide` to require or release a separately bound private guide phone. Commands carry IDs,
current room revision and clock epoch; performance controls also carry the current
performance ID and playback generation. Preparation uses the singer-readiness
generation. Duplicate committed commands return the authorized current state.

Sockets identify a browser instance via `deviceId` in the socket-ticket request.
`device.status`, `device.ready`, `device.heartbeat`, `device.stopped`, and
`playback.ended` messages are authorized against that socket's principal. Device
presence and lease telemetry do not change the durable room revision. Displays
can enable designated stage output but cannot issue moderator controls. Only the
selected singer's controller can prepare a private guide.

The preview starts two seconds in the future. Pause and seek retain the previous
segment until their effective time; a seek pre-schedules one replacement source.
Output leases last eight seconds, renew every two seconds, and carry increasing
sequences. Lease renewals reach guides as well as the stage. A stopped-device
acknowledgment or expiration allows replacement after a 500 ms buffer margin.
Startup waits for an old process's maximum lease window plus that margin and
restores the persisted checkpoint paused under a new epoch, with no designation.
These margins are implementation defaults; physical acoustic silence and Bluetooth
behavior still require measurement before a supported-device claim.

Descriptors hash original/backing files and lyrics, include ffprobe durations,
and use versioned media queries to bypass the existing PWA solo audio cache.
The browser verifies hashes before decoding, loads one required buffer, limits
encoded files to 32 MiB and decoded buffers to 192 MiB, and rejects duration
mismatches over 250 ms. The server caps duration at ten minutes and lyric files
at 128 KiB. Missing backing never falls back to the original. Unknown alignment
is marked `alignmentVerified: false`; equal durations do not prove alignment.

The audio engine maps output timestamps once and falls back to output/base latency
estimates. Stage and private-guide volume are separate. Positive guide calibration
advances the guide; room lyric correction delays displayed cues. Browser scheduling
and source cancellation have automated evidence. Required-guide readiness, automatic
next-turn selection, and automatic host-loss transfer are implemented and tested.
Browser-rendered drift and output-change recovery are implemented with automated
unit and production-browser evidence. Physical timing
and streaming remain open.

The singer's versioned, receipt-backed `guide` command carries `required` and a
socket-bound `deviceId`. Only that singer's separate controller can be bound;
a display, another member's phone or the designated stage cannot substitute.
Guide readiness validates the original's pinned duration, rather than assuming it
matches the backing duration. Current-generation guide heartbeats must remain
fresh within four seconds. Optional guides do not block backing; losing a required
guide enters recovery, increments generation and preserves the selected turn.
The stage stops renewing its output lease, and the client stops output and
acknowledges it. A retry/rebound guide, or the singer's explicit optional choice,
allows a deliberate resume after stage readiness and the old silence boundary.
Server restart preserves the requirement but drops the old guide device binding.
Prepared guide generations promote at scheduled seek/pause boundaries.

Finished, skipped and declined selected turns append unique-entry served history.
`server/ktv-turns.js` selects the next accepted, admitted, unheld fair entry (or an
approved priority override) and creates a fresh awaiting-singer performance ID.
It never auto-starts the song. A nomination declined before selection does not
consume a turn. A durable `advance_pending` marker waits for a connected host or
co-host controller if all controlling moderators disappear, including across
service restart. Explicit moderator cancellation preserves the queued song and
clears automatic advancement. Ordinary guests are never promoted automatically.

Host presence aggregates all of the member's current controller sockets, including
valid paired controllers; read-only display sockets are excluded. Losing one of
several controllers does not start a grace period. Healthy backing continues
through host loss. `KTV_HOST_GRACE_MS` accepts 1000–300000 ms, default 30000.
After grace, the earliest-appointed admitted co-host with a connected controller
becomes the sole host in one transaction, with revision/audit/broadcast. The old
host becomes an ordinary member. Reconnection cancels the grace deadline; explicit
ownership transfer starts presence tracking for the new host.

### 9.7 Rendered timing diagnostics and output recovery

The engine samples its rendered source position against the canonical timeline
once per second. It uses the AudioContext output timestamp when available and
labels the output-latency fallback as an estimate. The calculation follows the
[Web Audio output timestamp contract](https://webaudio.github.io/web-audio-api/#dom-audiocontext-getoutputtimestamp).
This observes browser audio stream timing; it does not record the sound from a
TV, speaker, Bluetooth headset or microphone, and cannot establish acoustic
alignment. Hardware and external transport delay still require physical tests.

Recovery defaults are three consecutive timestamp samples outside
`max(80 ms, 2 × clock uncertainty + 25 ms)`, or one sample outside
`max(250 ms, 4 × clock uncertainty + 50 ms)`. Estimate-only timing cannot trigger
measured-drift recovery. Scheduled countdowns, transitions and not-yet-audible
sources are excluded. A fault fades out over 20 ms, stops lease renewal/readiness,
and blocks the device until an explicit retry. A stage or required-guide fault
enters room recovery; an optional guide stops only its phone. Retry prepares the
device and never starts the room automatically. Thresholds are conservative
implementation defaults, not a measured supported-device claim.

A sink-change event, observed audio-output fingerprint change, browser output
latency jump over 40 ms, or loss of previously available output timestamps
invalidates the output mapping. Audio-output enumeration
follows the [Media Capture device-change contract](https://w3c.github.io/mediacapture-main/#event-mediadevices-devicechange);
permission/browser visibility may limit what can be observed. Microphones and
cameras do not contribute to the fingerprint. Only a SHA-256 fingerprint is
stored locally; raw device identifiers stay in memory and are never sent to the
room service or logs. The guide's timing correction resets to zero, and the UI
requires output confirmation/retry. A manual reset is available when the browser
does not expose a change. Physical headphone/Bluetooth detection remains an
acceptance gate.

Late attachment allows the reported browser output latency plus scheduling
headroom, so a slow output cannot force an impossible audio-clock start. The
optional diagnostics show calculated sample phase, browser output latency,
timestamp-versus-estimate mode and decoded audio memory; they explicitly describe
their limits. Device status can report only `drift`, `output`, `decode` or
`suspended` faults. A stale asynchronous decode response cannot clear a fault or
restore readiness after recovery.

## 10. Online and hybrid performance streaming

### 10.1 Audio routing

| Output | Sources |
| --- | --- |
| Singer headphones | Backing and optional private original/vocal guide |
| Published performance | Backing plus singer microphone, with gain/limiting and measured recording alignment |
| Remote audience | One received performance mix |
| Physical stage | One room backing output for a local singer, or the received mix for a remote singer |

Use separate monitor and publish graphs. The original guide has no connection to
the published graph. Headphone leakage into the microphone still needs a physical
listening test. When the guide is the full original mix, avoid also summing another
full-strength backing copy into the headphones. Microphone sidetone is optional and
local; never route an internet round trip into a singer's monitoring path.

Publishing a mixed track keeps backing and singing together during transport, but
does not fix capture delay: the singer hears backing after output latency, and the
microphone returns after input latency. Measure that path and delay/align the backing
in the publish graph. Align displayed/captured lyrics with the resulting published mix.

For physical-room broadcasting, choose one tested capture path: a microphone feed
mixed with clean backing, or a venue mixer feed already containing both. Do not
add backing twice to a venue mix. Remote performers use one performing device for
monitoring, capture, and publication initially; optional paired phones follow its
performance timeline. Changing performance source requires a fresh readiness cycle.

### 10.2 Transport, audience lyrics, and permissions

Use an established WebRTC SFU for distribution; it forwards the already mixed
performance. Provision TURN for networks that require relaying.
[WebRTC TURN documentation](https://webrtc.org/getting-started/turn-server)
LiveKit is a candidate, pending a deployment/cost/device spike. Server-issued room
tokens can scope publish and subscribe permissions.
[LiveKit authentication](https://docs.livekit.io/frontends/build/authentication/)

The room service grants publishing only to the current performer/device/generation.
Audience tokens subscribe only. Kick, room close, performer replacement, or lease
expiry must call the media server to remove/restrict the participant and invalidate
future joins; waiting for token expiry is insufficient. No peer mesh is planned.

Verify those revocation semantics for the chosen provider and hosting mode. If an
old token can reconnect after removal, require a supported admission/revocation
mechanism or revise the media deployment before release; application-side token
issuance checks alone cannot prevent direct reuse against the media server.

Remote audiences hear a delayed performance. Their lyrics must follow the received
media, not the current control-server playhead. Proposed first approach: render
the lyric stage on the publisher, capture it as a video track, and transmit it with
the mixed audio through the same WebRTC publisher. Audience pages display that
synchronized lyric video with local queue/participant controls around it. Validate
capture support, mobile load, and actual audio/video synchronization in the spike.

A later native DOM lyric view needs a tested mapping from received media timestamps
to song position, accounting for jitter-buffer playout. A WebSocket song position
or data message arrival time alone cannot supply that mapping. If captured lyric
video is unsupported, treat a plain/manual lyric view as a labeled degraded mode;
do not claim precise remote lyric sync until another method is validated.

Measure end-to-end streaming latency separately from local guide alignment.
Remote audiences must not play a second independent instrumental underneath the
received mix. Group conversation, echo management, video cameras, and simultaneous
remote duets are separate extensions; initial performance microphone access belongs
to the current singer/capture device only.

## 11. Operational behavior and limits

Implemented defaults: 20 members per room, the original browser plus two paired
device grants per member, three pending songs per singer, 100 queued entries,
12-hour maximum room lifetime, and 30-minute empty-room expiry. An empty room has
no connected admitted device; pending guests do not keep a room alive. The UTC
empty-since timestamp persists across service restarts and clears when an admitted
device reconnects. Authorization rejects the maximum lifetime immediately; the
10-second lifecycle sweep also commits closure, cancels readiness/playback, revokes
invitations/pairings/grants, and ends room sockets. Offline audio stops by its output
lease deadline. Expiry emits a single audit event and never starts another song.

Receipt retention defaults to 24 hours, closed room history to seven days, and audit
history to the latest 1000 events per room. Cleanup removes expired receipts and
obsolete pairings/grants, then purges old closed rooms with cascading foreign keys.
The mutation and its receipt commit together; closure and revocation commit before
socket updates. Configurable bounds are validated at startup; history must cover
the receipt window. `.env.server.example` lists the `KTV_*` settings. Member, queue
and paired-device settings may lower the implemented ceilings; these ceilings are
not load-tested capacity claims.

HTTP room requests enforce an exact same-host origin or configured allowlist,
16 KiB request size, and a 600-request/minute socket-peer budget with `Retry-After`.
Direct bearer/device clients may omit Origin. Behind a proxy this budget is aggregate;
forwarding headers cannot evade it. Invitation lookup/join and unauthenticated
pair redemption retain their tighter 20-attempt/minute limits and bounded in-memory
buckets. WebSockets retain their ticket, connection, payload and action limits.

| Failure | Required behavior |
| --- | --- |
| Guest/controller reconnects | Restore membership, fetch full state, refresh clock, no duplicate queue action |
| Guide is interrupted or phone locks | Mark suspended; recover on foreground; required-guide policy determines pause |
| Stage stalls/disconnects | Stop advancing, expire output lease, reprepare or reassign |
| Missing/changed audio asset | Show unavailable/retry; pin revisions and prohibit mid-song replacement |
| No synced lyrics | Show plain/manual lyrics with a clear label |
| Host loses one device | Keep membership and other devices active |
| Member is removed | Close room sockets, revoke device/media grants, stop active participation |
| Backend restarts | New clock epoch, paused checkpoint recovery, no stale audio schedules |
| Incompatible frontend protocol | Clear reload-required state; do not partially apply messages |

Use HTTPS/WSS, explicit room origin policy, message size/action rate limits, escaped
display names, and server-side authorization. This does not require changing global
app roles. Room moderation protects room participation; existing publicly served
music URLs do not become private merely because the room is private.

Configure nginx WebSocket upgrade/idle timeout and Vite `ws` proxy support for the
new path. Online transport may need separate SFU/TURN endpoints and network ports;
the ordinary HTTP proxy alone does not provide media connectivity.

Party snapshots, tickets, media tokens, and grants use `Cache-Control: no-store`;
exclude their paths explicitly from service-worker runtime caching. Audit existing
API/audio cache rules, including versioned asset URLs and Range/CORS behavior.
Defer user-triggered app reloads during performances where possible and handle
controller changes/reloads as reconnects. Browsers may suspend background audio;
publish a measured support matrix rather than promise lock-screen operation.

Record command latency/conflicts, reconnects, active rooms/sockets, readiness time,
decode/memory failures, clock uncertainty, measured/estimated drift, underruns,
lease expiry, and streaming quality. Label estimated timing separately from acoustic
measurement. Exclude credentials and raw microphone audio from diagnostics.

## 12. Decisions to validate

| Decision | Working proposal | Validation point |
| --- | --- | --- |
| First public mode | Local first; online/hybrid remain planned | Before selecting release scope |
| Realtime transport | `ws` + native browser WebSocket | Room protocol implementation |
| Audio playback | Decode required current-song assets into buffers | Two-device sync/memory spike |
| Sync target | 50 ms p95 on a documented setup | Acoustic measurement |
| Background/BT support | Supported only where measured | Device matrix |
| Lyrics for remote audiences | Publisher-captured lyric video | Streaming spike |
| SFU deployment | Evaluate LiveKit; hosted vs self-hosted undecided | Streaming spike |
| Room/queue limits | Defaults in section 11 | Load test and usability review |
| Independent vocal control | Keep original mix initially; retain stems later | Asset pipeline extension |

Implementation phases, acceptance scenarios, evidence, and decisions are tracked
in [ktv_party_implement.md](ktv_party_implement.md). Update this design when a decision
changes so implementation and architecture remain consistent.
