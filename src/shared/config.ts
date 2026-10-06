/** The app's persisted settings: the one declaration of the shape and of
 *  its defaults, shared by the main process (which stores the config) and
 *  the renderer (which edits it). Pure values only: this file runs in both
 *  processes, so no Electron, Node or DOM imports. The two defaults that
 *  need `app.getPath` are overlaid in main's `ipc/store.ts`.
 *
 *  Adding a setting: one key here, one default here, a field in
 *  SettingsPage, and a reader somewhere; a key with no reader is removed
 *  (the config-key pass of APP-41). */

export type StreamMode = 'folder-per-stream' | 'dump-folder' | ''

export interface AppConfig {
  /** Pre-fills the watch folder when a new auto-rule is added. */
  defaultWatchDir: string
  theme: 'dark' | 'light'
  autoStartWatcher: boolean
  streamerName: string
  streamsDir: string
  streamMode: StreamMode
  archivePresetId: string
  clipPresetId: string
  /** Preset assigned to new files added to the Converter page. */
  defaultConversionPresetId: string
  /** Default start time (24h "HH:MM", local) pre-filled when scheduling a
   *  YouTube broadcast, in the new-broadcast flow and the reschedule modal. */
  defaultBroadcastTime: string
  /** "Number episodes automatically": when a stream joins a series, its
   *  episode number is filled in as the next one for that topic and season.
   *  Off leaves the number empty for the user to type; season carry-over is
   *  unaffected. */
  checkEpisodeIteration: boolean
  /** Cache limit in bytes. Named for the audio cache it first governed;
   *  since APP-42 it is enforced across every app cache. */
  audioCacheLimit: number
  /** Max conversions the scheduler runs at once, enforced on EVERY start
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
  /** When true (default), AI suggestions the user dismissed with Esc are
   *  remembered per stream item + field and sent to later generation
   *  requests so the model avoids repeating them. */
  aiPreventRepeatSuggestions: boolean
  launcherWidgetGroupId: string
  listThumbWidth: number
  checkForUpdates: boolean
  skipClipMergeWarning: boolean
  /** Default audio track names by track number (PLR-23), applied to
   *  tracks a recording leaves unnamed (MP4 cannot store track names).
   *  Six slots to match OBS; blank means "Track N". */
  defaultAudioTrackNames: string[]
  // ── Stream Relay ──────────────────────────────────────────────────────────
  // Localhost RTMP server that forwards OBS/Aitum to YouTube while letting SM
  // orchestrate bind+transition lifecycle. enabled flag gates the whole feature
  // (no child process spawned when false). outboundKey is the channel's
  // persistent default stream key (fetched once via liveStreams.list when YT
  // is connected); activeBroadcastId is the user's manual override of the
  // auto-picked broadcast, where empty string means "auto-pick soonest upcoming".
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
  /** Post-stream Twitch push behavior:
   *  - 'always': silently push the next-upcoming item's Twitch details
   *  - 'ask': show the post-stream modal (default, so users discover the
   *    feature the first time an SM-orchestrated stream completes)
   *  - 'never': never push, never ask
   *  Legacy boolean values still persisted in old configs are migrated on
   *  read in the store layer (true to 'always', false to 'ask'). */
  autoUpdateTwitchAfterStream: 'always' | 'ask' | 'never'
  /** Persisted collapse-state of the streams page's right sidebar. Only
   *  effective when no item is selected; selecting forces the sidebar open
   *  regardless. Default false (open). */
  streamsNewSidebarCollapsed: boolean
  /** Which page the app opens to on launch. Set via the hover-revealed
   *  star icon next to each functional nav item (streams, player,
   *  converter, combine, thumbnails, launcher; integrations and settings
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
   *  `FromSeason`). Both off: only the current stream's own assets. */
  thumbnailAssetsFromSeason: boolean
  thumbnailAssetsFromTopicGame: boolean
  /** Set true the first time the user opens the Help modal. Drives a one-time
   *  attention animation on the sidebar "How to use" link until they do. */
  hasOpenedHelp: boolean
  /** When true, suppress the post-Twitch-push modal that offers to
   *  rename the local game tag to Twitch's canonical category name
   *  (Twitch fuzzy-matches the game via search to a game_id, so a
   *  user-typed "Black Flag" can come back as "Assassin's Creed IV
   *  Black Flag"). Set via "Don't ask again" in that modal or the
   *  Streams section of Settings. */
  twitchSkipCategoryRenamePrompt: boolean
  /** YouTube video category id (numeric string, e.g. '20' = Gaming)
   *  to pre-fill `meta.ytCategoryId` for newly-created streams. Empty
   *  string = no default (user must pick per-stream). Surfaced under
   *  Settings, Streams. */
  defaultYouTubeCategoryId: string
  /** Tag-template ids to auto-seed onto newly-created streams. Empty
   *  string = no default. Surfaced as a star toggle next to each
   *  template in the Templates modal (one per platform). Game-tag links
   *  (separate `gameTagsLinks` store key) take precedence per-game when
   *  the stream's existing YT tags are empty at game-add time; the
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

/** Defaults for every key. `defaultWatchDir` is '' here and the user's
 *  Videos folder once main overlays it. */
export const CONFIG_DEFAULTS: AppConfig = {
  defaultWatchDir: '',
  theme: 'dark',
  autoStartWatcher: false,
  streamerName: '',
  streamsDir: '',
  streamMode: '',
  archivePresetId: '',
  clipPresetId: '',
  defaultConversionPresetId: '',
  defaultBroadcastTime: '19:00',
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
  checkForUpdates: true,
  skipClipMergeWarning: false,
  defaultAudioTrackNames: [],
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
