<template>
  <div class="party-page h-full overflow-y-auto p-5 sm:p-8">
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
      <p v-if="checking" role="status" class="mt-4 text-sm text-gray-300">{{ $t('party.checkingInvitation') }}</p>
      <p v-if="error" role="alert" class="mt-4 text-sm text-red-300">{{ error }}</p>
      <button type="submit" :disabled="busy || checking || code.trim().length !== 8 || !displayName.trim()"
        class="mt-6 rounded-full bg-spotify-green px-5 py-2 font-semibold text-black disabled:opacity-50">
        {{ busy ? $t('party.working') : $t('party.joinRoom') }}
      </button>
    </form>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { partyErrorMessage } from '@/services/partyErrorMessage'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { partyApi } from '@/services/partyApi'

const router = useRouter()
const { t } = useI18n()
const auth = useAuthStore()
const code = ref('')
const displayName = ref('')
const error = ref('')
const busy = ref(false)
const checking = ref(false)
let mounted = false, alive = true, lookup = 0, timer: ReturnType<typeof setTimeout> | undefined

async function resolveInvitation() {
  const current = ++lookup, invitation = code.value.trim().toUpperCase()
  if (invitation.length !== 8) { checking.value = false; return }
  checking.value = true
  error.value = ''
  try {
    const result = await partyApi.resolveInvitation(invitation)
    if (current !== lookup) return
    if (result.membership) await router.replace(`/party/${result.membership.room.id}`)
    else {
      await nextTick()
      document.getElementById('party-guest-name')?.focus()
    }
  } catch (reason) {
    if (current === lookup) error.value = partyErrorMessage(reason, t)
  } finally { if (current === lookup) checking.value = false }
}

watch(code, () => {
  if (!mounted) return
  ++lookup
  clearTimeout(timer)
  error.value = ''
  checking.value = code.value.trim().length === 8
  if (checking.value) timer = setTimeout(() => { void resolveInvitation() }, 300)
})
onBeforeUnmount(() => { alive = false; mounted = false; ++lookup; clearTimeout(timer) })

onMounted(async () => {
  const url = new URL(window.location.href)
  const invite = new URLSearchParams(url.hash.slice(1)).get('invite') || url.searchParams.get('code') || url.searchParams.get('invite')
  if (invite) {
    code.value = invite.toUpperCase()
    url.hash = ''; url.searchParams.delete('code'); url.searchParams.delete('invite')
    window.history.replaceState(window.history.state, '', url.pathname + url.search)
  }
  await auth.ensureIdentity()
  if (!alive) return
  if (auth.isRegistered) displayName.value = auth.displayName
  mounted = true
  if (invite) await resolveInvitation()
})

async function joinRoom() {
  if (busy.value || checking.value) return
  busy.value = true
  error.value = ''
  try {
    const result = await partyApi.join(code.value, displayName.value)
    await router.push(`/party/${result.room.id}`)
  } catch (reason) {
    error.value = partyErrorMessage(reason, t)
  } finally {
    busy.value = false
  }
}
</script>
