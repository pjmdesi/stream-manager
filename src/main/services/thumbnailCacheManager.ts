import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { pathToFileURL } from 'url'
import { app } from 'electron'

// Version 2: timecodes store the *actual* seeked time of each captured
// frame (rather than the requested time), and frames that landed on the
// same keyframe are deduped at generation. Older caches are silently
// invalidated so the strip regenerates without visual repeats.
const CACHE_VERSION = 2

interface ThumbnailMeta {
  filePath: string
  mtime: number
  timecodes: number[]
  version?: number
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

    // Reject older cache formats so the strip regenerates with the
    // dedup-by-actualTime behavior introduced in v2.
    if (meta.version !== CACHE_VERSION) return null

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
    const meta: ThumbnailMeta = { filePath, mtime, timecodes, version: CACHE_VERSION }
    fs.writeFileSync(this.metaPath(hash), JSON.stringify(meta))
  }

  // ── Keystone thumbnail ──────────────────────────────────────────────────
  // A single representative frame per video (used by the file grid / converter
  // rows). Stored in its own subdir so it survives the strip being flushed, but
  // still under cacheDir so it counts toward getTotalSize() and clears with the
  // rest. One-way: derived FROM the strip, never written back into it.

  private keystoneJpgPath(hash: string): string {
    return path.join(this.cacheDir, 'keystone', `${hash}.jpg`)
  }
  private keystoneMetaPath(hash: string): string {
    return path.join(this.cacheDir, 'keystone', `${hash}.json`)
  }
  private writeKeystoneMeta(filePath: string, hash: string): void {
    let mtime = 0
    try { mtime = Math.floor(fs.statSync(filePath).mtimeMs) } catch {}
    fs.writeFileSync(this.keystoneMetaPath(hash), JSON.stringify({ filePath, mtime }))
  }

  /** Returns the keystone's file:// URL if a valid (mtime-matching) one exists. */
  getKeystone(filePath: string): string | null {
    const hash = this.hashKey(filePath)
    let meta: { mtime: number }
    try { meta = JSON.parse(fs.readFileSync(this.keystoneMetaPath(hash), 'utf-8')) } catch { return null }
    try {
      const stat = fs.statSync(filePath)
      if (Math.floor(stat.mtimeMs) !== meta.mtime) return null
    } catch { return null }
    const jpg = this.keystoneJpgPath(hash)
    if (!fs.existsSync(jpg)) return null
    return pathToFileURL(jpg).toString()
  }

  /** Persist a freshly-generated frame (base64 JPEG data URL) as the keystone. */
  saveKeystone(filePath: string, dataUrl: string): void {
    const hash = this.hashKey(filePath)
    fs.mkdirSync(path.join(this.cacheDir, 'keystone'), { recursive: true })
    const base64 = dataUrl.replace(/^data:image\/jpeg;base64,/, '')
    fs.writeFileSync(this.keystoneJpgPath(hash), Buffer.from(base64, 'base64'))
    this.writeKeystoneMeta(filePath, hash)
  }

  /** If the player's strip cache exists, copy its frame nearest the temporal
   *  midpoint into the keystone cache and return its URL. Null if no strip. */
  deriveKeystoneFromStrip(filePath: string): string | null {
    const cached = this.getCached(filePath)
    if (!cached || cached.timecodes.length === 0) return null
    const tcs = cached.timecodes
    const target = (tcs[0] + tcs[tcs.length - 1]) / 2
    let bestIdx = 0
    let bestDelta = Infinity
    for (let i = 0; i < tcs.length; i++) {
      const d = Math.abs(tcs[i] - target)
      if (d < bestDelta) { bestDelta = d; bestIdx = i }
    }
    const hash = this.hashKey(filePath)
    const dest = this.keystoneJpgPath(hash)
    try {
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      fs.copyFileSync(this.framePath(hash, bestIdx), dest)
      this.writeKeystoneMeta(filePath, hash)
      return pathToFileURL(dest).toString()
    } catch { return null }
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
