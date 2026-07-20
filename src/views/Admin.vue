<template>
  <div class="admin-view h-full overflow-y-auto spotify-scrollbar">
    <div class="p-4 sm:p-6 max-w-4xl">
      <div class="flex items-center gap-3 mb-6">
        <Cog6ToothIcon class="w-8 h-8 text-spotify-green" />
        <h1 class="text-3xl font-bold text-light-text-primary dark:text-white">{{ $t('admin.title') }}</h1>
      </div>

      <!-- Access control -->
      <div v-if="!auth.ready" class="text-light-text-secondary dark:text-gray-400">{{ $t('admin.checking') }}</div>
      <div v-else-if="!auth.isAdmin" class="text-red-400">{{ $t('admin.denied') }}</div>

      <template v-else>
        <!-- Ingest -->
        <section class="mb-10 p-4 rounded-lg bg-light-card dark:bg-spotify-dark border border-light-border dark:border-spotify-light">
          <h2 class="text-lg font-bold text-light-text-primary dark:text-white mb-1">{{ $t('admin.ingestTitle') }}</h2>
          <p class="text-sm text-light-text-secondary dark:text-gray-400 mb-3">{{ $t('admin.ingestHint') }}</p>
          <div
            class="flex flex-wrap items-center gap-x-2 gap-y-1 mb-3 text-xs"
            role="status"
            aria-live="polite"
            data-testid="gpu-status"
          >
            <span
              class="w-2 h-2 rounded-full flex-shrink-0"
              :class="gpuChecking ? 'bg-amber-400 animate-pulse' : gpuState === 'ready' ? 'bg-spotify-green' : gpuState === 'unavailable' ? 'bg-red-400' : 'bg-gray-400'"
              aria-hidden="true"
            />
            <span
              :class="gpuState === 'unavailable' && !gpuChecking ? 'text-red-400' : 'text-light-text-secondary dark:text-gray-300'"
            >{{ gpuStatusText }}</span>
            <button
              type="button"
              class="underline underline-offset-2 text-light-text-secondary dark:text-gray-300 hover:text-spotify-green disabled:opacity-40"
              :disabled="gpuChecking || ingestRunning"
              data-testid="check-gpu"
              @click="checkGpuStatus"
            >{{ $t('admin.checkGpu') }}</button>
          </div>
          <div class="flex flex-col sm:flex-row sm:items-center gap-2 mb-3">
            <input
              v-model="idsInput"
              type="text"
              :placeholder="$t('admin.ingestPlaceholder')"
              class="w-full sm:flex-1 min-w-0 px-3 py-2 rounded bg-white/10 border border-white/20 focus:border-spotify-green text-light-text-primary dark:text-white text-sm"
              @keyup.enter="runIngest"
            />
            <button
              @click="runIngest"
              :disabled="ingestRunning || gpuChecking || !parsedIds.length"
              class="w-full sm:w-auto flex-shrink-0 px-4 py-2 rounded-full bg-spotify-green text-black text-sm font-medium hover:bg-spotify-green/80 disabled:opacity-40"
              data-testid="run-ingest"
            >{{ gpuChecking ? $t('admin.gpuChecking') : ingestRunning ? $t('admin.running') : $t('admin.runIngest') }}</button>
          </div>
          <p v-if="ingestError" class="text-xs text-red-400 mb-2">{{ ingestError }}</p>
          <pre
            v-if="ingestLog.length"
            ref="logBox"
            class="text-xs bg-black/40 text-gray-200 rounded p-3 max-h-72 overflow-y-auto whitespace-pre-wrap"
          >{{ ingestLog.join('\n') }}</pre>
        </section>

        <!-- Metadata -->
        <section class="mb-10 p-4 rounded-lg bg-light-card dark:bg-spotify-dark border border-light-border dark:border-spotify-light">
          <h2 class="text-lg font-bold text-light-text-primary dark:text-white mb-1">{{ $t('admin.metadataTitle') }}</h2>
          <p class="text-sm text-light-text-secondary dark:text-gray-400 mb-3">{{ $t('admin.metadataHint') }}</p>
          <div class="flex flex-col sm:flex-row sm:items-center gap-2 mb-3">
            <input
              v-model="metaIdsInput"
              type="text"
              :placeholder="$t('admin.metadataPlaceholder')"
              class="w-full sm:flex-1 min-w-0 px-3 py-2 rounded bg-white/10 border border-white/20 focus:border-spotify-green text-light-text-primary dark:text-white text-sm"
              @keyup.enter="runMetadata"
            />
            <button
              @click="runMetadata"
              :disabled="metaRunning"
              class="w-full sm:w-auto flex-shrink-0 px-4 py-2 rounded-full bg-spotify-green text-black text-sm font-medium hover:bg-spotify-green/80 disabled:opacity-40"
            >{{ metaRunning ? $t('admin.running') : $t('admin.runMetadata') }}</button>
          </div>
          <p v-if="metaError" class="text-xs text-red-400 mb-2">{{ metaError }}</p>
          <pre
            v-if="metaLog.length"
            ref="metaLogBox"
            class="text-xs bg-black/40 text-gray-200 rounded p-3 max-h-72 overflow-y-auto whitespace-pre-wrap"
          >{{ metaLog.join('\n') }}</pre>
        </section>

        <!-- Users -->
        <section class="p-4 rounded-lg bg-light-card dark:bg-spotify-dark border border-light-border dark:border-spotify-light">
          <div class="flex flex-col gap-3 mb-3">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <h2 class="text-lg font-bold text-light-text-primary dark:text-white">{{ $t('admin.usersTitle') }} ({{ users.length }})</h2>
              <span v-if="purgeRunning" class="text-xs text-light-text-secondary dark:text-gray-400">{{ $t('admin.purging') }}</span>
            </div>
            <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 rounded-lg border border-light-border dark:border-white/10 p-2">
              <label class="inline-flex items-center gap-2 text-xs text-light-text-primary dark:text-gray-200 cursor-pointer">
                <input
                  type="checkbox"
                  class="accent-red-500"
                  :checked="allUsersSelected"
                  :disabled="!selectableUsers.length || purgeRunning"
                  data-testid="select-all-users"
                  @change="toggleSelectAll(($event.target as HTMLInputElement).checked)"
                />
                <span>{{ $t('admin.selectAll') }}</span>
                <span class="text-light-text-secondary dark:text-gray-400">({{ $t('admin.selectedCount', { count: selectedCount }) }})</span>
              </label>
              <div class="flex flex-wrap gap-2">
                <button
                  type="button"
                  class="px-3 py-1.5 rounded-full border border-red-400 text-red-500 dark:text-red-300 text-xs font-medium hover:bg-red-500/10 disabled:opacity-40"
                  :disabled="!selectedCount || purgeRunning"
                  data-testid="purge-selected"
                  @click="purgeSelectedUsers"
                >{{ $t('admin.purgeSelected') }}</button>
                <button
                  type="button"
                  class="px-3 py-1.5 rounded-full bg-red-600 text-white text-xs font-medium hover:bg-red-500 disabled:opacity-40"
                  :disabled="!selectableUsers.length || purgeRunning"
                  data-testid="purge-all"
                  @click="purgeAllUsers"
                >{{ $t('admin.purgeAll') }}</button>
              </div>
            </div>
          </div>
          <div class="space-y-2">
            <div
              v-for="u in users"
              :key="u.id"
              class="rounded hover:bg-light-border dark:hover:bg-spotify-light"
              :class="selectedUserIds.has(u.id) ? 'ring-1 ring-red-400/60 bg-red-500/5' : ''"
            >
              <div class="flex flex-wrap items-center gap-x-3 gap-y-2 p-2">
                <label
                  class="inline-flex items-center"
                  :class="u.id === auth.user?.id ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'"
                  :title="u.id === auth.user?.id ? $t('admin.currentAdminProtected') : $t('admin.selectUser', { user: displayNameFor(u) })"
                >
                  <span class="sr-only">{{ $t('admin.selectUser', { user: displayNameFor(u) }) }}</span>
                  <input
                    type="checkbox"
                    class="accent-red-500"
                    :checked="selectedUserIds.has(u.id)"
                    :disabled="u.id === auth.user?.id || purgeRunning"
                    :data-user-id="u.id"
                    @change="toggleUserSelection(u.id, ($event.target as HTMLInputElement).checked)"
                  />
                </label>
                <UserAvatar :user="u" :size="32" />
                <div class="flex-1 min-w-0">
                  <p class="text-sm text-light-text-primary dark:text-white truncate">
                    {{ displayNameFor(u) }}
                    <span
                      v-if="u.kind === 'guest'"
                      class="ml-1 text-[9px] uppercase font-bold px-1 py-0.5 rounded bg-white/10 text-gray-400 align-middle"
                    >{{ $t('profile.guestBadge') }}</span>
                  </p>
                  <p class="text-xs text-light-text-secondary dark:text-gray-400 truncate">
                    @{{ u.username }}{{ u.email ? ' · ' + u.email : '' }}
                  </p>
                </div>
                <button
                  type="button"
                  class="p-1.5 rounded-full text-light-text-secondary dark:text-gray-300 hover:text-spotify-green hover:bg-black/5 dark:hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-spotify-green"
                  :title="$t('admin.showUserInfo', { user: displayNameFor(u) })"
                  :aria-label="$t('admin.showUserInfo', { user: displayNameFor(u) })"
                  :aria-expanded="expandedUserId === u.id"
                  :aria-controls="`user-details-${u.id}`"
                  @click="toggleUserDetails(u.id)"
                >
                  <InformationCircleIcon class="w-5 h-5" />
                </button>
                <select
                  :value="u.role"
                  @change="changeRole(u, ($event.target as HTMLSelectElement).value)"
                  class="text-xs bg-white/10 border border-white/20 rounded px-2 py-1 text-light-text-primary dark:text-white"
                >
                  <option value="user">user</option>
                  <option value="admin">admin</option>
                </select>
                <button
                  type="button"
                  @click="removeUser(u)"
                  :disabled="u.id === auth.user?.id"
                  class="p-1 text-gray-400 hover:text-red-400 disabled:opacity-30"
                  :title="$t('admin.removeUser')"
                >
                  <TrashIcon class="w-4 h-4" />
                </button>
              </div>

              <div
                v-if="expandedUserId === u.id"
                :id="`user-details-${u.id}`"
                class="mx-2 mb-2 mt-1 rounded-lg border border-light-border dark:border-white/10 bg-white/60 dark:bg-black/20 p-3"
              >
                <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-5 gap-y-3">
                  <div>
                    <p class="text-[10px] uppercase tracking-wide text-light-text-secondary dark:text-gray-400">{{ $t('admin.userId') }}</p>
                    <p class="text-sm font-medium text-light-text-primary dark:text-gray-100">#{{ u.id }}</p>
                  </div>
                  <div>
                    <p class="text-[10px] uppercase tracking-wide text-light-text-secondary dark:text-gray-400">{{ $t('admin.accountType') }}</p>
                    <p class="text-sm font-medium text-light-text-primary dark:text-gray-100">{{ u.kind === 'google' ? 'Google' : $t('profile.guestBadge') }}</p>
                  </div>
                  <div>
                    <p class="text-[10px] uppercase tracking-wide text-light-text-secondary dark:text-gray-400">{{ $t('admin.sessionCount') }}</p>
                    <p class="text-sm font-medium text-light-text-primary dark:text-gray-100">{{ formatCount(u.session_count) }}</p>
                  </div>
                  <div>
                    <p class="text-[10px] uppercase tracking-wide text-light-text-secondary dark:text-gray-400">{{ $t('admin.joined') }}</p>
                    <p class="text-sm font-medium text-light-text-primary dark:text-gray-100">{{ formatDate(u.created_at) }}</p>
                  </div>
                  <div>
                    <p class="text-[10px] uppercase tracking-wide text-light-text-secondary dark:text-gray-400">{{ $t('admin.lastLogin') }}</p>
                    <p class="text-sm font-medium text-light-text-primary dark:text-gray-100">{{ formatDate(u.last_login) }}</p>
                  </div>
                  <div>
                    <p class="text-[10px] uppercase tracking-wide text-light-text-secondary dark:text-gray-400">{{ $t('admin.lastSeen') }}</p>
                    <p class="text-sm font-medium text-light-text-primary dark:text-gray-100">{{ formatDate(u.last_seen) }}</p>
                  </div>
                  <div>
                    <p class="text-[10px] uppercase tracking-wide text-light-text-secondary dark:text-gray-400">{{ $t('admin.lastIp') }}</p>
                    <p class="text-sm font-medium text-light-text-primary dark:text-gray-100 select-text break-all">{{ u.last_ip || '—' }}</p>
                  </div>
                  <div class="sm:col-span-2">
                    <p class="text-[10px] uppercase tracking-wide text-light-text-secondary dark:text-gray-400">{{ $t('admin.device') }}</p>
                    <p
                      class="text-sm font-medium text-light-text-primary dark:text-gray-100 break-words"
                      :title="u.last_user_agent || undefined"
                    >{{ userAgentSummary(u.last_user_agent) }}</p>
                  </div>
                  <div v-if="u.bio" class="sm:col-span-2 lg:col-span-3">
                    <p class="text-[10px] uppercase tracking-wide text-light-text-secondary dark:text-gray-400">{{ $t('admin.bio') }}</p>
                    <p class="text-sm text-light-text-primary dark:text-gray-100 whitespace-pre-wrap break-words">{{ u.bio }}</p>
                  </div>
                </div>
                <p class="mt-3 text-[11px] text-light-text-secondary dark:text-gray-400">{{ $t('admin.sessionCountHint') }}</p>
              </div>
            </div>
          </div>
          <p v-if="purgeNotice" class="text-xs text-spotify-green mt-2" role="status">{{ purgeNotice }}</p>
          <p v-if="usersError" class="text-xs text-red-400 mt-2">{{ usersError }}</p>
        </section>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { Cog6ToothIcon, InformationCircleIcon, TrashIcon } from '@heroicons/vue/24/outline'
