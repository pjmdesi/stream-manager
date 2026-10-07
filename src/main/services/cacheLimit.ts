import { audioCacheManager } from './audioCacheManager'
import { thumbnailCacheManager } from './thumbnailCacheManager'
import { waveformCacheManager } from './waveformCacheManager'
import { getConfig } from '../ipc/store'

/**
 * One limit for every cache (Settings, Cache limit). Each manager lists its
 * entries with a size and a last-used time; when the total passes the
 * limit, the least recently used entries go first, whichever cache they
 * belong to, until the total fits. Reads touch their entries, so what the
 * user is looking at survives and what they have not opened in months
 * goes. Until 2026-09-29 the limit governed the extracted audio tracks
 * only; the thumbnail strips and waveforms grew without bound.
 *
 * Enforcement is debounced: a write schedules a pass a few seconds later,
 * so a burst (200 row thumbnails at startup, 200 strip frames per video)
 * costs one walk of the cache folders, not one per file.
 */

export interface CacheEntryInfo {
  size: number
  /** Milliseconds since the epoch; older evicts first. */
  lastUsed: number
  remove: () => void
}

export const DEFAULT_CACHE_LIMIT_BYTES = 1_073_741_824
export const MIN_CACHE_LIMIT_BYTES = 512 * 1024 * 1024

function currentLimit(): number {
  return Math.max(MIN_CACHE_LIMIT_BYTES, getConfig().audioCacheLimit)
}

export function enforceCacheLimit(limitBytes: number = currentLimit()): void {
  const entries: CacheEntryInfo[] = [
    ...audioCacheManager.listEntries(),
    ...thumbnailCacheManager.listEntries(),
    ...waveformCacheManager.listEntries(),
  ]
  let total = entries.reduce((s, e) => s + e.size, 0)
  if (total <= limitBytes) return
  entries.sort((a, b) => a.lastUsed - b.lastUsed)
  for (const e of entries) {
    if (total <= limitBytes) break
    try { e.remove(); total -= e.size } catch (err) { console.warn('[cache] eviction failed', err) }
  }
}

let timer: ReturnType<typeof setTimeout> | null = null
export function scheduleCacheEnforcement(delayMs = 5000): void {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    try { enforceCacheLimit() } catch (err) { console.warn('[cache] enforcement failed', err) }
  }, delayMs)
}
