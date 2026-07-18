import { ipcMain, BrowserWindow, app } from 'electron'
import { createHash } from 'crypto'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { spawnSync } from 'child_process'
import chokidar, { FSWatcher } from 'chokidar'
import { getStore } from './store'
import type { ConversionPreset } from './converter'
import { checkLocalFiles, isFileConfirmedLocal, trashItemWithRetry } from './files'
import { probeFile, parseClipProvenance } from '../services/ffmpegService'
import { isInFlightWrite } from '../services/inFlightWrites'
import { consumeSelfWrite } from '../services/selfWrites'

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

export interface AudioTrackSetting {
  muted?: boolean
  solo?: boolean
  volume?: number
  /** Tag-color key (see renderer constants/tagColors). */
  color?: string
}

export interface StreamMeta {
  date: string
  streamType: string[]
  games: string[]
  comments: string
  archived?: boolean
  ytVideoId?: string
  /** sha1 of the thumbnail bytes last pushed to YouTube — compared against the
   *  current thumbnail to detect an out-of-sync thumbnail. (The full set of YT
   *  sync fields lives on the renderer's StreamMeta; the main process only
   *  needs the ones it reads/writes directly.) */
  ytThumbnailPushedHash?: string
  preferredThumbnail?: string
  videoMap?: Record<string, VideoEntry>
  clipDrafts?: Record<string, ClipDraft>
  // Multi-track audio settings keyed by filename → trackIndex → settings.
  // Persisted so reopening a file restores the user's M/S/volume choices.
  audioSettings?: Record<string, Record<number, AudioTrackSetting>>
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
  // LOCAL calendar date — toISOString() is UTC, which flagged tonight's
  // dump-mode stream as "missing" every evening in western timezones.
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
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
      // Skip encoder outputs still being written (clip exports, conversions):
      // listing them makes a half-written file look like a normal video —
      // thumbnail probes fire against it and every action button operates on
      // garbage. The converter's completion event rescans and reveals the
      // finished file with its clip provenance in place.
      if (isInFlightWrite(full)) continue
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
  // Explicit creation stamp (New stream / New episode) — a deliberately
  // created stream counts even when every other field is still empty.
  // Cache stubs (ensureMetaEntry) never carry it, so in dump mode a bare
  // new stream gets its meta-only row instead of vanishing as a "stub".
  if ((m as { createdAt?: number }).createdAt) return true
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
 *  inside streamsDir (defensive). Exported for the other write sites
 *  (thumbnail saves) that emit stream-scoped `streams:changed` events. */
export function metaKey(streamsDir: string, folderPath: string): string {
  const rel = path.relative(streamsDir, folderPath)
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    return path.basename(folderPath)
  }
  return rel.split(path.sep).join('/')
}

/** Resolve a changed filesystem path to the stream folder that owns it —
 *  the key of the FIRST date-named directory level under the streams root,
 *  matching findStreamFolders' stop-at-first-date-match walk. Returns null
 *  when the path isn't inside any stream folder (root-level files, the
 *  stream folder itself, template/asset dirs) — callers treat that as a
 *  structural change and fall back to a full reload. Folder-per-stream
 *  mode only; dump mode always full-scans. */
export function streamKeyForPath(streamsDir: string, p: string): string | null {
  const rel = path.relative(path.resolve(streamsDir), path.resolve(p))
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null
  const segs = rel.split(path.sep)
  // The matched segment must not be the final one: the event path has to
  // live INSIDE the stream folder. An event for the date-named entry
  // itself is a create/delete of the whole stream (structural), and a
  // date-patterned FILE at the root must not masquerade as a folder key.
  const parts: string[] = []
  for (let i = 0; i < segs.length - 1; i++) {
    parts.push(segs[i])
    if (DATE_FOLDER_RE.test(segs[i])) return parts.join('/')
  }
  return null
}

/** Resolve the streams root from app config — used by IPC handlers that only
 *  receive a folderPath but need to compute its key relative to the root. */
function getStreamsDir(): string {
  return ((getStore().get('config') as any)?.streamsDir as string) ?? ''
}

// ── _meta.json health ─────────────────────────────────────────────────────
// When a read of an EXISTING _meta.json fails (locked or unparseable), the
// store enters a failed state: readAllMeta throws instead of returning {},
// and writeAllMeta refuses to write, so a bad read can never be laundered
// into a "save" that wipes the library. Cleared by the next successful read.
// Global rather than per-dir — the app runs against one streams root at a
// time, and a false-positive lockout on a secondary dir only pauses edits.
export type MetaHealth =
  | { ok: true; note?: { kind: 'restored'; from: string; at: string } }
  | { ok: false; kind: 'locked' | 'corrupt'; detail: string }

let metaHealth: MetaHealth = { ok: true }
// Corrupt originals already preserved this session (one copy per file, so a
// render-loop of failing reads doesn't spray copies).
const corruptCopySaved = new Set<string>()

function setMetaHealth(next: MetaHealth): void {
  const changed = JSON.stringify(metaHealth) !== JSON.stringify(next)
  metaHealth = next
  if (!changed) return
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('streams:metaHealth', metaHealth)
  }
}

