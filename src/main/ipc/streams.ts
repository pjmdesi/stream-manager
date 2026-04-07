import { ipcMain, BrowserWindow, shell } from 'electron'
import fs from 'fs'
import path from 'path'
import { spawnSync } from 'child_process'
import chokidar, { FSWatcher } from 'chokidar'
import { getStore } from './store'
import type { ConversionPreset } from './converter'

export interface StreamMeta {
  date: string
  streamType: 'games' | 'other'
  games: string[]
  comments: string
  archived?: boolean
}

export interface ArchiveProgress {
  folderPath: string
  folderIndex: number
  totalFolders: number
  fileName: string
  fileIndex: number
  fileCount: number
  percent: number
  phase: 'converting' | 'replacing' | 'done' | 'error'
  error?: string
}

export interface StreamFolder {
  folderName: string
  folderPath: string
  date: string
  meta: StreamMeta | null
  hasMeta: boolean
  detectedGames: string[]
  thumbnails: string[]
  videoCount: number
  videos: string[]
  isMissing?: boolean
}

const DATE_FOLDER_RE = /^\d{4}-\d{2}-\d{2}$/
const DATE_IN_FILENAME_RE = /(\d{4}-\d{2}-\d{2})/
const META_FILENAME = '_meta.json'
const OLD_META_FILENAME = 'stream-meta.json'
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif'])
const VIDEO_EXTS = new Set([
  '.mkv', '.mp4', '.mov', '.avi', '.ts', '.flv', '.webm',
  '.wmv', '.m4v', '.mpg', '.mpeg', '.m2ts', '.mts', '.vob',
  '.divx', '.3gp', '.ogv', '.asf', '.rmvb', '.f4v', '.hevc'
])

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

/** Extract game names from MKV filenames like "2026-03-29 21-14-35 (Cult Of The Lamb).mkv" */
function detectGamesFromFolder(folderPath: string): string[] {
  try {
    const files = fs.readdirSync(folderPath)
    const games: string[] = []
    for (const file of files) {
      if (!file.toLowerCase().endsWith('.mkv')) continue
      const match = file.match(/\(([^)]+)\)\.mkv$/i)
      if (match) {
        const game = match[1].trim()
        if (!games.includes(game)) games.push(game)
      }
    }
    return games
  } catch (_) {
    return []
  }
}

/** Extract game names from a list of file paths (dump folder mode). */
function detectGamesFromFiles(filePaths: string[]): string[] {
  const games: string[] = []
  for (const filePath of filePaths) {
    if (!filePath.toLowerCase().endsWith('.mkv')) continue
    const match = path.basename(filePath).match(/\(([^)]+)\)\.mkv$/i)
    if (match) {
      const game = match[1].trim()
      if (!games.includes(game)) games.push(game)
    }
  }
  return games
}

/** All files in a dump dir whose name contains a given date string. */
function filesForDate(dir: string, date: string): string[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter(e => !e.isDirectory() && e.name.includes(date))
      .map(e => path.join(dir, e.name))
  } catch {
    return []
  }
}

/**
 * Sort key for thumbnail files.
 * - Contains "thumbnail" with no trailing number → rank 0  (e.g. "2026-03-29 thumbnail")
 * - Contains "thumbnail - N"                     → rank N  (e.g. "2026-03-29 thumbnail - 1")
 * - No "thumbnail" in name                       → rank Infinity
 * Ties within a rank are broken alphabetically.
 */
function thumbnailSortKey(filename: string): [number, string] {
  const base = path.basename(filename, path.extname(filename))

  const numbered = base.match(/thumbnail\s*[-–]\s*(\d+)/i)
  if (numbered) return [parseInt(numbered[1]), base]

  if (/thumbnail/i.test(base)) return [0, base]

  return [Infinity, base]
}

