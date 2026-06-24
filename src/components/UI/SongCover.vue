<template>
  <img
    :src="src"
    :alt="alt"
    loading="lazy"
    decoding="async"
    class="w-full h-full object-cover"
    @error="onError"
  />
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { getPosterUrl, DEFAULT_POSTER_URL } from '@/config'

const props = withDefaults(defineProps<{
  songId: number
  alt?: string
}>(), {
  alt: 'Cover'
})

const src = ref(getPosterUrl(props.songId))

// When the bound song changes, reset to its poster (the element is reused across songs)
watch(() => props.songId, (id) => {
  src.value = getPosterUrl(id)
})

function onError() {
  // Missing cover 404s — fall back to the bundled default poster
  if (src.value !== DEFAULT_POSTER_URL) {
    src.value = DEFAULT_POSTER_URL
  }
}
</script>
