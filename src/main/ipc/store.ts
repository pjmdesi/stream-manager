import { ipcMain } from 'electron'
import Store from 'electron-store'
import { app } from 'electron'
import path from 'path'

export interface YTTitleTemplate { id: string; name: string; template: string }
export interface YTDescriptionTemplate { id: string; name: string; description: string }
export interface YTTagTemplate { id: string; name: string; tags: string[] }
/** Twitch channel tag template — same shape as YTTagTemplate but kept
 *  separate because Twitch's tag rules (alphanumeric only, ≤25 chars, ≤10
 *  tags) are different enough that mixing them with YouTube tag templates
 *  would lead to confusion at use-time. */
export interface TwitchTagTemplate { id: string; name: string; tags: string[] }

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
  claudeApiKey: string
  claudeSystemPrompt: string
  claudeModel: string
  launcherWidgetGroupId: string
  listThumbWidth: number
  defaultBuiltinThumbnailTemplate: string
  useBuiltinThumbnailByDefault: boolean
  /** Default start time (24h "HH:MM", local) pre-filled when scheduling a
   *  YouTube broadcast — both the new-broadcast flow in the MetaModal and the
   *  reschedule modal. */
  defaultBroadcastTime: string
  checkForUpdates: boolean
  skipClipMergeWarning: boolean
  // ── Stream Relay ──────────────────────────────────────────────────────────
  // Localhost RTMP server that forwards OBS/Aitum to YouTube while letting SM
  // orchestrate bind+transition lifecycle. enabled flag gates the whole feature
  // (no child process spawned when false). outboundKey is the channel's
  // persistent default stream key (fetched once via liveStreams.list when YT
  // is connected); activeBroadcastId is the user's manual override of the
  // auto-picked broadcast — empty string means "auto-pick soonest upcoming".
  streamRelayEnabled: boolean
  streamRelayPort: number
  streamRelayInboundKey: string
  streamRelayOutboundKey: string
  /** YouTube liveStreams resource id paired with streamRelayOutboundKey.
   *  Cached so the orchestrator can call liveBroadcasts.bind without a
   *  pre-flight liveStreams.list lookup. Populated by auto-fill, or by the
   *  orchestrator on first use if the user pasted the key manually. */
  streamRelayStreamId: string
  streamRelayActiveBroadcastId: string
  streamRelayActivePickedAt: number
  /** Post-stream Twitch push behavior — see renderer types/index.ts for
   *  full doc. Default 'ask' so users discover the feature via the modal
   *  the first time a SM-orchestrated stream completes. Legacy boolean
   *  configs are migrated to this shape inside store:getConfig. */
  autoUpdateTwitchAfterStream: 'always' | 'ask' | 'never'
  /** Persisted collapse-state of the new streams page's right sidebar.
   *  Only effective when no item is selected; selecting forces the
   *  sidebar open regardless. Default false (open). */
  streamsNewSidebarCollapsed: boolean
  /** Which page the app opens to on launch. Set via the hover-revealed
   *  star icon next to each functional nav item (streams, player,
   *  converter, combine, thumbnails, launcher — integrations + settings
   *  are intentionally excluded). Defaults to 'streams'. */
  startupPage: string
  // ── Sidebar calendar prefs ───────────────────────────────────────────────
  /** First column of the calendar grid + day-of-week header.
   *  'sunday' (default) matches US convention; 'monday' matches
   *  ISO 8601 / most of Europe. */
  calendarFirstDayOfWeek: 'sunday' | 'monday'
  /** Prepend an ISO week-number column to the calendar grid. */
  calendarShowWeekNumbers: boolean
  /** Render days from the prior/next month in the leading + trailing
   *  cells of the 6-row grid. When false, those cells render blank
   *  (the grid stays 6 rows × 7 columns either way). */
  calendarShowAdjacentMonthDays: boolean
  /** Thumbnail editor asset panel sources. `FromSeason` includes assets
   *  from every stream in the same season; `FromTopicGame` narrows that
   *  to only streams sharing the current Topic/Game tag (implies
   *  `FromSeason`). Both off → only the current stream's own assets. */
  thumbnailAssetsFromSeason: boolean
  thumbnailAssetsFromTopicGame: boolean
  /** Set true the first time the user opens the Help modal. Drives a one-time
   *  attention animation on the sidebar "How to use" link until they do. */
  hasOpenedHelp: boolean
  /** When true, suppress the post-Twitch-push modal that offers to
   *  rename the local game tag to Twitch's canonical category name
   *  (Twitch fuzzy-matches the game via search → game_id, so a
   *  user-typed "Black Flag" can come back as "Assassin's Creed IV
   *  Black Flag"). Surfaced + toggleable from Settings → Streams. */
  twitchSkipCategoryRenamePrompt: boolean
  /** YouTube video category id (numeric string, e.g. '20' = Gaming)
   *  to pre-fill `meta.ytCategoryId` for newly-created streams. Empty
   *  string = no default (user must pick per-stream). Surfaced as a
   *  dropdown under Settings → Integrations / YouTube. */
  defaultYouTubeCategoryId: string
  /** Tag-template ids to auto-seed onto newly-created streams. Empty
   *  string = no default. Surfaced as a star toggle next to each
   *  template in the Templates modal. Game-tag links (separate
   *  `gameTagsLinks` store key) take precedence per-game when the
   *  stream's existing YT tags are empty at game-add time; the
   *  default seeds at creation regardless. */
  defaultYouTubeTagsTemplateId: string
  defaultTwitchTagsTemplateId: string
  /** Dev-only: when true, the main process pretends YouTube returned
   *  a quota-exceeded 403 for every API call. Mirrors the runtime
   *  forced flag in ytQuotaState so the toggle in Settings persists
   *  across restarts (same dirty/save flow as every other setting).
   *  Renderer guards visibility to dev builds via import.meta.env.DEV;
   *  the field is harmless in packaged builds because nothing surfaces
   *  it. */
  devForceYouTubeQuotaExceeded: boolean
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
    claudeApiKey: '',
    claudeSystemPrompt: '',
    claudeModel: '',
    launcherWidgetGroupId: '',
    listThumbWidth: 85,
    defaultBuiltinThumbnailTemplate: '',
    useBuiltinThumbnailByDefault: true,
    defaultBroadcastTime: '19:00',
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
    hasOpenedHelp: false,
    twitchSkipCategoryRenamePrompt: false,
    defaultYouTubeCategoryId: '',
    defaultYouTubeTagsTemplateId: '',
    defaultTwitchTagsTemplateId: '',
    devForceYouTubeQuotaExceeded: false,
  }
}

