<template>
  <div 
    class="volume-control relative w-full h-1 bg-gray-600 rounded-full cursor-pointer group"
    @click="handleClick"
    @mouseenter="showThumb = true"
    @mouseleave="showThumb = false"
    ref="volumeContainer"
  >
    <!-- Volume Fill -->
    <div 
      class="volume-fill h-full bg-white rounded-full transition-colors duration-200 group-hover:bg-spotify-green"
      :style="{ width: `${displayVolume}%` }"
    ></div>
    
    <!-- Hover Thumb -->
    <div 
      v-if="showThumb"
      class="absolute w-3 h-3 bg-white rounded-full shadow-lg transform -translate-y-1 -translate-x-1/2 transition-opacity duration-200"
      :style="{ left: `${displayVolume}%`, top: '50%' }"
    ></div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'

interface Props {
  volume: number
  muted: boolean
}

interface Emits {
  (e: 'volume-change', volume: number): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

const showThumb = ref(false)
const volumeContainer = ref<HTMLElement>()

const displayVolume = computed(() => {
  return props.muted ? 0 : props.volume * 100
})

function handleClick(event: MouseEvent) {
  if (!volumeContainer.value) return
  
  const rect = volumeContainer.value.getBoundingClientRect()
  const clickX = event.clientX - rect.left
  const percentage = Math.max(0, Math.min(100, (clickX / rect.width) * 100))
  const newVolume = percentage / 100
  
  emit('volume-change', newVolume)
}
</script>

<style scoped>
.volume-control:hover .volume-fill {
  background-color: #1DB954;
}
</style>