<template>
  <header class="h-16 flex items-center justify-between px-6 bg-gradient-to-b from-light-bg/50 dark:from-black/50 to-transparent">
    <!-- Navigation Buttons -->
    <div class="flex items-center space-x-2">
      <!-- Mobile menu button -->
      <button 
        @click="$emit('toggle-sidebar')"
        class="md:hidden w-8 h-8 bg-black/70 rounded-full flex items-center justify-center hover:bg-black/80 transition-colors duration-200 mr-2"
      >
        <Bars3Icon class="w-5 h-5 text-white" />
      </button>
      
      <button 
        @click="$router.back()"
        class="hidden md:flex w-8 h-8 bg-black/70 rounded-full items-center justify-center hover:bg-black/80 transition-colors duration-200"
      >
        <ChevronLeftIcon class="w-5 h-5 text-white" />
      </button>
      <button 
        @click="$router.forward()"
        class="hidden md:flex w-8 h-8 bg-black/70 rounded-full items-center justify-center hover:bg-black/80 transition-colors duration-200"
      >
        <ChevronRightIcon class="w-5 h-5 text-white" />
      </button>
    </div>
    
    <!-- Page Title -->
    <div class="flex-1 text-center">
      <h1 class="text-2xl font-bold text-light-text-primary dark:text-white">{{ pageTitle }}</h1>
    </div>
    
    <!-- User Actions -->
    <div class="flex items-center space-x-3">
      <!-- Install App Button -->
      <button 
        v-if="canInstall"
        @click="installApp"
        class="px-4 py-2 bg-spotify-green text-white text-sm font-medium rounded-full hover:bg-green-500 transition-colors duration-200"
      >
        {{ $t('pwa.install') }}
      </button>
      
      <!-- Build version — click to copy full timestamp -->
      <span
        :title="buildTime"
        @click="copyBuildTime"
        class="hidden sm:block text-[10px] tabular-nums text-gray-500 hover:text-gray-300 cursor-pointer select-none leading-tight text-right"
      >{{ buildLabel }}</span>

      <!-- Theme Toggle -->
      <button
        @click="toggleTheme"
        class="p-2 rounded-full text-gray-400 hover:text-white transition-colors duration-200"
      >
        <SunIcon v-if="isDark" class="w-5 h-5" />
        <MoonIcon v-else class="w-5 h-5" />
      </button>
    </div>
  </header>
</template>

<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'

// Build timestamp injected by Vite at build time — changes with every build
const buildTime = __APP_BUILD_TIME__
const buildDate = new Date(buildTime)
// e.g. "Feb 21 14:32" in local time
const buildLabel = buildDate.toLocaleDateString('en', { month: 'short', day: 'numeric' })
  + ' ' + buildDate.toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit', hour12: false })

async function copyBuildTime() {
  try {
    await navigator.clipboard.writeText(buildTime)
  } catch {
    // silently ignore — tooltip already shows full time
  }
}
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { 
  ChevronLeftIcon, 
  ChevronRightIcon,
  SunIcon,
  MoonIcon,
  Bars3Icon
} from '@heroicons/vue/24/outline'

// Define emits
defineEmits<{
  'toggle-sidebar': []
}>()

const route = useRoute()
const { t } = useI18n()

const isDark = ref(true)
const canInstall = ref(false)
const deferredPrompt = ref<any>(null)

const pageTitle = computed(() => {
  switch (route.name) {
    case 'Home':
      return t('navigation.home')
    case 'Search':
      return t('navigation.search')
    case 'Library':
      return t('navigation.library')
    case 'Playlist':
      return t('navigation.playlists') // Will be replaced with actual playlist name
    default:
      return t('app.title')
  }
})

onMounted(() => {
  // Initialize theme from localStorage
  const savedTheme = localStorage.getItem('theme')
  if (savedTheme) {
    isDark.value = savedTheme === 'dark'
  } else {
    // Default to dark theme
    isDark.value = true
  }
  document.documentElement.classList.toggle('dark', isDark.value)
  
  // Listen for PWA install prompt
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferredPrompt.value = e
    canInstall.value = true
  })
})

function toggleTheme() {
  isDark.value = !isDark.value
  document.documentElement.classList.toggle('dark', isDark.value)
  localStorage.setItem('theme', isDark.value ? 'dark' : 'light')
}

function installApp() {
  if (deferredPrompt.value) {
    deferredPrompt.value.prompt()
    deferredPrompt.value.userChoice.then((choiceResult: any) => {
      if (choiceResult.outcome === 'accepted') {
        canInstall.value = false
      }
      deferredPrompt.value = null
    })
  }
}
</script>