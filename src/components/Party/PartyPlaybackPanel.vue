<template>
  <section class="mt-6 rounded-2xl border border-emerald-300/20 bg-emerald-950/20 p-5 sm:p-7" :aria-label="$t('party.playbackTitle')">
    <header class="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h2 class="text-xl font-semibold">{{ $t(stage ? 'party.stage' : 'party.playbackTitle') }}</h2>
        <p class="mt-2 max-w-xl text-sm text-gray-300">{{ $t(stage ? 'party.stageAudioHint' : party.features?.guide === false ? 'party.errorGuideDisabled' : 'party.guideAudioHint') }}</p>
      </div>
      <button v-if="stage && fullscreenSupported" type="button" class="min-h-[44px] rounded-full border border-white/30 px-4 py-2 text-sm" :aria-pressed="isFullscreen" @click="fullscreen">{{ $t(isFullscreen ? 'party.exitFullscreen' : 'party.fullscreen') }}</button>
    </header>
    <div class="mt-4 flex flex-wrap items-center gap-3">
      <button v-if="stage && !enabled && !audience && (party.room.performanceMode || 'local') === 'local'" :disabled="enabling" type="button" class="rounded-full bg-spotify-green px-5 py-3 font-semibold text-black disabled:opacity-50" @click="audio.enable('stage')">{{ $t('party.enableStageAudio') }}</button>
      <button v-if="!stage && canGuide && !enabled && !audience && party.room.performanceMode !== 'online'" :disabled="enabling" type="button" class="rounded-full bg-spotify-green px-5 py-3 font-semibold text-black disabled:opacity-50" @click="audio.enable('guide')">{{ $t('party.enableGuide') }}</button>
      <button v-if="enabled || enabling" type="button" class="rounded-full border border-white/30 px-4 py-3 text-sm" @click="audio.disable()">{{ $t('party.disableAudio') }}</button>
      <p class="text-sm text-gray-300" role="status">{{ $t(blocked ? 'party.audioRecoveryWaiting' : enabling ? 'party.audioStarting' : preparing ? 'party.audioLoading' : prepared ? 'party.audioPrepared' : enabled ? 'party.audioEnabled' : 'party.audioMuted') }}</p>
      <p v-if="stage && enabled" class="text-sm text-spotify-green">{{ $t(assignedHere ? 'party.stageAssignedHere' : 'party.stageAwaitingAssignment') }}</p>
    </div>
    <p v-if="fullscreenFailed" role="status" class="mt-3 text-sm text-amber-200">{{ $t('party.fullscreenFailed') }}</p>
    <p v-if="failure" role="alert" class="mt-3 text-sm text-red-300">{{ $t(`party.${failure}`) }}</p>
    <button v-if="failure && enabled" type="button" class="mt-2 min-h-[44px] text-sm text-spotify-green underline" @click="retryAudio">{{ $t(failure === 'audioOutputChanged' ? 'party.confirmOutputAndRetry' : 'party.retryAudio') }}</button>
    <div v-if="enabled" class="mt-5 flex flex-wrap items-center gap-4">
      <label class="flex items-center gap-3 text-sm">{{ $t(purpose === 'guide' ? 'party.guideVolume' : 'party.stageVolume') }}
        <input v-model.number="volume" :disabled="privateOriginal" type="range" min="0" max="1" step="0.01" class="w-32 accent-green-400" />
      </label>
      <div v-if="purpose === 'guide'" class="flex flex-wrap items-center gap-2 text-sm">
        <span>{{ $t('party.guideTiming') }}</span>
        <button type="button" class="rounded-lg border border-white/30 px-3 py-2" @click="guideAdvanceMs += 25">{{ $t('party.guideEarlier') }}</button>
        <span class="tabular-nums">{{ guideAdvanceMs }} ms</span>
        <button type="button" class="rounded-lg border border-white/30 px-3 py-2" @click="guideAdvanceMs -= 25">{{ $t('party.guideLater') }}</button>
        <button type="button" class="rounded-lg border border-white/30 px-3 py-2" @click="audio.resetOutput()">{{ $t('party.resetHeadphones') }}</button>
      </div>
    </div>
    <p v-if="purpose === 'guide'" class="mt-2 text-xs text-gray-400">{{ $t('party.guideCalibrationHint') }}</p>
    <p v-if="calibrationInvalidated && purpose === 'guide'" class="mt-2 text-xs text-amber-200">{{ $t('party.calibrationReset') }}</p>
    <details v-if="enabled || failure" class="mt-4 rounded-xl border border-white/10 p-3 text-xs text-gray-300">
      <summary class="min-h-[32px] cursor-pointer">{{ $t('party.audioDiagnostics') }}</summary>
      <p class="mt-2">{{ $t('party.audioDiagnosticsHint') }}</p>
      <dl class="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
        <dt>{{ $t('party.audioPhaseEstimate') }}</dt><dd class="tabular-nums">{{ diagnostics.phaseErrorMs ?? '—' }} ms</dd>
        <dt>{{ $t('party.audioMaxPhaseEstimate') }}</dt><dd class="tabular-nums">{{ diagnostics.maxAbsPhaseErrorMs }} ms ({{ diagnostics.sampleCount }})</dd>
        <dt>{{ $t('party.audioOutputLatency') }}</dt><dd class="tabular-nums">{{ diagnostics.outputLatencyMs === null ? '—' : Math.round(diagnostics.outputLatencyMs) }} ms</dd>
        <dt>{{ $t('party.audioTimingMethod') }}</dt><dd>{{ $t(`party.audioTiming_${diagnostics.timingMode}`) }}</dd>
        <dt>{{ $t('party.audioBufferMemory') }}</dt><dd class="tabular-nums">{{ diagnostics.decodedMiB }} MiB</dd>
      </dl>
    </details>
    <div v-if="canGuide && !stage" class="mt-5 rounded-xl border border-white/15 p-4">
      <label class="flex min-h-[44px] items-center gap-3 text-sm">
        <input type="checkbox" :checked="playback?.guideRequired" :disabled="busy || !playback?.assets?.original"
          class="h-5 w-5 accent-green-400" @change="requireGuide" />{{ $t('party.requireGuide') }}
      </label>
      <p class="mt-2 text-xs text-gray-300">{{ $t('party.requireGuideHint') }}</p>
      <button v-if="playback?.guideRequired && playback.guideDeviceId !== audio.deviceId" type="button" :disabled="busy"
        class="mt-3 min-h-[44px] rounded-lg border border-white/30 px-4 py-2 text-sm" @click="$emit('action', 'guide', { required: true, deviceId: audio.deviceId })">{{ $t('party.useThisGuide') }}</button>
    </div>
    <p v-if="playback?.guideRequired" class="mt-3 text-sm" :class="playback.guidePrepared ? 'text-emerald-200' : 'text-amber-200'" role="status">
      {{ $t(playback.guidePrepared ? 'party.requiredGuideReady' : 'party.requiredGuideWaiting') }}
    </p>
    <p v-if="playback?.state === 'recovering' || playback?.recoveryReason === 'service.restarted'" class="mt-3 rounded-xl bg-amber-500/10 p-3 text-sm text-amber-200" role="status">{{ $t(recoveryMessage) }}</p>
    <p v-if="party.presence?.host && !party.presence.host.connected" class="mt-3 text-sm text-amber-200" role="status">
      {{ $t(party.presence.host.controlAvailable ? 'party.hostMissingWithCohost' : 'party.hostMissingWithoutCohost', { seconds: hostGraceSeconds }) }}
    </p>
    <div v-if="canManage" class="mt-6 border-t border-white/10 pt-5">
      <h3 class="font-semibold">{{ $t('party.selectStage') }}</h3>
      <p v-if="playback?.stageDeviceId && !stageAvailable" class="mt-2 text-sm text-amber-200" role="status">{{ $t('party.stageSelectionUnavailable') }}</p>
      <p v-if="!stageDevices.length" class="mt-2 text-sm text-gray-400">{{ $t('party.noStageDevices') }}</p>
      <ul v-else class="mt-3 flex flex-wrap gap-2">
        <li v-for="device in stageDevices" :key="device.id">
          <button type="button" :disabled="busy || playback?.stageDeviceId === device.id" class="min-h-[44px] rounded-xl border border-white/25 px-4 py-2 text-sm disabled:opacity-50"
            @click="$emit('action', 'assign-stage', { deviceId: device.id })">
            {{ device.label }} · {{ party.members?.find(member => member.id === device.memberId)?.displayName }}
            <span v-if="playback?.stageDeviceId === device.id">✓</span>
          </button>
        </li>
      </ul>
      <div class="mt-4 flex flex-wrap gap-3">
        <button v-if="party.readiness?.state === 'ready' && (!playback || ['idle', 'preparing'].includes(playback.state))" type="button" :disabled="busy || !stageAvailable"
          class="min-h-[44px] rounded-full border border-spotify-green px-5 py-2 text-sm text-spotify-green disabled:opacity-40" @click="$emit('prepare')">{{ $t('party.prepareSong') }}</button>
        <button v-if="playback && ['preparing', 'paused', 'recovering'].includes(playback.state)" type="button" :disabled="busy || !stagePrepared || !startSafe || party.readiness?.state !== 'ready' || (playback.guideRequired && !playback.guidePrepared) || !party.presence?.host.controlAvailable"
          class="min-h-[44px] rounded-full bg-spotify-green px-5 py-2 text-sm font-semibold text-black disabled:opacity-40" @click="$emit('action', 'start', {})">{{ $t(playback.state === 'preparing' ? 'party.startSong' : 'party.resumeSong') }}</button>
        <button v-if="playback && ['scheduled', 'playing'].includes(playback.state)" type="button" :disabled="busy || !!playback.pendingTransition"
          class="min-h-[44px] rounded-full border border-white/30 px-5 py-2 text-sm disabled:opacity-40" @click="$emit('action', 'pause', {})">{{ $t('party.pauseSong') }}</button>
        <button v-if="playback && playback.state !== 'idle'" type="button" :disabled="busy" class="min-h-[44px] rounded-full border border-white/30 px-5 py-2 text-sm text-red-300 disabled:opacity-40" @click="skip">{{ $t('party.skipSong') }}</button>
      </div>
      <p v-if="stagePrepared && !startSafe" class="mt-2 text-sm text-gray-400" role="status">{{ $t('party.waitingForSilence') }}</p>
    </div>
    <div v-if="playback?.assets && !audience" class="mt-7 border-t border-white/10 pt-6 text-center">
      <p class="text-sm text-emerald-200" role="status">{{ $t(`party.playback_${segment?.state || playback.state}`) }}</p>
      <p v-if="countdown" class="mt-4 text-5xl font-bold tabular-nums text-spotify-green" role="status">{{ countdown }}</p>
      <h3 class="mt-3 text-2xl font-bold sm:text-4xl">{{ playback.title }}</h3>
      <p class="mt-2 text-lg text-gray-300">{{ playback.singerName }}</p>
      <div v-if="lines.length" class="mx-auto mt-8 max-w-4xl">
        <p class="min-h-[1.5em] text-lg text-gray-400 sm:text-2xl">{{ lines[lyricGuide.previous]?.text || '\u00a0' }}</p>
        <p class="mt-5 whitespace-pre-wrap text-3xl font-semibold leading-relaxed text-emerald-200 sm:text-5xl">{{ currentLyric || '♪' }}</p>
        <p v-for="entry in lyricGuide.upcoming.slice(lyricGuide.singing ? 0 : 1)" :key="entry.index" class="mt-5 text-xl text-gray-300 sm:text-3xl">{{ entry.line.text }}</p>
      </div>
      <p v-else-if="playback.assets.lyrics.text" class="mx-auto mt-8 max-h-72 max-w-3xl overflow-y-auto whitespace-pre-wrap text-left text-xl leading-relaxed">{{ playback.assets.lyrics.text }}</p>
      <p v-else class="mt-8 text-gray-400">{{ $t('party.noPartyLyrics') }}</p>
      <div class="mx-auto mt-8 flex max-w-xl items-center gap-3 text-xs text-gray-300">
        <time class="tabular-nums">{{ elapsed(positionMs) }}</time>
        <input type="range" min="0" :max="Math.max(0, playback.durationMs - 1)" step="1000" :value="positionMs" :disabled="!canManage || busy || !!playback.pendingTransition || playback.state === 'preparing' || (party.room.performanceMode !== 'local' && party.room.performanceMode && ['scheduled', 'playing'].includes(playback.state))"
          :aria-label="$t('party.songPosition')" class="w-full accent-green-400" @change="seek" />
        <time class="tabular-nums">{{ elapsed(playback.durationMs) }}</time>
      </div>
      <label v-if="canManage" class="mt-5 inline-flex items-center gap-3 text-sm text-gray-300">{{ $t('party.roomLyricTiming') }}
        <input type="number" min="-10000" max="10000" step="100" :value="playback.lyricOffsetMs" :disabled="busy" class="w-24 rounded-lg bg-black/30 px-3 py-2" @change="correctLyrics" /> ms
      </label>
      <p v-if="!playback.assets.alignmentVerified" class="mt-5 text-xs text-gray-400">{{ $t('party.audioAlignmentUnmeasured') }}</p>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { PartySnapshot } from '@/services/partyApi'
