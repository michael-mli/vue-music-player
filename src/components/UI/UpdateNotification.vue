<template>
  <div class="fixed top-4 right-4 bg-spotify-green text-white rounded-lg p-4 shadow-xl max-w-sm z-50 animate-slide-down">
    <div class="flex items-start space-x-3">
      <div class="flex-shrink-0">
        <ArrowPathIcon class="w-5 h-5 text-white" />
      </div>
      <div class="flex-1">
        <p class="font-medium mb-1">{{ $t('pwa.updateAvailable') }}</p>
        <p class="text-sm opacity-90 mb-3">{{ $t('pwa.updateDescription') }}</p>
        <div class="flex space-x-2">
          <button 
            @click="$emit('dismiss')"
            class="px-3 py-1 text-white opacity-75 hover:opacity-100 text-sm transition-opacity duration-200"
          >
            {{ $t('common.later') }}
          </button>
          <button 
            @click="$emit('update')"
            class="bg-white text-spotify-green px-4 py-1 rounded-full text-sm font-medium hover:bg-gray-100 transition-colors duration-200"
          >
            {{ $t('pwa.update') }}
          </button>
        </div>
      </div>
      <button 
        @click="$emit('dismiss')"
        class="flex-shrink-0 p-1 text-white opacity-75 hover:opacity-100 transition-opacity duration-200"
      >
        <XMarkIcon class="w-4 h-4" />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ArrowPathIcon, XMarkIcon } from '@heroicons/vue/24/outline'

defineEmits(['update', 'dismiss'])
</script>

<style scoped>
.animate-slide-down {
  animation: slideDown 0.3s ease-out;
}

@keyframes slideDown {
  from {
    transform: translateY(-100px);
    opacity: 0;
  }
  to {
    transform: translateY(0);
    opacity: 1;
  }
}
</style>