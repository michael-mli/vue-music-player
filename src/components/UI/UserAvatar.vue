<template>
  <img
    v-if="src"
    :src="src"
    :alt="label"
    class="rounded-full object-cover flex-shrink-0"
    :style="{ width: size + 'px', height: size + 'px' }"
    referrerpolicy="no-referrer"
  />
  <div
    v-else
    class="rounded-full flex items-center justify-center flex-shrink-0 text-white font-bold select-none"
    :style="{ width: size + 'px', height: size + 'px', backgroundColor: bgColor, fontSize: size * 0.45 + 'px' }"
  >{{ initial }}</div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { AuthUser } from '@/types'

const props = withDefaults(defineProps<{ user: AuthUser | null; size?: number }>(), { size: 32 })

const label = computed(() => props.user?.name || props.user?.username || '?')
// Custom avatar wins, then the Google photo, then a colored-initial fallback
const src = computed(() => props.user?.avatar || props.user?.picture || '')
const initial = computed(() => (label.value.trim()[0] || '?').toUpperCase())

const COLORS = ['#e74c3c', '#8e44ad', '#2980b9', '#16a085', '#27ae60', '#f39c12', '#d35400', '#c0392b', '#7f8c8d', '#2c3e50']
const bgColor = computed(() => {
  const key = props.user?.username || label.value
  let hash = 0
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0
  return COLORS[hash % COLORS.length]
})
</script>
