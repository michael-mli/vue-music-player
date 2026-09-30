import axios from 'axios'
import config from '@/config'
import { useAuthStore } from '@/stores/auth'
import { clearPartyDevice, getPartyDevice, type PartyDeviceGrant } from './partyDevice'

export interface PartyMember {
  id: string
  displayName: string
  role: 'host' | 'cohost' | 'member'
  admission: 'pending' | 'admitted' | 'rejected' | 'removed'
}

export interface PartySnapshot {
  room: {
    id: string
    name: string
    approvalRequired: boolean
    locked: boolean
    revision: number
    expiresAt: string
  }
  self: PartyMember
  clock: { clockId: string; serverNowMs: number }
  readiness?: PartyReadiness
  members?: PartyMember[]
  excludedMembers?: (PartyMember & { blocked: boolean })[]
  queue?: PartyQueueEntry[]
  invitationCode?: string | null
  deviceScope?: 'display' | 'controller'
  deviceId?: string
}

export interface PartyReadiness {
  state: 'idle' | 'awaiting-singer' | 'ready'
  clockId: string
  generation: number
  performanceId: string | null
  entryId: string | null
  songId: number | null
  title: string | null
  singerMemberId: string | null
  singerName: string | null
}

export interface PartyTurnCommand {
  commandId: string
  clockId: string
  baseRevision: number
  performanceId: string
  generation: number
}

export interface PartyQueueEntry {
  id: string
  songId: number
  title: string
  requesterMemberId: string
  requesterName: string
  singerMemberId: string
  singerName: string
  state: 'queued' | 'held'
  priorityRequested: boolean
  priorityApproved: boolean
  singerAccepted: boolean
}

export interface PartyRoomSummary {
  id: string
  name: string
  displayName: string
  admission: 'pending' | 'admitted'
}

export interface PartySocketTicket {
  ticket: string
  expiresAt: string
}

export interface PartyPairing {
  code: string
  scope: 'display' | 'controller'
  expiresAt: string
}

export interface PartyDeviceSummary {
  id: string
  scope: 'display' | 'controller'
  createdAt: string
  expiresAt: string
}

async function call<T>(method: 'get' | 'post', path: string, body?: Record<string, unknown>, retryOnNetworkError = false, bearerOnly = false): Promise<T> {
  const auth = useAuthStore()
  const roomId = path.match(/^\/rooms\/([^/]+)/)?.[1]
  const paired = !bearerOnly && roomId ? getPartyDevice(decodeURIComponent(roomId)) : null
  if (!paired) {
    await auth.ensureIdentity()
    if (!auth.token) throw new Error('Guest identity is unavailable. Please try again.')
  }
  for (let attempt = 0; attempt < (retryOnNetworkError ? 2 : 1); attempt++) {
    try {
      const response = await axios.request<{ success: boolean; data: T }>({
        method,
        url: `${config.apiBaseUrl}/ktv${path}`,
        data: body,
        headers: { Authorization: paired ? `KtvDevice ${paired.credential}` : `Bearer ${auth.token}` },
        timeout: 10000,
      })
      return response.data.data
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (!error.response && retryOnNetworkError && attempt === 0) continue
        if (paired && error.response?.data?.code === 'DEVICE_REVOKED') clearPartyDevice(paired.roomId)
        const message = error.response?.data?.message
        if (typeof message === 'string') throw new Error(message)
      }
      throw error
    }
  }
  throw new Error('Room request failed')
}

