import chokidar, { FSWatcher } from 'chokidar'
import micromatch from 'micromatch'
import path from 'path'
import fs from 'fs'
import { pipeline } from 'stream/promises'
import { createReadStream, createWriteStream } from 'fs'
import { Transform } from 'stream'
import { getStore } from '../ipc/store'

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

/** Walk streamsDir recursively (capped depth) and return the absolute path
 *  of the stream folder matching `date`. Handles arbitrary intermediate
 *  layers (year, year/month, etc.) by recursing into any directory whose
 *  name doesn't itself look like a stream folder.
 *  Prefers the base folder (e.g. `2026-04-01`) over suffixed variants
 *  (`2026-04-01-2`, …) so new files land with the day's primary stream. */
function findDatedFolderRecursive(streamsDir: string, date: string, maxDepth = 5): string | null {
  const matches: { path: string; idx: number }[] = []
  const walk = (dir: string, depth: number) => {
    if (depth > maxDepth) return
    let entries: fs.Dirent[]
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (!e.isDirectory()) continue
      if (e.name.startsWith('_') || e.name.startsWith('.')) continue
      const full = path.join(dir, e.name)
      const m = e.name.match(/^(\d{4}-\d{2}-\d{2})(?:-(\d+))?$/)
      if (m) {
        if (m[1] === date) {
          matches.push({ path: full, idx: m[2] ? parseInt(m[2], 10) : 1 })
        }
        // Don't recurse into stream folders looking for nested stream folders.
        continue
      }
      walk(full, depth + 1)
    }
  }
  walk(streamsDir, 0)
  if (matches.length === 0) return null
  matches.sort((a, b) => a.idx - b.idx)
  return matches[0].path
}

export interface WatchRule {
  id: string
  enabled: boolean
  name?: string
  watchPath: string
  pattern: string
  action: 'move' | 'copy' | 'rename' | 'convert'
  destinationMode?: 'static' | 'auto' | 'next-to-original'
  destination?: string
  autoMatchDate?: boolean
  namePattern?: string
  onlyNewFiles?: boolean
  conversionPresetId?: string
  startImmediately?: boolean
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
  private retryTimers = new Map<string, ReturnType<typeof setInterval>>()

  // Read streamsDir / streamMode live from the store on each rule firing
  // rather than caching them at start() time. Without this, changing the
  // streams root in Settings while the watcher was running left the
  // 'auto' destinationMode targeting the previous root.
  private get streamsDir(): string {
    return ((getStore().get('config') as { streamsDir?: string } | undefined)?.streamsDir) ?? ''
  }
  private get streamMode(): string {
    return ((getStore().get('config') as { streamMode?: string } | undefined)?.streamMode) ?? ''
  }

  start(rules: WatchRule[]): void {
    this.stop()
    this.rules = rules.filter(r => r.enabled)

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

  getStatus(): { active: boolean; ruleCount: number } {
    return { active: this.watcher !== null, ruleCount: this.rules.length }
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
        ruleName: rule.name || rule.watchPath,
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
    // Dump mode: the streams root IS the destination — no per-date folders exist.
    if (this.streamMode === 'dump-folder') return this.streamsDir
    // Folder-per-stream: walk recursively so nested layouts (year, year/month, …) work too.
    return findDatedFolderRecursive(this.streamsDir, date)
  }

  /**
   * When stream mode is folder-per-stream and the rule's destination points at the
   * streams root directory, attempt to route the file into the dated stream folder
   * instead. Walks recursively so nested layouts work; falls back to the original
   * destination if no matching folder exists.
   */
  private resolveFolderPerStreamDestination(destination: string, filePath: string): string {
    if (this.streamMode !== 'folder-per-stream') return destination
    if (!this.streamsDir) return destination
    // Only intercept when destination is exactly the streams root
    if (path.resolve(destination) !== path.resolve(this.streamsDir)) return destination

    const fileName = path.basename(filePath)
    const match = fileName.match(/(\d{4}-\d{2}-\d{2})/)
    if (!match) return destination
    return findDatedFolderRecursive(this.streamsDir, match[1]) ?? destination
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
      const rawDestination = rule.destinationMode === 'auto'
        ? this.resolveAutoDestination(rule, filePath)
        : rule.destinationMode === 'next-to-original'
          ? path.dirname(filePath)
          : (rule.destination ?? null)

      const destination = rawDestination
        ? this.resolveFolderPerStreamDestination(rawDestination, filePath)
        : rawDestination

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
    } else if (rule.action === 'convert') {
      if (!rule.conversionPresetId) throw new Error('No conversion preset configured')
      const { getPresetById, startConversionJob, addPendingJob } = await import('../ipc/converter')
      const preset = getPresetById(rule.conversionPresetId)
      if (!preset) throw new Error(`Conversion preset not found: ${rule.conversionPresetId}`)

      const rawDestination = rule.destinationMode === 'auto'
        ? this.resolveAutoDestination(rule, filePath)
        : rule.destinationMode === 'next-to-original'
          ? path.dirname(filePath)
          : (rule.destination ?? null)
      const destination = rawDestination
        ? this.resolveFolderPerStreamDestination(rawDestination, filePath)
        : rawDestination
      if (!destination) throw new Error(
        rule.destinationMode === 'auto'
          ? 'Could not find a matching stream folder for the date in the filename'
          : 'No destination configured'
      )
      await fs.promises.mkdir(destination, { recursive: true })

      // Replace the matched file's extension with the preset's output extension
      const baseName = path.basename(newName, path.extname(newName))
      const outputPath = path.join(destination, `${baseName}.${preset.outputExtension}`)
      const jobStub = { id: '', inputFile: filePath, outputFile: outputPath, preset, status: 'queued' as const, progress: 0 }

      if (rule.startImmediately) {
        const { done } = await startConversionJob(jobStub, onProgress)
        await done
      } else {
        // Add to converter queue for manual start; rule is 'applied' as soon as the job is queued.
        addPendingJob(jobStub)
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
