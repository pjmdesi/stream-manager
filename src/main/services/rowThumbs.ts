import { BrowserWindow, ipcMain, nativeImage } from 'electron'
import fs from 'fs'
import { thumbnailCacheManager, ROW_THUMB_WIDTH } from './thumbnailCacheManager'

/**
 * Pre-scaled thumbnails for the streams list (STR-17).
 *
 * A row asks for its stream's primary thumbnail at list size. When the
 * cache has a current one the answer is its URL; otherwise the answer is
 * null, the file joins a queue, and `files:rowThumbReady` announces the URL
 * once it is written. The row shows the full image until then, so nothing
 * waits on this: a first launch fills the cache row by row while the list
 * looks as it always did, and every launch after loads small files.
 *
 * Generation runs one file at a time with a turn of the event loop between
 * items, so IPC stays responsive while a 200-row library fills. Decoding
 * and scaling are synchronous native-image calls (tens of milliseconds for
 * a 1280x720 PNG); if a real library makes that stick, the same loop moves
 * to a utility process.
 *
 * Cloud placeholders: the renderer only asks for thumbnails it already
 * shows through a file:// image, which reads the file just the same, so
 * this adds no hydration risk beyond the list's own rendering.
 */

const JPEG_QUALITY = 90

const queue: string[] = []
const queued = new Set<string>()
/** Source mtime at the last failed attempt, so a broken file is not retried
 *  until it changes. */
const failedAt = new Map<string, number>()
let pumping = false

function sourceMtime(filePath: string): number | null {
  try { return Math.floor(fs.statSync(filePath).mtimeMs) } catch { return null }
}

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

async function generate(filePath: string): Promise<void> {
  const mtime = sourceMtime(filePath)
  if (mtime === null || failedAt.get(filePath) === mtime) return
  // Another request may have produced it while this one waited in line.
  const existing = thumbnailCacheManager.getRowThumb(filePath, mtime)
  if (existing) { broadcast('files:rowThumbReady', { path: filePath, url: existing }); return }
  try {
    const data = await fs.promises.readFile(filePath)
    const img = nativeImage.createFromBuffer(data)
    if (img.isEmpty()) { failedAt.set(filePath, mtime); return }
    const { width } = img.getSize()
    const scaled = width > ROW_THUMB_WIDTH ? img.resize({ width: ROW_THUMB_WIDTH, quality: 'best' }) : img
    const url = thumbnailCacheManager.saveRowThumb(filePath, scaled.toJPEG(JPEG_QUALITY), mtime)
    broadcast('files:rowThumbReady', { path: filePath, url })
  } catch (err) {
    console.warn('[rowThumbs] could not scale', filePath, err)
    failedAt.set(filePath, mtime)
  }
}

async function pump(): Promise<void> {
  if (pumping) return
  pumping = true
  try {
    while (queue.length > 0) {
      const next = queue.shift()!
      queued.delete(next)
      await generate(next)
      // Let queued IPC and timers run between items.
      await new Promise<void>(resolve => setImmediate(resolve))
    }
  } finally {
    pumping = false
  }
}

export function registerRowThumbIPC(): void {
  ipcMain.handle('files:getRowThumb', async (_event, filePath: string): Promise<string | null> => {
    const mtime = sourceMtime(filePath)
    if (mtime === null) return null
    const cached = thumbnailCacheManager.getRowThumb(filePath, mtime)
    if (cached) return cached
    if (failedAt.get(filePath) === mtime) return null
    if (!queued.has(filePath)) {
      queued.add(filePath)
      queue.push(filePath)
      void pump()
    }
    return null
  })
}
