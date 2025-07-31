<template>
  <!-- Mobile Layout -->
  <div class="fixed bottom-0 left-0 right-0 h-28 bg-light-card dark:bg-spotify-dark border-t border-light-border dark:border-spotify-light sm:hidden z-40">
    <!-- Current Song Info - Mobile -->
    <div v-if="currentSong" class="flex items-center px-2 py-1.5 border-b border-light-border dark:border-spotify-light h-12">
      <div class="w-8 h-8 bg-light-border dark:bg-spotify-light rounded mr-2 flex items-center justify-center">
        <MusicalNoteIcon class="w-4 h-4 text-gray-400" />
      </div>
      <div class="flex-1 min-w-0">
        <p class="text-xs font-medium text-light-text-primary dark:text-white break-words">{{ currentSong.title }} (#{{ currentSong.id }})</p>
        <p class="text-xs text-light-text-secondary dark:text-gray-400 break-words">{{ $t('player.currentlyPlaying') }}</p>
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
          @click="shareSong"
          class="p-1 rounded-full text-gray-400 hover:text-white transition-colors duration-200"
          :disabled="!currentSong"
        >
          <ShareIcon class="w-4 h-4" />
        </button>
        
        <div class="relative sleep-timer-container">
          <button 
            @click="showSleepTimerMenu = !showSleepTimerMenu"
            :class="[
              'p-1 rounded-full transition-colors duration-200 relative',
              isSleepTimerActive ? 'text-spotify-green' : 'text-gray-400 hover:text-white'
            ]"
            :title="$t('player.sleepTimer')"
          >
            <ClockIcon class="w-4 h-4" />
            <span v-if="isSleepTimerActive" class="absolute -top-1 -right-1 w-2 h-2 bg-spotify-green rounded-full"></span>
          </button>
          
          <!-- Sleep Timer Menu -->
          <div 
            v-if="showSleepTimerMenu"
            class="absolute bottom-full right-0 mb-2 bg-light-card dark:bg-spotify-dark border border-light-border dark:border-spotify-light rounded-lg shadow-lg py-1 min-w-[120px] z-50"
          >
            <button 
              @click="setSleepTimer(0)"
              :class="[
                'w-full px-3 py-2 text-left text-sm hover:bg-light-surface dark:hover:bg-spotify-light transition-colors',
                sleepTimer === 0 ? 'text-spotify-green' : 'text-light-text-primary dark:text-white'
              ]"
            >
              {{ $t('player.sleepTimerOff') }}
            </button>
            <button 
              @click="setSleepTimer(30)"
              :class="[
                'w-full px-3 py-2 text-left text-sm hover:bg-light-surface dark:hover:bg-spotify-light transition-colors',
                sleepTimer === 30 ? 'text-spotify-green' : 'text-light-text-primary dark:text-white'
              ]"
            >
              {{ $t('player.sleepTimer30') }}
            </button>
            <button 
              @click="setSleepTimer(60)"
              :class="[
                'w-full px-3 py-2 text-left text-sm hover:bg-light-surface dark:hover:bg-spotify-light transition-colors',
                sleepTimer === 60 ? 'text-spotify-green' : 'text-light-text-primary dark:text-white'
              ]"
            >
              {{ $t('player.sleepTimer60') }}
            </button>
            <button 
              @click="setSleepTimer(90)"
              :class="[
                'w-full px-3 py-2 text-left text-sm hover:bg-light-surface dark:hover:bg-spotify-light transition-colors',
                sleepTimer === 90 ? 'text-spotify-green' : 'text-light-text-primary dark:text-white'
              ]"
            >
              {{ $t('player.sleepTimer90') }}
            </button>
            <button 
              @click="setSleepTimer(120)"
              :class="[
                'w-full px-3 py-2 text-left text-sm hover:bg-light-surface dark:hover:bg-spotify-light transition-colors',
                sleepTimer === 120 ? 'text-spotify-green' : 'text-light-text-primary dark:text-white'
              ]"
            >
              {{ $t('player.sleepTimer120') }}
            </button>
            <div v-if="isSleepTimerActive" class="border-t border-light-border dark:border-spotify-light mt-1 pt-1">
              <div class="px-3 py-2 text-xs text-spotify-green">
                {{ $t('player.sleepTimerActive', { time: formattedSleepTimer }) }}
              </div>
            </div>
          </div>
        </div>
        
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
          <p class="text-sm font-medium text-light-text-primary dark:text-white break-words">{{ currentSong.title }} (#{{ currentSong.id }})</p>
          <p class="text-xs text-light-text-secondary dark:text-gray-400 break-words">{{ $t('player.currentlyPlaying') }}</p>
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
      
      <!-- Share song button -->
      <button 
        @click="shareSong"
        class="p-2 rounded-full text-gray-400 hover:text-white transition-colors duration-200 mr-2"
        title="Share Song"
        :disabled="!currentSong"
      >
        <ShareIcon class="w-5 h-5" />
      </button>
      
      <!-- Sleep Timer (Desktop) -->
      <div class="relative mr-2 sleep-timer-container">
        <button 
          @click="showSleepTimerMenu = !showSleepTimerMenu"
          :class="[
            'p-2 rounded-full transition-colors duration-200 relative',
            isSleepTimerActive ? 'text-spotify-green' : 'text-gray-400 hover:text-white'
          ]"
          :title="$t('player.sleepTimer')"
        >
          <ClockIcon class="w-5 h-5" />
          <span v-if="isSleepTimerActive" class="absolute -top-1 -right-1 w-2 h-2 bg-spotify-green rounded-full"></span>
        </button>
        
        <!-- Sleep Timer Menu (Desktop) -->
        <div 
          v-if="showSleepTimerMenu"
          class="absolute bottom-full right-0 mb-2 bg-light-card dark:bg-spotify-dark border border-light-border dark:border-spotify-light rounded-lg shadow-lg py-1 min-w-[140px] z-50"
        >
          <button 
            @click="setSleepTimer(0)"
            :class="[
              'w-full px-4 py-2 text-left text-sm hover:bg-light-surface dark:hover:bg-spotify-light transition-colors',
              sleepTimer === 0 ? 'text-spotify-green' : 'text-light-text-primary dark:text-white'
            ]"
          >
            {{ $t('player.sleepTimerOff') }}
          </button>
          <button 
            @click="setSleepTimer(30)"
            :class="[
              'w-full px-4 py-2 text-left text-sm hover:bg-light-surface dark:hover:bg-spotify-light transition-colors',
              sleepTimer === 30 ? 'text-spotify-green' : 'text-light-text-primary dark:text-white'
            ]"
          >
            {{ $t('player.sleepTimer30') }}
          </button>
          <button 
            @click="setSleepTimer(60)"
            :class="[
              'w-full px-4 py-2 text-left text-sm hover:bg-light-surface dark:hover:bg-spotify-light transition-colors',
              sleepTimer === 60 ? 'text-spotify-green' : 'text-light-text-primary dark:text-white'
            ]"
          >
            {{ $t('player.sleepTimer60') }}
          </button>
          <button 
            @click="setSleepTimer(90)"
            :class="[
              'w-full px-4 py-2 text-left text-sm hover:bg-light-surface dark:hover:bg-spotify-light transition-colors',
              sleepTimer === 90 ? 'text-spotify-green' : 'text-light-text-primary dark:text-white'
            ]"
          >
            {{ $t('player.sleepTimer90') }}
          </button>
          <button 
            @click="setSleepTimer(120)"
            :class="[
              'w-full px-4 py-2 text-left text-sm hover:bg-light-surface dark:hover:bg-spotify-light transition-colors',
              sleepTimer === 120 ? 'text-spotify-green' : 'text-light-text-primary dark:text-white'
            ]"
          >
            {{ $t('player.sleepTimer120') }}
          </button>
          <div v-if="isSleepTimerActive" class="border-t border-light-border dark:border-spotify-light mt-1 pt-1">
            <div class="px-4 py-2 text-xs text-spotify-green">
              {{ $t('player.sleepTimerActive', { time: formattedSleepTimer }) }}
            </div>
          </div>
        </div>
      </div>
      
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
import { computed, ref, onMounted, onUnmounted } from 'vue'
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
  PlusIcon,
  ShareIcon,
  ClockIcon
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
const sleepTimer = computed(() => playerStore.sleepTimer)
const isSleepTimerActive = computed(() => playerStore.isSleepTimerActive)
const formattedSleepTimer = computed(() => playerStore.formattedSleepTimer)

