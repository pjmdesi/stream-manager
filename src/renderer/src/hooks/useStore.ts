import { useState, useEffect, useCallback, createContext, useContext } from 'react'
import { AppConfig } from '../types'

const defaultConfig: AppConfig = {
  defaultWatchDir: '',
  defaultOutputDir: '',
  presetsDir: '',
  tempDir: '',
  theme: 'dark',
  autoStartWatcher: false,
  streamerName: '',
  streamsDir: '',
  streamMode: '' as import('../types').StreamMode,
  archivePresetId: '',
  clipPresetId: '',
  defaultBleepVolume: 0.25,
  defaultThumbnailTemplate: '',
  checkEpisodeIteration: true,
  audioCacheLimit: 1_073_741_824,
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
}

interface StoreContextValue {
  config: AppConfig
  loading: boolean
  updateConfig: (partial: Partial<AppConfig>) => Promise<void>
  refreshConfig: () => Promise<void>
}

export const StoreContext = createContext<StoreContextValue>({
  config: defaultConfig,
  loading: true,
  updateConfig: async () => {},
  refreshConfig: async () => {},
})

export function useStore() {
  return useContext(StoreContext)
}

export { defaultConfig }
