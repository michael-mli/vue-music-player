<template>
  <aside class="w-64 bg-light-bg dark:bg-spotify-black flex flex-col">
    <!-- Logo -->
    <div class="p-6">
      <h1 class="text-light-text-primary dark:text-white text-xl font-bold">{{ $t('app.title') }}</h1>
    </div>
    
    <!-- Navigation -->
    <nav class="flex-1 px-2">
      <ul class="space-y-2">
        <li>
          <RouterLink 
            to="/" 
            @click="emit('close-mobile')"
            class="flex items-center px-4 py-3 rounded-md text-sm font-medium transition-colors duration-200 hover:bg-light-border dark:hover:bg-spotify-light"
            :class="{ 'bg-light-border text-light-text-primary dark:bg-spotify-light dark:text-white': $route.name === 'Home', 'text-light-text-secondary dark:text-gray-300': $route.name !== 'Home' }"
          >
            <HomeIcon class="w-5 h-5 mr-3" />
            {{ $t('navigation.home') }}
          </RouterLink>
        </li>
        <li>
          <RouterLink 
            to="/library" 
            @click="emit('close-mobile')"
            class="flex items-center px-4 py-3 rounded-md text-sm font-medium transition-colors duration-200 hover:bg-light-border dark:hover:bg-spotify-light"
            :class="{ 'bg-light-border text-light-text-primary dark:bg-spotify-light dark:text-white': $route.name === 'Library', 'text-light-text-secondary dark:text-gray-300': $route.name !== 'Library' }"
          >
            <BuildingLibraryIcon class="w-5 h-5 mr-3" />
            {{ $t('navigation.library') }}
          </RouterLink>
        </li>
        <li>
          <RouterLink
            to="/sing"
            @click="emit('close-mobile')"
            class="flex items-center px-4 py-3 rounded-md text-sm font-medium transition-colors duration-200 hover:bg-light-border dark:hover:bg-spotify-light"
            :class="{ 'bg-light-border text-light-text-primary dark:bg-spotify-light dark:text-white': $route.name === 'Karaoke', 'text-light-text-secondary dark:text-gray-300': $route.name !== 'Karaoke' }"
          >
            <MicrophoneIcon class="w-5 h-5 mr-3" />
            {{ $t('navigation.karaoke') }}
          </RouterLink>
        </li>
        <li v-if="auth.isAdmin">
          <RouterLink
            to="/admin"
            @click="emit('close-mobile')"
            class="flex items-center px-4 py-3 rounded-md text-sm font-medium transition-colors duration-200 hover:bg-light-border dark:hover:bg-spotify-light"
            :class="{ 'bg-light-border text-light-text-primary dark:bg-spotify-light dark:text-white': $route.name === 'Admin', 'text-light-text-secondary dark:text-gray-300': $route.name !== 'Admin' }"
          >
            <Cog6ToothIcon class="w-5 h-5 mr-3" />
            {{ $t('admin.title') }}
          </RouterLink>
        </li>
      </ul>
      
      <!-- Playlists Section -->
      <div class="mt-8">
        <div class="flex items-center justify-between px-4 py-2">
          <h3 class="text-sm font-medium text-light-text-secondary dark:text-gray-300 uppercase tracking-wider">
            {{ $t('navigation.playlists') }}
          </h3>
          <button 
            @click="showCreatePlaylist = true"
            class="p-1 rounded hover:bg-light-border dark:hover:bg-spotify-light transition-colors duration-200"
            :title="$t('playlist.create')"
            :aria-label="$t('playlist.create')"
          >
            <PlusIcon class="w-4 h-4 text-gray-400" />
          </button>
        </div>
        
        <ul class="mt-2 space-y-1">
          <li v-for="playlist in playlists" :key="playlist.id" class="min-w-0">
            <form
              v-if="editingPlaylistId === playlist.id"
              class="flex items-center gap-1 px-2 py-1"
              @submit.prevent="savePlaylistName(playlist.id)"
            >
              <input
                ref="playlistNameInput"
                v-model="editingPlaylistName"
                maxlength="80"
                class="min-w-0 flex-1 rounded-md border border-spotify-green bg-transparent px-2 py-1 text-sm text-light-text-primary dark:text-white focus:outline-none focus:ring-2 focus:ring-spotify-green/30"
                :aria-label="$t('playlist.name')"
                @keyup.escape="cancelPlaylistRename"
              />
              <button
                type="submit"
                class="p-1.5 rounded-full text-spotify-green hover:bg-spotify-green/10 disabled:opacity-40"
                :disabled="savingPlaylistName || !editingPlaylistName.trim()"
                :title="$t('common.save')"
                :aria-label="$t('common.save')"
              >
                <CheckIcon class="w-4 h-4" />
              </button>
              <button
                type="button"
                class="p-1.5 rounded-full text-gray-400 hover:bg-light-border dark:hover:bg-white/10"
                :title="$t('common.cancel')"
                :aria-label="$t('common.cancel')"
                @click="cancelPlaylistRename"
              >
                <XMarkIcon class="w-4 h-4" />
              </button>
            </form>

            <div
              v-else
              class="group flex items-center rounded-md transition-colors duration-200 hover:bg-light-border dark:hover:bg-spotify-light"
              :class="{ 'bg-light-border dark:bg-spotify-light': $route.name === 'Playlist' && String($route.params.id) === playlist.id }"
            >
              <RouterLink
                :to="`/playlist/${playlist.id}`"
                @click="emit('close-mobile')"
                class="min-w-0 flex-1 truncate py-2 pl-4 pr-1 text-sm text-light-text-secondary dark:text-gray-300 hover:text-light-text-primary dark:hover:text-white"
              >
                {{ playlist.name || $t('playlist.defaultName') }}
              </RouterLink>

              <Menu as="div" class="relative mr-1 flex-shrink-0">
                <MenuButton
                  class="flex h-7 w-7 items-center justify-center rounded-full text-gray-500 hover:bg-black/10 hover:text-light-text-primary dark:hover:bg-white/10 dark:hover:text-white transition-colors"
                  :title="$t('playlist.moreActions')"
                  :aria-label="`${$t('playlist.moreActions')}: ${playlist.name || $t('playlist.defaultName')}`"
                >
                  <EllipsisHorizontalIcon class="w-5 h-5" />
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
                    class="absolute right-0 z-40 mt-1 w-48 origin-top-right overflow-hidden rounded-xl border border-light-border dark:border-white/10 bg-light-surface dark:bg-spotify-dark p-1 shadow-xl focus:outline-none"
                  >
                    <MenuItem v-slot="{ active }">
                      <button
                        class="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-light-text-primary dark:text-white"
                        :class="active ? 'bg-light-border dark:bg-white/10' : ''"
                        @click="beginPlaylistRename(playlist)"
                      >
                        <PencilSquareIcon class="w-5 h-5" />
                        {{ $t('playlist.rename') }}
                      </button>
                    </MenuItem>
                    <MenuItem v-if="!playlist.isDefault" v-slot="{ active }">
                      <button
                        class="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-red-500"
                        :class="active ? 'bg-red-500/10' : ''"
                        @click="playlistPendingDelete = playlist"
                      >
                        <TrashIcon class="w-5 h-5" />
                        {{ $t('playlist.deletePlaylist') }}
                      </button>
                    </MenuItem>
                  </MenuItems>
                </Transition>
              </Menu>
            </div>
          </li>
        </ul>
      </div>
    </nav>
    
    <!-- User Menu -->
    <div class="p-4 border-t border-light-border dark:border-spotify-light">
      <div class="flex items-center gap-2">
        <div class="flex-1 min-w-0">
          <AuthMenu />
        </div>
        <LanguageSwitcher />
      </div>
      <!-- Build version -->
      <p class="mt-2 text-[10px] tabular-nums text-gray-500 text-right" :title="buildTime">
        Build {{ buildSha }} · {{ buildLabel }}
      </p>
    </div>
    
    <!-- Create Playlist Modal -->
    <CreatePlaylistModal 
      v-if="showCreatePlaylist" 
      @close="showCreatePlaylist = false"
      @created="handlePlaylistCreated"
    />

    <PlaylistDeleteDialog
      :show="Boolean(playlistPendingDelete)"
      :playlist-name="playlistPendingDeleteLabel"
      :deleting="deletingPlaylist"
      :error="Boolean(playlistsStore.error)"
      @close="playlistPendingDelete = null"
      @confirm="deletePendingPlaylist"
    />
  </aside>
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'

