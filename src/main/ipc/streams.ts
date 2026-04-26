import { ipcMain, BrowserWindow, shell } from 'electron'
import fs from 'fs'
import path from 'path'
import { spawnSync } from 'child_process'
import chokidar, { FSWatcher } from 'chokidar'
import { getStore } from './store'
import type { ConversionPreset } from './converter'
import { checkLocalFiles } from './files'
import { probeFile } from '../services/ffmpegService'

export type VideoCategory = 'full' | 'short' | 'clip'

export interface VideoEntry {
  size: number
  mtime: number
  duration?: number
  width?: number
  height?: number
  fps?: number
  codec?: string
  category: VideoCategory
  // Set when this file was produced by the clip exporter. Enables "reopen in clip editor".
  clipOf?: string
  clipState?: unknown
}

export interface ClipDraft {
  id: string
  sourceName: string
  state: unknown  // ClipState — opaque on the main side (main never inspects it)
  thumbnailDataUrl?: string
  name?: string
  createdAt: number
  updatedAt: number
}

export interface StreamMeta {
  date: string
  streamType: string[]
  games: string[]
  comments: string
  archived?: boolean
  ytVideoId?: string
  preferredThumbnail?: string
  videoMap?: Record<string, VideoEntry>
  clipDrafts?: Record<string, ClipDraft>
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

export interface DetectedStructure {
  /** Best guess at the user's organizational mode. Empty when nothing was detected. */
  suggestedMode: 'folder-per-stream' | 'dump-folder' | ''
  /** Shape of the detected layout, for UI labelling.
   *  - 'flat'    → date folders sit directly inside the chosen dir
   *  - 'nested'  → date folders sit under intermediate grouping (e.g. year/month)
   *  - 'dump'    → dated files in the chosen dir, no date subfolders
   *  - 'unknown' → nothing recognisable */
  layoutKind: 'flat' | 'nested' | 'dump' | 'unknown'
  /** For folder-per-stream: 0 = direct child, 1 = under one grouping level, etc. */
  nestingDepth: number
  /** Total stream sessions found. */
  sessionCount: number
  /** First few sessions for the preview, newest first. */
  samples: { date: string; relativePath: string; games: string[] }[]
  /** Up to 3 example grouping prefixes (e.g. '2026/03-March') so the UI can describe the structure. */
  groupingHints: string[]
  /** True when the folder has no user content at all (ignoring _-prefixed system files).
   *  Lets the onboarding UI treat 'starting fresh' differently from 'unrecognised contents'. */
  isEmpty: boolean
}

export interface StreamFolder {
  /** Last path segment of the stream folder. Same as relativePath for flat layouts. */
  folderName: string
  /** Absolute filesystem path to the stream folder. */
  folderPath: string
  /** Path from the streams root to this folder, forward-slash normalized.
   *  Used as the canonical key in _meta.json so deeply-nested layouts
   *  (e.g. year/month/stream-folder) and same-named folders in different
   *  hierarchy branches stay distinct. */
  relativePath: string
  date: string
  meta: StreamMeta | null
  hasMeta: boolean
  detectedGames: string[]
  thumbnails: string[]
  /** Parallel to `thumbnails`. Each entry is true if the file's data is
   *  resident on disk; false if it's a cloud-provider placeholder. The
   *  renderer skips loading non-local thumbnails to avoid hanging on a bad
   *  cloud-sync state, and offers an on-demand hydrate from the lightbox. */
  thumbnailLocalFlags?: boolean[]
  videoCount: number
  videos: string[]
  isMissing?: boolean
}

const DATE_FOLDER_RE = /^\d{4}-\d{2}-\d{2}(-\d+)?$/
const DATE_IN_FILENAME_RE = /(\d{4}-\d{2}-\d{2})/
const META_FILENAME = '_meta.json'
const OLD_META_FILENAME = 'stream-meta.json'
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif'])
const VIDEO_EXTS = new Set([
  '.mkv', '.mp4', '.mov', '.avi', '.ts', '.flv', '.webm',
  '.wmv', '.m4v', '.mpg', '.mpeg', '.m2ts', '.mts', '.vob',
  '.divx', '.3gp', '.ogv', '.asf', '.rmvb', '.f4v', '.hevc'
])

/** Returns the YYYY-MM-DD portion of a folder name, stripping any -N suffix. */
function calendarDate(folderName: string): string {
  return folderName.slice(0, 10)
}

/** Returns the stream index: 1 for the base folder (no suffix), 2+ for -2, -3, etc. */
function streamIndex(folderName: string): number {
  const m = folderName.match(/^\d{4}-\d{2}-\d{2}-(\d+)$/)
  return m ? parseInt(m[1], 10) : 1
}

/**
 * Returns the next available folder name for a given calendar date.
 * First stream on a day → 'YYYY-MM-DD', second → 'YYYY-MM-DD-2', etc.
 */
function nextFolderName(parentDir: string, calDate: string): string {
  let siblings: string[] = []
  try {
    siblings = fs.readdirSync(parentDir, { withFileTypes: true })
      .filter(e => e.isDirectory() && calendarDate(e.name) === calDate && DATE_FOLDER_RE.test(e.name))
      .map(e => e.name)
  } catch {}
  if (siblings.length === 0) return calDate
  const maxIdx = Math.max(...siblings.map(streamIndex))
  return `${calDate}-${maxIdx + 1}`
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
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

  // SM-generated thumbnail has highest priority
  if (/sm-thumbnail$/i.test(base)) return [-1, base]

  const numbered = base.match(/thumbnail\s*[-–]\s*(\d+)/i)
  if (numbered) return [parseInt(numbered[1]), base]

  if (/thumbnail/i.test(base)) return [0, base]

  return [Infinity, base]
}

/** Return absolute paths of image files in the folder, thumbnail-first.
 *  Walks sub-folders so users can keep `thumbnails/` (or any other nested
 *  layout) and still have the app find their thumbnails. */
function detectThumbnails(folderPath: string): string[] {
  return collectStreamFiles(folderPath).thumbnails.sort((a, b) => {
    const [rankA, nameA] = thumbnailSortKey(path.basename(a))
    const [rankB, nameB] = thumbnailSortKey(path.basename(b))
    if (rankA !== rankB) return rankA - rankB
    return nameA.localeCompare(nameB)
  })
}

/** Walk a directory recursively up to maxDepth, returning every video and
 *  image file. Used to support nested layouts inside a stream folder
 *  (e.g. clips/, recordings/, exports/, thumbnails/). */
function collectStreamFiles(folderPath: string, maxDepth = 4): {
  videos: string[]
  thumbnails: string[]
} {
  const videos: string[] = []
  const thumbnails: string[] = []
  const walk = (dir: string, depth: number) => {
    if (depth > maxDepth) return
    let entries: fs.Dirent[]
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name.startsWith('_')) continue
      const full = path.join(dir, e.name)
      if (e.isDirectory()) { walk(full, depth + 1); continue }
      const ext = path.extname(e.name).toLowerCase()
      if (VIDEO_EXTS.has(ext)) videos.push(full)
      else if (IMAGE_EXTS.has(ext)) thumbnails.push(full)
    }
  }
  walk(folderPath, 0)
  return { videos, thumbnails }
}

