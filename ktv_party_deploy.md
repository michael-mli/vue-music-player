# KTV Party deployment and recovery

The public local-room preview is recorded in `ktv_party_implement.md`. The online
implementation is under validation. Preparing files or passing loopback tests
does not qualify a public streaming release.

## 1. Process and network layout

Keep one Express process as owner of the room SQLite database and playback clock.
Run `ktv-media-supervisor.js` as PID 1 in its Docker container. It owns both the
gated signaling service and LiveKit child. Backend policy loss or provider removal
failure stops that child, including established media sessions. Restarting nginx
or closing signaling alone cannot revoke an established WebRTC sender.

| Endpoint | Exposure | Purpose |
| --- | --- | --- |
| Site HTTPS/WSS, 443 | Existing public web proxy | App, room control and gated signaling |
| Express, 3101 | Private host access | Room policy and internal media authorization |
| Gateway, 3103 | Bound to loopback | Only the three nginx paths below are public |
| LiveKit HTTP, 7880 | Bound to loopback | Private signaling and RoomService; never proxy directly |
| ICE TCP, 7881 | Direct public TCP | WebRTC fallback, separate from HTTP |
| ICE UDP, 7882 | Direct public UDP | Initial single-node media transport |
| TURN UDP, 3478 | Direct public UDP | Authenticated relay |
| TURN TLS, 5349 | Direct public TCP, trusted certificate | Authenticated TLS relay |
| TURN relay, 30000–30100 | Allocations on the media host | Relay-to-SFU traffic; validate host/NAT routing |

The TURN hostname must resolve directly to the media host. Ordinary HTTP CDN
proxying does not carry these media transports. The initial same-host recipe uses
5349 because nginx already owns 443. Networks allowing only TCP 443 need a separate
TURN listener/address or an appropriate layer 4 deployment. This recipe makes no
claim of support on those networks.

