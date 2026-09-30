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
            <RouterLink v-if="stage && party.deviceScope !== 'display'" :to="`/party/${roomId}`" class="rounded-full border border-white/25 px-4 py-2 text-sm hover:bg-white/10">
              {{ $t('party.openControls') }}
            </RouterLink>
          </div>
        </header>
        <p class="mt-2 text-xs" :class="liveConnected ? 'text-spotify-green' : 'text-gray-400'" role="status">
          {{ liveConnected ? $t('party.liveConnected') : $t('party.reconnecting') }}
        </p>

        <p v-if="error" role="alert" class="mt-5 rounded-lg bg-red-500/10 p-3 text-sm text-red-300">{{ error }}</p>
        <div v-if="party.self.admission === 'pending'" class="mt-8 rounded-2xl border border-yellow-500/20 bg-yellow-500/10 p-8 text-center">
          <h2 class="text-xl font-semibold">{{ $t('party.waitingTitle') }}</h2>
          <p class="mt-2 text-sm text-gray-300">{{ $t('party.waitingHint') }}</p>
          <p class="mt-4 text-xs text-gray-400">{{ $t('party.refreshesAutomatically') }}</p>
        </div>
        <div v-else-if="party.self.admission === 'rejected'" class="mt-8 rounded-2xl border border-red-500/20 bg-red-500/10 p-8 text-center">
          <h2 class="text-xl font-semibold">{{ $t('party.rejectedTitle') }}</h2>
          <p class="mt-2 text-sm text-gray-300">{{ $t('party.rejectedHint') }}</p>
          <RouterLink to="/party" class="mt-5 inline-block text-sm text-spotify-green underline">{{ $t('party.back') }}</RouterLink>
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
            <span>{{ $t('party.peopleCount', { count: admittedMembers.length }) }}</span>
            <span v-for="member in admittedMembers" :key="member.id">{{ member.displayName }}</span>
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

              <section v-if="!party.deviceScope && party.self.admission === 'admitted'" class="rounded-2xl border border-white/10 bg-white/5 p-5">
                <h2 class="text-lg font-semibold">{{ $t('party.pairDevice') }}</h2>
                <p class="mt-2 text-sm text-gray-400">{{ $t('party.pairHint') }}</p>
                <fieldset class="mt-4 flex flex-wrap gap-4 text-sm">
                  <legend class="mb-2 font-medium">{{ $t('party.deviceAccess') }}</legend>
                  <label class="flex items-center gap-2"><input v-model="pairScope" type="radio" value="display" class="accent-green-500" />{{ $t('party.displayScope') }}</label>
                  <label class="flex items-center gap-2"><input v-model="pairScope" type="radio" value="controller" class="accent-green-500" />{{ $t('party.controllerScope') }}</label>
                </fieldset>
                <p class="mt-2 text-xs text-gray-400">{{ pairScope === 'display' ? $t('party.displayScopeHint') : $t('party.controllerScopeHint') }}</p>
                <button type="button" :disabled="pairBusy" class="mt-4 rounded-full border border-spotify-green px-4 py-2 text-sm text-spotify-green disabled:opacity-50" @click="createPairing">
                  {{ pairBusy ? $t('party.working') : $t('party.createPairing') }}
                </button>
                <div v-if="pairing" class="mt-4 rounded-xl bg-black/30 p-4" role="status">
                  <p class="text-sm text-gray-300">{{ $t('party.enterPairCode') }}</p>
                  <code class="mt-2 block text-2xl tracking-widest">{{ pairing.code }}</code>
                  <p class="mt-2 text-xs text-gray-400">{{ $t('party.pairExpires', { time: formatTime(pairing.expiresAt) }) }}</p>
                  <p class="mt-2 text-xs text-gray-400">{{ $t('party.pairSingleUse') }}</p>
                </div>
                <h3 class="mt-6 font-semibold">{{ $t('party.pairedDevices') }}</h3>
                <p v-if="!pairedDevices.length" class="mt-2 text-sm text-gray-400">{{ $t('party.noPairedDevices') }}</p>
                <ul v-else class="mt-3 space-y-2">
                  <li v-for="device in pairedDevices" :key="device.id" class="flex items-center justify-between gap-3 rounded-lg bg-black/20 p-3 text-sm">
                    <span>{{ device.scope === 'display' ? $t('party.displayScope') : $t('party.controllerScope') }} · {{ formatTime(device.createdAt) }}</span>
                    <button type="button" :disabled="pairBusy" class="text-red-300 disabled:opacity-50" @click="revokeDevice(device.id)">{{ $t('party.revokeDevice') }}</button>
                  </li>
                </ul>
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
                        <button v-if="isModerator && entry.priorityRequested && !entry.priorityApproved && entry.state === 'queued'" type="button" :disabled="busy" class="text-spotify-green disabled:opacity-50" @click="approveNext(entry.id)">{{ $t('party.approveNext') }}</button>
                        <button v-if="isModerator || entry.requesterMemberId === party.self.id" type="button" :disabled="busy" class="text-red-300 disabled:opacity-50" @click="cancelSong(entry.id)">{{ $t('party.removeSong') }}</button>
                      </div>
                    </div>
                  </li>
                </ol>
              </section>

              <section v-if="isModerator" class="rounded-2xl border border-white/10 bg-white/5 p-5">
                <h2 class="text-lg font-semibold">{{ $t('party.roomControls') }}</h2>
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
                <button v-if="isHost" type="button" :disabled="busy" class="mt-6 text-sm text-red-300 underline disabled:opacity-50" @click="closeRoom">
                  {{ $t('party.closeRoom') }}
                </button>
              </section>
            </div>

            <section class="rounded-2xl border border-white/10 bg-white/5 p-5">
              <h2 class="text-lg font-semibold">{{ $t('party.people') }}</h2>
              <p class="mt-1 text-sm text-gray-400">{{ $t('party.peopleCount', { count: admittedMembers.length }) }}</p>
              <ul class="mt-4 space-y-3">
                <li v-for="member in party.members" :key="member.id" class="rounded-lg bg-black/20 p-3">
                  <div class="flex items-center justify-between gap-2">
                    <span class="min-w-0 truncate">{{ member.displayName }}<span v-if="duplicateNames.has(member.displayName)" class="ml-1 text-xs text-gray-400">#{{ member.id.slice(0, 6) }}</span></span>
                    <span class="text-xs text-gray-400">{{ member.admission === 'pending' ? $t('party.waiting') : member.role === 'host' ? $t('party.host') : member.role === 'cohost' ? $t('party.cohost') : '' }}</span>
                  </div>
                  <div v-if="canModerateMember(member)" class="mt-2 flex flex-wrap gap-x-3 gap-y-2 text-sm">
                    <button v-if="member.admission === 'pending'" type="button" :disabled="busy" class="text-spotify-green disabled:opacity-50" @click="approve(member.id)">
                      {{ $t('party.approve') }}
                    </button>
                    <button v-if="member.admission === 'pending'" type="button" :disabled="busy" class="text-red-300 disabled:opacity-50" @click="reject(member)">
                      {{ $t('party.reject') }}
                    </button>
                    <button v-else type="button" :disabled="busy" class="text-red-300 disabled:opacity-50" @click="remove(member.id)">
                      {{ $t('party.remove') }}
                    </button>
                    <button type="button" :disabled="busy" class="text-red-300 disabled:opacity-50" @click="block(member)">{{ $t('party.block') }}</button>
                  </div>
                  <div v-if="isHost && member.role !== 'host' && member.admission === 'admitted'" class="mt-3 flex flex-wrap gap-x-3 gap-y-2 text-sm">
                    <button type="button" :disabled="busy" class="text-spotify-green disabled:opacity-50" @click="changeRole(member)">
                      {{ member.role === 'cohost' ? $t('party.removeCohost') : $t('party.makeCohost') }}
                    </button>
                    <button type="button" :disabled="busy" class="text-gray-300 disabled:opacity-50" @click="transferHost(member)">{{ $t('party.transferHost') }}</button>
                  </div>
                </li>
              </ul>
              <template v-if="isModerator && party.excludedMembers?.length">
                <h3 class="mt-6 font-semibold">{{ $t('party.excludedPeople') }}</h3>
                <p class="mt-2 text-xs text-gray-400">{{ $t('party.restoreHint') }}</p>
                <ul class="mt-3 space-y-3">
                  <li v-for="member in party.excludedMembers" :key="member.id" class="rounded-lg bg-black/20 p-3">
                    <p class="truncate">{{ member.displayName }}<span v-if="duplicateNames.has(member.displayName)" class="ml-1 text-xs text-gray-400">#{{ member.id.slice(0, 6) }}</span></p>
                    <p class="mt-1 text-xs text-gray-400">{{ member.blocked ? $t('party.blocked') : member.admission === 'rejected' ? $t('party.rejected') : $t('party.removed') }}</p>
                    <div class="mt-2 flex flex-wrap gap-3 text-sm">
                      <button v-if="member.blocked" type="button" :disabled="busy" class="text-spotify-green disabled:opacity-50" @click="unblock(member)">{{ $t('party.unblock') }}</button>
                      <button v-else type="button" :disabled="busy" class="text-spotify-green disabled:opacity-50" @click="approve(member.id)">{{ $t('party.restoreMember') }}</button>
                      <button v-if="!member.blocked" type="button" :disabled="busy" class="text-red-300 disabled:opacity-50" @click="block(member)">{{ $t('party.block') }}</button>
                    </div>
                  </li>
                </ul>
              </template>
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
import { partyApi, type PartyDeviceSummary, type PartyMember, type PartyPairing, type PartySnapshot } from '@/services/partyApi'
import { subscribeParty } from '@/services/partyRealtime'
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
const liveConnected = ref(false)
const isHost = computed(() => party.value?.self.admission === 'admitted' && party.value.self.role === 'host' && party.value.deviceScope !== 'display')
const isModerator = computed(() => party.value?.self.admission === 'admitted' &&
  ['host', 'cohost'].includes(party.value.self.role) && party.value.deviceScope !== 'display')