export function readAllMeta(streamsDir: string): Record<string, StreamMeta> {
  const filePath = metaFilePath(streamsDir)
  const tmpPath = filePath + '.tmp'

  // Read with brief retries — sync clients (Synology Drive) can hold the
  // file for a moment while uploading it.
  let raw: string | null = null
  let lastErr: unknown = null
  for (const delayMs of [0, 100, 250, 500]) {
    if (delayMs) sleepSync(delayMs)
    try {
      raw = fs.readFileSync(filePath, 'utf-8')
      break
    } catch (err) {
      if ((err as { code?: string }).code === 'ENOENT') {
        // Missing file = legitimately empty library (fresh root). Never to
        // be confused with an unreadable EXISTING file, which is a failure.
        // Preserves an active 'restored' note (ok stays ok).
        setMetaHealth(metaHealth.ok ? metaHealth : { ok: true })
        return {}
      }
      lastErr = err
    }
  }

  if (raw === null) {
    // Exists but unreadable after retries. Do NOT return {} — that used to
    // let the next write commit an empty library over the real one.
    setMetaHealth({ ok: false, kind: 'locked', detail: (lastErr as Error)?.message ?? String(lastErr) })
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, StreamMeta>
    // Healthy read clears a failed state but preserves a 'restored' note —
    // the user dismisses that one explicitly (streams:dismissMetaNote).
    setMetaHealth(metaHealth.ok ? metaHealth : { ok: true })
    // A leftover temp sibling means a previous swap didn't complete (that
    // write's caller already saw the error). The main file parses, so it is
    // the truth — drop the stale temp so it can never be mistaken for
    // recovery data later.
    try { fs.unlinkSync(tmpPath) } catch { /* usually ENOENT */ }
    return parsed
  } catch {
    // Exists and reads but doesn't parse: torn by a crash on a pre-swap
    // build, or mangled by a sync conflict. Preserve the evidence once…
    if (!corruptCopySaved.has(filePath)) {
      corruptCopySaved.add(filePath)
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      try { fs.copyFileSync(filePath, path.join(streamsDir, `_meta.corrupt-${stamp}.json`)) }
      catch (copyErr) { console.error('[readAllMeta] failed to preserve corrupt copy:', copyErr) }
    }
    // …then try the temp sibling: a crash BETWEEN the temp fsync and the
    // rename leaves the new, already-verified data in the temp, so
    // completing that swap is the correct recovery.
    let recovered: Record<string, StreamMeta> | null = null
    try { recovered = JSON.parse(fs.readFileSync(tmpPath, 'utf-8')) as Record<string, StreamMeta> } catch { /* no temp / also bad */ }
    if (recovered !== null) {
      setMetaHealth({ ok: true }) // before writeAllMeta so the lockout doesn't trip on our own heal
      try {
        writeAllMeta(streamsDir, recovered)
        console.warn('[readAllMeta] _meta.json was corrupt; recovered from the temp sibling')
      } catch (healErr) {
        // Memory is good even if the disk heal failed — the next successful
        // write repairs the file. Health stays ok: we HAVE the data.
        console.warn('[readAllMeta] recovered from temp, but rewriting _meta.json failed (next write retries):', healErr)
      }
      return recovered
    }
    // …then the rolling backups, newest parseable first. Restoring loses
    // whatever changed after that backup was taken, so a successful restore
    // carries a 'restored' note that the renderer surfaces until dismissed.
    for (const backupPath of listMetaBackups(streamsDir)) {
      let restored: Record<string, StreamMeta> | null = null
      try { restored = JSON.parse(fs.readFileSync(backupPath, 'utf-8')) as Record<string, StreamMeta> } catch { continue }
      let takenAt = ''
      try { takenAt = fs.statSync(backupPath).mtime.toISOString() } catch { /* stamp stays empty */ }
      setMetaHealth({ ok: true, note: { kind: 'restored', from: path.basename(backupPath), at: takenAt } })
      try {
        writeAllMeta(streamsDir, restored)
        console.warn(`[readAllMeta] _meta.json was corrupt; restored from backup ${path.basename(backupPath)}`)
      } catch (healErr) {
        console.warn('[readAllMeta] restored from backup, but rewriting _meta.json failed (next write retries):', healErr)
      }
      return restored
    }
    setMetaHealth({
      ok: false, kind: 'corrupt',
      detail: 'The file is not valid JSON and no usable backup was found. A copy was preserved next to it as _meta.corrupt-*.json.',
    })
    throw new Error('_meta.json is damaged (not valid JSON) and no usable backup was found. Metadata edits are paused; the damaged file was preserved as _meta.corrupt-*.json.')
  }
}

/** Synchronous sleep for writeAllMeta's rename retries. The write path must
 *  stay fully synchronous: every caller is a read-modify-write sequence, and
 *  an await between the read and the write would let two IPC handlers
 *  interleave and clobber each other's changes. */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

// streamsDirs whose _meta.json has had the legacy hidden attribute stripped
// this session (see step 3 in writeAllMeta).
const hiddenAttrStripped = new Set<string>()

/** Crash-safe _meta.json write: write a temp sibling, verify its shape, then
 *  atomically rename it over the real file. At no point is _meta.json itself
 *  in a partially-written state — any failure (including a crash or power
 *  loss mid-write) leaves the previous version intact on disk, with the temp
 *  file beside it. Throws on failure; callers' IPC rejections surface it. */
