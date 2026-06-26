<template>
  <transition name="hint-fade">
    <div
      v-if="show"
      class="fixed top-0 inset-x-0 z-[300] p-3 sm:p-4 bg-spotify-green text-black shadow-lg"
      role="alert"
    >
      <div class="max-w-3xl mx-auto flex items-start gap-3">
        <ExclamationTriangleIcon class="w-6 h-6 flex-shrink-0 mt-0.5" />
        <div class="flex-1 text-sm min-w-0">
          <p class="font-bold mb-1">{{ $t('backgroundHint.title') }}</p>
          <p class="mb-2">{{ $t('backgroundHint.body') }}</p>
          <p class="font-mono text-xs bg-black/10 rounded px-2 py-1 break-words">
            {{ $t('backgroundHint.steps') }}
          </p>
        </div>
        <button
          @click="dismiss"
          class="flex-shrink-0 font-semibold underline text-sm whitespace-nowrap"
        >
          {{ $t('backgroundHint.dismiss') }}
        </button>
      </div>
    </div>
  </transition>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { ExclamationTriangleIcon } from '@heroicons/vue/24/solid'
import { usePlayerStore } from '@/stores/player'

const playerStore = usePlayerStore()
const show = computed(() => playerStore.backgroundFreezeDetected)

function dismiss() {
  playerStore.dismissBackgroundFreezeHint()
}
</script>

<style scoped>
.hint-fade-enter-active,
.hint-fade-leave-active {
  transition: opacity 0.25s ease, transform 0.25s ease;
}
.hint-fade-enter-from,
.hint-fade-leave-to {
  opacity: 0;
  transform: translateY(-100%);
}
</style>