// Sleep timer menu state
const showSleepTimerMenu = ref(false)

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

function setSleepTimer(minutes: number) {
  playerStore.setSleepTimer(minutes)
  showSleepTimerMenu.value = false
}

function openAddToPlaylistModal() {
  if (currentSong.value) {
    emit('add-to-playlist', currentSong.value)
  }
}

async function shareSong() {
  if (!currentSong.value) return
  
  const shareUrl = `${window.location.origin}/music/?song=${currentSong.value.id}`
  const shareText = `Check out this song: ${currentSong.value.title}`
  
  // Try to use Web Share API if available (mobile)
  if (navigator.share) {
    try {
      await navigator.share({
        title: currentSong.value.title,
        text: shareText,
        url: shareUrl
      })
      console.log('Song shared successfully')
    } catch (error) {
      // User cancelled or error occurred, fallback to clipboard
      if ((error as Error).name !== 'AbortError') {
        copyToClipboard(shareUrl)
      }
    }
  } else {
    // Fallback to clipboard
    copyToClipboard(shareUrl)
  }
}

function copyToClipboard(text: string) {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => {
      // Show a brief success message (you could add a toast notification here)
      console.log('Song URL copied to clipboard')
      alert('Song link copied to clipboard!')
    }).catch(() => {
      // Fallback for older browsers
      fallbackCopyToClipboard(text)
    })
  } else {
    fallbackCopyToClipboard(text)
  }
}

function fallbackCopyToClipboard(text: string) {
  const textArea = document.createElement('textarea')
  textArea.value = text
  textArea.style.position = 'fixed'
  textArea.style.left = '-999999px'
  textArea.style.top = '-999999px'
  document.body.appendChild(textArea)
  textArea.focus()
  textArea.select()
  
  try {
    document.execCommand('copy')
    console.log('Song URL copied to clipboard (fallback)')
    alert('Song link copied to clipboard!')
  } catch (err) {
    console.error('Failed to copy to clipboard:', err)
    alert(`Copy this link: ${text}`)
  }
  
  document.body.removeChild(textArea)
}

// Click outside handler to close sleep timer menu  
function handleClickOutside(event: Event) {
  const target = event.target as HTMLElement
  if (!target.closest('.sleep-timer-container')) {
    showSleepTimerMenu.value = false
  }
}

onMounted(() => {
  document.addEventListener('click', handleClickOutside)
})

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside)
})
</script>