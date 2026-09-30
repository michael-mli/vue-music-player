<template>
  <div class="h-full overflow-y-auto p-5 sm:p-8">
    <form class="mx-auto max-w-lg rounded-2xl border border-white/10 bg-white/5 p-6" @submit.prevent="joinRoom">
      <RouterLink to="/party" class="text-sm text-spotify-green">← {{ $t('party.back') }}</RouterLink>
      <h1 class="mt-4 text-3xl font-bold">{{ $t('party.joinRoom') }}</h1>
      <p class="mt-2 text-sm text-gray-400">{{ $t('party.noAccountNeeded') }}</p>
      <label class="mt-6 block text-sm" for="party-code">{{ $t('party.invitationCode') }}</label>
      <input id="party-code" v-model="code" required maxlength="8" autocomplete="off" autocapitalize="characters"
        class="mt-2 w-full rounded-lg border border-white/20 bg-black/25 px-3 py-2 uppercase tracking-widest text-white" />
      <label class="mt-5 block text-sm" for="party-guest-name">{{ $t('party.yourName') }}</label>
      <input id="party-guest-name" v-model="displayName" required maxlength="40" autocomplete="nickname"
        class="mt-2 w-full rounded-lg border border-white/20 bg-black/25 px-3 py-2 text-white" />
      <p v-if="error" role="alert" class="mt-4 text-sm text-red-300">{{ error }}</p>
      <button type="submit" :disabled="busy || code.trim().length !== 8 || !displayName.trim()"
        class="mt-6 rounded-full bg-spotify-green px-5 py-2 font-semibold text-black disabled:opacity-50">
        {{ busy ? $t('party.working') : $t('party.joinRoom') }}
      </button>
    </form>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { partyApi } from '@/services/partyApi'

const router = useRouter()
const auth = useAuthStore()
const code = ref('')
const displayName = ref('')
const error = ref('')
const busy = ref(false)

onMounted(async () => {
  const invite = new URLSearchParams(window.location.hash.slice(1)).get('invite')
  if (invite) {
    code.value = invite.toUpperCase()
    window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search)
  }
  await auth.ensureIdentity()
  if (auth.isRegistered) displayName.value = auth.displayName
})

async function joinRoom() {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    const result = await partyApi.join(code.value, displayName.value)
    await router.push(`/party/${result.room.id}`)
  } catch (reason) {
    error.value = String((reason as Error).message)
  } finally {
    busy.value = false
  }
}
</script>