/** Return absolute paths of image files in the folder, thumbnail-first. */
function detectThumbnails(folderPath: string): string[] {
  try {
    return fs.readdirSync(folderPath)
      .filter(f => IMAGE_EXTS.has(path.extname(f).toLowerCase()))
      .sort((a, b) => {
        const [rankA, nameA] = thumbnailSortKey(a)
        const [rankB, nameB] = thumbnailSortKey(b)
        if (rankA !== rankB) return rankA - rankB
        return nameA.localeCompare(nameB)
      })
      .map(f => path.join(folderPath, f))
  } catch (_) {
    return []
  }
}

function metaFilePath(streamsDir: string): string {
  return path.join(streamsDir, META_FILENAME)
}

function readAllMeta(streamsDir: string): Record<string, StreamMeta> {
  try {
    return JSON.parse(fs.readFileSync(metaFilePath(streamsDir), 'utf-8'))
  } catch {
    return {}
  }
}

function writeAllMeta(streamsDir: string, allMeta: Record<string, StreamMeta>): void {
  const filePath = metaFilePath(streamsDir)
  fs.writeFileSync(filePath, JSON.stringify(allMeta, null, 2), 'utf-8')
  if (process.platform === 'win32') {
    try { spawnSync('attrib', ['+H', filePath], { shell: true, timeout: 2000 }) } catch {}
  }
}

/** One-time migration: absorb per-folder stream-meta.json files into root _meta.json. */
function migrateMeta(streamsDir: string): void {
  const store = getStore()
  if (store.get('metaMigrated', false)) return

  // Already migrated by a prior run (e.g. fresh install that never had per-folder files)
  if (fs.existsSync(metaFilePath(streamsDir))) {
    store.set('metaMigrated', true)
    return
  }

  const allMeta: Record<string, StreamMeta> = {}
  try {
    for (const entry of fs.readdirSync(streamsDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || !DATE_FOLDER_RE.test(entry.name)) continue
      const oldFile = path.join(streamsDir, entry.name, OLD_META_FILENAME)
      try {
        allMeta[entry.name] = JSON.parse(fs.readFileSync(oldFile, 'utf-8'))
      } catch {}
    }
  } catch {}

  if (Object.keys(allMeta).length > 0) writeAllMeta(streamsDir, allMeta)
  store.set('metaMigrated', true)
}

