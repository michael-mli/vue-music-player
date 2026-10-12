<template>
  <section ref="stage" class="singing-guide" :class="{ 'is-compact': compact }" :aria-label="$t('karaoke.guideTitle')">
    <div v-if="fullscreen && coverVisible && player.currentSong" class="stage-cover" aria-hidden="true">
      <SongCover :song-id="player.currentSong.id" alt="" />
    </div>
    <header class="guide-header">
      <div>
        <p class="guide-eyebrow">{{ $t('karaoke.guideTitle') }}</p>
        <p class="guide-song">{{ player.currentSong?.title }}</p>
        <p v-if="player.currentSong" class="guide-song-id">{{ $t('music.songId') }}: {{ player.currentSong.id }}</p>
      </div>
      <button v-if="fullscreenSupported" ref="expandButton" class="guide-icon-button" @click="toggleFullscreen"
        :aria-label="$t(fullscreen ? 'karaoke.exitStage' : 'karaoke.expandStage')"
        :title="$t(fullscreen ? 'karaoke.exitStage' : 'karaoke.expandStage')">
        <ArrowsPointingInIcon v-if="fullscreen" class="w-5 h-5" />
        <ArrowsPointingOutIcon v-else class="w-5 h-5" />
      </button>
    </header>

    <div v-if="fullscreen" class="stage-toolbar" role="group" :aria-label="$t('karaoke.stageControls')">
      <div class="stage-playback">
        <button type="button" data-stage-command="play" :disabled="!player.currentSong || player.partyAudioOwned || player.isPlaying" @click="player.play()"><PlayIcon />{{ $t('player.play') }}</button>
        <button type="button" data-stage-command="pause" :disabled="!player.currentSong || player.partyAudioOwned || !player.isPlaying" @click="player.pause()"><PauseIcon />{{ $t('player.pause') }}</button>
        <button type="button" data-stage-command="stop" :disabled="!player.currentSong || player.partyAudioOwned" @click="player.stopPlayback()"><StopIcon />{{ $t('karaoke.stageStop') }}</button>
        <button type="button" data-stage-command="next" :disabled="!player.canPlayNext || player.partyAudioOwned" @click="player.nextSong()"><ForwardIcon />{{ $t('player.next') }}</button>
      </div>
      <div class="stage-options">
        <div class="stage-mode" role="group" :aria-label="$t('karaoke.guide.hostAudioMode')">
          <button type="button" data-stage-mode="karaoke" :aria-pressed="player.karaokeMode"
            :disabled="!player.karaokeAvailable || player.partyAudioOwned || player.isTransitioning" @click="switchMode(true)">{{ $t('karaoke.switchKaraoke') }}</button>
          <button type="button" data-stage-mode="original" :aria-pressed="!player.karaokeMode"
            :disabled="!player.karaokeAvailable || player.partyAudioOwned || player.isTransitioning" @click="switchMode(false)">{{ $t('karaoke.switchOriginal') }}</button>
        </div>
        <button type="button" class="stage-order-button" data-action="toggle-stage-order" :data-stage-order="player.shuffle ? 'random' : 'id-desc'"
          :disabled="player.partyAudioOwned" :aria-label="$t(player.shuffle ? 'karaoke.stageOrderRandomHint' : 'karaoke.stageOrderIdHint')"
          :title="$t(player.shuffle ? 'karaoke.stageOrderRandomHint' : 'karaoke.stageOrderIdHint')"
          @click="player.setPlaybackOrder(player.shuffle ? 'id-desc' : 'random')">{{ $t(player.shuffle ? 'karaoke.stageOrderRandom' : 'karaoke.stageOrderId') }}</button>
      </div>
      <div class="stage-tools">
        <button ref="songsButton" type="button" data-action="toggle-stage-songs" :aria-expanded="songsOpen" aria-controls="karaoke-stage-songs"
          @click="toggleSongs">{{ $t('karaoke.stageSongs') }}</button>
        <button type="button" data-action="toggle-stage-cover" :aria-pressed="coverVisible" @click="coverVisible = !coverVisible">
          {{ $t(coverVisible ? 'karaoke.hideStageCover' : 'karaoke.showStageCover') }}
        </button>
      </div>
    </div>

    <div v-if="fullscreen && player.isSongRangeActive" class="stage-range" role="status">
      {{ $t('player.songRangeActive', { min: player.songRangeMin, max: player.songRangeMax }) }}
      <button type="button" data-action="clear-stage-range" @click="player.clearSongRange()">{{ $t('player.songRangeClear') }}</button>
    </div>
    <div class="stage-workspace">
      <div class="guide-layout" :inert="fullscreen && songsOpen || undefined">
        <div class="guide-main">
          <LyricsTimingControl v-if="player.currentSong && lines.length" :song-id="player.currentSong.id" :lines="lines" on-stage class="mt-4" />

          <div class="guide-status">
            <span class="status-indicator" :class="{ 'is-playing': player.isPlaying }" aria-hidden="true"></span>
            <span>{{ $t(loading ? 'lyrics.loading' : !lines.length ? 'karaoke.noSynced' : !player.isPlaying ? 'karaoke.guidePaused' : guide.finished ? 'karaoke.guideFinished'
              : guide.singing ? 'karaoke.singNow' : guide.index < 0 ? 'karaoke.guideIntro' : 'karaoke.guideInterlude') }}</span>
            <span class="guide-count" v-if="lyricNumber">{{ lyricNumber }} / {{ lyricCount }}</span>
          </div>

          <div v-if="lines.length" class="guide-lyrics">
            <button class="previous-line" :disabled="guide.previous < 0" @click="seekLine(guide.previous)">
              {{ lines[guide.previous]?.text || '\u00a0' }}
            </button>

            <div class="current-phrase">
              <div class="phrase-label">
                <span>{{ $t(guide.finished ? 'karaoke.guideFinished' : guide.singing ? 'karaoke.singNow' : 'karaoke.getReady') }}</span>
                <span v-if="guide.countdown" class="entry-countdown">{{ $t('karaoke.singIn', { seconds: guide.countdown }) }}</span>
              </div>
              <div v-if="guide.countdown > 0 && guide.countdown <= 4" class="countdown-dots" aria-hidden="true">
                <span v-for="dot in 4" :key="dot" :class="{ filled: dot <= guide.countdown }"></span>
              </div>
              <div class="lyric-line-window">
                <Transition name="lyric-line" @before-leave="hideLeavingLine" @before-enter="showEnteringLine">
                  <p :key="displayedLineKey" class="current-line" :class="{ 'waiting-line': !guide.singing }">
                    <template v-if="guide.singing && currentLine?.words?.length">
                      <span v-for="(word, index) in currentLine.words" :key="index" class="timed-word"
                        :style="{ '--word-progress': `${wordProgress(word) * 100}%` }">{{ word.text }}</span>
                    </template>
                    <template v-else>{{ guide.finished ? $t('karaoke.guideOutro') : displayedLine?.text }}</template>
                  </p>
                </Transition>
              </div>
              <div class="phrase-track" role="progressbar" :aria-label="$t('karaoke.lineProgress')"
                :aria-valuenow="Math.round(guide.progress * 100)" aria-valuemin="0" aria-valuemax="100">
                <div :style="{ transform: `scaleX(${guide.progress})` }"></div>
              </div>
              <p class="timing-note">{{ $t(currentLine?.words?.length && guide.singing ? 'karaoke.wordTiming' : 'karaoke.lineTiming') }}</p>
            </div>

            <div class="upcoming-lyrics">
              <p class="guide-eyebrow">{{ $t('karaoke.upNext') }}</p>
              <button v-for="(entry, index) in previewLines" :key="entry.index" class="upcoming-line"
                :class="{ 'second-upcoming': index > 0 }" @click="seekLine(entry.index)">
                <span>{{ entry.line.text }}</span><time>{{ formatTime(lyricSeekTime(entry.line.time, offset, player.duration)) }}</time>
              </button>
              <p v-if="!previewLines.length" class="no-upcoming">{{ $t('karaoke.noMoreLines') }}</p>
            </div>
          </div>

          <div v-else class="guide-fallback" role="status">
            <p v-if="loading">{{ $t('lyrics.loading') }}</p>
            <div v-else-if="plainLyrics" class="guide-plain-lyrics"><slot name="plain-lyrics">{{ plainLyrics }}</slot></div>
            <p v-else>{{ $t('karaoke.noSynced') }}</p>
          </div>

          <footer class="guide-footer">
            <div class="guide-transport">
              <button class="guide-action" :disabled="replayIndex < 0" @click="seekLine(replayIndex, 2)"
                :title="$t('karaoke.replayHint')"><ArrowPathIcon class="w-4 h-4" />{{ $t('karaoke.replayLine') }}</button>
              <button class="guide-play" @click="player.togglePlay()" :aria-label="$t(player.isPlaying ? 'player.pause' : 'player.play')">
                <PauseIcon v-if="player.isPlaying" class="w-5 h-5" /><PlayIcon v-else class="w-5 h-5" />
              </button>
              <button class="guide-action" :disabled="!guide.upcoming.length || guide.finished" @click="seekLine(guide.upcoming[0].index)">
                {{ $t('karaoke.nextLine') }}<ForwardIcon class="w-4 h-4" /></button>
            </div>
            <div class="song-timeline">
              <time>{{ formatTime(player.currentTime) }}</time>
              <input type="range" min="0" :max="player.duration || 0" step="0.1" :value="player.currentTime"
                :disabled="!player.duration" :aria-label="$t('karaoke.songPosition')" @input="seekSong" />
              <time>{{ formatTime(player.duration) }}</time>
            </div>
            <button v-if="fullscreen" ref="lyricsButton" type="button" class="stage-lyrics-toggle" data-action="toggle-stage-lyrics"
              :aria-expanded="allLyricsOpen" aria-controls="karaoke-stage-lyrics" @click="toggleLyrics">
              <ChevronDownIcon class="w-4 h-4" :class="{ 'rotate-180': allLyricsOpen }" />{{ $t('karaoke.stageLyrics') }}
            </button>
            <section v-if="fullscreen && allLyricsOpen" id="karaoke-stage-lyrics" ref="lyricsDropdown" class="stage-full-lyrics"
              :aria-label="$t('karaoke.stageLyrics')" @keydown.esc.stop.prevent="closeLyrics">
              <p v-if="loading" class="stage-lyrics-message" role="status">{{ $t('lyrics.loading') }}</p>
              <div v-else-if="lines.length" ref="lyricsScroller" v-memo="[sungLines, guide.index, offset, player.duration]" class="all-lyrics-list stage-lyrics-list">
                <button v-for="entry in sungLines" :key="entry.index" :data-line-index="entry.index" @click="seekLine(entry.index)"
                  :aria-current="entry.index === guide.index ? 'true' : undefined">
                  <time>{{ formatTime(lyricSeekTime(entry.line.time, offset, player.duration)) }}</time><span>{{ entry.line.text }}</span>
                </button>
              </div>
              <div v-else-if="plainLyrics" class="stage-plain-lyrics">{{ plainLyrics }}</div>
              <p v-else class="stage-lyrics-message" role="status">{{ $t('lyrics.noLyrics') }}</p>
            </section>
            <p v-if="fullscreenError" class="timing-note" role="status">{{ $t('karaoke.fullscreenUnavailable') }}</p>
            <details v-if="!fullscreen && lines.length" class="all-lyrics" @toggle="onLyricsToggle">
              <summary>{{ $t('karaoke.allLyrics') }}</summary>
              <div v-if="allLyricsOpen" ref="lyricsScroller" v-memo="[sungLines, guide.index, offset, player.duration]" class="all-lyrics-list">
                <button v-for="entry in sungLines" :key="entry.index" @click="seekLine(entry.index)"
                  :data-line-index="entry.index"
                  :aria-current="entry.index === guide.index ? 'true' : undefined">
                  <time>{{ formatTime(lyricSeekTime(entry.line.time, offset, player.duration)) }}</time><span>{{ entry.line.text }}</span>
                </button>
              </div>
            </details>
          </footer>
        </div>
        <aside v-if="fullscreen" class="stage-sidebar">
          <section v-if="!player.partyAudioOwned && (player.karaokeMode || player.karaokeAvailable || pairing.session)" class="stage-pairing" :aria-label="$t('karaoke.guide.pairTitle')">
            <h2 class="stage-pairing-title">{{ $t('karaoke.guide.pairTitle') }}</h2>
            <template v-if="pairing.pairUrl">
              <KaraokeGuideQr compact :value="pairing.pairUrl" :code="pairing.session?.pairCode" class="stage-pairing-qr">
                <template #fallback>
                  <label class="mt-2 block text-xs">{{ $t('karaoke.guide.pairLink') }}
                    <input :value="pairing.pairUrl" readonly class="mt-1 min-h-[44px] w-full rounded border border-gray-300 px-2 text-black"
                      @focus="($event.target as HTMLInputElement).select()" />
                  </label>
                </template>
              </KaraokeGuideQr>
              <p role="status" class="stage-pairing-status">{{ pairing.connectedDevices
                ? $t('karaoke.guide.paired', { count: pairing.connectedDevices }) : $t('karaoke.guide.waiting') }}</p>
              <KaraokePairedDevices compact class="mt-4 border-t border-white/10 pt-4" />
            </template>
            <template v-else>
              <p class="stage-pairing-hint">{{ $t('karaoke.guide.pairHint') }}</p>
              <button type="button" class="stage-pair-button" :disabled="pairing.busy || !player.currentSong"
                @click="pairing.start()">{{ $t(pairing.busy ? 'karaoke.guide.creating' : 'karaoke.guide.pairButton') }}</button>
            </template>
            <p v-if="pairing.error" role="alert" class="stage-pairing-error">{{ $t(`karaoke.guide.${pairing.error}`) }}</p>
          </section>
          <section class="stage-queue" :aria-label="$t('karaoke.guide.songQueue')">
            <h2 class="stage-queue-title">{{ $t('karaoke.guide.songQueue') }} <span>{{ player.requestedQueue.length }}</span></h2>
            <p v-if="!player.requestedQueue.length" class="stage-queue-empty">{{ $t('karaoke.guide.emptyQueue') }}</p>
            <ol v-else class="stage-queue-list">
              <li v-for="(song, index) in player.requestedQueue" :key="song.id" :data-queued-song-id="song.id">
                <span class="stage-queue-number">{{ index + 1 }}</span>
                <div>
                  <p>{{ song.title }}</p>
                  <p class="stage-queue-song-id">{{ $t('music.songId') }}: {{ song.id }}</p>
                  <p v-if="song.artist" class="stage-queue-artist">{{ song.artist }}</p>
                </div>
              </li>
            </ol>
          </section>
        </aside>
      </div>
      <div v-show="fullscreen && songsOpen" class="stage-song-browser">
        <div class="stage-browse-lyric" :data-line-index="guide.index">
          <div class="lyric-line-window">
            <Transition name="lyric-line" @before-leave="hideLeavingLine" @before-enter="showEnteringLine">
              <p :key="displayedLineKey" class="browse-current-line" :class="{ 'waiting-line': !guide.singing }">
                <template v-if="loading">{{ $t('lyrics.loading') }}</template>
                <template v-else-if="!lines.length">{{ $t('karaoke.noSynced') }}</template>
                <template v-else-if="guide.singing && currentLine?.words?.length">
                  <span v-for="(word, index) in currentLine.words" :key="index" class="timed-word"
                    :style="{ '--word-progress': `${wordProgress(word) * 100}%` }">{{ word.text }}</span>
                </template>
                <template v-else>{{ guide.finished ? $t('karaoke.guideOutro') : displayedLine?.text }}</template>
              </p>
            </Transition>
          </div>
        </div>
        <KeepAlive>
          <KaraokeStageSongs v-if="fullscreen && songsOpen" ref="songsPicker" id="karaoke-stage-songs" class="stage-panel" @close="closeSongs" />
        </KeepAlive>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { ArrowsPointingInIcon, ArrowsPointingOutIcon, ArrowPathIcon, ChevronDownIcon, ForwardIcon, PauseIcon, PlayIcon, StopIcon } from '@heroicons/vue/24/outline'
