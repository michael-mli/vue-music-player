/**
 * Debug Logger Service
 * Controlled by VITE_DEBUG_PLAYER=true in .env
 * Collects timestamped event entries for the in-app DebugPanel.
 */
import { ref } from 'vue'

export interface LogEntry {
  id: number
  time: string
  category: string
  level: 'info' | 'warn' | 'error'
  message: string
  detail?: string
}

export const isDebugMode = import.meta.env.VITE_DEBUG_PLAYER === 'true'

const MAX_ENTRIES = 500
let nextId = 0

/** Reactive log — newest entry first */
export const debugLogs = ref<LogEntry[]>([])

function timestamp(): string {
  const d = new Date()
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  const ms = String(d.getMilliseconds()).padStart(3, '0')
  return `${hh}:${mm}:${ss}.${ms}`
}

function push(level: LogEntry['level'], category: string, message: string, detail?: any) {
  if (!isDebugMode) return
  const detailStr =
    detail === undefined
      ? undefined
      : typeof detail === 'string'
        ? detail
        : JSON.stringify(detail)
  debugLogs.value.unshift({ id: ++nextId, time: timestamp(), category, level, message, detail: detailStr })
  if (debugLogs.value.length > MAX_ENTRIES) debugLogs.value.length = MAX_ENTRIES
}

export const debugLogger = {
  info:  (cat: string, msg: string, detail?: any) => { push('info',  cat, msg, detail); if (isDebugMode) console.log(`[${cat}] ${msg}`, detail ?? '') },
  warn:  (cat: string, msg: string, detail?: any) => { push('warn',  cat, msg, detail); if (isDebugMode) console.warn(`[${cat}] ${msg}`, detail ?? '') },
  error: (cat: string, msg: string, detail?: any) => { push('error', cat, msg, detail); if (isDebugMode) console.error(`[${cat}] ${msg}`, detail ?? '') },
  clear: () => { debugLogs.value = [] },
}
