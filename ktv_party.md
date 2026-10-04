# KTV Party — Design and Architecture

Created: 2026-09-29

Status: Incremental implementation. Rooms, live queue planning, device pairing,
moderation, singer nomination/readiness, clock negotiation, and a local scheduled
playback/private-guide preview are implemented. Streaming and physical audio
validation remain open. See the progress tracker for
deployment evidence and remaining work.

Progress tracker: [ktv_party_implement.md](ktv_party_implement.md)

Implemented protocol, identities, permissions and timing contracts:
[ktv_party_protocol.md](ktv_party_protocol.md)

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
  singer's configured request cap. Declining a nomination cancels that unique queue entry.
- Default fairness: one song per eligible singer per round, ordered by first
  pending request, with each singer's requests in their own submission order.
  New singers join the end of the current unserved round. A completed, skipped,
  or declined turn counts as served; deleting and re-adding requests does not reset it.
- Materialize and display the actual upcoming order. An accepted `Request next`
  or host move creates a visible manual override, then normal rotation resumes.
- The host can use `Move next` on an accepted, unselected request, or return that
  request to fair order. Overrides persist across restart; the actual next-turn
  selector and every snapshot use the same order. Concurrent edits require the
  current room revision, so a stale drag/move cannot overwrite a newer decision.
- Default cap: three pending requests per singer, configurable by the host from
  one to ten. Lowering the cap preserves existing requests and blocks additional
  requests/assignments until the recipient is below the cap.
- Allow the same song for different turns; warn about an existing request.
  Queue entries have unique IDs even when their song IDs match.
- Members may cancel their own unstarted requests. Once performance preparation
  begins, request removal, nomination decline and priority approval cannot change
  that entry; the phone hides those actions and the server returns
  `PERFORMANCE_ACTIVE`. Hosts use the performance controls for the current song.
  Only the host creates manual queue overrides. Hosts and co-hosts can remove
  other unstarted requests and use authorized performance controls.
- Freeze the selected next entry during readiness. Ordering or reassignment of
  that entry returns `TURN_SELECTED`; cancel the singer invitation first. Other
  moves cannot displace the pinned selected turn.
- Departed singers' pending entries are held. Hosts/co-hosts can reassign or remove
  them. Reassignment preserves the entry/song/requester, clears manual priority,
  and requires acceptance by the recipient unless they made the assignment.
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
The implemented store guard also invalidates delayed autoplay/network/missing-file
retries when entering a party, removes solo media-session handlers, and suppresses
foreground auto-resume. Returning restores solo controls with the previous song
and position paused. The floating recorder remains mounted but hidden, finishes
an active take, cancels pending capture and releases its microphone on entry; its
finished take remains available when returning to solo mode.
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

Concurrent song requests share a 25 ms snapshot broadcast window. Their HTTP
replies and durable command receipts are still individual; subscribers receive
the latest authorized revision containing the accepted requests. Other room and
playback broadcasts remain immediate and cancel any pending queue broadcast.
This bounds repeated serialization during a request burst without delaying
leases or removal. `npm run test:party:load` measures an isolated server at 20
members, 60 sockets and 100 queued songs, including enforcement of those caps.

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
reply gets a new UUID. A full journal refuses new intents while allowing retries
of its existing attempts; uncertain IDs are never evicted to make room.
Existing queue/readiness/playback commands retain their
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

Output leases renewed by heartbeat arrive independently of room snapshots.
Publishing and the singer's private original use the playback controller's latest
validated lease, matched to device, clock, performance and generation. The publish
gate expires at the earlier of that lease and its media permit. A missing, expired
or mismatched lease, or a rejected render-gate renewal, releases capture and enters
an explicit error state. A stale snapshot cannot extend or truncate that current
capability.

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

An audio-clock deadline alone also fails if the audio context itself freezes:
the old source can resume after wall-clock authority has expired. Each backing
or guide source therefore passes through a rendering-thread lease guard before
both its personal monitor and publisher tap. The published backing/mic mix has
its own guard after the limiter and permit gain. The engine still validates room,
clock, performance, generation and asset identity before creating or renewing it.

The guard receives a bounded wall deadline derived from the already validated
server-clock lease, including uncertainty and output-buffer reserve. It checks
expiry on every render quantum and latches silence on backwards wall time or a
wall/render-clock discontinuity above 250 ms. This check also runs before a renewal
message can extend a live source; expired or failed guards cannot be revived.
Page callbacks report recovery and release resources when they can run again.
Native scheduled stops/gain deadlines remain in place. The hashed worklet asset
is cached with the app build, and audio enablement fails if it cannot load or its
rendering realm lacks a usable clock. Native private-output regression checks
cover blocked tasks with running and suspended clocks for stage and microphone
publication. The actual built app/backend also passes integrated replacement with
two separately captured native outputs: early restart is rejected, the new output
starts after the old safety boundary, and a frozen old render clock resumes without
reactivating expired audio while page callbacks are blocked. Physical replacement
timing and mobile compatibility remain open.