import { useAuthStore } from '@/stores/auth'
import UserAvatar from '@/components/UI/UserAvatar.vue'
import { adminService } from '@/services/adminService'
import type { AdminUser } from '@/services/adminService'

const auth = useAuthStore()
const { locale, t } = useI18n()

const idsInput = ref('')
const ingestRunning = ref(false)
const ingestLog = ref<string[]>([])
const ingestError = ref('')
const logBox = ref<HTMLElement>()
let pollTimer: number | null = null

type GpuState = 'unknown' | 'ready' | 'unavailable'
const gpuState = ref<GpuState>('unknown')
const gpuChecking = ref(false)
const gpuStatusCode = ref<number | null>(null)

const metaIdsInput = ref('')
const metaRunning = ref(false)
const metaLog = ref<string[]>([])
const metaError = ref('')
const metaLogBox = ref<HTMLElement>()
let metaPollTimer: number | null = null

const users = ref<AdminUser[]>([])
const usersError = ref('')
const expandedUserId = ref<number | null>(null)
const selectedUserIds = ref<Set<number>>(new Set())
const purgeRunning = ref(false)
const purgeNotice = ref('')

const parseIdList = (input: string) =>
  [...new Set(input.split(/[\s,]+/).map((s) => parseInt(s, 10)).filter((n) => Number.isInteger(n) && n > 0))]