/** Walk streamsDir recursively (up to maxDepth) and return absolute paths
 *  of every directory whose name matches the date-folder pattern. These are
 *  the user's stream folders — possibly nested under year/month/etc. */
function findStreamFolders(streamsDir: string, maxDepth = 5): string[] {
  const out: string[] = []
  const walk = (dir: string, depth: number) => {
    if (depth > maxDepth) return
    let entries: fs.Dirent[]
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (!e.isDirectory()) continue
      if (e.name.startsWith('_') || e.name.startsWith('.')) continue
      const full = path.join(dir, e.name)
      if (DATE_FOLDER_RE.test(e.name)) {
        out.push(full)
        // Don't recurse into a stream folder — its contents (including any
        // nested clips/recordings/exports/thumbnails) are gathered separately
        // by collectStreamFiles when the stream is read.
        continue
      }
      walk(full, depth + 1)
    }
  }
  walk(streamsDir, 0)
  return out
}

/** Path of `videoPath` relative to its stream folder, forward-slash normalized.
 *  Used as the canonical videoMap key so sub-folder files (e.g. clips/x.mp4)
 *  don't collide with top-level files of the same name. */
function videoRelKey(folderPath: string, videoPath: string): string {
  const rel = path.relative(folderPath, videoPath)
  return rel.split(path.sep).join('/')
}

/** Detect game names from MKV filenames anywhere inside a stream folder
 *  (including nested sub-folders like clips/ or recordings/). */
function detectGamesFromFolderRecursive(folderPath: string): string[] {
  const { videos } = collectStreamFiles(folderPath)
  const games: string[] = []
  for (const v of videos) {
    if (!v.toLowerCase().endsWith('.mkv')) continue
    const m = path.basename(v).match(/\(([^)]+)\)\.mkv$/i)
    if (m) {
      const game = m[1].trim()
      if (!games.includes(game)) games.push(game)
    }
  }
  return games
}

function metaFilePath(streamsDir: string): string {
  return path.join(streamsDir, META_FILENAME)
}

/** Ensure allMeta[key] exists so callers can safely read/write subfields like
 *  videoMap or clipDrafts. The stub uses empty user-meaningful fields; the
 *  app treats it as "no real metadata" via isMeaningfulMeta(). */
function ensureMetaEntry(allMeta: Record<string, StreamMeta>, key: string, date: string): StreamMeta {
  if (!allMeta[key]) {
    allMeta[key] = { date, streamType: [], games: [], comments: '' }
  }
  return allMeta[key]
}

/** True if a meta entry has any user-meaningful content. videoMap and
 *  clipDrafts are app-managed caches — their presence alone does NOT count
 *  as the user having added metadata, so the "missing metadata" warning
 *  still surfaces for streams whose only entry is a cached videoMap. */
function isMeaningfulMeta(m: StreamMeta | null | undefined): boolean {
  if (!m) return false
  if (m.streamType?.length) return true
  if (m.games?.length) return true
  if (m.comments?.trim()) return true
  if (m.archived) return true
  if (m.ytVideoId) return true
  if (m.preferredThumbnail) return true
  // smThumbnail flags — the user has at least started a built-in thumbnail
  if ((m as { smThumbnail?: boolean }).smThumbnail) return true
  if ((m as { smThumbnailTemplate?: string }).smThumbnailTemplate) return true
  return false
}

/** Canonical _meta.json key for a stream folder: forward-slash relative path
 *  from the streams root. Falls back to the basename if the path isn't actually
 *  inside streamsDir (defensive). */
function metaKey(streamsDir: string, folderPath: string): string {
  const rel = path.relative(streamsDir, folderPath)
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    return path.basename(folderPath)
  }
  return rel.split(path.sep).join('/')
}

/** Resolve the streams root from app config — used by IPC handlers that only
 *  receive a folderPath but need to compute its key relative to the root. */
