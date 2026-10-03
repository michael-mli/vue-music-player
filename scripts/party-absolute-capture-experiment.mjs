// Private native API experiment. Preserve extension order, mandatory extensions,
// native SDP generation, media payloads, clocks and expiry/quality bounds.
export function installAbsoluteCaptureExperiment() {
  const uri = 'http://www.webrtc.org/experiments/rtp-hdrext/abs-capture-time'
  const Peer = window.RTCPeerConnection, evidence = []
  const supported = typeof RTCRtpTransceiver.prototype.getHeaderExtensionsToNegotiate === 'function' &&
    typeof RTCRtpTransceiver.prototype.setHeaderExtensionsToNegotiate === 'function'
  let configured = 0, missing = 0, failures = 0
  function configure(transceiver) {
    if (!supported) return
    const kind = transceiver.receiver?.track?.kind
    if (!['audio', 'video'].includes(kind)) return
    try {
      const extensions = transceiver.getHeaderExtensionsToNegotiate()
      const extension = extensions.find(item => item.uri === uri)
      if (!extension) { missing++; return }
      if (extension.direction === 'sendrecv') return
      transceiver.setHeaderExtensionsToNegotiate(extensions.map(item => item.uri === uri
        ? { ...item, direction: 'sendrecv' } : item))
      configured++
      evidence.push({ kind, previous: ['sendonly', 'recvonly', 'inactive', 'stopped'].includes(extension.direction)
        ? extension.direction : 'unknown' })
      if (evidence.length > 64) evidence.shift()
    } catch { failures++ }
  }
  window.RTCPeerConnection = class extends Peer {
    addTransceiver(...args) {
      const transceiver = super.addTransceiver(...args)
      configure(transceiver)
      return transceiver
    }
    createOffer(...args) {
      for (const transceiver of this.getTransceivers()) configure(transceiver)
      return super.createOffer(...args)
    }
    createAnswer(...args) {
      for (const transceiver of this.getTransceivers()) configure(transceiver)
      return super.createAnswer(...args)
    }
  }
  window.__absoluteCaptureExperiment = { supported, evidence,
    get configured() { return configured }, get missing() { return missing }, get failures() { return failures } }
}
