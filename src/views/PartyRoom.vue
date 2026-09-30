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
            <div v-if="party.queue?.length" class="mt-8 w-full max-w-xl text-left">
              <h3 class="mb-3 text-sm font-semibold uppercase tracking-wider text-spotify-green">{{ $t('party.upNext') }}</h3>
              <ol class="space-y-2">
                <li v-for="(entry, index) in party.queue.slice(0, 5)" :key="entry.id" class="rounded-xl bg-white/10 px-4 py-3">
                  <span class="font-semibold">{{ index + 1 }}. {{ entry.title }}</span>
                  <span class="ml-2 text-sm text-gray-300">{{ entry.singerName }}</span>
                  <span v-if="entry.state === 'held'" class="ml-2 text-xs text-yellow-300">{{ $t('party.held') }}</span>
                </li>
              </ol>
            </div>
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
                <p class="mt-2 text-sm text-gray-400">{{ $t('party.queuePlanning') }}</p>
                <label class="mt-5 block text-sm font-medium" for="party-song-search">{{ $t('party.searchSongs') }}</label>
                <input id="party-song-search" v-model="songSearch" type="search" :placeholder="$t('party.searchSongs')"
                  class="mt-2 w-full rounded-lg border border-white/20 bg-black/20 px-3 py-2 outline-none focus:border-spotify-green" />
                <p v-if="catalogLoading" class="mt-3 text-sm text-gray-400">{{ $t('party.loadingSongs') }}</p>
                <p v-else-if="!karaokeService.count" class="mt-3 text-sm text-gray-400">{{ $t('party.noKaraokeSongs') }}</p>
                <ul v-else class="mt-3 max-h-72 space-y-2 overflow-y-auto">
                  <li v-for="song in matchingSongs" :key="song.id" class="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-black/20 p-3">
                    <span class="min-w-0 flex-1 truncate text-sm">{{ song.title }}</span>
                    <div class="flex gap-2 text-xs">
                      <button type="button" :disabled="busy" class="rounded-full border border-white/25 px-3 py-1.5 hover:bg-white/10 disabled:opacity-50" @click="requestSong(song, false)">{{ $t('party.addSong') }}</button>
                      <button type="button" :disabled="busy" class="rounded-full border border-spotify-green px-3 py-1.5 text-spotify-green hover:bg-white/10 disabled:opacity-50" @click="requestSong(song, true)">{{ $t('party.requestNext') }}</button>
                    </div>
                  </li>
                </ul>
                <p v-if="!catalogLoading && karaokeService.count && !matchingSongs.length" class="mt-3 text-sm text-gray-400">{{ $t('party.noMatchingSongs') }}</p>
                <h3 class="mt-6 text-base font-semibold">{{ $t('party.upcomingQueue') }}</h3>
                <p v-if="!party.queue?.length" class="mt-2 text-sm text-gray-400">{{ $t('party.emptyQueue') }}</p>
                <ol v-else class="mt-3 space-y-2">
                  <li v-for="(entry, index) in party.queue" :key="entry.id" class="rounded-lg bg-black/20 p-3">
                    <div class="flex items-start justify-between gap-2">
                      <div class="min-w-0">
                        <p class="font-medium">{{ index + 1 }}. {{ entry.title }}</p>
                        <p class="mt-1 text-xs text-gray-400">{{ $t('party.singer') }}: {{ entry.singerName }} · {{ $t('party.requestedBy') }}: {{ entry.requesterName }}</p>
                        <p v-if="entry.state === 'held'" class="mt-1 text-xs text-yellow-300">{{ $t('party.held') }}</p>
                        <p v-else-if="entry.priorityApproved" class="mt-1 text-xs text-spotify-green">{{ $t('party.nextApproved') }}</p>
                        <p v-else-if="entry.priorityRequested" class="mt-1 text-xs text-yellow-300">{{ $t('party.nextPending') }}</p>
                      </div>
                      <div class="flex shrink-0 flex-col items-end gap-2 text-xs">
                        <button v-if="isHost && entry.priorityRequested && !entry.priorityApproved && entry.state === 'queued'" type="button" :disabled="busy" class="text-spotify-green disabled:opacity-50" @click="approveNext(entry.id)">{{ $t('party.approveNext') }}</button>
                        <button v-if="isHost || entry.requesterMemberId === party.self.id" type="button" :disabled="busy" class="text-red-300 disabled:opacity-50" @click="cancelSong(entry.id)">{{ $t('party.removeSong') }}</button>
                      </div>
                    </div>
                  </li>
                </ol>
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
import { useSongsStore } from '@/stores/songs'
import { karaokeService } from '@/services/karaokeService'
import type { Song } from '@/types'

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
const songsStore = useSongsStore()
const songSearch = ref('')
const catalogLoading = ref(false)
const matchingSongs = computed(() => {
  const query = songSearch.value.trim().toLocaleLowerCase()
  if (!query) return songsStore.songs.filter(song => karaokeService.isAvailable(song.id)).slice(0, 30)
  return songsStore.songs.filter(song => karaokeService.isAvailable(song.id) &&
    `${song.title} ${song.artist || ''} ${song.id}`.toLocaleLowerCase().includes(query)).slice(0, 30)
})
let timer: number | undefined

async function loadCatalog() {
  catalogLoading.value = true
  try {
    await Promise.all([songsStore.songs.length ? Promise.resolve() : songsStore.fetchSongs(), karaokeService.ensureLoaded()])
  } finally { catalogLoading.value = false }
}

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
  if (!props.stage) void loadCatalog()
  timer = window.setInterval(() => { if (!document.hidden && !busy.value) void refresh() }, 3000)
})
onUnmounted(() => { if (timer !== undefined) window.clearInterval(timer) })
watch(roomId, () => { party.value = null; loading.value = true; void refresh() })
watch(() => props.stage, (stage) => { if (!stage) void loadCatalog() })

async function act(work: () => Promise<PartySnapshot>) {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try { party.value = await work() }
  catch (reason) {
    const message = String((reason as Error).message)
    await refresh()
    error.value = message
  }
  finally { busy.value = false }
}

function approve(memberId: string) { void act(() => partyApi.approve(roomId.value, memberId)) }
function remove(memberId: string) {
  if (window.confirm(t('party.confirmRemove'))) void act(() => partyApi.remove(roomId.value, memberId))
}
function rotateCode() { void act(() => partyApi.rotate(roomId.value)) }
function requestSong(song: Song, requestNext: boolean) {
  void act(() => partyApi.requestSong(roomId.value, song.id, song.title, requestNext, crypto.randomUUID()))
}
function cancelSong(entryId: string) {
  void act(() => partyApi.cancelSong(roomId.value, entryId, crypto.randomUUID()))
}
function approveNext(entryId: string) {
  void act(() => partyApi.approveNext(roomId.value, entryId, crypto.randomUUID()))
}
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