import type { usePartyPlayback } from '@/composables/usePartyPlayback'
const props = defineProps<{ party: PartySnapshot; audio: ReturnType<typeof usePartyPlayback>; stage: boolean; canManage: boolean; busy: boolean; audience?: boolean; privateOriginal?: boolean }>()
const emit = defineEmits<{ action: [action: string, payload: Record<string, unknown>]; prepare: [] }>()
const { t } = useI18n()
const { enabled, enabling, purpose, preparing, prepared, failure, volume, guideAdvanceMs, canGuide, assignedHere,
  positionMs, segment, countdown, lines, lyricGuide, startSafe, serverNowMs, blocked, diagnostics, calibrationInvalidated } = props.audio
const playback = computed(() => props.party.playback)
const stageDevices = computed(() => props.party.presence?.devices.filter(device => device.connected && device.purpose === 'stage' && device.audioEnabled && device.clockHealthy) || [])
const stageAvailable = computed(() => stageDevices.value.some(device => device.id === playback.value?.stageDeviceId))
const stagePrepared = computed(() => stageAvailable.value && props.party.presence?.devices.some(device => device.id === playback.value?.stageDeviceId &&
  device.ready && device.readyGeneration === playback.value.generation && device.audioEnabled && device.clockHealthy))
const currentLyric = computed(() => lyricGuide.value.singing ? lines.value[lyricGuide.value.index]?.text : lyricGuide.value.upcoming[0]?.line.text)
const hostGraceSeconds = computed(() => Math.max(0, Math.ceil(((props.party.presence?.host.graceDeadlineMs || serverNowMs.value) - serverNowMs.value) / 1000)))
const recoveryMessage = computed(() => playback.value?.recoveryReason?.startsWith('guide.') ? 'party.guideRecovery' :
  playback.value?.recoveryReason === 'service.restarted' ? 'party.serviceRecovery' : 'party.stageRecovery')
