import { ipcMain, dialog, BrowserWindow, shell } from 'electron'
import fs from 'fs'
import path from 'path'
import { spawnSync, spawn, ChildProcess } from 'child_process'
import { fileWatcher, WatchRule, WatchEvent } from '../services/fileWatcher'
import { getStore } from './store'

// Windows attribute flags that indicate the file's data is not resident locally:
//   0x1000   = FILE_ATTRIBUTE_OFFLINE              (data physically offline)
//   0x40000  = FILE_ATTRIBUTE_RECALL_ON_OPEN       (opening triggers recall)
//   0x400000 = FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS (reading triggers recall)
// REPARSE_POINT (0x400) is intentionally NOT here — Synology Drive (and
// similar) use reparse points on EVERY file in the synced folder for both
// placeholders and locally-resident files, so it doesn't distinguish the two.
const OFFLINE_MASK = 0x1000 | 0x40000 | 0x400000

const activeDownloadPollers = new Map<string, ReturnType<typeof setInterval>>()

/**
 * Like checkLocalFiles but returns false (not local) on any error or uncertainty.
 * Used in download polling where a false-positive "file is ready" would be harmful.
 */
function isFileConfirmedLocal(filePath: string): boolean {
  if (process.platform !== 'win32') return true
  try {
    const escaped = filePath.replace(/'/g, "''")
    const script = `try { [int][System.IO.File]::GetAttributes('${escaped}') } catch { -1 }`
    const result = spawnSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command', script
    ], { encoding: 'utf8', timeout: 5000 })
    if (result.status !== 0 || !result.stdout) return false
    const val = parseInt(result.stdout.trim(), 10)
    if (isNaN(val) || val === -1) return false
    return (val & OFFLINE_MASK) === 0
  } catch {
    return false
  }
}

/**
 * Returns a boolean per path: true = file data is local, false = offline/cloud placeholder.
 * Falls back to true (assume local) on non-Windows or any error so behaviour is unchanged.
 * Uses async spawn so it never blocks the main thread.
 */
export async function checkLocalFiles(filePaths: string[]): Promise<boolean[]> {
  if (process.platform !== 'win32' || filePaths.length === 0) return filePaths.map(() => true)

  // Single PowerShell process; paths streamed via stdin to avoid argv limits and
  // to amortize the ~500ms PowerShell startup over the entire batch instead of
  // paying it once per chunk. With 1000+ files this drops total time from
  // double-digit seconds (chunked spawning) to roughly the time of one spawn.
  return runAttrCheckViaStdin(filePaths)
}

function runAttrCheckViaStdin(filePaths: string[]): Promise<boolean[]> {
  return new Promise(resolve => {
    // Reads paths from stdin one per line, prints "<int>" per line in order.
    // -1 marker for paths whose attributes can't be read (file gone, etc.).
    const script = `
      $ErrorActionPreference = 'Continue'
      while (($line = [Console]::In.ReadLine()) -ne $null) {
        try { [int][System.IO.File]::GetAttributes($line) } catch { -1 }
      }
    `
    let stdout = ''
    const proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script])
    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString() })
    proc.on('close', () => {
      if (!stdout) return resolve(filePaths.map(() => true))
      const lines = stdout.trim().split(/\r?\n/).map(l => l.trim()).filter(Boolean)
      resolve(filePaths.map((_, i) => {
        const val = parseInt(lines[i] ?? '-1', 10)
        if (isNaN(val) || val === -1) return true
        return (val & OFFLINE_MASK) === 0
      }))
    })
    proc.on('error', () => resolve(filePaths.map(() => true)))
    // Stream paths to PowerShell. Each path on its own line.
    proc.stdin.write(filePaths.join('\n') + '\n')
    proc.stdin.end()
  })
}

export interface FileInfo {
  name: string
  path: string
  size: number
  mtime: number
  isDirectory: boolean
  extension: string
}

