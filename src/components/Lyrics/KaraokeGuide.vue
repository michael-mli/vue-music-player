<template>
  <section ref="stage" class="singing-guide" :class="{ 'is-compact': compact }" :aria-label="$t('karaoke.guideTitle')">
    <header class="guide-header">
      <div>
        <p class="guide-eyebrow">{{ $t('karaoke.guideTitle') }}</p>
        <p class="guide-song">{{ player.currentSong?.title }}</p>
      </div>
      <button v-if="fullscreenSupported" ref="expandButton" class="guide-icon-button" @click="toggleFullscreen"
        :aria-label="$t(fullscreen ? 'karaoke.exitStage' : 'karaoke.expandStage')"
        :title="$t(fullscreen ? 'karaoke.exitStage' : 'karaoke.expandStage')">
        <ArrowsPointingInIcon v-if="fullscreen" class="w-5 h-5" />
        <ArrowsPointingOutIcon v-else class="w-5 h-5" />
      </button>
    </header>

    <LyricsTimingControl v-if="player.currentSong" :song-id="player.currentSong.id" :lines="lines" on-stage class="mt-4" />

    <div class="guide-status">
      <span class="status-indicator" :class="{ 'is-playing': player.isPlaying }" aria-hidden="true"></span>
      <span>{{ $t(!player.isPlaying ? 'karaoke.guidePaused' : guide.finished ? 'karaoke.guideFinished'
        : guide.singing ? 'karaoke.singNow' : guide.index < 0 ? 'karaoke.guideIntro' : 'karaoke.guideInterlude') }}</span>
      <span class="guide-count" v-if="lyricNumber">{{ lyricNumber }} / {{ lyricCount }}</span>
    </div>

    <div class="guide-lyrics">
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
        <p class="current-line" :class="{ 'waiting-line': !guide.singing }">
          <template v-if="guide.singing && currentLine?.words?.length">
            <span v-for="(word, index) in currentLine.words" :key="index" class="timed-word"
              :style="{ '--word-progress': `${wordProgress(word) * 100}%` }">{{ word.text }}</span>
          </template>
          <template v-else>{{ guide.finished ? $t('karaoke.guideOutro') : displayedLine?.text }}</template>
        </p>
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
      <p v-if="fullscreenError" class="timing-note" role="status">{{ $t('karaoke.fullscreenUnavailable') }}</p>
      <details class="all-lyrics" @toggle="onLyricsToggle">
        <summary>{{ $t('karaoke.allLyrics') }}</summary>
        <div v-if="allLyricsOpen" v-memo="[sungLines, guide.index, offset, player.duration]" class="all-lyrics-list">
          <button v-for="entry in sungLines" :key="entry.index" @click="seekLine(entry.index)"
            :aria-current="entry.index === guide.index ? 'true' : undefined">
            <time>{{ formatTime(lyricSeekTime(entry.line.time, offset, player.duration)) }}</time><span>{{ entry.line.text }}</span>
          </button>
        </div>
      </details>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { ArrowsPointingInIcon, ArrowsPointingOutIcon, ArrowPathIcon, ForwardIcon, PauseIcon, PlayIcon } from '@heroicons/vue/24/outline'
import { usePlayerStore } from '@/stores/player'
import { singingGuideState } from '@/utils/lyricsTiming'
import { lyricSeekTime } from '@/utils/lyricsOffset'
import { useLyricsOffset } from '@/composables/useLyricsOffset'
import LyricsTimingControl from '@/components/Lyrics/LyricsTimingControl.vue'
import type { LyricLine, LyricWord } from '@/types'

const props = defineProps<{ lines: LyricLine[]; compact?: boolean }>()
const player = usePlayerStore()
const { offset } = useLyricsOffset(computed(() => player.currentSong?.id))
const lyricTime = computed(() => player.currentTime - offset.value)
const stage = ref<HTMLElement>()
const expandButton = ref<HTMLButtonElement>()
const fullscreen = ref(false)
const fullscreenSupported = ref(false)
const fullscreenError = ref(false)
const allLyricsOpen = ref(false)
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
  if (wasFullscreen && !fullscreen.value) expandButton.value?.focus()
}

onMounted(() => {
  fullscreenSupported.value = !!document.fullscreenEnabled
  document.addEventListener('fullscreenchange', syncFullscreen)
})
onUnmounted(() => document.removeEventListener('fullscreenchange', syncFullscreen))
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
.singing-guide:fullscreen { border: 0; border-radius: 0; overflow-y: auto; width: 100%; height: 100%; padding: clamp(20px, 4vw, 64px); }
.singing-guide:fullscreen .guide-lyrics { max-width: 1100px; margin: auto; }
.singing-guide:fullscreen .guide-footer { max-width: 800px; margin: auto; }
.singing-guide:fullscreen .current-line { font-size: clamp(30px, 5vw, 76px); }
@container (max-width: 340px) {
  .guide-action { font-size: 11px; padding: 4px; gap: 4px; }
  .guide-transport { gap: 6px; }
  .upcoming-line { gap: 8px; }
}
</style>
