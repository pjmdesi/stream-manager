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
  onProgress: (pct: number) => void,
  signal?: AbortSignal
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
  await pipeline(createReadStream(src), tracker, createWriteStream(dest), { signal })
  onProgress(100)
}

/** Remove a partially-written destination file. The just-aborted write
 *  stream can hold its Windows handle for a moment, so failed unlinks retry
 *  briefly rather than silently leaving a corrupt partial in the library. */
async function removePartialWithRetry(p: string, attempts = 3): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    try {
      await fs.promises.unlink(p)
      return
    } catch (err: any) {
      if (err.code === 'ENOENT') return
      await new Promise(r => setTimeout(r, 300))
    }
  }
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
  status: 'matched' | 'applied' | 'error' | 'waiting' | 'cancelled'
  error?: string
}

type EventCallback = (event: WatchEvent) => void

/** One in-flight rule execution: a copy/move/rename mid-transfer, a waiting
 *  EBUSY retry, or a convert handoff. Keyed by event id (`ruleId:filePath`)
 *  so a second chokidar fire, a processExistingFiles pass, or a watcher
 *  restart can never start a parallel operation on the same file —
 *  overlapping copies truncate each other's destination and interleave
 *  their progress onto a single activity row. */
interface InFlightOp {
  controller: AbortController
  /** Destination currently being written — non-null only while its content
   *  is unverified. This is the cleanup target for cancel and app-quit;
   *  it MUST be nulled the moment the destination becomes the real file. */
  destPath: string | null
  retryTimer: ReturnType<typeof setTimeout> | null
  attemptRunning: boolean
  cancelled: boolean
  event: WatchEvent
}

