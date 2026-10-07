import fs from 'fs'
import path from 'path'
import { probeMediaDurations } from './ffmpegService'

/** Every long ffmpeg write into a user folder goes through here.
 *
 *  The file is written as `<final>.tmp` and takes its final name only after
 *  ffmpeg exited cleanly and the output probed as finished. Two reasons,
 *  both learned from a sync client (2026-10-06):
 *
 *  - A file that takes an hour to write sits inside the sync root the whole
 *    time, and the client may snapshot it half-built. One archive was
 *    captured 1.25 MiB into a 26 GB encode, the client never registered
 *    another write, and the later offload discarded the only complete copy.
 *    Synology Drive and OneDrive skip `*.tmp` by default, so the file is
 *    invisible to them until it is finished, and the final rename makes a
 *    complete file appear once.
 *  - A rename of a file the client is uploading can leave a partial on the
 *    server under the new name. With the temp never uploaded, there is no
 *    upload to interrupt.
 *
 *  Nothing is deleted or renamed over on the strength of ffmpeg's exit code
 *  alone: `verifyFinishedOutput` reads the result back first. */

export const TEMP_OUTPUT_SUFFIX = '.tmp'

export function tempOutputPath(finalPath: string): string {
  return finalPath + TEMP_OUTPUT_SUFFIX
}

export function isTempOutputPath(p: string): boolean {
  return p.toLowerCase().endsWith(TEMP_OUTPUT_SUFFIX)
}

/** ffmpeg muxer names by output extension. With a `.tmp` name ffmpeg cannot
 *  infer the container, so the caller passes `-f <muxer>`. Unknown
 *  extensions return null and the caller writes to the final name as
 *  before (no container guess is better than a wrong one). */
const MUXER_BY_EXT: Record<string, string> = {
  mkv: 'matroska', mka: 'matroska', webm: 'webm',
  mp4: 'mp4', m4v: 'mp4', m4a: 'ipod', mov: 'mov',
  mp3: 'mp3', aac: 'adts', flac: 'flac', wav: 'wav', opus: 'opus', ogg: 'ogg', oga: 'ogg',
  ts: 'mpegts', avi: 'avi',
}

export function muxerForPath(finalPath: string): string | null {
  const ext = path.extname(finalPath).slice(1).toLowerCase()
  return MUXER_BY_EXT[ext] ?? null
}

export type OutputVerification =
  | { ok: true; durationSec: number }
  | { ok: false; reason: string }

/** Read a finished output back: it exists, has bytes, parses, and carries a
 *  finite duration (a Matroska file ffmpeg never finalized reports none).
 *  The duration is the longest audio or video stream's, not the
 *  container's: an mp4's timecode data track runs the source's full length
 *  even when the media was cut short, and the container duration follows
 *  it (found 2026-10-06 when a 10 s test output passed as 927 s). With
 *  `expectedDurationSec`, the duration must also match within
 *  `toleranceSec` (default 1% or 2 seconds, whichever is larger; a stream
 *  copy concat passes a looser one for its timestamp joins), which catches
 *  an encode that stopped early with a clean exit. */
export async function verifyFinishedOutput(filePath: string, expectedDurationSec?: number, toleranceSec?: number): Promise<OutputVerification> {
  let size = 0
  try {
    size = fs.statSync(filePath).size
  } catch {
    return { ok: false, reason: 'the output file is missing' }
  }
  if (size === 0) return { ok: false, reason: 'the output file is empty' }
  let durationSec: number | null
  try {
    const d = await probeMediaDurations(filePath)
    durationSec = d.media ?? d.container
  } catch (err: any) {
    return { ok: false, reason: `the output could not be read back (${err?.message ?? err})` }
  }
  if (durationSec === null) {
    return { ok: false, reason: 'the output has no duration, so it was never finalized' }
  }
  if (expectedDurationSec && Number.isFinite(expectedDurationSec) && expectedDurationSec > 0) {
    const tolerance = toleranceSec ?? Math.max(2, expectedDurationSec * 0.01)
    if (Math.abs(durationSec - expectedDurationSec) > tolerance) {
      return { ok: false, reason: `the output's video and audio run ${durationSec.toFixed(1)} s where ${expectedDurationSec.toFixed(1)} s was expected` }
    }
  }
  return { ok: true, durationSec }
}

/** Move a verified temp to its final name. `replaceExisting` keeps the
 *  overwrite semantics the ffmpeg `-y` paths had (re-exporting a clip under
 *  the same name); without it an existing final is an error and nothing is
 *  touched. Retries over about 13 s for the transient handles a sync client
 *  or scanner holds on a fresh file; throws when they run out, leaving the
 *  temp in place for the caller to report. */
export async function commitOutput(tempPath: string, finalPath: string, opts: { replaceExisting: boolean }): Promise<void> {
  if (!opts.replaceExisting && fs.existsSync(finalPath)) {
    throw new Error(`"${path.basename(finalPath)}" already exists`)
  }
  let lastErr: unknown
  for (const delayMs of [0, 250, 500, 1000, 1500, 2000, 3000, 5000]) {
    if (delayMs) await new Promise(r => setTimeout(r, delayMs))
    try {
      fs.renameSync(tempPath, finalPath)
      return
    } catch (err) { lastErr = err }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}
