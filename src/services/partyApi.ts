import axios from 'axios'
import config from '@/config'
import { useAuthStore } from '@/stores/auth'
import { clearPartyDevice, getPartyDevice, type PartyDeviceGrant } from './partyDevice'
import { runPartyMutation } from './partyCommandJournal'

export class PartyApiError extends Error {
  constructor(message: string, public code?: string, public status?: number) { super(message); this.name = 'PartyApiError' }
}

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
    stageInviteVisible?: boolean
    revision: number
    expiresAt: string
    performanceMode?: 'local' | 'online' | 'hybrid'
    mediaConfigured?: boolean
  }
  self: PartyMember
  limits?: { members: number; queue: number; singerRequests: number }
  clock: { clockId: string; serverNowMs: number }
  readiness?: PartyReadiness
  playback?: PartyPlayback
  presence?: { sequence: number; devices: PartyLiveDevice[]; host: { memberId: string | null; connected: boolean;
    controlAvailable: boolean; graceDeadlineMs: number | null; transferCandidateId: string | null; graceMs: number } }
  members?: PartyMember[]
  excludedMembers?: (PartyMember & { blocked: boolean })[]
  queue?: PartyQueueEntry[]
  invitationCode?: string | null
  stageInvitationCode?: string | null
  deviceScope?: 'display' | 'controller'
  deviceId?: string
}

export interface PartyLiveDevice {
  id: string
  memberId: string
  scope?: 'display' | 'controller'
  label: string
  purpose: 'viewer' | 'stage' | 'guide'
  audioEnabled: boolean
  clockHealthy: boolean
  ready: boolean
  readyGeneration: number | null
  connected: boolean
}

export interface PartyMediaGrant {
  identity: string
  scope: 'audience' | 'publisher'
  room: string
  token: string
  serverUrl: string
  expiresAt: string
  permit?: { clockId: string; performanceId: string; generation: number; expiresServerMs: number }
}

export interface PartyAudioAsset {
  url: string
  bytes: number
  sha256: string
  durationMs: number
  sampleRate: number
  channels: number
  alignmentOffsetMs: number
}

export interface PartyAssets {
  songId: number
  version: string
  durationMs: number
  instrumental: PartyAudioAsset
  original: PartyAudioAsset | null
  lyrics: { mode: 'synced' | 'plain' | 'missing'; text: string | null; sha256: string | null }
  alignmentVerified: boolean
  durationDifferenceMs: number | null
}

export interface PartyLease {
  id: string
  deviceId: string
  clockId: string
  performanceId: string
  generation: number
  sequence: number
  expiresServerMs: number
  safeAfterServerMs: number
  nextGeneration?: number
  effectiveServerMs?: number
}

export interface PartySegment {
  state: 'idle' | 'preparing' | 'scheduled' | 'playing' | 'paused' | 'recovering'
  generation: number
  positionMs: number
  anchorServerMs: number
}

export interface PartyPlayback extends PartySegment {
  clockId: string
  entryId: string | null
  performanceId: string | null
  durationMs: number
  pendingTransition: (PartySegment & { effectiveServerMs: number }) | null
  assets: PartyAssets | null
  stageDeviceId: string | null
  stageMemberId: string | null
  lease: PartyLease | null
  restartSafeAfterMs: number
  lyricOffsetMs: number
  prepareDeadlineMs: number | null
  guideRequired: boolean
  guideDeviceId: string | null
  guidePrepared: boolean
  recoveryReason: string | null
  title?: string | null
  singerMemberId?: string | null
  singerName?: string | null
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
  advancePending: boolean
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
  hostOrder?: number | null
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
        if (typeof message === 'string') throw new PartyApiError(message, error.response?.data?.code, error.response?.status)
      }
      throw error
    }
  }
  throw new Error('Room request failed')
}

async function mutation<T>(path: string, body: Record<string, unknown>, bearerOnly = false): Promise<T> {
  const roomId = path.match(/^\/rooms\/([^/]+)/)?.[1]
  const paired = !bearerOnly && roomId ? getPartyDevice(decodeURIComponent(roomId)) : null
  const auth = useAuthStore()
  if (!paired) await auth.ensureIdentity()
  const principal = paired ? `member:${paired.memberId}` : `user:${auth.user?.id}`
  return runPartyMutation(principal, path, body, command => call<T>('post', path, command, true, bearerOnly))
}

