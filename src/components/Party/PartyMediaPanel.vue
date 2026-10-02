<template>
  <section class="mt-5 rounded-2xl border border-sky-300/25 bg-sky-950/20 p-5" :aria-label="$t('party.onlinePerformance')">
    <h2 class="text-xl font-semibold">{{ $t('party.onlinePerformance') }}</h2>
    <p class="mt-2 text-sm text-gray-300">{{ $t('party.onlinePerformanceHint') }}</p>
    <label v-if="party.self.role === 'host' && party.deviceScope !== 'display'" class="mt-4 flex flex-wrap items-center gap-3 text-sm">
      {{ $t('party.performanceMode') }}
      <select :value="mode" :disabled="busy || !available || (party.playback && party.playback.state !== 'idle')" class="min-h-[44px] rounded-lg bg-[#18242a] px-3 py-2" @change="changeMode">
        <option value="local">{{ $t('party.modeLocal') }}</option>
        <option value="online">{{ $t('party.modeOnline') }}</option>
        <option value="hybrid">{{ $t('party.modeHybrid') }}</option>
      </select>
    </label>
    <p v-else class="mt-3 text-sm text-sky-200">{{ $t(`party.mode${mode[0].toUpperCase()}${mode.slice(1)}`) }}</p>
    <p v-if="!available" role="status" class="mt-3 text-sm text-amber-200">{{ $t('party.streamingUnavailable') }}</p>
    <template v-if="online">
      <p role="status" class="mt-4 text-sm text-sky-200" data-party-media-status>{{ $t(`party.media_${status}`) }}</p>
      <p v-if="failure" role="alert" class="mt-3 text-sm text-red-300">{{ $t(`party.${failure}`) }}</p>
      <div class="mt-4 flex flex-wrap gap-3">
        <button v-if="!isAudience && !captureActive" type="button" :disabled="!available || !connected || ['connecting', 'reconnecting'].includes(status)" class="min-h-[44px] rounded-full bg-sky-200 px-5 py-2 font-semibold text-black disabled:opacity-40" @click="media.listen()">{{ $t('party.connectAudience') }}</button>
        <button v-if="isAudience" type="button" :disabled="status === 'reconnecting'" class="min-h-[44px] rounded-full border border-white/30 px-4 py-2 text-sm" @click="media.enableAudio()">{{ $t('party.enableReceivedAudio') }}</button>
        <button v-if="isAudience || captureActive || ['connecting', 'reconnecting'].includes(status)" type="button" class="min-h-[44px] rounded-full border border-white/30 px-4 py-2 text-sm" @click="media.stop()">{{ $t('party.stopStreaming') }}</button>
      </div>
      <div v-if="isAudience" class="mt-4 rounded-xl bg-black/30">
        <p v-if="!hasVideo" role="status" class="p-5 text-center text-gray-300">{{ $t('party.waitingPerformance') }}</p>
        <div ref="mediaMount" data-party-media-screen />
      </div>
      <div v-if="canCapture && !isAudience" class="mt-5 border-t border-white/15 pt-4">
        <h3 class="font-semibold">{{ $t('party.preparePerformanceCapture') }}</h3>
        <p class="mt-2 text-sm text-gray-300">{{ $t('party.performanceCaptureHint') }}</p>
        <div class="mt-4 flex flex-wrap items-center gap-4 text-sm">
          <label>{{ $t('party.captureInput') }}
            <select v-model="inputMode" :disabled="captureActive" class="ml-2 min-h-[44px] rounded-lg bg-[#18242a] px-3 py-2">
              <option value="clean-mic">{{ $t('party.cleanMic') }}</option>
              <option v-if="mode === 'hybrid'" value="venue-mix">{{ $t('party.venueMix') }}</option>
            </select>
          </label>
          <label>{{ $t('party.captureAlignment') }}
            <input v-model.number="alignmentMs" :disabled="captureActive" type="number" min="-500" max="500" step="10" class="ml-2 min-h-[44px] w-24 rounded-lg bg-black/30 px-3 py-2" /> ms
          </label>
        </div>
        <p class="mt-2 text-xs text-gray-400">{{ $t('party.captureAlignmentHint') }}</p>
        <label v-if="inputMode === 'clean-mic'" class="mt-4 flex min-h-[44px] items-center gap-3 text-sm">
          <input v-model="headphones" :disabled="captureActive" type="checkbox" class="h-5 w-5 accent-sky-300" />{{ $t('party.headphonesConfirmed') }}
        </label>
        <button v-if="!captureActive" type="button" :disabled="!available || !connected || !audio.healthy.value || !party.readiness?.performanceId || (inputMode === 'clean-mic' && !headphones)" class="mt-4 min-h-[44px] rounded-full bg-spotify-green px-5 py-2 font-semibold text-black disabled:opacity-40" @click="media.prepareCapture()">{{ $t('party.prepareMic') }}</button>
        <div v-if="captureActive" class="mt-4 flex flex-wrap gap-5 text-sm">
          <label v-if="inputMode === 'clean-mic'">{{ $t('party.publishedBacking') }} <input v-model.number="backingLevel" type="range" min="0" max="1" step="0.01" class="ml-2 w-28 accent-sky-300" /></label>
          <label>{{ $t('party.publishedVocal') }} <input v-model.number="vocalLevel" type="range" min="0" max="2" step="0.01" class="ml-2 w-28 accent-sky-300" /></label>
        </div>
        <div v-if="media.publishCanvas.value" class="mt-5">
          <p class="mb-2 text-xs text-gray-400">{{ $t('party.audienceLyricPreview') }}</p>
          <div ref="captureMount" />
        </div>
        <div v-if="party.features?.guide !== false && captureActive && party.self.id === party.playback?.singerMemberId && party.playback.assets?.original" class="mt-4">
          <button type="button" :aria-pressed="originalEnabled" class="min-h-[44px] rounded-lg border border-white/30 px-4 py-2 text-sm" @click="media.toggleOriginal()">{{ $t(originalEnabled ? 'party.disablePrivateOriginal' : 'party.enablePrivateOriginal') }}</button>
          <label v-if="originalEnabled" class="ml-4 inline-flex items-center gap-3 text-sm">{{ $t('party.guideVolume') }} <input v-model.number="originalVolume" type="range" min="0" max="1" step="0.01" class="w-28 accent-green-400" /></label>
          <p class="mt-2 text-xs text-gray-400">{{ $t('party.privateOriginalHint') }}</p>
        </div>
      </div>
    </template>
  </section>
