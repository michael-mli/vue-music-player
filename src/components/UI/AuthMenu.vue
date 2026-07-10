<template>
  <div class="auth-menu">
    <!-- Identity chip: guest or registered — click to manage profile -->
    <button
      v-if="auth.user"
      @click="showProfile = true"
      class="w-full flex items-center gap-2 text-left rounded-lg p-1 -m-1 hover:bg-light-border dark:hover:bg-spotify-light transition-colors duration-200"
      :title="$t('profile.title')"
    >
      <UserAvatar :user="auth.user" :size="32" />
      <div class="min-w-0 flex-1">
        <p class="text-sm font-medium text-light-text-primary dark:text-white truncate">
          {{ auth.displayName }}
          <span
            v-if="auth.isAdmin"
            class="ml-1 text-[9px] uppercase font-bold px-1 py-0.5 rounded bg-spotify-green/20 text-spotify-green align-middle"
          >admin</span>
          <span
            v-else-if="!auth.isRegistered"
            class="ml-1 text-[9px] uppercase font-bold px-1 py-0.5 rounded bg-white/10 text-gray-400 align-middle"
          >{{ $t('profile.guestBadge') }}</span>
        </p>
        <p class="text-xs text-light-text-secondary dark:text-gray-400 truncate">
          {{ auth.isRegistered ? auth.user.email : '@' + auth.user.username }}
        </p>
      </div>
    </button>

    <!-- Identity still bootstrapping (or backend unreachable) -->
    <p v-else class="text-xs text-light-text-secondary dark:text-gray-500 px-1">
      {{ $t('common.loading') }}
    </p>

    <ProfileModal v-if="showProfile" @close="showProfile = false" />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useAuthStore } from '@/stores/auth'
import UserAvatar from './UserAvatar.vue'
import ProfileModal from './ProfileModal.vue'

const auth = useAuthStore()
const showProfile = ref(false)

onMounted(async () => {
  // Restore a stored session, else become a system-assigned guest identity
  await auth.ensureIdentity()
})
</script>