const admittedMembers = computed(() => party.value?.members?.filter(member => member.admission === 'admitted') || [])
const duplicateNames = computed(() => {
  const counts = new Map<string, number>()
  for (const member of [...(party.value?.members || []), ...(party.value?.excludedMembers || [])]) {
    counts.set(member.displayName, (counts.get(member.displayName) || 0) + 1)
  }
  return new Set([...counts].filter(([, count]) => count > 1).map(([name]) => name))
})
const pairScope = ref<'display' | 'controller'>('display')
const pairing = ref<PartyPairing | null>(null)
const pairedDevices = ref<PartyDeviceSummary[]>([])
const pairBusy = ref(false)
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
let pairExpireTimer: number | undefined
let stopRealtime: (() => void) | undefined
let realtimeEnded = false

function applySnapshot(next: PartySnapshot) {
  if (next.room.id !== roomId.value) return
  if (!party.value || next.room.revision >= party.value.room.revision) party.value = next
  if (next.deviceScope === 'display' && !props.stage) void router.replace(`/party/${roomId.value}/stage`)
  if (!props.stage && !next.deviceScope && next.self.admission === 'admitted') void loadDevices()
}

function formatTime(value: string) { return new Date(value).toLocaleString() }

async function loadDevices() {
  if (party.value?.deviceScope || party.value?.self.admission !== 'admitted') return
  try { pairedDevices.value = await partyApi.devices(roomId.value) }
  catch (reason) { error.value = String((reason as Error).message) }
}

