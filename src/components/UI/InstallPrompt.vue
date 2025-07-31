<template>
  <div class="fixed bottom-4 right-4 bg-spotify-dark dark:bg-spotify-dark bg-light-surface border border-spotify-light dark:border-spotify-light border-light-border rounded-lg p-4 shadow-xl max-w-sm z-50 animate-slide-up">
    <div class="flex items-start space-x-3">
      <div class="flex-shrink-0">
        <div class="w-10 h-10 bg-spotify-green rounded-lg flex items-center justify-center">
          <ArrowDownTrayIcon class="w-5 h-5 text-white" />
        </div>
      </div>
      <div class="flex-1">
        <h3 class="text-white dark:text-white text-light-text-primary font-bold mb-1">{{ $t('pwa.install') }}</h3>
        <p class="text-gray-400 dark:text-gray-400 text-light-text-secondary text-sm mb-3">
          {{ $t('pwa.installDescription') }}
        </p>
        <div class="flex space-x-2">
          <button 
            @click="$emit('close')"
            class="px-3 py-1.5 text-gray-400 hover:text-white text-sm transition-colors duration-200"
          >
            {{ $t('common.cancel') }}
          </button>
          <button 
            @click="$emit('install')"
            class="px-4 py-1.5 bg-spotify-green text-white text-sm font-medium rounded-full hover:bg-green-500 transition-colors duration-200"
          >
            {{ $t('pwa.install') }}
          </button>
        </div>
      </div>
      <button 
        @click="$emit('close')"
        class="flex-shrink-0 p-1 text-gray-400 hover:text-white transition-colors duration-200"
      >
        <XMarkIcon class="w-4 h-4" />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ArrowDownTrayIcon, XMarkIcon } from '@heroicons/vue/24/outline'

defineEmits(['close', 'install'])
</script>

<style scoped>
.animate-slide-up {
  animation: slideUp 0.3s ease-out;
}

@keyframes slideUp {
  from {
    transform: translateY(100px);
    opacity: 0;
  }
  to {
    transform: translateY(0);
    opacity: 1;
  }
}
</style>