import { ipcMain, BrowserWindow } from 'electron'
import Store from 'electron-store'
import { app } from 'electron'
import { canEncryptSecrets, encryptSecret, isEncryptedSecret, readSecretOrEmpty } from '../services/secretStorage'
import { broadcast } from '../services/broadcast'
import { CONFIG_DEFAULTS, type AppConfig, type StreamMode } from '../../shared/config'

export interface YTTitleTemplate { id: string; name: string; template: string }
export interface YTDescriptionTemplate { id: string; name: string; description: string }
export interface YTTagTemplate { id: string; name: string; tags: string[] }
/** Twitch channel tag template — same shape as YTTagTemplate but kept
 *  separate because Twitch's tag rules (alphanumeric only, ≤25 chars, ≤10
 *  tags) are different enough that mixing them with YouTube tag templates
 *  would lead to confusion at use-time. */
export interface TwitchTagTemplate { id: string; name: string; tags: string[] }

export type { AppConfig, StreamMode }

/** The shared defaults plus the one that needs Electron: a fresh install's
 *  default watch folder is the user's Videos folder. */
function getDefaultConfig(): AppConfig {
  return { ...CONFIG_DEFAULTS, defaultWatchDir: app.getPath('videos') }
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
  broadcast('config:changed')
}

/** The config with defaults merged, legacy shapes migrated, and secret
 *  fields DECRYPTED — the single read path for anything that consumes a
 *  secret (IPC to the renderer, getCreds in the youtube/twitch/claude/relay
 *  modules). A raw getStore().get('config') keeps working for every
 *  non-secret field but returns ciphertext for these three. */
/** The config as main-side code reads it: every key present (defaults
 *  merged under the stored values) and legacy shapes migrated, with secret
 *  fields left as stored (encrypted). The one read path for main; a private
 *  `getStore().get('config') as {...}` cast skips the defaults merge and
 *  makes each site invent its own fallback for a key an older config file
 *  lacks (APP-49). Code that needs a secret's plaintext uses
 *  `getConfigDecrypted`. */
export function getConfig(): AppConfig {
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
}

/** `getConfig` with the secret fields decrypted, for the integrations. */
export function getConfigDecrypted(): AppConfig {
  const config = getConfig()
  for (const key of SECRET_CONFIG_KEYS) {
    config[key] = readSecretOrEmpty(config[key], `config.${key}`)
  }
  return config
}

/** The configured streams directory, '' before onboarding. */
export function getStreamsDir(): string {
  return getConfig().streamsDir || ''
}

/** The configured stream layout, '' before onboarding. */
export function getStreamMode(): StreamMode {
  return getConfig().streamMode || ''
}

/** Register or clear the Windows login item for "Start with Windows". One
 *  place for the exe path rule (portable builds: PORTABLE_EXECUTABLE_FILE
 *  is the real .exe, not the temp-extracted copy) and the --from-autostart
 *  marker that lets "start minimized only at startup" tell login-item
 *  launches from manual ones (APP-9). Packaged builds only: a dev build
 *  would register the dev Electron exe with Windows. Called from the
 *  Settings save, the tray toggle, and the launch-time self-heal. */
export function applyLoginItem(startWithWindows: boolean): void {
  if (!app.isPackaged) return
  const exePath = process.env.PORTABLE_EXECUTABLE_FILE ?? process.execPath
  app.setLoginItemSettings({ openAtLogin: startWithWindows, path: exePath, args: ['--from-autostart'] })
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

  // The Settings page saves startWithWindows and startMinimized through
  // store:setConfig like every other key; this call only registers the
  // login item. (It used to write the config a second time, directly,
  // skipping the config:changed broadcast.)
  ipcMain.handle('app:setStartupSettings', (_event, startWithWindows: boolean) => {
    applyLoginItem(startWithWindows)
  })

  ipcMain.handle('app:getStartupSettings', () => {
    const config = getConfig()
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
