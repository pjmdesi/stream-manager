import { ipcMain } from 'electron'
import Store from 'electron-store'
import { app } from 'electron'
import path from 'path'

export interface YTTitleTemplate { id: string; name: string; template: string }
export interface YTDescriptionTemplate { id: string; name: string; description: string }
export interface YTTagTemplate { id: string; name: string; tags: string[] }

export interface AppConfig {
  defaultWatchDir: string
  defaultOutputDir: string
  presetsDir: string
  tempDir: string
  theme: 'dark' | 'light'
  autoStartWatcher: boolean
  streamerName: string
  defaultGame: string
  streamsDir: string
  archivePresetId: string
  defaultThumbnailTemplate: string
  checkEpisodeIteration: boolean
  audioCacheLimit: number
  youtubeClientId: string
  youtubeClientSecret: string
  twitchClientId: string
  twitchClientSecret: string
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
    defaultGame: '',
    streamsDir: '',
    archivePresetId: '',
    defaultThumbnailTemplate: '',
    checkEpisodeIteration: true,
    audioCacheLimit: 1_073_741_824,  // 1 GB
    youtubeClientId: '',
    youtubeClientSecret: '',
    twitchClientId: '',
    twitchClientSecret: '',
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
    s.set('config', { ...current, ...partial })
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
}
