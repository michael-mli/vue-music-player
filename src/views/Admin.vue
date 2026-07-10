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
          <div class="flex items-center gap-2 mb-3">
            <input
              v-model="idsInput"
              type="text"
              :placeholder="$t('admin.ingestPlaceholder')"
              class="flex-1 px-3 py-2 rounded bg-white/10 border border-white/20 focus:border-spotify-green text-light-text-primary dark:text-white text-sm"
              @keyup.enter="runIngest"
            />
            <button
              @click="runIngest"
              :disabled="ingestRunning || !parsedIds.length"
              class="px-4 py-2 rounded-full bg-spotify-green text-black text-sm font-medium hover:bg-spotify-green/80 disabled:opacity-40"
            >{{ ingestRunning ? $t('admin.running') : $t('admin.runIngest') }}</button>
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
          <div class="flex items-center gap-2 mb-3">
            <input
              v-model="metaIdsInput"
              type="text"
              :placeholder="$t('admin.metadataPlaceholder')"
              class="flex-1 px-3 py-2 rounded bg-white/10 border border-white/20 focus:border-spotify-green text-light-text-primary dark:text-white text-sm"
              @keyup.enter="runMetadata"
            />
            <button
              @click="runMetadata"
              :disabled="metaRunning"
              class="px-4 py-2 rounded-full bg-spotify-green text-black text-sm font-medium hover:bg-spotify-green/80 disabled:opacity-40"
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
          <h2 class="text-lg font-bold text-light-text-primary dark:text-white mb-3">{{ $t('admin.usersTitle') }} ({{ users.length }})</h2>
          <div class="space-y-2">
            <div
              v-for="u in users"
              :key="u.id"
              class="flex items-center gap-3 p-2 rounded hover:bg-light-border dark:hover:bg-spotify-light"
            >
              <img v-if="u.picture" :src="u.picture" class="w-8 h-8 rounded-full flex-shrink-0" referrerpolicy="no-referrer" />
              <div class="flex-1 min-w-0">
                <p class="text-sm text-light-text-primary dark:text-white truncate">{{ u.name || u.email }}</p>
                <p class="text-xs text-light-text-secondary dark:text-gray-400 truncate">{{ u.email }}</p>
              </div>
              <select
                :value="u.role"
                @change="changeRole(u, ($event.target as HTMLSelectElement).value)"
                class="text-xs bg-white/10 border border-white/20 rounded px-2 py-1 text-light-text-primary dark:text-white"
              >
                <option value="user">user</option>
                <option value="admin">admin</option>
              </select>
              <button
                @click="removeUser(u)"
                :disabled="u.id === auth.user?.id"
                class="p-1 text-gray-400 hover:text-red-400 disabled:opacity-30"
                :title="$t('admin.removeUser')"
              >
                <TrashIcon class="w-4 h-4" />
              </button>
            </div>
          </div>
          <p v-if="usersError" class="text-xs text-red-400 mt-2">{{ usersError }}</p>
        </section>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { Cog6ToothIcon, TrashIcon } from '@heroicons/vue/24/outline'
import { useAuthStore } from '@/stores/auth'
import { adminService } from '@/services/adminService'
import type { AuthUser } from '@/types'

const auth = useAuthStore()

const idsInput = ref('')
const ingestRunning = ref(false)
const ingestLog = ref<string[]>([])
const ingestError = ref('')
const logBox = ref<HTMLElement>()
let pollTimer: number | null = null

const metaIdsInput = ref('')
const metaRunning = ref(false)
const metaLog = ref<string[]>([])
const metaError = ref('')
const metaLogBox = ref<HTMLElement>()
let metaPollTimer: number | null = null

const users = ref<(AuthUser & { created_at: string; last_login: string })[]>([])
const usersError = ref('')

const parseIdList = (input: string) =>
  [...new Set(input.split(/[\s,]+/).map((s) => parseInt(s, 10)).filter((n) => Number.isInteger(n) && n > 0))]

const parsedIds = computed(() => parseIdList(idsInput.value))
const parsedMetaIds = computed(() => parseIdList(metaIdsInput.value))

async function loadUsers() {
  try {
    const res = await adminService.listUsers()
    users.value = res.data
  } catch (e) {
    usersError.value = (e as Error).message || 'failed to load users'
  }
}

async function runIngest() {
  if (!parsedIds.value.length || ingestRunning.value) return
  ingestError.value = ''
  ingestLog.value = []
  try {
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
          loadUsers()
        }
      } catch {
        ingestRunning.value = false
        if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
      }
    }, 2000)
  } catch (e) {
    ingestError.value = (e as Error).message || 'ingest failed'
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

async function changeRole(u: AuthUser, role: string) {
  try {
    await adminService.setRole(u.id, role as 'admin' | 'user')
    await loadUsers()
  } catch (e) {
    usersError.value = (e as Error).message || 'failed to change role'
    await loadUsers()
  }
}

async function removeUser(u: AuthUser) {
  if (!confirm(`Remove ${u.email}?`)) return
  try {
    await adminService.deleteUser(u.id)
    await loadUsers()
  } catch (e) {
    usersError.value = (e as Error).message || 'failed to remove user'
  }
}

onMounted(async () => {
  if (!auth.ready) await auth.fetchMe()
  if (auth.isAdmin) await loadUsers()
})
onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer)
  if (metaPollTimer) clearInterval(metaPollTimer)
})
</script>
