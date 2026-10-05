// Private comparison of VP9 temporal structure through the native API. Actual
// codec, resolution, capture/encode/decode/presentation rates remain mandatory.
export function installSenderTemporalExperiment() {
  if (window.__senderTemporalExperiment) throw new Error('TEMPORAL_INSTALLED')
  const Peer = window.RTCPeerConnection
  let configured = 0
  window.RTCPeerConnection = class extends Peer {
    addTransceiver(track, init, ...rest) {
      if (track?.kind !== 'video' || !['sendonly', 'sendrecv'].includes(init?.direction))
        return super.addTransceiver(track, init, ...rest)
      const encoding = init.sendEncodings?.[0]
      if (init.sendEncodings?.length !== 1 || encoding.maxBitrate !== 350000 ||
        encoding.maxFramerate !== 25 || encoding.scalabilityMode !== 'L1T3' ||
        track.contentHint !== 'motion') throw new Error('TEMPORAL_ENCODING_POLICY')
      const result = super.addTransceiver(track, { ...init,
        sendEncodings: [{ ...encoding, scalabilityMode: 'L1T1' }] }, ...rest)
      configured++
      return result
    }
  }
  window.__senderTemporalExperiment = { snapshot: () => ({ configured, requestedMode: 'L1T1' }) }
}
