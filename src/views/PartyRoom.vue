<template>
  <div class="h-full overflow-y-auto p-5 sm:p-8" :class="stage ? 'bg-[#101820]' : ''">
    <div class="mx-auto" :class="stage ? 'max-w-6xl' : 'max-w-4xl'">
      <div v-if="loading && !party" class="text-gray-400">{{ $t('party.loading') }}</div>
      <div v-else-if="error && !party" role="alert" class="rounded-xl bg-red-500/10 p-5 text-red-300">
        {{ error }}
        <RouterLink to="/party" class="ml-3 underline">{{ $t('party.back') }}</RouterLink>
      </div>
      <template v-else-if="party">
        <header class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <RouterLink v-if="!stage" to="/party" class="text-sm text-spotify-green">← {{ $t('party.back') }}</RouterLink>
            <h1 class="mt-1 text-2xl font-bold sm:text-3xl">{{ party.room.name }}</h1>
          </div>
          <div class="flex flex-wrap gap-2">
            <RouterLink v-if="!stage && party.self.admission === 'admitted'" :to="`/party/${roomId}/stage`"
              class="rounded-full border border-white/25 px-4 py-2 text-sm hover:bg-white/10">
              {{ $t('party.openStage') }}
            </RouterLink>
            <RouterLink v-if="stage" :to="`/party/${roomId}`" class="rounded-full border border-white/25 px-4 py-2 text-sm hover:bg-white/10">
              {{ $t('party.openControls') }}
            </RouterLink>
          </div>
        </header>

        <p v-if="error" role="alert" class="mt-5 rounded-lg bg-red-500/10 p-3 text-sm text-red-300">{{ error }}</p>
        <div v-if="party.self.admission === 'pending'" class="mt-8 rounded-2xl border border-yellow-500/20 bg-yellow-500/10 p-8 text-center">
          <h2 class="text-xl font-semibold">{{ $t('party.waitingTitle') }}</h2>
          <p class="mt-2 text-sm text-gray-300">{{ $t('party.waitingHint') }}</p>
          <p class="mt-4 text-xs text-gray-400">{{ $t('party.refreshesAutomatically') }}</p>
        </div>

        <template v-else-if="stage">
          <div class="mt-8 flex min-h-[50vh] flex-col items-center justify-center rounded-3xl border border-white/10 bg-gradient-to-b from-emerald-900/30 to-black/30 px-6 text-center">
            <p class="text-sm uppercase tracking-[0.25em] text-spotify-green">{{ $t('party.stage') }}</p>
            <h2 class="mt-5 text-3xl font-bold sm:text-5xl">{{ $t('party.stageReady') }}</h2>
            <p class="mt-4 max-w-xl text-gray-300">{{ $t('party.stageWaiting') }}</p>
          </div>
          <div class="mt-5 flex flex-wrap gap-3 text-sm text-gray-300">
            <span>{{ $t('party.peopleCount', { count: party.members?.length || 0 }) }}</span>
            <span v-for="member in party.members" :key="member.id">{{ member.displayName }}</span>
          </div>
        </template>

        <template v-else>
          <div class="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
            <div class="space-y-5">
              <section v-if="isHost" class="rounded-2xl border border-white/10 bg-white/5 p-5">
                <h2 class="text-lg font-semibold">{{ $t('party.invitePeople') }}</h2>
                <p class="mt-2 text-sm text-gray-400">{{ $t('party.inviteHint') }}</p>
                <div class="mt-4 flex flex-wrap items-center gap-3">
                  <code class="rounded-lg bg-black/30 px-4 py-2 text-xl tracking-widest">{{ party.invitationCode }}</code>
                  <button type="button" class="rounded-full border border-white/25 px-4 py-2 text-sm hover:bg-white/10" @click="copyLink">
                    {{ $t('party.copyInvite') }}
                  </button>
                  <button type="button" :disabled="busy" class="text-sm text-gray-300 underline disabled:opacity-50" @click="rotateCode">
                    {{ $t('party.rotateCode') }}
                  </button>
                </div>
                <p v-if="copied" role="status" class="mt-2 text-sm text-spotify-green">{{ $t('party.linkCopied') }}</p>
              </section>

              <section class="rounded-2xl border border-white/10 bg-white/5 p-5">
                <h2 class="text-lg font-semibold">{{ $t('party.songsAndQueue') }}</h2>
                <p class="mt-3 text-sm text-gray-400">{{ $t('party.queueComing') }}</p>
              </section>

              <section v-if="isHost" class="rounded-2xl border border-white/10 bg-white/5 p-5">
                <h2 class="text-lg font-semibold">{{ $t('party.hostControls') }}</h2>
                <label class="mt-4 flex items-center gap-3 text-sm">
                  <input type="checkbox" :checked="party.room.approvalRequired" :disabled="busy"
                    class="accent-green-500" @change="changeSetting({ approvalRequired: !party?.room.approvalRequired })" />
                  {{ $t('party.requireApproval') }}
                </label>
                <label class="mt-4 flex items-center gap-3 text-sm">
                  <input type="checkbox" :checked="party.room.locked" :disabled="busy"
                    class="accent-green-500" @change="changeSetting({ locked: !party?.room.locked })" />
                  {{ $t('party.lockRoom') }}
                </label>
                <button type="button" :disabled="busy" class="mt-6 text-sm text-red-300 underline disabled:opacity-50" @click="closeRoom">
                  {{ $t('party.closeRoom') }}
                </button>
              </section>
            </div>

            <section class="rounded-2xl border border-white/10 bg-white/5 p-5">
              <h2 class="text-lg font-semibold">{{ $t('party.people') }}</h2>
              <p class="mt-1 text-sm text-gray-400">{{ $t('party.peopleCount', { count: party.members?.filter(m => m.admission === 'admitted').length || 0 }) }}</p>
              <ul class="mt-4 space-y-3">
                <li v-for="member in party.members" :key="member.id" class="rounded-lg bg-black/20 p-3">
                  <div class="flex items-center justify-between gap-2">
                    <span class="min-w-0 truncate">{{ member.displayName }}</span>
                    <span class="text-xs text-gray-400">{{ member.admission === 'pending' ? $t('party.waiting') : member.role === 'host' ? $t('party.host') : '' }}</span>
                  </div>
                  <div v-if="isHost && member.role !== 'host'" class="mt-2 flex gap-3 text-sm">
                    <button v-if="member.admission === 'pending'" type="button" :disabled="busy" class="text-spotify-green disabled:opacity-50" @click="approve(member.id)">
                      {{ $t('party.approve') }}
                    </button>
                    <button type="button" :disabled="busy" class="text-red-300 disabled:opacity-50" @click="remove(member.id)">
                      {{ $t('party.remove') }}
                    </button>
                  </div>
                </li>
              </ul>
            </section>
          </div>
        </template>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { partyApi, type PartySnapshot } from '@/services/partyApi'

