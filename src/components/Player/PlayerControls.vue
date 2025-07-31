<template>
  <!-- Mobile Layout -->
  <div class="fixed bottom-0 left-0 right-0 h-28 bg-light-card dark:bg-spotify-dark border-t border-light-border dark:border-spotify-light sm:hidden z-40">
    <!-- Current Song Info - Mobile -->
    <div v-if="currentSong" class="flex items-center px-2 py-1.5 border-b border-light-border dark:border-spotify-light h-12">
      <div class="w-8 h-8 bg-light-border dark:bg-spotify-light rounded mr-2 flex items-center justify-center">
        <MusicalNoteIcon class="w-4 h-4 text-gray-400" />
      </div>
      <div class="flex-1 min-w-0">
        <p class="text-xs font-medium text-light-text-primary dark:text-white truncate">{{ currentSong.title }} (#{{ currentSong.id }})</p>
        <p class="text-xs text-light-text-secondary dark:text-gray-400 truncate">{{ $t('player.currentlyPlaying') }}</p>
      </div>
      <button 
        @click="toggleFavorite"
        class="ml-2 p-1 rounded hover:bg-spotify-light transition-colors duration-200"
      >
        <HeartIcon 
          :class="[
            'w-3 h-3',
            currentSong.isFavorite ? 'text-spotify-green fill-current' : 'text-gray-400'
          ]" 
        />
      </button>
    </div>
    
    <!-- Player Controls - Mobile -->
    <div class="flex items-center justify-between px-2 py-2 h-16">
      <div class="flex items-center space-x-1">
        <button 
          @click="toggleShuffle"
          :class="[
            'p-1 rounded-full transition-colors duration-200',
            shuffle ? 'text-spotify-green' : 'text-gray-400'
          ]"
        >
          <ArrowsUpDownIcon class="w-4 h-4" />
        </button>
        
        <button 
          @click="previousSong"
          :disabled="!canPlayPrevious"
          class="p-1 rounded-full text-gray-400 hover:text-white transition-colors duration-200 disabled:opacity-50"
        >
          <BackwardIcon class="w-4 h-4" />
        </button>
      </div>
      
      <button 
        @click="togglePlay"
        class="w-8 h-8 bg-white rounded-full flex items-center justify-center hover:scale-105 transition-transform duration-200"
      >
        <PlayIcon v-if="!isPlaying" class="w-4 h-4 text-black ml-0.5" />
        <PauseIcon v-else class="w-4 h-4 text-black" />
      </button>
      
      <div class="flex items-center space-x-1">
        <button 
          @click="nextSong"
          :disabled="!canPlayNext"
          class="p-1 rounded-full text-gray-400 hover:text-white transition-colors duration-200 disabled:opacity-50"
        >
          <ForwardIcon class="w-4 h-4" />
        </button>
        
        <button 
          @click="toggleRepeat"
          :class="[
            'p-1 rounded-full transition-colors duration-200 relative',
            repeat !== 'none' ? 'text-spotify-green' : 'text-gray-400'
          ]"
        >
          <ArrowPathIcon class="w-4 h-4" />
          <span v-if="repeat === 'one'" class="absolute -mt-1 -ml-1 text-xs">1</span>
        </button>
      </div>
      
      <div class="flex items-center space-x-1">
        <button 
          @click="$emit('toggle-lyrics')"
          class="p-1 rounded-full text-gray-400 hover:text-white transition-colors duration-200"
        >
          <DocumentTextIcon class="w-4 h-4" />
        </button>
        
        <button 
          @click="openAddToPlaylistModal"
          class="p-1 rounded-full text-gray-400 hover:text-white transition-colors duration-200"
          :disabled="!currentSong"
        >
          <PlusIcon class="w-4 h-4" />
        </button>
        
        <button 
          @click="toggleMute"
          class="p-1 rounded-full text-gray-400 hover:text-white transition-colors duration-200"
        >
          <SpeakerXMarkIcon v-if="isMuted" class="w-4 h-4" />
          <SpeakerWaveIcon v-else-if="volume > 0.5" class="w-4 h-4" />
          <Bars2Icon v-else class="w-4 h-4" />
        </button>
      </div>
    </div>
  </div>

  <!-- Desktop Layout -->
  <div class="h-24 bg-light-card dark:bg-spotify-dark border-t border-light-border dark:border-spotify-light hidden sm:flex items-center px-4">
    <!-- Current Song Info -->
    <div class="flex items-center w-80 min-w-0">
      <div v-if="currentSong" class="flex items-center min-w-0 flex-1">
        <div class="w-14 h-14 bg-light-border dark:bg-spotify-light rounded-md mr-3 flex items-center justify-center">
          <MusicalNoteIcon class="w-6 h-6 text-gray-400" />
        </div>
        <div class="flex-1 min-w-0">
          <p class="text-sm font-medium text-light-text-primary dark:text-white truncate">{{ currentSong.title }} (#{{ currentSong.id }})</p>
          <p class="text-xs text-light-text-secondary dark:text-gray-400 truncate">{{ $t('player.currentlyPlaying') }}</p>
        </div>
        <button 
          @click="toggleFavorite"
          class="ml-2 p-1 rounded hover:bg-spotify-light transition-colors duration-200"
        >
          <HeartIcon 
            :class="[
              'w-4 h-4',
              currentSong.isFavorite ? 'text-spotify-green fill-current' : 'text-gray-400'
            ]" 
          />
        </button>
      </div>
    </div>
    
    <!-- Player Controls -->
    <div class="flex-1 flex flex-col items-center px-4">
      <!-- Control Buttons -->
      <div class="flex items-center space-x-4 mb-2">
        <button 
          @click="toggleShuffle"
          :class="[
            'p-2 rounded-full transition-colors duration-200',
            shuffle ? 'text-spotify-green' : 'text-gray-400 hover:text-white'
          ]"
          :title="$t('player.shuffle')"
        >
          <ArrowsUpDownIcon class="w-4 h-4" />
        </button>
        
        <button 
          @click="previousSong"
          :disabled="!canPlayPrevious"
          class="p-2 rounded-full text-gray-400 hover:text-white transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
          :title="$t('player.previous')"
        >
          <BackwardIcon class="w-5 h-5" />
        </button>
        
        <button 
          @click="togglePlay"
          class="w-10 h-10 bg-white rounded-full flex items-center justify-center hover:scale-105 transition-transform duration-200"
          :title="isPlaying ? $t('player.pause') : $t('player.play')"
        >
          <PlayIcon v-if="!isPlaying" class="w-5 h-5 text-black ml-0.5" />
          <PauseIcon v-else class="w-5 h-5 text-black" />
        </button>
        
        <button 
          @click="nextSong"
          :disabled="!canPlayNext"
          class="p-2 rounded-full text-gray-400 hover:text-white transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
          :title="$t('player.next')"
        >
          <ForwardIcon class="w-5 h-5" />
        </button>
        
        <button 
          @click="toggleRepeat"
          :class="[
            'p-2 rounded-full transition-colors duration-200 relative',
            repeat !== 'none' ? 'text-spotify-green' : 'text-gray-400 hover:text-white'
          ]"
          :title="$t('player.repeat')"
        >
          <ArrowPathIcon class="w-4 h-4" />
          <span v-if="repeat === 'one'" class="absolute -mt-1 -ml-1 text-xs">1</span>
        </button>
      </div>
      
      <!-- Progress Bar -->
      <div class="flex items-center w-full max-w-md space-x-2">
        <span class="text-xs text-gray-400 w-10 text-right">
          {{ formattedCurrentTime }}
        </span>
        <div class="flex-1">
          <ProgressBar 
            :progress="progress" 
            @seek="handleSeek"
          />
        </div>
        <span class="text-xs text-gray-400 w-10">
          {{ formattedDuration }}
        </span>
      </div>
    </div>
    
    <!-- Volume Controls & Actions -->
    <div class="flex items-center w-80 justify-end">
      <!-- Always visible lyrics button -->
      <button 
        @click="$emit('toggle-lyrics')"
        class="p-2 rounded-full text-gray-400 hover:text-white transition-colors duration-200 mr-2"
        :title="$t('player.toggleLyrics')"
      >
        <DocumentTextIcon class="w-5 h-5" />
      </button>
      
      <!-- Add to playlist button -->
      <button 
        @click="openAddToPlaylistModal"
        class="p-2 rounded-full text-gray-400 hover:text-white transition-colors duration-200 mr-2"
        :title="$t('playlist.addToPlaylist')"
        :disabled="!currentSong"
      >
        <PlusIcon class="w-5 h-5" />
      </button>
      
      <button 
        @click="toggleMute"
        class="p-2 rounded-full text-gray-400 hover:text-white transition-colors duration-200 mr-2"
        :title="isMuted ? $t('player.unmute') : $t('player.mute')"
      >
        <SpeakerXMarkIcon v-if="isMuted" class="w-5 h-5" />
        <SpeakerWaveIcon v-else-if="volume > 0.5" class="w-5 h-5" />
        <Bars2Icon v-else class="w-5 h-5" />
      </button>
      
      <div class="w-24">
        <VolumeControl 
          :volume="volume" 
          :muted="isMuted"
          @volume-change="setVolume"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { 
  PlayIcon, 
  PauseIcon, 
  ForwardIcon, 
  BackwardIcon,
  ArrowsUpDownIcon,
  ArrowPathIcon,
  SpeakerWaveIcon,
  SpeakerXMarkIcon,
  Bars2Icon,
  MusicalNoteIcon,
  HeartIcon,
  DocumentTextIcon,
  PlusIcon
} from '@heroicons/vue/24/outline'
import { usePlayerStore } from '@/stores/player'
import { useSongsStore } from '@/stores/songs'
import { usePlaylistsStore } from '@/stores/playlists'
import ProgressBar from './ProgressBar.vue'
import VolumeControl from './VolumeControl.vue'

