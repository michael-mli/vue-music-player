import { createHash } from 'node:crypto'

export const sfuRtxSource = '8d11efdfcd4220092b6ac7b8a21af28526da5a6b'
export const sfuRtxOriginalHash = 'f1c9470c237a5f6350daa2cffb132aaaa303bdca6ac8981794dc9afed4bbfc03'
export const sfuBaseImage = 'livekit/livekit-server:v1.13.7@sha256:6fd3b7088874c4d119160dd688798dfec852bc014786d392caad15f6f63912a3'
export const sfuGoImage = 'golang:1.26.7-alpine3.24@sha256:28d89ee9cc0ff9fec75c82ca201e6bf7fdf9a679d4b7b24dfa04f2bb766bb468'
const hash = value => createHash('sha256').update(value).digest('hex')

export function continueRtxSource(original) {
  if (typeof original !== 'string' || hash(original) !== sfuRtxOriginalHash ||
    original.split('FlagStopRTXOnPLI = true').length !== 2) throw new Error('SFU_RTX_SOURCE')
  return original.replace('FlagStopRTXOnPLI = true', 'FlagStopRTXOnPLI = false')
}

export function validateSfuRtxImage(marker, image) {
  const labels = image?.Config?.Labels
  if (!marker || marker.version !== 1 || marker.privateSfuExperiment !== true || marker.continueRtxOnPli !== true ||
    marker.source !== sfuRtxSource || marker.originalDowntrackHash !== sfuRtxOriginalHash ||
    marker.baseImage !== sfuBaseImage || marker.goImage !== sfuGoImage ||
    !/^sha256:[a-f0-9]{64}$/.test(marker.imageId || '') || !/^[a-f0-9]{64}$/.test(marker.binaryHash || '') ||
    image?.Id !== marker.imageId || labels?.['ktv.private.sfu.rtx'] !== 'continue' ||
    labels?.['org.opencontainers.image.revision'] !== sfuRtxSource ||
    labels?.['ktv.private.sfu.original-downtrack'] !== sfuRtxOriginalHash ||
    image?.Config?.Entrypoint?.length !== 1 || image.Config.Entrypoint[0] !== '/livekit-server')
    throw new Error('SFU_RTX_IMAGE')
  return marker.imageId
}
