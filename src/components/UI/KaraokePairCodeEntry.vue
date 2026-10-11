<template>
  <section class="mb-6 rounded-xl border border-light-border dark:border-white/10 bg-light-card dark:bg-white/5 p-4" :aria-label="$t('karaoke.guide.enterCode')">
    <form class="flex flex-wrap items-end gap-3" @submit.prevent="join">
      <label class="min-w-0 flex-1 basis-40 text-sm font-medium">{{ $t('karaoke.guide.enterCode') }}
        <input v-model="code" type="text" inputmode="numeric" autocomplete="off" maxlength="9" required
          :placeholder="$t('karaoke.guide.codePlaceholder')" :aria-invalid="!!pair.pairCodeError" data-pair-code-input
          class="mt-2 min-h-[44px] w-full rounded-lg border border-light-border dark:border-white/20 bg-transparent px-3 text-lg tracking-widest tabular-nums" />
      </label>
      <button type="submit" :disabled="pair.joining || !code.trim()" data-action="pair-by-code"
        class="min-h-[44px] rounded-full bg-spotify-green px-5 py-2 text-sm font-semibold text-black disabled:opacity-40">
        {{ $t(pair.joining ? 'karaoke.guide.connecting' : 'karaoke.guide.joinByCode') }}
      </button>
    </form>
    <p class="mt-2 text-xs text-light-text-secondary dark:text-gray-400">{{ $t('karaoke.guide.enterCodeHint') }}</p>
    <p v-if="pair.pairCodeError" role="alert" class="mt-3 text-sm text-red-500 dark:text-red-300">{{ $t(`karaoke.guide.${pair.pairCodeError}`) }}</p>
  </section>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useKaraokeDeviceStore } from '@/stores/karaokeDevice'

const pair = useKaraokeDeviceStore(), router = useRouter(), code = ref('')
async function join() {
  if (await pair.pairByCode(code.value)) await router.push('/sing/guide')
}
</script>
