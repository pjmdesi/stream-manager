import { ipcMain, app, shell } from 'electron'
import path from 'path'
import { getStore } from './store'

interface LauncherApp   { id: string; name: string; path: string }
interface LauncherGroup { id: string; name: string; apps: LauncherApp[] }

// A launch target is a URL (open in the default browser / protocol handler via
// shell.openExternal) when it has a `scheme://` prefix; otherwise it's a file
// path opened with shell.openPath. A Windows drive path ("C:\…") has no `//`
// after the colon, so it never matches.
const isUrl = (p: string): boolean => /^[a-z][a-z\d+.-]*:\/\//i.test(p)
const openTarget = (target: string): Promise<unknown> =>
  isUrl(target) ? shell.openExternal(target) : shell.openPath(target)

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
        await openTarget(entry.path)
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
      await openTarget(filePath)
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
