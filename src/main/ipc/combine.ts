import { ipcMain, BrowserWindow, app } from 'electron'
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { suspendProcess, resumeProcess, clipProvenanceComment, requireFfmpegBin } from '../services/ffmpegService'
import { tempOutputPath, muxerForPath, verifyFinishedOutput, commitOutput } from '../services/mediaOutput'
import { trackChild } from '../services/ffmpegChildren'
import { v4 as uuidv4 } from 'uuid'
import { getStreamsDir, getStreamMode } from './store'
import { streamKeyOfFile } from '../../shared/streamKey'
import { openJobLog, startJobLog, endJobLog, noteJobPaused, noteJobResumed, noteJobProgress, type JobLogFields } from '../services/conversionLog'

// Single-slot active run — the Combine page runs one job at a time. Lets
// combine:cancel kill the ffmpeg child, combine:pause/resume suspend it
// (same NtSuspendProcess mechanism as conversion jobs), and the close
// handler tell a cancel apart from a genuine failure. `logId` names the
// run in the conversion log (CONV-4).
let activeCombine: { logId: string; cancelled: boolean; paused: boolean; kill: () => void; pause: () => void; resume: () => void } | null = null

/** What the conversion log records a combine as: its inputs, the output,
 *  and the stream the output (or failing that, the first input) lives in. */
function combineLogFields(files: string[], outputPath: string): JobLogFields {
  const streamsDir = getStreamsDir()
  const stream = streamsDir && getStreamMode() !== 'dump-folder'
    ? (streamKeyOfFile(streamsDir, outputPath) ?? (files[0] ? streamKeyOfFile(streamsDir, files[0]) : null))
    : null
  const sizeOf = (p: string): number | undefined => { try { return fs.statSync(p).size } catch { return undefined } }
  return {
    kind: 'combine',
    stream,
    inputs: files.map(f => ({ path: f, bytes: sizeOf(f) })),
    output: outputPath,
    preset: null,
  }
}

