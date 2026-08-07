import { ipcMain, BrowserWindow } from 'electron'
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { suspendProcess, resumeProcess } from '../services/ffmpegService'

function fixAsarPath(p: string): string {
  return p.replace(/app\.asar([/\\])/, 'app.asar.unpacked$1')
}

// Single-slot active run — the Combine page runs one job at a time. Lets
// combine:cancel kill the ffmpeg child, combine:pause/resume suspend it
// (same NtSuspendProcess mechanism as conversion jobs), and the close
// handler tell a cancel apart from a genuine failure.
let activeCombine: { cancelled: boolean; paused: boolean; kill: () => void; pause: () => void; resume: () => void } | null = null

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
  })

  ipcMain.handle('combine:resume', async () => {
    if (!activeCombine?.paused) return
    activeCombine.paused = false
    activeCombine.resume()
  })

  ipcMain.handle(
    'combine:run',
    async (
      event,
      files: string[],
      outputPath: string,
      totalDurationSec: number
    ): Promise<void> => {
      const { default: ffmpegStatic } = await import('ffmpeg-static')
      if (!ffmpegStatic) throw new Error('ffmpeg binary not found')

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
      const send = (percent: number) => {
        if (win && !win.isDestroyed())
          win.webContents.send('combine:progress', { percent })
      }

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
          '-progress', 'pipe:1',
          outputPath
        ]

        const proc = spawn(fixAsarPath(ffmpegStatic as string), args)
        proc.stdin?.end()
        const runState = {
          cancelled: false,
          paused: false,
          kill: () => { try { proc.kill('SIGKILL') } catch (_) {} },
          pause: () => { if (proc.pid) suspendProcess(proc.pid) },
          resume: () => { if (proc.pid) resumeProcess(proc.pid) },
        }
        activeCombine = runState

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
          try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath) } catch (_) {}
        }

        proc.stdout?.on('data', (data: Buffer) => {
          const text = data.toString()
          const match = text.match(/out_time_ms=(\d+)/)
          if (match) {
            startedWriting = true
            if (totalDurationSec > 0) {
              const outSec = parseInt(match[1]) / 1_000_000
              send(Math.min(99, Math.round((outSec / totalDurationSec) * 100)))
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
            reject(new Error('cancelled'))
          } else if (code === 0) { send(100); resolve() }
          else {
            cleanupPartialOutput()
            // Last stderr lines carry ffmpeg's actual complaint.
            const detail = stderrTail.trim().split('\n').slice(-6).join('\n')
            reject(new Error(`ffmpeg exited with code ${code}${detail ? `:\n${detail}` : ''}`))
          }
        })

        proc.on('error', (err) => {
          if (activeCombine === runState) activeCombine = null
          try { fs.unlinkSync(listPath) } catch (_) {}
          cleanupPartialOutput()
          reject(err)
        })
      })
    }
  )
}
