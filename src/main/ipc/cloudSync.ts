import { ipcMain, WebContents } from 'electron'
import { dehydrateOnePath, hydrateOnePath, isCfApiSyncRoot, DEHYDRATE_CONCURRENCY, HYDRATE_CONCURRENCY } from '../services/cfapi'
import { getProtectedPaths, pauseStreamsWatcher } from './streams'
import { getStore } from './store'

// Cached after first probe. Recomputed when streamsDir changes via the
// invalidate hook. The probe walks up to depth 3 of the streams root, which is
// cheap once but worth memoizing across the session.
let cachedActive: { dir: string; active: boolean } | null = null

function getStreamsDir(): string {
  const config = getStore().get('config') as { streamsDir?: string } | undefined
  return config?.streamsDir ?? ''
}

// `dirOverride` lets the renderer probe the directory it is CURRENTLY
// showing rather than whatever the store holds. During first-run setup the
// renderer updates its local config optimistically before the store write
// lands, so a store-read here could probe the old (empty) dir — that's how
// the cloud action buttons stayed hidden until an app restart.
function getActive(dirOverride?: string): boolean {
  const dir = (typeof dirOverride === 'string' && dirOverride.trim()) || getStreamsDir()
  if (!dir) return false
  if (cachedActive && cachedActive.dir === dir) return cachedActive.active
  const active = isCfApiSyncRoot(dir)
  cachedActive = { dir, active }
  return active
}

/** Call when streamsDir changes so the next isActive query re-probes. */
export function invalidateCloudSyncCache(): void {
  cachedActive = null
}

// ─── Shared-pool worker model ────────────────────────────────────────────────
//
// Each direction (offload | hydrate) owns a persistent unit queue drained by
// up to N concurrent workers (one PowerShell/CFAPI call per unit). Batches
// are bookkeeping only: every enqueued path becomes a unit tagged with its
// batch, so a batch enqueued mid-drain — e.g. the cloud modal's per-file
// retry — takes the NEXT FREE WORKER SLOT instead of waiting behind the
// whole in-flight batch (the old model drained strictly batch-at-a-time). A
// batch's 'complete' event fires when its last unit settles. The two
// directions still run in parallel with each other.
//
// Cancel is per-direction: it stamps every live batch at click time; their
// queued units are skipped (settled without running), in-flight units are
// allowed to finish — CfDehydrate/CfHydrate are never interrupted mid-call.
// Batches enqueued AFTER the cancel click are unaffected.

type Direction = 'offload' | 'hydrate'

interface BatchState {
  direction: Direction
  batchId: string
  sender: WebContents
  cancelled: boolean
  /** Units not yet settled (queued or in flight). 0 → emit 'complete'. */
  remaining: number
  ok: number
  failed: number
  /** already-offline (offload) / already-local (hydrate) count. */
  alreadySkipped: number
}

interface Unit {
  batch: BatchState
  path: string
}

const unitQueue: Record<Direction, Unit[]> = { offload: [], hydrate: [] }
const activeWorkers: Record<Direction, number> = { offload: 0, hydrate: 0 }
const liveBatches: Record<Direction, Set<BatchState>> = { offload: new Set(), hydrate: new Set() }

function safeSend(sender: WebContents, channel: string, payload: unknown): void {
  // The sender's window may have closed between events. Guard so a stale
  // batch from a reloaded page doesn't crash the worker.
  if (sender.isDestroyed()) return
  sender.send(channel, payload)
}

function sendComplete(b: BatchState): void {
  liveBatches[b.direction].delete(b)
  safeSend(b.sender, 'cloud-sync:progress', b.direction === 'offload'
    ? { type: 'complete', direction: 'offload', batchId: b.batchId, ok: b.ok, failed: b.failed, alreadyOffline: b.alreadySkipped, cancelled: b.cancelled }
    : { type: 'complete', direction: 'hydrate', batchId: b.batchId, ok: b.ok, failed: b.failed, alreadyLocal: b.alreadySkipped, cancelled: b.cancelled })
}

function settleUnit(b: BatchState): void {
  b.remaining -= 1
  if (b.remaining === 0) sendComplete(b)
}

// ─── Offload watcher pause ──────────────────────────────────────────────────
// The chokidar streams watcher must be down while ANY offload unit runs —
// its ReadDirectoryChangesW handles cause Synology Drive to reject
// CfDehydratePlaceholder with HRESULT 0x80070187 (file in use). The pause is
// held for the lifetime of the offload pool, not per batch. State machine:
// exactly one of {pause in flight, restart fn held, fully resumed} at a time.
// pauseStreamsWatcher is NOT refcounted (pausing while already paused hands
// back a no-op restart), so ensureOffloadPaused never double-pauses.
let offloadPauseP: Promise<void> | null = null
let offloadRestartFn: (() => void) | null = null

