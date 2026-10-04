// Private Chromium comparison. This vendor codec parameter can affect call
// allocation, so actual negotiated parameters and measured cadence are required.
// Keep all media bytes, feedback, audio, RTP encoding caps and guards intact.
export function publisherVideoFloorSdp(sdp, floorKbps = 250) {
  if (typeof sdp !== 'string' || sdp.length > 262144 || floorKbps !== 250) throw new Error('VIDEO_FLOOR_INPUT')
  const sections = sdp.split(/(?=^m=)/m)
  if (sections.filter(section => /^m=/.test(section)).length > 16) throw new Error('VIDEO_FLOOR_BOUND')
  let found = false
  const rewritten = sections.map(section => {
    if (!/^m=video /.test(section)) return section
    const ids = [...section.matchAll(/^a=rtpmap:(\d+) VP9\/90000\r?$/gmi)].map(match => match[1])
    if (ids.length > 16 || new Set(ids).size !== ids.length || ids.some(id => Number(id) > 127)) throw new Error('VIDEO_FLOOR_CODEC')
    if (!ids.length) return section
    found = true
    const newline = section.includes('\r\n') ? '\r\n' : '\n'
    for (const id of ids) {
      const pattern = new RegExp('^a=fmtp:' + id + ' ([^\\r\\n]*)\\r?$', 'gm')
      const matches = [...section.matchAll(pattern)]
      if (matches.length > 1) throw new Error('VIDEO_FLOOR_CODEC')
      if (matches.length) {
        const params = matches[0][1].split(';').map(value => value.trim())
        const existing = params.filter(value => /^x-google-min-bitrate\s*=/i.test(value))
        if (existing.length > 1 || existing.length && existing[0] !== 'x-google-min-bitrate=250') throw new Error('VIDEO_FLOOR_CONFLICT')
        if (!existing.length) section = section.replace(pattern, (_, config) => `a=fmtp:${id} ${config};x-google-min-bitrate=250${newline === '\r\n' ? '\r' : ''}`)
      } else {
        if (!section.endsWith(newline)) throw new Error('VIDEO_FLOOR_INPUT')
        section += `a=fmtp:${id} x-google-min-bitrate=250${newline}`
      }
    }
    return section
  }).join('')
  if (!found) throw new Error('VIDEO_FLOOR_CODEC')
  return rewritten
}

export function installVideoFloorExperiment(rewrite) {
  if (window.__videoFloorExperiment) throw new Error('VIDEO_FLOOR_INSTALLED')
  const prototype = window.RTCPeerConnection.prototype, original = prototype.setRemoteDescription
  let closed = false, applied = 0, verified = 0, error = null
  const wrapper = async function (description) {
    const video = this.getSenders().filter(sender => sender.track?.kind === 'video' && sender.track.readyState === 'live')
    if (closed || description?.type !== 'answer' || !video.length) return original.call(this, description)
    if (error) throw new Error(error)
    try {
      if (video.length !== 1) throw new Error('VIDEO_FLOOR_SENDERS')
      const sdp = rewrite(description.sdp)
      applied++
      await original.call(this, { type: description.type, sdp })
      if (closed) return
      // Idempotent normalization proves the native description retained every
      // requested codec floor; no SDP is retained in fixture diagnostics.
      if (!this.remoteDescription?.sdp || rewrite(this.remoteDescription.sdp) !== this.remoteDescription.sdp)
        throw new Error('VIDEO_FLOOR_READBACK')
      verified++
    } catch (failure) {
      error = /^VIDEO_FLOOR_[A-Z_]+$/.test(failure.message) ? failure.message : 'VIDEO_FLOOR_NATIVE'
      throw new Error(error)
    }
  }
  prototype.setRemoteDescription = wrapper
  window.__videoFloorExperiment = {
    snapshot: () => ({ floorKbps: 250, applied, verified, closed, error }),
    close() { if (closed) return; closed = true; if (prototype.setRemoteDescription === wrapper) prototype.setRemoteDescription = original },
  }
}
