<template>
  <div class="fixed bottom-4 right-4 bg-spotify-dark border border-spotify-light rounded-lg p-4 shadow-lg max-w-sm">
    <h3 class="text-white font-bold mb-2">{{ $t('pwa.install') }}</h3>
    <p class="text-gray-400 text-sm mb-4">Install our app for a better experience</p>
    <div class="flex space-x-2">
      <button 
        @click="$emit('close')"
        class="btn-secondary text-sm"
      >
        {{ $t('common.cancel') }}
      </button>
      <button 
        @click="$emit('install')"
        class="btn-primary text-sm"
      >
        {{ $t('pwa.install') }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
defineEmits(['close', 'install'])
</script>