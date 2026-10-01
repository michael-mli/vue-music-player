const groups: Record<string, string> = {
  errorConflict: 'COMMAND_CONFLICT REVISION_CONFLICT INVALID_REVISION STALE_GENERATION STALE_CLOCK',
  errorPermission: 'FORBIDDEN MEDIA_FORBIDDEN NOT_ADMITTED ROOM_BLOCKED INVALID_ROLE INVALID_SCOPE',
  errorInvitation: 'INVALID_INVITATION', errorPairing: 'INVALID_PAIRING DEVICE_REVOKED',
  errorRoomEnded: 'ROOM_CLOSED ROOM_NOT_FOUND', errorRoomLocked: 'ROOM_LOCKED', errorRoomFull: 'ROOM_FULL',
  errorQueueFull: 'QUEUE_FULL SINGER_QUEUE_FULL', errorDeviceLimit: 'DEVICE_LIMIT MEDIA_DEVICE_LIMIT DEVICE_IN_USE',
  errorSong: 'INVALID_SONG SONG_UNAVAILABLE ASSET_UNAVAILABLE ASSETS_UNCONFIGURED GUIDE_UNAVAILABLE',
  errorDeviceReady: 'DEVICE_NOT_READY GUIDE_NOT_READY MEDIA_NOT_READY',
  errorSingerReady: 'SINGER_NOT_ACCEPTED SINGER_NOT_READY INVALID_READINESS INVALID_SINGER',
  errorActiveSong: 'PERFORMANCE_ACTIVE PLAYBACK_ACTIVE TURN_SELECTED INVALID_PLAYBACK INVALID_QUEUE_STATE MEDIA_PAUSE_REQUIRED',
  errorWaitForStop: 'OUTPUT_STOPPING MEDIA_REVOCATION_PENDING', errorHost: 'HOST_UNAVAILABLE',
  errorUpdate: 'PROTOCOL_UNSUPPORTED MEDIA_CLIENT_UPDATE', errorRateLimit: 'TOO_MANY_ATTEMPTS TOO_MANY_REQUESTS',
  errorInput: 'INVALID_COMMAND INVALID_DEVICE INVALID_DEVICE_STATUS INVALID_INPUT INVALID_MEDIA_REQUEST INVALID_MEMBER_STATE INVALID_OFFSET INVALID_POSITION EARLY_COMPLETION MESSAGE_TOO_LARGE',
  errorMediaPermission: 'MEDIA_REVOKED MEDIA_LEASE_EXPIRED MEDIA_NOT_FOUND', errorMediaUnavailable: 'MEDIA_UNAVAILABLE',
  errorIdentity: 'IDENTITY_UNAVAILABLE', errorOrigin: 'ORIGIN_DENIED', errorPendingRequests: 'COMMAND_JOURNAL_FULL',
}
const keys = Object.fromEntries(Object.entries(groups).flatMap(([key, codes]) => codes.split(' ').map(code => [code, `party.${key}`])))

export function partyErrorMessage(reason: unknown, translate: (key: string) => string) {
  if (reason && typeof reason === 'object') {
    const error = reason as { code?: unknown; status?: unknown; response?: { status?: unknown } }
    if (typeof error.code === 'string' && typeof keys[error.code] === 'string') return translate(keys[error.code])
    const status = error.status ?? error.response?.status
    if (status === 401) return translate('party.errorIdentity')
    if (status === 403) return translate('party.errorPermission')
    if (status === 429) return translate('party.errorRateLimit')
  }
  // Unknown provider messages can contain URLs or credentials. Show a stable
  // translated recovery message instead of rendering arbitrary error text.
  return translate('party.errorRequestFailed')
}
