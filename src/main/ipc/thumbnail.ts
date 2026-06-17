import { ipcMain, BrowserWindow } from 'electron'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { getStore } from './store'
import { suppressNextStreamsChokidarFire } from './streams'

// ── Types (mirrored from renderer) ───────────────────────────────────────────

interface ThumbnailLayer {
  id: string; name: string; type: 'image' | 'text'; visible: boolean; opacity: number
  x: number; y: number; rotation: number
  src?: string; width?: number; height?: number
  flipX?: boolean; flipY?: boolean
  aspectLocked?: boolean
  text?: string; fontFamily?: string; fontSize?: number; fontStyle?: string
  fill?: string; stroke?: string; strokeWidth?: number; align?: string
}

interface ThumbnailCanvasFile {
  version: 1; templateId?: string; updatedAt: number; layers: ThumbnailLayer[]
}

interface ThumbnailTemplate {
  id: string; name: string; createdAt: number; updatedAt: number; layers: ThumbnailLayer[]
}

export interface ThumbnailRecentEntry {
  folderPath: string; date: string; title?: string; templateId?: string; updatedAt: number
}

// ── Path helpers ─────────────────────────────────────────────────────────────

function assetsDir(streamsDir: string) { return path.join(streamsDir, '_thumbnail-assets') }
function templatesDir(streamsDir: string) { return path.join(assetsDir(streamsDir), 'templates') }
function imagesDir(streamsDir: string) { return path.join(assetsDir(streamsDir), 'images') }

// Variant 1 keeps the legacy unsuffixed names so existing thumbnails
// continue to load without migration; variants 2+ get an `-N` ordinal
// before the extension. The ordinal embedded in the filename is the
// STABLE identifier — deleting variant 2 doesn't renumber 3, so
// `meta.preferredThumbnail` references and external links survive.
function suffix(ordinal: number) { return ordinal <= 1 ? '' : `-${ordinal}` }
function canvasJsonPath(folderPath: string, date: string, ordinal: number = 1) {
  return path.join(folderPath, `${date}_sm-thumbnail${suffix(ordinal)}.json`)
}
function canvasPngPath(folderPath: string, date: string, ordinal: number = 1) {
  return path.join(folderPath, `${date}_sm-thumbnail${suffix(ordinal)}.png`)
}
/** Scan a stream folder for all SM-thumbnail variants. Returns the
 *  ordinals in ascending order — `[1]` for a legacy single-thumbnail
 *  stream, `[1, 2, 3]` for one with two alternatives, etc. Holes are
 *  preserved (e.g. `[1, 3]` if the user deleted variant 2).
 *
 *  Matches both the rendered `.png` AND the editable `.json` so a variant
 *  whose PNG was deleted externally (or never finished rendering) is still
 *  discoverable from its surviving canvas data — the editor can then reopen
 *  it and regenerate the missing image instead of treating it as gone. */
function listThumbnailVariants(folderPath: string, date: string): number[] {
  let entries: string[]
  try { entries = fs.readdirSync(folderPath) } catch { return [] }
  const re = new RegExp(`^${date.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}_sm-thumbnail(?:-(\\d+))?\\.(?:png|json)$`, 'i')
  const ordinals = new Set<number>()
  for (const name of entries) {
    const m = name.match(re)
    if (!m) continue
    const n = m[1] ? parseInt(m[1], 10) : 1
    if (n >= 1) ordinals.add(n)
  }
  return Array.from(ordinals).sort((a, b) => a - b)
}

// ── Store helpers ─────────────────────────────────────────────────────────────

function getRecents(): ThumbnailRecentEntry[] {
  return (getStore() as any).get('thumbnailRecents', []) as ThumbnailRecentEntry[]
}
function setRecents(v: ThumbnailRecentEntry[]) {
  (getStore() as any).set('thumbnailRecents', v)
}
function getLastFont(): string {
  return (getStore() as any).get('thumbnailLastFont', '') as string
}
function setLastFont(v: string) {
  (getStore() as any).set('thumbnailLastFont', v)
}

