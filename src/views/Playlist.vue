<template>
  <div class="playlist-view h-full overflow-y-auto spotify-scrollbar">
    <div class="p-4 sm:p-6">
      <div v-if="playlistsStore.loading && !playlist" class="text-center text-light-text-secondary dark:text-gray-400 mt-12">
        {{ $t('common.loading') }}
      </div>

      <div v-else-if="playlist">
        <div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-4">
          <div class="min-w-0 flex-1">
            <div v-if="editingName" class="flex items-center gap-2 mb-2">
              <input
                ref="nameInput"
                v-model="playlistName"
                maxlength="80"
                class="w-full max-w-lg px-3 py-2 rounded-lg bg-light-surface dark:bg-spotify-light border border-light-border dark:border-gray-600 text-2xl font-bold focus:border-spotify-green focus:outline-none"
                @keyup.enter="saveName"
                @keyup.escape="cancelRename"
              />
              <button
                class="btn-primary px-3 py-2 disabled:opacity-50"
                :disabled="savingName || !playlistName.trim()"
                @click="saveName"
              >
                {{ $t('common.save') }}
              </button>
              <button class="px-3 py-2 text-light-text-secondary dark:text-gray-400" @click="cancelRename">
                {{ $t('common.cancel') }}
              </button>
            </div>
            <h1 v-else class="text-3xl font-bold text-light-text-primary dark:text-white mb-2 break-words">
              {{ playlistLabel }}
            </h1>
            <div class="flex flex-wrap items-center gap-2 text-sm text-light-text-secondary dark:text-gray-400">
              <span>{{ $t('playlist.songCount', { count: playlist.songs.length }) }}</span>
              <span aria-hidden="true">·</span>
              <span class="inline-flex items-center gap-1">
                <CloudIcon v-if="playlistsStore.storageMode === 'server'" class="w-4 h-4 text-spotify-green" />
                <DevicePhoneMobileIcon v-else class="w-4 h-4" />
                {{ playlistsStore.storageMode === 'server'
                  ? $t('playlist.syncedToAccount')
                  : $t('playlist.savedOnDevice') }}
              </span>
              <span
                v-if="playlist.isDefault"
                class="px-2 py-0.5 rounded-full bg-spotify-green/15 text-spotify-green text-xs font-medium"
              >
                {{ $t('playlist.defaultBadge') }}
              </span>
            </div>
          </div>

          <div v-if="!editingName" class="flex items-center gap-2">
            <button
              class="inline-flex items-center gap-2 px-3 py-2 rounded-full bg-light-border dark:bg-white/10 hover:bg-gray-300 dark:hover:bg-white/20 text-sm font-medium"
              @click="beginRename"
            >
              <PencilSquareIcon class="w-4 h-4" />
              {{ $t('playlist.rename') }}
            </button>
            <button
              v-if="!playlist.isDefault"
              class="inline-flex items-center gap-2 px-3 py-2 rounded-full bg-red-500/10 text-red-500 hover:bg-red-500/20 text-sm font-medium"
              @click="deleteCurrentPlaylist"
            >
              <TrashIcon class="w-4 h-4" />
              {{ $t('playlist.deletePlaylist') }}
            </button>
          </div>
        </div>

        <p v-if="playlistsStore.error" class="mb-4 rounded-lg bg-red-500/10 text-red-500 px-3 py-2 text-sm">
          {{ $t('playlist.syncError') }}
        </p>

        <SearchBar class="mb-6" />

        <div v-if="visibleSongs.length > 0" class="space-y-2">
          <div
            v-for="(song, index) in visibleSongs"
            :key="song.id"
            @click="playSong(song, index)"
            class="flex items-center p-3 rounded-lg hover:bg-light-border dark:hover:bg-spotify-light cursor-pointer group transition-colors duration-200"
          >
            <div class="w-8 text-center mr-4">
              <span class="text-light-text-secondary dark:text-gray-400 text-sm">{{ index + 1 }}</span>
            </div>
            <div class="w-10 h-10 bg-light-border dark:bg-spotify-dark rounded mr-3 overflow-hidden flex-shrink-0">
              <SongCover :song-id="song.id" :alt="song.title" />
            </div>
            <div class="flex-1 min-w-0">
              <p class="text-light-text-primary dark:text-white font-medium break-words">{{ song.title }}</p>
              <p class="text-light-text-secondary dark:text-gray-400 text-sm">{{ formatDuration(song.duration) }}</p>
            </div>
            <button
              @click.stop="removeSong(song)"
              class="p-2 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity duration-200"
              :title="$t('playlist.removeFromPlaylist')"
              :aria-label="$t('playlist.removeFromPlaylist')"
            >
              <XMarkIcon class="w-4 h-4 text-gray-400 hover:text-red-500" />
            </button>
          </div>
        </div>

        <div v-else class="text-center text-light-text-secondary dark:text-gray-400 mt-12">
          {{ playlistSongs.length > 0 ? $t('search.noResults') : $t('playlist.emptyPlaylist') }}
        </div>
      </div>

      <div v-else class="text-center text-light-text-secondary dark:text-gray-400 mt-12">
        {{ $t('playlist.notFound') }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import {
  CloudIcon,
  DevicePhoneMobileIcon,
  PencilSquareIcon,
  TrashIcon,
  XMarkIcon,
} from '@heroicons/vue/24/outline'
import SongCover from '@/components/UI/SongCover.vue'
import SearchBar from '@/components/UI/SearchBar.vue'
import { usePlayerStore } from '@/stores/player'
import { useSongsStore } from '@/stores/songs'
import { usePlaylistsStore } from '@/stores/playlists'
import type { Song } from '@/types'

interface Props {
  id: string
}

const props = defineProps<Props>()
const router = useRouter()
const { t } = useI18n()
const playerStore = usePlayerStore()
const songsStore = useSongsStore()
const playlistsStore = usePlaylistsStore()
const editingName = ref(false)
const savingName = ref(false)
const playlistName = ref('')
const nameInput = ref<HTMLInputElement>()

const playlist = computed(() => playlistsStore.getPlaylistById(props.id))
const playlistLabel = computed(() => playlist.value?.name || t('playlist.defaultName'))

const playlistSongs = computed(() => {
  if (!playlist.value) return []
  return playlist.value.songs
    .map((songId) => songsStore.songs.find((song) => song.id === songId))
    .filter(Boolean) as Song[]
})

const visibleSongs = computed(() => songsStore.applyQuickFilter(playlistSongs.value))

function beginRename() {
  playlistName.value = playlistLabel.value
  editingName.value = true
  nextTick(() => nameInput.value?.select())
}

function cancelRename() {
  editingName.value = false
  playlistName.value = ''
}

async function saveName() {
  if (!playlist.value || !playlistName.value.trim()) return
  savingName.value = true
  const updated = await playlistsStore.updatePlaylist(playlist.value.id, {
    name: playlistName.value.trim(),
  })
  savingName.value = false
  if (updated) cancelRename()
}

async function deleteCurrentPlaylist() {
  if (!playlist.value || playlist.value.isDefault) return
  if (!window.confirm(t('playlist.deleteConfirm', { name: playlistLabel.value }))) return
  const deleted = await playlistsStore.deletePlaylist(playlist.value.id)
  if (deleted) await router.push('/')
}

function playSong(song: Song, index: number) {
  playerStore.playSong(song, visibleSongs.value, index)
}

function removeSong(song: Song) {
  if (playlist.value) playlistsStore.removeSongFromPlaylist(playlist.value.id, song.id)
}

function formatDuration(duration?: number): string {
  if (!duration) return '—'
  const minutes = Math.floor(duration / 60)
  const seconds = Math.floor(duration % 60)
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}
</script>
