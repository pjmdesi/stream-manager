import { ipcMain, BrowserWindow } from 'electron'
import Store from 'electron-store'
import { app } from 'electron'
import path from 'path'
import { canEncryptSecrets, encryptSecret, isEncryptedSecret, readSecretOrEmpty } from '../services/secretStorage'

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
  /** Preset assigned to new files added to the Converter page. */
  defaultConversionPresetId: string
  defaultThumbnailTemplate: string
  checkEpisodeIteration: boolean
  audioCacheLimit: number
  /** Max conversions the scheduler runs at once — enforced on EVERY start
   *  path since CONV-2 (manual starts wait for a slot too). Min 1,
   *  default 2. */
  maxConcurrentConversions: number
  /** UI zoom as a percent (100 = normal). Single source of truth for the
   *  app's zoom (APP-12): the Ctrl+= / Ctrl+- / Ctrl+0 shortcuts write it,
   *  the Settings Appearance field edits it, and did-finish-load re-applies
   *  it via setZoomFactor. */
  uiZoomPercent: number
  defaultBleepVolume: number
  youtubeClientId: string
  youtubeClientSecret: string
  twitchClientId: string
  twitchClientSecret: string
  startWithWindows: boolean
  startMinimized: boolean
  /** Sub-option of startMinimized: hide to tray only when the launch came
   *  from the Windows login item (detected via the --from-autostart arg the
   *  login-item registration passes); manual launches open the window. */
  startMinimizedOnlyAtStartup: boolean
  disableAnimations: boolean
  slowAnimations: boolean
  autoDeletePartialOnCancel: boolean
  claudeApiKey: string
  claudeSystemPrompt: string
  claudeModel: string
  /** AI suggestions dismissed with Esc are remembered per stream item +
   *  field and sent to later requests so the model avoids repeats. */
  aiPreventRepeatSuggestions: boolean
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
    defaultConversionPresetId: '',
    defaultThumbnailTemplate: '',
    checkEpisodeIteration: true,
    audioCacheLimit: 1_073_741_824,  // 1 GB
    maxConcurrentConversions: 2,
    uiZoomPercent: 100,
    defaultBleepVolume: 0.25,
    youtubeClientId: '',
    youtubeClientSecret: '',
    twitchClientId: '',
    twitchClientSecret: '',
    startWithWindows: false,
    startMinimized: false,
    startMinimizedOnlyAtStartup: false,
    disableAnimations: false,
    slowAnimations: false,
    autoDeletePartialOnCancel: false,
    claudeApiKey: '',
    claudeSystemPrompt: '',
    claudeModel: '',
    aiPreventRepeatSuggestions: true,
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
  /** Recently-used thumbnail-editor swatches, newest first: full hex
   *  strings for solids (alpha allowed), { gradient } objects for
   *  gradient swatches. */
  thumbnailColorRecents: (string | { gradient: { stops: { color: string; pos: number }[]; angle: number; colorSpace: 'oklch' | 'srgb' } })[]
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
        thumbnailColorRecents: [],
        pendingJobs: [],
        gameTagsLinks: {},
      }
    })
  }
  return store
}

/** Merge a partial into the persisted config and broadcast a
 *  'config:changed' signal to every renderer (StoreContext re-fetches on
 *  it). ALL config writes must go through here — the IPC handler below, the
 *  tray toggles, the relay's bookkeeping. Writes that skip the broadcast
 *  leave renderer state stale until relaunch, which is how "convert to
 *  folder-per-stream" kept behaving as dump mode and a later Settings save
 *  reverted it. The event carries no payload on purpose: receivers re-invoke
 *  store:getConfig so the defaults-merge + legacy migrations there stay the
 *  single source of truth for the config's shape. */