const parsedIds = computed(() => parseIdList(idsInput.value))
const parsedMetaIds = computed(() => parseIdList(metaIdsInput.value))
const selectableUsers = computed(() => users.value.filter((u) => u.id !== auth.user?.id))
const selectedCount = computed(() => selectedUserIds.value.size)
const allUsersSelected = computed(() =>
  selectableUsers.value.length > 0
  && selectableUsers.value.every((u) => selectedUserIds.value.has(u.id)),
)
const gpuStatusText = computed(() => {
  if (gpuChecking.value) return t('admin.gpuChecking')
  if (gpuState.value === 'ready') return t('admin.gpuReady')
  if (gpuState.value === 'unavailable' && gpuStatusCode.value !== null) {
    return t('admin.gpuUnavailableStatus', { status: gpuStatusCode.value })
  }
  if (gpuState.value === 'unavailable') return t('admin.gpuUnavailable')
  return t('admin.gpuNotChecked')
})

function apiErrorMessage(error: unknown, fallback: string) {
  const apiError = error as { response?: { data?: { message?: string } }; message?: string }
  return apiError.response?.data?.message || apiError.message || fallback
}

async function loadUsers() {
  usersError.value = ''
  try {
    const res = await adminService.listUsers()
    users.value = res.data
    const selectableIds = new Set(selectableUsers.value.map((u) => u.id))
    selectedUserIds.value = new Set([...selectedUserIds.value].filter((id) => selectableIds.has(id)))
    if (expandedUserId.value !== null && !users.value.some((u) => u.id === expandedUserId.value)) {
      expandedUserId.value = null
    }
  } catch (e) {
    usersError.value = apiErrorMessage(e, 'failed to load users')
  }
}