async function createPairing() {
  if (pairBusy.value) return
  pairBusy.value = true
  error.value = ''
  pairing.value = null
  try {
    pairing.value = await partyApi.createPairing(roomId.value, pairScope.value)
    if (pairExpireTimer !== undefined) window.clearTimeout(pairExpireTimer)
    pairExpireTimer = window.setTimeout(() => { pairing.value = null },
      Math.max(0, Date.parse(pairing.value.expiresAt) - Date.now()))
  }
  catch (reason) { error.value = String((reason as Error).message) }
  finally { pairBusy.value = false }
}

async function revokeDevice(deviceId: string) {
  if (pairBusy.value || !window.confirm(t('party.confirmRevokeDevice'))) return
  pairBusy.value = true
  error.value = ''
  try { await partyApi.revokeDevice(roomId.value, deviceId); await loadDevices() }
  catch (reason) { error.value = String((reason as Error).message) }
  finally { pairBusy.value = false }
}

function startRealtime() {
  stopRealtime?.()
  realtimeEnded = false
  stopRealtime = subscribeParty(roomId.value, applySnapshot,
    (connected) => { liveConnected.value = connected },
    () => { realtimeEnded = true; void refresh() })
}

async function loadCatalog() {
  catalogLoading.value = true
  try {
    await Promise.all([songsStore.songs.length ? Promise.resolve() : songsStore.fetchSongs(), karaokeService.ensureLoaded()])
  } finally { catalogLoading.value = false }
}

