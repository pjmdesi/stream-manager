import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { app } from 'electron'
import { removeTree } from './removeTree'

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

    // A hit counts as use for the shared cache limit's least-recently-used
    // order (NTFS does not maintain access times by default).
    try { const now = new Date(); fs.utimesSync(file, now, now) } catch {}
    // Return only the samples portion (skip 8-byte header)
    return data.subarray(8)
  }

  /** Entries for the shared cache limit (services/cacheLimit.ts): one per
   *  waveform file, last used when it was last read or written. */
  listEntries(): Array<{ size: number; lastUsed: number; remove: () => void }> {
    const out: Array<{ size: number; lastUsed: number; remove: () => void }> = []
    try {
      for (const file of fs.readdirSync(this.cacheDir)) {
        if (!file.endsWith('.bin')) continue
        const p = path.join(this.cacheDir, file)
        try {
          const st = fs.statSync(p)
          out.push({ size: st.size, lastUsed: st.mtimeMs, remove: () => { fs.unlinkSync(p) } })
        } catch {}
      }
    } catch {}
    return out
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

  /** Remove every cached file; returns the ones that could not be removed
   *  (see removeTree). The folder is recreated lazily on the next use. */
  clearAll(): string[] {
    const failed = removeTree(this.cacheDir)
    if (failed.length === 0) this._cacheDir = null
    return failed
  }
}

export const waveformCacheManager = new WaveformCacheManager()
