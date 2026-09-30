import axios from 'axios'
import config from '@/config'
import { useAuthStore } from '@/stores/auth'

export interface PartyMember {
  id: string
  displayName: string
  role: 'host' | 'member'
  admission: 'pending' | 'admitted'
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
  members?: PartyMember[]
  invitationCode?: string | null
}

export interface PartyRoomSummary {
  id: string
  name: string
  displayName: string
  admission: 'pending' | 'admitted'
}

async function call<T>(method: 'get' | 'post', path: string, body?: Record<string, unknown>): Promise<T> {
  const auth = useAuthStore()
  await auth.ensureIdentity()
  if (!auth.token) throw new Error('Guest identity is unavailable. Please try again.')
  try {
    const response = await axios.request<{ success: boolean; data: T }>({
      method,
      url: `${config.apiBaseUrl}/ktv${path}`,
      data: body,
      headers: { Authorization: `Bearer ${auth.token}` },
      timeout: 10000,
    })
    return response.data.data
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const message = error.response?.data?.message
      if (typeof message === 'string') throw new Error(message)
    }
    throw error
  }
}

export const partyApi = {
  list: () => call<PartyRoomSummary[]>('get', '/rooms'),
  get: (id: string) => call<PartySnapshot>('get', `/rooms/${encodeURIComponent(id)}`),
  create: (name: string, displayName: string, approvalRequired: boolean) =>
    call<PartySnapshot>('post', '/rooms', { name, displayName, approvalRequired }),
  join: (code: string, displayName: string) =>
    call<PartySnapshot>('post', '/join', { code, displayName }),
  approve: (roomId: string, memberId: string) =>
    call<PartySnapshot>('post', `/rooms/${encodeURIComponent(roomId)}/members/${encodeURIComponent(memberId)}/approve`),
  remove: (roomId: string, memberId: string) =>
    call<PartySnapshot>('post', `/rooms/${encodeURIComponent(roomId)}/members/${encodeURIComponent(memberId)}/remove`),
  rotate: (roomId: string) =>
    call<PartySnapshot>('post', `/rooms/${encodeURIComponent(roomId)}/invitations/rotate`),
  settings: (roomId: string, changes: { locked?: boolean; approvalRequired?: boolean }) =>
    call<PartySnapshot>('post', `/rooms/${encodeURIComponent(roomId)}/settings`, changes),
  close: (roomId: string) =>
    call<{ id: string; status: 'closed' }>('post', `/rooms/${encodeURIComponent(roomId)}/close`),
}
