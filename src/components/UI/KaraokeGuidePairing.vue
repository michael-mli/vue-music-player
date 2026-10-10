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
