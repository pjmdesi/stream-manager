import { ipcMain } from 'electron'
import { dehydratePaths, pinPaths, hydratePaths, isCfApiSyncRoot, CloudOpResult } from '../services/cfapi'
import { getProtectedPaths, pauseStreamsWatcher } from './streams'
import { getStore } from './store'

// Cached after first probe. Recomputed when streamsDir changes via the
// invalidate hook. The probe walks up to depth 3 of the streams root, which is
// cheap once but worth memoizing across the session.
let cachedActive: { dir: string; active: boolean } | null = null

// Module-level cancel flag for the in-flight offload. Reset at the start of
// each offload call. Currently-running file is always allowed to finish.
let offloadCancelRequested = false

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

export function registerCloudSyncIPC(): void {
  ipcMain.handle('cloud-sync:is-active', () => getActive())

  ipcMain.handle('cloud-sync:offload', async (event, paths: string[]): Promise<CloudOpResult & { skipped: string[]; skippedAlreadyOffline: string[]; cancelled: boolean }> => {
    if (!Array.isArray(paths) || paths.length === 0) return { ok: [], failed: [], skipped: [], skippedAlreadyOffline: [], cancelled: false }
    offloadCancelRequested = false
    const protectedSet = getProtectedPaths(getStreamsDir())
    const skipped: string[] = []
    const eligible: string[] = []
    for (const p of paths) {
      if (protectedSet.has(p)) skipped.push(p)
      else eligible.push(p)
    }
    // Tell the renderer up front which paths are being processed and which
    // were skipped as protected — lets the progress modal render its full
    // table immediately rather than discovering rows event-by-event.
    event.sender.send('cloud-sync:progress', { type: 'init', eligible, skippedProtected: skipped })

    // Pause the chokidar watcher around the dehydrate. Its
    // ReadDirectoryChangesW handles cause Synology Drive to reject the call
    // with HRESULT 0x80070187 (file in use).
    const restartWatcher = await pauseStreamsWatcher()
    try {
      const result = await dehydratePaths(
        eligible,
        ev => { event.sender.send('cloud-sync:progress', { type: 'item', ...ev }) },
        () => offloadCancelRequested,
      )
      event.sender.send('cloud-sync:progress', {
        type: 'complete',
        ok: result.ok.length,
        failed: result.failed.length,
        alreadyOffline: result.skippedAlreadyOffline.length,
        cancelled: result.cancelled,
      })
      return { ok: result.ok, failed: result.failed, skipped, skippedAlreadyOffline: result.skippedAlreadyOffline, cancelled: result.cancelled }
    } finally {
      restartWatcher()
    }
  })

  // Sets the cancel flag for the in-flight offload. The currently-running
  // file finishes; subsequent files are skipped. Idempotent.
  ipcMain.handle('cloud-sync:cancel-offload', () => { offloadCancelRequested = true })

  ipcMain.handle('cloud-sync:pin', async (_e, paths: string[]): Promise<CloudOpResult> => {
    if (!Array.isArray(paths) || paths.length === 0) return { ok: [], failed: [] }
    return pinPaths(paths)
  })

  ipcMain.handle('cloud-sync:hydrate', async (_e, paths: string[]): Promise<CloudOpResult> => {
    if (!Array.isArray(paths) || paths.length === 0) return { ok: [], failed: [] }
    return hydratePaths(paths)
  })
}
