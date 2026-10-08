// Owned fixture only. Classify the lyric canvas as text and request two VP8
// temporal layers through the native API. No SDP rewriting or browser flags.
// Native capture, encoding and presented counters must still meet the gates.
export function installSenderCadenceExperiment() {
  if (window.__senderCadenceExperiment) throw new Error('CADENCE_ALREADY_INSTALLED')
  const Peer = window.RTCPeerConnection
  let configured = 0
  window.RTCPeerConnection = class extends Peer {
    addTransceiver(track, init, ...rest) {
      if (track?.kind !== 'video' || !['sendonly', 'sendrecv'].includes(init?.direction)) {
        return super.addTransceiver(track, init, ...rest)
      }
      if (init.sendEncodings?.length !== 1 || init.sendEncodings[0].maxBitrate !== 350000 ||
        init.sendEncodings[0].maxFramerate !== 25 || init.sendEncodings[0].scalabilityMode) {
        throw new Error('CADENCE_ENCODING_POLICY')
      }
      const previous = track.contentHint
      track.contentHint = 'text'
      if (track.contentHint !== 'text') throw new Error('CADENCE_HINT_UNSUPPORTED')
      try {
        const transceiver = super.addTransceiver(track, { ...init,
          sendEncodings: [{ ...init.sendEncodings[0], scalabilityMode: 'L1T2' }] }, ...rest)
        configured++
        return transceiver
      } catch (error) { track.contentHint = previous; throw error }
    }
  }
  window.__senderCadenceExperiment = { get configured() { return configured } }
}
