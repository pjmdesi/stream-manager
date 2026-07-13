/**
 * Per-path echo registry for the app's own filesystem writes.
 *
 * Writers (thumbnail saves, converter outputs, cancelled-partial deletes)
 * register the exact path they are about to touch; the streams chokidar
 * watcher asks `consumeSelfWrite` for every event and silently drops
 * matches. This replaces the shotgun approach of the global suppression
 * window for the common case: the window deferred EVERY event for its
 * duration (including genuinely external changes), while the registry
 * drops only the echoes of the write that was announced.
 *
 * Entries are NOT removed on consume — a single write produces several
 * chokidar events (add + change + awaitWriteFinish settling, and unlink
 * for deletes), all of which must be swallowed. They expire by TTL, sized
 * to comfortably cover awaitWriteFinish (1s stability) plus the watcher
 * debounce.
 *
 * Same cycle-free pattern as inFlightWrites: no imports, so both the
 * watchers and the writers can depend on it statically.
 */
const expected = new Map<string, number>()

const DEFAULT_TTL_MS = 8000

function norm(p: string): string {
  return p.replace(/\\/g, '/').toLowerCase()
}

/** Announce an imminent app-side write (or delete) of `path`. */
export function expectSelfWrite(path: string, ttlMs = DEFAULT_TTL_MS): void {
  if (!path) return
  expected.set(norm(path), Date.now() + ttlMs)
  // Opportunistic sweep so long sessions don't accumulate dead entries.
  if (expected.size > 256) {
    const now = Date.now()
    for (const [k, exp] of expected) { if (now > exp) expected.delete(k) }
  }
}

/** True when a chokidar event for `path` is an echo of an announced
 *  app-side write and should be dropped. */
export function consumeSelfWrite(path: string): boolean {
  const k = norm(path)
  const exp = expected.get(k)
  if (exp === undefined) return false
  if (Date.now() > exp) { expected.delete(k); return false }
  return true
}