// Define emits
const emit = defineEmits<{
  'toggle-lyrics': []
  'add-to-playlist': [song: any]
}>()

const playerStore = usePlayerStore()
const songsStore = useSongsStore()
const playlistsStore = usePlaylistsStore()

// Computed properties
const currentSong = computed(() => playerStore.currentSong)
const isPlaying = computed(() => playerStore.isPlaying)
const volume = computed(() => playerStore.volume)
const isMuted = computed(() => playerStore.isMuted)
const progress = computed(() => playerStore.progress)
const formattedCurrentTime = computed(() => playerStore.formattedCurrentTime)
const formattedDuration = computed(() => playerStore.formattedDuration)
const shuffle = computed(() => playerStore.shuffle)
const repeat = computed(() => playerStore.repeat)
const canPlayNext = computed(() => playerStore.canPlayNext)
const canPlayPrevious = computed(() => playerStore.canPlayPrevious)

// Methods
function togglePlay() {
  playerStore.togglePlay()
}

async function nextSong() {
  await playerStore.nextSong()
}

async function previousSong() {
  await playerStore.previousSong()
}

function toggleShuffle() {
  playerStore.toggleShuffle()
}

function toggleRepeat() {
  playerStore.toggleRepeat()
}

function toggleMute() {
  playerStore.toggleMute()
}

function setVolume(newVolume: number) {
  playerStore.setVolume(newVolume)
}

function handleSeek(time: number) {
  playerStore.seek(time)
}

function toggleFavorite() {
  if (currentSong.value) {
    songsStore.toggleFavorite(currentSong.value.id)
  }
}

function openAddToPlaylistModal() {
  if (currentSong.value) {
    emit('add-to-playlist', currentSong.value)
  }
}
</script>