// Private codec comparison only. The production app/source and dist stay intact.
// A marker at the build root makes the normal static publication whitelist refuse
// this artifact. Advanced-codec compatibility/backup guards require separate work.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { build } from 'vite'
import { periodicKeyframeWorker } from './party-codec-keyframes.mjs'

const args = process.argv.slice(2), options = {}
if (args.length===1&&args[0]==='--help') {
  console.log('Use --codec vp8|vp9|h264 --out-dir /tmp/ktv-codec-candidate-NAME [--keyframe-ms 250..5000] [--transport default|dual]; creates a private, non-publishable comparison build.')
  process.exit(0)
}
for (let index = 0; index < args.length; index += 2) {
  assert.ok(['--codec', '--out-dir','--keyframe-ms','--transport'].includes(args[index]) && args[index + 1], 'Use --codec vp8|vp9|h264 --out-dir /tmp/ktv-codec-candidate-NAME [--keyframe-ms 250..5000] [--transport default|dual]')
  assert.ok(!Object.hasOwn(options, args[index]), 'Duplicate experiment option')
  options[args[index]] = args[index + 1]
}
const codec = options['--codec'], directory = path.resolve(options['--out-dir'] || '.')
const transport = options['--transport'] || 'default'
assert.ok(['default', 'dual'].includes(transport), 'Unsupported private transport topology')
const keyframeMs = options['--keyframe-ms'] === undefined ? null : Number(options['--keyframe-ms'])
assert.ok(keyframeMs===null||Number.isInteger(keyframeMs)&&keyframeMs>=250&&keyframeMs<=5000,'Invalid keyframe interval')
assert.ok(['vp8', 'vp9', 'h264'].includes(codec), 'Unsupported comparison codec')
assert.match(directory, /^\/tmp\/ktv-codec-candidate-[A-Za-z0-9_-]+$/, 'Private experiment output directory required')
await fs.mkdir(directory, { mode: 0o700 }) // Refuse existing artifacts and symlinks.
const root = path.resolve('.'), transportPath = path.join(root, 'src/services/partyMediaTransport.ts')
async function distDigest() {
  const digest = createHash('sha256'), dist = path.join(root, 'dist')
  async function visit(directory) {
    const entries = await fs.readdir(directory, { withFileTypes: true })
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(directory, entry.name)
      assert.ok(!entry.isSymbolicLink(), 'Production dist contains a symlink')
      if (entry.isDirectory()) await visit(file)
      else if (entry.isFile()) { digest.update(path.relative(dist, file) + '\0'); digest.update(await fs.readFile(file)) }
    }
  }
  await visit(dist)
  return digest.digest('hex')
}
const originalDist = await distDigest()
const source = await fs.readFile(transportPath, 'utf8')
const needle = "degradationPreference: 'maintain-resolution', simulcast: false, screenShareEncoding: { maxBitrate: 350000, maxFramerate: 25 }"
assert.equal(source.split(needle).length, 2, 'Production publisher options changed; inspect the experiment transform')
let transformed = source.replace(needle, `videoCodec: '${codec}', backupCodec: false, ${needle}`)
if (transport === 'dual') {
  const roomNeedle = 'const room = new Room({ adaptiveStream: false, dynacast: false, disconnectOnPageLeave: true,'
  assert.equal(transformed.split(roomNeedle).length, 2, 'Inspect changed Room configuration before comparing transport topology')
  transformed = transformed.replace(roomNeedle, 'const room = new Room({ singlePeerConnection: false, adaptiveStream: false, dynacast: false, disconnectOnPageLeave: true,')
}
const workerPath=path.join(root,'src/services/partyEncodedLease.worker.js')
const workerSource=await fs.readFile(workerPath,'utf8')
const modifiedWorker=keyframeMs===null?workerSource:periodicKeyframeWorker(workerSource,keyframeMs)
const marker = { version: 1, privateCodecExperiment: true, codec, backupCodec: false,keyframeMs,transport,
  width: 1280, height: 720, fps: 25, maxBitrate: 350000,
  sourceCommit: execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim(),
  transportSha256: createHash('sha256').update(source).digest('hex'),
  effectiveTransportSha256: createHash('sha256').update(transformed).digest('hex'),
  effectiveWorkerSha256:createHash('sha256').update(modifiedWorker).digest('hex'),
  clientVersion: JSON.parse(await fs.readFile('node_modules/livekit-client/package.json', 'utf8')).version,
  note: 'Native SDK codec behavior applies; no clock, capture cadence, authorization, guard or observation limit changes.',
}
await fs.writeFile(path.join(directory, 'ktv-codec-experiment.json'), JSON.stringify(marker, null, 2) + '\n', { mode: 0o600 })
let transforms = 0, workerLoads=0
await build({
  configFile: path.join(root, 'vite.config.ts'),
  build: { outDir: directory },
  plugins: [{ name: 'owned-ktv-codec-comparison', enforce: 'pre', load(id) {
    if(keyframeMs===null||id!==workerPath+'?url')return
    workerLoads++
    const reference=this.emitFile({type:'asset',name:'partyEncodedLease.worker.js',source:modifiedWorker})
    return `export default import.meta.ROLLUP_FILE_URL_${reference};`
  }, transform(code, id) {
    if (id !== transportPath) return
    assert.equal(code, source, 'Publisher source changed during the experiment build')
    transforms++
    return transformed
  } }],
})
assert.equal(transforms, 1, 'Codec comparison must transform exactly one actual publisher module')
assert.equal(workerLoads,keyframeMs===null?0:1,'Private keyframe policy must replace exactly one worker asset')
assert.equal(await distDigest(), originalDist, 'Production dist changed during the private comparison build')
assert.equal(await fs.readFile(transportPath, 'utf8'), source, 'Publisher source changed during the private comparison build')
assert.equal(await fs.readFile(workerPath,'utf8'),workerSource,'Production worker changed during the private comparison build')
assert.equal(execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim(), marker.sourceCommit,
  'Source commit changed during the private comparison build')
console.log('Private codec artifact:', directory, '; codec:', codec, '; production dist unchanged')
