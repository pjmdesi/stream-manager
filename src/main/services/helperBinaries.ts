import { app } from 'electron'
import { spawnSync } from 'child_process'
import fs from 'fs'
import path from 'path'

// Where ffmpeg and ffprobe are started from (STR-58).
//
// The Windows portable build unpacks itself into a new folder under %TEMP%
// at every launch. On some machines security software rescans an executable
// started from there at EVERY start: 0.7 to 1.8 s per ffmpeg or ffprobe
// start on the development machine. A process start is a blocking call, so
// the main process, and the window with it, waits each one out. From a
// folder of their own under %LOCALAPPDATA% the same start takes
// milliseconds. So the portable build keeps a copy of the two helpers there
// and starts them from it.
//
// The folder matters, measured 2026-11-19 on that machine with the same
// file in each place: slow anywhere under %TEMP% and anywhere inside the
// app's own data folder (userData, which is also the Chromium profile),
// 350 ms per start from a bare script; 7 ms from a separate folder under
// %LOCALAPPDATA% or %APPDATA%, whichever program created it. A first build
// that kept the copy inside userData gained nothing. Do not move it there.
//
// The copy is made when it is missing or differs in size from the bundled
// file (a new app version), under a temporary name first so that a
// half-written file is never started, and it is run once before anything
// depends on it. If it cannot be made or does not start (a full disk, a
// policy that blocks executables in that folder), the bundled files are
// used as before and the reason is kept for Settings to show.

export interface HelperCopyState {
  /** Folder the copy lives in. */
  dir: string
  /** Bytes the copied helpers take; 0 when the copy is not in use. */
  size: number
  /** Set when the copy is not in use: why. The bundled files run instead. */
  error?: string
}

export interface HelperPaths {
  ffmpeg: string | null
  ffprobe: string
}

// The stub of the portable build sets this for the app it unpacks
// (portable.nsi in app-builder-lib); nothing else does.
const keepsCopy = process.platform === 'win32' && app.isPackaged && !!process.env.PORTABLE_EXECUTABLE_DIR

let state: HelperCopyState | null = null

/** The copy's state, for Settings. Null in a build that keeps no copy
 *  (anything but the Windows portable build). */
export function getHelperCopyState(): HelperCopyState | null {
  return state
}

/** The copy of one bundled helper in `dir`, made or replaced if needed and
 *  proven to start. Throws when either step fails. */
function copyOf(bundled: string, dir: string): string {
  const dest = path.join(dir, path.basename(bundled))
  const want = fs.statSync(bundled).size
  let have = -1
  try { have = fs.statSync(dest).size } catch { /* not there yet */ }
  if (have !== want) {
    const tmp = `${dest}.${process.pid}.tmp`
    try {
      fs.copyFileSync(bundled, tmp)
      fs.renameSync(tmp, dest)
    } catch (err) {
      try { fs.unlinkSync(tmp) } catch { /* nothing to remove */ }
      throw err
    }
  }
  const run = spawnSync(dest, ['-version'], { stdio: 'ignore', windowsHide: true, timeout: 10_000 })
  if (run.error) throw run.error
  if (run.status !== 0) throw new Error(`${path.basename(dest)} did not start (exit code ${run.status})`)
  return dest
}

/** The paths to start ffmpeg and ffprobe from: the kept copies in the
 *  Windows portable build, the bundled files everywhere else
 *  and whenever the copy cannot be used. Blocking, and meant to run once,
 *  when the ffmpeg service loads. */
export function resolveHelperPaths(bundled: HelperPaths): HelperPaths {
  if (!keepsCopy) return bundled
  const local = process.env.LOCALAPPDATA || path.join(app.getPath('home'), 'AppData', 'Local')
  const dir = path.join(local, 'stream-manager', 'ffmpeg')
  try {
    fs.mkdirSync(dir, { recursive: true })
    // A copy that was cut short (the app was killed mid-copy) leaves its
    // temporary file behind; nothing else in this folder ends in .tmp.
    for (const name of fs.readdirSync(dir)) {
      if (name.endsWith('.tmp')) { try { fs.unlinkSync(path.join(dir, name)) } catch { /* in use by another launch */ } }
    }
    const ffprobe = copyOf(bundled.ffprobe, dir)
    const ffmpeg = bundled.ffmpeg ? copyOf(bundled.ffmpeg, dir) : null
    const size = fs.statSync(ffprobe).size + (ffmpeg ? fs.statSync(ffmpeg).size : 0)
    state = { dir, size }
    return { ffmpeg, ffprobe }
  } catch (err) {
    state = { dir, size: 0, error: err instanceof Error ? err.message : String(err) }
    return bundled
  }
}
