import fs from 'fs'
import path from 'path'

/**
 * Streams-root file watcher: ONE recursive `fs.watch` handle on the root
 * directory and nothing else.
 *
 * Why not chokidar (STR-23): chokidar registers a separate `fs.watch` for
 * every file in the tree, and since Electron 44 (libuv 1.52) each of those
 * registrations opens the watched file with read-data access before it
 * watches the parent directory. On a cloud sync root that is a data-access
 * open of every placeholder in the library, which Windows reports to the
 * sync client as app-initiated downloads and the client answers by
 * hydrating files to build thumbnails. It also held a few thousand
 * directory handles, which is why every delete, rename, converter write,
 * and offload had to stop and rebuild the watcher.
 *
 * A single ReadDirectoryChangesW subscription on the root reports every
 * add, change, and delete below it by relative path without opening any
 * file, holds one handle that is never on the folder being moved or
 * dehydrated, and costs nothing to restart. What chokidar used to do on top
 * of the raw events is rebuilt here: rename events are classified as add or
 * unlink with one stat (a stat does not hydrate a placeholder), file events
 * wait for write stability the way awaitWriteFinish did, directory events
 * are told apart from file events, and a buffer overflow (a burst larger
 * than the change buffer, after which Windows reports a null filename)
 * surfaces as `onOverflow` so the caller can reconcile once.
 */

export type WatchFileKind = 'add' | 'change' | 'unlink'
export type WatchDirKind = 'addDir' | 'unlinkDir'

export interface StreamsWatcherOptions {
  /** Absolute root directory. Must exist. */
  dir: string
  /** Deepest level below the root to report, counted in directories: 0 is
   *  the root's direct children only, 6 reaches files six folders down. */
  depth: number
  /** Paths (absolute) the watcher must stay silent about. */
  ignored: (absPath: string) => boolean
  onFile: (absPath: string, kind: WatchFileKind) => void
  onDir: (absPath: string, kind: WatchDirKind) => void
  /** Events were lost to a change-buffer overflow; reconcile with a scan. */
  onOverflow: () => void
  onError: (err: Error) => void
  /** A file add or change is reported once its size and mtime have held
   *  still for this long (default 1000 ms), polled every `pollMs` (default
   *  300 ms, backing off to 2 s for writes that run longer than 30 s, such
   *  as a recording in progress). */
  stabilityMs?: number
  pollMs?: number
}

export interface StreamsWatcher {
  close(): void
}

interface Pending {
  kind: WatchFileKind
  timer: ReturnType<typeof setTimeout> | null
  size: number
  mtimeMs: number
  lastChangeAt: number
  startedAt: number
}

const SLOW_POLL_AFTER_MS = 30_000
const SLOW_POLL_MS = 2_000

export function startStreamsWatcher(opts: StreamsWatcherOptions): StreamsWatcher {
  const stabilityMs = opts.stabilityMs ?? 1000
  const pollMs = opts.pollMs ?? 300
  const root = path.resolve(opts.dir)
  const pending = new Map<string, Pending>()
  let closed = false

  const depthOf = (rel: string): number => rel.split(/[\\/]+/).filter(Boolean).length - 1

  const emitFile = (abs: string, kind: WatchFileKind) => { if (!closed) opts.onFile(abs, kind) }
  const emitDir = (abs: string, kind: WatchDirKind) => { if (!closed) opts.onDir(abs, kind) }

  const clearPending = (abs: string) => {
    const p = pending.get(abs)
    if (!p) return
    if (p.timer) clearTimeout(p.timer)
    pending.delete(abs)
  }

  // Write stability: keep polling size and mtime until they stop moving for
  // `stabilityMs`, then report once. A file that vanishes while we wait is
  // reported as an unlink so the consumer still reconciles that stream.
  const poll = (abs: string) => {
    const p = pending.get(abs)
    if (!p || closed) return
    p.timer = null
    fs.stat(abs, (err, st) => {
      const cur = pending.get(abs)
      if (!cur || cur !== p || closed) return
      if (err) {
        pending.delete(abs)
        emitFile(abs, 'unlink')
        return
      }
      if (st.isDirectory()) { pending.delete(abs); return }
      const now = Date.now()
      if (st.size !== p.size || st.mtimeMs !== p.mtimeMs) {
        p.size = st.size
        p.mtimeMs = st.mtimeMs
        p.lastChangeAt = now
      } else if (now - p.lastChangeAt >= stabilityMs) {
        pending.delete(abs)
        emitFile(abs, p.kind)
        return
      }
      const interval = now - p.startedAt > SLOW_POLL_AFTER_MS ? SLOW_POLL_MS : pollMs
      p.timer = setTimeout(() => poll(abs), interval)
    })
  }

  const fileTouched = (abs: string, kind: 'add' | 'change', st: fs.Stats) => {
    const existing = pending.get(abs)
    const now = Date.now()
    if (existing) {
      // Another write landed while we were waiting: restart the quiet clock.
      if (st.size !== existing.size || st.mtimeMs !== existing.mtimeMs) {
        existing.size = st.size
        existing.mtimeMs = st.mtimeMs
        existing.lastChangeAt = now
      }
      if (kind === 'add') existing.kind = 'add'
      return
    }
    const entry: Pending = { kind, timer: null, size: st.size, mtimeMs: st.mtimeMs, lastChangeAt: now, startedAt: now }
    pending.set(abs, entry)
    entry.timer = setTimeout(() => poll(abs), pollMs)
  }

  const onRaw = (eventType: string, filename: string | Buffer | null) => {
    if (closed) return
    if (filename == null) { opts.onOverflow(); return }
    const rel = String(filename)
    if (!rel || depthOf(rel) > opts.depth) return
    const abs = path.join(root, rel)
    if (opts.ignored(abs)) return

    fs.stat(abs, (err, st) => {
      if (closed) return
      if (err) {
        // Gone. A path without an extension is almost always a directory
        // (stream folders are date-named); a wrong guess only changes the
        // reload from scoped to full, and the consumer removes vanished
        // streams either way.
        clearPending(abs)
        if (path.extname(rel) === '') emitDir(abs, 'unlinkDir')
        else emitFile(abs, 'unlink')
        return
      }
      if (st.isDirectory()) {
        // Directories only matter when they appear; a directory "change"
        // (its own mtime moving because a child changed) is noise, the
        // child's own event carries the information.
        if (eventType === 'rename') emitDir(abs, 'addDir')
        return
      }
      fileTouched(abs, eventType === 'rename' ? 'add' : 'change', st)
    })
  }

  const watcher = fs.watch(root, { persistent: true, recursive: true }, onRaw)
  watcher.on('error', (err) => { if (!closed) opts.onError(err) })

  return {
    close() {
      if (closed) return
      closed = true
      for (const p of pending.values()) if (p.timer) clearTimeout(p.timer)
      pending.clear()
      try { watcher.close() } catch { /* already closed */ }
    },
  }
}