export const partyApi = {
  mediaStatus: (roomId: string) => call<{ available: boolean; mode: 'local' | 'online' | 'hybrid'; serverUrl: string }>('get', `/rooms/${encodeURIComponent(roomId)}/media/status`),
  mediaMode: (roomId: string, mode: 'local' | 'online' | 'hybrid', baseRevision: number) =>
    mutation<PartySnapshot>(`/rooms/${encodeURIComponent(roomId)}/media/mode`, { mode, baseRevision }),
  mediaGrant: (roomId: string, deviceId: string, scope: 'audience' | 'publisher') =>
    mutation<PartyMediaGrant>(`/rooms/${encodeURIComponent(roomId)}/media-token`, { deviceId, scope }),
  mediaRenew: (roomId: string, identity: string, deviceId: string) =>
    call<PartyMediaGrant>('post', `/rooms/${encodeURIComponent(roomId)}/media/${encodeURIComponent(identity)}/renew`, { deviceId }),
  mediaReady: (roomId: string, identity: string, deviceId: string) =>
    call<{ ready: true }>('post', `/rooms/${encodeURIComponent(roomId)}/media/${encodeURIComponent(identity)}/ready`, { deviceId }),
  mediaRevoke: (roomId: string, identity: string) =>
    call<{ state: 'revoked' }>('post', `/rooms/${encodeURIComponent(roomId)}/media/${encodeURIComponent(identity)}/revoke`, {}),
  list: () => call<PartyRoomSummary[]>('get', '/rooms'),
  get: (id: string) => call<PartySnapshot>('get', `/rooms/${encodeURIComponent(id)}`),
  socketTicket: (id: string, deviceId?: string) => call<PartySocketTicket>('post', `/rooms/${encodeURIComponent(id)}/socket-ticket`, { deviceId }),
  create: (name: string, displayName: string, approvalRequired: boolean) =>
    mutation<PartySnapshot>('/rooms', { name, displayName, approvalRequired }, true),
  join: (code: string, displayName: string) =>
    mutation<PartySnapshot>('/join', { code: code.trim().toUpperCase(), displayName }, true),
  resolveInvitation: (code: string) =>
    call<{ membership: PartySnapshot | null }>('post', '/invitations/resolve', { code: code.trim().toUpperCase() }, false, true),
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
    mutation<PartySnapshot>(`/rooms/${encodeURIComponent(roomId)}/invitations/rotate`, {}),
  settings: (roomId: string, changes: { locked?: boolean; approvalRequired?: boolean; stageInviteVisible?: boolean; singerRequests?: number }) =>
    mutation<PartySnapshot>(`/rooms/${encodeURIComponent(roomId)}/settings`, changes),
  close: (roomId: string) =>
    mutation<{ id: string; status: 'closed' }>(`/rooms/${encodeURIComponent(roomId)}/close`, {}),
  requestSong: (roomId: string, songId: number, title: string, requestNext: boolean, commandId: string, singerMemberId: string) =>
    call<PartySnapshot>('post', `/rooms/${encodeURIComponent(roomId)}/queue`, { songId, title, requestNext, commandId, singerMemberId }, true),
  cancelSong: (roomId: string, entryId: string, commandId: string) =>
    call<PartySnapshot>('post', `/rooms/${encodeURIComponent(roomId)}/queue/${encodeURIComponent(entryId)}/cancel`, { commandId }, true),
  approveNext: (roomId: string, entryId: string, commandId: string) =>
    call<PartySnapshot>('post', `/rooms/${encodeURIComponent(roomId)}/queue/${encodeURIComponent(entryId)}/approve-next`, { commandId }, true),
  orderSong: (roomId: string, entryId: string, action: 'next' | 'fair', baseRevision: number) =>
    mutation<PartySnapshot>(`/rooms/${encodeURIComponent(roomId)}/queue/${encodeURIComponent(entryId)}/order`, { action, baseRevision }),
  reassignSong: (roomId: string, entryId: string, singerMemberId: string, baseRevision: number) =>
    mutation<PartySnapshot>(`/rooms/${encodeURIComponent(roomId)}/queue/${encodeURIComponent(entryId)}/reassign`, { singerMemberId, baseRevision }),
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
  preparePlayback: (roomId: string, command: PartyTurnCommand) =>
    call<PartySnapshot>('post', `/rooms/${encodeURIComponent(roomId)}/playback/prepare`, { ...command }, true),
  playbackCommand: (roomId: string, action: string, command: Record<string, unknown>) =>
    call<PartySnapshot>('post', `/rooms/${encodeURIComponent(roomId)}/playback/${action}`, command, true),
  createPairing: (roomId: string, scope: 'display' | 'controller') =>
    mutation<PartyPairing>(`/rooms/${encodeURIComponent(roomId)}/pairings`, { scope }, true),
  devices: (roomId: string) =>
    call<PartyDeviceSummary[]>('get', `/rooms/${encodeURIComponent(roomId)}/devices`, undefined, false, true),
  revokeDevice: (roomId: string, deviceId: string) =>
    mutation<{ id: string; deviceId: string; status: 'revoked' }>(
      `/rooms/${encodeURIComponent(roomId)}/devices/${encodeURIComponent(deviceId)}/revoke`, {}, true),
  async redeemPairing(code: string): Promise<PartyDeviceGrant> {
    return runPartyMutation('pairing-device', '/pairings/redeem', { code: code.trim().toUpperCase() }, async body => {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const response = await axios.post<{ success: boolean; data: PartyDeviceGrant }>(
            `${config.apiBaseUrl}/ktv/pairings/redeem`, body, { timeout: 10000 })
          return response.data.data
        } catch (error) {
          if (axios.isAxiosError(error) && !error.response && attempt === 0) continue
          if (axios.isAxiosError(error) && typeof error.response?.data?.message === 'string') {
            throw new PartyApiError(error.response.data.message, error.response.data.code, error.response.status)
          }
          throw error
        }
      }
      throw new Error('Device connection failed')
    })
  },
}