export function registerFilesIPC(): void {
  ipcMain.handle('files:openFileDialog', async (event, options: Electron.OpenDialogOptions) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const normalizedOptions = options?.defaultPath
      ? { ...options, defaultPath: path.normalize(options.defaultPath) }
      : options
    const result = await dialog.showOpenDialog(win!, {
      properties: ['openFile'],
      ...normalizedOptions
    })
    return result.filePaths
  })

  ipcMain.handle('files:saveFileDialog', async (event, options: Electron.SaveDialogOptions) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const result = await dialog.showSaveDialog(win!, options)
    return result.canceled ? null : result.filePath ?? null
  })

  ipcMain.handle('files:openDirectoryDialog', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const result = await dialog.showOpenDialog(win!, {
      properties: ['openDirectory']
    })
    return result.filePaths[0] || null
  })

  ipcMain.handle('files:move', async (_event, src: string, dest: string) => {
    const destDir = path.dirname(dest)
    fs.mkdirSync(destDir, { recursive: true })
    fs.renameSync(src, dest)
  })

  ipcMain.handle('files:copy', async (_event, src: string, dest: string) => {
    const destDir = path.dirname(dest)
    fs.mkdirSync(destDir, { recursive: true })
    fs.copyFileSync(src, dest)
  })

  ipcMain.handle('files:rename', async (_event, filePath: string, newName: string) => {
    const dir = path.dirname(filePath)
    const newPath = path.join(dir, newName)
    fs.renameSync(filePath, newPath)
    return newPath
  })

  ipcMain.handle('files:delete', async (_event, filePath: string) => {
    fs.unlinkSync(filePath)
  })

  ipcMain.handle('files:list', async (_event, dir: string): Promise<FileInfo[]> => {
    if (!fs.existsSync(dir)) return []

    const entries = fs.readdirSync(dir, { withFileTypes: true })
    return entries.map(entry => {
      const entryPath = path.join(dir, entry.name)
      let size = 0
      let mtime = 0
      try {
        const stat = fs.statSync(entryPath)
        size = stat.size
        mtime = stat.mtimeMs
      } catch (_) {}

      return {
        name: entry.name,
        path: entryPath,
        size,
        mtime,
        isDirectory: entry.isDirectory(),
        extension: path.extname(entry.name).toLowerCase()
      }
    })
  })

  ipcMain.handle('files:exists', async (_event, filePath: string) => {
    return fs.existsSync(filePath)
  })

  // Recursive list — used for the player's Session Videos panel so files in
  // sub-folders (clips/, recordings/, exports/, …) appear in the flat panel
  // alongside top-level files. Skips dot/underscore-prefixed entries.
  ipcMain.handle('files:listRecursive', async (_event, dir: string, maxDepth = 4): Promise<FileInfo[]> => {
    if (!fs.existsSync(dir)) return []
    const out: FileInfo[] = []
    const walk = (current: string, depth: number) => {
      if (depth > maxDepth) return
      let entries: fs.Dirent[]
      try { entries = fs.readdirSync(current, { withFileTypes: true }) } catch { return }
      for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name.startsWith('_')) continue
        const entryPath = path.join(current, entry.name)
        if (entry.isDirectory()) { walk(entryPath, depth + 1); continue }
        let size = 0, mtime = 0
        try { const stat = fs.statSync(entryPath); size = stat.size; mtime = stat.mtimeMs } catch {}
        out.push({
          name: entry.name,
          path: entryPath,
          size,
          mtime,
          isDirectory: false,
          extension: path.extname(entry.name).toLowerCase(),
        })
      }
    }
    walk(dir, 0)
    return out
  })

  ipcMain.handle('files:mkdir', async (_event, dirPath: string) => {
    fs.mkdirSync(dirPath, { recursive: true })
  })

  ipcMain.handle('files:openUrl', async (_event, url: string) => {
    await shell.openExternal(url)
  })

  ipcMain.handle('files:openInExplorer', async (_event, filePath: string) => {
    const stat = fs.statSync(filePath)
    if (stat.isDirectory()) {
      shell.openPath(filePath)
    } else {
      shell.showItemInFolder(filePath)
    }
  })

  ipcMain.handle('files:readFile', async (_event, filePath: string) => {
    return fs.readFileSync(filePath, 'utf-8')
  })

  ipcMain.handle('files:saveScreenshot', async (_event, destPath: string, base64Data: string) => {
    const buffer = Buffer.from(base64Data, 'base64')
    fs.writeFileSync(destPath, buffer)
    return destPath
  })

  ipcMain.handle('files:checkLocalFiles', async (_event, filePaths: string[]): Promise<boolean[]> => {
    return checkLocalFiles(filePaths)
  })

  // Diagnostic: returns the raw Windows file attributes for a single path so we
  // can see exactly which cloud-provider flags it's setting. Useful for
  // troubleshooting "why is this file being treated as local when it's a
  // cloud placeholder" issues.
  ipcMain.handle('files:debugFileAttrs', async (_event, filePath: string): Promise<{
    exists: boolean
    raw: number
    hex: string
    flags: Record<string, boolean>
    isLocalByMask: boolean
  }> => {
    if (process.platform !== 'win32') {
      return { exists: fs.existsSync(filePath), raw: 0, hex: '0x0', flags: {}, isLocalByMask: true }
    }
    const escaped = filePath.replace(/'/g, "''")
    const script = `try { [int][System.IO.File]::GetAttributes('${escaped}') } catch { -1 }`
    const result = spawnSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command', script
    ], { encoding: 'utf8', timeout: 5000 })
    const raw = parseInt((result.stdout || '').trim(), 10)
    if (isNaN(raw) || raw === -1) {
      return { exists: false, raw: -1, hex: '-1', flags: {}, isLocalByMask: true }
    }
    const flags = {
      READONLY:                 (raw & 0x1)        !== 0,
      HIDDEN:                   (raw & 0x2)        !== 0,
      SYSTEM:                   (raw & 0x4)        !== 0,
      DIRECTORY:                (raw & 0x10)       !== 0,
      ARCHIVE:                  (raw & 0x20)       !== 0,
      NORMAL:                   (raw & 0x80)       !== 0,
      TEMPORARY:                (raw & 0x100)      !== 0,
      SPARSE_FILE:              (raw & 0x200)      !== 0,
      REPARSE_POINT:            (raw & 0x400)      !== 0,
      COMPRESSED:               (raw & 0x800)      !== 0,
      OFFLINE:                  (raw & 0x1000)     !== 0,
      NOT_CONTENT_INDEXED:      (raw & 0x2000)     !== 0,
      ENCRYPTED:                (raw & 0x4000)     !== 0,
      INTEGRITY_STREAM:         (raw & 0x8000)     !== 0,
      VIRTUAL:                  (raw & 0x10000)    !== 0,
      NO_SCRUB_DATA:            (raw & 0x20000)    !== 0,
      RECALL_ON_OPEN:           (raw & 0x40000)    !== 0,
      PINNED:                   (raw & 0x80000)    !== 0,
      UNPINNED:                 (raw & 0x100000)   !== 0,
      RECALL_ON_DATA_ACCESS:    (raw & 0x400000)   !== 0,
    }
    return {
      exists: true,
      raw,
      hex: '0x' + raw.toString(16),
      flags,
      isLocalByMask: (raw & OFFLINE_MASK) === 0,
    }
  })

  ipcMain.handle('files:startCloudDownload', async (event, filePath: string) => {
    if (process.platform !== 'win32') return
    // Opening the file for reading triggers Windows cloud provider (OneDrive etc.) to hydrate it
    fs.open(filePath, 'r', (err, fd) => {
      if (!err) {
        const buf = Buffer.alloc(1)
        fs.read(fd, buf, 0, 1, 0, () => fs.close(fd, () => {}))
      }
    })
    const win = BrowserWindow.fromWebContents(event.sender)
    // Clear any existing poller for this file before starting a new one
    const existing = activeDownloadPollers.get(filePath)
    if (existing) clearInterval(existing)
    const t = setInterval(() => {
      if (isFileConfirmedLocal(filePath)) {
        clearInterval(t)
        activeDownloadPollers.delete(filePath)
        if (win && !win.isDestroyed()) {
          win.webContents.send('files:cloudDownloadDone', filePath)
        }
      }
    }, 2000)
    activeDownloadPollers.set(filePath, t)
  })

  ipcMain.handle('files:cancelCloudDownload', async (_event, filePath: string) => {
    const t = activeDownloadPollers.get(filePath)
    if (t) {
      clearInterval(t)
      activeDownloadPollers.delete(filePath)
    }
  })

  // Lightweight directory listing — names and type only, no stat() calls, safe for cloud-synced folders
  ipcMain.handle('files:listNames', async (_event, dirPath: string): Promise<{ name: string; isDirectory: boolean }[]> => {
    try {
      return fs.readdirSync(dirPath, { withFileTypes: true }).map(e => ({
        name: e.name,
        isDirectory: e.isDirectory()
      }))
    } catch {
      return []
    }
  })

  // Watcher
  ipcMain.handle('watcher:start', async (event, rules: WatchRule[]) => {
    fileWatcher.clearCallbacks()
    fileWatcher.onFileMatched((watchEvent: WatchEvent) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (win && !win.isDestroyed()) {
        win.webContents.send('watcher:fileMatched', watchEvent)
      }
    })
    const config = (getStore().get('config') as any) ?? {}
    const streamsDir = config.streamsDir ?? ''
    const streamMode = config.streamMode ?? ''
    fileWatcher.start(rules, streamsDir, streamMode)
    // Non-blocking: process existing files for rules that opted in
    fileWatcher.processExistingFiles()
  })

  ipcMain.handle('watcher:stop', async () => {
    fileWatcher.stop()
  })
}
