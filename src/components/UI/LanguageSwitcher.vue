<template>
  <div class="relative">
    <button 
      @click="showDropdown = !showDropdown"
      class="p-2 rounded hover:bg-light-border dark:hover:bg-spotify-light transition-colors duration-200"
    >
      <GlobeAltIcon class="w-4 h-4 text-light-text-secondary dark:text-gray-400" />
    </button>
    
    <div 
      v-if="showDropdown"
      class="absolute bottom-full right-0 mb-2 w-32 bg-light-surface dark:bg-spotify-dark rounded-lg shadow-lg border border-light-border dark:border-spotify-light overflow-hidden"
    >
      <button 
        v-for="lang in languages" 
        :key="lang.code"
        @click="changeLanguage(lang.code)"
        class="w-full px-3 py-2 text-left text-sm hover:bg-light-border dark:hover:bg-spotify-light transition-colors duration-200"
        :class="{ 'text-spotify-green': currentLocale === lang.code, 'text-light-text-primary dark:text-white': currentLocale !== lang.code }"
      >
        {{ lang.name }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { GlobeAltIcon } from '@heroicons/vue/24/outline'

const { locale } = useI18n()
const showDropdown = ref(false)

const languages = [
  { code: 'en', name: 'English' },
  { code: 'zh', name: '中文' }
]

const currentLocale = computed(() => locale.value)

function changeLanguage(langCode: string) {
  locale.value = langCode
  localStorage.setItem('language', langCode)
  showDropdown.value = false
}

function handleClickOutside(event: MouseEvent) {
  const target = event.target as HTMLElement
  if (!target.closest('.relative')) {
    showDropdown.value = false
  }
}

onMounted(() => {
  document.addEventListener('click', handleClickOutside)
})

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside)
})
</script>