const fullscreenSupported = !!document.fullscreenEnabled
const isFullscreen = ref(!!document.fullscreenElement)
const fullscreenFailed = ref(false)
let ownsFullscreen = false
function fullscreenChanged() { isFullscreen.value = !!document.fullscreenElement; if (!isFullscreen.value) ownsFullscreen = false }
onMounted(() => document.addEventListener('fullscreenchange', fullscreenChanged))
onUnmounted(() => {
  document.removeEventListener('fullscreenchange', fullscreenChanged)
  if (ownsFullscreen && document.fullscreenElement) void document.exitFullscreen().catch(() => {})
})
async function fullscreen() {
  fullscreenFailed.value = false
  try {
    if (document.fullscreenElement) await document.exitFullscreen()
    else { await document.documentElement.requestFullscreen(); ownsFullscreen = true }
  } catch { fullscreenFailed.value = true }
}
function elapsed(ms: number) { const seconds = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` }
function seek(event: Event) { emit('action', 'seek', { positionMs: Number((event.target as HTMLInputElement).value) }) }
function correctLyrics(event: Event) { emit('action', 'lyrics', { lyricOffsetMs: Number((event.target as HTMLInputElement).value) }) }
function requireGuide(event: Event) { emit('action', 'guide', { required: (event.target as HTMLInputElement).checked, deviceId: props.audio.deviceId }) }
function retryAudio() { if (failure.value === 'audioOutputChanged') calibrationInvalidated.value = false; props.audio.retry() }
function skip() { if (window.confirm(t('party.confirmSkip'))) emit('action', 'skip', {}) }
</script>
