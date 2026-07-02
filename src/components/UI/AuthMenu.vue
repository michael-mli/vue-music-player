<template>
  <div class="auth-menu">
    <!-- Signed in -->
    <div v-if="auth.isAuthenticated" class="flex items-center gap-2">
      <img
        v-if="auth.user?.picture"
        :src="auth.user.picture"
        :alt="auth.user?.name"
        class="w-8 h-8 rounded-full flex-shrink-0"
        referrerpolicy="no-referrer"
      />
      <div class="min-w-0 flex-1">
        <p class="text-sm font-medium text-light-text-primary dark:text-white truncate">
          {{ auth.user?.name || auth.user?.email }}
          <span
            v-if="auth.isAdmin"
            class="ml-1 text-[9px] uppercase font-bold px-1 py-0.5 rounded bg-spotify-green/20 text-spotify-green align-middle"
          >admin</span>
        </p>
        <button
          @click="auth.logout()"
          class="text-xs text-light-text-secondary dark:text-gray-400 hover:text-light-text-primary dark:hover:text-white"
        >{{ $t('auth.signOut') }}</button>
      </div>
    </div>

    <!-- Signed out -->
    <div v-else-if="auth.loginEnabled">
      <!-- Google Identity Services renders its button into this element -->
      <div ref="gbtn"></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const gbtn = ref<HTMLElement>()

async function mountButton() {
  if (!auth.isAuthenticated && auth.loginEnabled && gbtn.value) {
    await auth.renderGoogleButton(gbtn.value)
  }
}

onMounted(async () => {
  await auth.fetchMe() // restore session if a token is stored
  await mountButton()
})

// Re-render the Google button if the user signs out.
watch(() => auth.isAuthenticated, async (v) => {
  if (!v) await mountButton()
})
</script>
