export interface PartyDeviceGrant {
  roomId: string
  memberId: string
  deviceId: string
  scope: 'display' | 'controller'
  credential: string
  expiresAt: string
}

function key(roomId: string) { return `ktv-device:${roomId}` }

export function getPartyDevice(roomId: string): PartyDeviceGrant | null {
  try {
    const raw = sessionStorage.getItem(key(roomId))
    if (!raw) return null
    const grant = JSON.parse(raw) as PartyDeviceGrant
    if (grant.roomId !== roomId || !grant.credential || Date.parse(grant.expiresAt) <= Date.now()) {
      sessionStorage.removeItem(key(roomId))
      return null
    }
    return grant
  } catch { return null }
}

export function savePartyDevice(grant: PartyDeviceGrant) {
  sessionStorage.setItem(key(grant.roomId), JSON.stringify(grant))
}

export function clearPartyDevice(roomId: string) {
  sessionStorage.removeItem(key(roomId))
}