export function registerCombineIPC(): void {
  ipcMain.handle('combine:cancel', async () => {
    if (!activeCombine) return
    activeCombine.cancelled = true
    // A suspended process still dies to SIGKILL/TerminateProcess, but
    // resume first so its close handler runs promptly.
    if (activeCombine.paused) activeCombine.resume()
    activeCombine.kill()
  })

  ipcMain.handle('combine:pause', async () => {
    if (!activeCombine || activeCombine.paused) return
    activeCombine.paused = true
    activeCombine.pause()
    noteJobPaused(activeCombine.logId)
  })

  ipcMain.handle('combine:resume', async () => {
    if (!activeCombine?.paused) return
    activeCombine.paused = false
    activeCombine.resume()
    noteJobResumed(activeCombine.logId)
  })

  ipcMain.handle(
    'combine:run',
    async (
      event,
      files: string[],
      outputPath: string,
      totalDurationSec: number
    ): Promise<void> => {
      const ffmpegBin = requireFfmpegBin()

      // Guard rails: the output must be a NEW file that isn't also an input.
      // Overwriting is never right here — the concat starts by truncating the
      // target, so a colliding path silently destroys a previous combine, and
      // if that file is also in the input list ffmpeg reads the very file it
      // is writing. The renderer pre-uniquifies its default name; these catch
      // hand-typed paths and races.
      const normalize = (p: string) => path.resolve(p).toLowerCase()
      const outNorm = normalize(outputPath)
      if (files.some(f => normalize(f) === outNorm)) {
        throw new Error('The output path is one of the input files. Pick a different output name.')
      }
      if (fs.existsSync(outputPath)) {
        throw new Error(`The output file already exists: ${path.basename(outputPath)}. Pick a different name.`)
      }

      // Write a concat list file to a temp location
      const listPath = path.join(os.tmpdir(), `sm_concat_${Date.now()}.txt`)
      const listContent = files
        .map(f => `file '${f.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`)
        .join('\n')
      fs.writeFileSync(listPath, listContent, 'utf-8')

      const win = BrowserWindow.fromWebContents(event.sender)
      // outputBytes: what ffmpeg has written so far (its total_size line),
      // for the row's growing size and final-size estimate.
      const send = (percent: number, outputBytes?: number) => {
        if (win && !win.isDestroyed())
          win.webContents.send('combine:progress', { percent, outputBytes })
      }

      // Written as `<output>.tmp` (invisible to sync clients while it grows),
      // read back against the expected length, then renamed into place.
      const writePath = tempOutputPath(outputPath)
      const muxer = muxerForPath(outputPath)
      // A `.tmp` under our own output name is a leftover from a crashed or
      // killed run (the finished one was renamed away); `-n` below would
      // otherwise refuse to write over it.
      try { if (fs.existsSync(writePath)) fs.unlinkSync(writePath) } catch (_) {}

      return new Promise<void>((resolve, reject) => {
        const args = [
          // -n (never overwrite) instead of -y: the existence check above
          // already guarantees a fresh target, so this only matters if a
          // file appears in the race window — fail instead of truncating it.
          '-n',
          '-f', 'concat',
          '-safe', '0',
          '-i', listPath,
          '-c', 'copy',
          // Provenance stamp (same scheme as clip exports): the files grid
          // classifies combine outputs by this instead of the size/aspect
          // heuristic, which read them as recordings. Also OVERRIDES any
          // comment inherited from the first input via map_metadata — a
          // combine of app-exported clips would otherwise carry a "Stream
          // Manager Clip" marker into the output.
          '-metadata', `comment=${clipProvenanceComment('combined', app.getVersion())}`,
          '-progress', 'pipe:1',
          ...(muxer ? ['-f', muxer] : []),
          writePath
        ]

        const proc = spawn(ffmpegBin, args)
        proc.stdin?.end()
        const logId = uuidv4()
        openJobLog(logId, combineLogFields(files, outputPath))
        startJobLog(logId, { encodeArgs: args.join(' '), durationSec: totalDurationSec })
        // The log's end line for everything that is not a cancel.
        const fail = (err: Error) => {
          endJobLog(logId, 'error', { error: err.message })
          reject(err)
        }
        const runState = {
          logId,
          cancelled: false,
          paused: false,
          kill: () => { try { proc.kill('SIGKILL') } catch (_) {} },
          pause: () => { if (proc.pid) suspendProcess(proc.pid) },
          resume: () => { if (proc.pid) resumeProcess(proc.pid) },
        }
        activeCombine = runState
        // Wanted while it is the active run and not cancelled; the orphan
        // sweep kills it otherwise (ffmpegChildren.ts).
        trackChild(proc, 'combine', { id: 'combine', isLive: () => activeCombine === runState && !runState.cancelled })

        // A failed run's partial output is garbage — clean it up like the
        // archive error path does its temp. Gated on ffmpeg having actually
        // started writing (first progress block): if -n refused because a
        // file appeared in the race window, that file is NOT ours and must
        // not be deleted. Worst case of the gate is an orphaned header-stub
        // when ffmpeg dies before its first progress tick — better a stub
        // than deleting someone else's file.
        let startedWriting = false
        const cleanupPartialOutput = () => {
          if (!startedWriting) return
          try { if (fs.existsSync(writePath)) fs.unlinkSync(writePath) } catch (_) {}
        }

        proc.stdout?.on('data', (data: Buffer) => {
          const text = data.toString()
          const match = text.match(/out_time_ms=(\d+)/)
          if (match) {
            startedWriting = true
            if (totalDurationSec > 0) {
              const outSec = parseInt(match[1]) / 1_000_000
              const sizeMatch = text.match(/total_size=(\d+)/)
              const outputBytes = sizeMatch ? parseInt(sizeMatch[1]) : undefined
              const percent = Math.min(99, Math.round((outSec / totalDurationSec) * 100))
              send(percent, outputBytes)
              noteJobProgress(logId, percent)
            }
          }
        })

        // Keep ffmpeg's stderr tail: it's the only witness when a run
        // fails or stalls (an unexplained sat-at-0% run, 2026-08, had no
        // evidence because stderr was discarded). Bounded so a chatty run
        // can't balloon memory; surfaced in the error message and logged
        // on cancel for post-mortems.
        let stderrTail = ''
        proc.stderr?.on('data', (data: Buffer) => {
          stderrTail = (stderrTail + data.toString()).slice(-4000)
        })

        proc.on('close', (code) => {
          if (activeCombine === runState) activeCombine = null
          try { fs.unlinkSync(listPath) } catch (_) {}
          if (runState.cancelled) {
            // User cancel — remove the partial and report distinctly so the
            // renderer shows "cancelled", not an ffmpeg error. Log the tail
            // anyway: a cancel after a stall is exactly when it matters.
            console.log('[combine] cancelled; ffmpeg stderr tail:\n' + stderrTail)
            cleanupPartialOutput()
            endJobLog(logId, 'cancelled')
            reject(new Error('cancelled'))
          } else if (code === 0) {
            // A clean exit is not a whole file: read it back, then give it
            // its name. A failed check or rename keeps the `.tmp` for
            // inspection and reports why.
            void (async () => {
              // Same tolerance as the renderer's post-run check: a stream
              // copy concat lands within a few seconds of the summed inputs.
              const check = await verifyFinishedOutput(writePath, totalDurationSec, Math.max(5, totalDurationSec * 0.02))
              if (!check.ok) {
                fail(new Error(`Output check failed: ${check.reason}. The file was kept as "${path.basename(writePath)}" for inspection.`))
                return
              }
              try {
                await commitOutput(writePath, outputPath, { replaceExisting: false })
              } catch (e: any) {
                fail(new Error(`The combined file could not be renamed into place (${e.message}). It was kept as "${path.basename(writePath)}".`))
                return
              }
              let outputBytes: number | undefined
              try { outputBytes = fs.statSync(outputPath).size } catch { /* the record goes without */ }
              endJobLog(logId, 'done', { outputBytes })
              send(100)
              resolve()
            })()
          } else {
            cleanupPartialOutput()
            // Last stderr lines carry ffmpeg's actual complaint.
            const detail = stderrTail.trim().split('\n').slice(-6).join('\n')
            fail(new Error(`ffmpeg exited with code ${code}${detail ? `:\n${detail}` : ''}`))
          }
        })

        proc.on('error', (err) => {
          if (activeCombine === runState) activeCombine = null
          try { fs.unlinkSync(listPath) } catch (_) {}
          cleanupPartialOutput()
          fail(err)
        })
      })
    }
  )
}
