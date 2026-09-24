<template>
  <details class="lyrics-timing-control" :class="{ 'on-stage': onStage }" @toggle="timingOpen = ($event.target as HTMLDetailsElement).open">
    <summary>
      <span>{{ $t('lyrics.adjustTiming') }}</span>
      <span v-if="referenceLine" class="start-badge">{{ $t('lyrics.startAtShort', { seconds: singingStart.toFixed(1) }) }}</span>
    </summary>
    <div v-if="timingOpen" class="timing-controls">
      <div v-if="referenceLine" class="singing-start-controls">
        <label class="reference-field">
          <span>{{ $t('lyrics.firstSungLine') }}</span>
          <select :value="referenceIndex" @change="chooseReference">
            <option v-for="entry in selectableLines" :key="entry.index" :value="entry.index">{{ entry.line.text }}</option>
          </select>
        </label>
        <p class="timing-help">{{ $t('lyrics.singingStartHint') }}</p>
        <div class="singing-start-row">
          <label class="start-field">
            <span>{{ $t('lyrics.singingStartsAt') }}</span>
            <span class="offset-field">
              <input type="number" step="0.1" min="0" :max="player.duration || MAX_LYRICS_OFFSET" :value="singingStart.toFixed(1)"
                @change="changeSingingStart" @keydown.enter="($event.target as HTMLInputElement).blur()" />
              <span aria-hidden="true">{{ $t('lyrics.secondsShort') }}</span>
            </span>
          </label>
          <button type="button" class="starts-now" @click="startsNow">{{ $t('lyrics.startsNow') }}</button>
        </div>
        <p v-if="startError" class="start-error" role="alert">{{ $t('lyrics.invalidSingingStart') }}</p>
      </div>

      <details class="fine-timing">
        <summary>{{ $t('lyrics.fineTuneOffset') }} <span class="offset-badge">{{ signedOffset }} {{ $t('lyrics.secondsShort') }}</span></summary>
        <p class="timing-help">{{ $t('lyrics.offsetHint') }}</p>
        <div class="offset-input-row">
          <button type="button" @click="setOffset(offset - 0.5)" :disabled="offset <= -MAX_LYRICS_OFFSET"
            :aria-label="$t('lyrics.earlierStep')" :title="$t('lyrics.earlierStep')">{{ $t('lyrics.earlier') }}</button>
          <label class="offset-field">
            <span class="sr-only">{{ $t('lyrics.offsetSeconds') }}</span>
            <input type="number" step="0.1" :min="-MAX_LYRICS_OFFSET" :max="MAX_LYRICS_OFFSET" :value="offset.toFixed(1)"
              @change="changeOffset" @keydown.enter="($event.target as HTMLInputElement).blur()" />
            <span aria-hidden="true">{{ $t('lyrics.secondsShort') }}</span>
          </label>
          <button type="button" @click="setOffset(offset + 0.5)" :disabled="offset >= MAX_LYRICS_OFFSET"
            :aria-label="$t('lyrics.laterStep')" :title="$t('lyrics.laterStep')">{{ $t('lyrics.later') }}</button>
        </div>
        <p class="timing-help">{{ offset === 0 ? $t('lyrics.offsetOriginal')
          : $t(offset < 0 ? 'lyrics.offsetEarlier' : 'lyrics.offsetLater', { seconds: Math.abs(offset).toFixed(1) }) }}</p>
      </details>
      <div class="offset-status-row">
        <p role="status">{{ referenceLine ? $t('lyrics.singingStartStatus', { seconds: singingStart.toFixed(1) }) : $t('lyrics.offsetOriginal') }}</p>
        <button type="button" class="offset-reset" @click="setOffset(0)" :disabled="offset === 0">{{ $t('lyrics.resetTiming') }}</button>
      </div>
      <p class="timing-help" :role="saveFailed ? 'status' : undefined">{{ $t(saveFailed ? 'lyrics.offsetSaveFailed' : 'lyrics.offsetSaved') }}</p>
    </div>
  </details>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useLyricsOffset } from '@/composables/useLyricsOffset'
import { usePlayerStore } from '@/stores/player'
import { MAX_LYRICS_OFFSET, lyricSeekTime, offsetFromSingingStart, singingStartLineIndex, singingLineTime } from '@/utils/lyricsOffset'
import type { LyricLine } from '@/types'