// ── UI zoom (APP-12) ────────────────────────────────────────────────────────
// config.uiZoomPercent is the app's single zoom authority, applied through
// setZoomFactor (percent in, percent out — no log-level float drift).
// Electron's own per-origin zoom memory is deliberately overridden on every
// load so the config stays the truth.
export const UI_ZOOM_MIN = 33
export const UI_ZOOM_MAX = 400
export function applyUiZoomToWindows(percent: number, announce: boolean): void {
  const clamped = Math.max(UI_ZOOM_MIN, Math.min(UI_ZOOM_MAX, Math.round(percent)))
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    // Announce BEFORE applying: changing the zoom factor relayouts the
    // whole page (expensive on the streams list), and the overlay's
    // render would otherwise queue behind that jank — the zoom looked
    // instant while the number lagged it by up to a second.
    if (announce) win.webContents.send('app:zoomChanged', { percent: clamped })
    win.webContents.setZoomFactor(clamped / 100)
  }
}

// The config fields holding secrets — encrypted at rest via safeStorage
// (see services/secretStorage). Only these fields are touched: the rest of
// app-config stays readable, hand-editable JSON.
const SECRET_CONFIG_KEYS = ['youtubeClientSecret', 'twitchClientSecret', 'claudeApiKey'] as const

export function setConfigPartial(partial: Partial<AppConfig>): void {
  const s = getStore()
  const current = s.get('config', getDefaultConfig())
  // Encrypt incoming secret values at the write boundary. encryptSecret
  // passes through empty, already-encrypted, and encryption-unavailable
  // values, so this is safe on every write path.
  const secured = { ...partial }
  for (const key of SECRET_CONFIG_KEYS) {
    if (typeof secured[key] === 'string') secured[key] = encryptSecret(secured[key] as string)
  }
  s.set('config', { ...current, ...secured })
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('config:changed')
  }
}

/** The config with defaults merged, legacy shapes migrated, and secret
 *  fields DECRYPTED — the single read path for anything that consumes a
 *  secret (IPC to the renderer, getCreds in the youtube/twitch/claude/relay
 *  modules). A raw getStore().get('config') keeps working for every
 *  non-secret field but returns ciphertext for these three. */
export function getConfigDecrypted(): AppConfig {
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
  for (const key of SECRET_CONFIG_KEYS) {
    stored[key] = readSecretOrEmpty(stored[key], `config.${key}`)
  }
  return stored
}

/** One-time (idempotent) migration of plaintext config secrets to
 *  encrypted-at-rest. Called after app.ready — safeStorage needs it — and
 *  cheap enough to run every launch: it only writes when a non-empty
 *  plaintext secret exists AND encryption is actually available. */
export function migrateConfigSecrets(): void {
  if (!canEncryptSecrets()) return
  const current = getStore().get('config', getDefaultConfig())
  const partial: Partial<AppConfig> = {}
  for (const key of SECRET_CONFIG_KEYS) {
    const v = current[key]
    if (typeof v === 'string' && v && !isEncryptedSecret(v)) partial[key] = v
  }
  if (Object.keys(partial).length > 0) setConfigPartial(partial)
}

export function registerStoreIPC(): void {
  ipcMain.handle('store:getConfig', async () => {
    // Defaults-merge + legacy migrations + secret decryption all live in
    // getConfigDecrypted so main-side consumers and the renderer see the
    // exact same shape.
    return getConfigDecrypted()
  })

  ipcMain.handle('store:setConfig', async (_event, partial: Partial<AppConfig>) => {
    const prevStreamsDir = getStore().get('config', getDefaultConfig()).streamsDir
    setConfigPartial(partial)
    if (partial.streamsDir !== undefined && partial.streamsDir !== prevStreamsDir) {
      const { invalidateCloudSyncCache } = await import('./cloudSync')
      invalidateCloudSyncCache()
    }
    // A saved zoom edit applies immediately (with the overlay as feedback).
    if (partial.uiZoomPercent !== undefined) applyUiZoomToWindows(partial.uiZoomPercent, true)
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
      // --from-autostart marks login-item launches so "start minimized only
      // at startup" can tell them apart from manual launches (APP-9).
      app.setLoginItemSettings({ openAtLogin: startWithWindows, path: exePath, args: ['--from-autostart'] })
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
