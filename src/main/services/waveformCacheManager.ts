import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { app } from 'electron'
import type { WaveformPeak } from './ffmpegService'

interface WaveformCacheFile {
  filePath: string
  mtime: number
  peaks: WaveformPeak[]
}

class WaveformCacheManager {
  private _cacheDir: string | null = null

  get cacheDir(): string {
    if (!this._cacheDir) {
      this._cacheDir = path.join(app.getPath('temp'), 'stream-manager', 'waveform-cache')
      fs.mkdirSync(this._cacheDir, { recursive: true })
    }
    return this._cacheDir
  }

  private cachePath(filePath: string): string {
    const hash = crypto.createHash('md5').update(filePath).digest('hex')
    return path.join(this.cacheDir, `${hash}.json`)
  }

  getCached(filePath: string): WaveformPeak[] | null {
    const file = this.cachePath(filePath)
    let data: WaveformCacheFile
    try {
      data = JSON.parse(fs.readFileSync(file, 'utf-8'))
    } catch {
      return null
    }

    try {
      const stat = fs.statSync(filePath)
      if (Math.floor(stat.mtimeMs) !== data.mtime) return null
    } catch {
      return null
    }

    return data.peaks
  }

  save(filePath: string, peaks: WaveformPeak[]): void {
    let mtime = 0
    try { mtime = Math.floor(fs.statSync(filePath).mtimeMs) } catch {}
    const data: WaveformCacheFile = { filePath, mtime, peaks }
    try {
      fs.writeFileSync(this.cachePath(filePath), JSON.stringify(data))
    } catch {}
  }

  getTotalSize(): number {
    let total = 0
    try {
      for (const file of fs.readdirSync(this.cacheDir)) {
        try { total += fs.statSync(path.join(this.cacheDir, file)).size } catch {}
      }
    } catch {}
    return total
  }

  clearAll(): void {
    try {
      fs.rmSync(this.cacheDir, { recursive: true, force: true })
      this._cacheDir = null
    } catch {}
  }
}

export const waveformCacheManager = new WaveformCacheManager()
