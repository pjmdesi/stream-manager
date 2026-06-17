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
  defaultBuiltinThumbnailTemplate: '',
  useBuiltinThumbnailByDefault: true,
  defaultBroadcastTime: '19:00',
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
  claudeApiKey: '',
  claudeSystemPrompt: '',
  launcherWidgetGroupId: '',
  listThumbWidth: 85,
  checkForUpdates: true,
  skipClipMergeWarning: false,
  streamRelayEnabled: false,
  streamRelayPort: 1935,
  streamRelayInboundKey: 'live',
  streamRelayOutboundKey: '',
  streamRelayStreamId: '',
  streamRelayActiveBroadcastId: '',
  streamRelayActivePickedAt: 0,
  autoUpdateTwitchAfterStream: 'ask',
  streamsNewSidebarCollapsed: false,
  startupPage: 'streams',
  calendarFirstDayOfWeek: 'sunday',
  calendarShowWeekNumbers: false,
  calendarShowAdjacentMonthDays: true,
  thumbnailAssetsFromSeason: true,
  thumbnailAssetsFromTopicGame: false,
  twitchSkipCategoryRenamePrompt: false,
  defaultYouTubeCategoryId: '',
  defaultYouTubeTagsTemplateId: '',
  defaultTwitchTagsTemplateId: '',
  devForceYouTubeQuotaExceeded: false,
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
