<template>
  <figure class="w-fit max-w-full rounded-xl bg-white p-3 text-center text-black">
    <canvas ref="canvas" role="img" :aria-label="$t('karaoke.guide.qrLabel')" class="qr-canvas mx-auto max-w-full" />
    <figcaption class="mt-2 max-w-[224px] text-xs">{{ $t('karaoke.guide.qrLabel') }}</figcaption>
    <p v-if="failed" role="status" class="mt-2 max-w-[224px] text-xs">{{ $t('karaoke.guide.qrFailed') }}</p>
    <slot v-if="failed" name="fallback" />
  </figure>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'

const props = defineProps<{ value: string }>()
const canvas = ref<HTMLCanvasElement | null>(null)
const failed = ref(false)
let attempt = 0
async function draw() {
  const current = ++attempt, target = canvas.value, value = props.value
  if (!target) return
  target.getContext('2d')?.clearRect(0, 0, target.width, target.height)
  failed.value = false
  if (!value) return
  try {
    const qr = await import('qrcode')
    if (current !== attempt || !canvas.value) return
    await qr.toCanvas(target, value, { width: 224, margin: 4, errorCorrectionLevel: 'M' })
  } catch { if (current === attempt) failed.value = true }
}
onMounted(() => { void draw() })
watch(() => props.value, () => { void draw() })
onUnmounted(() => { attempt++ })
</script>

<style scoped>
/* Keep the QR square when the library's inline dimensions exceed the available space. */
.qr-canvas { height: auto !important; }
</style>
