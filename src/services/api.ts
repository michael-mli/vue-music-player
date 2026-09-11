import axios from 'axios'
import type { APIResponse } from '@/types'
import config from '@/config'
import { useAuthStore } from '@/stores/auth'

const api = axios.create({
  baseURL: config.apiBaseUrl,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json'
  }
})

// Request interceptor
api.interceptors.request.use(
  (config) => {
    // Add auth token if available
    const token = localStorage.getItem('auth_token')
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  },
  (error) => {
    return Promise.reject(error)
  }
)

// Response interceptor
api.interceptors.response.use(
  (response) => {
    return response.data
  },
  (error) => {
    if (error.response?.status === 401) {
      // The stored token is no longer valid. Invalidate it through the auth
      // store (clears token + user together) instead of wiping localStorage
      // directly or redirecting to a non-existent /login page.
      useAuthStore().setToken(null)
    }
    return Promise.reject(error)
  }
)

export default api