<template>
  <figure class="mt-4 w-fit max-w-full rounded-xl bg-white p-3 text-center text-black">
    <canvas ref="canvas" role="img" :aria-label="label" class="mx-auto max-w-full" />
    <figcaption class="mt-2 max-w-[224px] text-xs">{{ label }}</figcaption>
    <p v-if="failed" role="status" class="mt-2 max-w-[224px] text-xs">{{ $t('party.qrFailed') }}</p>
  </figure>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'

const props = defineProps<{ value: string; label: string }>()
const canvas = ref<HTMLCanvasElement | null>(null)
const failed = ref(false)
let attempt = 0
async function draw() {
  const current = ++attempt
  const target = canvas.value
  if (!target) return
  target.getContext('2d')?.clearRect(0, 0, target.width, target.height)
  failed.value = false
  try {
    const qr = await import('qrcode')
    if (current !== attempt || !canvas.value) return
    // Encode locally. Invitation/pairing codes never go to a QR web service.
    await qr.toCanvas(target, props.value, { width: 224, margin: 4, errorCorrectionLevel: 'M' })
  } catch { if (current === attempt) failed.value = true }
}
onMounted(() => { void draw() })
watch(() => props.value, () => { void draw() })
onUnmounted(() => { attempt++ })
</script>
