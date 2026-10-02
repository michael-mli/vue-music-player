// Private native experiment: request keyframes without changing encoder settings,
// replacing tracks or granting publication. The normal encoded lease still gates
// every frame. Actual keyFramesEncoded counters must prove the API has an effect.
export function installSenderKeyframeExperiment(periodMs) {
  if (!Number.isInteger(periodMs) || periodMs < 250 || periodMs > 5000) throw new Error('AV_KEYFRAME_INTERVAL')
  if (window.__avSenderKeyframes) throw new Error('AV_KEYFRAME_ALREADY_INSTALLED')
  const senders = window.__peers.flatMap(peer => peer.getSenders())
    .filter(sender => sender.track?.kind === 'video' && sender.track.readyState === 'live')
  if (senders.length !== 1) throw new Error('AV_KEYFRAME_AMBIGUOUS_SENDER')
  const sender = senders[0], track = sender.track
  let pending = false, closed = false, requests = 0, fulfilled = 0, failure = null
  const close = () => { closed = true; clearInterval(timer) }
  const timer = setInterval(() => {
    if (closed || pending) return
    if (sender.track !== track || track.readyState !== 'live') { failure = 'sender-ended'; close(); return }
    const parameters = sender.getParameters()
    if (parameters.encodings?.length !== 1 || parameters.encodings[0].maxBitrate !== 350000 ||
      parameters.encodings[0].maxFramerate !== 25 || parameters.degradationPreference !== 'maintain-resolution') {
      failure = 'encoder-policy-changed'; close(); return
    }
    pending = true; requests++
    // Read fresh native parameters each time to preserve its transaction ID.
    // Browsers may ignore unsupported dictionary fields; counters expose that.
    try {
      Promise.resolve(sender.setParameters(parameters, { encodingOptions: [{ keyFrame: true }] }))
        .then(() => { fulfilled++ })
        .catch(error => {
          failure = ['InvalidModificationError', 'InvalidStateError', 'OperationError', 'NotSupportedError']
            .includes(error?.name) ? error.name : 'request-rejected'
          close()
        }).finally(() => { pending = false })
    } catch { failure = 'request-threw'; pending = false; close() }
  }, periodMs)
  window.__avSenderKeyframes = { close,
    snapshot: () => ({ periodMs, requests, fulfilled, pending, closed, failure }) }
}
