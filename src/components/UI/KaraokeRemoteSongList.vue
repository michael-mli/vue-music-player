<template>
  <ul class="mt-3 divide-y divide-light-border dark:divide-white/10">
    <li v-for="song in songs" :key="song.id" :data-song-id="song.id" class="py-3">
      <div class="flex items-center gap-3">
        <div class="h-10 w-10 shrink-0 overflow-hidden rounded bg-light-border dark:bg-spotify-light">
          <SongCover :song-id="song.id" :alt="song.title" />
        </div>
        <div class="min-w-0 flex-1">
          <p class="break-words text-sm font-medium">{{ song.title }}</p>
          <p class="mt-1 break-words text-xs text-light-text-secondary dark:text-gray-400">
            <span class="remote-song-id">{{ $t('music.songId') }}: {{ song.id }}</span><template v-if="song.artist"> · {{ song.artist }}</template>
          </p>
        </div>
      </div>
      <div class="mt-2 flex flex-wrap gap-2">
        <button type="button" :disabled="!pair.canControl || queued(song.id)" data-action="enqueue"
          class="min-h-[44px] rounded-lg border border-light-border dark:border-white/20 px-3 text-sm disabled:opacity-40"
          @click="pair.command('enqueue', { songId: song.id })">{{ $t(queued(song.id) ? 'karaoke.guide.queued' : 'karaoke.guide.addSong') }}</button>
        <button type="button" :disabled="!pair.canControl" data-action="singNow"
          class="min-h-[44px] rounded-lg border border-light-border dark:border-white/20 px-3 text-sm disabled:opacity-40"
          @click="pair.command('singNow', { songId: song.id })">{{ $t('karaoke.guide.singNow') }}</button>
      </div>
    </li>
  </ul>
</template>

<script setup lang="ts">
import SongCover from '@/components/UI/SongCover.vue'
import { useKaraokeDeviceStore } from '@/stores/karaokeDevice'
import type { KaraokeCatalogSong } from '@/services/karaokeGuideApi'

defineProps<{ songs: KaraokeCatalogSong[] }>()
const pair = useKaraokeDeviceStore()
const queued = (id: number) => pair.queue.some(song => song.id === id)
</script>
