<template>
  <div class="flex items-center gap-2 w-full">
    <!-- Metadata scope selector -->
    <select
      :value="songsStore.quickScope"
      @change="onScopeChange"
      class="flex-shrink-0 px-2 sm:px-3 py-3 bg-light-surface text-light-text-primary dark:bg-spotify-light dark:text-white rounded-full border border-light-border dark:border-gray-600 focus:border-spotify-green focus:outline-none text-sm cursor-pointer [color-scheme:light] dark:[color-scheme:dark]"
      :title="$t('search.scopeTitle')"
    >
      <option
        v-for="scope in scopes"
        :key="scope"
        :value="scope"
        class="bg-white text-gray-900 dark:bg-spotify-light dark:text-white"
      >
        {{ $t(`search.scope.${scope}`) }}
      </option>
    </select>

    <!-- Query input -->
    <div class="relative flex-1 min-w-0">
      <input
        ref="inputEl"
        :value="songsStore.quickQuery"
        @input="onInput"
        @keyup.enter="blurInput"
        type="text"
        class="w-full min-w-0 px-3 sm:px-4 py-3 pr-9 bg-light-surface text-light-text-primary dark:bg-spotify-light dark:text-white rounded-full border border-light-border dark:border-gray-600 focus:border-spotify-green focus:outline-none box-border text-sm"
        :placeholder="placeholder || $t('search.placeholder')"
      />
      <button
        v-if="songsStore.quickQuery"
        @click="clear"
        class="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 text-gray-400 hover:text-light-text-primary dark:hover:text-white"
        :title="$t('common.close')"
      >
        <XMarkIcon class="w-4 h-4" />
      </button>
    </div>

    <!-- Search button -->
    <button
      @click="focusInput"
      class="flex-shrink-0 w-11 h-11 rounded-full bg-spotify-green text-black flex items-center justify-center hover:bg-spotify-green/80 transition-colors duration-200"
      :title="$t('navigation.search')"
    >
      <MagnifyingGlassIcon class="w-5 h-5" />
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { MagnifyingGlassIcon, XMarkIcon } from '@heroicons/vue/24/outline'
import { useSongsStore } from '@/stores/songs'
import type { SearchScope } from '@/types'

defineProps<{ placeholder?: string }>()

const songsStore = useSongsStore()
const inputEl = ref<HTMLInputElement>()

const scopes: SearchScope[] = ['all', 'title', 'artist', 'album', 'year', 'genre']

function onInput(e: Event) {
  songsStore.setQuickQuery((e.target as HTMLInputElement).value)
}

function onScopeChange(e: Event) {
  songsStore.setQuickScope((e.target as HTMLSelectElement).value as SearchScope)
}

function clear() {
  songsStore.clearQuickFilter()
  inputEl.value?.focus()
}

function focusInput() {
  inputEl.value?.focus()
}

// Enter dismisses the mobile keyboard — filtering is already live while typing
function blurInput() {
  inputEl.value?.blur()
}
</script>