export const partyApi = {
  list: () => call<PartyRoomSummary[]>('get', '/rooms'),
  get: (id: string) => call<PartySnapshot>('get', `/rooms/${encodeURIComponent(id)}`),
  socketTicket: (id: string) => call<PartySocketTicket>('post', `/rooms/${encodeURIComponent(id)}/socket-ticket`, {}),
  create: (name: string, displayName: string, approvalRequired: boolean) =>
    call<PartySnapshot>('post', '/rooms', { name, displayName, approvalRequired }),
  join: (code: string, displayName: string) =>
    call<PartySnapshot>('post', '/join', { code, displayName }),
  approve: (roomId: string, memberId: string, commandId: string) =>
    call<PartySnapshot>('post', `/rooms/${encodeURIComponent(roomId)}/members/${encodeURIComponent(memberId)}/approve`, { commandId }, true),
  remove: (roomId: string, memberId: string, commandId: string) =>
    call<PartySnapshot>('post', `/rooms/${encodeURIComponent(roomId)}/members/${encodeURIComponent(memberId)}/remove`, { commandId }, true),
  reject: (roomId: string, memberId: string, commandId: string) =>
    call<PartySnapshot>('post', `/rooms/${encodeURIComponent(roomId)}/members/${encodeURIComponent(memberId)}/reject`, { commandId }, true),
  block: (roomId: string, memberId: string, commandId: string) =>
    call<PartySnapshot>('post', `/rooms/${encodeURIComponent(roomId)}/members/${encodeURIComponent(memberId)}/block`, { commandId }, true),
  unblock: (roomId: string, memberId: string, commandId: string) =>
    call<PartySnapshot>('post', `/rooms/${encodeURIComponent(roomId)}/members/${encodeURIComponent(memberId)}/unblock`, { commandId }, true),
  role: (roomId: string, memberId: string, role: 'cohost' | 'member', commandId: string) =>
    call<PartySnapshot>('post', `/rooms/${encodeURIComponent(roomId)}/members/${encodeURIComponent(memberId)}/role`, { role, commandId }, true),
  transferHost: (roomId: string, memberId: string, commandId: string) =>
    call<PartySnapshot>('post', `/rooms/${encodeURIComponent(roomId)}/members/${encodeURIComponent(memberId)}/transfer-host`, { commandId }, true),
  rotate: (roomId: string) =>
    call<PartySnapshot>('post', `/rooms/${encodeURIComponent(roomId)}/invitations/rotate`),
  settings: (roomId: string, changes: { locked?: boolean; approvalRequired?: boolean }) =>
    call<PartySnapshot>('post', `/rooms/${encodeURIComponent(roomId)}/settings`, changes),
  close: (roomId: string) =>
    call<{ id: string; status: 'closed' }>('post', `/rooms/${encodeURIComponent(roomId)}/close`),
  requestSong: (roomId: string, songId: number, title: string, requestNext: boolean, commandId: string, singerMemberId: string) =>
    call<PartySnapshot>('post', `/rooms/${encodeURIComponent(roomId)}/queue`, { songId, title, requestNext, commandId, singerMemberId }, true),
  cancelSong: (roomId: string, entryId: string, commandId: string) =>
    call<PartySnapshot>('post', `/rooms/${encodeURIComponent(roomId)}/queue/${encodeURIComponent(entryId)}/cancel`, { commandId }, true),
  approveNext: (roomId: string, entryId: string, commandId: string) =>
    call<PartySnapshot>('post', `/rooms/${encodeURIComponent(roomId)}/queue/${encodeURIComponent(entryId)}/approve-next`, { commandId }, true),
  acceptSong: (roomId: string, entryId: string, commandId: string) =>
    call<PartySnapshot>('post', `/rooms/${encodeURIComponent(roomId)}/queue/${encodeURIComponent(entryId)}/accept`, { commandId }, true),
  declineSong: (roomId: string, entryId: string, commandId: string) =>
    call<PartySnapshot>('post', `/rooms/${encodeURIComponent(roomId)}/queue/${encodeURIComponent(entryId)}/decline`, { commandId }, true),
  offerSinger: (roomId: string, entryId: string, commandId: string, clockId: string, baseRevision: number) =>
    call<PartySnapshot>('post', `/rooms/${encodeURIComponent(roomId)}/readiness/offer`, { entryId, commandId, clockId, baseRevision }, true),
  respondReady: (roomId: string, command: PartyTurnCommand, ready: boolean) =>
    call<PartySnapshot>('post', `/rooms/${encodeURIComponent(roomId)}/readiness/respond`, { ...command, ready }, true),
  cancelReadiness: (roomId: string, command: PartyTurnCommand) =>
    call<PartySnapshot>('post', `/rooms/${encodeURIComponent(roomId)}/readiness/cancel`, { ...command }, true),
  createPairing: (roomId: string, scope: 'display' | 'controller') =>
    call<PartyPairing>('post', `/rooms/${encodeURIComponent(roomId)}/pairings`, { scope }, false, true),
  devices: (roomId: string) =>
    call<PartyDeviceSummary[]>('get', `/rooms/${encodeURIComponent(roomId)}/devices`, undefined, false, true),
  revokeDevice: (roomId: string, deviceId: string) =>
    call<{ id: string; deviceId: string; status: 'revoked' }>('post',
      `/rooms/${encodeURIComponent(roomId)}/devices/${encodeURIComponent(deviceId)}/revoke`, {}, false, true),
  async redeemPairing(code: string): Promise<PartyDeviceGrant> {
    try {
      const response = await axios.post<{ success: boolean; data: PartyDeviceGrant }>(
        `${config.apiBaseUrl}/ktv/pairings/redeem`, { code }, { timeout: 10000 })
      return response.data.data
    } catch (error) {
      if (axios.isAxiosError(error) && typeof error.response?.data?.message === 'string') {
        throw new Error(error.response.data.message)
      }
      throw error
    }
  },
}