import { usePlayerStore } from '@/stores/player'
import { useKaraokeGuideStore } from '@/stores/karaokeGuide'
import { useUiStore } from '@/stores/ui'
import { singingGuideState } from '@/utils/lyricsTiming'
import { lyricSeekTime } from '@/utils/lyricsOffset'
import { useLyricsOffset } from '@/composables/useLyricsOffset'
import LyricsTimingControl from '@/components/Lyrics/LyricsTimingControl.vue'
import KaraokeGuideQr from '@/components/UI/KaraokeGuideQr.vue'
import KaraokePairedDevices from '@/components/UI/KaraokePairedDevices.vue'
import KaraokeStageSongs from '@/components/UI/KaraokeStageSongs.vue'
import SongCover from '@/components/UI/SongCover.vue'
import type { LyricLine, LyricWord } from '@/types'

const props = defineProps<{ lines: LyricLine[]; compact?: boolean; loading?: boolean; plainLyrics?: string }>()
const player = usePlayerStore()
function switchMode(karaoke: boolean) {
  if (player.karaokeAvailable && !player.partyAudioOwned && !player.isTransitioning && player.karaokeMode !== karaoke) void player.toggleKaraoke()
}
const pairing = useKaraokeGuideStore()
const ui = useUiStore()
const { offset } = useLyricsOffset(computed(() => player.currentSong?.id))
const lyricTime = computed(() => player.currentTime - offset.value)
const stage = ref<HTMLElement>()
const expandButton = ref<HTMLButtonElement>()
const fullscreen = ref(false)
const fullscreenSupported = ref(false)
const fullscreenError = ref(false)
const allLyricsOpen = ref(false)
const songsOpen = ref(false)
const songsPicker = ref<InstanceType<typeof KaraokeStageSongs>>()
// Capture before KeepAlive detaches the panel, when its scroll box still has size.
watch(songsOpen, open => { if (!open) songsPicker.value?.rememberVisit() }, { flush: 'sync' })
const coverVisible = ref(readCoverPreference())
const songsButton = ref<HTMLButtonElement>(), lyricsButton = ref<HTMLButtonElement>()
const lyricsDropdown = ref<HTMLElement>()
const lyricsScroller = ref<HTMLElement>()
watch(() => player.currentSong?.id, () => { if (!fullscreen.value) allLyricsOpen.value = false })
watch(coverVisible, value => {
  try { localStorage.setItem('karaoke-stage-cover', String(value)) } catch { /* Optional display preference. */ }
})
const guide = computed(() => singingGuideState(props.lines, player.currentTime, player.duration, offset.value))
const currentLine = computed(() => props.lines[guide.value.index])
const sungLines = computed(() => props.lines.map((line, index) => ({ line, index })).filter(({ line }) => line.text.trim()))
// Calculate line numbering once per lyric source, not on every playback tick.
const lyricNumbers = computed(() => {
  let count = 0
  return props.lines.map((line) => line.text.trim() ? ++count : count)
})
const lyricCount = computed(() => lyricNumbers.value[props.lines.length - 1] ?? 0)
const lyricNumber = computed(() => lyricNumbers.value[guide.value.index] ?? 0)
const displayedLine = computed(() => guide.value.singing ? currentLine.value : guide.value.upcoming[0]?.line)
// Keep the same element through playback/word ticks, but distinguish repeated lines and songs.
const displayedLineKey = computed(() => {
  const state = guide.value
  const index = state.singing ? state.index : state.upcoming[0]?.index ?? -1
  const phase = props.loading ? 'loading' : !props.lines.length ? 'empty'
    : state.finished ? 'finished' : state.singing ? 'singing' : 'waiting'
  return `${player.currentSong?.id ?? 'none'}:${phase}:${index}`
})
function hideLeavingLine(element: Element) { element.setAttribute('aria-hidden', 'true') }
function showEnteringLine(element: Element) { element.removeAttribute('aria-hidden') }
const previewLines = computed(() => guide.value.finished ? [] : guide.value.singing ? guide.value.upcoming : guide.value.upcoming.slice(1))
const replayIndex = computed(() => guide.value.singing ? guide.value.index
  : guide.value.upcoming[0]?.index ?? guide.value.previous)

