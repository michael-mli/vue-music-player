<template>
  <!-- Floating karaoke recorder — appears whenever karaoke mode is on, on any page -->
  <div
    v-if="visible"
    class="fixed right-4 bottom-36 sm:bottom-28 z-40 flex flex-col items-end gap-2"
  >
    <!-- Finished recording: playback + download popover -->
    <div
      v-if="showResult && recorder.resultUrl.value"
      class="p-3 rounded-xl bg-spotify-dark border border-spotify-light shadow-xl flex flex-col gap-2 max-w-[calc(100vw-2rem)]"
    >
      <div class="flex items-center justify-between gap-3">
        <p class="text-xs text-gray-300 font-medium">{{ $t('karaoke.record') }}</p>
        <button @click="showResult = false" class="p-0.5 text-gray-400 hover:text-white" :title="$t('common.close')">
          <XMarkIcon class="w-4 h-4" />
        </button>
      </div>
      <audio :src="recorder.resultUrl.value" controls class="h-9 w-64 max-w-full"></audio>
      <a
        :href="recorder.resultUrl.value"
        :download="recorder.resultName.value"
        class="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-full bg-spotify-green text-black text-xs font-medium hover:bg-spotify-green/80"
      >
        <ArrowDownTrayIcon class="w-4 h-4" />
        {{ $t('karaoke.recordDownload') }}
      </a>
    </div>

    <p v-if="recorder.error.value" class="px-3 py-1.5 rounded-full bg-black/70 text-xs text-red-400">
      {{ $t(`karaoke.record_${recorder.error.value}`) }}
    </p>

    <!-- The record / stop button -->
    <button
      @click="toggleRecord"
      :disabled="!canRecord || recorder.starting.value"
      :title="canRecord
        ? (recorder.recording.value ? $t('karaoke.recordStop') : $t('karaoke.recordHint'))
        : $t('player.karaokeUnavailable')"
      class="flex items-center gap-2 rounded-full shadow-xl transition-all duration-200 font-medium text-sm disabled:opacity-40 disabled:cursor-not-allowed"
      :class="recorder.recording.value
        ? 'px-4 h-12 bg-red-500 text-white hover:bg-red-600'
        : 'w-12 h-12 justify-center bg-spotify-dark border border-spotify-light text-white hover:border-spotify-green'"
    >
      <span
        class="inline-block w-3 h-3 rounded-full flex-shrink-0"
        :class="recorder.recording.value ? 'bg-white animate-pulse' : 'bg-red-500'"
      ></span>
      <span v-if="recorder.recording.value" class="tabular-nums">{{ elapsedLabel }}</span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { XMarkIcon, ArrowDownTrayIcon } from '@heroicons/vue/24/outline'
import { usePlayerStore } from '@/stores/player'
import { useKaraokeRecorder } from '@/composables/useKaraokeRecorder'
import { getInstrumentalUrl } from '@/config'

const playerStore = usePlayerStore()
const recorder = useKaraokeRecorder()

const showResult = ref(false)

// Present the whole time karaoke mode is on — on every page, Karaoke included
const visible = computed(() => playerStore.karaokeMode && recorder.supported.value)
// Recording needs a current song with an instrumental
const canRecord = computed(() => !!playerStore.currentSong && playerStore.karaokeAvailable)

const elapsedLabel = computed(() => {
  const s = recorder.elapsed.value
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`
})

function toggleRecord() {
  const song = playerStore.currentSong
  if (!song) return
  if (recorder.recording.value) {
    const safe = (song.title || `song-${song.id}`).replace(/[^\p{L}\p{N} _-]/gu, '').trim() || `song-${song.id}`
    recorder.stop(`karaoke-${safe}.mp3`)
  } else {
    showResult.value = false
    recorder.start({
      instrumentalUrl: getInstrumentalUrl(song.id),
      positionSec: playerStore.currentTime,
      getPosition: () => playerStore.currentTime,
      name: `karaoke-${song.id}.mp3`,
    })
  }
}

// The component stays mounted when hidden, so karaoke-off must explicitly finish capture.
watch(() => playerStore.karaokeMode, (on) => {
  if (!on) recorder.stop()
})

// Pop the result panel open when a recording finishes
watch(() => recorder.recording.value, (rec, was) => {
  if (was && !rec && recorder.resultUrl.value) showResult.value = true
})
</script>
