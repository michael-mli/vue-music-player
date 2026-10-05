// Private one-line SFU policy comparison; never updates the deployed SFU image.
import fs from 'node:fs/promises'
import path from 'node:path'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import { continueRtxSource, validateSfuRtxImage, sfuRtxSource, sfuRtxOriginalHash, sfuBaseImage, sfuGoImage } from './party-sfu-rtx-experiment.mjs'

if (process.argv.length !== 4 || process.argv[2] !== '--out') throw new Error('Use --out with a new private build directory')
const root = path.resolve(process.argv[3]), exec = promisify(execFile)
await fs.mkdir(root, { mode: 0o700 }) // Existing artifacts must remain immutable.
const source = path.join(root, 'source'); await fs.mkdir(source, { mode: 0o700 })
console.log('Downloading pinned SFU source for private RTX comparison')
const response = await fetch(`https://codeload.github.com/livekit/livekit/tar.gz/${sfuRtxSource}`, { signal: AbortSignal.timeout(60000) })
if (!response.ok) throw new Error('SFU_RTX_DOWNLOAD')
let length = 0; const chunks = []
for await (const chunk of response.body) {
  length += chunk.byteLength
  if (length > 32 * 1024 * 1024) throw new Error('SFU_RTX_ARCHIVE_BOUND')
  chunks.push(chunk)
}
const archive = path.join(root, 'source.tar.gz'); await fs.writeFile(archive, Buffer.concat(chunks), { mode: 0o600 })
const entries = (await exec('tar', ['-tzf', archive], { maxBuffer: 4 * 1024 * 1024 })).stdout.trim().split('\n')
if (!entries.length || entries.length > 20000 || entries.some(entry =>
  !entry.startsWith(`livekit-${sfuRtxSource}/`) || entry.split('/').some(part => part === '..')))
  throw new Error('SFU_RTX_ARCHIVE_PATH')
await exec('tar', ['-xzf', archive, '--strip-components=1', '--no-same-owner', '--no-same-permissions', '-C', source])
const downtrack = path.join(source, 'pkg/sfu/downtrack.go')
await fs.writeFile(downtrack, continueRtxSource(await fs.readFile(downtrack, 'utf8')))
const upstreamDockerfile = await fs.readFile(path.join(source, 'Dockerfile'), 'utf8')
if (!upstreamDockerfile.includes(`FROM ${sfuGoImage} AS builder`)) throw new Error('SFU_RTX_TOOLCHAIN')
await fs.writeFile(path.join(source, 'Dockerfile.rtx'), `FROM ${sfuGoImage} AS builder
WORKDIR /workspace
ENV GOTOOLCHAIN=local GOMAXPROCS=2 GOMEMLIMIT=768MiB CGO_ENABLED=0
COPY go.mod go.sum ./
RUN go mod download
COPY cmd/ cmd/
COPY pkg/ pkg/
COPY test/ test/
COPY version/ version/
RUN timeout 600 go test -p 2 ./pkg/sfu -run 'Test.*(RTX|Nack|NACK|Retransmit)' -count=1
RUN timeout 600 go build -p 2 -trimpath -o /livekit-server ./cmd/server
FROM ${sfuBaseImage}
LABEL ktv.private.sfu.rtx="continue" org.opencontainers.image.revision="${sfuRtxSource}" ktv.private.sfu.original-downtrack="${sfuRtxOriginalHash}"
COPY --from=builder /livekit-server /livekit-server
ENTRYPOINT ["/livekit-server"]
`, { mode: 0o600 })
console.log('Building bounded private SFU comparison with pinned toolchain and runtime')
const tag = 'ktv-party-sfu:rtx-continue-v1.13.7'
await new Promise((resolve, reject) => {
  const child = spawn('docker', ['build', '-f', 'Dockerfile.rtx', '-t', tag, '.'], { cwd: source, stdio: 'inherit' })
  const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('SFU_RTX_BUILD_TIMEOUT')) }, 20 * 60 * 1000)
  child.on('error', () => { clearTimeout(timer); reject(new Error('SFU_RTX_BUILD')) })
  child.on('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error('SFU_RTX_BUILD')) })
})
const image = JSON.parse((await exec('docker', ['image', 'inspect', tag], { maxBuffer: 1024 * 1024 })).stdout)[0]
const binaryHash = (await exec('docker', ['run', '--rm', '--read-only', '--network=none', '--cap-drop=ALL',
  '--security-opt=no-new-privileges', '--entrypoint=sha256sum', image.Id, '/livekit-server'])).stdout.split(/\s/)[0]
const marker = { version: 1, privateSfuExperiment: true, continueRtxOnPli: true, source: sfuRtxSource,
  originalDowntrackHash: sfuRtxOriginalHash, baseImage: sfuBaseImage, goImage: sfuGoImage,
  archiveHash: createHash('sha256').update(await fs.readFile(archive)).digest('hex'), imageId: image.Id, binaryHash }
validateSfuRtxImage(marker, image)
await fs.writeFile(path.join(root, 'sfu-rtx-experiment.json'), JSON.stringify(marker, null, 2) + '\n', { mode: 0o600 })
console.log('Private SFU RTX comparison artifact verified:', JSON.stringify({ imageId: image.Id, binaryHash, source: sfuRtxSource }))
