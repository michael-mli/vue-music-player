<template>
  <div 
    class="progress-bar-container relative w-full h-1 bg-gray-600 rounded-full cursor-pointer group"
    @click="handleClick"
    @mouseenter="showThumb = true"
    @mouseleave="showThumb = false"
    ref="progressContainer"
  >
    <!-- Progress Fill -->
    <div 
      class="progress-fill h-full bg-white rounded-full transition-colors duration-200 group-hover:bg-spotify-green"
      :style="{ width: `${progress}%` }"
    ></div>
    
    <!-- Hover Thumb -->
    <div 
      v-if="showThumb"
      class="absolute w-3 h-3 bg-white rounded-full shadow-lg transform -translate-y-1 -translate-x-1/2 transition-opacity duration-200"
      :style="{ left: `${progress}%`, top: '50%' }"
    ></div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'

interface Props {
  progress: number
}

interface Emits {
  (e: 'seek', time: number): void
}

defineProps<Props>()
const emit = defineEmits<Emits>()

const showThumb = ref(false)
const progressContainer = ref<HTMLElement>()

function handleClick(event: MouseEvent) {
  if (!progressContainer.value) return
  
  const rect = progressContainer.value.getBoundingClientRect()
  const clickX = event.clientX - rect.left
  const percentage = (clickX / rect.width) * 100
  
  // Convert percentage to time (this will be handled by the parent)
  emit('seek', percentage)
}
</script>

<style scoped>
.progress-bar-container:hover .progress-fill {
  background-color: #1DB954;
}
</style>