<template>
  <Teleport to="body">
    <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50" @click.self="$emit('close')">
      <div class="bg-spotify-dark rounded-lg p-6 w-[26rem] max-w-full mx-4 max-h-[90vh] overflow-y-auto spotify-scrollbar">
        <h2 class="text-xl font-bold text-white mb-4">{{ $t('profile.title') }}</h2>

        <!-- Avatar -->
        <div class="flex items-center gap-4 mb-5">
          <UserAvatar :user="previewUser" :size="72" />
          <div class="flex flex-col gap-2">
            <button
              @click="fileInput?.click()"
              class="px-3 py-1.5 rounded-full bg-white/10 text-white text-xs font-medium hover:bg-white/20"
            >{{ $t('profile.changeAvatar') }}</button>
            <button
              v-if="form.avatar"
              @click="form.avatar = ''"
              class="px-3 py-1.5 rounded-full text-gray-400 text-xs hover:text-white"
            >{{ $t('profile.removeAvatar') }}</button>
            <input ref="fileInput" type="file" accept="image/*" class="hidden" @change="onAvatarPicked" />
          </div>
        </div>

        <!-- Username -->
        <label class="block text-sm font-medium text-gray-300 mb-1">{{ $t('profile.username') }}</label>
        <input
          v-model="form.username"
          type="text"
          maxlength="20"
          class="w-full px-3 py-2 mb-1 bg-spotify-light text-white rounded border border-gray-600 focus:border-spotify-green focus:outline-none text-sm"
        />
        <p class="text-xs text-gray-500 mb-4">{{ $t('profile.usernameHint') }}</p>

        <!-- Display name -->
        <label class="block text-sm font-medium text-gray-300 mb-1">{{ $t('profile.displayName') }}</label>
        <input
          v-model="form.name"
          type="text"
          maxlength="60"
          class="w-full px-3 py-2 mb-4 bg-spotify-light text-white rounded border border-gray-600 focus:border-spotify-green focus:outline-none text-sm"
          :placeholder="$t('profile.displayNamePlaceholder')"
        />

        <!-- Bio -->
        <label class="block text-sm font-medium text-gray-300 mb-1">{{ $t('profile.bio') }}</label>
        <textarea
          v-model="form.bio"
          rows="3"
          maxlength="300"
          class="w-full px-3 py-2 mb-1 bg-spotify-light text-white rounded border border-gray-600 focus:border-spotify-green focus:outline-none text-sm resize-none"
          :placeholder="$t('profile.bioPlaceholder')"
        ></textarea>
        <p class="text-xs text-gray-500 text-right mb-4">{{ form.bio.length }}/300</p>

        <!-- Account status -->
        <div class="mb-4 p-3 rounded bg-black/30 border border-white/10">
          <template v-if="auth.isRegistered">
            <p class="text-xs text-gray-400">{{ $t('profile.registeredAs') }}</p>
            <p class="text-sm text-white truncate">{{ auth.user?.email }}</p>
          </template>
          <template v-else>
            <p class="text-xs text-gray-400 mb-2">{{ $t('profile.guestHint') }}</p>
            <div v-if="auth.loginEnabled" ref="gbtn"></div>
          </template>
        </div>

        <p v-if="error" class="text-sm text-red-400 mb-3">{{ error }}</p>
        <p v-if="saved" class="text-sm text-spotify-green mb-3">✓ {{ $t('profile.saved') }}</p>

        <div class="flex justify-between items-center">
          <button
            v-if="auth.isRegistered"
            @click="signOut"
            class="px-3 py-2 text-sm text-gray-400 hover:text-red-400"
          >{{ $t('auth.signOut') }}</button>
          <span v-else></span>
          <div class="flex items-center gap-3">
            <button @click="$emit('close')" class="px-4 py-2 text-gray-400 hover:text-white text-sm">
              {{ $t('common.cancel') }}
            </button>
            <button @click="save" :disabled="saving" class="btn-primary disabled:opacity-50">
              {{ saving ? $t('common.loading') : $t('common.save') }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { useAuthStore } from '@/stores/auth'
import UserAvatar from './UserAvatar.vue'
import type { AuthUser } from '@/types'

const emit = defineEmits<{ close: [] }>()
const auth = useAuthStore()

const form = reactive({
  username: auth.user?.username || '',
  name: auth.user?.name || '',
  bio: auth.user?.bio || '',
  avatar: auth.user?.avatar || '',
})
const error = ref('')
const saved = ref(false)
const saving = ref(false)
const fileInput = ref<HTMLInputElement>()
const gbtn = ref<HTMLElement>()

// Live preview of the avatar block while editing
const previewUser = computed<AuthUser | null>(() =>
  auth.user ? { ...auth.user, ...form, avatar: form.avatar || null } : null
)

onMounted(async () => {
  if (!auth.isRegistered && auth.loginEnabled && gbtn.value) {
    await auth.renderGoogleButton(gbtn.value, () => {
      // Registration upgraded this identity — refresh form fields from the new user
      form.username = auth.user?.username || form.username
      form.name = auth.user?.name || form.name
    })
  }
})

// Downscale the picked image to a small square data URL (fits the 150KB server cap)
function onAvatarPicked(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  const img = new Image()
  const url = URL.createObjectURL(file)
  img.onload = () => {
    const SIZE = 128
    const canvas = document.createElement('canvas')
    canvas.width = SIZE
    canvas.height = SIZE
    const ctx = canvas.getContext('2d')!
    // center-crop to square
    const side = Math.min(img.width, img.height)
    ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, SIZE, SIZE)
    form.avatar = canvas.toDataURL('image/jpeg', 0.85)
    URL.revokeObjectURL(url)
  }
  img.onerror = () => URL.revokeObjectURL(url)
  img.src = url
}

async function save() {
  error.value = ''
  saved.value = false
  saving.value = true
  try {
    await auth.updateProfile({
      username: form.username.trim(),
      name: form.name.trim(),
      bio: form.bio.trim(),
      avatar: form.avatar,
    })
    saved.value = true
    setTimeout(() => emit('close'), 900)
  } catch (e) {
    error.value = (e as { response?: { data?: { message?: string } } }).response?.data?.message
      || (e as Error).message || 'failed to save'
  } finally {
    saving.value = false
  }
}

async function signOut() {
  await auth.logout() // device continues as a fresh guest
  emit('close')
}
</script>
