<template>
  <div
    v-if="micTest.supported.value"
    class="p-4 mb-6 rounded-lg border bg-light-card dark:bg-spotify-dark border-light-border dark:border-spotify-light"
  >
    <div class="flex flex-col sm:flex-row sm:items-end gap-3">
      <label class="flex-1 text-xs text-light-text-secondary dark:text-gray-400">
        {{ $t('karaoke.micDevice') }}
        <select
          :value="micDeviceId"
          @change="onMicDeviceChange"
          @focus="refreshMicDevices()"
          class="mt-1 w-full px-2 py-1.5 rounded bg-white dark:bg-spotify-light border border-light-border dark:border-gray-600 focus:border-spotify-green text-light-text-primary dark:text-white text-xs [color-scheme:light] dark:[color-scheme:dark]"
        >
          <option value="" class="bg-white text-gray-900 dark:bg-spotify-light dark:text-white">
            {{ $t('karaoke.micDeviceDefault') }}
          </option>
          <option
            v-for="device in micDevices"
            :key="device.deviceId"
            :value="device.deviceId"
            class="bg-white text-gray-900 dark:bg-spotify-light dark:text-white"
          >{{ device.label }}</option>
        </select>
      </label>
      <button
        @click="micTest.toggle()"
        :disabled="micTest.starting.value"
        class="px-3 py-1.5 rounded-full text-sm font-medium transition-colors duration-200 flex-shrink-0"
        :class="micTest.testing.value
          ? 'bg-amber-500 text-black hover:bg-amber-400'
          : 'bg-white/10 text-light-text-primary dark:text-white hover:bg-white/20'"
      >{{ micTest.testing.value ? $t('karaoke.micTestStop') : $t('karaoke.micTest') }}</button>
    </div>

    <!-- This panel owns all rapidly changing test state so the large song list stays still. -->
    <div v-if="micTest.testing.value" class="mt-3 p-3 rounded-lg bg-black/20 border border-white/10">
      <p class="text-xs text-light-text-secondary dark:text-gray-400 mb-2">{{ $t('karaoke.micTestHint') }}</p>
      <div class="h-3 rounded-full bg-white/10 overflow-hidden">
        <div
          ref="micLevelBar"
          role="progressbar"
          aria-valuemin="0"
          aria-valuemax="100"
          aria-valuenow="0"
          :aria-label="$t('karaoke.micTest')"
          class="mic-level-bar h-full w-full rounded-full"
        ></div>
      </div>
      <div class="mt-3 flex items-center gap-3 flex-wrap">
        <button
          @click="micTest.recordClip()"
          :disabled="micTest.clipRecording.value"
          class="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/10 text-light-text-primary dark:text-white text-xs font-medium hover:bg-white/20 disabled:opacity-50"
        >
          <span class="inline-block w-2 h-2 rounded-full bg-red-500" :class="{ 'animate-pulse': micTest.clipRecording.value }"></span>
          {{ micTest.clipRecording.value
            ? $t('karaoke.micTestRecording', { seconds: micTest.clipCountdown.value })
            : $t('karaoke.micTestRecord') }}
        </button>
        <audio v-if="micTest.clipUrl.value" :src="micTest.clipUrl.value" controls autoplay class="h-8 max-w-full"></audio>
      </div>
      <p v-if="micTest.error.value" class="mt-2 text-xs text-red-400">
        {{ $t(`karaoke.mic_${micTest.error.value}`) }}
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { usePlayerStore } from '@/stores/player'
import { useMicDevices } from '@/composables/useMicDevices'
import { useMicTest } from '@/composables/useMicTest'

const playerStore = usePlayerStore()
const micTest = useMicTest()
const {
  devices: micDevices,
  selectedId: micDeviceId,
  select: selectMicDevice,
  refresh: refreshMicDevices,
} = useMicDevices()
const micLevelBar = ref<HTMLDivElement | null>(null)
let paintedBar: HTMLDivElement | null = null
let paintedPercent = -1
let paintedColor = ''

async function onMicDeviceChange(event: Event) {
  selectMicDevice((event.target as HTMLSelectElement).value)
  if (micTest.testing.value) {
    micTest.stop()
    await micTest.start()
  }
}

// Paint a fixed-size gradient directly. Neither Vue nor page geometry changes, so the 1,300+
// lazy song rows do not re-render or recalculate their IntersectionObservers for each sample.
watch(micTest.level, (level) => {
  const bar = micLevelBar.value
  if (!bar) return
  const normalized = Math.min(1, Math.max(0, level))
  const percent = Math.round(normalized * 50) * 2
  const color = level > 0.6 ? '#ef4444' : level > 0.25 ? '#fbbf24' : '#1db954'
  if (bar !== paintedBar) {
    paintedBar = bar
    paintedPercent = -1
    paintedColor = ''
  }
  if (percent !== paintedPercent) {
    paintedPercent = percent
    bar.style.setProperty('--mic-level', `${percent}%`)
    bar.setAttribute('aria-valuenow', String(percent))
  }
  if (color !== paintedColor) {
    paintedColor = color
    bar.style.setProperty('--mic-color', color)
  }
}, { flush: 'post' })

watch(() => playerStore.karaokeMode, (on) => {
  if (!on) micTest.stop()
})

onMounted(refreshMicDevices)
</script>

<style scoped>
.mic-level-bar {
  --mic-level: 0%;
  --mic-color: #1db954;
  background: linear-gradient(
    to right,
    var(--mic-color) 0%,
    var(--mic-color) var(--mic-level),
    transparent var(--mic-level),
    transparent 100%
  );
}
</style>