export function writeAllMeta(streamsDir: string, allMeta: Record<string, StreamMeta>): void {
  // Refuse to write while the store is in a failed-read state — the caller's
  // in-memory map may be empty or stale, and committing it would make a
  // transient read failure permanent. Synchronous callers can't get here
  // (their own readAllMeta already threw); this catches detached async
  // writers holding a pre-failure snapshot (e.g. refreshVideoMaps' .then).
  if (!metaHealth.ok) {
    throw new Error(`_meta.json write refused: the last read failed (${metaHealth.kind}). ${metaHealth.detail}`)
  }

  const filePath = metaFilePath(streamsDir)
  const tmpPath = filePath + '.tmp'

  // 1. Write the temp sibling and flush it to disk before the swap.
  const fd = fs.openSync(tmpPath, 'w')
  try {
    fs.writeSync(fd, JSON.stringify(allMeta, null, 2), null, 'utf-8')
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }

  // 2. Shape check before the swap: parseable, and the same entry count as
  //    memory. Catches truncated/garbled writes without a byte-for-byte diff.
  const readBack = JSON.parse(fs.readFileSync(tmpPath, 'utf-8')) as Record<string, unknown>
  const expected = Object.keys(allMeta).length
  const actual = Object.keys(readBack).length
  if (actual !== expected) {
    throw new Error(`_meta.json verify failed: temp file has ${actual} entries, memory has ${expected}`)
  }

  // 3. Legacy migration: _meta.json used to carry the Windows hidden
  //    attribute, which makes overwrite AND rename-over fail with EPERM. The
  //    file is no longer hidden — strip the attribute once per session so
  //    pre-existing libraries swap cleanly.
  if (process.platform === 'win32' && !hiddenAttrStripped.has(filePath)) {
    if (fs.existsSync(filePath)) {
      try { spawnSync('attrib', ['-H', filePath], { timeout: 2000 }) } catch {}
    }
    hiddenAttrStripped.add(filePath)
  }

  // 4. Atomic swap. The rename can transiently fail while a sync client
  //    (Synology Drive) holds the target for upload — retry briefly, then
  //    give up with BOTH files intact (old data in place, new data in .tmp).
  let lastErr: unknown = null
  for (const delayMs of [0, 100, 250]) {
    if (delayMs) sleepSync(delayMs)
    try {
      fs.renameSync(tmpPath, filePath)
      maybeBackupMeta(streamsDir)
      return
    } catch (err) {
      lastErr = err
      const code = (err as { code?: string }).code
      if (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES') break
    }
  }
  throw lastErr
}

// ── _meta.json rolling backups ──────────────────────────────────────────────
// Copies of the verified on-disk file, kept OUTSIDE the streams root — and so
// outside the sync client's scope — in userData/meta-backups/<dir-hash>/.
// Cadence: at most one per 30 minutes of active editing (piggybacked on
// writes, so every backup is a copy of a just-verified file), plus one at
// quit when writes happened since the last one. Newest BACKUP_KEEP kept.
// readAllMeta restores from these (newest parseable first) when _meta.json
// is corrupt and the temp sibling can't help.
const BACKUP_INTERVAL_MS = 30 * 60_000
const BACKUP_KEEP = 10
const lastBackupAt = new Map<string, number>()
const dirtySinceBackup = new Set<string>()

function metaBackupDir(streamsDir: string): string {
  // Hash the normalized root path so libraries never share a backup folder —
  // restoring library A's backup into library B would itself be data loss.
  const hash = createHash('sha1')
    .update(path.resolve(streamsDir).toLowerCase().split(path.sep).join('/'))
    .digest('hex').slice(0, 8)
  return path.join(app.getPath('userData'), 'meta-backups', hash)
}

/** Existing backups for this library, newest first (ISO stamps in the names
 *  make lexicographic order chronological). */
function listMetaBackups(streamsDir: string): string[] {
  try {
    return fs.readdirSync(metaBackupDir(streamsDir))
      .filter(n => /^_meta-.*\.json$/.test(n))
      .sort((a, b) => b.localeCompare(a))
      .map(n => path.join(metaBackupDir(streamsDir), n))
  } catch {
    return []
  }
}

function backupMeta(streamsDir: string): void {
  const filePath = metaFilePath(streamsDir)
  try {
    if (!fs.existsSync(filePath)) return
    const dir = metaBackupDir(streamsDir)
    fs.mkdirSync(dir, { recursive: true })
    // Human breadcrumb for manual recovery — says which library these
    // hashed-folder backups belong to.
    const marker = path.join(dir, 'location.txt')
    if (!fs.existsSync(marker)) {
      try { fs.writeFileSync(marker, streamsDir, 'utf-8') } catch { /* cosmetic */ }
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    fs.copyFileSync(filePath, path.join(dir, `_meta-${stamp}.json`))
    lastBackupAt.set(filePath, Date.now())
    dirtySinceBackup.delete(filePath)
    for (const old of listMetaBackups(streamsDir).slice(BACKUP_KEEP)) {
      try { fs.unlinkSync(old) } catch { /* next prune retries */ }
    }
  } catch (err) {
    // Backups are best-effort — never let one fail a save.
    console.warn('[backupMeta] backup failed (non-fatal):', err)
  }
}

/** Called after every successful writeAllMeta swap: back up at most once per
 *  interval, otherwise just remember there's unsaved-to-backup work so the
 *  quit hook can catch the tail. */
function maybeBackupMeta(streamsDir: string): void {
  const filePath = metaFilePath(streamsDir)
  if (Date.now() - (lastBackupAt.get(filePath) ?? 0) >= BACKUP_INTERVAL_MS) backupMeta(streamsDir)
  else dirtySinceBackup.add(filePath)
}

/** One last backup of the active library at shutdown, only when writes
 *  happened since the previous backup. Called from main/index.ts. */
export function backupMetaOnQuit(): void {
  const streamsDir = getStreamsDir()
  if (streamsDir && dirtySinceBackup.has(metaFilePath(streamsDir))) backupMeta(streamsDir)
}

/**
 * Absolute paths of files the streams UI reads on every render and would
 * promptly re-hydrate if evicted. Mirrors the displayed-thumbnail logic from
 * the streams listing (`streams:list`):
 *   1. The thumbnail set per stream is sorted by `thumbnailSortKey`.
 *   2. If meta.preferredThumbnail is set, it gets moved to position 0.
 *   3. The streams page renders thumbnails[0] — that's the protected file.
 *
 * Without this fallback, streams whose meta has no preferredThumbnail get
 * their default-displayed thumbnail offloaded, then immediately re-hydrated
 * by the next render — defeating the purpose.
 *
 * Consumed by the cloud-sync offload IPC to silently skip these files.
 */
export function getProtectedPaths(streamsDir: string): Set<string> {
  const protectedSet = new Set<string>()
  if (!streamsDir) return protectedSet
  const allMeta = readAllMeta(streamsDir)
  const mode: 'folder-per-stream' | 'dump-folder' =
    ((getStore().get('config') as { streamMode?: 'folder-per-stream' | 'dump-folder' } | undefined)?.streamMode) ?? 'folder-per-stream'

  const pickDisplayed = (sortedThumbs: string[], pref?: string): string | null => {
    if (sortedThumbs.length === 0) return null
    if (pref) {
      const match = sortedThumbs.find(t => path.basename(t) === pref)
      if (match) return match
    }
    return sortedThumbs[0]
  }

  if (mode === 'dump-folder') {
    // Group by date in filename — same shape the streams listing uses.
    let entries: fs.Dirent[]
    try { entries = fs.readdirSync(streamsDir, { withFileTypes: true }) } catch { return protectedSet }
    const groups = new Map<string, string[]>()
    for (const entry of entries) {
      if (entry.isDirectory()) continue
      const m = entry.name.match(DATE_IN_FILENAME_RE)
      if (!m) continue
      const ext = path.extname(entry.name).toLowerCase()
      if (!IMAGE_EXTS.has(ext)) continue
      const date = m[1]
      const list = groups.get(date) ?? []
      list.push(path.join(streamsDir, entry.name))
      groups.set(date, list)
    }
    for (const [date, thumbnails] of groups) {
      const sorted = [...thumbnails].sort((a, b) => {
        const [ra, na] = thumbnailSortKey(path.basename(a))
        const [rb, nb] = thumbnailSortKey(path.basename(b))
        return ra !== rb ? ra - rb : na.localeCompare(nb)
      })
      const chosen = pickDisplayed(sorted, allMeta[date]?.preferredThumbnail)
      if (chosen) protectedSet.add(chosen)
    }
  } else {
    for (const folderPath of findStreamFolders(streamsDir)) {
      const key = metaKey(streamsDir, folderPath)
      const sorted = detectThumbnails(folderPath)
      const chosen = pickDisplayed(sorted, allMeta[key]?.preferredThumbnail)
      if (chosen) protectedSet.add(chosen)
    }
  }

  return protectedSet
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
  width: number | undefined,
  height: number | undefined,
  size: number,
  isLocal: boolean,
): VideoCategory {
  // Local, probeable videos: portrait → short, otherwise full. (Clip
  // auto-detection by duration was removed — app-produced clips are
  // force-categorized by the caller via `clipOf`.)
  if (isLocal && width !== undefined && height !== undefined) {
    return height > width ? 'short' : 'full'
  }
  // Cloud placeholders / probe failures can't be measured — fall back to
  // the size heuristic.
  return size < CLOUD_SIZE_THRESHOLD ? 'clip' : 'full'
}

/**
 * Probes uncached/stale video files and records the results into `allMeta`
 * in-place. Returns true if anything changed.
 *
 * IMPORTANT: `allMeta` is the caller's scan-time snapshot and this can run
 * for minutes — by completion the snapshot is stale, so it is SCRATCH SPACE
 * for the probe results, never to be persisted wholesale. The streams:list
 * caller re-reads the current _meta.json and merges only the per-file
 * videoMap entries computed here. Removals are not this function's job
 * either — see pruneStaleVideoMapEntries (applied synchronously at scan
 * time).
 */
// Returns the set of stream keys whose videoMap actually changed — NOT a
// blanket "something changed" boolean. The scoped streams:changed pipeline
// forwards these keys to the renderer, and over-reporting is expensive:
// claiming every scanned stream as touched made the renderer fetch
// listOne for the whole library after launch (a PowerShell hydration
// check per stream, all timing out in parallel).
async function refreshVideoMaps(
  entries: Array<{ key: string; folderPath: string; date: string; videos: string[] }>,
  allMeta: Record<string, StreamMeta>,
): Promise<Set<string>> {
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
  if (allPaths.length === 0) return new Set()

  const localFlags = await checkLocalFiles(allPaths)

  // Stat all files for size + mtime
  const stats = allPaths.map(p => { try { return fs.statSync(p) } catch { return null } })

  const changedKeys = new Set<string>()
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
        category: classifyVideo(undefined, undefined, stat.size, false),
      }
      const meta = ensureMetaEntry(allMeta, key, pathDate.get(p)!)
      if (!meta.videoMap) meta.videoMap = {}
      meta.videoMap[relKey] = entry
      changedKeys.add(key)
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
          // Fallback: a clip that lost its _meta.json clipOf entry (moved out of
          // its folder, meta deleted) still carries an SM clip marker in its
          // container metadata — trust that over the size/aspect heuristic.
          category = parseClipProvenance(info.comment) ?? classifyVideo(info.width, info.height, stat.size, true)
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
        changedKeys.add(key)
      } catch (err) {
        // Probe failed (corrupt file, locked by another process, ffprobe timeout, etc.).
        // Record a stat-only entry so the file isn't invisible to the count and tooltip;
        // a future load will retry the probe (mtime check) and upgrade the entry.
        console.warn(`[refreshVideoMaps] probe failed for ${p}:`, err)
        if (!prev) {
          const entry: VideoEntry = {
            size: stat.size,
            mtime: stat.mtimeMs,
            category: classifyVideo(undefined, undefined, stat.size, true),
          }
          const meta = ensureMetaEntry(allMeta, key, pathDate.get(p)!)
          if (!meta.videoMap) meta.videoMap = {}
          meta.videoMap[relKey] = entry
          changedKeys.add(key)
        }
      }
    }
    // Run probes in batches of PROBE_CONCURRENCY to avoid overwhelming ffprobe.
    for (let i = 0; i < toProbe.length; i += PROBE_CONCURRENCY) {
      await Promise.all(toProbe.slice(i, i + PROBE_CONCURRENCY).map(probeOne))
    }
  }

  return changedKeys
}

