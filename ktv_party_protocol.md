# KTV Party implementation contracts

Updated: 2026-10-01. This document describes the implemented protocol. Physical
audio/device and public streaming acceptance remain open in
[ktv_party_implement.md](ktv_party_implement.md).

## 1. Delivery and reference environments

The first deployed milestone is a local-room preview. Online and hybrid remain
required deliverables. Their capture, audience and authorization code exists,
but the production media flag remains disabled while acceptance is incomplete.

| Reference | Current evidence | Remaining acceptance |
| --- | --- | --- |
| App server | EC2 `us-east-1`, Express/SQLite, nginx, PM2; Node 25.2.1 | Persistent public media service and distinct access-network acceptance |
| Remote EC2 Chrome 137.0.7151.68 | Separate-host public transport 14/14; isolated built-app singing, private guide and handover 20/20 via loopback SSH app/CDP forwards | Physical audio, broader devices and Wi-Fi/LTE; integrated app is not a production online release |
| Chrome 146.0.7680.71 on Linux | Isolated browser contexts/processes, Web Audio, room/PWA/SFU checks | Native virtual output stalls in the full streaming journey; no physical audio claim |
| Desktop stage + phone controller + wired headphones | Selected physical reference setup for local acceptance | Five-minute acoustic recording, pause/seek/late-guide and device-loss checks |
| Android Chrome and iOS Safari phones | Required device/browser evaluation | Permission/autoplay, canvas capture, decode/memory, foreground/background and physical alignment |
| Bluetooth output | Separate evaluation path | Latency, output changes and calibration; wired results cannot establish BT support |

The application backend requires a runtime providing `node:sqlite` and
`DatabaseSync`; the deployed Node 25.2.1 is the verified version. The separate
media container uses its pinned Node 22 image and does not own the room database.

## 2. Identity and capabilities

| Identifier | Lifetime and meaning |
| --- | --- |
| `users.id` | Application identity; an unregistered visitor receives a server-created guest identity without signup |
| `room.id` | UUID for a room; not an admission credential |
| `member.id` | UUID for one identity in one room; the same person on multiple devices remains one member |
| Paired `deviceId` / `deviceScope` | Persisted device grant UUID and `display`/`controller` scope |
| Live `clientDeviceId` | UUID for this page's realtime output/controller instance; regenerated on remount |
| `entryId` | UUID for a queue request; repeated requests for the same catalog song have distinct IDs |
| `performanceId` | UUID for a selected singer/entry performance; obsolete selections cannot confirm or complete a later turn |
| `generation` | Integer for a readiness or playback timeline version; those two domains have separate generations |
| `clockId` | UUID-like epoch for this backend process's monotonic clock; changes on restart |
| `commandId` | UUID for one deliberate mutation; network retries reuse it |
| Media `identity` | `ktv-media-<UUID>` persisted grant nonce; terminal revocation cannot be undone with its old JWT |

Display names are nonempty, trimmed and bounded to 40 characters. Duplicate names
are allowed; the UI adds an ID suffix where needed. A display name is never an
authorization key. Room names are bounded to 80 characters.

Normal room requests use `Authorization: Bearer <session>`. A paired page uses
`Authorization: KtvDevice <credential>` for its scoped room access. A paired
display can read admitted room data and receive media; it cannot manage the room,
request microphone capture or preserve controlling host presence.

| Action | Member | Co-host | Host | Paired display |
| --- | --- | --- | --- | --- |
| View room, stage and queue | Admitted | Yes | Yes | Yes |
| Request songs, nominate, accept own nomination/readiness | Yes | Yes | Yes | No |
| Cancel own unstarted request | Yes | Yes | Yes | No |
| Approve priority, remove/reassign unstarted queue, playback controls | No | Yes | Yes | No |
| Approve/reject/remove/block/restore ordinary members | No | Yes | Yes | No |
| Routine room settings | No | Yes | Yes | No |
| Singer request cap, host ordering, invitation rotation/visibility, role changes, host transfer, close, performance mode | No | No | Yes | No |
| Online capture | Selected singer | Selected singer; hybrid controller allowed | Selected singer; hybrid controller allowed | No |

