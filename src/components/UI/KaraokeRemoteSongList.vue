<template>
  <section>
    <KaraokeSongBatch :count="selected.size" :eligible="selectablePage.length > 0" :all-selected="allPageSelected" :disabled="!pair.canControl" :busy="adding"
      @select-page="selectPage(songs)" @clear="selected.clear()" @add="enqueueSelected" @cancel="cancelled = true" />
    <p v-if="notice" role="status" class="text-sm text-spotify-green">{{ notice }}</p>
    <ul class="mt-3 divide-y divide-light-border dark:divide-white/10">
    <li v-for="song in songs" :key="song.id" :data-song-id="song.id" class="py-3">
      <div class="flex items-center gap-3">
        <label class="flex h-11 w-11 shrink-0 items-center justify-center">
          <input type="checkbox" :checked="selected.has(song.id)" :disabled="!pair.canControl || adding || queued(song.id)"
            :aria-label="$t('karaoke.selectSong', { title: song.title, id: song.id })" class="h-5 w-5 accent-spotify-green" @change="toggle(song)" />
        </label>
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
        <button type="button" :disabled="!pair.canControl || adding || queued(song.id)" data-action="enqueue"
          class="min-h-[44px] rounded-lg border border-light-border dark:border-white/20 px-3 text-sm disabled:opacity-40"
          @click="pair.command('enqueue', { songId: song.id })">{{ $t(queued(song.id) ? 'karaoke.guide.queued' : 'karaoke.guide.addSong') }}</button>
        <button type="button" :disabled="!pair.canControl || adding" data-action="singNow"
          class="min-h-[44px] rounded-lg border border-light-border dark:border-white/20 px-3 text-sm disabled:opacity-40"
          @click="pair.command('singNow', { songId: song.id })">{{ $t('karaoke.guide.singNow') }}</button>
      </div>
    </li>
    </ul>
  </section>
</template>

<script setup lang="ts">
import SongCover from '@/components/UI/SongCover.vue'
import KaraokeSongBatch from '@/components/UI/KaraokeSongBatch.vue'
import { computed, onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSongSelection } from '@/composables/useSongSelection'
import { useKaraokeDeviceStore } from '@/stores/karaokeDevice'
import type { KaraokeCatalogSong } from '@/services/karaokeGuideApi'

const props = defineProps<{ songs: KaraokeCatalogSong[] }>()
const pair = useKaraokeDeviceStore()
const { t } = useI18n()
const queued = (id: number) => pair.queue.some(song => song.id === id)
const { selected, selectedSongs, toggle, selectPage } = useSongSelection<KaraokeCatalogSong>(queued)
const selectablePage = computed(() => props.songs.filter(song => !queued(song.id)))
const allPageSelected = computed(() => selectablePage.value.length > 0 && selectablePage.value.every(song => selected.value.has(song.id)))
const adding = ref(false), notice = ref(''), cancelled = ref(false)
onBeforeUnmount(() => { cancelled.value = true })
async function enqueueSelected() {
  if (adding.value || !pair.canControl) return
  adding.value = true; cancelled.value = false; notice.value = ''
  let count = 0
  try {
    for (const song of selectedSongs.value) {
      if (cancelled.value || !pair.canControl) break
      if (queued(song.id)) { selected.value.delete(song.id); continue }
      if (!await pair.enqueueSongAndWait(song.id)) break
      selected.value.delete(song.id); count++
    }
    notice.value = t(selected.value.size ? 'karaoke.batchPartial' : 'karaoke.batchAdded', { count, remaining: selected.value.size })
  } finally { adding.value = false }
}
</script>
