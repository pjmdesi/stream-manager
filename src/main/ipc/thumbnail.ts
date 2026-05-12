import { ipcMain } from 'electron'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { getStore } from './store'

// ── Types (mirrored from renderer) ───────────────────────────────────────────

interface ThumbnailLayer {
  id: string; name: string; type: 'image' | 'text'; visible: boolean; opacity: number
  x: number; y: number; rotation: number
  src?: string; width?: number; height?: number
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

function canvasJsonPath(folderPath: string, date: string) {
  return path.join(folderPath, `${date}_sm-thumbnail.json`)
}
function canvasPngPath(folderPath: string, date: string) {
  return path.join(folderPath, `${date}_sm-thumbnail.png`)
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

  ipcMain.handle('thumbnail:loadCanvas', async (_e, folderPath: string, date: string): Promise<ThumbnailCanvasFile | null> => {
    try {
      const raw = await fs.promises.readFile(canvasJsonPath(folderPath, date), 'utf-8')
      return JSON.parse(raw) as ThumbnailCanvasFile
    } catch {
      return null
    }
  })

  ipcMain.handle('thumbnail:saveCanvas', async (
    _e,
    folderPath: string,
    date: string,
    canvasFile: ThumbnailCanvasFile,
    pngDataUrl: string
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
    // Save JSON
    await fs.promises.writeFile(canvasJsonPath(folderPath, date), JSON.stringify(canvasFile, null, 2), 'utf-8')
    // Save PNG
    const base64 = pngDataUrl.replace(/^data:image\/png;base64,/, '')
    await fs.promises.writeFile(canvasPngPath(folderPath, date), Buffer.from(base64, 'base64'))
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