const buildTime = __APP_BUILD_TIME__
const buildSha = __APP_BUILD_SHA__
const buildDate = new Date(buildTime)
const buildLabel = buildDate.toLocaleDateString('en', { month: 'short', day: 'numeric' })
  + ' ' + buildDate.toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit', hour12: false })
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/vue'
import {
  CheckIcon,
  HomeIcon,
  BuildingLibraryIcon,
  EllipsisHorizontalIcon,
  MicrophoneIcon,
  PencilSquareIcon,
  PlusIcon,
  Cog6ToothIcon,
  TrashIcon,
  XMarkIcon,
} from '@heroicons/vue/24/outline'
import { usePlaylistsStore } from '@/stores/playlists'
import { useAuthStore } from '@/stores/auth'
import type { Playlist } from '@/types'
import LanguageSwitcher from './LanguageSwitcher.vue'
import CreatePlaylistModal from './CreatePlaylistModal.vue'
import PlaylistDeleteDialog from './PlaylistDeleteDialog.vue'
import AuthMenu from './AuthMenu.vue'

// Define emits
const emit = defineEmits<{
  'close-mobile': []
}>()

const $route = useRoute()
const router = useRouter()
const { t } = useI18n()
const playlistsStore = usePlaylistsStore()
const auth = useAuthStore()

