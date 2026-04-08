import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { app } from 'electron'

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
    return path.join(this.cacheDir, `${hash}.bin`)
  }

  // Stored format: 8-byte header (mtime as uint64 LE) followed by raw f32le samples
  getCached(filePath: string): Buffer | null {
    const file = this.cachePath(filePath)
    let data: Buffer
    try {
      data = fs.readFileSync(file)
    } catch {
      return null
    }

    if (data.byteLength < 8) return null

    const cachedMtime = data.readBigUInt64LE(0)
    try {
      const stat = fs.statSync(filePath)
      if (BigInt(Math.floor(stat.mtimeMs)) !== cachedMtime) return null
    } catch {
      return null
    }

    // Return only the samples portion (skip 8-byte header)
    return data.subarray(8)
  }

  save(filePath: string, samples: Buffer): void {
    let mtime = 0
    try { mtime = Math.floor(fs.statSync(filePath).mtimeMs) } catch {}
    const header = Buffer.allocUnsafe(8)
    header.writeBigUInt64LE(BigInt(mtime), 0)
    try {
      fs.writeFileSync(this.cachePath(filePath), Buffer.concat([header, samples]))
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