A controller grant inherits its parent's current role and admission; it does not
retain old permissions after removal or demotion. Global application-admin
privileges are used only for operations diagnostics, not normal room controls.
Routine settings here mean room locking and admission approval. The per-singer
request cap and common-screen invitation visibility require the host.

## 3. HTTP commands and snapshots

Room endpoints are under `/api/ktv`; the authoritative client types and request
methods are in `src/services/partyApi.ts`. Domain errors return:

```json
{"success":false,"code":"REVISION_CONFLICT","message":"Room changed"}
```

Success returns `{"success":true,"data":...}`. All room responses use
`Cache-Control: no-store`. Origin checks allow the current request host or an
explicit configured origin. Requests are bounded to 16 KiB and the room guard's
peer budget is 600 requests per minute. Forwarding headers cannot create another
rate-limit identity.

Mutation receipts bind the current actor, command ID and payload digest.
Reusing an ID with another payload returns `COMMAND_CONFLICT`. A replay rechecks
current room admission and device revocation; a saved receipt cannot recover
removed authority. Identity/pairing receipts use separate encrypted recovery
records where a secret reply must survive a lost response.

Commands that depend on a selected turn carry:

```json
{
  "commandId":"<UUID>",
  "clockId":"<current epoch>",
  "baseRevision":42,
  "performanceId":"<selected performance UUID>",
  "generation":7
}
```

Revision checking is action-specific. Queue addition permits concurrent accepted
requests; ordering/reassignment and selected-turn controls enforce the revision
and applicable clock/generation. Database changes and receipts commit before
broadcast. One Node process runs synchronous SQLite transactions; asynchronous
asset/provider work must recheck authority around its commit.

Snapshots contain `room`, `self`, `clock`, and, for admitted viewers, `limits`,
`timing` (operator policy durations in milliseconds), `features`,
`members`, `queue`, `readiness`, `playback`, `presence`. Pending/rejected/removed
viewers receive only their allowed admission state. Host invitation codes and
excluded-member history are omitted from paired displays. A room revision owns
durable mutations; presence has a separate sequence.

The browser replaces authoritative snapshots and rejects older revisions. Local
tab, monitor volume and guide calibration preferences do not edit room state.
An action failure refreshes the room before presenting its recovery message.
The bounded tab-scoped command journal retains unresolved IDs/digests through
reload, without retaining invitation codes or display-name plaintext.

## 4. Realtime protocol

1. Obtain a single-use ticket with
   `POST /api/ktv/rooms/:id/socket-ticket`, including this page's live device ID.
2. Open `/api/ktv/ws` and send `{"type":"authenticate","ticket":"<opaque>"}`
   as the first message within five seconds.
3. Receive protocol-version-1 full `snapshot` messages. Lease updates and clock
   replies are separate messages; browser device/clock messages include
   `protocolVersion: 1`.
4. On disconnect, obtain a new ticket, reconnect with randomized backoff, replace
   the snapshot and collect a new healthy clock estimate. HTTP polling is the
   fallback, not a source of permission to continue expired output.

Inbound frames are bounded to 1024 bytes. A room permits 60 sockets, a member
three. Clock probes are bounded to 20 per ten seconds; device messages to 40 per
ten seconds. Connections with more than 256 KiB buffered output are terminated.
Concurrent queue additions coalesce broadcast snapshots over 25 ms; individual
HTTP replies and command receipts remain independent.

Useful close codes: `4400` invalid message/protocol, `4401` authentication failure,
`4403` access ended, `4410` room ended, `4429` rate/capacity limit. A close or an
HTTP authorization error requires fresh authority, not replay of an old ticket.

## 5. Queue and playback state