function getStreamsDir(): string {
  return ((getStore().get('config') as any)?.streamsDir as string) ?? ''
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
  // On Windows, fs.writeFileSync fails with EPERM when overwriting a hidden file (CREATE_ALWAYS
  // on a hidden file returns ACCESS_DENIED). Unhide before writing, write, then re-hide.
  const isWin = process.platform === 'win32'
  if (isWin && fs.existsSync(filePath)) {
    try { spawnSync('attrib', ['-H', filePath], { timeout: 2000 }) } catch {}
  }
  fs.writeFileSync(filePath, JSON.stringify(allMeta, null, 2), 'utf-8')
  if (isWin) {
    try {
      const result = spawnSync('attrib', ['+H', filePath], { timeout: 2000 })
      if (result.status !== 0) {
        console.warn('[writeAllMeta] attrib +H failed', { status: result.status, stderr: result.stderr?.toString() })
      }
    } catch (err) {
      console.warn('[writeAllMeta] attrib +H threw', err)
    }
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

// ─── Video classification ─────────────────────────────────────────────────────

const CLOUD_SIZE_THRESHOLD = 2 * 1024 * 1024 * 1024  // 2 GB

function classifyVideo(
  duration: number | undefined,
  width: number | undefined,
  height: number | undefined,
  size: number,
  isLocal: boolean,
  clipThresholdSecs: number
): VideoCategory {
  if (isLocal && width !== undefined && height !== undefined) {
    if (height > width) return 'short'
    if (duration !== undefined && duration <= clipThresholdSecs) return 'clip'
    return 'full'
  }
  return size < CLOUD_SIZE_THRESHOLD ? 'clip' : 'full'
}

/**
 * Probes uncached/stale video files and updates allMeta in-place.
 * Returns true if anything changed (so the caller can decide to persist).
 */
async function refreshVideoMaps(
  entries: Array<{ key: string; folderPath: string; date: string; videos: string[] }>,
  allMeta: Record<string, StreamMeta>,
  clipThresholdSecs: number
): Promise<boolean> {
  const allPaths: string[] = []
  const pathKey: Map<string, string> = new Map()
  const pathDate: Map<string, string> = new Map()
  // Maps an absolute video path to its forward-slash key relative to its
  // stream folder. For flat layouts this equals the basename — backward
  // compatible with legacy videoMap entries.
  const pathRelKey: Map<string, string> = new Map()

  for (const { key, folderPath, date, videos } of entries) {
    for (const v of videos) {
      allPaths.push(v)
      pathKey.set(v, key)
      pathDate.set(v, date)
      pathRelKey.set(v, videoRelKey(folderPath, v))
    }
  }
  if (allPaths.length === 0) return false

  const localFlags = await checkLocalFiles(allPaths)

  // Stat all files for size + mtime
  const stats = allPaths.map(p => { try { return fs.statSync(p) } catch { return null } })

  let changed = false
  const toProbe: Array<{ p: string; idx: number }> = []

  for (let i = 0; i < allPaths.length; i++) {
    const p = allPaths[i]
    const key = pathKey.get(p)!
    const relKey = pathRelKey.get(p)!
    const stat = stats[i]
    if (!stat) continue

    const existing = allMeta[key]?.videoMap?.[relKey]
    const isLocal = localFlags[i]

    if (isLocal) {
      // Re-probe if missing, mtime changed, or the cached entry is a stat-only fallback
      // (no duration) from a previous probe failure — gives it a chance to upgrade on retry.
      if (!existing || existing.mtime !== stat.mtimeMs || existing.duration === undefined) {
        toProbe.push({ p, idx: i })
      }
    } else if (!existing) {
      // Cloud placeholder — record size-only entry immediately
      const entry: VideoEntry = {
        size: stat.size,
        mtime: stat.mtimeMs,
        category: classifyVideo(undefined, undefined, undefined, stat.size, false, clipThresholdSecs),
      }
      const meta = ensureMetaEntry(allMeta, key, pathDate.get(p)!)
      if (!meta.videoMap) meta.videoMap = {}
      meta.videoMap[relKey] = entry
      changed = true
    }
  }

  if (toProbe.length > 0) {
    // Cap parallelism — too many concurrent ffprobe child processes can hit Windows resource
    // limits and cause silent failures on a subset of files.
    const PROBE_CONCURRENCY = 4
    const PROBE_TIMEOUT_MS = 20_000
    const probeOne = async ({ p, idx }: { p: string; idx: number }) => {
      const key = pathKey.get(p)!
      const relKey = pathRelKey.get(p)!
      const stat = stats[idx]!
      const prev = allMeta[key]?.videoMap?.[relKey]
      try {
        // Wrap probeFile in a timeout — a single hanging ffprobe shouldn't stall the whole batch.
        const info = await Promise.race([
          probeFile(p),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('probe timeout')), PROBE_TIMEOUT_MS)),
        ])
        // App-produced clips (have clipOf) keep a hard-coded category based on their saved crop,
        // overriding the automatic classifier so 'vid' can't leak back in after a re-probe.
        let category: VideoEntry['category']
        if (prev?.clipOf) {
          const cropAspect = (prev.clipState as { cropAspect?: string } | undefined)?.cropAspect
          category = cropAspect === '9:16' ? 'short' : 'clip'
        } else {
          category = classifyVideo(info.duration, info.width, info.height, stat.size, true, clipThresholdSecs)
        }
        const entry: VideoEntry = {
          size: stat.size,
          mtime: stat.mtimeMs,
          duration: info.duration,
          width: info.width,
          height: info.height,
          fps: info.fps,
          codec: info.videoCodec,
          category,
          // Preserve clip-export tagging across re-probes
          clipOf: prev?.clipOf,
          clipState: prev?.clipState,
        }
        const meta = ensureMetaEntry(allMeta, key, pathDate.get(p)!)
        if (!meta.videoMap) meta.videoMap = {}
        meta.videoMap[relKey] = entry
        changed = true
      } catch (err) {
        // Probe failed (corrupt file, locked by another process, ffprobe timeout, etc.).
        // Record a stat-only entry so the file isn't invisible to the count and tooltip;
        // a future load will retry the probe (mtime check) and upgrade the entry.
        console.warn(`[refreshVideoMaps] probe failed for ${p}:`, err)
        if (!prev) {
          const entry: VideoEntry = {
            size: stat.size,
            mtime: stat.mtimeMs,
            category: classifyVideo(undefined, undefined, undefined, stat.size, true, clipThresholdSecs),
          }
          const meta = ensureMetaEntry(allMeta, key, pathDate.get(p)!)
          if (!meta.videoMap) meta.videoMap = {}
          meta.videoMap[relKey] = entry
          changed = true
        }
      }
    }
    // Run probes in batches of PROBE_CONCURRENCY to avoid overwhelming ffprobe.
    for (let i = 0; i < toProbe.length; i += PROBE_CONCURRENCY) {
      await Promise.all(toProbe.slice(i, i + PROBE_CONCURRENCY).map(probeOne))
    }
  }

  // Prune stale entries: remove videoMap keys whose files are no longer in the folder.
  // Handles renames and deletes that happened outside the app (or via converter rename).
  for (const { key, folderPath, videos } of entries) {
    const map = allMeta[key]?.videoMap
    if (!map) continue
    const currentNames = new Set(videos.map(v => videoRelKey(folderPath, v)))
    for (const name of Object.keys(map)) {
      if (!currentNames.has(name)) {
        delete map[name]
        changed = true
      }
    }
  }

  return changed
}