function wordProgress(word: LyricWord) {
  if (lyricTime.value < word.time) return 0
  const end = word.endTime ?? guide.value.end
  if (end === undefined || end <= word.time) return 1
  return Math.min(1, (lyricTime.value - word.time) / (end - word.time))
}

function seekLine(index: number, leadIn = 0) {
  if (!props.lines[index]) return
  player.seek(lyricSeekTime(props.lines[index].time, offset.value, player.duration, leadIn))
}

function seekSong(event: Event) {
  player.seek(Number((event.target as HTMLInputElement).value))
}

function onLyricsToggle(event: Event) {
  allLyricsOpen.value = (event.target as HTMLDetailsElement).open
}

function readCoverPreference() {
  try { return localStorage.getItem('karaoke-stage-cover') !== 'false' } catch { return true }
}
function closeSongs() { songsOpen.value = false; songsButton.value?.focus() }
function toggleSongs() {
  if (songsOpen.value) closeSongs()
  else { allLyricsOpen.value = false; songsOpen.value = true }
}
async function closeLyrics() {
  allLyricsOpen.value = false
  await nextTick()
  lyricsButton.value?.focus()
}
async function toggleLyrics() {
  if (allLyricsOpen.value) { closeLyrics(); return }
  songsOpen.value = false; allLyricsOpen.value = true
  await nextTick()
  // Reveal the expanded dropdown once; ongoing lyric following scrolls only its list.
  const dropdown = lyricsDropdown.value, layout = dropdown?.closest<HTMLElement>('.guide-layout')
  if (dropdown && layout) {
    const below = dropdown.getBoundingClientRect().bottom - layout.getBoundingClientRect().bottom
    if (below > 0) layout.scrollTop += below + 8
  }
}