class FileWatcher {
  private watcher: FSWatcher | null = null
  private rules: WatchRule[] = []
  private callbacks: EventCallback[] = []
  private inFlight = new Map<string, InFlightOp>()

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
      },
      // Never track a file the converter is actively writing: a rule
      // acting on a half-encoded output would move/copy garbage, and the
      // write-stability stat-polling can race a cancelled job's handle
      // release into EPERM errors. (Lazy import avoids a load cycle.)
      ignored: (p: string) => {
        try {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const { isConverterWritingPath } = require('../ipc/converter') as typeof import('../ipc/converter')
          return isConverterWritingPath(p)
        } catch { return false }
      },
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
    // Waiting retries die with the watcher (as before). An actively-copying
    // op keeps running to completion and STAYS registered, so a restart's
    // processExistingFiles pass can't start a duplicate writer on it.
    for (const [id, op] of this.inFlight) {
      if (op.retryTimer) { clearTimeout(op.retryTimer); op.retryTimer = null }
      if (!op.attemptRunning) this.inFlight.delete(id)
    }
  }

  /** Cancel an in-flight or waiting operation. Aborts the active copy (its
   *  error path removes the partial destination), kills any pending retry,
   *  and emits a terminal 'cancelled' event. The source file is never
   *  touched — move only deletes it after a verified copy. */
  cancel(eventId: string): boolean {
    const op = this.inFlight.get(eventId)
    if (!op || op.cancelled) return false
    op.cancelled = true
    if (op.retryTimer) { clearTimeout(op.retryTimer); op.retryTimer = null }
    op.controller.abort()
    // A running attempt cleans up and deregisters itself when the abort
    // lands in its catch; a waiting op has nothing running — finish here.
    if (!op.attemptRunning) this.inFlight.delete(eventId)
    this.emit({ ...op.event, status: 'cancelled' })
    return true
  }

  /** Abort every in-flight operation (app quit). Each aborted pipeline's
   *  error path removes its own partial; the post-abort sweep here catches
   *  any the event loop didn't get to before shutdown. Await this before
   *  closing the window so write handles have a beat to release. */
  async abortAllInFlight(): Promise<void> {
    const partials: string[] = []
    for (const [id, op] of this.inFlight) {
      op.cancelled = true
      if (op.retryTimer) { clearTimeout(op.retryTimer); op.retryTimer = null }
      op.controller.abort()
      if (op.destPath) partials.push(op.destPath)
      if (!op.attemptRunning) this.inFlight.delete(id)
    }
    if (partials.length === 0) return
    await new Promise(r => setTimeout(r, 250))
    for (const p of partials) {
      try { fs.unlinkSync(p) } catch { /* best-effort — may already be gone */ }
    }
  }

  /** In-flight move/copy/rename count for the quit guard. Convert handoffs
   *  are excluded — those run as converter jobs and are already counted by
   *  getActiveConversionCounts. */
  getActiveFileOpCount(): number {
    let n = 0
    for (const op of this.inFlight.values()) if (op.event.action !== 'convert') n++
    return n
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
      // Separator-aware containment — a raw prefix check let a rule on
      // D:\Rec swallow files landing in D:\Recordings.
      const root = rule.watchPath.replace(/[\\/]+$/, '')
      if (!(filePath.startsWith(root + path.sep) || filePath.startsWith(root + '/'))) continue

      const fileName = path.basename(filePath)
      if (!micromatch.isMatch(fileName, rule.pattern)) continue

      const resolvedDestination = rule.destinationMode === 'auto'
        ? (this.resolveAutoDestination(rule, filePath) ?? rule.destination)
        : rule.destination

      const eventId = `${rule.id}:${filePath}`
      // In-flight guard: whatever fired us (chokidar, processExistingFiles,
      // a watcher restart), this rule+file is already being handled.
      if (this.inFlight.has(eventId)) continue

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

      const op: InFlightOp = {
        controller: new AbortController(),
        destPath: null,
        retryTimer: null,
        attemptRunning: false,
        cancelled: false,
        event,
      }
      this.inFlight.set(eventId, op)
      this.emit({ ...event, status: 'matched' })

      // The cancelled gate stops a throttled tracker tick that lands after
      // the abort from flipping the row back out of its 'cancelled' state.
      const onProgress = (pct: number) => {
        if (!op.cancelled) this.emit({ ...event, status: 'matched', progress: pct })
      }

      op.attemptRunning = true
      try {
        await this.applyRule(rule, filePath, onProgress, op)
        this.inFlight.delete(eventId)
        this.emit({ ...event, status: 'applied' })
      } catch (err: any) {
        if (op.cancelled) {
          this.inFlight.delete(eventId) // cancel() already emitted + cleaned up
        } else if (err.code === 'EBUSY') {
          this.emit({ ...event, status: 'waiting' })
          this.scheduleRetry(rule, filePath, op)
        } else {
          this.inFlight.delete(eventId)
          this.emit({ ...event, status: 'error', error: err.message })
        }
      } finally {
        op.attemptRunning = false
      }
    }
  }

  /** Sequential EBUSY retry: the next attempt is armed only after the
   *  current one fully finishes. The previous setInterval version re-entered
   *  applyRule every 30s regardless of whether the last attempt was still
   *  running — a minutes-long cross-drive copy accumulated concurrent
   *  writers that truncated each other's destination and interleaved their
   *  progress onto one activity row. */
  private scheduleRetry(rule: WatchRule, filePath: string, op: InFlightOp): void {
    op.retryTimer = setTimeout(async () => {
      op.retryTimer = null
      if (op.cancelled) return
      const onRetryProgress = (pct: number) => {
        if (!op.cancelled) this.emit({ ...op.event, status: 'waiting', lastChecked: Date.now(), progress: pct })
      }
      op.attemptRunning = true
      try {
        await this.applyRule(rule, filePath, onRetryProgress, op)
        this.inFlight.delete(op.event.id)
        this.emit({ ...op.event, status: 'applied', lastChecked: Date.now() })
      } catch (err: any) {
        if (op.cancelled) {
          this.inFlight.delete(op.event.id)
        } else if (err.code === 'EBUSY') {
          this.emit({ ...op.event, status: 'waiting', lastChecked: Date.now() })
          this.scheduleRetry(rule, filePath, op)
        } else {
          this.inFlight.delete(op.event.id)
          this.emit({ ...op.event, status: 'error', error: err.message, lastChecked: Date.now() })
        }
      } finally {
        op.attemptRunning = false
      }
    }, 30_000)
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

  /** Copy with abort support and dirty-failure cleanup: registers dest as
   *  the op's cleanup target and removes the partial on any failure,
   *  including a cancel/quit abort. On success dest stays registered as
   *  unverified — the caller nulls op.destPath once it accepts the file. */
  private async runTrackedCopy(
    src: string,
    dest: string,
    onProgress: ((pct: number) => void) | undefined,
    op: InFlightOp | undefined
  ): Promise<void> {
    if (op) op.destPath = dest
    try {
      await copyWithProgress(src, dest, onProgress ?? (() => {}), op?.controller.signal)
    } catch (err) {
      await removePartialWithRetry(dest)
      if (op) op.destPath = null
      throw err
    }
  }

  /** Cross-device move fallback: copy, verify the destination byte count
   *  against the source, and only then delete the original. A truncated or
   *  aborted copy can never cost the source file. */
  private async crossDeviceMove(
    src: string,
    dest: string,
    onProgress: ((pct: number) => void) | undefined,
    op: InFlightOp | undefined
  ): Promise<void> {
    await this.runTrackedCopy(src, dest, onProgress, op)
    const [srcStat, destStat] = await Promise.all([fs.promises.stat(src), fs.promises.stat(dest)])
    if (op?.cancelled || destStat.size !== srcStat.size) {
      await removePartialWithRetry(dest)
      if (op) op.destPath = null
      throw op?.cancelled
        ? new Error('Cancelled')
        : new Error(`Copy verification failed: destination is ${destStat.size} of ${srcStat.size} bytes — the original was not deleted`)
    }
    if (op) op.destPath = null
    await fs.promises.unlink(src)
  }

  private async applyRule(
    rule: WatchRule,
    filePath: string,
    onProgress?: (pct: number) => void,
    op?: InFlightOp
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
            await this.crossDeviceMove(filePath, destPath, onProgress, op)
          } else {
            throw err
          }
        }
      } else {
        await this.runTrackedCopy(filePath, destPath, onProgress, op)
        if (op?.cancelled) {
          await removePartialWithRetry(destPath)
          op.destPath = null
          throw new Error('Cancelled')
        }
        if (op) op.destPath = null
      }
    } else if (rule.action === 'rename') {
      const dir = path.dirname(filePath)
      const destPath = path.join(dir, newName)
      try {
        await fs.promises.rename(filePath, destPath)
      } catch (err: any) {
        if (err.code === 'EXDEV') {
          await this.crossDeviceMove(filePath, destPath, onProgress, op)
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
