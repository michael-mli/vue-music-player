import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import router from './router'
import App from './App.vue'
import './style.css'

// Import translations
import en from './locales/en.json'
import zh from './locales/zh.json'

// Create i18n instance
const i18n = createI18n({
  legacy: false,
  locale: localStorage.getItem('language') || 'zh',
  fallbackLocale: 'zh',
  messages: {
    en,
    zh
  }
})

const app = createApp(App)

app.use(createPinia())
app.use(router)
app.use(i18n)

// Initialize dark theme as default
const savedTheme = localStorage.getItem('theme')
if (!savedTheme) {
  localStorage.setItem('theme', 'dark')
  document.documentElement.classList.add('dark')
} else {
  document.documentElement.classList.toggle('dark', savedTheme === 'dark')
}

async function clearPreviousPartyCache() {
  // Older installed workers may have stored room responses. Remove those entries
  // before mounting a room page so an offline worker cannot replay old authority.
  if (!location.pathname.startsWith('/party') || !('caches' in window)) return
  for (const name of await caches.keys()) {
    const cache = await caches.open(name)
    for (const request of await cache.keys()) {
      const url = new URL(request.url)
      if (/^\/api\/ktv(?:\/|$)/.test(url.pathname) || url.searchParams.has('ktvAsset')) await cache.delete(request)
    }
  }
}

void clearPreviousPartyCache().catch(() => { /* Private storage may be unavailable. */ }).finally(() => app.mount('#app'))

// Register service worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    // A new URL per build bypasses stale CDN copies of the service worker.
    navigator.serviceWorker.register(`/sw.js?v=${encodeURIComponent(__APP_BUILD_TIME__)}`, { updateViaCache: 'none' })
      .then((registration) => {
        console.log('SW registered: ', registration)
        const announceWaiting = () => {
          if (navigator.serviceWorker.controller && registration.waiting) window.dispatchEvent(new Event('party:sw-update-available'))
        }
        const watchInstalling = () => registration.installing?.addEventListener('statechange', event => {
          if ((event.target as ServiceWorker).state === 'installed') announceWaiting()
        })
        registration.addEventListener('updatefound', watchInstalling)
        watchInstalling()
        announceWaiting()
      })
      .catch((registrationError) => {
        console.log('SW registration failed: ', registrationError)
      })
  })
}
