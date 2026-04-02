import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { app } from 'electron'

interface CacheEntry {
  filePath: string
  mtime: number
  tracks: string[]   // absolute paths to .opus files
  totalSize: number  // bytes
  lastAccessed: number
}

interface CacheIndex {
  entries: Record<string, CacheEntry>
}

class AudioCacheManager {
  private _cacheDir: string | null = null
  private _index: CacheIndex | null = null

  get cacheDir(): string {
    if (!this._cacheDir) {
      this._cacheDir = path.join(app.getPath('temp'), 'stream-manager', 'audio-cache')
      fs.mkdirSync(this._cacheDir, { recursive: true })
    }
    return this._cacheDir
  }

  private get indexPath(): string {
    return path.join(this.cacheDir, 'index.json')
  }

  hashKey(filePath: string): string {
    return crypto.createHash('md5').update(filePath).digest('hex')
  }

  private loadIndex(): CacheIndex {
    if (this._index) return this._index
    try {
      this._index = JSON.parse(fs.readFileSync(this.indexPath, 'utf-8'))
    } catch {
      this._index = { entries: {} }
    }
    return this._index!
  }

  private saveIndex(): void {
    fs.writeFileSync(this.indexPath, JSON.stringify(this._index, null, 2))
  }

  /** Returns cached track paths if they exist and the source file hasn't changed. */
  getCachedTracks(filePath: string): string[] | null {
    const index = this.loadIndex()
    const key = this.hashKey(filePath)
    const entry = index.entries[key]
    if (!entry) return null

    // Validate source file mtime
    try {
      const stat = fs.statSync(filePath)
      if (Math.floor(stat.mtimeMs) !== entry.mtime) return null
    } catch {
      return null
    }

    // Validate all track files still exist (empty string = intentionally skipped slot)
    if (!entry.tracks.every(t => !t || fs.existsSync(t))) return null

    entry.lastAccessed = Date.now()
    this.saveIndex()
    return entry.tracks
  }

  /** Store extracted track paths in the cache, then evict if over limit. */
  setCachedTracks(filePath: string, tracks: string[], limitBytes: number): void {
    const index = this.loadIndex()
    const key = this.hashKey(filePath)

    let totalSize = 0
    for (const t of tracks) {
      try { totalSize += fs.statSync(t).size } catch {}
    }

    let mtime = 0
    try { mtime = Math.floor(fs.statSync(filePath).mtimeMs) } catch {}

    index.entries[key] = { filePath, mtime, tracks, totalSize, lastAccessed: Date.now() }
    this.evict(limitBytes)
    this.saveIndex()
  }

  private evict(limitBytes: number): void {
    const index = this.loadIndex()
    let totalSize = Object.values(index.entries).reduce((s, e) => s + e.totalSize, 0)
    if (totalSize <= limitBytes) return

    const sorted = Object.entries(index.entries).sort(([, a], [, b]) => a.lastAccessed - b.lastAccessed)
    for (const [key, entry] of sorted) {
      if (totalSize <= limitBytes) break
      for (const t of entry.tracks) {
        try { fs.unlinkSync(t) } catch {}
      }
      totalSize -= entry.totalSize
      delete index.entries[key]
    }
  }

  getTotalSize(): number {
    return Object.values(this.loadIndex().entries).reduce((s, e) => s + e.totalSize, 0)
  }

  clearAll(): void {
    const index = this.loadIndex()
    for (const entry of Object.values(index.entries)) {
      for (const t of entry.tracks) {
        try { fs.unlinkSync(t) } catch {}
      }
    }
    this._index = { entries: {} }
    this.saveIndex()
  }
}

export const audioCacheManager = new AudioCacheManager()
