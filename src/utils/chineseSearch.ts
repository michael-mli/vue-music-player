import { Converter } from 'opencc-js/t2cn'
import type { ConverterFunction } from 'opencc-js/t2cn'

let converter: ConverterFunction | null = null

function toSimplifiedConverter(): ConverterFunction {
  if (!converter) converter = Converter({ from: 'tw', to: 'cn' })
  return converter
}

// Normalized strings are cached so repeated searches (per query keystroke) don't
// re-run the converter over the same titles/lyrics thousands of times.
const normalizedCache = new Map<string, string>()
const MAX_CACHE_ENTRIES = 20_000

/**
 * Normalize a string for variant-insensitive Chinese search: converts traditional
 * Chinese to simplified and lowercases, caching the result. Already-simplified text
 * is left untouched, so comparing both the query and a title/lyrics in this space
 * makes a simplified search match traditional results and vice versa.
 */
export function normalizeForSearch(text: string): string {
  const cached = normalizedCache.get(text)
  if (cached !== undefined) return cached
  const normalized = toSimplifiedConverter()(text).toLowerCase()
  if (normalizedCache.size >= MAX_CACHE_ENTRIES) normalizedCache.clear()
  normalizedCache.set(text, normalized)
  return normalized
}