const props = withDefaults(defineProps<{ stage?: boolean }>(), { stage: false })
const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const roomId = computed(() => String(route.params.roomId))
const party = ref<PartySnapshot | null>(null)
const loading = ref(true)
const busy = ref(false)
const copied = ref(false)
const error = ref('')
const isHost = computed(() => party.value?.self.role === 'host')
let timer: number | undefined

async function refresh() {
  try {
    party.value = await partyApi.get(roomId.value)
    error.value = ''
  } catch (reason) {
    party.value = null
    error.value = String((reason as Error).message)
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  void refresh()
  timer = window.setInterval(() => { if (!document.hidden && !busy.value) void refresh() }, 3000)
})
onUnmounted(() => { if (timer !== undefined) window.clearInterval(timer) })
watch(roomId, () => { party.value = null; loading.value = true; void refresh() })

async function act(work: () => Promise<PartySnapshot>) {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try { party.value = await work() }
  catch (reason) { error.value = String((reason as Error).message); await refresh() }
  finally { busy.value = false }
}

function approve(memberId: string) { void act(() => partyApi.approve(roomId.value, memberId)) }
function remove(memberId: string) {
  if (window.confirm(t('party.confirmRemove'))) void act(() => partyApi.remove(roomId.value, memberId))
}
function rotateCode() { void act(() => partyApi.rotate(roomId.value)) }
function changeSetting(changes: { locked?: boolean; approvalRequired?: boolean }) {
  void act(() => partyApi.settings(roomId.value, changes))
}
async function closeRoom() {
  if (!window.confirm(t('party.confirmClose')) || busy.value) return
  busy.value = true
  try { await partyApi.close(roomId.value); await router.push('/party') }
  catch (reason) { error.value = String((reason as Error).message); busy.value = false }
}
async function copyLink() {
  if (!party.value?.invitationCode) return
  const link = `${window.location.origin}/party/join#invite=${party.value.invitationCode}`
  try { await navigator.clipboard.writeText(link); copied.value = true }
  catch { error.value = t('party.copyFailed') }
}
</script>