// Scroll this list alone: scrolling ancestors would move the playback controls
// or pull the fullscreen stage away from its current layout.
function scrollCurrentLyrics() {
  const list = lyricsScroller.value
  if (!allLyricsOpen.value || !list) return
  const active = list.querySelector<HTMLElement>('[aria-current="true"]')
    || list.querySelector<HTMLElement>(`[data-line-index="${guide.value.upcoming[0]?.index}"]`)
    || list.querySelector<HTMLElement>('[data-line-index]')
  if (!active) return
  const top = list.scrollTop + active.getBoundingClientRect().top - list.getBoundingClientRect().top
    - (list.clientHeight - active.offsetHeight) / 2
  list.scrollTo({ top: Math.max(0, top), behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
}
watch([allLyricsOpen, () => guide.value.index, sungLines, offset], scrollCurrentLyrics, { flush: 'post' })
let lyricsResize: ResizeObserver | undefined
watch(lyricsScroller, list => {
  lyricsResize?.disconnect()
  if (list && typeof ResizeObserver !== 'undefined') {
    lyricsResize = new ResizeObserver(scrollCurrentLyrics)
    lyricsResize.observe(list)
  }
  scrollCurrentLyrics()
}, { flush: 'post' })

function formatTime(time: number) {
  const seconds = Math.max(0, Math.floor(time || 0))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

async function toggleFullscreen() {
  fullscreenError.value = false
  try {
    if (fullscreen.value) await document.exitFullscreen()
    else await stage.value?.requestFullscreen()
  } catch { fullscreenError.value = true }
}

function syncFullscreen() {
  const wasFullscreen = fullscreen.value
  fullscreen.value = document.fullscreenElement === stage.value
  if (fullscreen.value && !wasFullscreen && !player.shuffle) player.setPlaybackOrder('id-desc')
  if (fullscreen.value) { coverVisible.value = readCoverPreference(); ui.fullscreenStage = stage.value || null }
  else if (ui.fullscreenStage === stage.value) ui.fullscreenStage = null
  if (wasFullscreen !== fullscreen.value) { songsOpen.value = false; allLyricsOpen.value = false }
  if (wasFullscreen && !fullscreen.value) expandButton.value?.focus()
}

onMounted(() => {
  fullscreenSupported.value = !!document.fullscreenEnabled
  document.addEventListener('fullscreenchange', syncFullscreen)
})
onBeforeUnmount(() => {
  lyricsResize?.disconnect()
  document.removeEventListener('fullscreenchange', syncFullscreen)
  if (ui.fullscreenStage === stage.value) ui.fullscreenStage = null
})
</script>

<style scoped>
.singing-guide {
  container-type: inline-size;
  color: #f8fafc;
  background: radial-gradient(ellipse at 50% 25%, #153d35 0, #101f22 45%, #0b1218 100%);
  border: 1px solid #33534e;
  border-radius: 18px;
  padding: 24px;
  overflow-wrap: anywhere;
  color-scheme: dark;
}
.guide-header, .guide-status, .phrase-label, .guide-transport, .song-timeline { display: flex; align-items: center; gap: 12px; }
.guide-header { justify-content: space-between; }
.guide-header > div { min-width: 0; }
.guide-eyebrow { font-size: 11px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; color: #aac7c0; }
.guide-song { font-size: 14px; margin-top: 4px; }
.guide-song-id, .stage-queue-song-id { margin-top: 4px; color: #aac7c0; font-size: 11px; font-variant-numeric: tabular-nums; }
.guide-main { min-width: 0; }
.guide-fallback { display: grid; place-items: center; min-height: 280px; padding: 32px 8px; text-align: center; color: #c1d5d0; }
.guide-plain-lyrics { white-space: pre-wrap; line-height: 1.8; max-height: 40vh; overflow-y: auto; width: 100%; }
.stage-sidebar { display: grid; gap: 20px; margin-top: 24px; min-width: 0; }
.stage-queue, .stage-pairing { padding: 18px; border: 1px solid #38534f; border-radius: 14px; background: #ffffff05; min-width: 0; }
.stage-pairing-title { font-size: 14px; font-weight: 700; }
.stage-pairing-qr { margin: 12px auto 0; }
.stage-pairing-status { margin-top: 12px; color: #7ef0b6; font-size: 12px; text-align: center; }
.stage-pairing-hint { margin-top: 12px; color: #aac7c0; font-size: 13px; line-height: 1.6; }
.stage-pair-button { margin-top: 12px; min-height: 44px; width: 100%; padding: 8px 12px; border-radius: 24px; background: #7ef0b6; color: #10221c; font-size: 13px; font-weight: 700; }
.stage-pair-button:not(:disabled):hover { background: #a4f6cc; }
.stage-pairing-error { margin-top: 12px; color: #fca5a5; font-size: 12px; }
.stage-queue-title { display: flex; justify-content: space-between; align-items: center; gap: 12px; font-size: 14px; font-weight: 700; }
.stage-queue-title > span { color: #7ef0b6; font-variant-numeric: tabular-nums; }
.stage-queue-empty { margin-top: 16px; color: #aac7c0; font-size: 13px; line-height: 1.6; }
.stage-queue-list { max-height: 320px; overflow-y: auto; margin-top: 12px; }
.stage-queue-list li { display: flex; gap: 12px; padding: 12px 0; border-top: 1px solid #2c4540; font-size: 14px; }
.stage-queue-list li > div { min-width: 0; }
.stage-queue-list li:first-child { color: #7ef0b6; }
.stage-queue-number { flex-shrink: 0; color: #aac7c0; font-variant-numeric: tabular-nums; }
.stage-queue-artist { color: #aac7c0; font-size: 12px; margin-top: 4px; }
.guide-icon-button { padding: 10px; border: 1px solid #38534f; border-radius: 50%; flex-shrink: 0; }
.guide-status { margin-top: 24px; color: #c1d5d0; font-size: 12px; }
.status-indicator { width: 7px; height: 7px; border-radius: 50%; background: #94a3b8; }
.status-indicator.is-playing { background: #69efad; box-shadow: 0 0 12px #69efad55; }
.guide-count { margin-left: auto; font-variant-numeric: tabular-nums; }
.guide-lyrics { text-align: center; padding: 24px 0; }
.previous-line { color: #95aaa6; font-size: clamp(14px, 2.5cqw, 22px); display: block; width: 100%; min-height: 2em; margin-bottom: 22px; }
.current-phrase { padding: 0 8px; }
.phrase-label { min-height: 28px; justify-content: center; flex-wrap: wrap; color: #7ef0b6; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .1em; }
.entry-countdown { color: #ffe0a4; background: #443923; border-radius: 20px; padding: 4px 10px; font-variant-numeric: tabular-nums; }
.current-line { font-size: clamp(26px, 5.5cqw, 56px); font-weight: 750; line-height: 1.45; margin: 14px 0 22px; color: #7ef0b6; white-space: pre-wrap; }
.lyric-line-window { display: grid; overflow: hidden; }
.lyric-line-window > p { grid-area: 1 / 1; min-width: 0; }
.lyric-line-enter-active, .lyric-line-leave-active { transition: transform 320ms cubic-bezier(.22, 1, .36, 1), opacity 280ms ease; }
.lyric-line-leave-active { pointer-events: none; user-select: none; }
.lyric-line-enter-from { opacity: 0; transform: translateY(.65em); }
.lyric-line-leave-to { opacity: 0; transform: translateY(-.65em); }
.waiting-line { color: #edf5f2; }
.timed-word { background: linear-gradient(to right, #7ef0b6 var(--word-progress), #edf5f2 var(--word-progress)); background-clip: text; -webkit-background-clip: text; color: transparent; }
.phrase-track { max-width: 440px; margin: auto; height: 4px; border-radius: 4px; background: #314740; overflow: hidden; }
.phrase-track > div { height: 100%; background: #7ef0b6; transform-origin: left; }
.timing-note { font-size: 10px; color: #9bb5af; margin-top: 10px; }
.countdown-dots { display: flex; justify-content: center; gap: 7px; margin-top: 10px; }
.countdown-dots > span { width: 8px; height: 8px; border-radius: 50%; background: #42534d; }
.countdown-dots > .filled { background: #ffe0a4; }
.upcoming-lyrics { margin-top: 28px; min-height: 110px; }
.upcoming-line { display: flex; align-items: baseline; justify-content: center; gap: 14px; width: 100%; padding: 8px 0; font-size: clamp(18px, 3.3cqw, 30px); color: #e1eae7; line-height: 1.45; }
.upcoming-line time { color: #a7bdb6; font-size: 11px; flex-shrink: 0; font-variant-numeric: tabular-nums; }
.second-upcoming { color: #a7bdb6; font-size: clamp(16px, 2.8cqw, 24px); }
.no-upcoming { font-size: 13px; color: #9bb5af; padding-top: 12px; }
.guide-footer { border-top: 1px solid #2c4540; padding-top: 18px; }
.guide-transport { justify-content: center; }
.guide-action { display: flex; justify-content: center; align-items: center; gap: 7px; font-size: 12px; min-height: 44px; padding: 6px 10px; border-radius: 8px; }
.guide-action svg { flex-shrink: 0; }
.guide-play { border-radius: 50%; padding: 12px; background: #7ef0b6; color: #10221c; flex-shrink: 0; }
.song-timeline { margin-top: 16px; font-size: 11px; color: #afc5bd; font-variant-numeric: tabular-nums; }
.song-timeline time { flex-shrink: 0; white-space: nowrap; }
.song-timeline input { accent-color: #7ef0b6; width: 100%; min-width: 0; height: 24px; cursor: pointer; }
.stage-lyrics-toggle { display: flex; align-items: center; gap: 8px; width: 100%; min-height: 44px; margin-top: 12px; padding: 8px 12px; border: 1px solid #56716b; border-radius: 8px; text-align: left; color: #afc5bd; font-size: 12px; }
.stage-lyrics-toggle[aria-expanded="true"] { border-bottom-left-radius: 0; border-bottom-right-radius: 0; color: #7ef0b6; }
.all-lyrics { margin-top: 12px; font-size: 12px; color: #afc5bd; }
.all-lyrics summary { cursor: pointer; padding: 8px 0; }
.all-lyrics-list { max-height: 240px; overflow-y: auto; margin-top: 8px; }
.all-lyrics-list button { width: 100%; text-align: left; display: flex; gap: 12px; padding: 10px 6px; border-radius: 6px; }
.all-lyrics-list time { flex-shrink: 0; font-variant-numeric: tabular-nums; }
.all-lyrics-list [aria-current] { color: #7ef0b6; background: #213c32; }
button:disabled { opacity: .4; cursor: default; }
button:not(:disabled):hover { background-color: #ffffff0d; }
.guide-play:hover { background: #a4f6cc !important; }
button:focus-visible, summary:focus-visible, input:focus-visible { outline: 2px solid #ffe0a4; outline-offset: 4px; }
.is-compact { padding: 16px; }
.is-compact .guide-lyrics { padding: 18px 0; }
.is-compact .guide-transport { gap: 4px; }
.is-compact .guide-action { padding: 4px; font-size: 11px; }
.singing-guide:fullscreen { position: relative; isolation: isolate; container-type: normal; display: flex; flex-direction: column; border: 0; border-radius: 0; overflow: hidden; width: 100%; height: 100%; padding: clamp(12px, 3vw, 40px); }
.stage-cover { position: absolute; inset: 0; z-index: 0; pointer-events: none; }
.stage-cover::after { content: ''; position: absolute; inset: 0; background: linear-gradient(180deg, #071310db, #071310b8 45%, #071310ed); }
.stage-cover :deep(img) { object-position: center; }
.singing-guide:fullscreen .guide-header { position: relative; z-index: 2; flex-shrink: 0; }
.singing-guide:fullscreen .guide-song { max-width: min(70vw, 800px); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.stage-toolbar { position: relative; z-index: 2; flex-shrink: 0; display: flex; flex-wrap: wrap; gap: 8px; padding: 8px; margin: 12px 0; border: 1px solid #56716b; border-radius: 12px; background: #081b16eb; }
.stage-playback, .stage-tools, .stage-mode { display: grid; gap: 6px; flex: 1 1 320px; min-width: 0; }
.stage-playback { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.stage-options { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); flex: 1 1 230px; min-width: 0; gap: 6px; }
.stage-mode { grid-column: span 2; grid-template-columns: repeat(2, minmax(0, 1fr)); }
.stage-tools { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.stage-toolbar button { display: flex; align-items: center; justify-content: center; gap: 6px; min-width: 0; min-height: 44px; border: 1px solid #56716b; border-radius: 8px; padding: 8px 4px; font-size: 12px; }
.stage-toolbar button svg { width: 18px; height: 18px; flex-shrink: 0; }
.stage-toolbar .stage-order-button { color: #7ef0b6; border-color: #7ef0b6; white-space: nowrap; }
.stage-range { position: relative; z-index: 2; display: flex; align-items: center; gap: 12px; flex-shrink: 0; color: #ffe0a4; font-size: 12px; }
.stage-range button { min-height: 44px; text-decoration: underline; }
.stage-toolbar [aria-expanded="true"], .stage-mode [aria-pressed="true"], .stage-toolbar [data-stage-command="play"]:not(:disabled) { color: #7ef0b6; border-color: #7ef0b6; }
.singing-guide:fullscreen .stage-workspace { position: relative; z-index: 1; flex: 1; min-height: 0; }
.singing-guide:fullscreen .guide-layout { height: 100%; overflow-y: auto; padding: 0 4px 24px; overscroll-behavior: contain; }
.stage-panel { position: absolute; inset: 0; z-index: 3; min-width: 0; padding: clamp(12px, 2vw, 24px); border: 1px solid #56716b; border-radius: 12px; background: #081b16; overflow-y: auto; overscroll-behavior: contain; }
.stage-song-browser { position: absolute; inset: 0; z-index: 3; display: flex; flex-direction: column; gap: 8px; min-height: 0; border-radius: 12px; background: #081b16; }
.stage-browse-lyric { flex-shrink: 0; max-height: 40%; overflow-y: auto; overscroll-behavior: contain; padding: 8px 12px; border: 1px solid #56716b; border-radius: 12px; background: #081b16; text-align: center; }
.browse-current-line { color: #7ef0b6; font-size: clamp(18px, 2.5vw, 30px); font-weight: 750; line-height: 1.4; white-space: pre-wrap; }
.browse-current-line.waiting-line { color: #edf5f2; }
.stage-song-browser > .stage-panel { position: relative; inset: auto; flex: 1; min-height: 0; }
.stage-full-lyrics { padding: 8px; border: 1px solid #56716b; border-top: 0; border-radius: 0 0 8px 8px; background: #081b16; }
.stage-lyrics-list, .stage-plain-lyrics { max-height: clamp(120px, 35dvh, 320px); overflow-y: auto; overscroll-behavior: contain; margin-top: 0; font-size: clamp(16px, 2vw, 22px); }
.stage-lyrics-list button { padding: 12px 8px; line-height: 1.6; }
.stage-lyrics-list time { margin-top: .4em; color: #aac7c0; font-size: 12px; }
.stage-plain-lyrics { padding: 8px; white-space: pre-wrap; line-height: 1.8; }
.stage-lyrics-message { padding: 12px 8px; color: #b6cdc5; font-size: 13px; }
@media (max-width: 600px) {
  .stage-playback button { gap: 4px; padding-inline: 2px; font-size: 11px; white-space: nowrap; }
  .stage-playback button svg { width: 16px; height: 16px; }
}
@media (max-height: 450px) {
  .stage-browse-lyric { padding: 4px 8px; }
  .browse-current-line { font-size: 16px; }
}
.singing-guide:fullscreen .guide-lyrics { max-width: 1100px; margin: auto; }
.singing-guide:fullscreen .guide-footer { max-width: 800px; margin: auto; }
.singing-guide:fullscreen .current-line { font-size: clamp(30px, 5vw, 76px); }
@media (min-width: 900px) {
  .singing-guide:fullscreen .guide-layout { display: grid; grid-template-columns: minmax(0, 1fr) minmax(220px, 300px); gap: clamp(24px, 4vw, 64px); align-items: start; }
  .singing-guide:fullscreen .stage-sidebar { position: sticky; top: 0; max-height: calc(100dvh - 240px); overflow-y: auto; }
  .singing-guide:fullscreen .stage-queue-list { max-height: clamp(96px, calc(100dvh - 590px), 320px); }
}
@container (max-width: 340px) {
  .guide-action { font-size: 11px; padding: 4px; gap: 4px; }
  .guide-transport { gap: 6px; }
  .upcoming-line { gap: 8px; }
}
@media (prefers-reduced-motion: reduce) {
  .lyric-line-enter-active, .lyric-line-leave-active { transition: none; }
  .lyric-line-enter-from, .lyric-line-leave-to { transform: none; }
}
</style>