const props = defineProps<{ songId: number; lines: LyricLine[]; onStage?: boolean }>()
const player = usePlayerStore()
const timingOpen = ref(false)
const { offset, setOffset, startLine, setStartLine, saveFailed } = useLyricsOffset(computed(() => props.songId))
const signedOffset = computed(() => `${offset.value > 0 ? '+' : ''}${offset.value.toFixed(1)}`)
// No dependency on the playback clock: the line list and fields remain stable
// while singing. Only the Starts now click reads the current playback position.
const selectableLines = computed(() => props.lines.map((line, index) => ({ line, index })).filter(({ line }) => line.text.trim()))
const referenceIndex = computed(() => singingStartLineIndex(props.lines, startLine.value))
const referenceLine = computed(() => props.lines[referenceIndex.value])
const singingStart = computed(() => referenceLine.value ? lyricSeekTime(singingLineTime(referenceLine.value), offset.value, player.duration) : 0)
const startError = ref(false)
watch(() => [props.songId, referenceIndex.value, offset.value], () => { startError.value = false })

function chooseReference(event: Event) {
  const line = props.lines[Number((event.target as HTMLSelectElement).value)]
  if (line?.text.trim()) setStartLine(line)
}

function setSingingStart(seconds: number) {
  const line = referenceLine.value
  if (!line) return
  const value = offsetFromSingingStart(singingLineTime(line), seconds, player.duration)
  if (value === null) { startError.value = true; return }
  startError.value = false
  setOffset(value, line)
}

function startsNow() {
  setSingingStart(player.audioElement?.currentTime ?? player.currentTime)
}

function changeSingingStart(event: Event) {
  const input = event.target as HTMLInputElement
  setSingingStart(input.valueAsNumber)
  input.value = singingStart.value.toFixed(1)
}

function changeOffset(event: Event) {
  const input = event.target as HTMLInputElement
  if (Number.isFinite(input.valueAsNumber)) setOffset(input.valueAsNumber)
  input.value = offset.value.toFixed(1)
}
</script>

<style scoped>
.lyrics-timing-control { margin-bottom: 16px; padding: 10px 12px; border: 1px solid #cbd5e1; border-radius: 10px; color: #334155; font-size: 12px; }
.lyrics-timing-control summary { cursor: pointer; min-height: 24px; line-height: 24px; }
.offset-badge, .start-badge { float: right; margin-left: 8px; font-weight: 600; font-variant-numeric: tabular-nums; }
.timing-controls { padding-top: 8px; }
.reference-field, .start-field { display: flex; flex-direction: column; gap: 6px; }
.reference-field { margin-bottom: 8px; }
.reference-field select { width: 100%; min-width: 0; min-height: 36px; border: 1px solid #94a3b8; border-radius: 6px; background: transparent; padding: 6px; text-overflow: ellipsis; }
.reference-field option { background: white; color: #334155; }
.singing-start-row { display: flex; align-items: flex-end; gap: 12px; margin: 12px 0; }
.start-field { flex: 1; min-width: 0; }
.start-field input { width: 90px; }
.starts-now { flex-shrink: 0; font-weight: 600; }
.fine-timing { margin: 12px 0; padding-top: 8px; border-top: 1px solid #94a3b850; }
.start-error { color: #b91c1c; font-size: 11px; }
.timing-help { font-size: 11px; line-height: 1.5; opacity: .85; }
.offset-input-row { display: flex; gap: 6px; margin: 12px 0 8px; align-items: center; }
.offset-input-row > button { flex: 1; }
button { min-height: 36px; border: 1px solid #94a3b8; border-radius: 6px; padding: 4px 6px; }
button:not(:disabled):hover { background: #64748b20; }
button:disabled { opacity: .4; cursor: default; }
.offset-field { display: flex; align-items: center; gap: 3px; min-width: 0; }
input { width: 66px; min-height: 36px; border: 1px solid #94a3b8; border-radius: 6px; background: transparent; padding: 4px; text-align: center; font-variant-numeric: tabular-nums; }
.offset-status-row { display: flex; align-items: center; gap: 8px; justify-content: space-between; margin-bottom: 8px; }
.offset-reset { flex-shrink: 0; }
button:focus-visible, input:focus-visible, select:focus-visible, summary:focus-visible { outline: 2px solid #16a34a; outline-offset: 2px; }
.on-stage, .dark .lyrics-timing-control { color: #c1d5d0; border-color: #38534f; color-scheme: dark; }
.on-stage button, .on-stage input, .on-stage select, .dark .lyrics-timing-control button, .dark .lyrics-timing-control input, .dark .lyrics-timing-control select { border-color: #58756b; }
.on-stage option, .dark .lyrics-timing-control option { background: #182720; color: #c1d5d0; }
.on-stage .start-error, .dark .lyrics-timing-control .start-error { color: #fca5a5; }
</style>
