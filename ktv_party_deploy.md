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
It requires Linux PulseAudio and Docker. All scripts remove their owned fixtures.
Synthetic loopback results do not measure speaker/headphone alignment or internet
latency. A failed integration journey remains an open gate in the tracker.

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
