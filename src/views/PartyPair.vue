<template>
  <div class="party-page h-full overflow-y-auto p-5 sm:p-8">
    <form class="mx-auto max-w-lg rounded-2xl border border-white/10 bg-white/5 p-6" @submit.prevent="redeem">
      <RouterLink to="/party" class="text-sm text-spotify-green">← {{ $t('party.back') }}</RouterLink>
      <h1 class="mt-4 text-3xl font-bold">{{ $t('party.pairDevice') }}</h1>
      <p class="mt-2 text-sm text-gray-400">{{ $t('party.pairPageHint') }}</p>
      <label class="mt-6 block text-sm" for="party-pair-code">{{ $t('party.pairingCode') }}</label>
      <input id="party-pair-code" v-model="code" required maxlength="8" autocomplete="one-time-code" autocapitalize="characters"
        class="mt-2 w-full rounded-lg border border-white/20 bg-black/25 px-3 py-2 uppercase tracking-widest text-white" />
      <p v-if="error || featureError" role="alert" class="mt-4 text-sm text-red-300">{{ error || featureError }}</p>
      <button type="submit" :disabled="!roomsAvailable || busy || code.trim().length !== 8"
        class="mt-6 rounded-full bg-spotify-green px-5 py-2 font-semibold text-black disabled:opacity-50">
        {{ busy ? $t('party.working') : $t('party.connectDevice') }}
      </button>
    </form>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { partyErrorMessage } from '@/services/partyErrorMessage'
import { usePartyFeatures } from '@/composables/usePartyFeatures'
import { useRouter } from 'vue-router'
import { partyApi } from '@/services/partyApi'
import { savePartyDevice } from '@/services/partyDevice'

const router = useRouter()
const { t } = useI18n()
const code = ref('')
const error = ref('')
const busy = ref(false)
const { roomsAvailable, featureError, loadFeatures } = usePartyFeatures()

onMounted(async () => {
  const url = new URL(window.location.href)
  const pair = new URLSearchParams(url.hash.slice(1)).get('pair') || url.searchParams.get('code') || url.searchParams.get('pair')
  if (pair) {
    code.value = pair.toUpperCase()
    url.hash = ''; url.searchParams.delete('code'); url.searchParams.delete('pair')
    window.history.replaceState(window.history.state, '', url.pathname + url.search)
  }
  await loadFeatures()
})

async function redeem() {
  if (!roomsAvailable.value || busy.value) return
  busy.value = true
  error.value = ''
  try {
    const grant = await partyApi.redeemPairing(code.value.trim().toUpperCase())
    savePartyDevice(grant)
    await router.replace(`/party/${grant.roomId}${grant.scope === 'display' ? '/stage' : ''}`)
  } catch (reason) {
    error.value = partyErrorMessage(reason, t)
  } finally {
    busy.value = false
  }
}
</script>