</template>

<script setup lang="ts">
import { onUnmounted, ref, watch } from 'vue'
import type { PartySnapshot } from '@/services/partyApi'
import type { usePartyMedia } from '@/composables/usePartyMedia'
import type { usePartyPlayback } from '@/composables/usePartyPlayback'
const props = defineProps<{ party: PartySnapshot; media: ReturnType<typeof usePartyMedia>; audio: ReturnType<typeof usePartyPlayback>; busy: boolean; connected: boolean }>()
const emit = defineEmits<{ mode: [mode: 'local' | 'online' | 'hybrid'] }>()
const { available, online, mode, status, failure, isAudience, captureActive, hasVideo, canCapture, inputMode, alignmentMs,
  headphones, backingLevel, vocalLevel, originalEnabled, originalVolume } = props.media
const mediaMount = ref<HTMLDivElement | null>(null)
const captureMount = ref<HTMLDivElement | null>(null)
watch([captureMount, props.media.publishCanvas], () => {
  const canvas = props.media.publishCanvas.value
  if (canvas && captureMount.value && canvas.parentElement !== captureMount.value) captureMount.value.appendChild(canvas)
}, { flush: 'post' })
watch([mediaMount, props.media.elements], () => {
  const mount = mediaMount.value
  if (!mount) return
  for (const element of props.media.elements.value) if (element.parentElement !== mount) mount.appendChild(element)
}, { flush: 'post' })
function changeMode(event: Event) {
  const next = (event.target as HTMLSelectElement).value as 'local' | 'online' | 'hybrid'
  emit('mode', next)
}
onUnmounted(() => { for (const element of props.media.elements.value) element.remove() })
</script>
