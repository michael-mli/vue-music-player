<template>
  <div class="h-full overflow-y-auto p-5 sm:p-8">
    <div class="mx-auto max-w-4xl space-y-7">
      <div>
        <p class="text-sm font-semibold uppercase tracking-widest text-spotify-green">{{ $t('party.eyebrow') }}</p>
        <h1 class="mt-2 text-3xl font-bold">{{ $t('party.title') }}</h1>
        <p class="mt-2 text-sm text-gray-400">{{ $t('party.intro') }}</p>
      </div>

      <div class="grid gap-5 md:grid-cols-2">
        <form class="rounded-2xl border border-white/10 bg-white/5 p-5" @submit.prevent="createRoom">
          <h2 class="text-xl font-semibold">{{ $t('party.createRoom') }}</h2>
          <label class="mt-5 block text-sm" for="party-room-name">{{ $t('party.roomName') }}</label>
          <input id="party-room-name" v-model="roomName" maxlength="80" required
            class="mt-2 w-full rounded-lg border border-white/20 bg-black/25 px-3 py-2 text-white"
            :placeholder="$t('party.roomNameHint')" />
          <label class="mt-4 block text-sm" for="party-host-name">{{ $t('party.yourName') }}</label>
          <input id="party-host-name" v-model="displayName" maxlength="40" required
            class="mt-2 w-full rounded-lg border border-white/20 bg-black/25 px-3 py-2 text-white" />
          <label class="mt-4 flex items-center gap-3 text-sm">
            <input v-model="approvalRequired" type="checkbox" class="accent-green-500" />
            {{ $t('party.requireApproval') }}
          </label>
          <button type="submit" :disabled="busy || !roomName.trim() || !displayName.trim()"
            class="mt-6 rounded-full bg-spotify-green px-5 py-2 font-semibold text-black disabled:opacity-50">
            {{ busy ? $t('party.working') : $t('party.createRoom') }}
          </button>
        </form>

        <div class="rounded-2xl border border-white/10 bg-white/5 p-5">
          <h2 class="text-xl font-semibold">{{ $t('party.joinRoom') }}</h2>
          <p class="mt-3 text-sm text-gray-400">{{ $t('party.joinHint') }}</p>
          <RouterLink to="/party/join" class="mt-6 inline-block rounded-full border border-white/30 px-5 py-2 font-semibold hover:bg-white/10">
            {{ $t('party.enterCode') }}
          </RouterLink>
        </div>
      </div>

      <p v-if="error" role="alert" class="rounded-lg bg-red-500/10 p-3 text-sm text-red-300">{{ error }}</p>

      <section v-if="rooms.length" class="space-y-3">
        <h2 class="text-xl font-semibold">{{ $t('party.yourRooms') }}</h2>
        <RouterLink v-for="room in rooms" :key="room.id" :to="`/party/${room.id}`"
          class="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 p-4 hover:bg-white/10">
          <span>{{ room.name }}</span>
          <span class="text-sm text-gray-400">{{ room.admission === 'pending' ? $t('party.waiting') : $t('party.openRoom') }}</span>
        </RouterLink>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { partyApi, type PartyRoomSummary } from '@/services/partyApi'

const router = useRouter()
const auth = useAuthStore()
const roomName = ref('')
const displayName = ref('')
const approvalRequired = ref(true)
const rooms = ref<PartyRoomSummary[]>([])
const busy = ref(false)
const error = ref('')

onMounted(async () => {
  await auth.ensureIdentity()
  if (auth.isRegistered) displayName.value = auth.displayName
  try { rooms.value = await partyApi.list() } catch (reason) { error.value = String((reason as Error).message) }
})

async function createRoom() {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    const result = await partyApi.create(roomName.value, displayName.value, approvalRequired.value)
    await router.push(`/party/${result.room.id}`)
  } catch (reason) {
    error.value = String((reason as Error).message)
  } finally {
    busy.value = false
  }
}
</script>
