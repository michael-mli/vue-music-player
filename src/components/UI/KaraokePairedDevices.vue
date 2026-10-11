<template>
  <section data-paired-devices :aria-label="$t('karaoke.guide.devicesTitle')">
    <h3 class="font-semibold" :class="compact ? 'text-sm' : ''">{{ $t('karaoke.guide.devicesTitle') }} ({{ guide.devices.length }}/10)</h3>
    <p v-if="!compact" class="mt-1 text-xs text-light-text-secondary dark:text-gray-400">{{ $t('karaoke.guide.idleHint') }}</p>
    <p v-if="!guide.devices.length" class="mt-3 text-sm" :class="compact ? 'text-gray-300' : 'text-light-text-secondary dark:text-gray-400'">{{ $t('karaoke.guide.waiting') }}</p>
    <ul class="mt-3 space-y-3">
      <li v-for="device in guide.devices" :key="device.id" :data-device-id="device.id"
        class="flex flex-wrap items-center justify-between gap-2 rounded-lg p-3" :class="compact ? 'bg-white/5' : 'bg-light-bg dark:bg-black/20'">
        <div class="min-w-0">
          <p class="break-words text-sm font-medium">{{ device.name }}</p>
          <p v-if="device.username" class="mt-1 break-all text-sm" :class="compact ? 'text-emerald-300' : 'text-spotify-green'" data-device-username>{{ $t('karaoke.guide.pairedUser') }}: @{{ device.username }}</p>
          <p class="mt-1 text-xs" :class="compact ? 'text-gray-300' : 'text-light-text-secondary dark:text-gray-400'">{{ $t(`karaoke.guide.device${device.status}`) }} · {{ $t('karaoke.guide.idleRemaining', { minutes: Math.ceil(device.idleRemainingMs / 60000) }) }}</p>
        </div>
        <div class="flex flex-wrap items-center gap-3">
          <label class="flex min-h-[44px] items-center gap-2 text-sm">
            <input type="checkbox" :checked="device.canControl" :disabled="!!guide.managing" class="accent-spotify-green"
              @change="guide.manageDevice(device.id, ($event.target as HTMLInputElement).checked)" />
            {{ $t('karaoke.guide.allowControls') }}
          </label>
          <button type="button" :disabled="!!guide.managing" class="min-h-[44px] px-2 text-sm disabled:opacity-40"
            :class="compact ? 'text-red-300' : 'text-red-500 dark:text-red-300'"
            :aria-label="$t('karaoke.guide.removeDevice', { name: device.name })" @click="guide.manageDevice(device.id)">{{ $t('karaoke.guide.remove') }}</button>
        </div>
      </li>
    </ul>
  </section>
</template>

<script setup lang="ts">
import { useKaraokeGuideStore } from '@/stores/karaokeGuide'
defineProps<{ compact?: boolean }>()
const guide = useKaraokeGuideStore()
</script>
