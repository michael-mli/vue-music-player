import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import axios from 'axios'
import config from '@/config'
import type { AuthUser } from '@/types'

const TOKEN_KEY = 'auth_token' // matches the Bearer interceptor in services/api.ts

// Minimal typing for the Google Identity Services global.
interface GoogleId {
  accounts: {
    id: {
      initialize: (opts: Record<string, unknown>) => void
      renderButton: (el: HTMLElement, opts: Record<string, unknown>) => void
      prompt: () => void
      disableAutoSelect: () => void
    }
  }
}
declare global {
  interface Window { google?: GoogleId }
}

let gisLoading: Promise<void> | null = null
function loadGis(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve()
  if (gisLoading) return gisLoading
  gisLoading = new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = 'https://accounts.google.com/gsi/client'
    s.async = true
    s.defer = true
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('failed to load Google Identity Services'))
    document.head.appendChild(s)
  })
  return gisLoading
}

export const useAuthStore = defineStore('auth', () => {
  const user = ref<AuthUser | null>(null)
  const token = ref<string | null>(localStorage.getItem(TOKEN_KEY))
  const ready = ref(false) // becomes true once the initial /me check settles

  const isAuthenticated = computed(() => !!user.value)
  /** Registered = attached to a Google account. Guests are identities too, just unregistered. */
  const isRegistered = computed(() => user.value?.kind === 'google')
  const isAdmin = computed(() => user.value?.role === 'admin')
  const loginEnabled = computed(() => !!config.googleClientId)
  /** What the UI should call this user. */
  const displayName = computed(() => user.value?.name || user.value?.username || user.value?.email || '')

  function setToken(t: string | null) {
    token.value = t
    if (t) localStorage.setItem(TOKEN_KEY, t)
    else localStorage.removeItem(TOKEN_KEY)
  }

  /**
   * Exchange a Google ID-token credential for a session. The current (guest) token rides
   * along so the server upgrades that identity in place instead of creating a new one.
   */
  async function loginWithGoogle(credential: string) {
    const res = await axios.post(`${config.apiBaseUrl}/auth/google`, { credential }, {
      headers: token.value ? { Authorization: `Bearer ${token.value}` } : {},
    })
    const data = res.data?.data
    if (!data?.token) throw new Error('login failed')
    setToken(data.token)
    user.value = data.user
    return data.user as AuthUser
  }

  /** Restore session from a stored token (called at app start). */
  async function fetchMe() {
    if (!token.value) { ready.value = true; return }
    try {
      const res = await axios.get(`${config.apiBaseUrl}/auth/me`, {
        headers: { Authorization: `Bearer ${token.value}` },
      })
      user.value = res.data?.data ?? null
    } catch {
      setToken(null)
      user.value = null
    } finally {
      ready.value = true
    }
  }

  /** Ask the server for a system-assigned guest identity and store it. */
  async function createGuest() {
    try {
      const res = await axios.post(`${config.apiBaseUrl}/auth/guest`, {}, {
        headers: token.value ? { Authorization: `Bearer ${token.value}` } : {},
      })
      const data = res.data?.data
      if (data?.token) {
        setToken(data.token)
        user.value = data.user
      }
    } catch {
      // Backend unreachable — the app still works without an identity.
    }
  }

  /** App-start identity bootstrap: restore a session, else become a fresh guest. */
  async function ensureIdentity() {
    await fetchMe()
    if (!user.value) await createGuest()
  }

  /** Update own profile fields (username / display name / bio / avatar data-URL). */
  async function updateProfile(fields: Partial<Pick<AuthUser, 'username' | 'name' | 'bio' | 'avatar'>>) {
    const res = await axios.patch(`${config.apiBaseUrl}/profile`, fields, {
      headers: { Authorization: `Bearer ${token.value}` },
    })
    user.value = res.data?.data ?? user.value
    return user.value as AuthUser
  }

  /** Sign out of the registered account; the device gets a fresh guest identity. */
  async function logout() {
    setToken(null)
    user.value = null
    try { window.google?.accounts.id.disableAutoSelect() } catch { /* noop */ }
    await createGuest()
  }

  /**
   * Initialize Google Identity Services and render a sign-in button into `el`.
   * The credential callback logs the user in.
   */
  async function renderGoogleButton(el: HTMLElement, onDone?: () => void) {
    if (!config.googleClientId) return
    await loadGis()
    window.google!.accounts.id.initialize({
      client_id: config.googleClientId,
      callback: async (resp: { credential: string }) => {
        try {
          await loginWithGoogle(resp.credential)
          onDone?.()
        } catch (e) {
          console.error('Google login failed', e)
        }
      },
    })
    window.google!.accounts.id.renderButton(el, { theme: 'filled_black', size: 'large', shape: 'pill' })
  }

  return {
    user, token, ready,
    isAuthenticated, isRegistered, isAdmin, loginEnabled, displayName,
    loginWithGoogle, fetchMe, ensureIdentity, createGuest, updateProfile, logout, renderGoogleButton,
  }
})
