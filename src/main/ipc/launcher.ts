import { ipcMain, app, shell } from 'electron'
import path from 'path'
import { getStore } from './store'

interface LauncherApp   { id: string; name: string; path: string }
interface LauncherGroup { id: string; name: string; apps: LauncherApp[] }

export function registerLauncherIPC(): void {
  ipcMain.handle('launcher:getGroups', () => {
    return (getStore() as any).get('launcherGroups', []) as LauncherGroup[]
  })

  ipcMain.handle('launcher:setGroups', (_event, groups: LauncherGroup[]) => {
    ;(getStore() as any).set('launcherGroups', groups)
  })

  ipcMain.handle('launcher:launchGroup', async (_event, groupId: string) => {
    const groups: LauncherGroup[] = (getStore() as any).get('launcherGroups', [])
    const group = groups.find(g => g.id === groupId)
    if (!group) return { launched: 0 }

    let launched = 0
    for (const entry of group.apps) {
      if (!entry.path) continue
      try {
        await shell.openPath(entry.path)
        launched++
      } catch (_) {
        // continue launching remaining apps even if one fails
      }
    }
    return { launched }
  })

  ipcMain.handle('launcher:launchApp', async (_event, filePath: string) => {
    if (!filePath) return { launched: false }
    try {
      await shell.openPath(filePath)
      return { launched: true }
    } catch (_) {
      return { launched: false }
    }
  })

  ipcMain.handle('launcher:resolveShortcut', (_event, filePath: string) => {
    if (!filePath.toLowerCase().endsWith('.lnk')) return filePath
    try {
      const details = shell.readShortcutLink(filePath)
      return details.target || filePath
    } catch (_) {
      return filePath
    }
  })

  ipcMain.handle('launcher:getStartMenuPath', () => {
    return path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs')
  })

  ipcMain.handle('launcher:getFileIcon', async (_event, filePath: string) => {
    try {
      const icon = await app.getFileIcon(filePath, { size: 'large' })
      return icon.toDataURL()
    } catch (_) {
      return null
    }
  })
}