function ensureOffloadPaused(): Promise<void> {
  if (offloadRestartFn) return Promise.resolve() // already paused by us
  if (!offloadPauseP) {
    offloadPauseP = pauseStreamsWatcher().then(restart => {
      offloadRestartFn = restart
      offloadPauseP = null
      // The pool may have drained while the pause settled (e.g. every queued
      // unit belonged to a batch cancelled in the meantime) — resume now
      // rather than holding the watcher down forever.
      maybeResumeOffloadWatcher()
    })
  }
  return offloadPauseP
}

function maybeResumeOffloadWatcher(): void {
  if (!offloadRestartFn) return
  if (activeWorkers.offload > 0 || unitQueue.offload.length > 0) return
  const restart = offloadRestartFn
  offloadRestartFn = null
  restart()
}

// ─── Workers ────────────────────────────────────────────────────────────────

async function worker(direction: Direction): Promise<void> {
  try {
    while (true) {
      const unit = unitQueue[direction].shift()
      if (!unit) return
      const b = unit.batch
      if (b.cancelled) { settleUnit(b); continue }
      if (direction === 'offload') {
        await ensureOffloadPaused()
        if (b.cancelled) { settleUnit(b); continue } // re-check across the await
      }
      safeSend(b.sender, 'cloud-sync:progress', {
        type: 'item', direction, batchId: b.batchId, path: unit.path, status: 'running',
      })
      const res = direction === 'offload'
        ? await dehydrateOnePath(unit.path)
        : await hydrateOnePath(unit.path)
      if (res.outcome === 'ok') {
        b.ok += 1
        safeSend(b.sender, 'cloud-sync:progress', {
          type: 'item', direction, batchId: b.batchId, path: unit.path, status: 'done',
        })
      } else if (res.outcome === 'already-offline' || res.outcome === 'already-local') {
        b.alreadySkipped += 1
        safeSend(b.sender, 'cloud-sync:progress', {
          type: 'item', direction, batchId: b.batchId, path: unit.path, status: res.outcome,
        })
      } else {
        b.failed += 1
        safeSend(b.sender, 'cloud-sync:progress', {
          type: 'item', direction, batchId: b.batchId, path: unit.path, status: 'failed', reason: res.reason,
        })
      }
      settleUnit(b)
    }
  } finally {
    activeWorkers[direction] -= 1
    if (direction === 'offload') maybeResumeOffloadWatcher()
  }
}

function spinUp(direction: Direction): void {
  const max = direction === 'offload' ? DEHYDRATE_CONCURRENCY : HYDRATE_CONCURRENCY
  const want = Math.min(max, activeWorkers[direction] + unitQueue[direction].length)
  while (activeWorkers[direction] < want) {
    activeWorkers[direction] += 1
    void worker(direction)
  }
}

function enqueue(direction: Direction, sender: WebContents, paths: string[], batchId: string): void {
  // Protected paths (a stream's primary thumbnail) are offload-only skips.
  let eligible = paths
  let skipped: string[] = []
  if (direction === 'offload') {
    const protectedSet = getProtectedPaths(getStreamsDir())
    skipped = paths.filter(p => protectedSet.has(p))
    eligible = paths.filter(p => !protectedSet.has(p))
  }
  const b: BatchState = {
    direction, batchId, sender,
    cancelled: false,
    remaining: eligible.length,
    ok: 0, failed: 0, alreadySkipped: 0,
  }
  safeSend(sender, 'cloud-sync:progress', {
    type: 'init', direction, batchId, eligible, skippedProtected: skipped,
  })
  if (eligible.length === 0) { sendComplete(b); return }
  liveBatches[direction].add(b)
  for (const p of eligible) unitQueue[direction].push({ batch: b, path: p })
  spinUp(direction)
}

export function registerCloudSyncIPC(): void {
  ipcMain.handle('cloud-sync:is-active', (_e, dir?: string) => getActive(dir))

  ipcMain.handle('cloud-sync:offload', (event, paths: string[], batchId: string) => {
    if (!Array.isArray(paths) || paths.length === 0 || !batchId) return
    enqueue('offload', event.sender, paths, batchId)
  })

  ipcMain.handle('cloud-sync:pin', (event, paths: string[], batchId: string) => {
    if (!Array.isArray(paths) || paths.length === 0 || !batchId) return
    enqueue('hydrate', event.sender, paths, batchId)
  })

  // Per-direction cancels stamp every live batch. Subsequent enqueues are
  // NOT auto-cancelled (their cancelled flag stays false).
  ipcMain.handle('cloud-sync:cancel-offload', () => {
    for (const b of liveBatches.offload) b.cancelled = true
  })
  ipcMain.handle('cloud-sync:cancel-pin', () => {
    for (const b of liveBatches.hydrate) b.cancelled = true
  })
}
