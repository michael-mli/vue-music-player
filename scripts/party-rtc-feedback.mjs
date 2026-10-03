// Passive owned-fixture negotiation evidence. Do not retain SDP, connection
// addresses, stream IDs, keys, credentials, payload IDs or track labels.
export function collectRtcFeedback() {
  if (window.__peers.length > 16) throw new Error('AV_FEEDBACK_PEER_LIMIT')
  return window.__peers.flatMap((peer, index) => ['local', 'remote'].flatMap(side => {
    const description = peer[side + 'Description']
    if (!description) return []
    const sdp = description.sdp || ''
    if (sdp.length > 262144) throw new Error('AV_FEEDBACK_SDP_LIMIT')
    const sections = sdp.split(/(?:^|\r?\n)m=/).filter(section => /^(audio|video) /.test(section))
    if (sections.length > 16) throw new Error('AV_FEEDBACK_SECTION_LIMIT')
    return sections.map(section => ({ peer: index, side,
      type: ['offer', 'answer', 'pranswer', 'rollback'].includes(description.type) ? description.type : 'unknown',
      kind: section.startsWith('audio ') ? 'audio' : 'video',
      direction: /(?:^|\r?\n)a=(sendrecv|sendonly|recvonly|inactive)(?:\r?\n|$)/.exec(section)?.[1] || 'unspecified',
      transportCcFeedback: /(?:^|\r?\n)a=rtcp-fb:(?:\d+|\*) transport-cc(?:\r?\n|$)/.test(section),
      rembFeedback: /(?:^|\r?\n)a=rtcp-fb:(?:\d+|\*) goog-remb(?:\r?\n|$)/.test(section),
      transportCcExtension: /(?:^|\r?\n)a=extmap:\d+(?:\/\w+)? http:\/\/www\.ietf\.org\/id\/draft-holmer-rmcat-transport-wide-cc-extensions-01(?:\r?\n|$)/.test(section),
      absoluteCaptureTimeExtension: /(?:^|\r?\n)a=extmap:\d+(?:\/\w+)? http:\/\/www\.webrtc\.org\/experiments\/rtp-hdrext\/abs-capture-time(?:[ \t]|\r?\n|$)/.test(section),
      absoluteSendTimeExtension: /(?:^|\r?\n)a=extmap:\d+(?:\/\w+)? http:\/\/www\.webrtc\.org\/experiments\/rtp-hdrext\/abs-send-time(?:\r?\n|$)/.test(section),
    }))
  }))
}