The pinned LiveKit v1.13.7 implementation advertises its integrated TURN TLS
endpoint on port 443 even when `tls_port` is 5349. The gateway's
`ktv-media-ice.js` adapter changes only that exact operator-configured TURN URL
in join/reconnect replies to port 5349. It preserves provider-generated temporary
credentials, unrelated URLs, SDP and unknown protobuf/JSON fields. Worker settings
`KTV_MEDIA_TURN_DOMAIN` and `KTV_MEDIA_TURN_TLS_PORT` enable the adapter; both must
be present and valid. Generated files include them. A listener/certificate check
alone cannot establish that browsers received the correct endpoint. The source
behavior is in [the pinned room manager](https://github.com/livekit/livekit/blob/v1.13.7/pkg/service/roommanager.go).

The network settings follow [LiveKit deployment guidance](https://docs.livekit.io/transport/self-hosting/deployment/)
and its [port reference](https://docs.livekit.io/transport/self-hosting/ports-firewall/).
The generated configuration targets the [pinned v1.13.7 configuration](https://github.com/livekit/livekit/blob/v1.13.7/config-sample.yaml).

## 2. Prepare the private configuration

### Room timing policy

The backend accepts the timing environment variables and bounds recorded in
`ktv_party_protocol.md`, section 7. Values are integer milliseconds and apply on
backend restart. Incompatible preparation/lead/lease/authentication values fail
startup. Default values preserve the deployed timing behavior. Operators can
increase leads for slower preparation/network paths without changing render-clock
drift guards or claiming acoustic alignment.

The additive `ktv_output_safety` singleton retains the greatest configured lease
and silence margin. Backend restart waits that durable duration in its new clock
epoch, including after settings are reduced or a restart occurs during recovery.
Do not delete/reset it as routine cleanup. Room/pairing expiry and one-use socket
tickets still enforce their deadlines separately from audio timing.

### Private media files

Run from the repository with the actual public IPv4, DNS-only hostname and network
interface. The following addresses are documentation examples.

```bash
node scripts/prepare-ktv-media-config.mjs \
  --directory /home/mli/ktv-media-private \
  --public-ip 203.0.113.10 \
  --turn-domain turn.example.com \
  --origin https://music.micstec.com \
  --interface ens5
```

The generator creates a new directory with mode 0700 and three files with mode
0600. It generates separate random provider and control secrets without printing
them. Existing directories are refused so retrying cannot rotate active keys.
`backend.env` contains the five settings to merge into the host's `.env.server`.
`worker.env` is the container's environment. Both use the same provider/control
keys. No secret belongs in a `VITE_` variable or frontend build.

Install a browser-trusted certificate and its private key as
`tls/fullchain.pem` and `tls/privkey.pem`, readable by the UID used for the container.
Keep the key private. A Cloudflare Origin CA certificate is unsuitable for direct
browser TURN TLS. The renewal service below defers a restart while an online song
is active. A restart stops existing streams and requires fresh capture consent.

### TURN certificate renewal

The current direct hostname is `ktv-turn.3.219.116.105.sslip.io`, resolving to the
app server. This IP-derived hostname is the deployment default; a server IP change
requires a new hostname, certificate and media configuration. The existing
`turn.micstec.com` DNS record was left unchanged.

`server/nginx-ktv-acme.conf.example` serves only HTTP ACME challenges from
`/var/www/ktv-acme`. The certificate is issued with the pinned Certbot 5.8.0 image
and kept under the private configuration directory. Certificate expiry is
2026-12-30 16:50:37 UTC. The AWS security group `ktv-party-media` and IPv4 UFW rules
permit the five media transports in section 1; private HTTP/control ports remain
unexposed. This prepares network access, without establishing public ICE acceptance.

Install the service/timer templates after substituting their paths, owner and
hostname. `scripts/renew-ktv-media-tls.mjs` renews, validates the hostname/key/expiry,
copies files with mode 0600 and records a durable restart marker. It reads room
state before restarting an idle media container. Active performances defer the
restart until a later timer run; provider or database failures retain the marker.
The idle check and restart are separate operations, so a new performance can
start between them. The timer runs every six hours with a randomized delay.

The installed service passed an actual run and Certbot's staging renewal dry run
passed on 2026-10-01. Tests cover mismatched keys/hosts, active-song deferral, an
idle restart and retained markers on failure. See the [Certbot renewal guide](https://eff-certbot.readthedocs.io/en/stable/using.html#renewing-certificates).

Enable only the documented media ports in the host firewall and upstream network
rules. Verify the advertised public IP maps to this node and that TURN can reach
the SFU. Keep HTTP/control ports private. Do not run a raw LiveKit process outside
the supervisor; that would bypass persisted nonce checks and process containment.

### Backend feature switches

The backend's private `.env.server` supports `KTV_ROOMS_ENABLED=true`,
`KTV_GUIDE_ENABLED=true` and `KTV_MEDIA_ENABLED=false` by default. Only literal
`true`/`false` values are valid. Keep media disabled until its acceptance gate
passes. These flags are read at startup; apply changes by restarting the single
owned `karaoke-auth` process. The public no-store `/api/ktv/features` endpoint and
admin health report effective booleans without private configuration.

Disabling rooms blocks HTTP commands and socket upgrades. Disabling guides
clears stored required-guide/device bindings and removes original descriptors
from KTV assets/snapshots while shared backing remains available. Disabling media
returns open rooms to local mode and leaves old grants pending provider removal.
The supervisor stops its SFU when disabled backend policy becomes unavailable.
Reenablement requires worker reconciliation and fresh human/device readiness;
it never automatically resumes the old performance. Existing output leases and
the durable startup-silence bound still apply. Room and queue history remain
available after reenablement, subject to ordinary expiry/retention.

## 3. Build and start the owned service

```bash
docker build -f server/Dockerfile.ktv-media -t ktv-party-media:release .
docker run -d --name ktv-party-media \
  --network host --read-only --cap-drop ALL \
  --security-opt no-new-privileges \
  --user "$(id -u):$(id -g)" \
  --tmpfs /tmp:rw,noexec,nosuid,size=16m \
  --env-file /home/mli/ktv-media-private/worker.env \
  --mount type=bind,src=/home/mli/ktv-media-private,dst=/run/ktv,readonly \
  ktv-party-media:release
```

The Dockerfile pins both base images by digest. Its build context is whitelisted
and excludes `.env.server`, media and database files. This host uses UID 1001;
the base image's default UID 1000 cannot read its 0600 files. Use the owner UID,
as above, instead of widening file permissions.

Merge the generated backend settings into `.env.server` after the backup below,
then restart the single room backend. The worker requires that backend to answer
policy requests before it becomes ready. A service that fails startup remains
stopped: inspect the fixed supervisor failure reason, repair configuration or
network policy, and start a fresh container. Do not configure automatic restarts
until the resulting room recovery behavior has been validated.

Add `server/nginx-ktv-media.conf` inside the existing HTTPS server block, alongside
`server/nginx-ktv-ws.conf`. Validate with `nginx -t` before reloading. The snippet
forwards only `/api/ktv/media/rtc`, `/rtc/v1`, and `/rtc/validate` to the gateway and
disables their URL logging. Media access tokens appear in signaling query strings.
Keep them out of CDN/request inspection logs too. Private `/control/`, `/internal/`
and raw LiveKit `/twirp/` routes must not be routed publicly.

The three exact locations are now included from
`/etc/nginx/snippets/ktv-media.conf` on this host. They were validated with
`nginx -t` and nginx was reloaded. Production room media remains disabled; no
persistent media container is running. Temporary probes own and remove their
supervised container rather than using production room policy.

Room snapshots expose `mediaConfigured`; the host sees the mode selector only
when configured, and cannot change modes during a performance. Worker readiness
is checked separately. A configured service with a failed worker cannot issue
media credentials or start an online song.

## 4. Verification before public release

### Isolated public-origin transport probe

With the exact nginx routes installed, trusted private TLS files and unused media
ports, run the supervised transport checker:

```bash
KTV_TRANSPORT_IP=3.219.116.105 \
KTV_TRANSPORT_DOMAIN=ktv-turn.3.219.116.105.sslip.io \
KTV_TRANSPORT_INTERFACE=ens5 \
KTV_TRANSPORT_TLS=/home/mli/ktv-media-private/tls \
npm run test:party:public-transport
```

To let the checker own a remote Chrome process and its CDP tunnel, add
`KTV_TRANSPORT_CLIENT_LOCATION=remote-ec2`,
`KTV_TRANSPORT_SSH_HOST=operator@owned-host`, and
`KTV_TRANSPORT_KNOWN_HOSTS=/path/to/already-trusted-known_hosts`.
No app reverse forward or microphone upload is needed for this transport probe.
`KTV_TRANSPORT_CHROME_PORT` defaults to 9243. The remote profile/browser has a
15-minute watchdog and is removed on completion; existing profiles remain untouched.

Add `KTV_TRANSPORT_AUDIENCES=19 KTV_TRANSPORT_LOAD_SECONDS=60` for concurrent
fanout measurement. Counts are bounded to 59, durations to 10–180 seconds.
Synthetic credentials last 15 minutes in load mode and all are revoked before
cleanup. The source is a 1280×720 moving canvas at 25 fps with oscillator audio;
publishing uses the app’s single-video 350 kbit/s and audio 64 kbit/s settings.
Receivers alternate direct and strict TLS-only TURN. The log records per-audience
FPS, decoded resolution, selected ICE route, RTP byte growth/loss, jitter/round-trip
and separate audio/video jitter-buffer statistics with actual received audio
playout, plus
container CPU and memory samples. Host-network Docker `NetIO` may report zero;
use RTP byte deltas for this test's transfer observation. Jitter-buffer delay is
not end-to-end latency. Deliberate authorized disconnect/reconnect is checked;
Wi-Fi/LTE drops and automatic recovery require separate validation.

The checker creates separate temporary provider/control keys and a bounded
loopback policy fixture. It owns the SFU through the normal PID 1 supervisor,
uses the actual public HTTPS/WSS nginx/CDN path, checks decoded synthetic media,
forces TLS-only TURN through both initial and updated ICE configuration, and
checks provider-acknowledged revocation. It does not create app users/rooms or
change the production flag. Cleanup removes its browser contexts, container and
private files. Its default Chrome client is on the media host, so a passing probe
does not establish different-network, physical microphone or integrated-room
acceptance. For an owned remote Chrome client, forward its loopback CDP port
through pinned SSH, set `CHROME_DEBUG_URL` to the local forward and set
`KTV_TRANSPORT_CLIENT_LOCATION=remote-ec2`. This label records the operator's
chosen topology; it does not detect or certify distinct access networks. The
2026-10-01 remote EC2 Chrome 137 run passed 14/14, including strict TLS-only
relay and revocation (`/tmp/ktv-public-transport-remote-first.log`). Its temporary
browser and forward were removed. Do not run the checker alongside a persistent
media service on the same ports.

Run builds and CPU-heavy suites before browser audio journeys:

```bash
npm test --prefix server
npm run test:party
npm run build
npm run test:party:supervisor
```

Use owned Chrome processes for the existing local browser journey and streaming
spike. `test:party:room-media` also owns a separate browser and virtual audio
fixture; it exercises the built app against real room authorization and SFU.
The default uses native Linux output and a synthetic microphone; an optional
owned PulseAudio sink is available. Docker is required. A remote EC2 Chrome client
can exercise the entire built app through loopback SSH forwards with direct media
to the SFU host:

```bash
KTV_ROOM_TEST_CLIENT=remote-ec2 \
KTV_ROOM_TEST_PUBLIC_IP=3.219.116.105 \
KTV_ROOM_TEST_INTERFACE=ens5 \
KTV_ROOM_TEST_SSH_HOST=operator@owned-host \
KTV_ROOM_TEST_KNOWN_HOSTS=/path/to/already-trusted-known_hosts \
npm run test:party:room-media
```

For the venue → remote → venue route journey, also set
`KTV_ROOM_TEST_ROUTE_HANDOVER=1`. It uses the common-screen device as a synthetic
venue mixer, then as a remote audience, and checks readiness, fresh generations,
provider-acknowledged revocation, microphone release, native backing stop, received
video and spectra. It does not measure a physical mixer or acoustic feedback.

Add `KTV_ROOM_TEST_NETWORK_RECOVERY=1` to interrupt actual audience and singer
media signaling sockets independently. The audience must visibly recover without
a click using a fresh provider-acknowledged nonce, receive decoded audio/video,
and keep the old unexpired token denied. Singer loss must release capture and
enter room recovery. Combine with `KTV_ROOM_TEST_ROUTE_HANDOVER=1` to verify the
venue → remote → venue sequence afterward. This is a signaling interruption;
RTP packet loss, access-network outage, imposed jitter and physical A/V delay
remain separate gates.

Set `KTV_ROOM_TEST_MEDIA_IMPAIRMENT=tcp` or `udp` with the remote topology
above to route encrypted media through an owned delay proxy. The test selects
only that protocol and verifies each peer's selected ICE candidate pair, so
an unmodified direct route cannot bypass the fixture. Private SFU TCP 17901
and UDP 17902 must also be free and remain closed to external clients.
The proxy forwards to the SFU's actual local interface. It changes no host
routing, firewall, qdisc, native audio clock or application safety limit.

The measured playback segment injects 150 ms base delay plus 0–40 ms uniform
jitter in each direction. UDP also drops datagrams with 5% probability on each
proxy leg; this is not a claim of 5% total end-to-end loss. TCP preserves byte
order and models delayed delivery rather than UDP loss. Both pause audience
media briefly, with a three-second automatic safety bound and an elapsed-time
log; TCP queues bytes, UDP discards datagrams. Checks require video to freeze
and then advance, actual backing/microphone tones to return, private vocals to
stay excluded, and the room-control WebSocket to remain connected.
RTP loss/jitter/buffer counters and bounded proxy queues are logged without
credentials. These counters are not acoustic, end-to-end or A/V timing.

By default impairment remains active through private-guide verification, then
returns to zero before signaling recovery and performer handovers. Add
`KTV_ROOM_TEST_CONTINUOUS_IMPAIRMENT=1`, together with both recovery/handover flags,
to retain the 150 ms delay, 0–40 ms jitter and UDP 5% per-leg loss through the entire
sequence. The fixture checks the active profile and selected proxy route after
audience recovery and each new publisher/receiver. This mode measures functional
handover; enable the separate A/V marker mode for timing observations. Longer
outages and distinct access networks remain separate gates.
Run `npm run test:party:impairment-fixtures` for byte/datagram fidelity, delay,
selective stall/resume, drop and parameter-bound checks on the proxies.

Set `KTV_ROOM_TEST_AV_TIMING=1` with the remote topology to measure the built
player's audio/lyric markers before attaching spectral analysis. Source and
receiver use separate owned Chrome processes on the remote host, retaining a
common host clock domain. Both audio outputs additionally require Python 3,
`pulseaudio`, `pactl` and `libpulse`. CDP 9244 must be free. Each browser's separate PulseAudio
daemon uses only a private Unix socket in a mode-0700 temporary directory; it
changes neither the shared daemon nor its default output. Capture uses the public
signed-latency stream API, assembles fixed 10 ms DSP hops and emits bounded metrics,
never raw microphone/output audio. Both browsers, the private output servers,
monitor and tunnels have owned cleanup; the browser watchdog remains 15 minutes.

`npm run test:party:av-fixtures` validates marker matching and PCM detection,
including silence, irregular capture fragment boundaries and byte marker IDs/parity.
The browser run defaults to 40 paired transitions per phase; an impaired run uses
six baseline transitions and 40 impaired transitions. Set
`KTV_ROOM_TEST_AV_TRANSITIONS` to an integer from 6 to 60 to select the sample count.
At the default, generated audio lasts 132 seconds and marker IDs use eight bits.
An impaired phase begins after the existing two-second profile settling interval;
it does not measure the first two seconds of an abrupt network change. Every
transition observed after that boundary remains in the p95/maximum calculation.
For comparison only, `KTV_ROOM_TEST_PLAYOUT_HINTS=off` disables the isolated SFU's
adaptive video hint while retaining synchronized stream identities. The default
is `adaptive` (0–500 ms). This fixture flag changes no prepared/live configuration.
The 150 ms p95 / 250 ms maximum diagnostic gate is checked after collecting the
phases, so a failing baseline cannot hide the impairment evidence or pass the run.
This does not establish physical speaker/microphone timing. As of 2026-10-02,
controlled TCP and UDP impairment exceed the diagnostic limit; keep public media
disabled while investigating receiver playout and completing release acceptance.

The target must already have a trusted SSH key and `/usr/bin/google-chrome`.
The fixture does not change trust records or existing profiles/services. It
uploads only its synthetic microphone, creates a private temporary profile,
checks that Chrome and both forwards bind loopback, and owns cleanup plus a
15-minute remote watchdog. Keep CDP 9243, private SFU 17900 and public ICE
7881/TCP + 7882/UDP free. The public IP/interface must describe this SFU host.
The backend, accounts, rooms and grants are isolated temporary fixtures;
production configuration stays unchanged. Native clocks and drift/readiness
checks are retained. The remote 2026-10-01 exact frontend `d6d4041` passes the full singing,
private guide and handover journey 20/20, including spectral guide separation,
old unexpired room-token rejection and exactly one decoded replacement player.
Frontend `b9fbb91` adds automatic fresh-grant audience recovery; the exact build
passes 47/47 with signaling interruption and hybrid route flags enabled
(`/tmp/ktv-room-reconnect-release.log`). Party units 64/64, UI 38/38, PWA 8/8 and
public release 18/18 pass. Backend remains `9b74e8f`; frontend-only deployment
required no restart. Public media stays disabled. The private predeployment
backup is `/home/mli/ktv-party-reconnect-predeploy.jsu4hbq7`; old assets remain.

Frontend `29a62cf` (`main-_4MVKaX7.js`, `main-D0gBov56.css`) is deployed on
2026-10-02. Application fix `301d5c3` uses renewed WebSocket output leases for
publishing/private originals and fails closed on gate rejection. Backend remains
`9b74e8f`; no restart was required. Party units 73/73, UI 38/38 and PWA 8/8
(candidate with the same application change), A/V fixture units 3/3 including
three Python DSP cases, and exact public release checks 18/18 pass. The earlier
full no-impairment A/V/reconnect/hybrid candidate passes 51/51. Current exact-build
TCP/UDP runs complete the functional sequence but fail their A/V impairment gate.
Private rollback backup: `/home/mli/ktv-party-output-lease-predeploy.fxlAxE`.
Old frontend assets remain available; public rooms/guide remain on and media off.

The 2026-10-02 synchronization configuration enables `room.sync_streams: true`
and adaptive playout hints (`enabled: true`, `min: 0`, `max: 500`). Existing prepared
private configuration was updated atomically without rotating provider/control
keys; rollback is `livekit.before-sync-20261002.yaml` in the same mode-0700 private
directory. Both files remain mode 0600. Public remote transport passes 14/14 and
supervisor checks 9/9 with this policy. This does not authorize public enablement:
six-pair impaired timing still fails and longer clean/impaired runs stop at native
publisher drift. The full failed evidence remains in the implementation tracker.

All scripts remove their owned fixtures. This does not measure physical acoustic
alignment or distinct Wi-Fi/LTE networks. Failed journeys remain recorded in the
tracker until their concrete defect is resolved.

Provider-readiness preview `e88783a` was deployed on 2026-10-02, assets
`main-CXsosxfb.js` / `main-D0gBov56.css`. HTTP 409 pending confirmation has bounded
same-nonce retries; unavailable/permission failures remain terminal. Backend
127/127, party 81/81, exact UI 38/38, PWA 8/8, continuous TCP handover 63/63 and
same-source UDP candidate 65/65 pass. Exact public release checks pass 18/18.
Backend restarted with zero active audio rooms. Rollback backup:
`/home/mli/ktv-party-provider-ready-predeploy.pvof0w47`; frontend assets retained.
Rooms/guide stay enabled and media disabled. Failed impaired timing and the
59-audience setup failure remain open in the tracker.

Capture cadence frontend preview was **`ea986cd`**, assets **`main-1zcZhmf9.js` /
`main-D0gBov56.css`**; backend implementation remains **`e88783a`**, no restart.
Capture preserves its 25 fps cadence and uses manual frame requests when supported.
Party units 84/84, A/V fixture units 9/9, exact UI 42/42, PWA 8/8, native clean
40-transition room journey 26/26 and public release 18/18 pass. Clean skew p95 is
57.30 ms, maximum 57.97 ms, no unmatched edges. Rollback backup:
`/home/mli/ktv-party-cadence-predeploy.rbaklp_4`; SQLite backup integrity and foreign
keys pass; old assets retained and no active audio room at publication. Public
room/guide flags remain enabled and media disabled. Impaired timing comparisons
still fail; this is not an online beta. Evidence is in the implementation tracker.
The fixture now follows timing events over one bounded owned SSH channel;
`KTV_ROOM_TEST_PLAYOUT_MAX_MS` changes only the isolated SFU (50–500, default 500).
It changes neither prepared production policy nor the timing acceptance thresholds.

The preceding lyric-source frontend/backend preview is **`f58a8f3`**, assets
**`main-CedlFAY-.js` / `main-D0gBov56.css`**. Lyrics now use the authorized
`screen_share` source, explicitly retaining 1280×720, 350 kbit/s and 25 fps.
JWT sources, gateway validation, provider readiness and audience filtering share
that contract. Upgrade these components together with media disabled and no
active publisher. Matching worker image **`ktv-party-media:f58a8f3`** has local
image ID `sha256:8c5ad85c703d975f77ed63fca30c367973be503d665f988308b9a5f40bf3ad11`;
its four control source file hashes match the committed repository. Supervisor
9/9 and public direct/trusted TLS-TURN/revocation 14/14 pass on isolated policy.
No persistent SFU is started.

Exact build/type check, UI 42/42, PWA 8/8, clean native 40-transition journey
26/26 and public release 18/18 pass; party units 84/84 and backend 128/128 pass.
Clean skew p95 **58.48 ms**, maximum **75.30 ms**, no unmatched edges. TCP/UDP
impaired timing remains a failure. The earlier PWA reload failure is retained;
a fresh owned browser passes on the same app build, and bounded fixture diagnostics
help investigate recurrence. This is a preview with room/guide enabled and media
disabled. Physical, mobile, distinct-network and capacity gates remain open.

Rollback backup **`/home/mli/ktv-party-lyric-source-predeploy.kih_i_94`** includes
consistent SQLite, previous frontend and private backend configuration, with
integrity/foreign keys verified. Previous frontend/backend were `ea986cd`/`e88783a`.
Old hashed assets remain available; backend restart and atomic entry/worker
publication used zero active audio rooms. Actual backend health is
**`http://127.0.0.1:3101/api/health`**; do not infer this port from other applications.
Public HTTP/WSS, feature flags, exact asset bytes/SHA, SQLite and temporary-room
cleanup pass. See the implementation tracker for individual evidence paths.

The preceding PWA activation frontend is **`fe4f216`**, backend remains **`f58a8f3`**; assets are
**`main-9fvbdGW2.js` / `main-DnE6rWx5.css`**. This frontend-only release fixes PWA
activation/retry and authoritative empty catalogs. Exact build/type check, UI
42/42, PWA 10/10, clean native A/V 26/26 (40 matched transitions, no unmatched;
p95 58.98 ms, maximum 75.70 ms) and public release 18/18 pass. See the tracker
for evidence paths. The backend and matching media-worker contract are unchanged.
Rooms/guide remain enabled; online media is disabled and no persistent SFU runs.

Private rollback backup **`/home/mli/ktv-party-pwa-activation-predeploy.4pj04fvs`**
contains consistent SQLite, previous static frontend and private backend config;
integrity and foreign keys pass. Previous frontend/backend were `f58a8f3`. Old
hashed assets remain; HTML and worker publication used atomic replacement with
zero preparing/scheduled/playing rooms, without backend restart. The public
probe verifies exact bytes/source SHA and closes its temporary room.

Common receiver-buffer experiments remain fixture-only. The TCP experiment
passes, but UDP fails at p95 349.68 ms and maximum 699.93 ms. Physical/mobile,
installed-PWA, handover timing, distinct networks and capacity acceptance are
still open; this release does not enable online singing.

The preceding native lease guard frontend is **`ca6c757`**, backend **`f58a8f3`**. Assets:
**`main-CgZ1TyOk.js`**, **`main-DnE6rWx5.css`** and
**`partyLeaseGuard.worklet-5od8dAEf.js`**. The rendering guard prevents expired
stage and published mic/backing from resuming while page tasks remain blocked.
It covers the existing 15-second stage-lease ceiling; publishing retains its
existing permit validation. Audio enablement requires loading and verifying the
hashed native module, which is precached with this app version. Invalid room API
payloads now produce recovery text while retaining the entry form.

Exact committed build/type check, party units 90/90, UI 45/45, PWA 10/10,
native lease 15/15 and full clean streaming/recovery/handover 53/53 pass.
All 40 clean marker transitions match without unmatched edges (p95 59.73 ms,
maximum 99.50 ms). Public release 21/21 verifies exact app/CSS/worklet/worker
bytes, worklet MIME and precaching, flags and HTTP/WSS, SQLite integrity/FKs,
source SHA and own-room cleanup. Individual logs are in the tracker.

Private rollback backup **`/home/mli/ktv-party-lease-guard-predeploy.073ojqew`**
contains consistent SQLite, previous frontend and private backend config. Previous
frontend/backend were `fe4f216` / `f58a8f3`. Old assets remain; HTML and worker
were atomically replaced with zero preparing/scheduled/playing rooms and no backend
restart. Rooms/guide remain enabled, media disabled, no persistent SFU. Physical
stage replacement, mobile/field PWA, impaired A/V and source drift, handover timing,
distinct networks and representative capacity remain open. Receiver buffering
experiments are fixture-only; prepared SFU policy is unchanged.

Post-release integrated native replacement also passes **41/41** on this unchanged
build. The real isolated backend and two independently captured Chrome outputs
verify early-start refusal, preserved checkpoint/generation, no measured output
overlap through blocked tasks and actual render suspension/resume, and stale lease
replay rejection. Observer fixtures pass **14/14**, including five PCM checks.

Current frontend is **`7c1f583`**, backend remains **`f58a8f3`**. App asset is
**`main-BRuMNKuZ.js`**; CSS and native guard remain **`main-DnE6rWx5.css`** and
**`partyLeaseGuard.worklet-5od8dAEf.js`**. Small persistent rendered phase errors
use bounded native rate feedback with integrated media-position tracking;
unchanged leases no longer reschedule native stops/worklet grants every frame.
Authority checks and large-error recovery remain active.

Exact build/type check, party units **94/94**, UI **45/45**, PWA **10/10**, native
lease **15/15**, integrated replacement **41/41**, full native streaming/output
interruption/recovery/handover **56/56** and public release **21/21** pass.
The clean native run includes a real 50.19 ms isolated output-process pause;
40 A/V pairs have no unmatched edges, p95 **64.46 ms**, maximum **86.51 ms**.
These are software measurements, not physical acoustic acceptance.

Private rollback backup **`/home/mli/ktv-party-rate-preview-predeploy.kodqxyuw`**
contains consistent SQLite, previous static frontend and private backend config
(0700 directory/0600 files). Previous frontend/backend were `ca6c757`/`f58a8f3`.
Old hashed assets remain; entry/worker were atomically replaced with zero active
performances and no backend restart. Rooms/guide stay enabled, media disabled,
no persistent SFU. Earlier unexplained larger render stalls, impaired UDP timing,
physical/mobile/installed-PWA coverage, handover timing and representative load/
real networks remain open. Rate correction can affect pitch slightly; physical
listening and guide-alignment acceptance remain required.
Evidence is in the implementation tracker. This adds software evidence; physical
replacement and the other online release gates above remain open.

Before enabling online rooms publicly, record these results:

- HTTPS/WSS admission through the gateway, while raw signaling/admin ports remain private.
- Different real networks for publisher and audience: receive one backing/mic mix
  and one lyric video; no independently playing backing on the audience screen.
- Force `iceTransportPolicy: 'relay'` in the test browser's RTC configuration and
  inspect the selected candidate pair to prove TURN was used. Measure received
  audio/video alignment, jitter, loss, and connection time; a successful socket
  handshake is insufficient.
- Singer replacement, member removal, room close and backend/worker loss remove
  the active participant at the provider. Reusing an old unexpired JWT must fail.
- Physical microphone/headphones test with the private original vocal enabled;
  assess acoustic leakage, wired/BT correction and venue-mixer duplicate backing.
- Five-minute performance and a full local/online/hybrid handover on supported
  phones; background/lock, permission refusal, input/output loss and explicit retry.
- PWA update/offline behavior: KTV state, credentials and pinned party assets use
  NetworkOnly; reload stops old capture and reconnects with current room authority.

### Operational diagnostics and troubleshooting

`GET /api/admin/ktv-health` requires an authenticated application admin and returns
`Cache-Control: no-store`. This is an operations endpoint; room hosts continue to
use room permissions for normal controls. It returns aggregate room/playback/grant
counts, socket/ticket/buffer counts, media readiness, memory and event-loop delay.
HTTP measurements have five fixed categories and eight latency buckets; no
request path, name, member/room ID, body, token or invitation is retained. The
recent window resets every five minutes; process totals reset on restart. The
reported p95 is a bucket ceiling, with `>2500` for requests beyond 2.5 seconds.

Review these alert codes during operations:

| Alert | Threshold | Action |
| --- | --- | --- |
| `*.latency` | At least 20 requests in the current window, p95 bucket above 500 ms | Inspect process CPU, memory, event-loop delay and SQLite/WAL pressure before increasing room limits |
| `*.errors` | At least five HTTP 5xx responses and at least 5% of category requests | Check backend logs and dependency availability; aborted requests are counted separately |
| `eventLoop.delay` | Last-minute event-loop p95 above 100 ms | Move CPU work away from the room process and inspect host load |
| `media.unavailable` | Configured worker fails its private readiness check | Keep online performances stopped; inspect supervisor status, policy connectivity and provider configuration |

Backend log rotation is installed from `server/ktv-party-logrotate.conf.example`.
The existing daily timer keeps 14 rotations with compression, a 10 MiB maximum
size trigger and 14-day expiry. Size checks occur when the scheduler runs; this
is not an instantaneous disk cap. Only the two karaoke backend PM2 logs are
covered. `copytruncate` lets PM2 retain its open descriptors, but may lose lines
written during truncation; diagnostic counters do not depend on those lines.
Logs have mode 0600. Database room audits already have configured per-room caps,
receipt retention and closed-room expiry.

For a room problem:

1. Confirm the current build and open the device's **Audio timing and health**
   panel. Distinguish calculated sample phase from measured acoustic alignment.
2. If startup fails, tap enable again after confirming browser playback permission.
   Startup waits for a moving audio clock and times out after eight seconds. It
   never marks a stalled output ready merely because `resume()` returned.
3. For drift, suspension or an output change, confirm headphones/output and retry
   explicitly. Required-device failures pause the room; optional-guide failure
   leaves a healthy local backing device playing.
4. Check the room connection and clock status. Reconnect fetches fresh authority;
   stale tickets/grants must not be copied or replayed. A reload releases capture.
5. For online failure, inspect the private media readiness and supervisor status.
   Verify direct TURN DNS, certificate expiry and the documented firewall ports.
   Restore the service before obtaining fresh microphone consent and a new grant.
6. For pending guests or removed devices, use host admission/device controls.
   An application admin role is unnecessary for those room actions.

Share only diagnostic values and symptoms. Do not copy tokens, invitation/pairing
codes, private keys, environment files or raw signaling URLs into support logs.

## 5. Backup, release and rollback

The current frontend preview is `d33b209`, deployed 2026-10-02; backend remains
`f58a8f3`. Assets are `main-DU8DSm-f.js`, `main-DnE6rWx5.css`,
`partyLeaseGuard.worklet-BWdT3O5D.js` and `partyEncodedLease.worker-BxVsrNxp.js`.
Serve both native modules as JavaScript at their hashed same-origin paths and
precache them with the generated worker. Exact build, UI 45/45, PWA 10/10,
isolated full native room 56/56 and public release 23/23 pass. The private rollback
backup is `/home/mli/ktv-party-encoded-expiry-predeploy.p_7g43dq`, holding the
previous frontend `7c1f583`, unchanged backend configuration, consistent checked
database backup and static archive. Public media remains disabled; impaired timing,
physical/mobile, capacity and online deployment gates remain open.

Before changing the backend, capture the deployed frontend asset names and build
SHA, backend commit, nginx site configuration and private runtime configuration.
Use SQLite's online backup API for `auth.db` so the WAL is included consistently;
copying only the database file while it is active is insufficient. Store backups
privately, outside the web root, with mode 0600. Keep generated secret files out of
the source archive.

```bash
umask 077
ktv_backup_root=$(mktemp -d /home/mli/ktv-party-backup.XXXXXX)
sqlite3 /var/www/html/others/music/_auth/auth.db ".backup '$ktv_backup_root/auth.db'"
tar -C /var/www/html/others/music -cf "$ktv_backup_root/frontend.tar" index.html sw.js assets
git rev-parse HEAD > "$ktv_backup_root/backend-commit.txt"
```

Also archive the active nginx site file and `.env.server` in this private directory
using their actual host paths. Record the running PM2 process command, current
frontend hashed asset names and certificate expiry. Check the database backup
with `sqlite3 "$ktv_backup_root/auth.db" 'PRAGMA integrity_check'` before release.

Publish new hashed assets before replacing `index.html` and `sw.js`. Retain old
hashed assets so existing open/installed clients can finish loading. Restart PM2
with its existing entry/configuration, check backend health, verify the deployed
SHA and additive schema, and run the public protocol/deployment checks. Close
temporary test rooms and verify `PRAGMA foreign_key_check` returns no violations.
Record the backup path, release SHA/assets/date and evidence in the tracker.

For a streaming rollback, stop the media container first, disable
`KTV_MEDIA_ENABLED`, restore the prior static/backend release and restart PM2.
Performances recover with a fresh clock; users explicitly prepare/resume. Preserve
the current additive database schema and data when rolling software back. Restoring
an old database discards newer room/user state and is a separate disaster recovery
action, not the normal rollback. The original main rollback point is
`ktv-party-baseline-2026-09-29` at `6e8504b`.

For rollback to code predating `ktv-timing.js`, stop the backend before launching
the older release. Read `max_lease_ms + max_margin_ms` from `ktv_output_safety`
(use 8500 ms if the table/row is absent), wait at least that duration, then start
old code. Older releases cannot read this durable bound themselves. Keep the
table/data when rolling back. This silence wait is required if longer leases
have ever been configured; it prevents an old output from overlapping new audio.
