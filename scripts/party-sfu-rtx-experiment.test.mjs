import test from 'node:test'
import assert from 'node:assert/strict'
import { continueRtxSource, validateSfuRtxImage, sfuRtxSource, sfuRtxOriginalHash, sfuBaseImage, sfuGoImage } from './party-sfu-rtx-experiment.mjs'

function fixture() {
  const marker = { version: 1, privateSfuExperiment: true, continueRtxOnPli: true, source: sfuRtxSource,
    originalDowntrackHash: sfuRtxOriginalHash, baseImage: sfuBaseImage, goImage: sfuGoImage,
    imageId: 'sha256:' + 'a'.repeat(64), binaryHash: 'b'.repeat(64) }
  const image = { Id: marker.imageId, Config: { Entrypoint: ['/livekit-server'], Labels: {
    'ktv.private.sfu.rtx': 'continue', 'org.opencontainers.image.revision': sfuRtxSource,
    'ktv.private.sfu.original-downtrack': sfuRtxOriginalHash } } }
  return { marker, image }
}
test('private SFU selection requires exact artifact identity, source, toolchain, runtime and policy labels', () => {
  const { marker, image } = fixture()
  assert.equal(validateSfuRtxImage(marker, image), marker.imageId)
  for (const changes of [{ version: 2 }, { privateSfuExperiment: false }, { continueRtxOnPli: false },
    { source: 'other' }, { originalDowntrackHash: '0'.repeat(64) }, { baseImage: 'latest' }, { goImage: 'latest' },
    { imageId: 'mutable:tag' }, { imageId: 'sha256:' + 'c'.repeat(64) }, { binaryHash: 'invalid' }])
    assert.throws(() => validateSfuRtxImage({ ...marker, ...changes }, image), /^Error: SFU_RTX_IMAGE$/)
  for (const changed of [null, { ...image, Id: 'mutable:tag' }, { ...image, Config: null },
    { ...image, Config: { ...image.Config, Entrypoint: ['/bin/sh', '/livekit-server'] } },
    { ...image, Config: { ...image.Config, Labels: { ...image.Config.Labels, 'ktv.private.sfu.rtx': 'stop' } } }])
    assert.throws(() => validateSfuRtxImage(marker, changed), /^Error: SFU_RTX_IMAGE$/)
})
test('the source patch refuses unpinned source and arbitrary flag declarations', () => {
  for (const source of [null, '', 'FlagStopRTXOnPLI = true', 'FlagStopRTXOnPLI = false',
    'FlagStopRTXOnPLI = true\nFlagStopRTXOnPLI = true', 'secret-source'])
    assert.throws(() => continueRtxSource(source), /^Error: SFU_RTX_SOURCE$/)
})
