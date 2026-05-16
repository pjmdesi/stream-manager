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

  ipcMain.handle('video:cancelExtract', async () => {
    const { cancelExtraction } = await import('../services/ffmpegService')
    cancelExtraction()
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
}
