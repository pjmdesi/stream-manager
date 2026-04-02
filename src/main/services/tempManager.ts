import fs from 'fs'
import path from 'path'
import { app } from 'electron'

class TempManager {
  private _tempDir: string | null = null
  private trackedFiles: Set<string> = new Set()

  private get tempDir(): string {
    if (!this._tempDir) {
      this._tempDir = path.join(app.getPath('temp'), 'stream-manager')
      fs.mkdirSync(this._tempDir, { recursive: true })
    }
    return this._tempDir
  }

  private ensureDir(): void {
    fs.mkdirSync(this.tempDir, { recursive: true })
  }

  getDir(): string {
    return this.tempDir
  }

  setCustomDir(dir: string): void {
    this._tempDir = dir
    this.ensureDir()
  }

  track(filePath: string): void {
    this.trackedFiles.add(filePath)
  }

  cleanup(filePath: string): void {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath)
      }
    } catch (err) {
      console.error('Failed to cleanup temp file:', filePath, err)
    }
    this.trackedFiles.delete(filePath)
  }

  cleanupAll(): void {
    this.trackedFiles.forEach(f => {
      try {
        if (fs.existsSync(f)) fs.unlinkSync(f)
      } catch (_) {}
    })
    this.trackedFiles.clear()
  }

  cleanupDir(): void {
    try {
      const files = fs.readdirSync(this.tempDir)
      files.forEach(file => {
        const filePath = path.join(this.tempDir, file)
        try {
          fs.unlinkSync(filePath)
        } catch (_) {}
      })
    } catch (_) {}
  }
}

export const tempManager = new TempManager()