async function checkGpuStatus() {
  if (gpuChecking.value) return gpuState.value === 'ready'
  gpuChecking.value = true
  try {
    const res = await adminService.gpuStatus()
    gpuState.value = res.data.available ? 'ready' : 'unavailable'
    gpuStatusCode.value = res.data.status
    return res.data.available
  } catch {
    gpuState.value = 'unavailable'
    gpuStatusCode.value = null
    return false
  } finally {
    gpuChecking.value = false
  }
}

async function runIngest() {
  if (!parsedIds.value.length || ingestRunning.value || gpuChecking.value) return
  ingestError.value = ''
  ingestLog.value = []
  try {
    const gpuReady = await checkGpuStatus()
    if (!gpuReady) {
      ingestError.value = gpuStatusText.value
      return
    }
    const res = await adminService.startIngest(parsedIds.value)
    if (!res.success) { ingestError.value = res.message || 'failed to start'; return }
    ingestRunning.value = true
    const jobId = res.data.jobId
    pollTimer = window.setInterval(async () => {
      try {
        const s = await adminService.ingestStatus(jobId)
        ingestLog.value = s.data.log
        await nextTick()
        if (logBox.value) logBox.value.scrollTop = logBox.value.scrollHeight
        if (!s.data.running) {
          ingestRunning.value = false
          if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
          ingestLog.value.push(`--- finished (exit ${s.data.exitCode}) ---`)
          if (s.data.exitCode !== 0) {
            ingestError.value = t('admin.ingestFailed', { code: s.data.exitCode })
          }
          loadUsers()
        }
      } catch (e) {
        ingestRunning.value = false
        ingestError.value = apiErrorMessage(e, t('admin.ingestStatusFailed'))
        if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
      }
    }, 2000)
  } catch (e) {
    ingestError.value = apiErrorMessage(e, 'ingest failed')
  }
}