// ─────────────────────────────────────────────────────────────────────────────

export function registerStreamsIPC(): void {
  ipcMain.handle('streams:list', async (event, dir: string, mode: 'folder-per-stream' | 'dump-folder' = 'folder-per-stream'): Promise<StreamFolder[]> => {
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
        if (meta?.preferredThumbnail) {
          const idx = sortedThumbnails.findIndex(t => path.basename(t) === meta.preferredThumbnail)
          if (idx > 0) { const [item] = sortedThumbnails.splice(idx, 1); sortedThumbnails.unshift(item) }
        }
        folders.push({
          folderName: date,
          folderPath: dir,
          relativePath: date,
          date,
          meta,
          hasMeta: isMeaningfulMeta(meta),
          detectedGames: detectGamesFromFiles(videos),
          thumbnails: sortedThumbnails,
          videoCount: videos.length,
          videos,
        })
      }

      // Meta entries with no files: isMissing only if date is strictly in the past
      for (const [date, meta] of Object.entries(allMeta)) {
        if (seenDates.has(date)) continue
        // Skip stub entries (only videoMap/clipDrafts) — they're caches, not
        // user-meaningful, and shouldn't surface as orphans on missing files.
        if (!isMeaningfulMeta(meta)) continue
        folders.push({
          folderName: date,
          folderPath: dir,
          relativePath: date,
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
      // Walks recursively so users can group streams under year/month/etc.
      // Each found stream folder may itself contain sub-folders for organization
      // (clips, recordings, exports, …); collectStreamFiles flattens those.
      const streamFolderPaths = findStreamFolders(dir)
      const seenKeys = new Set<string>()

      for (const folderPath of streamFolderPaths) {
        const folderName = path.basename(folderPath)
        const relativePath = metaKey(dir, folderPath)
        seenKeys.add(relativePath)

        const meta = allMeta[relativePath] ?? null
        const detectedGames = detectGamesFromFolderRecursive(folderPath)
        const thumbnails = detectThumbnails(folderPath)
        if (meta?.preferredThumbnail) {
          const idx = thumbnails.findIndex(t => path.basename(t) === meta.preferredThumbnail)
          if (idx > 0) { const [item] = thumbnails.splice(idx, 1); thumbnails.unshift(item) }
        }

        const videos = collectStreamFiles(folderPath).videos

        folders.push({
          folderName,
          folderPath,
          relativePath,
          date: calendarDate(folderName),
          meta,
          hasMeta: isMeaningfulMeta(meta),
          detectedGames,
          thumbnails,
          videoCount: videos.length,
          videos,
        })
      }

      // Orphaned meta entries (folder gone) — always isMissing in folder mode.
      // Reconstruct the absolute path from the relative key so deep entries
      // also surface as missing rather than silently disappearing.
      for (const [key, meta] of Object.entries(allMeta)) {
        if (seenKeys.has(key)) continue
        // Skip stub entries (only videoMap/clipDrafts) — they're caches, not
        // user-meaningful, and shouldn't surface as orphans on missing folders.
        if (!isMeaningfulMeta(meta)) continue
        const folderName = key.includes('/') ? key.slice(key.lastIndexOf('/') + 1) : key
        if (!DATE_FOLDER_RE.test(folderName)) continue
        const folderPath = path.join(dir, ...key.split('/'))
        folders.push({
          folderName,
          folderPath,
          relativePath: key,
          date: calendarDate(folderName),
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

    // Sort by calendar date descending; same-day streams descending by index (later streams first)
    folders.sort((a, b) => {
      const dateCmp = b.date.localeCompare(a.date)
      if (dateCmp !== 0) return dateCmp
      return streamIndex(b.folderName) - streamIndex(a.folderName)
    })

    // Attach the cached _meta.json entry to each folder so the response carries
    // any cached videoMap and clipDrafts. This intentionally runs even for
    // folders that don't have user-meaningful metadata yet — refreshVideoMaps
    // creates stub entries on first scan, and the renderer needs to read the
    // cached videoMap from them. hasMeta stays governed by isMeaningfulMeta().
    for (const folder of folders) {
      const cached = allMeta[folder.relativePath]
      if (cached && !folder.meta) folder.meta = cached
    }

    // Compute thumbnail local-flags so the renderer can skip rendering an <img>
    // for cloud-placeholder thumbnails (avoids hanging Chromium's network thread
    // on a cloud provider that's stuck or unreachable).
    const allThumbs = folders.flatMap(f => f.thumbnails)
    if (allThumbs.length > 0) {
      try {
        const t0 = Date.now()
        const flags = await Promise.race([
          checkLocalFiles(allThumbs),
          new Promise<boolean[]>((_, reject) =>
            setTimeout(() => reject(new Error('thumbnail localFiles check timeout')), 15000)
          ),
        ])
        let i = 0
        for (const f of folders) {
          f.thumbnailLocalFlags = flags.slice(i, i + f.thumbnails.length)
          i += f.thumbnails.length
        }
        const localCount = flags.filter(Boolean).length
        const cloudCount = flags.length - localCount
        console.log(`[streams:list] thumbnails classified in ${Date.now() - t0}ms: ${localCount} local, ${cloudCount} cloud (of ${flags.length} total)`)
      } catch (err) {
        console.warn('[streams:list] thumbnail localFiles check failed:', err)
        // SAFETY NET: when classification fails (timeout, PowerShell error, etc.),
        // mark every thumbnail as non-local. The renderer shows cloud icons —
        // ugly but safe — instead of trying to load file:// URLs that may hang
        // Chromium's network thread on a stuck cloud provider.
        for (const f of folders) {
          f.thumbnailLocalFlags = f.thumbnails.map(() => false)
        }
      }
    }

    // Only refresh video maps if the set of video files has changed since last cache.
    // Keys are paths relative to each stream folder (forward-slash) — for flat layouts
    // this equals the bare filename, so legacy maps are still valid.
    const clipThreshold = ((getStore().get('config') as any)?.clipDurationThreshold) ?? 300
    const videoEntries = folders
      .filter(f => f.videos.length > 0 && !f.isMissing)
      .map(f => ({ key: f.relativePath, folderPath: f.folderPath, date: f.date, videos: f.videos }))
    const videoSetChanged = videoEntries.some(({ key, folderPath, videos }) => {
      const cached = allMeta[key]?.videoMap
      if (!cached) return videos.length > 0
      const cachedNames = new Set(Object.keys(cached))
      const currentNames = new Set(videos.map(v => videoRelKey(folderPath, v)))
      if (cachedNames.size !== currentNames.size) return true
      for (const name of currentNames) if (!cachedNames.has(name)) return true
      return false
    })
    if (videoSetChanged) {
      refreshVideoMaps(videoEntries, allMeta, clipThreshold)
        .then(changed => {
          if (!changed) return
          try { writeAllMeta(dir, allMeta) }
          catch (err) { console.error('[streams:list] writeAllMeta failed:', err) }
          // Notify the renderer so it re-fetches with the freshly-written
          // videoMap entries (e.g. categories for newly-arrived files). The
          // chokidar self-loop guard means our own _meta.json write doesn't
          // trigger a streams:changed event automatically.
          const win = BrowserWindow.fromWebContents(event.sender)
          if (win && !win.isDestroyed()) win.webContents.send('streams:changed')
        })
        .catch(err => console.error('[streams:list] refreshVideoMaps failed:', err))
    }

    return folders
  })

  // For each meta-touching IPC: an explicit `metaKeyOverride` lets the renderer
  // pass the canonical key (folder.relativePath). Necessary in dump mode where
  // every stream shares the same folderPath (= the dump dir) and key derivation
  // can't tell them apart. Falls back to deriving from folderPath when omitted.

  ipcMain.handle('streams:writeMeta', async (_event, folderPath: string, meta: StreamMeta, metaKeyOverride?: string) => {
    const streamsDir = getStreamsDir() || path.dirname(folderPath)
    const key = metaKeyOverride || metaKey(streamsDir, folderPath)
    const allMeta = readAllMeta(streamsDir)
    allMeta[key] = meta
    writeAllMeta(streamsDir, allMeta)
  })

  // Merge a partial meta update into the existing entry. Safe for callers that only own a subset
  // of fields (e.g. the thumbnail editor's smThumbnail flags) — preserves any fields edited
  // concurrently from other UI paths.
  ipcMain.handle('streams:updateMeta', async (_event, folderPath: string, partial: Partial<StreamMeta>, metaKeyOverride?: string) => {
    const streamsDir = getStreamsDir() || path.dirname(folderPath)
    const key = metaKeyOverride || metaKey(streamsDir, folderPath)
    const allMeta = readAllMeta(streamsDir)
    const existing = allMeta[key] ?? ({} as StreamMeta)
    allMeta[key] = { ...existing, ...partial }
    writeAllMeta(streamsDir, allMeta)
  })

  // Insert or update a single clip draft in the folder's meta, preserving other drafts.
  // Server-side merge avoids races between concurrent draft edits on different videos in the folder.
  ipcMain.handle('clipDraft:save', async (_event, folderPath: string, draft: ClipDraft, metaKeyOverride?: string) => {
    const streamsDir = getStreamsDir() || path.dirname(folderPath)
    const key = metaKeyOverride || metaKey(streamsDir, folderPath)
    const allMeta = readAllMeta(streamsDir)
    const existing = allMeta[key] ?? ({} as StreamMeta)
    const drafts = { ...(existing.clipDrafts ?? {}), [draft.id]: draft }
    allMeta[key] = { ...existing, clipDrafts: drafts }
    writeAllMeta(streamsDir, allMeta)
  })

  ipcMain.handle('clipDraft:delete', async (_event, folderPath: string, draftId: string, metaKeyOverride?: string) => {
    const streamsDir = getStreamsDir() || path.dirname(folderPath)
    const key = metaKeyOverride || metaKey(streamsDir, folderPath)
    const allMeta = readAllMeta(streamsDir)
    const existing = allMeta[key]
    if (!existing?.clipDrafts?.[draftId]) return
    const drafts = { ...existing.clipDrafts }
    delete drafts[draftId]
    allMeta[key] = { ...existing, clipDrafts: drafts }
    writeAllMeta(streamsDir, allMeta)
  })

  // Tag an exported clip's videoMap entry with clipOf + clipState so the user can reopen it
  // in the clip editor later. Also removes the originating draft if provided. Server-side merge
  // keeps concurrent edits (e.g. refreshVideoMaps) safe.
  ipcMain.handle('clip:tagExport', async (_event, folderPath: string, outputFilename: string, sourceName: string, clipState: unknown, draftId?: string | null, metaKeyOverride?: string) => {
    const streamsDir = getStreamsDir() || path.dirname(folderPath)
    const key = metaKeyOverride || metaKey(streamsDir, folderPath)
    const allMeta = readAllMeta(streamsDir)
    const existing = allMeta[key] ?? ({} as StreamMeta)
    const videoMap = { ...(existing.videoMap ?? {}) }
    const outputPath = path.join(folderPath, outputFilename)
    let stat: fs.Stats | null = null
    try { stat = fs.statSync(outputPath) } catch { /* file not written yet — create minimal entry */ }
    const current = videoMap[outputFilename]
    // App-produced clips always get their category forced: '9:16' crop → 'short', otherwise 'clip'.
    // Overrides anything refreshVideoMaps/classifyVideo may have written.
    const cropAspect = (clipState as { cropAspect?: string } | null)?.cropAspect
    const forcedCategory: VideoEntry['category'] = cropAspect === '9:16' ? 'short' : 'clip'
    // Base: existing entry if present, otherwise minimal stat-derived entry so the VideoEntry
    // contract (size/mtime/category required) is always satisfied.
    const base: VideoEntry = current ?? {
      size: stat?.size ?? 0,
      mtime: stat?.mtimeMs ?? Date.now(),
      category: forcedCategory,
    }
    videoMap[outputFilename] = {
      ...base,
      category: forcedCategory,
      clipOf: sourceName,
      clipState: clipState as any,
    } as VideoEntry
    const clipDrafts = { ...(existing.clipDrafts ?? {}) }
    if (draftId && clipDrafts[draftId]) delete clipDrafts[draftId]
    allMeta[key] = { ...existing, videoMap, clipDrafts }
    writeAllMeta(streamsDir, allMeta)
  })

  ipcMain.handle('streams:detectStructure', async (_event, dir: string): Promise<DetectedStructure> => {
    const blank = (isEmpty = false): DetectedStructure => ({
      suggestedMode: '', layoutKind: 'unknown', nestingDepth: 0,
      sessionCount: 0, samples: [], groupingHints: [], isEmpty,
    })
    if (!dir || !fs.existsSync(dir)) return blank()
    let isDir = false
    try { isDir = fs.statSync(dir).isDirectory() } catch {}
    if (!isDir) return blank()

    // Treat the folder as empty when it has no user-visible content (system/hidden
    // entries prefixed with _ or . don't count). Lets the UI auto-apply the default
    // mode for fresh-start folders instead of bothering the user with a picker.
    let isEmpty = true
    try {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name.startsWith('_') || e.name.startsWith('.')) continue
        isEmpty = false
        break
      }
    } catch {}

    const streamFolderPaths = findStreamFolders(dir)

    // Per-stream wins if we found any date-named folders.
    if (streamFolderPaths.length > 0) {
      const depths = streamFolderPaths.map(fp => {
        const rel = path.relative(dir, fp)
        return rel.split(path.sep).length - 1
      })
      const maxDepth = Math.max(...depths)
      const groupingSet = new Set<string>()
      for (const fp of streamFolderPaths) {
        const rel = path.relative(dir, fp)
        const segments = rel.split(path.sep)
        if (segments.length > 1) groupingSet.add(segments.slice(0, -1).join('/'))
      }
      const samples = streamFolderPaths
        .slice()
        .sort((a, b) => path.basename(b).localeCompare(path.basename(a)))
        .slice(0, 5)
        .map(fp => ({
          date: calendarDate(path.basename(fp)),
          relativePath: metaKey(dir, fp),
          games: detectGamesFromFolderRecursive(fp),
        }))
      return {
        suggestedMode: 'folder-per-stream',
        layoutKind: maxDepth === 0 ? 'flat' : 'nested',
        nestingDepth: maxDepth,
        sessionCount: streamFolderPaths.length,
        samples,
        groupingHints: [...groupingSet].sort().slice(0, 3),
        isEmpty: false,
      }
    }

    // No date folders → look for dated files in the root (dump layout).
    const groups = new Map<string, { videos: string[]; thumbnails: string[] }>()
    try {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory()) continue
        const m = e.name.match(DATE_IN_FILENAME_RE)
        if (!m) continue
        const date = m[1]
        if (!groups.has(date)) groups.set(date, { videos: [], thumbnails: [] })
        const ext = path.extname(e.name).toLowerCase()
        const filePath = path.join(dir, e.name)
        if (VIDEO_EXTS.has(ext)) groups.get(date)!.videos.push(filePath)
        else if (IMAGE_EXTS.has(ext)) groups.get(date)!.thumbnails.push(filePath)
      }
    } catch {}

    if (groups.size > 0) {
      const samples = [...groups.entries()]
        .sort(([a], [b]) => b.localeCompare(a))
        .slice(0, 5)
        .map(([date, g]) => ({
          date,
          relativePath: date,
          games: detectGamesFromFiles(g.videos),
        }))
      return {
        suggestedMode: 'dump-folder',
        layoutKind: 'dump',
        nestingDepth: 0,
        sessionCount: groups.size,
        samples,
        groupingHints: [],
        isEmpty: false,
      }
    }

    return blank(isEmpty)
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

    // Folder-per-stream mode — auto-assign suffix for same-day streams
    const folderName = nextFolderName(parentDir, date)
    const folderPath = path.join(parentDir, folderName)
    fs.mkdirSync(folderPath, { recursive: true })
    if (meta) {
      const allMeta = readAllMeta(parentDir)
      allMeta[folderName] = meta
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
          ...(allMeta[date] ?? { date, streamType: ['games'], games: [], comments: '' }),
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

  /** Substitute the FIRST occurrence of oldDate inside a basename. Returns null
   *  if oldDate isn't present (so callers can skip files that have nothing to
   *  do with this stream). Defensive: filenames like '…-2026-04-01-clip-of-
   *  2026-03-15.mp4' have only their primary date bumped. */
  const replaceFirstDate = (name: string, oldDate: string, newDate: string): string | null => {
    const i = name.indexOf(oldDate)
    if (i === -1) return null
    return name.slice(0, i) + newDate + name.slice(i + oldDate.length)
  }

  /** Walk folderPath recursively. Each returned plan is one file's rename
   *  intent — fromAbs/toAbs absolute paths, plus their videoMap-relative keys. */
  const collectFileRenames = (
    folderPath: string,
    oldDate: string,
    newDate: string,
  ): { fromAbs: string; toAbs: string; fromRelKey: string; toRelKey: string }[] => {
    const out: { fromAbs: string; toAbs: string; fromRelKey: string; toRelKey: string }[] = []
    const walk = (dir: string) => {
      let entries: fs.Dirent[]
      try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
      for (const e of entries) {
        if (e.name.startsWith('_') || e.name.startsWith('.')) continue
        const full = path.join(dir, e.name)
        if (e.isDirectory()) { walk(full); continue }
        const renamed = replaceFirstDate(e.name, oldDate, newDate)
        if (renamed === null) continue
        const toAbs = path.join(dir, renamed)
        out.push({
          fromAbs: full,
          toAbs,
          fromRelKey: videoRelKey(folderPath, full),
          toRelKey: videoRelKey(folderPath, toAbs),
        })
      }
    }
    walk(folderPath)
    return out
  }

  ipcMain.handle('streams:previewReschedule', async (
    _event,
    folderPath: string,
    oldDate: string,
    newDate: string,
  ): Promise<{
    isDump: boolean
    folderConflict: boolean
    folderRename: { from: string; to: string } | null
    filesToRename: { from: string; to: string; collision: boolean }[]
    hasCollisions: boolean
  }> => {
    const streamsDir = getStreamsDir() || path.dirname(folderPath)
    const isDump = path.resolve(folderPath) === path.resolve(streamsDir)

    let folderConflict = false
    let folderRename: { from: string; to: string } | null = null
    if (!isDump) {
      const oldFolderName = path.basename(folderPath)
      const parent = path.dirname(folderPath)
      const newFolderName = nextFolderName(parent, newDate)
      folderConflict = fs.existsSync(path.join(parent, newFolderName))
      folderRename = { from: oldFolderName, to: newFolderName }
    }

    const fileRenames = collectFileRenames(folderPath, oldDate, newDate)
    // A "collision" is a target path that already exists AND isn't itself one of
    // the sources we're about to rename away (otherwise A→B + B→C wouldn't
    // chain through the temp state).
    const sourceSet = new Set(fileRenames.map(r => r.fromAbs.toLowerCase()))
    const filesToRename = fileRenames
      .filter(r => r.fromAbs !== r.toAbs)
      .map(r => ({
        from: path.relative(folderPath, r.fromAbs).split(path.sep).join('/'),
        to: path.relative(folderPath, r.toAbs).split(path.sep).join('/'),
        collision: fs.existsSync(r.toAbs) && !sourceSet.has(r.toAbs.toLowerCase()),
      }))
    const hasCollisions = filesToRename.some(f => f.collision)

    return { isDump, folderConflict, folderRename, filesToRename, hasCollisions }
  })

  ipcMain.handle('streams:reschedule', async (
    _event,
    folderPath: string,
    oldDate: string,
    newDate: string,
  ): Promise<{ newFolderPath: string; renamedCount: number; skippedCount: number }> => {
    const streamsDir = getStreamsDir() || path.dirname(folderPath)
    const isDump = path.resolve(folderPath) === path.resolve(streamsDir)

    // ── 1. File renames ─────────────────────────────────────────────────────
    const plans = collectFileRenames(folderPath, oldDate, newDate)
    const sourceSet = new Set(plans.map(r => r.fromAbs.toLowerCase()))
    const performed: typeof plans = []
    let skipped = 0
    for (const r of plans) {
      if (r.fromAbs === r.toAbs) continue
      // Skip collisions: a target that exists and isn't itself a source we'll move first.
      if (fs.existsSync(r.toAbs) && !sourceSet.has(r.toAbs.toLowerCase())) { skipped++; continue }
      try {
        fs.renameSync(r.fromAbs, r.toAbs)
        performed.push(r)
      } catch (err) {
        console.warn(`[reschedule] rename failed ${r.fromAbs} → ${r.toAbs}:`, err)
        skipped++
      }
    }

    // ── 2. Rename the stream folder (folder-per-stream only) ────────────────
    // Done BEFORE meta update so we can roll back the file renames cleanly if
    // the folder rename fails. Pause our own chokidar watcher first — it holds
    // a Windows ReadDirectoryChangesW handle on every watched subdirectory,
    // which is enough on its own to make a directory rename fail with EPERM.
    // Cloud-sync clients (Synology Drive, OneDrive) can also briefly lock the
    // folder, so we still retry a few times.
    const oldKey = isDump ? oldDate : path.basename(folderPath)
    const newKey = isDump ? newDate : nextFolderName(path.dirname(folderPath), newDate)
    const needsFolderRename = !isDump && oldKey !== newKey
    let finalFolderPath = folderPath
    if (needsFolderRename) {
      const newFolderPath = path.join(path.dirname(folderPath), newKey)
      const restartWatcher = await pauseDirWatcher()
      let lastErr: unknown = null
      try {
        // Short escalating retries cover the cloud-sync window. Total ≈ 5s.
        for (const delayMs of [200, 500, 1000, 1500, 2000]) {
          await new Promise(r => setTimeout(r, delayMs))
          try {
            fs.renameSync(folderPath, newFolderPath)
            finalFolderPath = newFolderPath
            lastErr = null
            break
          } catch (err) {
            lastErr = err
            // EPERM/EBUSY are the lock cases; anything else (ENOENT, EEXIST)
            // is permanent — abort the retry loop immediately.
            const code = (err as { code?: string }).code
            if (code !== 'EPERM' && code !== 'EBUSY') break
          }
        }
      } finally {
        restartWatcher()
      }
      if (lastErr) {
        // Roll back file renames in reverse order so chained renames unwind safely.
        console.warn('[reschedule] folder rename failed, rolling back file renames:', lastErr)
        for (let i = performed.length - 1; i >= 0; i--) {
          const r = performed[i]
          try { fs.renameSync(r.toAbs, r.fromAbs) }
          catch (rollbackErr) { console.error(`[reschedule] rollback failed ${r.toAbs} → ${r.fromAbs}:`, rollbackErr) }
        }
        throw lastErr
      }
    }

    // ── 3. Update _meta.json ────────────────────────────────────────────────
    // Only reached if the folder rename succeeded (or wasn't needed). Safe to
    // commit the new key here knowing the folder name on disk matches.
    const allMeta = readAllMeta(streamsDir)
    const entry = allMeta[oldKey]
    if (entry) {
      const updated: StreamMeta = { ...entry, date: newDate }
      // Re-key videoMap entries for renamed files + repoint clipOf refs.
      if (entry.videoMap) {
        const remap = new Map(performed.map(r => [r.fromRelKey, r.toRelKey]))
        const basenameRemap = new Map(performed.map(r => [path.basename(r.fromAbs), path.basename(r.toAbs)]))
        const newVideoMap: NonNullable<StreamMeta['videoMap']> = {}
        for (const [k, v] of Object.entries(entry.videoMap)) {
          const targetKey = remap.get(k) ?? k
          const newClipOf = v.clipOf && basenameRemap.get(v.clipOf)
          newVideoMap[targetKey] = newClipOf ? { ...v, clipOf: newClipOf } : { ...v }
        }
        updated.videoMap = newVideoMap
      }
      if (oldKey !== newKey) delete allMeta[oldKey]
      allMeta[newKey] = updated
      writeAllMeta(streamsDir, allMeta)
    }

    if (needsFolderRename) {
      return { newFolderPath: finalFolderPath, renamedCount: performed.length, skippedCount: skipped }
    }
    return { newFolderPath: folderPath, renamedCount: performed.length, skippedCount: skipped }
  })

  ipcMain.handle('streams:deleteFolder', async (_event, folderPath: string) => {
    // path.dirname is wrong for nested layouts (streams root may be 2+ levels up);
    // pull the canonical streams root from config so the meta key + write target
    // resolve correctly.
    const streamsDir = getStreamsDir() || path.dirname(folderPath)
    const key = metaKey(streamsDir, folderPath)

    // Pause our chokidar watcher first — its ReadDirectoryChangesW handle on
    // this folder will make shell.trashItem fail on Windows (IFileOperation
    // needs exclusive access, same constraint as rename).
    const restartWatcher = await pauseDirWatcher()
    try {
      await shell.trashItem(folderPath)
    } finally {
      restartWatcher()
    }

    // Only clear meta if the trash actually succeeded — keeps state consistent
    // if e.g. a cloud-sync lock prevented the trash and the folder is still on disk.
    const allMeta = readAllMeta(streamsDir)
    delete allMeta[key]
    writeAllMeta(streamsDir, allMeta)
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
  // Captured so the watcher can be transparently restarted with the same config
  // after operations that need exclusive folder access (e.g. reschedule renames
  // a stream folder; chokidar holds a Windows ReadDirectoryChangesW handle on
  // every watched subdirectory, which would block the rename).
  let currentWatchConfig: { dir: string; mode: 'folder-per-stream' | 'dump-folder'; win: BrowserWindow } | null = null
  // Debounce rapid bursts (e.g. multiple files landing at once) into one event
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  const DEBOUNCE_MS = 800

  function notifyChange(win: BrowserWindow) {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      if (!win.isDestroyed()) win.webContents.send('streams:changed')
    }, DEBOUNCE_MS)
  }

  function startDirWatcher(dir: string, mode: 'folder-per-stream' | 'dump-folder', win: BrowserWindow) {
    dirWatcher = chokidar.watch(dir, {
      // dump: root files only. folder: deep enough to cover year/month grouping
      // above the stream folder PLUS sub-org (clips/, recordings/, …) below it.
      // 6 covers root → year → month → stream → sub-folder → file.
      depth: mode === 'dump-folder' ? 0 : 6,
      ignoreInitial: true,
      persistent: true,
      awaitWriteFinish: { stabilityThreshold: 1000, pollInterval: 300 },
      // Ignore our own metadata file. We write _meta.json from the renderer's
      // save flow and from refreshVideoMaps; without this guard, chokidar fires
      // 'change' on those writes and the renderer re-runs loadFolders, which
      // re-runs refreshVideoMaps and may re-write _meta.json — feedback loop.
      ignored: (p: string) => p.endsWith('_meta.json'),
    })

    const onChange = () => notifyChange(win)
    dirWatcher.on('add', onChange)
    dirWatcher.on('unlink', onChange)
    dirWatcher.on('addDir', onChange)
    dirWatcher.on('unlinkDir', onChange)
    dirWatcher.on('change', onChange)
    dirWatcher.on('error', err => console.warn('[streams:watchDir] watcher error:', err))
  }

  /** Briefly close the directory watcher so it doesn't hold ReadDirectoryChangesW
   *  handles on the folder we're about to mutate. Returns a function to restart
   *  the watcher with the original config (call it from a finally block). */
  pauseDirWatcher = async (): Promise<() => void> => {
    if (!dirWatcher || !currentWatchConfig) return () => {}
    const config = currentWatchConfig
    await dirWatcher.close()
    dirWatcher = null
    return () => { startDirWatcher(config.dir, config.mode, config.win) }
  }

  ipcMain.handle('streams:watchDir', async (event, dir: string, mode: 'folder-per-stream' | 'dump-folder' = 'folder-per-stream') => {
    if (dirWatcher) { await dirWatcher.close(); dirWatcher = null }
    if (!dir || !fs.existsSync(dir)) { currentWatchConfig = null; return }

    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return

    currentWatchConfig = { dir, mode, win }
    startDirWatcher(dir, mode, win)
  })

  ipcMain.handle('streams:unwatchDir', async () => {
    if (dirWatcher) { await dirWatcher.close(); dirWatcher = null }
    if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null }
    currentWatchConfig = null
  })
}

// Set inside registerStreamsIPC so the reschedule handler can pause its own
// chokidar watcher around the folder rename. Module-scoped so the assignment
// inside the closure is visible to other handlers in the same module.
let pauseDirWatcher: () => Promise<() => void> = async () => () => {}
