import { app, ipcMain } from 'electron'
import { getStore } from '../ipc/store'

const REPO_OWNER = 'pjmdesi'
const REPO_NAME = 'stream-manager'
const RELEASE_API = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`
const CACHE_TTL_MS = 6 * 60 * 60 * 1000 // 6 hours
const STORE_KEY = 'updateCheckCache'

export interface UpdateCheckResult {
  current: string
  latest: string | null
  hasUpdate: boolean
  releaseUrl: string | null
  releaseNotes: string | null
}

interface CacheEntry {
  checkedAt: number
  latest: string
  releaseUrl: string
  releaseNotes: string
}

/** Compare two semver-ish version strings. Returns 1 if a > b, -1 if a < b,
 *  0 if equal. Tolerant of leading 'v' and missing pre-release tags. */
function compareVersions(a: string, b: string): number {
  const norm = (v: string) => v.replace(/^v/i, '').split('-')[0]
  const aParts = norm(a).split('.').map(n => parseInt(n, 10) || 0)
  const bParts = norm(b).split('.').map(n => parseInt(n, 10) || 0)
  const len = Math.max(aParts.length, bParts.length)
  for (let i = 0; i < len; i++) {
    const ai = aParts[i] ?? 0
    const bi = bParts[i] ?? 0
    if (ai > bi) return 1
    if (ai < bi) return -1
  }
  return 0
}

async function fetchLatestRelease(): Promise<{ tag: string; url: string; notes: string } | null> {
  try {
    const res = await fetch(RELEASE_API, {
      headers: {
        // Some user-agent is required by the GitHub API.
        'User-Agent': `${REPO_NAME}-app/${app.getVersion()}`,
        'Accept': 'application/vnd.github+json',
      },
    })
    if (!res.ok) return null
    const data = await res.json() as { tag_name?: string; html_url?: string; body?: string }
    if (!data.tag_name || !data.html_url) return null
    return { tag: data.tag_name, url: data.html_url, notes: data.body ?? '' }
  } catch {
    return null
  }
}

/** Resolve the cached or fresh latest-release info. Cache hit when within
 *  TTL. Cache miss / expired runs the network call and refreshes the store.
 *  Network failures silently fall back to cached data when present, or return
 *  null. The check itself never throws — callers can ignore failures. */
async function getLatestRelease(force = false): Promise<CacheEntry | null> {
  const store = getStore() as unknown as { get: (k: string, d?: CacheEntry | null) => CacheEntry | null; set: (k: string, v: CacheEntry) => void }
  const cached = store.get(STORE_KEY, null)
  const now = Date.now()
  if (!force && cached && (now - cached.checkedAt) < CACHE_TTL_MS) {
    return cached
  }
  const fresh = await fetchLatestRelease()
  if (!fresh) return cached // stay with stale cache on transient failures
  const entry: CacheEntry = {
    checkedAt: now,
    latest: fresh.tag,
    releaseUrl: fresh.url,
    releaseNotes: fresh.notes,
  }
  store.set(STORE_KEY, entry)
  return entry
}

export async function checkForUpdate(force = false): Promise<UpdateCheckResult> {
  const current = app.getVersion()
  const cfg = getStore().get('config') as { checkForUpdates?: boolean } | undefined
  // Honor user opt-out unless force=true (manual "check now" button).
  if (!force && cfg?.checkForUpdates === false) {
    return { current, latest: null, hasUpdate: false, releaseUrl: null, releaseNotes: null }
  }
  const entry = await getLatestRelease(force)
  if (!entry) return { current, latest: null, hasUpdate: false, releaseUrl: null, releaseNotes: null }
  return {
    current,
    latest: entry.latest,
    hasUpdate: compareVersions(entry.latest, current) > 0,
    releaseUrl: entry.releaseUrl,
    releaseNotes: entry.releaseNotes,
  }
}

export function registerUpdateCheckIPC(): void {
  // Renderer-triggered manual check (e.g., a "check now" button).
  ipcMain.handle('update:check', (_e, force?: boolean) => checkForUpdate(!!force))
}
