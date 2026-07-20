// Admin API calls (auth token is attached by the api.ts interceptor).
import api from '@/services/api'
import type { AuthUser } from '@/types'

interface IngestStart { jobId: string; ids: number[] }
interface IngestStatus { running: boolean; exitCode: number | null; ids: number[]; log: string[] }

export interface GpuStatus {
  available: boolean
  status: number | null
  message: string
  checkedAt: string
}

interface PurgeResult {
  ids: number[]
  count: number
  protectedUserId: number
}

export interface AdminUser extends AuthUser {
  created_at: string
  last_login: string | null
  last_seen: string | null
  last_ip: string | null
  last_user_agent: string | null
  session_count: number
}

export const adminService = {
  listUsers(): Promise<{ success: boolean; data: AdminUser[] }> {
    return api.get('/admin/users')
  },
  setRole(id: number, role: 'admin' | 'user'): Promise<{ success: boolean; data: AuthUser }> {
    return api.patch(`/admin/users/${id}`, { role })
  },
  deleteUser(id: number): Promise<{ success: boolean; data: { id: number } }> {
    return api.delete(`/admin/users/${id}`)
  },
  purgeUsers(payload: { ids: number[] } | { all: true }): Promise<{ success: boolean; data: PurgeResult }> {
    return api.post('/admin/users/purge', payload)
  },
  gpuStatus(): Promise<{ success: boolean; data: GpuStatus }> {
    return api.get('/admin/gpu-status')
  },
  startIngest(ids: number[]): Promise<{ success: boolean; data: IngestStart; message?: string }> {
    return api.post('/admin/ingest', { ids })
  },
  ingestStatus(jobId: string): Promise<{ success: boolean; data: IngestStatus }> {
    return api.get(`/admin/ingest/${jobId}`)
  },
  // Empty ids = build metadata for every song still missing it
  startMetadata(ids: number[]): Promise<{ success: boolean; data: IngestStart; message?: string }> {
    return api.post('/admin/metadata', { ids })
  },
  jobStatus(jobId: string): Promise<{ success: boolean; data: IngestStatus }> {
    return api.get(`/admin/jobs/${jobId}`)
  },
}
