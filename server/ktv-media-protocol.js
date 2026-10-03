// Version 2 includes source encoded-frame expiry, guarded received audio and
// backend reservation of every issued listener cutoff. Legacy versions remain
// valid for local room controls, but cannot receive streaming credentials.
export const PARTY_MEDIA_PROTOCOL_VERSION = 2
export const PARTY_LEGACY_MEDIA_PROTOCOL_VERSIONS = Object.freeze([0, 1])