/**
 * Remove videoMap entries whose files are no longer in their folder — renames
 * and deletes done outside the app (or via converter rename). Pure scan-time
 * bookkeeping (no probing), so streams:list applies + persists it
 * synchronously BEFORE kicking off the async probe; see the call site for why
 * it must not be deferred. Returns true if anything was removed.
 */
function pruneStaleVideoMapEntries(
  entries: Array<{ key: string; folderPath: string; videos: string[] }>,
  allMeta: Record<string, StreamMeta>,
): boolean {
  let changed = false
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

/** Assemble one folder-mode StreamFolder from disk + the meta store.
 *  Shared by the full streams:list scan and the scoped streams:listOne
 *  fetch so the two can never drift. (Dump mode has its own grouping
 *  logic and never goes through here.) */
function buildStreamFolder(folderPath: string, relativePath: string, allMeta: Record<string, StreamMeta>): StreamFolder {
  const folderName = path.basename(folderPath)
  const meta = allMeta[relativePath] ?? null
  // Filename game-detection removed — see the dump-mode scan.
  const thumbnails = detectThumbnails(folderPath)
  if (meta?.preferredThumbnail) {
    const idx = thumbnails.findIndex(t => path.basename(t) === meta.preferredThumbnail)
    if (idx > 0) { const [item] = thumbnails.splice(idx, 1); thumbnails.unshift(item) }
  }
  const videos = collectStreamFiles(folderPath).videos
  return {
    folderName,
    folderPath,
    relativePath,
    date: calendarDate(folderName),
    meta,
    hasMeta: isMeaningfulMeta(meta),
    detectedGames: [],
    thumbnails,
    videoCount: videos.length,
    videos,
  }
}

// ─────────────────────────────────────────────────────────────────────────────

export function registerStreamsIPC(): void {
  // Current _meta.json health for late-mounting renderers; transitions are
  // pushed via the 'streams:metaHealth' event (see setMetaHealth).
  ipcMain.handle('streams:getMetaHealth', () => metaHealth)

  // Clear the restored-from-backup note once the user has acknowledged it.
  ipcMain.handle('streams:dismissMetaNote', () => {
    if (metaHealth.ok) setMetaHealth({ ok: true })
  })

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
        // Same in-flight-output skip as collectStreamFiles (folder mode).
        if (isInFlightWrite(filePath)) continue
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
          // Filename game-detection removed — games are assigned explicitly,
          // not guessed from filenames (kept on the type as an empty array so
          // the meta.games-or-detected fallbacks downstream simply no-op).
          detectedGames: [],
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
        const relativePath = metaKey(dir, folderPath)
        seenKeys.add(relativePath)
        folders.push(buildStreamFolder(folderPath, relativePath, allMeta))
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

    // Keys are paths relative to each stream folder (forward-slash) — for flat layouts
    // this equals the bare filename, so legacy maps are still valid.
    const videoEntries = folders
      .filter(f => f.videos.length > 0 && !f.isMissing)
      .map(f => ({ key: f.relativePath, folderPath: f.folderPath, date: f.date, videos: f.videos }))

    // Prune videoMap entries for files that no longer exist (renames/deletes
    // done outside the app). This needs only scan-time data, so it runs — and
    // persists — synchronously right here. It must NOT ride along with the
    // async probe below: prune decisions from a minutes-old file listing
    // applied to a fresh future _meta.json could wrongly delete entries for
    // files that appeared in the meantime (e.g. a clip exported mid-probe).
    if (pruneStaleVideoMapEntries(videoEntries, allMeta)) {
      try { writeAllMeta(dir, allMeta) }
      catch (err) { console.error('[streams:list] prune write failed:', err) }
    }

    // Probe when video files APPEARED since the last cache (the prune
    // above already applied removals, so a delete-only change no longer
    // spins up the probe pipeline at all) — or when a file was
    // OVERWRITTEN IN PLACE: a clip re-export (-y) changes content
    // without changing the name set, and gating on names alone meant
    // the stale entry (old duration/size) survived every restart
    // because refreshVideoMaps' mtime-mismatch re-probe never ran.
    // The mtime drift check is stat-only — cheap next to the directory
    // walk that just happened; ffprobe still only runs inside
    // refreshVideoMaps for the files that actually changed.
    const videoSetChanged = videoEntries.some(({ key, folderPath, videos }) => {
      const cached = allMeta[key]?.videoMap
      if (!cached) return videos.length > 0
      const currentNames = videos.map(v => videoRelKey(folderPath, v))
      const cachedNames = new Set(Object.keys(cached))
      if (cachedNames.size !== currentNames.length) return true
      for (const name of currentNames) if (!cachedNames.has(name)) return true
      for (let i = 0; i < videos.length; i++) {
        const entry = cached[currentNames[i]]
        if (!entry) continue
        try {
          if (fs.statSync(videos[i]).mtimeMs !== entry.mtime) return true
        } catch { /* unreadable right now — the prune/placeholder paths own it */ }
      }
      return false
    })
    if (videoSetChanged) {
      refreshVideoMaps(videoEntries, allMeta)
        .then(changedKeys => {
          if (changedKeys.size === 0) return
          // The probe can run for minutes (first scan, big import), so by
          // now `allMeta` is a stale scan-time snapshot. Never write it
          // back: re-read the CURRENT file and merge in only what the probe
          // computed (per-file videoMap entries). The read-merge-write is
          // synchronous, so nothing can interleave — metadata edits,
          // deletions, and clip exports made while probing all survive.
          // Only streams the probe actually CHANGED are merged/announced —
          // over-reporting made the renderer refetch the entire library.
          const touchedKeys: string[] = []
          try {
            const fresh = readAllMeta(dir)
            for (const { key, folderPath, date } of videoEntries) {
              if (!changedKeys.has(key)) continue
              const computed = allMeta[key]?.videoMap
              if (!computed || Object.keys(computed).length === 0) continue
              let target = fresh[key]
              if (!target) {
                // Entry vanished while probing. A deleted stream (folder
                // gone) stays deleted; a folder that still exists just has
                // no meta yet — recreate the cache stub. (Dump mode's shared
                // folderPath always exists, matching its pre-existing
                // stub-resurrection behavior for cache-only entries.)
                if (!fs.existsSync(folderPath)) continue
                target = ensureMetaEntry(fresh, key, date)
              }
              // Additive per-file overlay: files that appeared after the
              // scan (absent from `computed`) keep whatever entry a
              // concurrent writer gave them.
              target.videoMap = { ...(target.videoMap ?? {}), ...computed }
              touchedKeys.push(key)
            }
            if (touchedKeys.length === 0) return
            writeAllMeta(dir, fresh)
          } catch (err) {
            // Meta locked/corrupt right now — drop the merge. The probed
            // entries were never persisted, so the next scan simply
            // re-probes them.
            console.error('[streams:list] videoMap merge failed:', err)
            return
          }
          // Notify the renderer so it re-fetches with the freshly-written
          // videoMap entries (e.g. categories for newly-arrived files). The
          // chokidar self-loop guard means our own _meta.json write doesn't
          // trigger a streams:changed event automatically. Scoped to the
          // touched streams (folder mode) and quiet in either mode — new
          // files have new paths, so nothing needs a thumbnail cache-bust.
          const win = BrowserWindow.fromWebContents(event.sender)
          if (win && !win.isDestroyed()) {
            win.webContents.send('streams:changed',
              mode === 'folder-per-stream'
                ? { quiet: true, streamKeys: touchedKeys }
                : { quiet: true })
          }
        })
        .catch(err => console.error('[streams:list] refreshVideoMaps failed:', err))
    }

    return folders
  })

  // Scoped single-stream fetch — the data source for targeted
  // `streams:changed { streamKeys }` events (todo #43). Folder-per-stream
  // mode only; dump mode always full-scans. Returns:
  //   - the assembled StreamFolder when the folder exists
  //   - an isMissing entry when the folder is gone but meaningful meta
  //     remains (mirrors the full scan's orphan handling)
  //   - null when nothing remains (the renderer splices the row out)
  ipcMain.handle('streams:listOne', async (event, dir: string, streamKey: string): Promise<StreamFolder | null> => {
    if (!dir || !streamKey || !fs.existsSync(dir)) return null
    const allMeta = readAllMeta(dir)
    const folderPath = path.join(dir, ...streamKey.split('/'))

    if (!fs.existsSync(folderPath)) {
      const meta = allMeta[streamKey]
      if (!meta || !isMeaningfulMeta(meta)) return null
      const folderName = streamKey.includes('/') ? streamKey.slice(streamKey.lastIndexOf('/') + 1) : streamKey
      if (!DATE_FOLDER_RE.test(folderName)) return null
      return {
        folderName,
        folderPath,
        relativePath: streamKey,
        date: calendarDate(folderName),
        meta,
        hasMeta: true,
        detectedGames: [],
        videoCount: 0,
        videos: [],
        thumbnails: [],
        isMissing: true,
      }
    }

    const folder = buildStreamFolder(folderPath, streamKey, allMeta)

    // Thumbnail cloud classification for just this folder — same safety net
    // as the full scan: on failure mark everything non-local so the renderer
    // shows cloud icons instead of risking a hung file:// load.
    if (folder.thumbnails.length > 0) {
      try {
        const flags = await Promise.race([
          checkLocalFiles(folder.thumbnails),
          new Promise<boolean[]>((_, reject) =>
            setTimeout(() => reject(new Error('thumbnail localFiles check timeout')), 15000)
          ),
        ])
        folder.thumbnailLocalFlags = flags
      } catch (err) {
        console.warn('[streams:listOne] thumbnail localFiles check failed:', err)
        folder.thumbnailLocalFlags = folder.thumbnails.map(() => false)
      }
    }

    // Folder-scoped videoMap maintenance — the same prune / probe / merge
    // pipeline streams:list runs, restricted to this one stream. The merge
    // notify is scoped and quiet for the same reasons as the full scan's.
    if (!folder.isMissing && folder.videos.length > 0) {
      const entry = { key: folder.relativePath, folderPath: folder.folderPath, date: folder.date, videos: folder.videos }
      if (pruneStaleVideoMapEntries([entry], allMeta)) {
        try { writeAllMeta(dir, allMeta) }
        catch (err) { console.error('[streams:listOne] prune write failed:', err) }
      }
      const cached = allMeta[entry.key]?.videoMap
      const currentNames = entry.videos.map(v => videoRelKey(entry.folderPath, v))
      const videoSetChanged = !cached
        ? entry.videos.length > 0
        : (() => {
            const cachedNames = new Set(Object.keys(cached))
            if (cachedNames.size !== currentNames.length) return true
            for (const name of currentNames) if (!cachedNames.has(name)) return true
            for (let i = 0; i < entry.videos.length; i++) {
              const e = cached[currentNames[i]]
              if (!e) continue
              try {
                if (fs.statSync(entry.videos[i]).mtimeMs !== e.mtime) return true
              } catch { /* unreadable right now — the prune/placeholder paths own it */ }
            }
            return false
          })()
      if (videoSetChanged) {
        refreshVideoMaps([entry], allMeta)
          .then(changedKeys => {
            if (changedKeys.size === 0) return
            try {
              const fresh = readAllMeta(dir)
              const computed = allMeta[entry.key]?.videoMap
              if (!computed || Object.keys(computed).length === 0) return
              let target = fresh[entry.key]
              if (!target) {
                if (!fs.existsSync(entry.folderPath)) return
                target = ensureMetaEntry(fresh, entry.key, entry.date)
              }
              target.videoMap = { ...(target.videoMap ?? {}), ...computed }
              writeAllMeta(dir, fresh)
            } catch (err) {
              console.error('[streams:listOne] videoMap merge failed:', err)
              return
            }
            const win = BrowserWindow.fromWebContents(event.sender)
            if (win && !win.isDestroyed()) {
              win.webContents.send('streams:changed', { quiet: true, streamKeys: [entry.key] })
            }
          })
          .catch(err => console.error('[streams:listOne] refreshVideoMaps failed:', err))
      }
    }

    return folder
  })

  // For each meta-touching IPC: an explicit `metaKeyOverride` lets the renderer
  // pass the canonical key (folder.relativePath). Necessary in dump mode where
  // every stream shares the same folderPath (= the dump dir) and key derivation
  // can't tell them apart. Falls back to deriving from folderPath when omitted.

  // Set of YouTube video ids already linked to a local stream — lets the
  // "Import from YouTube" picker flag / skip already-imported videos.
  ipcMain.handle('streams:getLinkedYouTubeIds', async (): Promise<string[]> => {
    const streamsDir = getStreamsDir()
    if (!streamsDir) return []
    const allMeta = readAllMeta(streamsDir)
    const ids = new Set<string>()
    for (const m of Object.values(allMeta)) { if (m?.ytVideoId) ids.add(m.ytVideoId) }
    return [...ids]
  })

  ipcMain.handle('streams:writeMeta', async (_event, folderPath: string, meta: StreamMeta, metaKeyOverride?: string) => {
    const streamsDir = getStreamsDir() || path.dirname(folderPath)
    const key = metaKeyOverride || metaKey(streamsDir, folderPath)
    const allMeta = readAllMeta(streamsDir)
    // Preserve tracking fields the metadata UIs don't own — videoMap
    // (holds clipOf parent↔clip relationships), clipDrafts (in-progress
    // clip work), and audioSettings (per-track M/S/volume preferences).
    // These are managed by dedicated IPCs (clip:tagExport, clipDraft:*,
    // streams:updateMeta partial writes from the player), and any caller
    // that builds `meta` from scratch — e.g. the MetaModal save path —
    // would otherwise silently wipe them on every save. Callers that
    // spread `{...f.meta!, ...}` already include these so this is a no-op
    // for them; only the from-scratch paths benefit.
    const existing = allMeta[key] ?? ({} as StreamMeta)
    allMeta[key] = {
      ...meta,
      videoMap: meta.videoMap ?? existing.videoMap,
      clipDrafts: meta.clipDrafts ?? existing.clipDrafts,
      audioSettings: meta.audioSettings ?? existing.audioSettings,
    }
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

  // One-time backfill: stamp `ytThumbnailPushedHash` on linked streams that
  // predate the thumbnail-sync-snapshot feature so their (already up-to-date)
  // thumbnails stop reading as an out-of-sync push. Resolves the displayed
  // thumbnail exactly the way streams:list does, then sha1-hashes it (the same
  // hash the mismatch check compares against). Only touches LINKED entries
  // (`ytVideoId`) that LACK the hash — never overwrites a real push snapshot.
  // The caller vouches that local thumbnails already match YouTube.
  ipcMain.handle('streams:backfillThumbnailHashes', async (
    _event,
    dir: string,
    mode: 'folder-per-stream' | 'dump-folder' = 'folder-per-stream',
  ): Promise<{ updated: number; skippedNoThumb: number }> => {
    const streamsDir = dir || getStreamsDir()
    if (!streamsDir || !fs.existsSync(streamsDir)) return { updated: 0, skippedNoThumb: 0 }
    const allMeta = readAllMeta(streamsDir)

    // key → displayed thumbnail path (thumbnails[0] after preferredThumbnail),
    // mirroring the two scan modes in streams:list.
    const thumbByKey = new Map<string, string>()
    const promotePreferred = (sorted: string[], preferred?: string) => {
      if (!preferred) return
      const idx = sorted.findIndex(t => path.basename(t) === preferred)
      if (idx > 0) { const [item] = sorted.splice(idx, 1); sorted.unshift(item) }
    }
    if (mode === 'dump-folder') {
      const groups = new Map<string, string[]>()
      for (const entry of fs.readdirSync(streamsDir, { withFileTypes: true })) {
        if (entry.isDirectory()) continue
        const match = entry.name.match(DATE_IN_FILENAME_RE)
        if (!match) continue
        if (!IMAGE_EXTS.has(path.extname(entry.name).toLowerCase())) continue
        const arr = groups.get(match[1]) ?? []
        arr.push(path.join(streamsDir, entry.name))
        groups.set(match[1], arr)
      }
      for (const [date, thumbs] of groups) {
        const sorted = thumbs.sort((a, b) => {
          const [rA, nA] = thumbnailSortKey(path.basename(a))
          const [rB, nB] = thumbnailSortKey(path.basename(b))
          return rA !== rB ? rA - rB : nA.localeCompare(nB)
        })
        promotePreferred(sorted, allMeta[date]?.preferredThumbnail)
        if (sorted[0]) thumbByKey.set(date, sorted[0])
      }
    } else {
      for (const folderPath of findStreamFolders(streamsDir)) {
        const key = metaKey(streamsDir, folderPath)
        const thumbs = detectThumbnails(folderPath)
        promotePreferred(thumbs, allMeta[key]?.preferredThumbnail)
        if (thumbs[0]) thumbByKey.set(key, thumbs[0])
      }
    }

    let updated = 0, skippedNoThumb = 0
    for (const [key, meta] of Object.entries(allMeta)) {
      if (!meta?.ytVideoId || meta.ytThumbnailPushedHash) continue
      const thumbPath = thumbByKey.get(key)
      if (!thumbPath) { skippedNoThumb++; continue }
      try {
        const buf = fs.readFileSync(thumbPath)
        allMeta[key] = { ...meta, ytThumbnailPushedHash: crypto.createHash('sha1').update(buf).digest('hex') }
        updated++
      } catch { skippedNoThumb++ }
    }
    if (updated > 0) writeAllMeta(streamsDir, allMeta)
    return { updated, skippedNoThumb }
  })

  // Insert or update a single clip draft in the folder's meta, preserving other drafts.
  // Server-side merge avoids races between concurrent draft edits on different videos in the folder.
  // Coalesce clip-draft notifications per stream key. The player AUTOSAVES
  // drafts on a debounce while the user adjusts clip regions — announcing
  // every save would fire a renderer refetch (listOne + hydration check)
  // per tweak. One trailing event per key once the edits settle is enough
  // for the files grid's draft badge to feel immediate.
  const clipDraftNotifyTimers = new Map<string, NodeJS.Timeout>()
  const notifyClipDraftChange = (key: string): void => {
    const existing = clipDraftNotifyTimers.get(key)
    if (existing) clearTimeout(existing)
    clipDraftNotifyTimers.set(key, setTimeout(() => {
      clipDraftNotifyTimers.delete(key)
      // Meta self-writes are invisible to the watcher (expectSelfWrite),
      // so out-of-watcher writers announce their own scoped change.
      for (const w of BrowserWindow.getAllWindows()) {
        if (!w.isDestroyed()) w.webContents.send('streams:changed', { streamKeys: [key] })
      }
    }, 1000))
  }

  ipcMain.handle('clipDraft:save', async (_event, folderPath: string, draft: ClipDraft, metaKeyOverride?: string) => {
    const streamsDir = getStreamsDir() || path.dirname(folderPath)
    const key = metaKeyOverride || metaKey(streamsDir, folderPath)
    const allMeta = readAllMeta(streamsDir)
    const existing = allMeta[key] ?? ({} as StreamMeta)
    const drafts = { ...(existing.clipDrafts ?? {}), [draft.id]: draft }
    allMeta[key] = { ...existing, clipDrafts: drafts }
    writeAllMeta(streamsDir, allMeta)
    notifyClipDraftChange(key)
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
    // Mirror of clipDraft:save — the badge also clears promptly on delete.
    // (Drafts consumed by an export clear via the converter's scoped send.)
    notifyClipDraftChange(key)
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
      // Re-exports overwrite the file in place (-y): refresh the size
      // from the NEW stat so the grid shows it immediately. The mtime is
      // deliberately NOT refreshed — the stale mtime is exactly what
      // marks this entry dirty to the listStreams probe gate, which
      // re-probes and heals duration/dimensions on the next scan.
      // Copying the fresh mtime here would declare the stale duration
      // "current" forever.
      ...(stat ? { size: stat.size } : {}),
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
    // Trash FIRST, metadata second — the same order streams:deleteFolder
    // uses. The old order wrote the meta removal up front and swallowed
    // every trash failure, so a file locked by an external app kept the
    // files on disk while the stream's games/comments/YT link were already
    // destroyed, silently.
    const failed: string[] = []
    for (const filePath of filesForDate(dir, date)) {
      try { await trashItemWithRetry(filePath) } catch { failed.push(path.basename(filePath)) }
    }
    if (failed.length > 0) {
      const shown = failed.slice(0, 3).join(', ')
      throw new Error(
        `Could not move ${failed.length} file${failed.length === 1 ? '' : 's'} to the recycle bin (probably in use by another program): ${shown}${failed.length > 3 ? ', …' : ''}. The stream's metadata was left untouched — close whatever is using the file${failed.length === 1 ? '' : 's'} and delete again.`
      )
    }
    const allMeta = readAllMeta(dir)
    delete allMeta[date]
    writeAllMeta(dir, allMeta)
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
  ): Promise<{ newFolderPath: string; newMetaKey: string; renamedCount: number; skippedCount: number }> => {
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
    // Folder NAMES are basenames; meta KEYS are root-relative (metaKey —
    // the same keys listStreams hands out as relativePath). The old code
    // used basenames for both, so in nested layouts (year/month/stream)
    // the meta lookup below missed entirely: the folder renamed on disk
    // while its meta entry (title, YT link, videoMap) stayed orphaned
    // under the old key. Flat layouts were unaffected because basename
    // and relative path coincide there.
    const oldName = path.basename(folderPath)
    const newName = isDump ? oldName : nextFolderName(path.dirname(folderPath), newDate)
    const newFolderPathPlanned = isDump ? folderPath : path.join(path.dirname(folderPath), newName)
    const oldKey = isDump ? oldDate : metaKey(streamsDir, folderPath)
    const newKey = isDump ? newDate : metaKey(streamsDir, newFolderPathPlanned)
    const needsFolderRename = !isDump && oldName !== newName
    let finalFolderPath = folderPath
    if (needsFolderRename) {
      const newFolderPath = newFolderPathPlanned
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
      // Rewrite preferredThumbnail to track its rename — the file on
      // disk was renamed (date prefix updated), so the stored basename
      // would otherwise point at a non-existent file and the row +
      // sidebar would fall back to whatever happens to sort first in
      // folder.thumbnails. That fallback is what produces the "wrong
      // stream's thumbnail" symptom after back-to-back reschedules.
      if (entry.preferredThumbnail) {
        const renamed = replaceFirstDate(entry.preferredThumbnail, oldDate, newDate)
        if (renamed !== null) updated.preferredThumbnail = renamed
      }
      if (oldKey !== newKey) delete allMeta[oldKey]
      allMeta[newKey] = updated
      writeAllMeta(streamsDir, allMeta)
    }

    if (needsFolderRename) {
      return { newFolderPath: finalFolderPath, newMetaKey: newKey, renamedCount: performed.length, skippedCount: skipped }
    }
    return { newFolderPath: folderPath, newMetaKey: newKey, renamedCount: performed.length, skippedCount: skipped }
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
      await trashItemWithRetry(folderPath)
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

  // Stream keys accumulated during the current debounce window. `null`
  // means at least one event in the burst was structural (date-folder
  // add/remove, root-level file, unresolvable path) — the whole burst
  // escalates to a full reload. Reset to a fresh Set on every fire.
  let pendingScopedKeys: Set<string> | null = new Set()

  function notifyChange(win: BrowserWindow, scope: string | null) {
    // scope: the stream key the event resolved to, or null for
    // structural/unresolvable changes (and everything in dump mode).
    //
    // Echo handling note: this used to consult a GLOBAL suppression
    // window (suppressChokidarFireFor) that deferred EVERY fire — echo
    // or genuine external change alike — for ~3s after any app-side
    // write. That role moved to the per-path selfWrites registry: the
    // watcher's event handlers drop announced echoes outright before
    // ever reaching here, so real events fire promptly and nothing
    // unrelated is held hostage by someone else's write.
    if (scope === null) pendingScopedKeys = null
    else if (pendingScopedKeys) pendingScopedKeys.add(scope)
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      const keys = pendingScopedKeys
      pendingScopedKeys = new Set()
      if (!win.isDestroyed()) {
        win.webContents.send('streams:changed',
          keys && keys.size > 0 ? { streamKeys: [...keys] } : undefined)
      }
    }, DEBOUNCE_MS)
  }

  // Generation counter guarding the pause/restart dance: a restart closure
  // from pauseDirWatcher only fires if no NEWER watcher lifecycle event
  // (watchDir, unwatchDir, another pause) happened since. Without it, a
  // watchDir call landing mid-pause created a second watcher and the
  // stale restart then stacked a third over it — leaking the second's
  // ReadDirectoryChangesW handles forever, after which every delete /
  // reschedule / offload failed EPERM until an app restart.
  let watchGeneration = 0

  function startDirWatcher(dir: string, mode: 'folder-per-stream' | 'dump-folder', win: BrowserWindow) {
    // Never stack: close whatever is running before overwriting the ref.
    if (dirWatcher) { void dirWatcher.close(); dirWatcher = null }
    dirWatcher = chokidar.watch(dir, {
      // dump: root files only. folder: deep enough to cover year/month grouping
      // above the stream folder PLUS sub-org (clips/, recordings/, …) below it.
      // 6 covers root → year → month → stream → sub-folder → file.
      depth: mode === 'dump-folder' ? 0 : 6,
      ignoreInitial: true,
      persistent: true,
      awaitWriteFinish: { stabilityThreshold: 1000, pollInterval: 300 },
      // Ignore files the app writes itself, otherwise chokidar fires
      // 'change' events for every internal write and the renderer re-runs
      // loadFolders → refreshVideoMaps in a tight feedback loop:
      //   - _meta.* family: the metadata store itself (saved on every edit),
      //     writeAllMeta's atomic-swap sibling (_meta.json.tmp — written and
      //     renamed away on every save, so it would fire a phantom add/unlink
      //     pair each time), and readAllMeta's preserved corrupt copies
      //     (_meta.corrupt-*.json)
      //   - *__arc_tmp.*: archive job temp output. ffmpeg writes incrementally
      //     while encoding so 'change' events fire continuously through a
      //     multi-hour archive run, and the renderer was thrashing thumbnails.
      //     The temp file is renamed/swapped to the real file at end-of-job
      //     anyway, so the user only needs to see the final state.
      //   - in-flight converter outputs: watching a growing ffmpeg output
      //     is churn, and chokidar's write-stability stat-polling can race
      //     a cancelled job's file-handle release into an EPERM. The
      //     completion/cancel paths fire their own explicit events, so
      //     nothing is missed. (Via the inFlightWrites registry — a lazy
      //     `require('./converter')` used to sit here to dodge the import
      //     cycle, but the bundled main process has no ./converter module
      //     at runtime, so it always threw and the catch silently disabled
      //     this ignore. That was the thumbnail-refresh thrash during
      //     long conversions.)
      ignored: (p: string) => {
        if (path.basename(p).startsWith('_meta.') || /__arc_tmp\.[^.]+$/.test(p)) return true
        return isInFlightWrite(p)
      },
    })

    // File events resolve to the owning stream folder so the renderer can
    // reload just that stream; anything else (dump mode, root-level files,
    // paths outside a stream folder) escalates the burst to a full reload.
    // Echoes of the app's own writes (thumbnail saves, converter outputs —
    // announced via expectSelfWrite) are dropped outright.
    const isDump = mode === 'dump-folder'
    const onFileEvent = (p: string) => {
      if (consumeSelfWrite(p)) return
      notifyChange(win, isDump ? null : streamKeyForPath(dir, p))
    }
    dirWatcher.on('add', onFileEvent)
    dirWatcher.on('unlink', onFileEvent)
    dirWatcher.on('change', onFileEvent)
    // Directory events are structural (a date-named dir appearing or
    // vanishing is a stream create/delete/reschedule) → full reload.
    dirWatcher.on('addDir', (p: string) => {
      // Diagnostic: surface every date-named folder appearing in the
      // streams root, with timestamp. Helps pin down the phantom
      // "2024-06-18" reappearance. The mkdir monkey-patch in main/index
      // catches what the app does; this catches anything else (cloud
      // sync, manual creation, etc.). Remove once root cause is found.
      if (DATE_FOLDER_RE.test(path.basename(p))) {
        console.warn(`[streams-watcher addDir] ${new Date().toISOString()} ${p}`)
      }
      notifyChange(win, null)
    })
    dirWatcher.on('unlinkDir', (p: string) => {
      if (DATE_FOLDER_RE.test(path.basename(p))) {
        console.warn(`[streams-watcher unlinkDir] ${new Date().toISOString()} ${p}`)
      }
      notifyChange(win, null)
    })
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
    const gen = ++watchGeneration
    return () => {
      // A newer watchDir/unwatchDir superseded this pause — restarting
      // with the stale config would stack a watcher over the new one.
      if (gen !== watchGeneration) return
      startDirWatcher(config.dir, config.mode, config.win)
      // FS events during the pause were simply lost (nothing rescans on
      // resume) — nudge one QUIET reconcile so anything that landed
      // mid-pause (OBS finishing a recording during an offload drain)
      // shows up without waiting for an unrelated event or flashing
      // the thumbnails.
      if (!config.win.isDestroyed()) {
        config.win.webContents.send('streams:changed', { quiet: true })
      }
    }
  }

  ipcMain.handle('streams:watchDir', async (event, dir: string, mode: 'folder-per-stream' | 'dump-folder' = 'folder-per-stream') => {
    watchGeneration++
    if (dirWatcher) { await dirWatcher.close(); dirWatcher = null }
    if (!dir || !fs.existsSync(dir)) { currentWatchConfig = null; return }

    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return

    currentWatchConfig = { dir, mode, win }
    startDirWatcher(dir, mode, win)
  })

  ipcMain.handle('streams:unwatchDir', async () => {
    watchGeneration++
    if (dirWatcher) { await dirWatcher.close(); dirWatcher = null }
    if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null }
    currentWatchConfig = null
  })
}

// Set inside registerStreamsIPC so the reschedule handler can pause its own
// chokidar watcher around the folder rename. Module-scoped so the assignment
// inside the closure is visible to other handlers in the same module — and
// re-exported for outside modules (cloudSync) that need the same pause/restart
// dance around CFAPI dehydrate calls.
let pauseDirWatcher: () => Promise<() => void> = async () => () => {}

/** Pause the streams chokidar watcher; returns a restart fn. Module-private
 *  module-let pattern is closed-over by registerStreamsIPC, so callers must
 *  import this wrapper rather than the variable directly. */
export const pauseStreamsWatcher = (): Promise<() => void> => pauseDirWatcher()

// The global chokidar suppression window that used to live here
// (suppressNextStreamsChokidarFire) is retired: writers announce their
// exact paths via services/selfWrites.expectSelfWrite and the watcher
// drops those echoes per-path, instead of deferring every event —
// including genuinely external ones — behind a shared timer.