The server grants replacement playback only after the old lease expires or its
holder acknowledges stopping, plus the safety margin. A replacement screen can be
designated and prepared while the old lease is still outstanding. Add a margin
for already-buffered hardware audio. Clients
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

Small persistent rendered errors now have bounded feedback: three consecutive
timestamp samples with the same sign and magnitude above 15 ms, all within
80 ms, and clock uncertainty at most 25 ms. The local source rate stays within
0.995–1.005, changes by at most 0.0005 per one-second feedback step and uses a
half-second native ramp. This adjusts the media, not the authoritative room clock
or recovery limits. Missing/uncertain timestamps cannot authorize correction.
Larger errors keep the recovery behavior below.

The engine integrates each scheduled rate ramp for both rendered diagnostics
and publisher lyric capture. It retains recent rate history to map delayed output
timestamps across an update. A seek/next source starts with a new position history
and rate 1. Native offline rendering verifies actual PCM transitions against that
integral within 3 ms; a built-app test verifies feedback after a real 50 ms pause
of its isolated output process. The source and performance generation are retained.
Rate adjustment can change pitch slightly; physical listening, stage/phone timing
and output-change acceptance remain required. Implementation uses native
[Web Audio rate automation](https://www.w3.org/TR/webaudio/#dom-audiobuffersourcenode-playbackrate).

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
The implementation uses LiveKit client 2.22.3, server SDK 2.19.1 and a pinned
v1.13.7 self-hosted server for the loopback spike. A forced relay browser joined
the owned loopback SFU through embedded TURN/UDP; real network routing, TLS and
capacity remain deployment gates. The initial deployment recipe is in
[ktv_party_deploy.md](ktv_party_deploy.md). Server-issued room
tokens scope publish and subscribe permissions.
[LiveKit authentication](https://docs.livekit.io/frontends/build/authentication/)

The room service grants publishing only to the current performer/device/generation.
Audience tokens subscribe only. Kick, room close, performer replacement, or lease
expiry must call the media server to remove/restrict the participant and invalidate
future joins; waiting for token expiry is insufficient. No peer mesh is planned.

The spike verified that self-hosted participant removal permits direct reuse of
an old JWT. Keep the SFU signaling and administrative APIs private. A gateway
verifies JWT grants and the persisted identity nonce on every join and watchdog
check. Database triggers permanently revoke nonces when membership, paired scope,
room mode or the active generation changes. A publisher nonce expires within five
seconds and its current output lease; a replacement waits for provider removal
acknowledgment. Audience access expires within two minutes and rechecks admission.
A separate supervisor owns the SFU process and stops it on backend or revocation
failure; closing signaling sockets alone cannot stop established RTP. Public
streaming stays disabled until this deployment and failure path are verified.

The backing engine exposes an instrumental-only tap before personal monitor gain.
The original guide is decoded in a separate engine and cannot obtain a publish
tap. Publish mixing and the render-thread expiry gate operate independently of
personal volume. Captured lyrics use the rendered source position minus any
publish backing delay. Audio and video carry the same named WebRTC stream and
attach to one always-muted audience video element. Audible audio passes through
the separate receiver graph and its post-buffer deadline guard. That graph and
the native video's playout clock are separate; a shared stream/RTCP identity
does not establish synchronized output under loss. Headphone audio and publisher
render timing still require physical checks.

A second local expiry barrier sits between the publisher encoders and RTP
packetization, using a dedicated worker. It starts closed, receives only validated
current clock/performance/generation permits, and drops audio and lyric frames
after expiry independently of page callbacks and AudioContext suspension. Timer
and per-frame checks latch expired or discontinuous clocks closed; a late renewal
requires a fresh publishing session. Standard script transforms and the older
encoded-stream API share the gate. Unsupported publishing paths fail visibly.
The PCM gate becomes silent 100 ms plus clock uncertainty before expiry; the RTP
gate closes 10 ms plus uncertainty before expiry, allowing encoded silence to
replace the receiver's last vocal frame. This does not revoke server access or
erase audio already buffered at receivers. Independent native receiver checks,
impaired networks and physical outputs remain required. The gate is deployed in
the preview and passes independent Chrome 137/154 native receiver checks plus
the complete isolated room journey; public media remains disabled.
[WebRTC encoded transform specification](https://www.w3.org/TR/webrtc-encoded-transform/)

### Receiver capture clocks and controlled playout study

The private native fixture can request the supported Absolute Capture Time RTP
extension through `getHeaderExtensionsToNegotiate` /
`setHeaderExtensionsToNegotiate`. It preserves all other extensions, directions
and ordering and uses no SDP rewriting or browser feature flags. Actual Chrome
154 frames received through the owned LiveKit 1.13.7 SFU expose audio and video
capture timestamps after negotiation; the default candidate does not negotiate
this extension. This is a private experiment, not deployed playback behavior.
[Native header extension negotiation](https://w3c.github.io/webrtc-extensions/#dom-rtcrtptransceiver-setheaderextensionstonegotiate)

Encoded `captureTime` belongs to the reporting worker's performance clock domain.
Keep audio/video observations separate until their clock origins are explicitly
mapped. LiveKit normalizes Absolute Capture Time using sender reports; do not
assume its received values preserve the publisher's original wall clock.
A bounded diagnostic projects actual RTP/capture anchors using Opus 48-kHz and
video 90-kHz clocks with rollover handling. Missing/stale anchors and clock
discontinuities cannot produce guessed timestamps. Projection consistency is
diagnostic evidence and grants no output permission.
[Encoded capture timestamp semantics](https://www.w3.org/TR/webrtc-encoded-transform/),
[Pinned SFU capture-time normalization](https://github.com/livekit/livekit/blob/v1.13.7/pkg/sfu/downtrack.go)

A separate cloned-track probe confirms eight actual 1280x720 decoded video frames
with RTP timestamps in Chrome 154. Its decoded audio data is available at 48 kHz,
but uses a different timestamp domain; treating audio/video decoded timestamps as
one capture clock would be incorrect. All probe frames are closed, cloned tracks
are stopped, evidence is bounded and payload/SSRC data is excluded. Native frame
metadata remains an optional browser capability requiring device checks.
[Native RTP frame metadata test](https://chromium.googlesource.com/chromium/src/+/HEAD/third_party/blink/web_tests/external/wpt/webcodecs/videoFrame-metadata-rtpTimestamp.https.html)

Capture metadata alone still fails impaired A/V acceptance. The next receiver
controller must explicitly map capture time to audible output and video
presentation, bound queued frames/PCM and latency, and close resources on
handover, leave, loss and expiry. Its sole audible path must retain the receiver
deadline guard after all buffering. It must pass the existing 40-pair matching,
150-ms p95 / 250-ms maximum, nominal quality, source-clock and recovery gates
before being selected for public media. A native MediaStream video player in the
inspected Chromium implementation has no Web Audio source provider; routing its
element through `MediaElementAudioSourceNode` is not an established safe solution.
[MediaStream player implementation](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/third_party/blink/public/web/modules/mediastream/web_media_player_ms.h)

The private controlled receiver now has an implemented prototype. It maps native
`getSynchronizationSources()` RTP/capture observations to decoded video frames,
using fresh audio delivery metadata as its playout cursor. An 800-ms experimental
audio delay is inserted before the existing receiver gain/deadline worklet.
The video queue holds at most 40 native frames / 64 MiB, requires monotonic real
capture anchors and nominal 1280x720 frames, and discards unpresentable startup
frames while awaiting an audio clock. Startup remains silent until a matching
video frame can be presented. No capture mapping grants output permission.
[Native delivery source semantics](https://www.w3.org/TR/webrtc/#dom-rtcrtpreceiver-getsynchronizationsources)

The visible output is a native generated video track. Decoded frames are retimed
only when released against the audio cursor, preserving source pixels; queued,
replaced and consumed frames are closed. A hidden, always-muted native player
retains the original incoming stream. A cloned decoded audio reader advances
delivery observations without reading PCM or producing a second audible path.
The fixture requires exactly one visible performance, one original native stream
and one guarded audio source after recovery/handover. It observes actual native
frame presentation and independently captured browser audio, and rejects output
below 20 fps even if the underlying RTP decoder meets its own quality target.
The revised processor reserves four native frames for burst delivery and the
downstream queue reserves 34 frames / 42 MiB, leaving room for a current read and
generated-frame write within the original 40-frame / 64-MiB aggregate bound.
Native allocation sizes above the nominal 8-bit frame bound are rejected.

The generated-track clean run passes 47 checks, 40 matched transitions with no
unmatched edges, p95 43.55 ms / maximum 50.06 ms, measured presentation 24.95 fps
and maximum observed video delay 965.30 ms. An earlier canvas-output variant
failed impaired output cadence and clock startup during recovery; it is not a
release path. The prototype's fixed delay is a controlled experiment. Minimum
practical latency, adaptive delay, continuous impairment, guarded expiry,
handover, sustained clocks and device compatibility must be established before
product integration. Public media remains disabled.

With four processor frames and a 1000-ms experimental hold, a full continuous
UDP impairment/recovery/hybrid journey obtains timing summaries within 150-ms
p95 / 250-ms maximum for all four phases, with no unmatched edges. Maximum
impaired video delay is 1931.70 ms. The complete journey still fails nominal
cadence: impaired source/decoder/presented rates are 18.88/18.70/18.36 fps.
Buffering and timing success do not satisfy that required quality gate. Native
capture-frame statistics are now collected separately from encoded/decoded and
presented counts to identify the source deficit. The one-second hold has limited
latency headroom and is not a selected product policy.

A follow-up with native input counters isolates the deficit: captured video
remains **25.01 fps at 1280×720**, while encoded/decoded/presented cadence falls
to **13.78/13.71/13.45 fps**. Its impaired timing also fails, at **208.91-ms p95 /
309.62-ms maximum** and **2114.40-ms maximum video delay**. The prior four-phase
timing result does not establish reliability across random loss traces. The
fixture now reports capture and encoding deltas separately, with explicit
missing/ambiguous/reset-clock diagnostics and no raw track identifiers.

A private `text` / `L1T2` native sender comparison preserves the 350-kbit/s cap,
25-fps request and 720p dimensions. It is motivated by the native sender's
screen-content classification and encoder's layered screen-content handling,
but observed encoding still falls below target. This setting is not selected
for production. Native API acceptance alone cannot establish frame-rate quality.
[Native content classification](https://webrtc.googlesource.com/src/+/refs/heads/main/pc/rtp_sender.cc),
[Native encoder drop policies](https://chromium.googlesource.com/external/webrtc/+/lkgr/video/video_stream_encoder.cc)

Controlled-buffer expiry acceptance runs independently from A/V marker and
encoded timing observers. It retains actual backend/SFU permits and independent
browser output capture, checks the native additional audio delay, and requires
fresh audible output after native buffering builds. Deep-buffer controlled
variants request a 1000-ms native target for both tracks; the original product
fault fixture retains its audio-only target. Audio-only deep buffering can exceed
the bounded prototype video queue before the stall, closing output; that outcome
cannot count as expiry acceptance. A later symmetric attempt was interrupted by
publisher clock recovery before the stall. Neither failed run closes the expiry
or sustained-clock gate.

At 200-ms additional delay, the prototype passes independent deep-buffer
task-stall and frozen-render-clock resume fixtures (36/38 checks). Native audio
residence exceeds 500 ms, output is independently audible immediately before
each stall, and expired old output remains silent while a replacement plays.
The frozen context renders again for 20 seconds without leakage. This evidence
applies to the tested 200-ms path; the one-second deep-buffer variant and general
clock reliability remain open. A source-page-stall run passes its output-safety
checks but ultimately fails when a replacement controller rejects an 89-ms
audio capture-clock residual above the existing 80-ms bound. That bound is
preserved. No public controller or codec change is selected.

Native received-audio decoding is now verified in an isolated eight-packet probe:
actual RED-wrapped Opus produces 48-kHz stereo frames, with sample counts checked
against the packet TOC. It creates no audible path and forwards the original RTC
frames unchanged. Capture/RTP metadata remain separate from PCM timestamps:
native WebCodecs can advance PCM by its 20-ms sample duration while capture
headers vary slightly. The probe does not establish packet loss, reordering,
concealment or playback alignment. A later owned PCM scheduler must associate
capture metadata explicitly and preserve the receiver deadline guard after every
buffer. The original timing, quality, resource and expiry requirements remain.

An independent native epoch probe now verifies both media kinds against actual
delivery sources. Each encoded worker supplies its own time origin; RTP clock
projection uses the appropriate 48-kHz/90-kHz rate and accepts only a verified
Unix or NTP epoch within the existing 80-ms bound. The tested sources both use
NTP, with approximately 34-ms audio and zero video residual. This is clock-domain
evidence, not output alignment or a browser support claim. The owned PCM/video
scheduler still needs bounded queues, backpressure, final-buffer expiry protection
and actual output acceptance.

Private streaming PCM primitives now enforce 48 chunks / 1 MiB of outstanding
PCM and 512 KiB of encoded packets, with renderer consumption returning credits.
An AudioWorklet schedules exact 48-kHz sample positions; missing packets produce
silence, while clock discontinuities or malformed/overflowing input close the
stream. Recovery and concealment remain unimplemented. Native synthetic Opus
decode/render passes page-task-stall expiry behind the existing lease guard.
Suspension/resume fails: an independently detected brief audible burst follows
resume after expiry, despite the guard clearing its output. Every output edge
must be checked; periodic quiet heartbeats can miss short bursts. The buffer
origin of that burst, actual received-SFU integration, PCM/video alignment and
physical/device acceptance remain unresolved. These primitives stay private
until the original gates pass.

An isolated variant feeds a 48-kHz PCM context through a captured MediaStream
into a separate, continuously rendering output context with the original final
lease guard. The initial test passes PCM-context freeze/resume expiry; subsequent
tests exercise final-output suspension through the complete production graph.
Keeping the guard processor alive after failure did not remove the observed
same-context burst.

The direct receiver-worker/worklet channel is now verified with actual SFU Opus
behind an inaudible diagnostic gain: renderer credits continue during a blocked
page task, queues remain bounded and copied audio excludes the private guide.
The next renderer should retain a 48-kHz decode context feeding captured media
into the browser's default output context, followed by the existing production
receive graph. In the owned Chrome/44.1-kHz setup, this complete graph passes
both-context freeze/resume expiry even with page callbacks blocked. Forcing the
final context to 48 kHz still produces a brief stale burst. This supports the
tested default-output layout; the exact native buffer cause, other output rates,
physical devices and actual audible PCM/video integration remain unverified.

The owned audible prototype now combines the decoder/captured-media bridge with
the application's guarded receive graph and common-clock video release. Epoch
checks select the current receiver workers so singer handover cannot mix old
capture evidence. Clean 40-pair timing and nominal 720p/25-fps quality pass at
800-ms and 200-ms holds; the latter observes audio at approximately 272-ms p95
and A/V skew at 35-ms p95. The original raw source has no audible connection.
Owned video is limited to 34 frames / 41 MiB, with PCM/encoded credits separately
bounded. Recovery, adaptive minimum latency, impaired cadence/timing and
integrated expiry/physical/device acceptance remain required before product use.

The lyric video is declared as `screen_share`, with `screenShareEncoding` explicitly
limited to 350 kbit/s and 25 fps on the existing 1280×720 canvas. Audience filters,
publisher JWT source grants and provider readiness use that same source contract;
a declared camera or screen-audio source is rejected. Canvas publication continues
to use its existing track; this classification does not request desktop capture.
Upgrade frontend, backend grant/gateway and media worker together with media
disabled and no active publisher. The production preview source contract is
recorded in the release tracker.

Pinned v1.13.7 applies its
[jitter-driven playout controller](https://github.com/livekit/livekit/blob/v1.13.7/pkg/sfu/playoutdelay.go)
to camera video; its
[receiver-report handler](https://github.com/livekit/livekit/blob/v1.13.7/pkg/sfu/downtrack.go)
skips jitter adjustment for screen-share sources because bursty screen traffic can
inflate that estimate. This motivates the screen-content classification; native
measurement must still establish whether timing improves.

SFU synchronization policy (2026-10-02): the generated LiveKit configuration now
sets `room.sync_streams: true`. In pinned v1.13.7, subscriber synchronization
depends on this flag as well as the published stream name and client support;
Firefox is excluded by that server implementation. The stream identity is also
used for RTCP CNAME. The real receiver test checks both negotiated MSID and CNAME,
without logging SDP credentials. See the pinned
[subscriber policy](https://github.com/livekit/livekit/blob/v1.13.7/pkg/rtc/participant.go)
and [RTCP sender implementation](https://github.com/livekit/livekit/blob/v1.13.7/pkg/sfu/downtrack.go).
The previous application stream name alone did not establish this SFU behavior.

Adaptive video playout hints are enabled with minimum 0 and maximum 500 ms,
using the server's [room configuration](https://github.com/livekit/livekit/blob/v1.13.7/config-sample.yaml).
This is a buffering hint, not a promised end-to-end delay. No independent lyric
clock or fixed receiver delay is added. Controlled impairment still fails timing
acceptance, and sustained publisher drift remains under investigation; public
media stays disabled. Firefox, Safari and mobile synchronization need explicit
acceptance before support claims.

Remote audiences hear a delayed performance. Their lyrics must follow the received
media, not the current control-server playhead. Proposed first approach: render
the lyric stage on the publisher, capture it as a video track, and transmit it with
the mixed audio through the same WebRTC publisher. Audience pages display that
synchronized lyric video with local queue/participant controls around it. Validate
capture support, mobile load, and actual audio/video synchronization in the spike.

Canvas capture uses one drawing/capture cadence where manual
[`requestFrame()`](https://w3c.github.io/mediacapture-fromelement/#html-canvas-element-media-capture-extensions)
is available. Preserve the fractional frame interval across animation callbacks:
resetting a 40 ms interval to each draw rounds it to 50 ms on a 60 Hz display.
After a stall, capture one current frame. Browsers without manual capture use the
automatic stream rate with the same drawing cadence. Backgrounding still blanks
the canvas; authorization loss and close still release the track. Nominal 25 fps
is a setting, not a guarantee of encoded or received throughput.

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

### 10.3 Initial SFU deployment and operating budget

Decision (2026-10-01): use the implemented self-hosted, supervised LiveKit service
in AWS `us-east-1` for the initial online/hybrid release. Current test infrastructure
is the existing `t3a.xlarge` in `us-east-1a`; this does not enable the production
media flag. The policy gateway and supervisor enforce provider-acknowledged
revocation and stop the SFU when authoritative room policy cannot be reached.
Operating the existing tested path gives control over that shutdown behavior.
A hosted service remains a later option after demonstrating the same authorization
and revocation contract, including denial of old unexpired JWTs through every
signaling/reconnect path. Multi-region operation is a separate future phase.

Initial capacity planning assumes one active singer/mix and one 1280×720 lyric
video at 25 fps per room, 20 people and one viewing device per person: at most
19 audience streams alongside the publisher. Up to 59 audience device sessions
is a boundary scenario for the three-device-per-member ceiling, **not verified
production capacity**. Multiple rooms multiply these budgets. The provider room
limit is 61 for additive headroom; authorization/device limits remain enforced by
room policy. For sizing, tracks, subscribers and bitrate all affect SFU load;
measure the actual workload as described in [LiveKit benchmarking guidance](https://docs.livekit.io/transport/self-hosting/benchmark/).

Illustrative bandwidth assumptions: 500 kbit/s lyric video plus 64 kbit/s audio,
with 25% allowance for protocol overhead and operating headroom. Current app
publishing targets 350 kbit/s video and 64 kbit/s Opus with RED; redundancy and
packet overhead can increase on-wire audio bitrate. These worksheet values
are planning inputs, not configured caps or an observed worst case.

| Concurrent audiences | Payload egress | Egress with allowance | Decimal GB per room-hour with allowance |
| --- | --- | --- | --- |
| 19 | 10.72 Mbit/s | 13.40 Mbit/s | 6.03 GB |
| 59, unverified device ceiling | 33.28 Mbit/s | 41.60 Mbit/s | 18.72 GB |

Use `GB = audience_count × (video_kbit_s + audio_kbit_s) × 3600 / 8 / 1,000,000`,
then multiply by 1.25 for the example allowance. Budget monthly transfer from
actual concurrent room-hours and measured bitrate. Add compute/CPU-credit,
public IPv4, disk/log/backup and operational costs at current account/region rates.
Existing compute has incremental resource cost and may require a dedicated SFU
host after sustained-load measurements. TURN forwarding on the same host is
included in each audience's media egress; cross-zone/host transfer can add cost.
AWS's shared monthly outbound allowance must be deducted only once across the
account's eligible traffic, not once per room or service. Consult current
[AWS EC2 pricing](https://aws.amazon.com/ec2/pricing/on-demand/) and account billing
before converting this worksheet into a dollar estimate.

HTTPS/WSS 443 reaches only the authorized signaling gateway. Direct ICE and TURN
use the specific ports, DNS-only trusted TURN hostname, certificates and firewall
rules in [the deployment guide](ktv_party_deploy.md). Required physical, mobile
and distinct access-network tests remain release gates. A short separate-host
synthetic fanout run supports the 19-audience test scenario only; it does not
establish sustained multi-room capacity or latency for geographically distant users.

### 10.4 Controlled network verification

The room/media browser harness can route its real encrypted media through owned
TCP or UDP impairment proxies while room-control traffic remains independent.
Only fixture ICE candidates are remapped; selected candidate pairs confirm that
the media actually takes the proxy route. Native audio clocks, source scheduling,
readiness, leases and publication authorization remain enforced.

Short tests verify decoded lyric video and backing/microphone audio with injected
delay/jitter, UDP datagram loss, an audience-only outage, private-guide isolation,
and resumed media while the control socket stays connected. The optional continuous
impairment mode retains that profile through audience recovery and all hybrid
handovers, verifying selected proxy routes for fresh connections. TCP models
ordered delayed delivery; UDP models datagram delay/reordering/loss. Proxy and
receiver counters describe the tested transport, and do not establish acoustic,
end-to-end or A/V alignment. Longer outages, timed impairment during handover,
sustained load, physical devices and distinct access networks remain release
gates. Parameters, measurements and failures are tracked in the implementation
plan and deployment runbook.

The optional A/V fixture alternates 440/660 Hz backing every two seconds and
uses corresponding pinned lyric markers. It observes the application's actual
caption draw, adds a numbered barcode to the captured canvas, and detects that
barcode on the received player. Video timestamps use the browser's
[frame callback presentation estimate](https://wicg.github.io/video-rvfc/).
Receiver audio comes from a private PulseAudio output monitor on the same host
clock domain as the source and receiver browsers. Its public native stream API
retains signed monitor latency, including samples queued for future output;
[PulseAudio stream timing contract](https://github.com/pulseaudio/pulseaudio/blob/v16.1/src/pulse/stream.h).
PCM stays in memory; logs contain only marker/timing metrics.
One bounded SSH channel follows the owned receiver's timing events, preserving
their original timestamps. Polling uses local copies, avoiding a new SSH/Python
process on every measurement poll. Malformed, oversized or interrupted evidence
fails the observation. Both the channel and receiver monitor have bounded cleanup.

The monitor uses a 23.22 ms detector window with 10 ms hops. Receiver A/V skew
is the difference between the presented-video estimate and the monitor's audio
marker timestamp. Source-to-video delay starts at the caption draw. The reported
audio observation delay uses that same caption reference, rather than an acoustic
input timestamp. No extra receiver audio analyser is attached during measurement.
Skew acceptance runs after collecting the phases, and a failed phase fails
the run. Incomplete or unmatched evidence fails immediately. Forty paired
transitions are required by default, with six baseline transitions before an
impaired phase; the configurable count is bounded to 6–60. Unmatched events
remain visible. The **150 ms p95 / 250 ms maximum** limits are software diagnostic
thresholds for this setup. They do not replace the physical 50 ms stage/guide
target or establish a supported network/device matrix. Current TCP/UDP impairment
measurements exceed these thresholds; online release remains gated.

The fixture records a bounded, read-only source/receiver RTC statistics timeline
and optional frame arrival/decode/presentation metadata. It exports selected
numeric counters and codec fields only, excluding SDP, candidates and credentials.
Interpret [`estimatedPlayoutTimestamp`](https://www.w3.org/TR/webrtc-stats/)
in the sender's NTP clock domain; it is not a Unix timestamp or proof that the
current caption has appeared. Missing frame metadata remains absent. These
diagnostics help investigate failed timing without replacing the measured gate.

Encoded timing diagnostics must prove actual frame callbacks, rather than only
worker startup or exposed browser APIs. In the Chrome 154 room fixture, attaching
the standard transform after publication starts workers but yields no encoded
frames while RTP continues. Chromium has a
[short-circuit path](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/third_party/blink/renderer/modules/peerconnection/rtc_rtp_sender.cc)
when no transform exists shortly after sender creation. The app now prefers
`createEncodedStreams` when available and opts into `encodedInsertableStreams`
before creating the publisher peer, holding initial media for the lease worker.
Standard-only browsers retain their existing path and require device acceptance.
The [pinned SDK](https://github.com/livekit/client-sdk-js/blob/v2.22.3/src/room/utils.ts)
also avoids standard transforms on Chromium for its worker path.

The private `KTV_ROOM_TEST_ENCODED_TIMING=1` probe forwards original frames through
the unchanged lease worker and observes receiver frames before decoding. It never
reads encoded payloads, retains only bounded timing/codec scalars, and requires
actual timestamps for both audio and video in both directions. Its receiver peer
must preserve the encoded-stream opt-in during SDK configuration updates. In the
initial legacy API experiment, received frames expose RTP/arrival timing but no
shared audio/video capture clock. The
[encoded transform contract](https://www.w3.org/TR/webrtc-encoded-transform/)
requires the absolute-capture-time RTP extension or interpolation for received
capture time. Missing fields stay absent; metadata alone cannot establish audible
or presented-video synchronization. The physical output and existing A/V gates
remain authoritative.

Receiver buffering requests are not measured playback delay. The
[WebRTC jitter-buffer contract](https://www.w3.org/TR/webrtc/#dom-rtcrtpreceiver-jitterbuffertarget)
allows gradual adjustment, different audio/video adjustment speeds and targets
clamped by the native implementation; reading the property reports the request,
not the resulting buffer. Interval `jitterBufferDelay / jitterBufferEmittedCount`
and actual output/frame observations remain required. In the owned impaired UDP
experiment, equal requests near 1.1 seconds produced approximately 320 ms audio
versus 726 ms video buffering early in the run. Audio approached the target over
several seconds; the early skew still failed the unchanged timing gate.
[NetEq's native behavior](https://chromium.googlesource.com/external/webrtc/+/master/modules/audio_coding/neteq/g3doc/index.md)
includes acceleration/deceleration and A/V delay control. Those mechanisms make
buffer convergence plausible, but do not prove synchronized outputs for this app.
Receiver policies remain fixture experiments until actual timing passes.

Source-side expiry cannot remove audio already buffered at a receiver. The
receiver output candidate uses a publisher-nonce/performance-bound deadline
from the admitted listener's room API, bounded by the source permit, stage lease
and listener expiry. It applies the existing render guard after native buffering,
with absolute wall expiry and permanent silence on expired or discontinuous
clocks. The shared video element retains both tracks but stays muted; only the
guarded received mix reaches the output. Private vocal-guide audio is never an
input. The changed playback path must pass native A/V and recovery/handover
acceptance before release. Backend early-stop acknowledgments and planned
transition boundaries respect previously issued receiver deadlines, including
listeners whose page tasks cannot process a new snapshot. The backend now reserves
each issued cutoff, retains it across source-stop/provider-removal acknowledgments,
and defers transitions until that cutoff. The native direct-WebRTC early-stop
fixture passes 31 checks across blocked and suspended/resumed receiver clocks;
integrated SFU faults now pass 78 checks with actual buffered residence above
500 ms. Early-stop and source-stall expiry, blocked/frozen/resumed listener output
and replacement separation pass on independent native monitors. Sustained and
physical acceptance remain open. Public online media is still disabled.

The receiver-safe media contract is version 2, distinct from version-1 room
WebSocket envelopes. Publishers and listeners must advertise version 2 to obtain
streaming credentials. Legacy versions 0/1 retain local controls and playback;
streaming requests require updating and reopening the room. Downgrades invalidate
existing streaming authority, including after asynchronous token signing. A real
unchanged version-1 app is tested without granting an unguarded receiver. The
production-config candidate passes 69 native room/compatibility checks and all
three clean 40-pair A/V phases with nominal quality checks. Impaired and physical
acceptance remain open; public media is still disabled.

Optional `KTV_ROOM_TEST_HANDOVER_AV=1` extends the native fixture with 40-pair
post-handover phases for a replacement remote singer and the venue-to-remote
route. The host uses a third isolated output so two player instances cannot mix
into the measured receiver. Observers restart for the new player, and reused
caption IDs resolve to the latest preceding source capture. Clean post-handover
timing passes on frontend `7c1f583`; this does not establish transition-gap timing,
physical venue-mixer alignment or continuously impaired post-handover timing.

The private owned receiver prototype decodes received Opus into a bounded
48-kHz PCM worklet, captures that output into the caller's default-rate context,
and retains the existing final receive lease guard. It releases native decoded
video against the audible PCM capture position. Clean 40-pair timing passes at
both 200-ms and 800-ms holds; these are tested settings, not an implemented
adaptive minimum-latency policy. Independent native output checks pass buffered
expiry with both contexts suspended/resumed and page callbacks blocked.

Opus RED repair uses RFC 2198 timestamp offsets. An 80-ms reorder window retains
at most eight encoded packets within the shared 512-KiB encoded budget. PCM stays
within 48 chunks / 1 MiB. Full render credits pause decoding in the existing
encoded queue until exact credits return; sustained overflow still closes.
Advancing capture anchors retain the 80-ms discontinuity
limit; continuous sample scheduling and observed capture phase remain separate,
with a 200-ms cumulative phase cap until rate correction is implemented. Video
uses phase history at the audible position. Renderer telemetry counts future
queued samples and excludes silence gaps, so expiry tests measure the owned
buffer directly. Clock failures and deadlines permanently close owned resources.

The next private layout copies received VP8 into a continuous owned decoder and
releases its frames against the same audible PCM capture position. It retains
at most four pending decode/ready outputs, two transferred frames and a 32-frame /
42.5-MiB presentation queue, reserving writer/generator ownership within 40 decoded
frames and 64 MiB. Only I420/NV12 outputs at <= 1.5 bytes/pixel are admitted;
four pending codec outputs still reserve full RGBA. Held encoded packets
share a 512-KiB input budget (eight at shorter holds, up to 20 at 800 ms).
The reorder window is 80 ms at a 200-ms hold, 240 ms at holds of at least
500 ms and 500 ms at an 800-ms hold; queue pressure drains the oldest retained packet without increasing
the bound. Clean isolated-host 40-pair timing passes at a 200-ms hold before
the added reorder policy. A reserved standard receiver can request native
keyframe feedback, with one pending request and a bounded 1–5-second cooldown;
actual encoded/decoded keys are required as response evidence. Feedback follows
unique received frames discarded as late; pacing gaps alone cannot prove
reference loss and do not request keys. A separate
private gap mode decodes contiguous RTP promptly and waits up to 700 ms only
for pacing gaps at an 800-ms hold. Ready outputs share the four-frame decoder
reservation until exact transfer credits return. Impaired recovery
and the new policy remain unaccepted. A separate private allocation comparison
raises only video local priority to match audio, retaining packet network priority
and the nominal bitrate/framerate caps; actual native readback and full timing
are required. It is not a deployed policy.

Continuously impaired timing and nominal frame rate still fail. Native decoded
video can arrive too late, while the owned decoder still needs reliable packet
ordering and codec recovery. Product integration, adaptive recovery,
PLC/rate correction, sustained/physical/mobile/capacity and release acceptance
remain open. These private scripts do not change the deployed playback path.

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
exclude their paths and versioned party assets explicitly from service-worker
runtime caching. On room entry, remove old cached room responses before mounting.
An installed worker update prompts the user, activates the waiting worker on
request and reloads after that exact worker becomes active. Activation timeout,
replacement or unfinished installation keeps the current page open and offers
a translated retry; it cannot trigger a blind reload. The Update action rejects
duplicate clicks and installs its availability listener before catalog downloads.
An authoritative zero-song catalog is valid and must not generate fallback songs
or phantom title/lyric requests during startup. Native upgrade acceptance includes
blocked activation, retained page/controller, retry and purge of legacy authority.
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
| SFU deployment | Self-hosted supervised LiveKit in us-east-1 for the initial release | Device/network gates before enablement; capacity review before expansion |
| Room/queue limits | Defaults in section 11 | Load test and usability review |
| Independent vocal control | Keep original mix initially; retain stems later | Asset pipeline extension |

Implementation phases, acceptance scenarios, evidence, and decisions are tracked
in [ktv_party_implement.md](ktv_party_implement.md). Update this design when a decision
changes so implementation and architecture remain consistent.
