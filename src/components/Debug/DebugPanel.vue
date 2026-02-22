<template>
  <!-- Only renders when VITE_DEBUG_PLAYER=true -->
  <template v-if="isDebugMode">
    <!-- Floating toggle button — sits above the mobile player bar -->
    <button
      @click="isOpen = !isOpen"
      class="fixed z-[200] bottom-36 right-2 w-9 h-9 rounded-full bg-red-700 text-white flex items-center justify-center shadow-xl text-base sm:bottom-28"
      title="Toggle Debug Panel"
    >🐛</button>

    <!-- Full-screen debug overlay -->
    <div
      v-if="isOpen"
      class="fixed inset-0 z-[199] flex flex-col bg-black/95 text-xs font-mono overflow-hidden"
    >
      <!-- ── Header ── -->
      <div class="flex items-center justify-between px-3 py-2 bg-gray-900 border-b border-gray-700 flex-shrink-0">
        <span class="text-white font-bold">🐛 Player Debug <span class="text-gray-400 font-normal text-[10px]">{{ buildLabel }}</span></span>
        <div class="flex items-center gap-1.5">
          <button @click="copyLog" class="px-2 py-1 bg-blue-800 text-white rounded">Copy</button>
          <button @click="debugLogger.clear()" class="px-2 py-1 bg-yellow-800 text-white rounded">Clear</button>
          <button @click="isOpen = false" class="px-2 py-1 bg-gray-700 text-white rounded">✕</button>
        </div>
      </div>

      <!-- ── Current state grid ── -->
      <div class="bg-gray-950 border-b border-gray-800 px-3 py-2 flex-shrink-0 grid grid-cols-2 gap-x-6 gap-y-0.5 leading-5">
        <div>Song: <span class="text-white">#{{ player.currentSong?.id }} {{ (player.currentSong?.title ?? '—').slice(0, 24) }}</span></div>
        <div>Playing: <b :class="player.isPlaying ? 'text-green-400' : 'text-red-400'">{{ player.isPlaying }}</b></div>

        <div>Time: <span class="text-white">{{ player.formattedCurrentTime }} / {{ player.formattedDuration }}</span></div>
        <div>LastPlayState: <b :class="player.lastPlayState ? 'text-green-400' : 'text-red-400'">{{ player.lastPlayState }}</b></div>

        <div>Transitioning: <b :class="player.isTransitioning ? 'text-yellow-400' : 'text-gray-500'">{{ player.isTransitioning }}</b></div>
        <div>EndedHandled: <b :class="player.endedHandled ? 'text-yellow-400' : 'text-gray-500'">{{ player.endedHandled }}</b></div>

        <div>Online: <b :class="player.isOnline ? 'text-green-400' : 'text-red-400'">{{ player.isOnline }}</b></div>
        <div>Retries: <span class="text-white">{{ player.networkRetryAttempts }}</span></div>

        <div>ReadyState: <span class="text-white">{{ audioSnap.readyState }} <span class="text-gray-500">{{ readyStateLabel }}</span></span></div>
        <div>NetworkState: <span class="text-white">{{ audioSnap.networkState }}</span></div>

        <div>Audio paused: <b :class="audioSnap.paused ? 'text-red-400' : 'text-green-400'">{{ audioSnap.paused }}</b></div>
        <div>Audio ended: <b :class="audioSnap.ended ? 'text-yellow-400' : 'text-gray-500'">{{ audioSnap.ended }}</b></div>
      </div>

      <!-- ── Action buttons ── -->
      <div class="bg-gray-950 border-b border-gray-800 px-3 py-2 flex gap-1.5 flex-wrap flex-shrink-0">
        <button @click="player.nextSong()" class="px-2 py-1 bg-green-800 text-white rounded">▶▶ Next</button>
        <button @click="player.togglePlay()" class="px-2 py-1 bg-blue-800 text-white rounded">⏯ Play/Pause</button>
        <button @click="forceEnd()" class="px-2 py-1 bg-orange-800 text-white rounded">⏹ Force End</button>
        <button @click="refreshSnap()" class="px-2 py-1 bg-gray-700 text-white rounded">↺ Refresh</button>
      </div>

      <!-- ── Log entries ── -->
      <div class="flex-1 overflow-y-auto px-2 py-1">
        <div v-if="debugLogs.length === 0" class="text-gray-600 text-center py-6">No events logged yet</div>
        <div
          v-for="entry in debugLogs"
          :key="entry.id"
          class="flex gap-2 py-0.5 border-b border-gray-900 leading-4"
          :class="{
            'text-gray-300': entry.level === 'info',
            'text-yellow-300': entry.level === 'warn',
            'text-red-300':   entry.level === 'error',
          }"
        >
          <span class="text-gray-600 flex-shrink-0 w-[7rem]">{{ entry.time }}</span>
          <span class="text-blue-400 flex-shrink-0 w-[3.5rem]">[{{ entry.category }}]</span>
          <span class="flex-1 break-all">{{ entry.message }}</span>
          <span v-if="entry.detail" class="text-gray-600 ml-1 flex-shrink-0 max-w-[6rem] truncate" :title="entry.detail">{{ entry.detail }}</span>
        </div>
      </div>
    </div>
  </template>
</template>

<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue'
import { usePlayerStore } from '@/stores/player'
import { isDebugMode, debugLogs, debugLogger } from '@/services/debugLogger'

const buildDate = new Date(__APP_BUILD_TIME__)
const buildLabel = buildDate.toLocaleDateString('en', { month: 'short', day: 'numeric' })
  + ' ' + buildDate.toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit', hour12: false })

const player = usePlayerStore()
const isOpen = ref(false)

// Polled audio element snapshot (DOM properties aren't Vue-reactive)
const audioSnap = ref({ readyState: 0, networkState: 0, paused: true, ended: false })
let snapInterval: number | null = null

function refreshSnap() {
  const a = player.audioElement
  if (!a) return
  audioSnap.value = {
    readyState:   a.readyState,
    networkState: a.networkState,
    paused:       a.paused,
    ended:        a.ended,
  }
}

watch(isOpen, (open) => {
  if (open) {
    refreshSnap()
    snapInterval = window.setInterval(refreshSnap, 500)
  } else {
    if (snapInterval !== null) { clearInterval(snapInterval); snapInterval = null }
  }
})

onUnmounted(() => {
  if (snapInterval !== null) clearInterval(snapInterval)
})

const readyStateLabel = computed(() => {
  const labels = ['HAVE_NOTHING', 'HAVE_METADATA', 'HAVE_CURRENT_DATA', 'HAVE_FUTURE_DATA', 'HAVE_ENOUGH_DATA']
  return labels[audioSnap.value.readyState] ?? ''
})

function forceEnd() {
  const a = player.audioElement
  if (a && a.duration && isFinite(a.duration)) {
    debugLogger.warn('DEBUG', 'User triggered force-end — seeking to duration-0.1s')
    a.currentTime = a.duration - 0.1
  } else {
    debugLogger.warn('DEBUG', 'Force-end: no valid duration')
  }
}

async function copyLog() {
  const text = debugLogs.value
    .map(e => `${e.time} [${e.category}] ${e.level.toUpperCase()}: ${e.message}${e.detail ? ' | ' + e.detail : ''}`)
    .join('\n')
  try {
    await navigator.clipboard.writeText(text)
    alert(`Copied ${debugLogs.value.length} log entries`)
  } catch {
    alert('Copy failed — check browser permissions')
  }
}
</script>
