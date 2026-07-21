<template>
  <TransitionRoot appear :show="true" as="template">
    <Dialog as="div" class="relative z-[100]" @close="requestClose">
      <TransitionChild
        as="template"
        enter="duration-200 ease-out"
        enter-from="opacity-0"
        enter-to="opacity-100"
        leave="duration-150 ease-in"
        leave-from="opacity-100"
        leave-to="opacity-0"
      >
        <div class="fixed inset-0 bg-black/60 backdrop-blur-sm" />
      </TransitionChild>

      <div class="fixed inset-0 overflow-y-auto p-3 sm:p-6">
        <div class="flex min-h-full items-center justify-center">
          <TransitionChild
            as="template"
            enter="duration-200 ease-out"
            enter-from="opacity-0 scale-95"
            enter-to="opacity-100 scale-100"
            leave="duration-150 ease-in"
            leave-from="opacity-100 scale-100"
            leave-to="opacity-0 scale-95"
          >
            <DialogPanel class="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-light-border dark:border-white/10 bg-light-surface dark:bg-spotify-dark shadow-2xl">
              <div class="flex items-start justify-between gap-4 px-5 pt-5 sm:px-6 sm:pt-6">
                <div class="min-w-0">
                  <DialogTitle class="text-xl font-semibold text-light-text-primary dark:text-white">
                    {{ $t('playlist.addSongs') }}
                  </DialogTitle>
                  <p class="mt-1 truncate text-sm text-light-text-secondary dark:text-gray-400">
                    {{ playlist.name || $t('playlist.defaultName') }}
                  </p>
                </div>
                <button
                  class="p-2 -mr-2 rounded-full text-gray-400 hover:bg-light-border hover:text-light-text-primary dark:hover:bg-white/10 dark:hover:text-white"
                  :title="$t('common.close')"
                  :aria-label="$t('common.close')"
                  @click="requestClose"
                >
                  <XMarkIcon class="w-5 h-5" />
                </button>
              </div>

              <div class="px-5 pt-4 sm:px-6">
                <label class="relative block">
                  <MagnifyingGlassIcon class="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
                  <input
                    v-model="query"
                    type="search"
                    autofocus
                    class="w-full rounded-xl border border-light-border bg-light-bg py-2.5 pl-10 pr-3 text-sm text-light-text-primary placeholder:text-gray-500 focus:border-spotify-green focus:outline-none focus:ring-2 focus:ring-spotify-green/20 dark:border-white/10 dark:bg-black/20 dark:text-white"
                    :placeholder="$t('playlist.searchSongs')"
                    :aria-label="$t('playlist.searchSongs')"
                  />
                </label>
              </div>

              <div class="mt-4 min-h-0 flex-1 overflow-y-auto px-3 pb-3 spotify-scrollbar sm:px-4">
                <button
                  v-for="song in visibleSongs"
                  :key="song.id"
                  class="group flex w-full items-center gap-3 rounded-xl p-2 text-left transition-colors hover:bg-light-border dark:hover:bg-white/10"
                  :class="selectedIds.has(song.id) ? 'bg-spotify-green/10' : ''"
                  :aria-pressed="selectedIds.has(song.id)"
                  @click="toggleSong(song.id)"
                >
                  <div class="h-11 w-11 flex-shrink-0 overflow-hidden rounded-lg bg-light-border dark:bg-spotify-light">
                    <SongCover :song-id="song.id" :alt="song.title" />
                  </div>
                  <div class="min-w-0 flex-1">
                    <p class="truncate text-sm font-medium text-light-text-primary dark:text-white">{{ song.title }}</p>
                    <p class="truncate text-xs text-light-text-secondary dark:text-gray-400">
                      {{ song.artist || `Song ${song.id}` }}
                    </p>
                  </div>
                  <span
                    class="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full border transition-colors"
                    :class="selectedIds.has(song.id)
                      ? 'border-spotify-green bg-spotify-green text-black'
                      : 'border-gray-500 text-gray-400 group-hover:border-spotify-green group-hover:text-spotify-green'"
                  >
                    <CheckIcon v-if="selectedIds.has(song.id)" class="w-4 h-4" />
                    <PlusIcon v-else class="w-4 h-4" />
                  </span>
                </button>

                <div v-if="visibleSongs.length === 0" class="py-12 text-center text-sm text-light-text-secondary dark:text-gray-400">
                  {{ availableSongs.length === 0 ? $t('playlist.allSongsAdded') : $t('playlist.noSongsFound') }}
                </div>

                <p v-if="matchingSongs.length > visibleSongs.length" class="py-3 text-center text-xs text-gray-500">
                  {{ $t('playlist.refineSongSearch') }}
                </p>
              </div>

              <p v-if="playlistsStore.error" class="mx-5 mb-2 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-500 sm:mx-6">
                {{ $t('playlist.syncError') }}
              </p>

              <div class="flex items-center justify-between gap-4 border-t border-light-border px-5 py-4 dark:border-white/10 sm:px-6">
                <span class="text-sm text-light-text-secondary dark:text-gray-400">
                  {{ $t('playlist.selectedSongs', { count: selectedIds.size }) }}
                </span>
                <div class="flex items-center gap-2">
                  <button
                    class="px-4 py-2 rounded-full text-sm font-medium text-light-text-secondary hover:bg-light-border dark:text-gray-300 dark:hover:bg-white/10"
                    :disabled="saving"
                    @click="requestClose"
                  >
                    {{ $t('common.cancel') }}
                  </button>
                  <button
                    class="inline-flex items-center gap-2 rounded-full bg-spotify-green px-5 py-2 text-sm font-semibold text-black hover:bg-green-400 disabled:cursor-not-allowed disabled:opacity-40"
                    :disabled="saving || selectedIds.size === 0"
                    @click="addSelectedSongs"
                  >
                    <PlusIcon class="w-4 h-4" />
                    {{ saving ? $t('playlist.addingSongs') : $t('playlist.addSelectedSongs', { count: selectedIds.size }) }}
                  </button>
                </div>
              </div>
            </DialogPanel>
          </TransitionChild>
        </div>
      </div>
    </Dialog>
  </TransitionRoot>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  Dialog,
  DialogPanel,
  DialogTitle,
  TransitionChild,
  TransitionRoot,
} from '@headlessui/vue'
import {
  CheckIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  XMarkIcon,
} from '@heroicons/vue/24/outline'
import SongCover from './SongCover.vue'
import { usePlaylistsStore } from '@/stores/playlists'
import { useSongsStore } from '@/stores/songs'
import type { Playlist } from '@/types'

