<template>
  <Teleport to="body">
    <div 
      v-if="isOpen" 
      class="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-75 backdrop-blur-sm"
      @click="close"
    >
      <div class="relative max-w-full max-h-full p-4">
        <!-- Close button -->
        <button
          @click="close"
          class="absolute top-2 right-2 z-10 p-2 rounded-full bg-black bg-opacity-50 text-white hover:bg-opacity-70 transition-all duration-200"
          aria-label="Close image"
        >
          <XMarkIcon class="w-6 h-6" />
        </button>
        
        <!-- Image -->
        <img
          :src="imageSrc"
          :alt="imageAlt"
          :title="imageTitle"
          class="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
          @click.stop
          @load="onImageLoad"
          @error="onImageError"
        />
        
        <!-- Loading state -->
        <div 
          v-if="loading" 
          class="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50 rounded-lg"
        >
          <div class="text-white text-lg">Loading...</div>
        </div>
        
        <!-- Error state -->
        <div 
          v-if="error" 
          class="absolute inset-0 flex flex-col items-center justify-center bg-black bg-opacity-50 rounded-lg text-white text-center p-4"
        >
          <div class="text-xl mb-2">⚠️</div>
          <div class="text-lg mb-2">Failed to load image</div>
          <div class="text-sm opacity-75">{{ imageSrc }}</div>
        </div>
        
        <!-- Image info -->
        <div
          v-if="imageTitle && !loading && !error"
          class="absolute bottom-0 left-0 right-0 bg-black bg-opacity-50 text-white p-4 rounded-b-lg"
        >
          <div class="text-lg font-medium">{{ imageTitle }}</div>
          <div v-if="imageAlt && imageAlt !== imageTitle" class="text-sm opacity-75">{{ imageAlt }}</div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { XMarkIcon } from '@heroicons/vue/24/outline'

interface Props {
  isOpen: boolean
  imageSrc: string
  imageAlt?: string
  imageTitle?: string
}

const props = withDefaults(defineProps<Props>(), {
  imageAlt: '',
  imageTitle: ''
})

const emit = defineEmits<{
  close: []
}>()

const loading = ref(true)
const error = ref(false)

function close() {
  emit('close')
}

function onImageLoad() {
  loading.value = false
  error.value = false
}

function onImageError() {
  loading.value = false
  error.value = true
}

// Reset states when modal opens/closes
watch(() => props.isOpen, (isOpen) => {
  if (isOpen) {
    loading.value = true
    error.value = false
    
    // Prevent body scroll when modal is open
    document.body.style.overflow = 'hidden'
  } else {
    // Restore body scroll when modal is closed
    document.body.style.overflow = ''
  }
})

// Handle escape key
function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && props.isOpen) {
    close()
  }
}

// Add/remove event listeners
watch(() => props.isOpen, (isOpen) => {
  if (isOpen) {
    document.addEventListener('keydown', handleKeydown)
  } else {
    document.removeEventListener('keydown', handleKeydown)
  }
})
</script>

<style scoped>
/* Smooth fade-in animation */
.fixed {
  animation: fadeIn 0.2s ease-out;
}

@keyframes fadeIn {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

/* Image zoom animation */
img {
  animation: zoomIn 0.3s ease-out;
}

@keyframes zoomIn {
  from {
    transform: scale(0.9);
    opacity: 0;
  }
  to {
    transform: scale(1);
    opacity: 1;
  }
}
</style>