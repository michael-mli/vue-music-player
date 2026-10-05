// Private comparison of VP8/VP9 temporal structure through the native API. Actual
// codec, resolution, capture/encode/decode/presentation rates remain mandatory.
export function installSenderTemporalExperiment(codec='vp9') {
  if(!['vp8','vp9'].includes(codec))throw new Error('TEMPORAL_CODEC_CONFIG')
  if (window.__senderTemporalExperiment) throw new Error('TEMPORAL_INSTALLED')
  const Peer = window.RTCPeerConnection
  let configured = 0
  window.RTCPeerConnection = class extends Peer {
    addTransceiver(track, init, ...rest) {
      if (track?.kind !== 'video' || !['sendonly', 'sendrecv'].includes(init?.direction))
        return super.addTransceiver(track, init, ...rest)
      const encoding = init.sendEncodings?.[0]
      if (init.sendEncodings?.length !== 1 || encoding.maxBitrate !== 350000 ||
        encoding.maxFramerate !== 25 || encoding.scalabilityMode !== (codec==='vp9'?'L1T3':undefined) ||
        track.contentHint !== (codec==='vp9'?'motion':'')) throw new Error('TEMPORAL_ENCODING_POLICY')
      const result = super.addTransceiver(track, { ...init,
        sendEncodings: [{ ...encoding, scalabilityMode: 'L1T1' }] }, ...rest)
      configured++
      return result
    }
  }
  window.__senderTemporalExperiment = { snapshot: () => ({ configured, codec, requestedMode: 'L1T1' }) }
}
