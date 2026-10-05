// Injected into owned fixture pages only. Never return SDP, keys, candidates,
// URLs or arbitrary RTC report properties.
export async function collectAvMediaStats() {
  if (window.__peers.length > 16) throw new Error('AV_STATS_PEER_LIMIT')
  const fields = ['timestamp', 'ssrc', 'kind', 'packetsSent', 'bytesSent', 'packetsReceived',
    'bytesReceived', 'packetsLost', 'jitter', 'roundTripTime', 'fractionLost',
    'frames', 'width', 'height', 'framesEncoded', 'framesSent', 'framesPerSecond', 'totalEncodeTime', 'totalPacketSendDelay',
    'targetBitrate', 'qualityLimitationReason', 'frameWidth', 'frameHeight',
    'jitterBufferDelay', 'jitterBufferTargetDelay', 'jitterBufferMinimumDelay',
    'jitterBufferEmittedCount', 'estimatedPlayoutTimestamp', 'totalSamplesReceived',
    'concealedSamples', 'insertedSamplesForDeceleration', 'removedSamplesForAcceleration',
    'framesDecoded', 'framesDropped', 'framesReceived', 'freezeCount', 'totalFreezesDuration',
    'totalProcessingDelay', 'totalDecodeTime', 'nackCount', 'pliCount', 'firCount',
    'retransmittedPacketsSent', 'retransmittedBytesSent', 'retransmittedPacketsReceived',
    'framesAssembledFromMultiplePackets', 'totalAssemblyTime',
    'keyFramesEncoded', 'keyFramesDecoded', 'hugeFramesSent',
    'fecPacketsReceived', 'fecPacketsDiscarded', 'fecBytesReceived']
  const reports = await Promise.all(window.__peers.map(async (peer, index) => {
    const report = await peer.getStats(), rows = [...report.values()]
    const media = rows.filter(item => ['inbound-rtp', 'outbound-rtp', 'remote-inbound-rtp'].includes(item.type) ||
      item.type === 'media-source' && item.kind === 'video')
      .map(item => {
        const result = { peer: index, type: item.type }
        for (const field of fields) {
          const value = item[field]
          if (typeof value === 'number' && Number.isFinite(value) ||
            field === 'kind' && ['audio', 'video'].includes(value) ||
            field === 'qualityLimitationReason' && ['none', 'cpu', 'bandwidth', 'other'].includes(value)) result[field] = value
        }
        const codec = report.get(item.codecId)
        if (codec) result.codec = Object.fromEntries(['mimeType', 'clockRate', 'channels']
          .filter(field => typeof codec[field] === 'number' && Number.isFinite(codec[field]) ||
            field === 'mimeType' && /^(audio|video)\/[a-zA-Z0-9-]+$/.test(codec[field] || ''))
          .map(field => [field, codec[field]]))
        if (item.qualityLimitationDurations) result.qualityLimitationDurations = Object.fromEntries(
          ['none', 'cpu', 'bandwidth', 'other'].filter(key => Number.isFinite(item.qualityLimitationDurations[key]))
            .map(key => [key, item.qualityLimitationDurations[key]]))
        return result
      })
    const transports = rows.filter(item => item.type === 'transport').flatMap(item => {
      const selected = report.get(item.selectedCandidatePairId)
      if (selected?.type !== 'candidate-pair') return []
      return [{ peer: index, type: 'selected-transport', ...Object.fromEntries([
        'timestamp', 'currentRoundTripTime', 'availableOutgoingBitrate', 'availableIncomingBitrate',
      ].filter(key => Number.isFinite(selected[key])).map(key => [key, selected[key]])) }]
    })
    return [...media, ...transports]
  }))
  const senderParameters = window.__peers.flatMap((peer, index) => peer.getSenders().filter(sender => ['audio','video'].includes(sender.track?.kind))
    .map(sender => {
      const parameters = sender.getParameters(), result = { peer: index, kind: sender.track.kind }
      if (['', 'motion', 'detail', 'text', 'speech', 'music'].includes(sender.track.contentHint)) result.contentHint = sender.track.contentHint
      if (['balanced', 'maintain-resolution', 'maintain-framerate'].includes(parameters.degradationPreference)) result.degradationPreference = parameters.degradationPreference
      result.encodings = (parameters.encodings || []).map(encoding => Object.fromEntries([
        'active', 'maxBitrate', 'maxFramerate', 'scaleResolutionDownBy', 'scalabilityMode',
        'priority', 'networkPriority', 'bitratePriority',
      ].filter(key => typeof encoding[key] === 'number' && Number.isFinite(encoding[key]) ||
        key === 'active' && typeof encoding[key] === 'boolean' ||
        key === 'scalabilityMode' && /^L[1-3]T[1-3](h|_KEY|_KEY_SHIFT)?$/.test(encoding[key] || '') ||
        ['priority','networkPriority'].includes(key) && ['very-low','low','medium','high'].includes(encoding[key]))
        .map(key => [key, encoding[key]])))
      return result
    }))
  if (senderParameters.length > 32 || senderParameters.some(item => item.encodings.length > 3)) throw new Error('AV_STATS_SENDER_LIMIT')
  return { time: performance.timeOrigin + performance.now(), reports: reports.flat(), senderParameters,
    ...(window.__encodedTimingProbe?.referenceStates?{videoReferenceEnvelopes:window.__encodedTimingProbe.referenceStates.map(row=>({...row}))}:{}),
    ...(window.__controlledReceiver ? { controlledReceiver: window.__controlledReceiver.snapshot() } : {}),
    ...(window.__videoFloorExperiment ? { videoFloor: window.__videoFloorExperiment.snapshot() } : {}),
    ...(window.__sourceMarkerProbe ? { sourceMarkerProbe: window.__sourceMarkerProbe.snapshot() } : {}),
    ...(window.__nativeReceiverMarkerProbe ? { nativeReceiverMarkerProbe: window.__nativeReceiverMarkerProbe.snapshot() } : {}),
    ...(window.__senderTemporalExperiment ? { sourceTemporal: window.__senderTemporalExperiment.snapshot() } : {}),
    receiverTargets: window.__peers.flatMap((peer, index) => peer.getReceivers().map(receiver => ({
      peer: index, kind: receiver.track?.kind,
      targetSupported: 'jitterBufferTarget' in receiver,
      targetMs: Number.isFinite(receiver.jitterBufferTarget) ? receiver.jitterBufferTarget : null,
    }))) }
}