// ── IPC registration ──────────────────────────────────────────────────────────

export function registerThumbnailIPC(): void {
  // Ensure the _thumbnail-assets/ directory structure exists
  ipcMain.handle('thumbnail:ensureAssetsDir', async (_e, streamsDir: string) => {
    await fs.promises.mkdir(templatesDir(streamsDir), { recursive: true })
    await fs.promises.mkdir(imagesDir(streamsDir), { recursive: true })
  })

  // Content hash of a file (sha1 of bytes). Used to detect whether a stream's
  // thumbnail has changed since it was last pushed to YouTube — robust to
  // mtime touches from cloud-sync clients. Returns null if the file is
  // missing/unreadable (treated by the caller as "no hash → needs push").
  ipcMain.handle('thumbnail:hashFile', async (_e, filePath: string): Promise<string | null> => {
    try {
      const buf = await fs.promises.readFile(filePath)
      return crypto.createHash('sha1').update(buf).digest('hex')
    } catch {
      return null
    }
  })

  // Batched content hash — same sha1-of-bytes as hashFile, for many files at
  // once (the Out-of-sync panel hashes every linked stream's thumbnail to
  // detect "thumbnail changed since last push"). Hashed in parallel; missing/
  // unreadable files map to null.
  ipcMain.handle('thumbnail:hashFiles', async (_e, filePaths: string[]): Promise<Record<string, string | null>> => {
    const entries = await Promise.all(
      (filePaths ?? []).map(async (p): Promise<[string, string | null]> => {
        try {
          const buf = await fs.promises.readFile(p)
          return [p, crypto.createHash('sha1').update(buf).digest('hex')]
        } catch {
          return [p, null]
        }
      })
    )
    return Object.fromEntries(entries)
  })

  // ── Templates ────────────────────────────────────────────────────────────

  ipcMain.handle('thumbnail:listTemplates', async (_e, streamsDir: string): Promise<ThumbnailTemplate[]> => {
    const dir = templatesDir(streamsDir)
    await fs.promises.mkdir(dir, { recursive: true })
    const files = await fs.promises.readdir(dir).catch(() => [] as string[])
    const templates: ThumbnailTemplate[] = []
    for (const f of files.filter(f => f.endsWith('.json'))) {
      try {
        const raw = await fs.promises.readFile(path.join(dir, f), 'utf-8')
        templates.push(JSON.parse(raw) as ThumbnailTemplate)
      } catch {}
    }
    return templates.sort((a, b) => b.updatedAt - a.updatedAt)
  })

  ipcMain.handle('thumbnail:saveTemplate', async (_e, streamsDir: string, template: ThumbnailTemplate, pngDataUrl?: string) => {
    const dir = templatesDir(streamsDir)
    await fs.promises.mkdir(dir, { recursive: true })
    await fs.promises.writeFile(path.join(dir, `${template.id}.json`), JSON.stringify(template, null, 2), 'utf-8')
    if (pngDataUrl) {
      const base64 = pngDataUrl.replace(/^data:image\/png;base64,/, '')
      await fs.promises.writeFile(path.join(dir, `${template.id}.png`), Buffer.from(base64, 'base64'))
    }
    return template
  })

  ipcMain.handle('thumbnail:deleteTemplate', async (_e, streamsDir: string, templateId: string) => {
    const dir = templatesDir(streamsDir)
    await fs.promises.rm(path.join(dir, `${templateId}.json`), { force: true })
    await fs.promises.rm(path.join(dir, `${templateId}.png`), { force: true })
  })

  // ── Canvas (per-stream) ───────────────────────────────────────────────────

  ipcMain.handle('thumbnail:loadCanvas', async (_e, folderPath: string, date: string, ordinal: number = 1): Promise<ThumbnailCanvasFile | null> => {
    try {
      const raw = await fs.promises.readFile(canvasJsonPath(folderPath, date, ordinal), 'utf-8')
      return JSON.parse(raw) as ThumbnailCanvasFile
    } catch {
      return null
    }
  })

  ipcMain.handle('thumbnail:saveCanvas', async (
    event,
    folderPath: string,
    date: string,
    canvasFile: ThumbnailCanvasFile,
    pngDataUrl: string,
    ordinal: number = 1,
  ) => {
    // Bail if the stream's folder no longer exists. The previous behavior
    // (mkdir -p) silently re-created deleted streams whenever an autosave
    // fired against a stream the user had already removed (because the
    // editor or its recents list was still holding a reference to the
    // gone folder). That looked like the streams list "resurrecting" the
    // entry in the UI.
    if (!fs.existsSync(folderPath)) {
      console.warn(`[thumbnail:saveCanvas] folder gone — skipping save: ${folderPath}`)
      return
    }
    // Suppress the chokidar echo for the PNG we're about to write.
    // We send `streams:changed` explicitly below for instant feedback;
    // without this guard, chokidar would also fire ~1.8s later on the
    // same write and the renderer would reload twice per save.
    suppressNextStreamsChokidarFire()
    // Save JSON
    await fs.promises.writeFile(canvasJsonPath(folderPath, date, ordinal), JSON.stringify(canvasFile, null, 2), 'utf-8')
    // Save PNG
    const base64 = pngDataUrl.replace(/^data:image\/png;base64,/, '')
    await fs.promises.writeFile(canvasPngPath(folderPath, date, ordinal), Buffer.from(base64, 'base64'))
    // Explicit notify so the streams page refreshes immediately. The
    // chokidar watcher would also catch this PNG write, but only after
    // ~1.8s (awaitWriteFinish + debounce) and it can miss the event on
    // some setups (cloud-sync'd folders, ReadDirectoryChangesW handle
    // churn). Firing here is deterministic.
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win && !win.isDestroyed()) win.webContents.send('streams:changed')
  })

  ipcMain.handle('thumbnail:listVariants', async (_e, folderPath: string, date: string): Promise<number[]> => {
    return listThumbnailVariants(folderPath, date)
  })

  // ── Asset cache ───────────────────────────────────────────────────────────

  ipcMain.handle('thumbnail:cacheAsset', async (_e, streamsDir: string, srcPath: string): Promise<string> => {
    const dir = imagesDir(streamsDir)
    await fs.promises.mkdir(dir, { recursive: true })
    const content = await fs.promises.readFile(srcPath)
    const hash = crypto.createHash('sha256').update(content).digest('hex').slice(0, 16)
    const ext = path.extname(srcPath).toLowerCase() || '.png'
    const destPath = path.join(dir, `${hash}${ext}`)
    if (!fs.existsSync(destPath)) await fs.promises.copyFile(srcPath, destPath)
    return destPath
  })

  // ── Recents (stored in electron-store) ───────────────────────────────────

  ipcMain.handle('thumbnail:getRecents', () => getRecents())

  ipcMain.handle('thumbnail:addRecent', (_e, entry: ThumbnailRecentEntry) => {
    const recents = getRecents().filter(r => !(r.folderPath === entry.folderPath && r.date === entry.date))
    const updated = [entry, ...recents].slice(0, 20)
    setRecents(updated)
    return updated
  })

  ipcMain.handle('thumbnail:removeRecent', (_e, folderPath: string, date: string) => {
    const updated = getRecents().filter(r => !(r.folderPath === folderPath && r.date === date))
    setRecents(updated)
    return updated
  })

  // ── Last used font ────────────────────────────────────────────────────────

  ipcMain.handle('thumbnail:getLastFont', () => getLastFont())
  ipcMain.handle('thumbnail:setLastFont', (_e, font: string) => setLastFont(font))
}
