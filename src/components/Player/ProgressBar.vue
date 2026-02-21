<template>
  <div
    class="progress-bar-wrapper relative w-full py-2 cursor-pointer select-none"
    @mousedown="handleMouseDown"
    @touchstart.prevent="handleTouchStart"
    @mouseenter="showThumb = true"
    @mouseleave="handleMouseLeave"
    ref="progressContainer"
  >
    <div class="relative w-full h-1 bg-gray-600 rounded-full">
      <!-- Progress Fill -->
      <div
        class="h-full rounded-full transition-colors duration-200"
        :class="(showThumb || isDragging) ? 'bg-spotify-green' : 'bg-white'"
        :style="{ width: `${displayProgress}%` }"
      ></div>

      <!-- Thumb -->
      <div
        v-if="showThumb || isDragging"
        class="absolute w-3 h-3 bg-white rounded-full shadow-lg transform -translate-y-1/2 -translate-x-1/2"
        :style="{ left: `${displayProgress}%`, top: '50%' }"
      ></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'

interface Props {
  progress: number
}

interface Emits {
  (e: 'seek', percentage: number): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

const showThumb = ref(false)
const isDragging = ref(false)
const dragProgress = ref(0)
const progressContainer = ref<HTMLElement>()

const displayProgress = computed(() => {
  return isDragging.value ? dragProgress.value : props.progress
})

function handleMouseLeave() {
  if (!isDragging.value) showThumb.value = false
}

function getPercentageFromClientX(clientX: number): number {
  if (!progressContainer.value) return 0
  const rect = progressContainer.value.getBoundingClientRect()
  const x = clientX - rect.left
  return Math.max(0, Math.min(100, (x / rect.width) * 100))
}

function handleMouseDown(event: MouseEvent) {
  isDragging.value = true
  showThumb.value = true
  dragProgress.value = getPercentageFromClientX(event.clientX)

  const onMouseMove = (e: MouseEvent) => {
    dragProgress.value = getPercentageFromClientX(e.clientX)
  }

  const onMouseUp = (e: MouseEvent) => {
    emit('seek', getPercentageFromClientX(e.clientX))
    isDragging.value = false
    document.removeEventListener('mousemove', onMouseMove)
    document.removeEventListener('mouseup', onMouseUp)
  }

  document.addEventListener('mousemove', onMouseMove)
  document.addEventListener('mouseup', onMouseUp)
}

function handleTouchStart(event: TouchEvent) {
  const touch = event.touches[0]
  if (!touch) return
  isDragging.value = true
  showThumb.value = true
  dragProgress.value = getPercentageFromClientX(touch.clientX)

  const onTouchMove = (e: TouchEvent) => {
    const t = e.touches[0]
    if (t) dragProgress.value = getPercentageFromClientX(t.clientX)
  }

  const onTouchEnd = (e: TouchEvent) => {
    const t = e.changedTouches[0]
    if (t) emit('seek', getPercentageFromClientX(t.clientX))
    isDragging.value = false
    showThumb.value = false
    document.removeEventListener('touchmove', onTouchMove)
    document.removeEventListener('touchend', onTouchEnd)
  }

  document.addEventListener('touchmove', onTouchMove, { passive: true })
  document.addEventListener('touchend', onTouchEnd)
}
</script>