const props = defineProps<{
  playlist: Playlist
}>()

const emit = defineEmits<{
  close: []
  added: [count: number]
}>()

const songsStore = useSongsStore()
const playlistsStore = usePlaylistsStore()
const query = ref('')
const selectedIds = ref(new Set<number>())
const saving = ref(false)

const existingIds = computed(() => new Set(props.playlist.songs))
const availableSongs = computed(() =>
  songsStore.songs.filter((song) => !existingIds.value.has(song.id)),
)
const matchingSongs = computed(() => {
  const words = query.value.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return availableSongs.value
  return availableSongs.value.filter((song) => {
    const text = [song.title, song.artist, song.album, song.id].filter(Boolean).join(' ').toLowerCase()
    return words.every((word) => text.includes(word))
  })
})
const visibleSongs = computed(() => matchingSongs.value.slice(0, 200))

function toggleSong(songId: number) {
  const next = new Set(selectedIds.value)
  if (next.has(songId)) next.delete(songId)
  else next.add(songId)
  selectedIds.value = next
}

function requestClose() {
  if (!saving.value) emit('close')
}

async function addSelectedSongs() {
  if (!selectedIds.value.size) return
  saving.value = true
  const ids = [...selectedIds.value]
  const updated = await playlistsStore.updatePlaylist(props.playlist.id, {
    songs: [...props.playlist.songs, ...ids],
  })
  saving.value = false
  if (!updated) return
  emit('added', ids.length)
  emit('close')
}
</script>
