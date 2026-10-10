<template>
  <section v-if="player.karaokeMode" class="mb-6 rounded-xl border border-light-border dark:border-spotify-light bg-light-card dark:bg-spotify-dark p-4" aria-labelledby="vocal-guide-pairing-title">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="min-w-0">
        <h2 id="vocal-guide-pairing-title" class="font-semibold">{{ $t('karaoke.guide.pairTitle') }}</h2>
        <p class="mt-1 text-sm text-light-text-secondary dark:text-gray-400">{{ $t('karaoke.guide.pairHint') }}</p>
      </div>
      <button v-if="!guide.session" type="button" :disabled="guide.busy || !player.currentSong"
        class="min-h-[44px] rounded-full bg-spotify-green px-4 py-2 text-sm font-semibold text-black disabled:opacity-50"
        @click="guide.start()">{{ $t(guide.busy ? 'karaoke.guide.creating' : 'karaoke.guide.pairButton') }}</button>
      <button v-else type="button" class="min-h-[44px] rounded-full border border-light-border dark:border-white/20 px-4 py-2 text-sm"
        @click="guide.stop()">{{ $t('karaoke.guide.endPairing') }}</button>
    </div>
    <div v-if="guide.pairUrl" class="mt-4 flex flex-wrap items-center gap-5">
      <figure class="w-fit max-w-full rounded-xl bg-white p-3 text-center text-black">
        <canvas ref="canvas" role="img" :aria-label="$t('karaoke.guide.qrLabel')" class="mx-auto max-w-full" />
        <figcaption class="mt-2 max-w-[224px] text-xs">{{ $t('karaoke.guide.qrLabel') }}</figcaption>
        <p v-if="qrFailed" role="status" class="mt-2 max-w-[224px] text-xs">{{ $t('karaoke.guide.qrFailed') }}</p>
      </figure>
      <div class="min-w-0 flex-1 basis-48">
        <p role="status" class="text-sm text-spotify-green">{{ guide.connectedDevices
          ? $t('karaoke.guide.paired', { count: guide.connectedDevices }) : $t('karaoke.guide.waiting') }}</p>
        <p class="mt-2 text-sm text-light-text-secondary dark:text-gray-400">{{ $t('karaoke.guide.scanHint') }}</p>
        <label for="karaoke-guide-link" class="mt-3 block text-xs">{{ $t('karaoke.guide.pairLink') }}</label>
        <input id="karaoke-guide-link" :value="guide.pairUrl" readonly
          class="mt-1 min-h-[44px] w-full rounded-lg border border-light-border dark:border-white/20 bg-light-bg dark:bg-black/20 px-3 text-sm"
          @focus="($event.target as HTMLInputElement).select()" />
        <button type="button" class="mt-2 min-h-[44px] px-2 text-sm text-spotify-green underline" @click="copyLink">
          {{ $t(copied ? 'karaoke.guide.copied' : 'karaoke.guide.copyLink') }}
        </button>
      </div>
    </div>
    <div v-if="guide.session" class="mt-5 border-t border-light-border dark:border-white/10 pt-4">
      <h3 class="font-semibold">{{ $t('karaoke.guide.devicesTitle') }} ({{ guide.devices.length }}/10)</h3>
      <p class="mt-1 text-xs text-light-text-secondary dark:text-gray-400">{{ $t('karaoke.guide.idleHint') }}</p>
      <ul class="mt-3 space-y-3">
        <li v-for="device in guide.devices" :key="device.id" :data-device-id="device.id" class="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-light-bg dark:bg-black/20 p-3">
          <div class="min-w-0">
            <p class="break-words text-sm font-medium">{{ device.name }}</p>
            <p class="mt-1 text-xs text-light-text-secondary dark:text-gray-400">{{ $t(`karaoke.guide.device${device.status}`) }} · {{ $t('karaoke.guide.idleRemaining', { minutes: Math.ceil(device.idleRemainingMs / 60000) }) }}</p>
          </div>
          <div class="flex flex-wrap items-center gap-3">
            <label class="flex min-h-[44px] items-center gap-2 text-sm">
              <input type="checkbox" :checked="device.canControl" :disabled="!!guide.managing" class="accent-spotify-green"
                @change="guide.manageDevice(device.id, ($event.target as HTMLInputElement).checked)" />
              {{ $t('karaoke.guide.allowControls') }}
            </label>
            <button type="button" :disabled="!!guide.managing" class="min-h-[44px] px-2 text-sm text-red-500 dark:text-red-300 disabled:opacity-40"
              :aria-label="$t('karaoke.guide.removeDevice', { name: device.name })" @click="guide.manageDevice(device.id)">{{ $t('karaoke.guide.remove') }}</button>
          </div>
        </li>
      </ul>
      <h3 class="mt-4 font-semibold">{{ $t('karaoke.guide.songQueue') }}</h3>
      <p v-if="!player.requestedQueue.length" class="mt-2 text-sm text-light-text-secondary dark:text-gray-400">{{ $t('karaoke.guide.emptyQueue') }}</p>
      <ol class="mt-2 space-y-2">
        <li v-for="(song, index) in player.requestedQueue" :key="song.id" class="flex items-center gap-2 text-sm">
          <span class="min-w-0 flex-1 break-words">{{ index + 1 }}. {{ song.title }}</span>
          <button type="button" class="min-h-[44px] px-2 text-red-500 dark:text-red-300" :aria-label="$t('karaoke.guide.removeSong', { title: song.title })"
            @click="player.removeQueuedSong(song.id)">{{ $t('karaoke.guide.remove') }}</button>
        </li>
      </ol>
    </div>
    <p v-if="guide.error" role="alert" class="mt-3 text-sm text-red-500 dark:text-red-300">{{ $t(`karaoke.guide.${guide.error}`) }}</p>
  </section>
</template>

<script setup lang="ts">
import { nextTick, onUnmounted, ref, watch } from 'vue'
import { usePlayerStore } from '@/stores/player'
import { useKaraokeGuideStore } from '@/stores/karaokeGuide'

const player = usePlayerStore(), guide = useKaraokeGuideStore()
const canvas = ref<HTMLCanvasElement | null>(null), qrFailed = ref(false), copied = ref(false)
let attempt = 0
watch(() => guide.pairUrl, async value => {
  const current = ++attempt
  copied.value = false; qrFailed.value = false
  if (!value) return
  await nextTick()
  try {
    const qr = await import('qrcode')
    if (current !== attempt || !canvas.value) return
    await qr.toCanvas(canvas.value, value, { width: 224, margin: 4, errorCorrectionLevel: 'M' })
  } catch { if (current === attempt) qrFailed.value = true }
}, { immediate: true })
async function copyLink() {
  try { await navigator.clipboard.writeText(guide.pairUrl); copied.value = true }
  catch { (document.getElementById('karaoke-guide-link') as HTMLInputElement | null)?.select() }
}
onUnmounted(() => { attempt++ })
</script>