export function registerStreamsIPC(): void {
  ipcMain.handle('streams:list', async (_event, dir: string, mode: 'folder-per-stream' | 'dump-folder' = 'folder-per-stream'): Promise<StreamFolder[]> => {
    if (!dir || !fs.existsSync(dir)) return []

    migrateMeta(dir)

    const allMeta = readAllMeta(dir)
    const folders: StreamFolder[] = []
    const today = todayISO()

    if (mode === 'dump-folder') {
      // ── Dump folder scan ──────────────────────────────────────────────────
      const entries = fs.readdirSync(dir, { withFileTypes: true })

      // Group files by date found in filename
      const groups = new Map<string, { videos: string[]; thumbnails: string[] }>()
      for (const entry of entries) {
        if (entry.isDirectory()) continue
        const match = entry.name.match(DATE_IN_FILENAME_RE)
        if (!match) continue
        const date = match[1]
        if (!groups.has(date)) groups.set(date, { videos: [], thumbnails: [] })
        const ext = path.extname(entry.name).toLowerCase()
        const filePath = path.join(dir, entry.name)
        if (VIDEO_EXTS.has(ext)) groups.get(date)!.videos.push(filePath)
        else if (IMAGE_EXTS.has(ext)) groups.get(date)!.thumbnails.push(filePath)
      }

      const seenDates = new Set<string>()

      for (const [date, { videos, thumbnails }] of groups) {
        seenDates.add(date)
        const sortedThumbnails = [...thumbnails].sort((a, b) => {
          const [rankA, nameA] = thumbnailSortKey(path.basename(a))
          const [rankB, nameB] = thumbnailSortKey(path.basename(b))
          if (rankA !== rankB) return rankA - rankB
          return nameA.localeCompare(nameB)
        })
        const meta = allMeta[date] ?? null
        folders.push({
          folderName: date,
          folderPath: dir,
          date,
          meta,
          hasMeta: meta !== null,
          detectedGames: detectGamesFromFiles(videos),
          thumbnails: sortedThumbnails,
          videoCount: videos.length,
          videos,
        })
      }

      // Meta entries with no files: isMissing only if date is strictly in the past
      for (const [date, meta] of Object.entries(allMeta)) {
        if (seenDates.has(date)) continue
        folders.push({
          folderName: date,
          folderPath: dir,
          date,
          meta,
          hasMeta: true,
          detectedGames: [],
          videoCount: 0,
          videos: [],
          thumbnails: [],
          isMissing: date < today,
        })
      }
    } else {
      // ── Folder-per-stream scan ────────────────────────────────────────────
      const entries = fs.readdirSync(dir, { withFileTypes: true })
      const seenFolders = new Set<string>()

      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        if (entry.name.startsWith('_')) continue
        if (!DATE_FOLDER_RE.test(entry.name)) continue

        seenFolders.add(entry.name)
        const folderPath = path.join(dir, entry.name)
        const meta = allMeta[entry.name] ?? null
        const detectedGames = detectGamesFromFolder(folderPath)
        const thumbnails = detectThumbnails(folderPath)

        let videos: string[] = []
        try {
          videos = fs.readdirSync(folderPath)
            .filter(f => VIDEO_EXTS.has(path.extname(f).toLowerCase()))
            .map(f => path.join(folderPath, f))
        } catch (_) {}

        folders.push({
          folderName: entry.name,
          folderPath,
          date: entry.name,
          meta,
          hasMeta: meta !== null,
          detectedGames,
          thumbnails,
          videoCount: videos.length,
          videos,
        })
      }

      // Orphaned meta entries (folder gone) — always isMissing in folder mode
      for (const [folderName, meta] of Object.entries(allMeta)) {
        if (seenFolders.has(folderName)) continue
        const folderPath = path.join(dir, folderName)
        folders.push({
          folderName,
          folderPath,
          date: folderName,
          meta,
          hasMeta: true,
          detectedGames: [],
          videoCount: 0,
          videos: [],
          thumbnails: [],
          isMissing: true,
        })
      }
    }

    folders.sort((a, b) => b.date.localeCompare(a.date))
    return folders
  })

  ipcMain.handle('streams:writeMeta', async (_event, folderPath: string, meta: StreamMeta) => {
    const streamsDir = path.dirname(folderPath)
    const folderName = path.basename(folderPath)
    const allMeta = readAllMeta(streamsDir)
    allMeta[folderName] = meta
    writeAllMeta(streamsDir, allMeta)
  })

  ipcMain.handle('streams:listTemplates', async (
    _event,
    streamsDir: string
  ): Promise<{ name: string; path: string }[]> => {
    const templatesDir = path.join(streamsDir, '_Templates')
    if (!fs.existsSync(templatesDir)) return []
    return fs.readdirSync(templatesDir, { withFileTypes: true })
      .filter(e => e.isFile() && !e.name.startsWith('.'))
      .map(e => ({ name: e.name, path: path.join(templatesDir, e.name) }))
  })

  ipcMain.handle('streams:createFolder', async (
    _event,
    parentDir: string,
    date: string,
    meta?: StreamMeta,
    thumbnailTemplatePath?: string,
    prevEpisodeFolderPath?: string,
    mode: 'folder-per-stream' | 'dump-folder' = 'folder-per-stream'
  ): Promise<string> => {
    const store = getStore()
    const effectiveMode = mode || (store.get('config').streamMode) || 'folder-per-stream'

    if (effectiveMode === 'dump-folder') {
      // In dump mode: just write the meta entry and copy template to the dump dir root
      if (meta) {
        const allMeta = readAllMeta(parentDir)
        allMeta[date] = meta
        writeAllMeta(parentDir, allMeta)
      }
      if (thumbnailTemplatePath && fs.existsSync(thumbnailTemplatePath)) {
        const ext = path.extname(thumbnailTemplatePath)
        fs.copyFileSync(thumbnailTemplatePath, path.join(parentDir, `${date} thumbnail${ext}`))
      }
      if (prevEpisodeFolderPath && fs.existsSync(prevEpisodeFolderPath)) {
        // Copy thumbnail files from prev episode folder (or dump dir if prev episode is in dump mode)
        const prevDir = fs.statSync(prevEpisodeFolderPath).isDirectory() ? prevEpisodeFolderPath : parentDir
        const files = fs.readdirSync(prevDir)
        for (const file of files) {
          if (!/thumbnail/i.test(path.basename(file, path.extname(file)))) continue
          const src = path.join(prevDir, file)
          if (!fs.statSync(src).isFile()) continue
          // Only copy files belonging to the prev episode date
          if (prevDir === parentDir && !file.startsWith(path.basename(prevEpisodeFolderPath))) continue
          const newName = file.replace(/^\d{4}-\d{2}-\d{2}/, date)
          fs.copyFileSync(src, path.join(parentDir, newName))
        }
      }
      return parentDir
    }

    // Folder-per-stream mode
    const folderPath = path.join(parentDir, date)
    fs.mkdirSync(folderPath, { recursive: true })
    if (meta) {
      const allMeta = readAllMeta(parentDir)
      allMeta[date] = meta
      writeAllMeta(parentDir, allMeta)
    }
    if (thumbnailTemplatePath && fs.existsSync(thumbnailTemplatePath)) {
      const ext = path.extname(thumbnailTemplatePath)
      fs.copyFileSync(thumbnailTemplatePath, path.join(folderPath, `${date} thumbnail${ext}`))
    }
    if (prevEpisodeFolderPath && fs.existsSync(prevEpisodeFolderPath)) {
      const files = fs.readdirSync(prevEpisodeFolderPath)
      for (const file of files) {
        if (!/thumbnail/i.test(path.basename(file, path.extname(file)))) continue
        const src = path.join(prevEpisodeFolderPath, file)
        if (!fs.statSync(src).isFile()) continue
        const newName = file.replace(/^\d{4}-\d{2}-\d{2}/, date)
        fs.copyFileSync(src, path.join(folderPath, newName))
      }
    }
    return folderPath
  })

  ipcMain.handle('streams:listFilesForDate', async (_event, dir: string, date: string): Promise<string[]> => {
    return filesForDate(dir, date)
  })

  ipcMain.handle('streams:deleteStreamFiles', async (_event, dir: string, date: string): Promise<void> => {
    const allMeta = readAllMeta(dir)
    delete allMeta[date]
    writeAllMeta(dir, allMeta)
    for (const filePath of filesForDate(dir, date)) {
      try { await shell.trashItem(filePath) } catch {}
    }
  })

  ipcMain.handle('streams:stampArchived', async (_event, dir: string, mode: 'folder-per-stream' | 'dump-folder' = 'folder-per-stream'): Promise<number> => {
    if (!dir || !fs.existsSync(dir)) return 0
    const allMeta = readAllMeta(dir)
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    let count = 0

    if (mode === 'dump-folder') {
      // Collect unique dates from filenames
      const dates = new Set<string>()
      for (const entry of entries) {
        if (entry.isDirectory()) continue
        const match = entry.name.match(DATE_IN_FILENAME_RE)
        if (match) dates.add(match[1])
      }
      for (const date of dates) {
        allMeta[date] = {
          ...(allMeta[date] ?? { date, streamType: 'games' as const, games: [], comments: '' }),
          archived: true
        }
        count++
      }
    } else {
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        if (!DATE_FOLDER_RE.test(entry.name)) continue
        allMeta[entry.name] = {
          ...(allMeta[entry.name] ?? { date: entry.name, streamType: 'games' as const, games: [], comments: '' }),
          archived: true
        }
        count++
      }
    }

    if (count > 0) writeAllMeta(dir, allMeta)
    return count
  })

  let archiveCancelFn: (() => void) | null = null

  interface ArchiveSession {
    /** For folder mode: the session subfolder path. For dump mode: the dump dir root. */
    folderPath: string
    /** The date key (YYYY-MM-DD) used for meta lookup. */
    date: string
    /** Explicit MKV file paths. If provided, skip folder scanning. */
    filePaths?: string[]
  }

  ipcMain.handle('streams:archiveFolders', async (
    event,
    sessions: ArchiveSession[],
    preset: ConversionPreset
  ): Promise<{ errors: string[] }> => {
    const errors: string[] = []
    let cancelled = false
    archiveCancelFn = () => { cancelled = true }

    for (let fi = 0; fi < sessions.length; fi++) {
      if (cancelled) break
      const { folderPath, date, filePaths: explicitFiles } = sessions[fi]

      let files: string[]
      if (explicitFiles) {
        // Dump mode: use the explicitly provided MKV paths
        files = explicitFiles.filter(f => f.toLowerCase().endsWith('.mkv'))
      } else {
        try {
          files = fs.readdirSync(folderPath)
            .filter(f => f.toLowerCase().endsWith('.mkv'))
            .map(f => path.join(folderPath, f))
        } catch (e: any) {
          errors.push(`${date}: ${e.message}`)
          continue
        }
      }

      let folderSuccess = true

      for (let i = 0; i < files.length; i++) {
        if (cancelled) break
        const inputFile = files[i]
        const fileName = path.basename(inputFile)
        const baseName = path.basename(fileName, path.extname(fileName))
        const ext = preset.outputExtension || 'mkv'
        // Temp file lives next to the input file
        const tempFile = path.join(path.dirname(inputFile), `${baseName}__arc_tmp.${ext}`)

        const sendProgress = (percent: number, phase: ArchiveProgress['phase'], error?: string) => {
          if (event.sender.isDestroyed()) return
          event.sender.send('streams:archiveProgress', {
            folderPath, folderIndex: fi, totalFolders: sessions.length,
            fileName, fileIndex: i, fileCount: files.length,
            percent, phase, error
          } as ArchiveProgress)
        }

        const { runConversion } = await import('../services/ffmpegService')
        const success = await new Promise<boolean>((resolve) => {
          let cancelJob: (() => void) | null = null
          const prevCancel = archiveCancelFn
          archiveCancelFn = () => { cancelled = true; cancelJob?.() }

          const onProgress = (pct: number) => sendProgress(pct, 'converting')

          const onComplete = () => {
            archiveCancelFn = prevCancel
            sendProgress(100, 'replacing')
            try {
              fs.unlinkSync(inputFile)
              fs.renameSync(tempFile, inputFile)
              resolve(true)
            } catch (e: any) {
              try { if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile) } catch (_) {}
              sendProgress(0, 'error', `Replace failed: ${e.message}`)
              resolve(false)
            }
          }

          const onError = (err: Error) => {
            archiveCancelFn = prevCancel
            try { if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile) } catch (_) {}
            sendProgress(0, 'error', err.message)
            resolve(false)
          }

          const job = runConversion(inputFile, tempFile, preset.ffmpegArgs, 0, onProgress, onComplete, onError)
          cancelJob = job.cancel
        })

        if (!success) folderSuccess = false
      }

      if (!cancelled && folderSuccess) {
        // Determine the streamsDir: for folder mode it's the parent; for dump mode folderPath IS the streamsDir
        const streamsDir = explicitFiles ? folderPath : path.dirname(folderPath)
        const allMeta = readAllMeta(streamsDir)
        allMeta[date] = {
          ...(allMeta[date] ?? { date, streamType: 'games' as const, games: [], comments: '' }),
          archived: true
        }
        writeAllMeta(streamsDir, allMeta)
      }

      if (!event.sender.isDestroyed()) {
        event.sender.send('streams:archiveProgress', {
          folderPath, folderIndex: fi, totalFolders: sessions.length,
          fileName: '', fileIndex: files.length, fileCount: files.length,
          percent: 100, phase: (cancelled || !folderSuccess) ? 'error' : 'done'
        } as ArchiveProgress)
      }
    }

    archiveCancelFn = null
    return { errors }
  })

  ipcMain.handle('streams:cancelArchive', async () => {
    archiveCancelFn?.()
  })

  ipcMain.handle('streams:deleteFolder', async (_event, folderPath: string) => {
    const streamsDir = path.dirname(folderPath)
    const folderName = path.basename(folderPath)
    const allMeta = readAllMeta(streamsDir)
    delete allMeta[folderName]
    writeAllMeta(streamsDir, allMeta)
    await shell.trashItem(folderPath)
  })

  ipcMain.handle('streams:removeOrphans', async (_event, streamsDir: string, folderNames: string[]) => {
    const allMeta = readAllMeta(streamsDir)
    for (const name of folderNames) delete allMeta[name]
    writeAllMeta(streamsDir, allMeta)
  })

  interface ConvertMove { from: string; to: string }
  interface ConvertResult {
    moved: number
    skipped: number
    manifest: { moves: ConvertMove[]; createdFolders: string[] }
  }

  ipcMain.handle('streams:convertDumpFolder', async (_event, dirPath: string): Promise<ConvertResult> => {
    const dateRegex = /(\d{4}-\d{2}-\d{2})/
    let skipped = 0

    const entries = fs.readdirSync(dirPath, { withFileTypes: true })

    // Group files by detected date, skip subdirectories
    const groups = new Map<string, string[]>()
    for (const entry of entries) {
      if (entry.isDirectory()) continue
      const match = entry.name.match(dateRegex)
      if (!match) { skipped++; continue }
      const date = match[1]
      if (!groups.has(date)) groups.set(date, [])
      groups.get(date)!.push(entry.name)
    }

    const moves: ConvertMove[] = []
    const createdFolders: string[] = []

    // Create date folders and move files into them
    for (const [date, files] of groups) {
      const folderPath = path.join(dirPath, date)
      const folderExisted = fs.existsSync(folderPath)
      if (!folderExisted) {
        fs.mkdirSync(folderPath)
        createdFolders.push(folderPath)
      }
      for (const file of files) {
        const from = path.join(dirPath, file)
        const to = path.join(folderPath, file)
        fs.renameSync(from, to)
        moves.push({ from, to })
      }
    }

    return { moved: moves.length, skipped, manifest: { moves, createdFolders } }
  })

  ipcMain.handle('streams:undoConvertDumpFolder', async (_event, manifest: { moves: { from: string; to: string }[]; createdFolders: string[] }): Promise<void> => {
    // Move files back to their original locations
    for (const { from, to } of manifest.moves) {
      if (fs.existsSync(to)) fs.renameSync(to, from)
    }
    // Remove only the folders the conversion created, and only if now empty
    for (const folder of manifest.createdFolders) {
      try {
        const remaining = fs.readdirSync(folder)
        if (remaining.length === 0) fs.rmdirSync(folder)
      } catch { /* folder already gone or not empty — leave it */ }
    }
  })

  // ── Directory watcher ──────────────────────────────────────────────────────
  let dirWatcher: FSWatcher | null = null
  // Debounce rapid bursts (e.g. multiple files landing at once) into one event
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  const DEBOUNCE_MS = 800

  function notifyChange(win: BrowserWindow) {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      if (!win.isDestroyed()) win.webContents.send('streams:changed')
    }, DEBOUNCE_MS)
  }

  ipcMain.handle('streams:watchDir', async (event, dir: string, mode: 'folder-per-stream' | 'dump-folder' = 'folder-per-stream') => {
    if (dirWatcher) { await dirWatcher.close(); dirWatcher = null }
    if (!dir || !fs.existsSync(dir)) return

    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return

    dirWatcher = chokidar.watch(dir, {
      depth: mode === 'dump-folder' ? 0 : 2,  // dump: root files only; folder: root + session subfolders
      ignoreInitial: true,
      persistent: true,
      awaitWriteFinish: { stabilityThreshold: 1000, pollInterval: 300 },
    })

    const onChange = () => notifyChange(win)
    dirWatcher.on('add', onChange)
    dirWatcher.on('unlink', onChange)
    dirWatcher.on('addDir', onChange)
    dirWatcher.on('unlinkDir', onChange)
    dirWatcher.on('change', onChange)
  })

  ipcMain.handle('streams:unwatchDir', async () => {
    if (dirWatcher) { await dirWatcher.close(); dirWatcher = null }
    if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null }
  })
}
