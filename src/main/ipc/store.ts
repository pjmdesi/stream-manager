import { ipcMain } from 'electron'
import Store from 'electron-store'
import { app } from 'electron'
import path from 'path'

export interface YTTitleTemplate { id: string; name: string; template: string }
export interface YTDescriptionTemplate { id: string; name: string; description: string }
export interface YTTagTemplate { id: string; name: string; tags: string[] }

export type StreamMode = 'folder-per-stream' | 'dump-folder' | ''

export interface AppConfig {
  defaultWatchDir: string
  defaultOutputDir: string
  presetsDir: string
  tempDir: string
  theme: 'dark' | 'light'
  autoStartWatcher: boolean
  streamerName: string
  streamsDir: string
  streamMode: StreamMode
  archivePresetId: string
  clipPresetId: string
  defaultThumbnailTemplate: string
  checkEpisodeIteration: boolean
  audioCacheLimit: number
  defaultBleepVolume: number
  youtubeClientId: string
  youtubeClientSecret: string
  twitchClientId: string
  twitchClientSecret: string
  startWithWindows: boolean
  startMinimized: boolean
  disableAnimations: boolean
  slowAnimations: boolean
  autoDeletePartialOnCancel: boolean
  clipDurationThreshold: number
  claudeApiKey: string
  claudeSystemPrompt: string
  launcherWidgetGroupId: string
  listThumbWidth: number
  defaultBuiltinThumbnailTemplate: string
  useBuiltinThumbnailByDefault: boolean
}

function getDefaultConfig(): AppConfig {
  return {
    defaultWatchDir: app.getPath('videos'),
    defaultOutputDir: app.getPath('videos'),
    presetsDir: '',
    tempDir: path.join(app.getPath('temp'), 'stream-manager'),
    theme: 'dark',
    autoStartWatcher: false,
    streamerName: '',
    streamsDir: '',
    streamMode: '' as StreamMode,
    archivePresetId: '',
    clipPresetId: '',
    defaultThumbnailTemplate: '',
    checkEpisodeIteration: true,
    audioCacheLimit: 1_073_741_824,  // 1 GB
    defaultBleepVolume: 0.25,
    youtubeClientId: '',
    youtubeClientSecret: '',
    twitchClientId: '',
    twitchClientSecret: '',
    startWithWindows: false,
    startMinimized: false,
    disableAnimations: false,
    slowAnimations: false,
    autoDeletePartialOnCancel: false,
    clipDurationThreshold: 300,
    claudeApiKey: '',
    claudeSystemPrompt: '',
    launcherWidgetGroupId: '',
    listThumbWidth: 85,
    defaultBuiltinThumbnailTemplate: '',
    useBuiltinThumbnailByDefault: true,
  }
}

type StoreShape = {
  config: AppConfig
  watchRules: any[]
  ytTitleTemplates: YTTitleTemplate[]
  ytDescriptionTemplates: YTDescriptionTemplate[]
  ytTagTemplates: YTTagTemplate[]
  importedPresets: any[]
  metaMigrated: boolean
  streamTypeTags: Record<string, string>
  streamTypeTextures: Record<string, string>
  thumbnailRecents: any[]
  thumbnailLastFont: string
  pendingJobs: any[]
}

let store: Store<StoreShape> | null = null

export function getStore(): Store<StoreShape> {
  if (!store) {
    store = new Store<StoreShape>({
      name: 'app-config',
      defaults: {
        config: getDefaultConfig(),
        watchRules: [],
        ytTitleTemplates: [],
        ytDescriptionTemplates: [],
        ytTagTemplates: [],
        importedPresets: [],
        metaMigrated: false,
        streamTypeTags: {},
        streamTypeTextures: {},
        thumbnailRecents: [],
        thumbnailLastFont: '',
        pendingJobs: [],
      }
    })
  }
  return store
}

export function registerStoreIPC(): void {
  ipcMain.handle('store:getConfig', async () => {
    return getStore().get('config', getDefaultConfig())
  })

  ipcMain.handle('store:setConfig', async (_event, partial: Partial<AppConfig>) => {
    const s = getStore()
    const current = s.get('config', getDefaultConfig())
    const next = { ...current, ...partial }
    s.set('config', next)
    if (partial.streamsDir !== undefined && partial.streamsDir !== current.streamsDir) {
      const { invalidateCloudSyncCache } = await import('./cloudSync')
      invalidateCloudSyncCache()
    }
  })

  ipcMain.handle('store:getWatchRules', async () => {
    return getStore().get('watchRules', [])
  })

  ipcMain.handle('store:setWatchRules', async (_event, rules: any[]) => {
    getStore().set('watchRules', rules)
  })

  ipcMain.handle('store:getYTTitleTemplates', async () => getStore().get('ytTitleTemplates', []))
  ipcMain.handle('store:setYTTitleTemplates', async (_e, v: YTTitleTemplate[]) => getStore().set('ytTitleTemplates', v))
  ipcMain.handle('store:getYTDescriptionTemplates', async () => getStore().get('ytDescriptionTemplates', []))
  ipcMain.handle('store:setYTDescriptionTemplates', async (_e, v: YTDescriptionTemplate[]) => getStore().set('ytDescriptionTemplates', v))
  ipcMain.handle('store:getYTTagTemplates', async () => getStore().get('ytTagTemplates', []))
  ipcMain.handle('store:setYTTagTemplates', async (_e, v: YTTagTemplate[]) => getStore().set('ytTagTemplates', v))

  ipcMain.handle('store:getStreamTypeTags', async () => getStore().get('streamTypeTags', {}))
  ipcMain.handle('store:setStreamTypeTags', async (_e, v: Record<string, string>) => getStore().set('streamTypeTags', v))
  ipcMain.handle('store:getStreamTypeTextures', async () => getStore().get('streamTypeTextures', {}))
  ipcMain.handle('store:setStreamTypeTextures', async (_e, v: Record<string, string>) => getStore().set('streamTypeTextures', v))

  ipcMain.handle('app:setStartupSettings', (_event, startWithWindows: boolean, startMinimized: boolean) => {
    const s = getStore()
    const current = s.get('config', getDefaultConfig())
    s.set('config', { ...current, startWithWindows, startMinimized })
    if (app.isPackaged) {
      // For portable builds, PORTABLE_EXECUTABLE_FILE is the actual .exe on disk (not the temp-extracted copy).
      const exePath = process.env.PORTABLE_EXECUTABLE_FILE ?? process.execPath
      app.setLoginItemSettings({ openAtLogin: startWithWindows, path: exePath })
    }
  })

  ipcMain.handle('app:getStartupSettings', () => {
    const config = getStore().get('config', getDefaultConfig())
    return { startWithWindows: config.startWithWindows, startMinimized: config.startMinimized }
  })

  if (!app.isPackaged) {
    ipcMain.handle('store:resetOnboarding', async () => {
      const s = getStore()
      const current = s.get('config', getDefaultConfig())
      s.set('config', { ...current, streamsDir: '', streamerName: '', streamMode: '' })
    })
  }
}
