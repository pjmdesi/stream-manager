import chokidar, { FSWatcher } from 'chokidar'
import micromatch from 'micromatch'
import path from 'path'
import fs from 'fs'

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
}

export interface WatchEvent {
  ruleId: string
  ruleName: string
  filePath: string
  action: WatchRule['action']
  destination?: string
  timestamp: number
  status: 'matched' | 'applied' | 'error'
  error?: string
}

type EventCallback = (event: WatchEvent) => void

class FileWatcher {
  private watcher: FSWatcher | null = null
  private rules: WatchRule[] = []
  private callbacks: EventCallback[] = []
  private streamsDir: string = ''

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

      const event: WatchEvent = {
        ruleId: rule.id,
        ruleName: rule.watchPath,
        filePath,
        action: rule.action,
        destination: resolvedDestination,
        timestamp: Date.now(),
        status: 'matched'
      }

      this.emit({ ...event, status: 'matched' })

      try {
        await this.applyRule(rule, filePath)
        this.emit({ ...event, status: 'applied' })
      } catch (err: any) {
        this.emit({ ...event, status: 'error', error: err.message })
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

  private async applyRule(rule: WatchRule, filePath: string): Promise<void> {
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

      fs.mkdirSync(destination, { recursive: true })
      const destPath = path.join(destination, newName)

      if (rule.action === 'move') {
        fs.renameSync(filePath, destPath)
      } else {
        fs.copyFileSync(filePath, destPath)
      }
    } else if (rule.action === 'rename') {
      const dir = path.dirname(filePath)
      const destPath = path.join(dir, newName)
      fs.renameSync(filePath, destPath)
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
