import chokidar, { FSWatcher } from 'chokidar'
import micromatch from 'micromatch'
import path from 'path'
import fs from 'fs'
import { pipeline } from 'stream/promises'
import { createReadStream, createWriteStream } from 'fs'
import { Transform } from 'stream'

const PROGRESS_THROTTLE_MS = 250

async function copyWithProgress(
  src: string,
  dest: string,
  onProgress: (pct: number) => void
): Promise<void> {
  const { size } = await fs.promises.stat(src)
  let transferred = 0
  let lastEmit = 0

  const tracker = new Transform({
    transform(chunk, _enc, cb) {
      transferred += chunk.length
      const now = Date.now()
      if (now - lastEmit >= PROGRESS_THROTTLE_MS) {
        lastEmit = now
        onProgress(size > 0 ? Math.round((transferred / size) * 100) : 0)
      }
      cb(null, chunk)
    }
  })

  onProgress(0)
  await pipeline(createReadStream(src), tracker, createWriteStream(dest))
  onProgress(100)
}

export interface WatchRule {
  id: string
  enabled: boolean
  watchPath: string
  pattern: string
  action: 'move' | 'copy' | 'rename'
  destinationMode?: 'static' | 'auto'
  destination?: string
  autoMatchDate?: boolean
  namePattern?: string
  onlyNewFiles?: boolean
}

export interface WatchEvent {
  id: string
  ruleId: string
  ruleName: string
  filePath: string
  action: WatchRule['action']
  destination?: string
  timestamp: number
  lastChecked?: number
  progress?: number
  status: 'matched' | 'applied' | 'error' | 'waiting'
  error?: string
}

type EventCallback = (event: WatchEvent) => void

class FileWatcher {
  private watcher: FSWatcher | null = null
  private rules: WatchRule[] = []
  private callbacks: EventCallback[] = []
  private streamsDir: string = ''
  private retryTimers = new Map<string, ReturnType<typeof setInterval>>()

  start(rules: WatchRule[], streamsDir: string = ''): void {
    this.stop()
    this.rules = rules.filter(r => r.enabled)
    this.streamsDir = streamsDir

    if (this.rules.length === 0) return

    const watchPaths = [...new Set(this.rules.map(r => r.watchPath))]

    this.watcher = chokidar.watch(watchPaths, {
      ignoreInitial: true,
      persistent: true,
      awaitWriteFinish: {
        stabilityThreshold: 2000,
        pollInterval: 500
      }
    })

    this.watcher.on('add', (filePath) => {
      this.handleFile(filePath)
    })

    this.watcher.on('error', (err) => {
      console.error('Watcher error:', err)
    })
  }

  stop(): void {
    if (this.watcher) {
      this.watcher.close()
      this.watcher = null
    }
    for (const timer of this.retryTimers.values()) clearInterval(timer)
    this.retryTimers.clear()
  }

  async processExistingFiles(): Promise<void> {
    for (const rule of this.rules) {
      if (rule.onlyNewFiles) continue
      try {
        const entries = fs.readdirSync(rule.watchPath, { withFileTypes: true })
        for (const entry of entries) {
          if (!entry.isFile()) continue
          if (!micromatch.isMatch(entry.name, rule.pattern)) continue
          await this.handleFile(path.join(rule.watchPath, entry.name))
        }
      } catch {
        // Watch path inaccessible — skip silently
      }
    }
  }

  onFileMatched(callback: EventCallback): void {
    this.callbacks.push(callback)
  }

  removeCallback(callback: EventCallback): void {
    this.callbacks = this.callbacks.filter(cb => cb !== callback)
  }

  clearCallbacks(): void {
    this.callbacks = []
  }

  private emit(event: WatchEvent): void {
    this.callbacks.forEach(cb => cb(event))
  }