Persisted queue states are `queued`, `held`, `cancelled`; public queue snapshots
include active `queued`/`held` entries. Separate acceptance and priority fields
describe nomination and request-next approval. Completed/skipped/declined turns
have durable served-turn history. Fair order rotates eligible singers; host
ordering and approved priority are deliberate overrides.

Readiness is `idle`, `awaiting-singer`, `ready`. Human confirmation selects a
performance; it does not start audio. Playback is `idle`, `preparing`, `scheduled`,
`playing`, `paused`, `recovering`. Preparation pins song assets and waits for the
designated output and any required guide. Scheduling supplies a future anchor.
Pause/seek/resume use effective transition times and generations, preventing
late readiness/ended reports from changing a later timeline.

Selected/active queue entries cannot be cancelled, reassigned or reordered through
request controls. Moderators use playback controls for that performance. There
is one current output lease; replacement waits for its safe silence boundary or
valid stop acknowledgment. A process restart changes the clock epoch, cancels
leases and restores a paused checkpoint requiring deliberate fresh readiness.

## 6. Time units and audio mapping

| Field | Unit / origin |
| --- | --- |
| `createdAt`, `updatedAt`, `expiresAt`, persisted lifecycle timestamps | UTC ISO string; wall-clock retention/admission only |
| `clock.serverNowMs`, playback `anchorServerMs`, transition `effectiveServerMs`, lease expiry/safety deadlines | Monotonic milliseconds in the named server `clockId` epoch |
| `clientSendMs`, local probe receive time, clock estimate age | Browser `performance.now()` milliseconds in this document |
| `positionMs`, `durationMs`, `lyricOffsetMs`, asset alignment, guide advance, capture alignment | Millisecond durations/offsets; not wall timestamps |
| `AudioContext.currentTime`, scheduled source start/stop | Seconds on that device's render clock |
| Output timestamp `contextTime` / `performanceTime` | Audio seconds / browser monotonic milliseconds |

The clock estimator removes server processing time, retains 24 recent samples
and prefers low-round-trip samples. Healthy requires at least three samples and
uncertainty no greater than 50 ms; estimates older than 30 seconds become stale.
Estimated server time is client monotonic time plus estimated offset. This does
not measure headphone/Bluetooth or acoustic delay.

`partyOutputClock` uses a valid browser output timestamp, otherwise an explicit
latency estimate. The engine waits for three stable clock intervals, with an
eight-second startup timeout, before advertising audio enabled. An estimate-only
device cannot claim measured rendered drift. Timestamp drift recovers after
three samples over `max(80 ms, 2 × uncertainty + 25 ms)` or one sample over
`max(250 ms, 4 × uncertainty + 50 ms)`. Recovery fades/stops output and requires
fresh preparation; acceptance targets are not achieved by relaxing these guards.

Positive private-guide advance plays the guide earlier; personal guide advance
is stored locally. Room lyric correction affects lyrics only. Positive capture
alignment delays published backing; negative alignment delays microphone.
Neither correction belongs in another member's private guide setting.

## 7. Limits and policy

### Feature switches

| Environment variable | Default | Effect after backend restart |
| --- | --- | --- |
| `KTV_ROOMS_ENABLED` | `true` | `false` denies room HTTP requests and WebSocket upgrades, including pairing and ticket creation |
| `KTV_GUIDE_ENABLED` | `true` | `false` removes original descriptors from room assets/snapshots, clears persisted guide requirements and denies guide commands/device status |
| `KTV_MEDIA_ENABLED` | `false` | `true` requires complete private worker/token configuration; `false` returns existing open online/hybrid rooms to local mode |

Only literal `true` and `false` are accepted; invalid values fail startup. Flags
are immutable within a process. Disabling rooms also disables guides/media.
`GET /api/ktv/features` is public and `no-store`, and returns only those three
booleans. Entry, join and pairing pages disable submissions when rooms are
unavailable, with English/Chinese status text. Admitted snapshots and admin
health also expose the effective flags; pending viewers do not get admitted data.

