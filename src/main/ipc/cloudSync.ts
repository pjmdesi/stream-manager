import { ipcMain, WebContents } from 'electron'
import { dehydratePaths, hydratePathsWithProgress, isCfApiSyncRoot } from '../services/cfapi'
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

function getActive(): boolean {
  const dir = getStreamsDir()
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

// ─── Concurrent-batch worker model ───────────────────────────────────────────
//
// Each direction (offload | hydrate) owns its own queue + serial worker. New
// batches append; the worker drains them one batch at a time, never running
// two batches in parallel against the same provider. The two directions DO
// run in parallel with each other (an offload and a hydrate can be in flight
// at the same time).
//
// Cancel is per-batch (stamped on every batch in the cancel-target direction
// at click time — both the in-flight batch and any queued batches). Batches
// enqueued AFTER the cancel click are NOT cancelled, so the user can keep
// queueing new work while a previous cohort is still tearing down.

type Direction = 'offload' | 'hydrate'

interface Batch {
  direction: Direction
  batchId: string
  paths: string[]
  sender: WebContents
  cancelled: boolean
}

const offloadQueue: Batch[] = []
const hydrateQueue: Batch[] = []
let offloadInFlight: Batch | null = null
let hydrateInFlight: Batch | null = null
let offloadRunning = false
let hydrateRunning = false

function safeSend(sender: WebContents, channel: string, payload: unknown): void {
  // The sender's window may have closed between events. Guard so a stale
  // batch from a reloaded page doesn't crash the worker.
  if (sender.isDestroyed()) return
  sender.send(channel, payload)
}

async function drainOffload(): Promise<void> {
  if (offloadRunning) return
  offloadRunning = true
  // Pause the chokidar watcher around offload work — its
  // ReadDirectoryChangesW handles cause Synology Drive to reject
  // CfDehydratePlaceholder with HRESULT 0x80070187 (file in use).
  // Hydrate doesn't have the same constraint, so its worker doesn't pause.
  let restartWatcher: (() => void) | null = null
  try {
    while (offloadQueue.length > 0) {
      const batch = offloadQueue.shift()!
      offloadInFlight = batch
      try {
        if (batch.cancelled) {
          safeSend(batch.sender, 'cloud-sync:progress', {
            type: 'init', direction: 'offload', batchId: batch.batchId,
            eligible: [], skippedProtected: [],
          })
          safeSend(batch.sender, 'cloud-sync:progress', {
            type: 'complete', direction: 'offload', batchId: batch.batchId,
            ok: 0, failed: 0, alreadyOffline: 0, cancelled: true,
          })
          continue
        }
        const protectedSet = getProtectedPaths(getStreamsDir())
        const skipped: string[] = []
        const eligible: string[] = []
        for (const p of batch.paths) {
          if (protectedSet.has(p)) skipped.push(p)
          else eligible.push(p)
        }
        safeSend(batch.sender, 'cloud-sync:progress', {
          type: 'init', direction: 'offload', batchId: batch.batchId,
          eligible, skippedProtected: skipped,
        })
        if (!restartWatcher) restartWatcher = await pauseStreamsWatcher()
        const result = await dehydratePaths(
          eligible,
          ev => safeSend(batch.sender, 'cloud-sync:progress', {
            type: 'item', direction: 'offload', batchId: batch.batchId, ...ev,
          }),
          () => batch.cancelled,
        )
        safeSend(batch.sender, 'cloud-sync:progress', {
          type: 'complete', direction: 'offload', batchId: batch.batchId,
          ok: result.ok.length,
          failed: result.failed.length,
          alreadyOffline: result.skippedAlreadyOffline.length,
          cancelled: result.cancelled,
        })
      } finally {
        offloadInFlight = null
      }
    }
  } finally {
    if (restartWatcher) restartWatcher()
    offloadRunning = false
  }
}

async function drainHydrate(): Promise<void> {
  if (hydrateRunning) return
  hydrateRunning = true
  try {
    while (hydrateQueue.length > 0) {
      const batch = hydrateQueue.shift()!
      hydrateInFlight = batch
      try {
        if (batch.cancelled) {
          safeSend(batch.sender, 'cloud-sync:progress', {
            type: 'init', direction: 'hydrate', batchId: batch.batchId,
            eligible: [], skippedProtected: [],
          })
          safeSend(batch.sender, 'cloud-sync:progress', {
            type: 'complete', direction: 'hydrate', batchId: batch.batchId,
            ok: 0, failed: 0, alreadyLocal: 0, cancelled: true,
          })
          continue
        }
        // Hydrate has no concept of "protected" — every path is eligible.
        safeSend(batch.sender, 'cloud-sync:progress', {
          type: 'init', direction: 'hydrate', batchId: batch.batchId,
          eligible: batch.paths, skippedProtected: [],
        })
        const result = await hydratePathsWithProgress(
          batch.paths,
          ev => safeSend(batch.sender, 'cloud-sync:progress', {
            type: 'item', direction: 'hydrate', batchId: batch.batchId, ...ev,
          }),
          () => batch.cancelled,
        )
        safeSend(batch.sender, 'cloud-sync:progress', {
          type: 'complete', direction: 'hydrate', batchId: batch.batchId,
          ok: result.ok.length,
          failed: result.failed.length,
          alreadyLocal: result.skippedAlreadyLocal.length,
          cancelled: result.cancelled,
        })
      } finally {
        hydrateInFlight = null
      }
    }
  } finally {
    hydrateRunning = false
  }
}

export function registerCloudSyncIPC(): void {
  ipcMain.handle('cloud-sync:is-active', () => getActive())

  ipcMain.handle('cloud-sync:offload', (event, paths: string[], batchId: string) => {
    if (!Array.isArray(paths) || paths.length === 0 || !batchId) return
    offloadQueue.push({ direction: 'offload', batchId, paths, sender: event.sender, cancelled: false })
    drainOffload()
  })

  ipcMain.handle('cloud-sync:pin', (event, paths: string[], batchId: string) => {
    if (!Array.isArray(paths) || paths.length === 0 || !batchId) return
    hydrateQueue.push({ direction: 'hydrate', batchId, paths, sender: event.sender, cancelled: false })
    drainHydrate()
  })

  // Per-direction cancels stamp every batch in flight + in queue. Subsequent
  // enqueues are NOT auto-cancelled (their cancelled flag stays false).
  ipcMain.handle('cloud-sync:cancel-offload', () => {
    if (offloadInFlight) offloadInFlight.cancelled = true
    for (const b of offloadQueue) b.cancelled = true
  })
  ipcMain.handle('cloud-sync:cancel-pin', () => {
    if (hydrateInFlight) hydrateInFlight.cancelled = true
    for (const b of hydrateQueue) b.cancelled = true
  })
}
