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
      const fullExtraction = trackIndices === undefined
      // For a full extraction, use cache only if every track slot is populated
      if (fullExtraction) {
        const cached = audioCacheManager.getCachedTracks(filePath)
        if (cached && cached.every(p => p !== '')) return cached
      }

      const win = BrowserWindow.fromWebContents(event.sender)
      const hash = audioCacheManager.hashKey(filePath)
      const cacheDir = audioCacheManager.cacheDir

      const { extractAudioTracks } = await import('../services/ffmpegService')
      const paths = await extractAudioTracks(
        filePath,
        cacheDir,
        (trackIndex, percent) => {
          if (win && !win.isDestroyed()) {
            win.webContents.send('video:extractProgress', { trackIndex, percent })
          }
        },
        hash,
        trackIndices
      )

      // Always write to cache so size is tracked correctly regardless of partial/full
      const limitBytes = getStore().get('config').audioCacheLimit ?? 1_073_741_824
      audioCacheManager.setCachedTracks(filePath, paths, limitBytes)
      return paths
    }
  )

  ipcMain.handle('video:cancelExtract', async () => {
    const { cancelExtraction } = await import('../services/ffmpegService')
    cancelExtraction()
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
