import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { pathToFileURL } from 'url'
import { app } from 'electron'

interface ThumbnailMeta {
  filePath: string
  mtime: number
  timecodes: number[]
}

class ThumbnailCacheManager {
  private _cacheDir: string | null = null

  get cacheDir(): string {
    if (!this._cacheDir) {
      this._cacheDir = path.join(app.getPath('temp'), 'stream-manager', 'thumbnail-cache')
      fs.mkdirSync(this._cacheDir, { recursive: true })
    }
    return this._cacheDir
  }

  hashKey(filePath: string): string {
    return crypto.createHash('md5').update(filePath).digest('hex')
  }

  private metaPath(hash: string): string {
    return path.join(this.cacheDir, hash, 'meta.json')
  }

  private framePath(hash: string, index: number): string {
    return path.join(this.cacheDir, hash, `${String(index).padStart(4, '0')}.jpg`)
  }

  /** Returns timecodes and file:// URLs for all 200 frames if valid cache exists, null otherwise. */
  getCached(filePath: string): { timecodes: number[]; frameUrls: string[] } | null {
    const hash = this.hashKey(filePath)
    const metaFile = this.metaPath(hash)

    let meta: ThumbnailMeta
    try {
      meta = JSON.parse(fs.readFileSync(metaFile, 'utf-8'))
    } catch {
      return null
    }

    // Validate source file mtime
    try {
      const stat = fs.statSync(filePath)
      if (Math.floor(stat.mtimeMs) !== meta.mtime) return null
    } catch {
      return null
    }

    // Validate all frame files exist
    const frameUrls: string[] = []
    for (let i = 0; i < meta.timecodes.length; i++) {
      const fp = this.framePath(hash, i)
      if (!fs.existsSync(fp)) return null
      frameUrls.push(pathToFileURL(fp).toString())
    }

    return { timecodes: meta.timecodes, frameUrls }
  }

  /** Write a single JPEG frame (base64 data URL) to disk. */
  saveFrame(filePath: string, index: number, dataUrl: string): void {
    const hash = this.hashKey(filePath)
    const dir = path.join(this.cacheDir, hash)
    fs.mkdirSync(dir, { recursive: true })
    const base64 = dataUrl.replace(/^data:image\/jpeg;base64,/, '')
    fs.writeFileSync(this.framePath(hash, index), Buffer.from(base64, 'base64'))
  }

  /** Write meta.json once all frames are saved. */
  finalizeMeta(filePath: string, timecodes: number[]): void {
    const hash = this.hashKey(filePath)
    let mtime = 0
    try { mtime = Math.floor(fs.statSync(filePath).mtimeMs) } catch {}
    const meta: ThumbnailMeta = { filePath, mtime, timecodes }
    fs.writeFileSync(this.metaPath(hash), JSON.stringify(meta))
  }

  getTotalSize(): number {
    let total = 0
    try {
      for (const entry of fs.readdirSync(this.cacheDir)) {
        const entryPath = path.join(this.cacheDir, entry)
        try {
          for (const file of fs.readdirSync(entryPath)) {
            try { total += fs.statSync(path.join(entryPath, file)).size } catch {}
          }
        } catch {}
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

export const thumbnailCacheManager = new ThumbnailCacheManager()