Restart recovery pauses active playback, preserves queued requests and requires
fresh readiness in the new clock epoch. Old output must stop by its existing
lease deadline; the durable startup silence bound is still enforced. Media
disablement persists active grant nonces as `revoking`, never as acknowledged
`revoked`. Disabled internal media policy routes cannot authorize old JWTs; the
owned worker treats policy loss as fatal and stops its SFU child. On reenablement,
the worker must reconcile pending provider removal before slots are reusable.
Media reenablement does not automatically restore an online mode or resume audio.
The guide switch governs KTV behavior, not access to original songs in the solo
catalog. Changing these switches never changes existing user accounts.

### Durations and capacity

| Setting | Default | Configuration / bounds |
| --- | --- | --- |
| Members / queued requests | 20 / 100 | `KTV_MAX_MEMBERS` 2–20; `KTV_MAX_QUEUE` 1–100 |
| Pending requests per singer | 3 | `KTV_MAX_SINGER_REQUESTS`, host setting; 1–10 |
| Paired grants per member | 2 | `KTV_MAX_DEVICE_GRANTS`, 0–2 |
| Room lifetime / empty expiry | 12 h / 30 min | `KTV_ROOM_LIFETIME_MS`, `KTV_EMPTY_ROOM_MS`; 1 min–24 h |
| Receipt / closed history retention | 24 h / 7 days | `KTV_RECEIPT_RETENTION_MS` 1–7 days; `KTV_HISTORY_RETENTION_MS` 1–30 days, covering receipt retention |
| Room audit cap | 1000 | `KTV_MAX_ROOM_EVENTS`, 10–10000 |
| Host-loss grace | 30 s | `KTV_HOST_GRACE_MS`, 1–300 s |
| Pairing code | 2 min | `KTV_PAIRING_LIFETIME_MS`, 30–300 s; cannot outlive the room |
| Socket ticket / initial authentication | 30 s / 5 s | `KTV_TICKET_LIFETIME_MS` 5–60 s; `KTV_SOCKET_AUTH_TIMEOUT_MS` 1–10 s, no longer than ticket lifetime |
| Preparation | 30 s | `KTV_PREPARE_TIMEOUT_MS`, 5–60 s; covers both start leads |
| Local lead / online lead | 2 s / 6 s | `KTV_PLAYBACK_LEAD_MS` 1–5 s; `KTV_ONLINE_LEAD_MS` 4–10 s |
| Output lease / silence margin | 8 s / 500 ms | `KTV_OUTPUT_LEASE_MS` 6–15 s; `KTV_OUTPUT_MARGIN_MS` 500–2000 ms; lease covers both leads plus 1 s |
| Publisher nonce / audience nonce | Up to 5 s / 120 s | Publisher cannot outlive output lease; signed JWT TTL 120 s is not the authorization lifetime |
| Encoded/decoded audio | 32 MiB / 192 MiB per engine | Bounded fixed decoder policy; assets at most ten minutes/two channels |

Invalid or incompatible runtime timing fails startup in `ktv-timing.js`.
`ktv_output_safety` retains the greatest configured lease and margin, with the
legacy 8 s/500 ms floor. Restart silence uses this durable bound in the new clock
epoch; reducing settings or repeatedly restarting cannot shorten an older
device's stop deadline. Never delete this row while clients may retain leases.
Rollback to code predating this policy requires stopping the backend and waiting
the durable bound before restarting old code. Render-clock drift/readiness
thresholds remain separate fixed safety checks, with physical acceptance still
open. Human singer confirmation is deliberate rather than automatically timed
out; audio preparation has the deadline above. Fair rotation is the default
product rule, with explicit persisted host ordering/priority controls. Invitation
lifetime follows the configured room lifetime and host rotation/revocation.

## 8. Media and asset contracts