async function refresh() {
  const requestedRoom = roomId.value
  try {
    const next = await partyApi.get(requestedRoom)
    if (requestedRoom !== roomId.value) return
    applySnapshot(next)
    error.value = ''
    // A moderator may restore a rejected/removed member while HTTP polling is
    // active. Reacquire a ticket only after a successful authorized snapshot.
    if (realtimeEnded) startRealtime()
  } catch (reason) {
    if (requestedRoom !== roomId.value) return
    party.value = null
    error.value = String((reason as Error).message)
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  void refresh()
  startRealtime()
  if (!props.stage) void loadCatalog()
  timer = window.setInterval(() => { if (!document.hidden && !busy.value && !liveConnected.value) void refresh() }, 3000)
})
onUnmounted(() => {
  if (timer !== undefined) window.clearInterval(timer)
  if (pairExpireTimer !== undefined) window.clearTimeout(pairExpireTimer)
  stopRealtime?.()
})
watch(roomId, () => {
  party.value = null; pairing.value = null; pairedDevices.value = []
  if (pairExpireTimer !== undefined) window.clearTimeout(pairExpireTimer)
  loading.value = true; void refresh(); startRealtime()
})
watch(() => props.stage, (stage) => { if (!stage) void loadCatalog() })

async function act(work: () => Promise<PartySnapshot>) {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try { applySnapshot(await work()) }
  catch (reason) {
    const message = String((reason as Error).message)
    await refresh()
    error.value = message
  }
  finally { busy.value = false }
}

function canModerateMember(member: PartyMember) {
  return isModerator.value && member.id !== party.value?.self.id && member.role !== 'host' &&
    (isHost.value || member.role !== 'cohost')
}
function memberLabel(member: PartyMember) {
  return duplicateNames.value.has(member.displayName) ? `${member.displayName} #${member.id.slice(0, 6)}` : member.displayName
}
function approve(memberId: string) { void act(() => partyApi.approve(roomId.value, memberId, crypto.randomUUID())) }
function remove(memberId: string) {
  if (window.confirm(t('party.confirmRemove'))) void act(() => partyApi.remove(roomId.value, memberId, crypto.randomUUID()))
}
function reject(member: PartyMember) {
  if (window.confirm(t('party.confirmReject', { name: memberLabel(member) }))) {
    void act(() => partyApi.reject(roomId.value, member.id, crypto.randomUUID()))
  }
}
function block(member: PartyMember) {
  if (window.confirm(t('party.confirmBlock', { name: memberLabel(member) }))) {
    void act(() => partyApi.block(roomId.value, member.id, crypto.randomUUID()))
  }
}
function unblock(member: PartyMember) {
  if (window.confirm(t('party.confirmUnblock', { name: memberLabel(member) }))) {
    void act(() => partyApi.unblock(roomId.value, member.id, crypto.randomUUID()))
  }
}
function changeRole(member: PartyMember) {
  const role = member.role === 'cohost' ? 'member' : 'cohost'
  if (window.confirm(t(role === 'cohost' ? 'party.confirmMakeCohost' : 'party.confirmRemoveCohost', { name: memberLabel(member) }))) {
    void act(() => partyApi.role(roomId.value, member.id, role, crypto.randomUUID()))
  }
}
function transferHost(member: PartyMember) {
  if (window.confirm(t('party.confirmTransferHost', { name: memberLabel(member) }))) {
    void act(() => partyApi.transferHost(roomId.value, member.id, crypto.randomUUID()))
  }
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
