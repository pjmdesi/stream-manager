// Process-lifetime cache of per-file hydration status (true = available on
// disk, false = offloaded to the cloud), shared by the streams list's
// video-counter tooltips and the detail sidebar's files grid.
//
// Why: each surface used to keep its own component-state copy, seeded by a
// checkLocalFiles IPC on mount/hover. The files grid unmounts when the sidebar
// closes, so every reopen re-spun the cloud indicators AND fired the IPC again
// — whose reply, landing mid-slide, stuttered the open animation. A shared
// cache lets any surface paint the last-known status INSTANTLY (no spinner,
// no work during the slide).
//
// The cache is also the surfaces' single source of truth for *changes*:
//  - Subscriptions: mounted surfaces subscribe and update their state when any
//    path's status changes — so a hydration triggered anywhere (send-to-player,
//    the player page, a cloud op) flips the icons in an open sidebar live,
//    instead of only after a close/reopen.
//  - Freshness: every entry records when it was last verified. Surfaces skip
//    the checkLocalFiles IPC for paths verified within CHECK_TTL_MS, so the
//    grid and the tooltip stop re-running each other's work back-to-back.
//    External changes (e.g. Synology offloading a file on its own) are still
//    picked up once the TTL lapses; changes made through SM update the cache
//    directly and don't wait.

interface Entry {
  isLocal: boolean
  checkedAt: number
}

/** How long a verified status is trusted before a surface re-checks it. */
export const CHECK_TTL_MS = 30_000

const cache = new Map<string, Entry>()

type Listener = (path: string, isLocal: boolean) => void
const listeners = new Set<Listener>()

function set(path: string, isLocal: boolean): void {
  const prev = cache.get(path)
  cache.set(path, { isLocal, checkedAt: Date.now() })
  // Only notify on actual status changes — timestamps refresh silently, so
  // subscribers don't re-render for "still the same" confirmations.
  if (prev?.isLocal !== isLocal) for (const l of listeners) l(path, isLocal)
}

/** Cached status for the given paths (unknown paths are omitted). */
export function getCachedHydration(paths: string[]): Record<string, boolean> {
  const out: Record<string, boolean> = {}
  for (const p of paths) {
    const e = cache.get(p)
    if (e !== undefined) out[p] = e.isLocal
  }
  return out
}

/** The subset of paths with no cached status, or one older than the TTL —
 *  i.e. what a surface actually needs to send through checkLocalFiles. */
export function stalePaths(paths: string[], maxAgeMs: number = CHECK_TTL_MS): string[] {
  const cutoff = Date.now() - maxAgeMs
  return paths.filter(p => {
    const e = cache.get(p)
    return e === undefined || e.checkedAt < cutoff
  })
}

/** Merge fresh checkLocalFiles results into the cache. */
export function rememberHydration(updates: Record<string, boolean>): void {
  for (const p in updates) set(p, updates[p])
}

/** Update a single path — e.g. as a cloud op reaches a terminal state. */
export function rememberHydrationOne(path: string, isLocal: boolean): void {
  set(path, isLocal)
}

/** Subscribe to status CHANGES (not timestamp refreshes). Returns unsubscribe.
 *  Lets a mounted surface mirror cache updates into its own state, so work
 *  done by any other surface (or a completed download) shows up live. */
export function subscribeHydration(listener: Listener): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

// A completed cloud download means the file is now local — keep the shared
// cache fresh app-wide so any surface reflects it without its own listener.
if (typeof window !== 'undefined' && window.api?.onCloudDownloadDone) {
  window.api.onCloudDownloadDone((filePath: string) => set(filePath, true))
}