Preparation resolves a numeric catalog ID against operator-owned roots and pins
byte length, SHA-256, duration, channels, alignment offsets and lyric content/hash.
The client checks size/hash before decoding and bounds decoded memory. Imported
originals, synced LRC, manual lyrics and missing originals have explicit paths.
Party audio URLs carry `?ktvAsset=<hash>` and bypass the solo audio cache. Same-origin
media routes provide HTTP/Range behavior; there is no user-supplied external media
URL in a room command. Asset descriptors report `alignmentVerified: false` until
actual asset alignment evidence is available.

A performer waits for a live output lease matching its device, clock, performance
and generation before requesting publisher authority. A scheduled snapshot alone
is not that capability: the committed lease arrives from the playback sweep.
The server continues checking device admission/readiness and its current lease.
Audience tracks share one audio/video element. Unsubscribe cleanup uses the
transport's owned element even if the SDK already detached it; delayed old-track
events cannot remove a replacement, and closed transports reject late tracks.

The publisher tap is taken from the instrumental before personal monitor gain.
Original-guide engines cannot obtain that tap. Clean capture mixes one backing
and microphone with limiting; venue mix excludes the digital backing. Lyrics are
captured from the publisher's rendered backing into video, accounting for its
publish delay. Audience audio/video use one named WebRTC stream on one video
element; audience pages do not run a second instrumental player.

Room media grants bind current admission, paired scope, device, selected singer,
performance, generation and output lease. Provider-confirmed audio/video readiness
is required before online playback enters `playing`. Replacement waits for
provider removal acknowledgment. The private gateway authorizes persisted nonces;
raw LiveKit signaling/admin routes are not exposed. Its supervisor owns the SFU
process and terminates it on policy/provider failure, including established RTP.
The pinned server advertises integrated TURN TLS at 443. For this deployment's
5349 listener, the gateway corrects only the exact configured TLS URL in
join/reconnect messages, preserving dynamic credentials and other signaling.

## 9. UI and requirement coverage

Create: choose room/name/settings → receive invite → People controls. Join:
open code/link/QR → restore existing membership or enter a name → approval screen
if required → room. Pair: choose display/controller scope → short-lived code/QR
→ redeem once → scoped stage or controller. Phone panels persist across
Songs/Queue/Sing/People navigation. Stage/viewers show one room timeline, with
explicit audio enable/loading/recovery. Removed guests lose controls and authority;
reconnect replaces state before output is permitted.

| Requirement | Implementation ownership / release gate |
| --- | --- |
| R01–R02 rooms/invites/guests | Routes/schema/lifecycle and Home/Join; deployed preview, P02 software verified |
| R03 stage | PartyRoom stage route and playback panel; deployed, physical readability/device gate open |
| R04–R05 queue/rotation | Queue/turn services, Songs/Queue UI; deployed, P03 convergence/receipt evidence |
| R06 moderation | Server room permissions and People controls; deployed, no global-admin dependency |
| R07 playback | Playback/timeline/lease service and audio engine; deployed, physical timing gate open |
| R08 private guide | Isolated engine/calibration/recovery; implemented, acoustic/device gate remains open |
| R09 lyrics/progress | Pinned descriptors and authoritative timeline; deployed local, remote capture validation open |
| R10 recovery | Realtime, checkpoint, host-loss, lease and engine recovery; software evidence, physical/browser gate open |
| R11 several devices | Scoped paired grants and live device instances; deployed, P02 verified |
| R12–R13 online/hybrid | Media grants/gateway/supervisor, publish/capture/audience UI; code exists, integrated/public/physical release gates open |
| R14 bilingual/accessibility | Localized views, recovery messages, focus/touch/tab controls; UI acceptance and support matrix continue |

Source ownership: `server/ktv-*.js` for room/domain/protocol, `src/services/party*.ts`
and `src/composables/useParty*.ts` for timing/capture/client authority,
`src/views/Party*.vue` and `src/components/Party/*` for views. Additive SQLite
migrations live in `ktv-schema.js`; media-specific tables initialize with the
media grant service. Deployment, backup, monitoring and rollback are in
[ktv_party_deploy.md](ktv_party_deploy.md).
