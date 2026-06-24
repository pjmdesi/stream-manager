// Process-lifetime cache of per-file hydration status (true = available on
// disk, false = offloaded to the cloud), shared by the streams list's
// video-counter tooltips and the detail sidebar's files grid.
//
// Why: each surface used to keep its own component-state copy, seeded by a
// checkLocalFiles IPC on mount/hover. The files grid unmounts when the sidebar
// closes, so every reopen re-spun the cloud indicators AND fired the IPC again
// — whose reply, landing mid-slide, stuttered the open animation. A shared
// cache lets any surface paint the last-known status INSTANTLY (no spinner,
// no work during the slide); a fresh check still runs in the background to
// catch files offloaded/hydrated since, so the cache is a fast first paint,
// not the authority.

const cache = new Map<string, boolean>()

/** Cached status for the given paths (unknown paths are omitted). */
export function getCachedHydration(paths: string[]): Record<string, boolean> {
  const out: Record<string, boolean> = {}
  for (const p of paths) {
    const v = cache.get(p)
    if (v !== undefined) out[p] = v
  }
  return out
}

/** Merge fresh checkLocalFiles results into the cache. */
export function rememberHydration(updates: Record<string, boolean>): void {
  for (const p in updates) cache.set(p, updates[p])
}

/** Update a single path — e.g. as a cloud op reaches a terminal state. */
export function rememberHydrationOne(path: string, isLocal: boolean): void {
  cache.set(path, isLocal)
}

// A completed cloud download means the file is now local — keep the shared
// cache fresh app-wide so any surface reflects it without its own listener.
if (typeof window !== 'undefined' && window.api?.onCloudDownloadDone) {
  window.api.onCloudDownloadDone((filePath: string) => cache.set(filePath, true))
}