// Build metadata (blank input = all songs missing metadata)
async function runMetadata() {
  if (metaRunning.value) return
  metaError.value = ''
  metaLog.value = []
  try {
    const res = await adminService.startMetadata(parsedMetaIds.value)
    if (!res.success) { metaError.value = res.message || 'failed to start'; return }
    metaRunning.value = true
    const jobId = res.data.jobId
    metaPollTimer = window.setInterval(async () => {
      try {
        const s = await adminService.jobStatus(jobId)
        metaLog.value = s.data.log
        await nextTick()
        if (metaLogBox.value) metaLogBox.value.scrollTop = metaLogBox.value.scrollHeight
        if (!s.data.running) {
          metaRunning.value = false
          if (metaPollTimer) { clearInterval(metaPollTimer); metaPollTimer = null }
          metaLog.value.push(`--- finished (exit ${s.data.exitCode}) ---`)
        }
      } catch {
        metaRunning.value = false
        if (metaPollTimer) { clearInterval(metaPollTimer); metaPollTimer = null }
      }
    }, 2000)
  } catch (e) {
    metaError.value = (e as Error).message || 'metadata build failed'
  }
}

function displayNameFor(user: AdminUser) {
  return user.name || user.username || user.email || `#${user.id}`
}

function toggleUserDetails(id: number) {
  expandedUserId.value = expandedUserId.value === id ? null : id
}