  private async handleFile(filePath: string): Promise<void> {
    for (const rule of this.rules) {
      // Check if file is in watch path
      if (!filePath.startsWith(rule.watchPath)) continue

      const fileName = path.basename(filePath)
      if (!micromatch.isMatch(fileName, rule.pattern)) continue

      const resolvedDestination = rule.destinationMode === 'auto'
        ? (this.resolveAutoDestination(rule, filePath) ?? rule.destination)
        : rule.destination

      const eventId = `${rule.id}:${filePath}`
      const event: WatchEvent = {
        id: eventId,
        ruleId: rule.id,
        ruleName: rule.watchPath,
        filePath,
        action: rule.action,
        destination: resolvedDestination,
        timestamp: Date.now(),
        status: 'matched'
      }

      this.emit({ ...event, status: 'matched' })

      const onProgress = (pct: number) => this.emit({ ...event, status: 'matched', progress: pct })

      try {
        await this.applyRule(rule, filePath, onProgress)
        this.emit({ ...event, status: 'applied' })
      } catch (err: any) {
        if (err.code === 'EBUSY') {
          this.emit({ ...event, status: 'waiting' })
          const timer = setInterval(async () => {
            const onRetryProgress = (pct: number) =>
              this.emit({ ...event, status: 'waiting', lastChecked: Date.now(), progress: pct })
            try {
              await this.applyRule(rule, filePath, onRetryProgress)
              clearInterval(timer)
              this.retryTimers.delete(eventId)
              this.emit({ ...event, status: 'applied', lastChecked: Date.now() })
            } catch (retryErr: any) {
              if (retryErr.code === 'EBUSY') {
                this.emit({ ...event, status: 'waiting', lastChecked: Date.now() })
              } else {
                clearInterval(timer)
                this.retryTimers.delete(eventId)
                this.emit({ ...event, status: 'error', error: retryErr.message, lastChecked: Date.now() })
              }
            }
          }, 30_000)
          this.retryTimers.set(eventId, timer)
        } else {
          this.emit({ ...event, status: 'error', error: err.message })
        }
      }
    }
  }

  private resolveAutoDestination(rule: WatchRule, filePath: string): string | null {
    if (!rule.autoMatchDate) return null
    const fileName = path.basename(filePath)
    const match = fileName.match(/(\d{4}-\d{2}-\d{2})/)
    if (!match) return null
    const date = match[1]
    if (!this.streamsDir) return null
    const folderPath = path.join(this.streamsDir, date)
    if (!fs.existsSync(folderPath)) return null
    return folderPath
  }

  private async applyRule(
    rule: WatchRule,
    filePath: string,
    onProgress?: (pct: number) => void
  ): Promise<void> {
    const fileName = path.basename(filePath)
    const ext = path.extname(fileName)
    const nameWithoutExt = path.basename(fileName, ext)

    let newName = fileName
    if (rule.namePattern) {
      newName = applyNamePattern(rule.namePattern, nameWithoutExt, ext)
    }

    if (rule.action === 'move' || rule.action === 'copy') {
      const destination = rule.destinationMode === 'auto'
        ? this.resolveAutoDestination(rule, filePath)
        : (rule.destination ?? null)

      if (!destination) throw new Error(
        rule.destinationMode === 'auto'
          ? 'Could not find a matching stream folder for the date in the filename'
          : 'No destination configured'
      )

      await fs.promises.mkdir(destination, { recursive: true })
      const destPath = path.join(destination, newName)

      if (rule.action === 'move') {
        try {
          await fs.promises.rename(filePath, destPath)
        } catch (err: any) {
          if (err.code === 'EXDEV') {
            await copyWithProgress(filePath, destPath, onProgress ?? (() => {}))
            await fs.promises.unlink(filePath)
          } else {
            throw err
          }
        }
      } else {
        await copyWithProgress(filePath, destPath, onProgress ?? (() => {}))
      }
    } else if (rule.action === 'rename') {
      const dir = path.dirname(filePath)
      const destPath = path.join(dir, newName)
      try {
        await fs.promises.rename(filePath, destPath)
      } catch (err: any) {
        if (err.code === 'EXDEV') {
          await copyWithProgress(filePath, destPath, onProgress ?? (() => {}))
          await fs.promises.unlink(filePath)
        } else {
          throw err
        }
      }
    }
  }
}

export function applyNamePattern(pattern: string, name: string, ext: string): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')

  return pattern
    .replace('{name}', name)
    .replace('{ext}', ext.replace('.', ''))
    .replace('{date}', `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`)
    .replace('{year}', String(now.getFullYear()))
    .replace('{month}', pad(now.getMonth() + 1))
    .replace('{day}', pad(now.getDate()))
    .replace('{time}', `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`)
}

export const fileWatcher = new FileWatcher()
