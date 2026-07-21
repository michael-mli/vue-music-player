<template>
  <div class="playlist-view h-full overflow-y-auto spotify-scrollbar">
    <div class="p-4 sm:p-6">
      <div v-if="playlistsStore.loading && !playlist" class="text-center text-light-text-secondary dark:text-gray-400 mt-12">
        {{ $t('common.loading') }}
      </div>

      <div v-else-if="playlist">
        <div class="mb-4">
          <div class="min-w-0">
            <div v-if="editingName" class="flex items-center gap-1.5 mb-2 max-w-2xl">
              <input
                ref="nameInput"
                v-model="playlistName"
                maxlength="80"
                class="min-w-0 flex-1 px-2 py-1 -ml-2 rounded-md bg-transparent border border-spotify-green text-3xl font-bold focus:outline-none focus:ring-2 focus:ring-spotify-green/30"
                :aria-label="$t('playlist.name')"
                @keyup.enter="saveName"
                @keyup.escape="cancelRename"
              />
              <button
                class="p-2 rounded-full text-spotify-green hover:bg-spotify-green/10 disabled:opacity-40"
                :disabled="savingName || !playlistName.trim()"
                :title="$t('common.save')"
                :aria-label="$t('common.save')"
                @click="saveName"
              >
                <CheckIcon class="w-5 h-5" />
              </button>
              <button
                class="p-2 rounded-full text-light-text-secondary dark:text-gray-400 hover:bg-light-border dark:hover:bg-white/10"
                :title="$t('common.cancel')"
                :aria-label="$t('common.cancel')"
                @click="cancelRename"
              >
                <XMarkIcon class="w-5 h-5" />
              </button>
            </div>

            <div v-else class="flex items-center gap-1 mb-2 min-w-0">
              <h1 class="text-3xl font-bold text-light-text-primary dark:text-white break-words min-w-0">
                {{ playlistLabel }}
              </h1>
              <Menu as="div" class="relative flex-shrink-0">
                <MenuButton
                  class="p-2 rounded-full text-light-text-secondary dark:text-gray-400 hover:text-light-text-primary dark:hover:text-white hover:bg-light-border dark:hover:bg-white/10 transition-colors"
                  :title="$t('playlist.moreActions')"
                  :aria-label="$t('playlist.moreActions')"
                >
                  <EllipsisHorizontalIcon class="w-6 h-6" />
                </MenuButton>
                <Transition
                  enter-active-class="transition duration-100 ease-out"
                  enter-from-class="transform scale-95 opacity-0"
                  enter-to-class="transform scale-100 opacity-100"
                  leave-active-class="transition duration-75 ease-in"
                  leave-from-class="transform scale-100 opacity-100"
                  leave-to-class="transform scale-95 opacity-0"
                >
                  <MenuItems
                    class="absolute left-0 z-30 mt-1 w-52 origin-top-left overflow-hidden rounded-xl border border-light-border dark:border-white/10 bg-light-surface dark:bg-spotify-dark p-1 shadow-xl focus:outline-none"
                  >
                    <MenuItem v-slot="{ active }">
                      <button
                        class="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-left"
                        :class="active ? 'bg-light-border dark:bg-white/10' : ''"
                        @click="beginRename"
                      >
                        <PencilSquareIcon class="w-5 h-5" />
                        {{ $t('playlist.rename') }}
                      </button>
                    </MenuItem>
                    <MenuItem v-if="!playlist.isDefault" v-slot="{ active }">
                      <button
                        class="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-left text-red-500"
                        :class="active ? 'bg-red-500/10' : ''"
                        @click="showDeleteDialog = true"
                      >
                        <TrashIcon class="w-5 h-5" />
                        {{ $t('playlist.deletePlaylist') }}
                      </button>
                    </MenuItem>
                  </MenuItems>
                </Transition>
              </Menu>
            </div>

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

  <TransitionRoot appear :show="showDeleteDialog" as="template">
    <Dialog as="div" class="relative z-[100]" @close="closeDeleteDialog">
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

      <div class="fixed inset-0 overflow-y-auto p-4">
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
            <DialogPanel class="w-full max-w-md rounded-2xl border border-light-border dark:border-white/10 bg-light-surface dark:bg-spotify-dark p-6 shadow-2xl">
              <div class="flex items-start gap-4">
                <div class="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-red-500/10 text-red-500">
                  <TrashIcon class="w-5 h-5" />
                </div>
                <div class="min-w-0">
                  <DialogTitle class="text-lg font-semibold text-light-text-primary dark:text-white">
                    {{ $t('playlist.deleteTitle') }}
                  </DialogTitle>
                  <p class="mt-2 text-sm leading-6 text-light-text-secondary dark:text-gray-400">
                    {{ $t('playlist.deleteDescription', { name: playlistLabel }) }}
                  </p>
                  <p v-if="playlistsStore.error" class="mt-2 text-sm text-red-500">
                    {{ $t('playlist.syncError') }}
                  </p>
                </div>
              </div>
              <div class="mt-6 flex justify-end gap-3">
                <button
                  class="px-4 py-2 rounded-full text-sm font-medium text-light-text-secondary dark:text-gray-300 hover:bg-light-border dark:hover:bg-white/10"
                  :disabled="deletingPlaylist"
                  @click="closeDeleteDialog"
                >
                  {{ $t('common.cancel') }}
                </button>
                <button
                  class="px-4 py-2 rounded-full bg-red-500 text-white text-sm font-semibold hover:bg-red-600 disabled:opacity-50"
                  :disabled="deletingPlaylist"
                  @click="deleteCurrentPlaylist"
                >
                  {{ deletingPlaylist ? $t('playlist.deleting') : $t('playlist.deletePlaylist') }}
                </button>
              </div>
            </DialogPanel>
          </TransitionChild>
        </div>
      </div>
    </Dialog>
  </TransitionRoot>
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import {
  Dialog,
  DialogPanel,
  DialogTitle,
  Menu,
  MenuButton,
  MenuItem,
  MenuItems,
  TransitionChild,
  TransitionRoot,
} from '@headlessui/vue'
import {
  CheckIcon,
  CloudIcon,
  DevicePhoneMobileIcon,
  EllipsisHorizontalIcon,
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
const showDeleteDialog = ref(false)
const deletingPlaylist = ref(false)

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
  deletingPlaylist.value = true
  const deleted = await playlistsStore.deletePlaylist(playlist.value.id)
  deletingPlaylist.value = false
  if (deleted) {
    showDeleteDialog.value = false
    await router.push('/')
  }
}

function closeDeleteDialog() {
  if (!deletingPlaylist.value) showDeleteDialog.value = false
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