type StoreShape = {
  config: AppConfig
  watchRules: any[]
  ytTitleTemplates: YTTitleTemplate[]
  ytDescriptionTemplates: YTDescriptionTemplate[]
  ytTagTemplates: YTTagTemplate[]
  twitchTagTemplates: TwitchTagTemplate[]
  importedPresets: any[]
  metaMigrated: boolean
  streamTypeTags: Record<string, string>
  streamTypeTextures: Record<string, string>
  thumbnailRecents: any[]
  playerRecents: any[]
  thumbnailLastFont: string
  pendingJobs: any[]
  /** Per-game-tag link to a YT tag template id. When a stream gains its
   *  first game tag and `meta.ytTags` is empty, the linked template's
   *  tags are auto-applied. Linking is per-game (key = game tag name). */
  gameTagsLinks: Record<string, string>
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
        twitchTagTemplates: [],
        importedPresets: [],
        metaMigrated: false,
        streamTypeTags: {},
        streamTypeTextures: {},
        thumbnailRecents: [],
        playerRecents: [],
        thumbnailLastFont: '',
        pendingJobs: [],
        gameTagsLinks: {},
      }
    })
  }
  return store
}

export function registerStoreIPC(): void {
  ipcMain.handle('store:getConfig', async () => {
    // Merge defaults so the returned config always has every key. Older
    // persisted configs predating a setting leave that key `undefined`,
    // which makes the Settings page's dirty-check misfire (toggling a
    // checkbox to its default value `false` would read as different from
    // the absent/`undefined` original and keep Save enabled forever).
    // Spread order: defaults first, stored second → explicit values win.
    const stored = { ...getDefaultConfig(), ...getStore().get('config', {} as AppConfig) }
    // Migrate the legacy boolean shape of autoUpdateTwitchAfterStream to the
    // new tri-state. Users with `true` previously meant "always"; everyone
    // else (default or `false`) gets the new 'ask' default so they discover
    // the modal next time a stream ends.
    const raw = stored.autoUpdateTwitchAfterStream as unknown
    if (raw === true) stored.autoUpdateTwitchAfterStream = 'always'
    else if (raw === false) stored.autoUpdateTwitchAfterStream = 'ask'
    else if (raw !== 'always' && raw !== 'ask' && raw !== 'never') stored.autoUpdateTwitchAfterStream = 'ask'
    return stored
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

  ipcMain.handle('store:getTwitchTagTemplates', async () => getStore().get('twitchTagTemplates', []))
  ipcMain.handle('store:setTwitchTagTemplates', async (_e, v: TwitchTagTemplate[]) => getStore().set('twitchTagTemplates', v))

  ipcMain.handle('store:getGameTagsLinks', async () => getStore().get('gameTagsLinks', {}))
  ipcMain.handle('store:setGameTagsLinks', async (_e, v: Record<string, string>) => getStore().set('gameTagsLinks', v))

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
