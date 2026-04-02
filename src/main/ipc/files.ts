import { ipcMain, dialog, BrowserWindow, shell } from 'electron'
import fs from 'fs'
import path from 'path'
import { spawnSync } from 'child_process'
import { fileWatcher, WatchRule, WatchEvent } from '../services/fileWatcher'
import { getStore } from './store'

// FILE_ATTRIBUTE_OFFLINE = 0x1000, FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS = 0x400000
const OFFLINE_MASK = 0x1000 | 0x400000

/**
 * Returns a boolean per path: true = file data is local, false = offline/cloud placeholder.
 * Falls back to true (assume local) on non-Windows or any error so behaviour is unchanged.
 */
function checkLocalFiles(filePaths: string[]): boolean[] {
  if (process.platform !== 'win32' || filePaths.length === 0) return filePaths.map(() => true)

  try {
    const escaped = filePaths.map(p => p.replace(/'/g, "''"))
    const pathsLiteral = escaped.map(p => `'${p}'`).join(',')
    const script = `@(${pathsLiteral}) | ForEach-Object { try { [int][System.IO.File]::GetAttributes($_) } catch { -1 } }`

    const result = spawnSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command', script
    ], { encoding: 'utf8', timeout: 5000 })

    if (result.status !== 0 || !result.stdout) return filePaths.map(() => true)

    const lines = result.stdout.trim().split(/\r?\n/).map(l => l.trim()).filter(Boolean)
    return filePaths.map((_, i) => {
      const val = parseInt(lines[i] ?? '-1', 10)
      if (isNaN(val) || val === -1) return true
      return (val & OFFLINE_MASK) === 0
    })
  } catch {
    return filePaths.map(() => true)
  }
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
    const result = await dialog.showOpenDialog(win!, {
      properties: ['openFile'],
      ...options
    })
    return result.filePaths
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
    const streamsDir = (getStore().get('config') as any)?.streamsDir ?? ''
    fileWatcher.start(rules, streamsDir)
  })

  ipcMain.handle('watcher:stop', async () => {
    fileWatcher.stop()
  })
}
