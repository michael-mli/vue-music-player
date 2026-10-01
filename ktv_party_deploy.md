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

The network settings follow [LiveKit deployment guidance](https://docs.livekit.io/transport/self-hosting/deployment/)
and its [port reference](https://docs.livekit.io/transport/self-hosting/ports-firewall/).
The generated configuration targets the [pinned v1.13.7 configuration](https://github.com/livekit/livekit/blob/v1.13.7/config-sample.yaml).

## 2. Prepare the private configuration

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

Room snapshots expose `mediaConfigured`; the host sees the mode selector only
when configured, and cannot change modes during a performance. Worker readiness
is checked separately. A configured service with a failed worker cannot issue
media credentials or start an online song.

## 4. Verification before public release

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