function toggleUserSelection(id: number, checked: boolean) {
  if (id === auth.user?.id) return
  const next = new Set(selectedUserIds.value)
  if (checked) next.add(id)
  else next.delete(id)
  selectedUserIds.value = next
}

function toggleSelectAll(checked: boolean) {
  selectedUserIds.value = checked
    ? new Set(selectableUsers.value.map((u) => u.id))
    : new Set()
}

async function executePurge(payload: { ids: number[] } | { all: true }) {
  purgeRunning.value = true
  purgeNotice.value = ''
  usersError.value = ''
  try {
    const res = await adminService.purgeUsers(payload)
    selectedUserIds.value = new Set()
    await loadUsers()
    purgeNotice.value = t('admin.purgedUsers', { count: res.data.count })
  } catch (e) {
    usersError.value = apiErrorMessage(e, t('admin.purgeFailed'))
  } finally {
    purgeRunning.value = false
  }
}

async function purgeSelectedUsers() {
  const ids = [...selectedUserIds.value]
  if (!ids.length) return
  if (!window.confirm(t('admin.confirmPurgeSelected', { count: ids.length }))) return
  await executePurge({ ids })
}

async function purgeAllUsers() {
  const count = selectableUsers.value.length
  if (!count) return
  if (!window.confirm(t('admin.confirmPurgeAll', { count }))) return
  await executePurge({ all: true })
}

function formatDate(value: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(locale.value, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function formatCount(value: number) {
  const count = Number.isFinite(Number(value)) ? Number(value) : 0
  return new Intl.NumberFormat(locale.value).format(count)
}

function userAgentSummary(value: string | null) {
  if (!value) return '—'

  const browserPatterns: [string, RegExp][] = [
    ['Samsung Internet', /SamsungBrowser\/([\d.]+)/],
    ['Edge', /Edg(?:A|iOS)?\/([\d.]+)/],
    ['Firefox', /(?:Firefox|FxiOS)\/([\d.]+)/],
    ['Chrome', /(?:Chrome|CriOS)\/([\d.]+)/],
    ['Safari', /Version\/([\d.]+).*Safari/],
  ]
  const browser = browserPatterns
    .map(([name, pattern]) => {
      const match = value.match(pattern)
      return match ? `${name} ${match[1]}` : ''
    })
    .find(Boolean)

  let platform = ''
  const android = value.match(/Android\s+([\d.]+)/)
  if (android) {
    const model = value.match(/Android[^;)]*;\s*([^;()]+?)(?:\s+Build\/|;|\))/)?.[1]?.trim()
    platform = [model, `Android ${android[1]}`].filter(Boolean).join(' · ')
  } else {
    const ios = value.match(/(?:iPhone )?OS\s+([\d_]+)/)
    if (/iPad/.test(value)) platform = `iPad · iPadOS ${ios?.[1]?.replace(/_/g, '.') || ''}`.trim()
    else if (/iPhone/.test(value)) platform = `iPhone · iOS ${ios?.[1]?.replace(/_/g, '.') || ''}`.trim()
    else if (/Windows/.test(value)) platform = 'Windows'
    else if (/Macintosh|Mac OS X/.test(value)) platform = 'macOS'
    else if (/Linux/.test(value)) platform = 'Linux'
  }

  return [platform, browser].filter(Boolean).join(' · ') || value
}

async function changeRole(u: AdminUser, role: string) {
  try {
    await adminService.setRole(u.id, role as 'admin' | 'user')
    await loadUsers()
  } catch (e) {
    const message = apiErrorMessage(e, 'failed to change role')
    await loadUsers()
    usersError.value = message
  }
}

async function removeUser(u: AdminUser) {
  if (!confirm(`Remove ${u.email}?`)) return
  try {
    await adminService.deleteUser(u.id)
    await loadUsers()
  } catch (e) {
    usersError.value = apiErrorMessage(e, 'failed to remove user')
  }
}

onMounted(async () => {
  if (!auth.ready) await auth.fetchMe()
  if (auth.isAdmin) await Promise.all([loadUsers(), checkGpuStatus()])
})
onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer)
  if (metaPollTimer) clearInterval(metaPollTimer)
})
</script>
