import { ipcMain, IpcMainInvokeEvent, BrowserWindow } from 'electron'
import { audioCacheManager } from '../services/audioCacheManager'
import { thumbnailCacheManager } from '../services/thumbnailCacheManager'
import { waveformCacheManager } from '../services/waveformCacheManager'
import { getStore } from './store'

// In-process waveform cache — persists for the lifetime of the app
const waveformCache = new Map<string, Buffer>()

export function registerVideoIPC(): void {
  ipcMain.handle('video:probe', async (_event: IpcMainInvokeEvent, filePath: string) => {
    const { probeFile } = await import('../services/ffmpegService')
    return await probeFile(filePath)
  })

  ipcMain.handle(
    'video:extractTracks',
    async (event: IpcMainInvokeEvent, filePath: string, trackIndices?: number[]) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      const hash = audioCacheManager.hashKey(filePath)
      const cacheDir = audioCacheManager.cacheDir

      // Always pull the existing cache entry first so partial caches survive
      // across calls. The new per-track multi-track flow asks for one index
      // at a time; we want each call to honour what's already cached and
      // only run ffmpeg for slots that aren't.
      const { probeFile, extractAudioTracks } = await import('../services/ffmpegService')
      const info = await probeFile(filePath)
      const totalTracks = info.audioTracks.length
      const cached = audioCacheManager.getCachedTracks(filePath) ?? new Array(totalTracks).fill('')
      // Tolerate cache entries that pre-date a source-track change
      if (cached.length !== totalTracks) {
        cached.length = totalTracks
        for (let i = 0; i < totalTracks; i++) if (cached[i] === undefined) cached[i] = ''
      }

      const requested = trackIndices ?? Array.from({ length: totalTracks }, (_, i) => i)

      // Report 100% immediately for any requested slot we already have. The
      // renderer treats the extract-progress channel as authoritative for
      // ready-state transitions, so this completes the "extracting" UI
      // without any disk work.
      for (const i of requested) {
        if (cached[i] && win && !win.isDestroyed()) {
          win.webContents.send('video:extractProgress', { trackIndex: i, percent: 100 })
        }
      }

      const missing = requested.filter(i => !cached[i])
      if (missing.length === 0) return cached

      const extracted = await extractAudioTracks(
        filePath,
        cacheDir,
        (trackIndex, percent) => {
          if (win && !win.isDestroyed()) {
            win.webContents.send('video:extractProgress', { trackIndex, percent })
          }
        },
        hash,
        missing
      )

      // Merge: newly-extracted paths overlay onto whatever was already cached.
      const merged = cached.map((existing, i) => extracted[i] || existing)

      const limitBytes = getStore().get('config').audioCacheLimit ?? 1_073_741_824
      audioCacheManager.setCachedTracks(filePath, merged, limitBytes)
      return merged
    }
  )

  ipcMain.handle('video:cancelExtract', async (_event, trackIndex?: number) => {
    const { cancelExtraction } = await import('../services/ffmpegService')
    cancelExtraction(trackIndex)
  })

  // Look up which audio tracks are already in the persistent cache without
  // triggering an extraction. Used by the renderer when the user enables
  // multi-track on a file they've worked with before — previously-extracted
  // tracks can re-attach instantly while the rest stay in their
  // "unextracted" state until the user explicitly plays them.
  ipcMain.handle('video:getCachedTracks', async (_event, filePath: string) => {
    return audioCacheManager.getCachedTracks(filePath)
  })

  // Cleanup is now a no-op — files live in the cache managed by audioCacheManager
  ipcMain.handle('video:cleanupTracks', async () => {})

  ipcMain.handle('video:clearAudioCache', async () => {
    audioCacheManager.clearAll()
    thumbnailCacheManager.clearAll()
    waveformCacheManager.clearAll()
  })

  ipcMain.handle('video:getAudioCacheSize', async () => {
    return audioCacheManager.getTotalSize() + thumbnailCacheManager.getTotalSize() + waveformCacheManager.getTotalSize()
  })

  ipcMain.handle('video:getThumbnailCache', async (_event, filePath: string) => {
    return thumbnailCacheManager.getCached(filePath)
  })

  ipcMain.handle('video:saveThumbnailFrame', async (_event, filePath: string, index: number, dataUrl: string) => {
    thumbnailCacheManager.saveFrame(filePath, index, dataUrl)
  })

  ipcMain.handle('video:finalizeThumbnailCache', async (_event, filePath: string, timecodes: number[]) => {
    thumbnailCacheManager.finalizeMeta(filePath, timecodes)
  })

  // Keystone thumbnail (single representative frame) — prefer the cached one,
  // else mint it from the player's strip; null means the caller should generate.
  ipcMain.handle('video:getKeystoneThumbnail', async (_event, filePath: string) => {
    return thumbnailCacheManager.getKeystone(filePath) ?? thumbnailCacheManager.deriveKeystoneFromStrip(filePath)
  })

  ipcMain.handle('video:saveKeystoneThumbnail', async (_event, filePath: string, dataUrl: string) => {
    thumbnailCacheManager.saveKeystone(filePath, dataUrl)
  })

  ipcMain.handle('video:getWaveform', async (_event, filePath: string) => {
    if (waveformCache.has(filePath)) return waveformCache.get(filePath)
    const disk = waveformCacheManager.getCached(filePath)
    if (disk) { waveformCache.set(filePath, disk); return disk }
    const { extractWaveformData } = await import('../services/ffmpegService')
    const samples = await extractWaveformData(filePath)
    waveformCache.set(filePath, samples)
    waveformCacheManager.save(filePath, samples)
    return samples
  })

  // ── Recent videos (stored in electron-store) ──────────────────────────────
  // Mirrors the thumbnail-editor recents: a most-recently-opened list of
  // video files, deduped by path and capped at 20. Surfaced in the
  // Player page's empty state.
  ipcMain.handle('player:getRecents', () => {
    return (getStore() as any).get('playerRecents', []) as PlayerRecentEntry[]
  })

  ipcMain.handle('player:addRecent', (_e, entry: PlayerRecentEntry) => {
    // Collapse to one entry per stream item. Stream identity is relativePath
    // when both entries carry it — unique per stream in BOTH layout modes —
    // falling back to folderPath for legacy entries, which is only unique in
    // folder mode (in dump mode every stream shares the dump root, and keying
    // on it collapsed ALL dump recents into a single entry). Standalone files
    // (no stream fields) dedupe by exact path only.
    // Same-filePath entries are ALWAYS replaced regardless of stream: the
    // renderer's add effect re-fires once its folder list resolves, so the
    // same open can arrive first without stream fields and again with them —
    // without this, that pair persists as a same-key duplicate.
    const sameStream = (a: PlayerRecentEntry, b: PlayerRecentEntry): boolean =>
      a.relativePath && b.relativePath
        ? a.relativePath === b.relativePath
        : !!a.folderPath && !!b.folderPath && a.folderPath === b.folderPath
    const recents = ((getStore() as any).get('playerRecents', []) as PlayerRecentEntry[])
      .filter(r => r.filePath !== entry.filePath && !sameStream(r, entry))
    const updated = [entry, ...recents].slice(0, 20)
    ;(getStore() as any).set('playerRecents', updated)
    return updated
  })

  ipcMain.handle('player:removeRecent', (_e, filePath: string | string[]) => {
    // Accept one key or many; each may be a file path, a stream
    // relativePath, or a stream folderPath. relativePath is the safe
    // per-stream group key in both modes; folderPath matching remains for
    // legacy folder-mode callers — in dump mode it's the shared root, so
    // renderer callers pass relativePath/filePaths there instead.
    const drop = new Set(Array.isArray(filePath) ? filePath : [filePath])
    const updated = ((getStore() as any).get('playerRecents', []) as PlayerRecentEntry[])
      .filter(r =>
        !drop.has(r.filePath) &&
        !(r.relativePath && drop.has(r.relativePath)) &&
        !(r.folderPath && drop.has(r.folderPath)))
    ;(getStore() as any).set('playerRecents', updated)
    return updated
  })

  ipcMain.handle('player:clearRecents', () => {
    ;(getStore() as any).set('playerRecents', [])
    return []
  })
}

export interface PlayerRecentEntry {
  /** Absolute path to the video file. */
  filePath: string
  /** Bare file name for display. */
  fileName: string
  /** Stream folder this video belongs to, when it's part of a stream item.
   *  NOT unique per stream in dump mode (every stream shares the dump root) —
   *  prefer relativePath for stream identity. */
  folderPath?: string
  /** Canonical stream key (StreamFolder.relativePath) — unique per stream in
   *  both layout modes. Absent on legacy entries and standalone files. */
  relativePath?: string
  /** Resolved stream title (if the file belongs to a stream folder). */
  streamTitle?: string
  /** Resolved stream date (YYYY-MM-DD) when derivable. */
  streamDate?: string
  /** Last-opened timestamp (ms). */
  openedAt: number
}
