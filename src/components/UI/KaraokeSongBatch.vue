<template>
  <div class="song-batch" role="group" :aria-label="$t('karaoke.batchSelect')">
    <button type="button" data-action="select-page" :disabled="disabled || busy || !eligible" @click="$emit('selectPage')">{{ $t(allSelected ? 'karaoke.deselectPage' : 'karaoke.selectPage') }}</button>
    <span role="status">{{ $t('karaoke.selectedCount', { count }) }}</span>
    <button type="button" data-action="clear-selection" :disabled="busy || !count" @click="$emit('clear')">{{ $t('karaoke.clearSelection') }}</button>
    <button type="button" data-action="enqueue-selected" :disabled="disabled || busy || !count" @click="$emit('add')">{{ $t(busy ? 'karaoke.addingSelected' : 'karaoke.addSelected', { count }) }}</button>
    <button v-if="busy" type="button" data-action="cancel-batch" @click="$emit('cancel')">{{ $t('common.cancel') }}</button>
  </div>
</template>

<script setup lang="ts">
defineProps<{ count: number; eligible: boolean; allSelected: boolean; disabled: boolean; busy?: boolean }>()
defineEmits<{ selectPage: []; clear: []; add: []; cancel: [] }>()
</script>

<style scoped>
.song-batch { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 12px 0; font-size: 12px; }
button { min-height: 44px; padding: 8px 12px; border: 1px solid currentColor; border-radius: 8px; }
button:disabled { opacity: .4; }
button:focus-visible { outline: 2px solid #ffe0a4; outline-offset: 2px; }
[data-action="enqueue-selected"] { color: #1db954; }
</style>