const showCreatePlaylist = ref(false)
const editingPlaylistId = ref<string | null>(null)
const editingPlaylistName = ref('')
const savingPlaylistName = ref(false)
const playlistNameInput = ref<HTMLInputElement>()
const playlistPendingDelete = ref<Playlist | null>(null)
const deletingPlaylist = ref(false)

const playlists = computed(() => playlistsStore.playlists)
const playlistPendingDeleteLabel = computed(() =>
  playlistPendingDelete.value?.name || t('playlist.defaultName'),
)

function handlePlaylistCreated() {
  showCreatePlaylist.value = false
}

function beginPlaylistRename(playlist: Playlist) {
  editingPlaylistId.value = playlist.id
  editingPlaylistName.value = playlist.name || t('playlist.defaultName')
  nextTick(() => playlistNameInput.value?.select())
}

function cancelPlaylistRename() {
  editingPlaylistId.value = null
  editingPlaylistName.value = ''
}

async function savePlaylistName(playlistId: string) {
  const name = editingPlaylistName.value.trim()
  if (!name) return
  savingPlaylistName.value = true
  const updated = await playlistsStore.updatePlaylist(playlistId, { name })
  savingPlaylistName.value = false
  if (updated) cancelPlaylistRename()
}

async function deletePendingPlaylist() {
  const playlist = playlistPendingDelete.value
  if (!playlist || playlist.isDefault) return
  deletingPlaylist.value = true
  const deleted = await playlistsStore.deletePlaylist(playlist.id)
  deletingPlaylist.value = false
  if (!deleted) return
  playlistPendingDelete.value = null
  if ($route.name === 'Playlist' && String($route.params.id) === playlist.id) {
    await router.push('/')
  }
}
</script>