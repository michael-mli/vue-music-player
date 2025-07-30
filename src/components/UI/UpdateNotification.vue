<template>
  <div class="fixed top-4 right-4 bg-spotify-green text-white rounded-lg p-4 shadow-lg">
    <p class="font-medium mb-2">{{ $t('pwa.updateAvailable') }}</p>
    <button 
      @click="$emit('update')"
      class="bg-white text-spotify-green px-3 py-1 rounded text-sm font-medium hover:bg-gray-100 transition-colors duration-200"
    >
      {{ $t('pwa.update') }}
    </button>
  </div>
</template>

<script setup lang="ts">
defineEmits(['update'])
</script>