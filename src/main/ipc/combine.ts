import { ipcMain, BrowserWindow } from 'electron'
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'

function fixAsarPath(p: string): string {
  return p.replace(/app\.asar([/\\])/, 'app.asar.unpacked$1')
}

export function registerCombineIPC(): void {
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
          '-y',
          '-f', 'concat',
          '-safe', '0',
          '-i', listPath,
          '-c', 'copy',
          '-progress', 'pipe:1',
          outputPath
        ]

        const proc = spawn(fixAsarPath(ffmpegStatic as string), args)

        proc.stdout?.on('data', (data: Buffer) => {
          const text = data.toString()
          const match = text.match(/out_time_ms=(\d+)/)
          if (match && totalDurationSec > 0) {
            const outSec = parseInt(match[1]) / 1_000_000
            send(Math.min(99, Math.round((outSec / totalDurationSec) * 100)))
          }
        })

        proc.on('close', (code) => {
          try { fs.unlinkSync(listPath) } catch (_) {}
          if (code === 0) { send(100); resolve() }
          else reject(new Error(`ffmpeg exited with code ${code}`))
        })

        proc.on('error', (err) => {
          try { fs.unlinkSync(listPath) } catch (_) {}
          reject(err)
        })
      })
    }
  )
}
