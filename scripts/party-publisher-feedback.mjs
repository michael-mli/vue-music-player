// Private fixture hypothesis only. Keep a negotiated supported estimator; never
// disable all feedback. Preserve media, clocks, codec settings and lease guards.
export function publisherRembSdp(sdp) {
  if (typeof sdp !== 'string' || sdp.length > 262144) throw new Error('AV_PUBLISHER_FEEDBACK_SDP_LIMIT')
  const sections = sdp.split(/(?=^m=)/m)
  const targets = sections.filter(section => /^m=video /.test(section) && /^a=sendonly\r?$/m.test(section))
  if (targets.length > 1) throw new Error('AV_PUBLISHER_FEEDBACK_AMBIGUOUS')
  return sections.map(section => {
    if (!targets.includes(section)) return section
    if (!/^a=rtcp-fb:(?:\d+|\*) goog-remb\r?$/m.test(section) ||
      !/^a=extmap:\d+(?:\/\w+)? http:\/\/www\.webrtc\.org\/experiments\/rtp-hdrext\/abs-send-time\r?$/m.test(section))
      throw new Error('AV_PUBLISHER_REMB_UNSUPPORTED')
    return section
      .replace(/^a=rtcp-fb:(?:\d+|\*) transport-cc\r?(?:\n|$)/gm, '')
      .replace(/^a=extmap:\d+(?:\/\w+)? http:\/\/www\.ietf\.org\/id\/draft-holmer-rmcat-transport-wide-cc-extensions-01\r?(?:\n|$)/gm, '')
  }).join('')
}

export function installPublisherRembExperiment(rewrite) {
  if (window.__publisherRembExperiment) throw new Error('AV_PUBLISHER_FEEDBACK_ALREADY_INSTALLED')
  const prototype = window.RTCPeerConnection.prototype
  const originals = {}, wrappers = {}, counts = { offers: 0, answers: 0, modified: 0 }
  let closed = false
  for (const method of ['createOffer', 'createAnswer']) {
    originals[method] = prototype[method]
    wrappers[method] = async function (...args) {
      const description = await originals[method].apply(this, args)
      if (closed) return description
      counts[method === 'createOffer' ? 'offers' : 'answers']++
      const sdp = rewrite(description.sdp)
      if (sdp === description.sdp) return description
      counts.modified++
      return { type: description.type, sdp }
    }
    prototype[method] = wrappers[method]
  }
  window.__publisherRembExperiment = {
    snapshot: () => ({ ...counts, closed }),
    close() {
      if (closed) return
      closed = true
      for (const method of Object.keys(originals))
        if (prototype[method] === wrappers[method]) prototype[method] = originals[method]
    },
  }
}
