/** The stream folder naming convention and every key derived from it, in one
 *  place for main and the renderer (APP-48). Before this file, four
 *  functions answered "which stream owns this path and what is its
 *  `_meta.json` key" and the folder-name pattern was declared a dozen
 *  times; they agreed on the common layouts and differed at the edges.
 *  Pure string logic, no Node path module: both bundles compile it, and
 *  paths arrive with either separator.
 *
 *  Layouts it understands:
 *  - folder per stream: `<root>/2026-10-15/...`, optionally nested under
 *    any folders that are not themselves stream folders (`<root>/2026/10/
 *    2026-10-15/...`). The key is the folder's path relative to the root
 *    with forward slashes (`2026/10/2026-10-15`).
 *  - same-day streams: `2026-10-15-2`, `2026-10-15-3`; index 1 is the
 *    unsuffixed folder.
 *  - dump mode: every file sits in the root and carries its date in the
 *    name; the key is the date.
 *
 *  Path comparison is case-insensitive: the app is Windows-first and the
 *  root comes from a text field, so `d:\streams` and `D:\Streams` are the
 *  same place. Keys keep the casing of the path they were cut from, which
 *  is what `_meta.json` already holds. */

/** A stream folder: its calendar date, with `-N` for the second and later
 *  streams of the same day. Group 1 is the date, group 2 the suffix. */
export const STREAM_FOLDER_RE = /^(\d{4}-\d{2}-\d{2})(?:-(\d+))?$/

/** The first `YYYY-MM-DD` anywhere in a name. Dump mode groups files by
 *  it; OBS names recordings with it. */
export const DATE_IN_NAME_RE = /(\d{4}-\d{2}-\d{2})/

/** An OBS-style recording start right after the date: `2026-10-15
 *  18-25-17`, also with `_`, `T`, `:` or `.` between the parts; seconds
 *  optional. */
const RECORDING_START_RE = /(\d{4})-(\d{2})-(\d{2})[ _T-]+(\d{2})[-_.:](\d{2})(?:[-_.:](\d{2}))?/

export function isStreamFolderName(name: string): boolean {
  return STREAM_FOLDER_RE.test(name)
}

/** The `YYYY-MM-DD` of a stream folder name (suffix dropped). Only
 *  meaningful for a name `isStreamFolderName` accepts. */
export function streamFolderDate(name: string): string {
  return name.slice(0, 10)
}

/** 1 for the day's first stream (no suffix), N for `-N`. */
export function streamFolderIndex(name: string): number {
  const m = name.match(STREAM_FOLDER_RE)
  return m?.[2] ? parseInt(m[2], 10) : 1
}

/** The first `YYYY-MM-DD` in a file name, or null. */
export function dateInName(name: string): string | null {
  const m = name.match(DATE_IN_NAME_RE)
  return m ? m[1] : null
}

/** The recording's start as a local Date when the name carries a time
 *  after its date (OBS style), else null. */
export function recordingStart(name: string): Date | null {
  const m = name.match(RECORDING_START_RE)
  if (!m) return null
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], m[6] ? +m[6] : 0)
}

/** Forward slashes, no trailing slash. */
function posix(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '')
}

/** `p` relative to `root` with forward slashes when `p` is inside `root`
 *  (compared case-insensitively), else null. '' when `p` is the root. */
export function relativeUnder(root: string, p: string): string | null {
  const r = posix(root)
  const fp = posix(p)
  if (!r) return null
  const rl = r.toLowerCase()
  const fl = fp.toLowerCase()
  if (fl === rl) return ''
  if (fl.startsWith(rl + '/')) return fp.slice(r.length + 1)
  return null
}

/** `p` relative to `root`, or `p`'s basename when it is not under `root`
 *  (or `root` is empty). The videoMap key and the per-file key inside a
 *  stream: for flat layouts the basename, for nested ones
 *  `clips/highlight.mp4`, so a sub-folder file never collides with a
 *  top-level file of the same name. */
export function relativeKey(root: string, p: string): string {
  const rel = relativeUnder(root, p)
  if (rel) return rel
  const fp = posix(p)
  return fp.slice(fp.lastIndexOf('/') + 1)
}

/** The `_meta.json` key of a stream folder: its path relative to the
 *  streams root; `date` when the folder IS the root (dump mode); the
 *  folder's basename when it is outside the root or the root is unknown.
 *  Without `date`, a folder that is the root keys by its basename, which
 *  is what the folder-mode callers in main always got and never want
 *  (they run under a folder-mode guard). */
export function streamKeyOfFolder(root: string, folderPath: string, date?: string): string {
  const rel = relativeUnder(root, folderPath)
  if (rel) return rel
  if (rel === '' && date) return date
  const fp = posix(folderPath)
  return fp.slice(fp.lastIndexOf('/') + 1)
}

/** The key of the stream that owns a file: the path, relative to the
 *  root, of the FIRST stream-folder-named directory above the file (the
 *  same stop-at-first-match rule the library walk uses, so a date-named
 *  sub-folder inside a stream does not start a new stream). Null when the
 *  file is not under the root or no ancestor is a stream folder (dump
 *  mode, root-level files): the caller keys by the file's date then. A
 *  date-named FILE at the root is not a folder and yields null. */
export function streamKeyOfFile(root: string, filePath: string): string | null {
  const rel = relativeUnder(root, filePath)
  if (!rel) return null
  const segs = rel.split('/')
  for (let i = 0; i < segs.length - 1; i++) {
    if (isStreamFolderName(segs[i])) return segs.slice(0, i + 1).join('/')
  }
  return null
}
