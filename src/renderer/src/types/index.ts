export interface AudioTrackInfo {
  index: number
  codec: string
  language?: string
  title?: string
  channels: number
  sampleRate?: number
}

export interface VideoInfo {
  path: string
  duration: number
  width: number
  height: number
  audioTracks: AudioTrackInfo[]
  videoCodec?: string
  fps?: number
  /** Video stream bitrate in bits/sec from ffprobe (may be absent for some containers) */
  videoBitrate?: number
}

export interface FolderNode {
  name: string
  children?: FolderNode[]
}

export interface TemplateVariable {
  key: string
  label: string
  defaultValue?: string
  type: 'text' | 'date' | 'select'
  options?: string[]
}

export interface FolderTemplate {
  id: string
  name: string
  description?: string
  structure: FolderNode[]
  variables: TemplateVariable[]
}

export interface WatchRule {
  id: string
  enabled: boolean
  name?: string
  watchPath: string
  pattern: string
  action: 'move' | 'copy' | 'rename' | 'convert'
  destinationMode?: 'static' | 'auto' | 'next-to-original'
  destination?: string
  autoMatchDate?: boolean
  namePattern?: string
  onlyNewFiles?: boolean
  conversionPresetId?: string
  startImmediately?: boolean
}

export interface WatchEvent {
  id: string
  ruleId: string
  ruleName: string
  filePath: string
  action: WatchRule['action']
  destination?: string
  timestamp: number
  lastChecked?: number
  progress?: number
  status: 'matched' | 'applied' | 'error' | 'waiting'
  error?: string
}

/** Form state for the simplified custom-preset editor. Stored on the preset so
 *  it can be re-opened in form mode. Absent for raw-text or HandBrake-imported
 *  presets (those open in Advanced mode only). */
export interface CustomPresetForm {
  container: 'mp4' | 'mkv' | 'mov' | 'webm'
  video: {
    codec: 'h264' | 'h265' | 'av1' | 'copy'
    encoder: 'cpu' | 'nvenc' | 'qsv' | 'amf'
    /** 0 (fastest, lower quality) → 100 (slowest, highest quality). Drives
     *  both the CRF/CQ value and the speed preset for the chosen encoder. */
    quality: number
  }
  audio: {
    codec: 'aac' | 'mp3' | 'opus' | 'copy' | 'none'
    bitrate: number
    channels: 'original' | 'stereo' | 'mono'
    /** When true, every audio track in the input is preserved (re-encoded
     *  with the same codec/bitrate, or copied if codec='copy'). When false
     *  (default), ffmpeg's default behaviour applies: only the first audio
     *  stream is included. Most useful for OBS multi-track recordings
     *  (game/mic/music). */
    keepAllTracks?: boolean
  }
}

export interface ConversionPreset {
  id: string
  name: string
  description?: string
  ffmpegArgs: string
  outputExtension: string
  isBuiltin: boolean
  source?: 'imported' | 'custom'
  customForm?: CustomPresetForm
}


/** Hook fired by the converter once every job in a group has succeeded. The
 *  main process owns this so it survives renderer reloads and isn't subject to
 *  IPC race conditions. Each variant carries the data needed to do the action. */
export type GroupCompletionHook =
  | {
      type: 'archiveMarkAsArchived'
      streamsDir: string
      /** Calendar date — kept for back-compat with persisted jobs queued
       *  before metaKey was added; the hook handler falls back to this
       *  when metaKey is absent. */
      date: string
      /** Forward-slash relative path of the stream folder under streamsDir.
       *  This is the canonical _meta.json key — using bare `date` was a
       *  bug in nested layouts and same-day-suffix folders, where it would
       *  resurrect a phantom flat entry on archive completion. */
      metaKey?: string
    }

export interface ConversionJob {
  id: string
  inputFile: string
  outputFile: string
  preset: ConversionPreset
  status: 'queued' | 'downloading' | 'running' | 'replacing' | 'paused' | 'done' | 'error' | 'cancelled'
  progress: number
  error?: string
  /** Logical size of the input file in bytes, captured when the job was
   *  first queued/started. Stable for the lifetime of the job (cloud
   *  placeholders return the full size, not the on-disk footprint). */
  inputSize?: number
  /** Optional logical grouping (used by archive — one group per stream folder).
   *  Renderer renders these together with collective controls; main process
   *  fires the completion hook when all jobs in the group succeed. */
  groupId?: string
  /** Display label for the group (e.g. "Archive · 2026-04-26"). Stored on each
   *  job in the group; first-seen wins for the group header. */
  groupLabel?: string
  /** When true, the job's outputFile is a temp file alongside the input that
   *  replaces the input on success (unlink original → rename temp). Used for
   *  in-place archive operations. */
  replaceInput?: boolean
  /** Fired in the main process once every job sharing this groupId has reached
   *  status 'done'. Skipped if any job in the group failed or was cancelled. */
  groupCompletionHook?: GroupCompletionHook
}

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
  defaultBuiltinThumbnailTemplate: string
  useBuiltinThumbnailByDefault: boolean
  defaultBroadcastTime: string
  checkEpisodeIteration: boolean
  audioCacheLimit: number
  /** Max conversions the auto-scheduler runs at once (archive batches).
   *  Manual "Start" on a queued job always bypasses this. Min 1, default 2. */
  maxConcurrentConversions: number
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
  checkForUpdates: boolean
  skipClipMergeWarning: boolean
  // Stream Relay — see main-side AppConfig for full context. Mirror kept here
  // so the renderer's useStore types match what the main process persists.
  streamRelayEnabled: boolean
  streamRelayPort: number
  streamRelayInboundKey: string
  streamRelayOutboundKey: string
  streamRelayStreamId: string
  streamRelayActiveBroadcastId: string
  streamRelayActivePickedAt: number
  /** Post-stream Twitch push behavior:
   *  - 'always' — silently push the next-upcoming item's Twitch details
   *  - 'ask'    — show the post-stream modal (default)
   *  - 'never'  — never push, never ask
   *  Legacy boolean values still persisted in old configs are migrated on
   *  read in the store layer (true → 'always', false → 'ask'). */
  autoUpdateTwitchAfterStream: 'always' | 'ask' | 'never'
  /** Persisted collapse-state of the new streams page's right sidebar.
   *  Only effective when no item is selected. */
  streamsNewSidebarCollapsed: boolean
  /** Which page the app opens to on launch. One of the functional Page
   *  ids (streams / player / converter / combine / thumbnails /
   *  launcher). Defaults to 'streams'. Settings + integrations are
   *  intentionally not user-selectable as a startup page. */
  startupPage: string
  // ── Sidebar calendar prefs ───────────────────────────────────────────────
  /** First column of the calendar grid + day-of-week header. */
  calendarFirstDayOfWeek: 'sunday' | 'monday'
  /** Prepend an ISO week-number column to the calendar grid. */
  calendarShowWeekNumbers: boolean
  /** Render days from the prior/next month in the leading + trailing
   *  cells of the grid. When false, those cells render blank. */
  calendarShowAdjacentMonthDays: boolean
  /** Thumbnail editor asset panel sources. `FromSeason` includes assets
   *  from same-season streams; `FromTopicGame` narrows that to the
   *  current Topic/Game tag (implies `FromSeason`). */
  thumbnailAssetsFromSeason: boolean
  thumbnailAssetsFromTopicGame: boolean
  /** Set true the first time the user opens the Help modal — drives the
   *  one-time attention animation on the sidebar "How to use" link. */
  hasOpenedHelp: boolean
  /** When true, suppress the after-Twitch-push modal that offers to
   *  rename the local game tag to Twitch's canonical category. Set
   *  via the "Don't ask again" button in that same modal or via the
   *  Streams section of Settings. */
  twitchSkipCategoryRenamePrompt: boolean
  /** YouTube video category id (numeric string, e.g. '20' = Gaming)
   *  to pre-fill `meta.ytCategoryId` on newly-created streams. Empty
   *  = no default. Surfaced under Settings → Streams. */
  defaultYouTubeCategoryId: string
  /** Tag-template ids to auto-seed onto newly-created streams. Empty
   *  = no default. Surfaced as star toggles in the Templates modal
   *  (one per platform). */
  defaultYouTubeTagsTemplateId: string
  defaultTwitchTagsTemplateId: string
  /** Dev-only: when true, the main process pretends YouTube returned a
   *  quota-exceeded 403 for every API call. UI visibility guarded by
   *  import.meta.env.DEV in the renderer; field is harmless in
   *  packaged builds because nothing surfaces it. */
  devForceYouTubeQuotaExceeded: boolean
}

export type VideoCategory = 'full' | 'short' | 'clip'

/**
 * Per-track audio settings remembered for a single video file. Index 0 is
 * the source's first audio track (which plays from the video element
 * directly — no extraction needed); higher indices map onto additional
 * tracks that the user has to "Play" before they become audible.
 *
 *   volume: 0–1, omitted means 1
 *   muted/solo: omitted means false
 *
 * Solo is treated as "if any track has solo=true, mute every non-soloed
 * track" — see useVideoPlayer's effective-mute computation.
 */
export interface AudioTrackSetting {
  muted?: boolean
  solo?: boolean
  volume?: number
  /** Tag-color key (see constants/tagColors). Drives the waveform fill +
   *  the swatch dot in the track-control row. Omitted = use the index-
   *  based default rotation. */
  color?: string
}

export interface VideoEntry {
  size: number          // bytes
  mtime: number         // ms epoch — used to invalidate cache
  duration?: number     // seconds — absent for cloud placeholders
  width?: number
  height?: number
  fps?: number
  codec?: string
  category: VideoCategory
  // When this file was produced by the clip exporter, these capture how it was made so the
  // user can re-open the source video with the same clip state via the Session Videos panel.
  clipOf?: string       // source filename (same folder)
  clipState?: ClipState // snapshot of the clip state at export time
}

/** In-progress clip work. Saved per-stream-folder under `StreamMeta.clipDrafts`, keyed by draft id. */
export interface ClipDraft {
  id: string            // "{sourceFilename}-clip-{N}" — stable, used for auto-numbering new drafts
  sourceName: string    // source video filename (same folder)
  state: ClipState
  thumbnailDataUrl?: string
  name?: string         // user-chosen display name (optional; defaults to "Clip N" from id)
  createdAt: number     // ms epoch
  updatedAt: number     // ms epoch
}

export interface StreamMeta {
  date: string
  streamType: string[]
  games: string[]
  comments: string
  archived?: boolean
  videoMap?: Record<string, VideoEntry>  // key = filename (not full path)
  clipDrafts?: Record<string, ClipDraft> // key = draft id
  // YouTube
  ytVideoId?: string
  ytTitle?: string
  /** The baked/resolved description — what's pushed to YouTube and what the
   *  out-of-sync check compares. Kept in sync from `ytDescriptionTemplate`. */
  ytDescription?: string
  /** Raw description body with merge-field tokens ({game}, {season_links}, …),
   *  edited via the sidebar's chip/plain-text editor. Resolved into
   *  `ytDescription` whenever it (or a merge input) changes. Absent on legacy
   *  streams, where `ytDescription` already holds plain resolved text. */
  ytDescriptionTemplate?: string
  ytGameTitle?: string
  ytCatchyTitle?: string
  ytSeason?: string
  ytEpisode?: string
  /** Opt-in flag for the series / season / episode system. `true` =
   *  this stream is part of a series and should appear in series math
   *  (episode numbering, season-links merge field, prev/next nav,
   *  total-episodes count). `false` = standalone one-off; excluded
   *  from series math and the Season/Episode inputs are hidden in the
   *  sidebar UI. `undefined` = legacy default — also treated as series
   *  so existing streams keep working without an explicit migration
   *  pass over every saved file. New streams created via the "New
   *  Episode" button always seed `true`; new streams created via the
   *  regular "New stream" button leave this undefined and the first
   *  game-tag add triggers a one-time auto-detect against the user's
   *  prior streams in the same game. */
  isSeries?: boolean
  /** Transient marker for the one-time "first-game-add" auto-detect.
   *  Set to `true` by NewStreamModal in regular "New stream" mode (NOT
   *  "New Episode" mode — that path sets `isSeries: true` directly at
   *  creation). When the user later adds their first game tag in the
   *  sidebar, an effect checks siblings of that game and bumps
   *  `isSeries` to `true` if a series exists, then clears this flag.
   *  Also cleared the moment the user manually toggles the Series
   *  checkbox. Never read after first detection. */
  seriesAutoDetectPending?: boolean
  ytTags?: string[]
  /** YouTube video category id (numeric string, e.g. `"20"` = Gaming,
   *  `"24"` = Entertainment, `"22"` = People & Blogs). Drives the
   *  `snippet.categoryId` field on `videos.update` during YT push, and
   *  also triggers a category-specific reminder in the post-push
   *  banner for categories that have an additional Studio sub-field
   *  the API can't set (currently just Gaming → "Game"). Seeded from
   *  the linked broadcast's existing categoryId the first time the
   *  user opens the sidebar so the first push doesn't surprise-change
   *  what YouTube auto-derived. */
  ytCategoryId?: string
  /** Snapshot of the per-field values at the last successful YouTube
   *  sync — either a push OR a pull, both represent "local and remote
   *  agreed at this moment." Used by the direction-aware mismatch
   *  indicator: a field with `local !== lastPushed` but `remote ===
   *  lastPushed` means local is ahead (user edited in SM, needs push);
   *  the inverse means remote is ahead (user edited in Studio, needs
   *  pull); both differing means a real conflict. Undefined for legacy
   *  streams or streams never sync'd with the snapshot in place —
   *  those render the neutral "unknown direction" dot instead.
   *
   *  Stored verbatim as we sent / pulled — the mismatch comparator
   *  applies the same trim / whitespace / tag-sort normalization at
   *  compare time as it does for the local-vs-remote check. */
  ytLastPushedTitle?: string
  ytLastPushedDescription?: string
  ytLastPushedTags?: string[]
  ytLastPushedCategoryId?: string
  /** Local override for the broadcast's scheduled time-of-day (HH:MM,
   *  24-hour, user's local timezone). When undefined, the time picker
   *  in the sidebar falls back to the linked broadcast's existing
   *  scheduledStartTime; when set, drives the push (folder.date +
   *  scheduledTime → ISO string). Only meaningful for upcoming
   *  broadcasts — past / VOD broadcasts can't have their schedule
   *  edited via the YT API. */
  scheduledTime?: string
  /** Sync snapshots for the date + time. Same direction-aware mismatch
   *  logic as the title/description/tags/category snapshots: a field
   *  with `local === lastPushed && remote !== lastPushed` flags as
   *  "remote ahead" (Studio edit); the inverse flags as "local ahead."
   *  Date snapshot is YYYY-MM-DD; time snapshot is HH:MM, both in the
   *  user's local timezone (matches how folder.date + scheduledTime
   *  are stored). Written on every successful push AND pull, since
   *  both represent a sync moment. */
  ytLastPushedDate?: string
  ytLastPushedScheduledTime?: string
  /** Id of the YouTube-title template currently bound to this stream.
   *  When set, the streams sidebar re-renders the template against the
   *  live merge fields (game / tagline / season / episode / …) and
   *  pushes the result into `ytTitle` on every change — so editing any
   *  merge field automatically updates the title. Cleared when the user
   *  picks "Clear" in the dropdown OR hand-edits `ytTitle` away from
   *  the templated value. Persists across stream switches and app
   *  restarts; ephemeral selection-state lives in the renderer only. */
  ytTitleTemplateId?: string
  /** Id of the YouTube-tags template currently bound to this stream.
   *  Unlike the title template, tags aren't merge-field substituted —
   *  applying a tags template just writes its values into `ytTags` and
   *  the binding persists as a "this came from template X" marker.
   *  Cleared when the user edits the chips OR picks "Clear" in the
   *  dropdown. */
  ytTagsTemplateId?: string
  /** Staged privacy for the linked YouTube broadcast/video. Edited
   *  locally via the sidebar's Privacy dropdown; pushed alongside the
   *  other fields by the Push to YouTube button. Falls back to the
   *  broadcast's current status when undefined so existing streams
   *  display YouTube's value as a starting point. Snapshot below mirrors
   *  the title/description/tags pattern for direction-aware mismatch. */
  ytPrivacyStatus?: 'public' | 'unlisted' | 'private'
  ytLastPushedPrivacy?: 'public' | 'unlisted' | 'private'
  // Twitch
  twitchTitle?: string
  /** Id of the Titles template currently bound to the Twitch title.
   *  Shares the same template store as `ytTitleTemplateId` (the group
   *  is just "Titles"); only meaningful when the user unchecks "Same
   *  as YouTube title". Same semantics as the YT title binding —
   *  cleared when the user hand-edits the body away from the template. */
  twitchTitleTemplateId?: string
  twitchGameName?: string
  /** Twitch channel tags — Twitch's rules: ≤10 tags, ≤25 chars each,
   *  alphanumeric only. Stored independently from ytTags because Twitch's
   *  format constraints diverge enough from YouTube's that sharing a list
   *  produces mostly-incompatible noise. */
  twitchTags?: string[]
  /** Id of the Twitch-tags template currently bound to this stream.
   *  Same semantics as `ytTagsTemplateId` but for the Twitch tag list. */
  twitchTagsTemplateId?: string
  /** Sync flags — when true, the corresponding Twitch field mirrors the
   *  YouTube field at push time. Default to true (match existing UX where
   *  most users want the same info on both platforms). Tags have no sync
   *  flag because Twitch + YouTube tag formats are too dissimilar. */
  syncTitle?: boolean
  syncGame?: boolean
  /** User-selected "primary" entry in `games[]` — the one promoted to
   *  Twitch's category at push time (Twitch only supports a single
   *  category) AND used as the `{game}` merge field for YouTube title
   *  templates. Separate from array position so the user can keep
   *  `games[]` ordered to match their actual play order during the
   *  stream while still controlling which one is "active" for pushes.
   *  Resolution: if set AND present in `games[]`, use it; otherwise
   *  fall back to `games[0]`. Cleared (effectively) when its referent
   *  is removed from `games[]`. */
  primaryGame?: string
  /** Snapshot of the effective values at the last successful Push to
   *  Twitch. Used by the Push to Twitch button's in-sync check so it
   *  stays disabled when the local meta still matches the last successful
   *  push, even when Twitch normalizes a field (most notably game name,
   *  which goes through a search → game_id round-trip and can come back
   *  as a different canonical category name like "Assassin's Creed Black
   *  Flag" → "Assassin's Creed IV Black Flag"). Compared *in addition to*
   *  the live Twitch channel snapshot, so external changes to Twitch
   *  details (made outside this app) still register as out-of-sync. */
  twitchLastPushedTitle?: string
  twitchLastPushedGame?: string
  twitchLastPushedTags?: string[]
  // Thumbnail
  smThumbnail?: boolean
  smThumbnailTemplate?: string
  preferredThumbnail?: string
  /** sha1 of the thumbnail file that was last uploaded to YouTube. Compared
   *  against the current selected thumbnail's hash to detect whether the
   *  thumbnail has changed since the last push (so the push action can offer
   *  to re-upload it even when no other metadata changed). */
  ytThumbnailPushedHash?: string
  /** Out-of-sync panel "ignore": the divergence fingerprint at ignore time
   *  (see lib/broadcastMismatch.outOfSyncSignature). The stream is hidden from
   *  the out-of-sync list only while the current signature still matches — any
   *  local or remote change produces a new signature and re-surfaces it.
   *  `ignoreOutOfSyncAt` is the ignore timestamp (for display). */
  ignoreOutOfSyncSig?: string
  ignoreOutOfSyncAt?: number
  // Per-file, per-track audio settings (M/S/volume) for the multi-track
  // playback feature. Outer key = video filename (matching videoMap keys);
  // inner key = track index. Omitted fields use sensible defaults; an
  // omitted entry entirely means "use defaults across the board".
  audioSettings?: Record<string, Record<number, AudioTrackSetting>>
}

export interface DetectedStructure {
  suggestedMode: 'folder-per-stream' | 'dump-folder' | ''
  layoutKind: 'flat' | 'nested' | 'dump' | 'unknown'
  nestingDepth: number
  sessionCount: number
  samples: { date: string; relativePath: string; games: string[] }[]
  groupingHints: string[]
  isEmpty: boolean
}

export interface StreamFolder {
  folderName: string
  folderPath: string
  /** Forward-slash relative path from the streams root. Same as folderName for flat layouts. */
  relativePath: string
  date: string
  meta: StreamMeta | null
  hasMeta: boolean
  detectedGames: string[]
  thumbnails: string[]
  /** Parallel to `thumbnails`; false → cloud placeholder, skip <img> render. */
  thumbnailLocalFlags?: boolean[]
  videoCount: number
  videos: string[]
  isMissing?: boolean
}

export interface FileInfo {
  name: string
  path: string
  size: number
  mtime: number
  isDirectory: boolean
  extension: string
}

export interface YTTitleTemplate {
  id: string
  name: string
  template: string   // merge fields: {game}, {episode}, {title}
}

export interface YTDescriptionTemplate {
  id: string
  name: string
  description: string
}

export interface YTTagTemplate {
  id: string
  name: string
  tags: string[]
}

/** Twitch channel tag template. Twitch's rules: ≤10 tags, ≤25 chars each,
 *  alphanumeric only. Kept separate from YTTagTemplate because the format
 *  constraints make YouTube tag lists almost always incompatible with
 *  Twitch — sharing a single template list would surface the rejected
 *  subset everywhere it gets used. */
export interface TwitchTagTemplate {
  id: string
  name: string
  tags: string[]
}

/** @deprecated use YTTitleTemplate / YTDescriptionTemplate / YTTagTemplate */
export interface YouTubeTemplate {
  id: string
  name: string
  titleTemplate: string
  description: string
  tags: string[]
}

export interface LiveBroadcast {
  id: string
  snippet: {
    title: string
    description: string
    scheduledStartTime?: string
    actualStartTime?: string
    gameTitle?: string
    categoryId?: string
    tags?: string[]
  }
  status: {
    lifeCycleStatus: string
    privacyStatus: string
  }
}

export type Page = 'streams' | 'player' | 'templates' | 'rules' | 'converter' | 'combine' | 'integrations' | 'settings' | 'launcher' | 'thumbnails'

// ── Stream Relay ──────────────────────────────────────────────────────────────
// Mirrors the RelayManager's RelayState/RelayStatus/RelayStats in the main
// process. Kept here so the renderer can type its IPC payloads without
// importing main-process modules.

export type RelayState =
  | 'idle'           // not running (feature disabled or not yet started)
  | 'starting'       // child spawned, waiting to bind the port
  | 'listening'      // bound, waiting for OBS/Aitum to connect
  | 'streaming'      // OBS connected, bytes flowing to YouTube
  | 'restarting'     // ffmpeg died, will respawn shortly
  | 'error'          // gave up retrying

export interface RelayStatus {
  state: RelayState
  error?: string
  streamStartedAt?: number
}

export interface RelayStats {
  kbps: number
  durationSec: number
  speed: number  // ffmpeg's speed= value; should hover near 1.0
}

/** Result of computing which broadcast the relay should bind to. Mirrors the
 *  main-side ActivePickResult so the renderer can type IPC payloads without
 *  importing main-process modules. */
export interface ActivePickResult {
  broadcast: LiveBroadcast | null
  isManual: boolean
  manualPickStale: boolean
  /** True while the relay is actively streaming to this broadcast (pinned
   *  by the orchestrator for the session). */
  isLiveSession?: boolean
}

/** Lifecycle stages emitted by the relay orchestrator as it walks a broadcast
 *  through bind → live → grace → complete. Mirrors the main-side enum. */
export type OrchestratorStage =
  | 'idle'
  | 'no-broadcast'
  | 'binding'
  | 'waiting-for-ingest'
  | 'going-live'
  | 'live'
  | 'grace'
  | 'completing'
  | 'completed'
  | 'error'

export interface OrchestratorEvent {
  stage: OrchestratorStage
  broadcastId?: string
  broadcastTitle?: string
  error?: string
  graceRemainingSec?: number
}

// ── Thumbnail Editor ──────────────────────────────────────────────────────────

/** A single drop-shadow pass on a thumbnail layer. Renders as a clone of
 *  the layer placed behind the original with Konva's native
 *  shadowColor/shadowBlur/shadowOffset/shadowOpacity attached — stacks
 *  with sibling passes for heavier / multi-direction shadow effects. */
export interface ThumbnailShadow {
  color: string
  offsetX: number
  offsetY: number
  blur: number
  opacity: number   // 0–100
}

export interface ThumbnailLayer {
  id: string
  name: string
  type: 'image' | 'text' | 'shape'
  visible: boolean
  opacity: number       // 0–100
  x: number
  y: number
  rotation: number
  // Image
  src?: string          // absolute path on disk
  width?: number
  height?: number
  /** Horizontal / vertical flip flags. Width and height are stored as
   *  positive numbers regardless of flip state; rendering applies
   *  scaleX(-1) / scaleY(-1) via Konva with offset compensation so the
   *  layer flips in place around its center. The PropertiesPanel
   *  displays the W/H inputs as negative when the flag is set, as a
   *  visual signal that the layer is flipped — but the stored width
   *  itself never goes negative, so snapping/alignment/aspect math
   *  doesn't need special-casing. */
  flipX?: boolean
  flipY?: boolean
  /** Per-layer aspect-ratio lock. Treated as `true` when undefined so
   *  newly-added image/shape layers start locked to their natural
   *  aspect (matching the convention in every other vector editor).
   *  Drives both the W/H input handlers in PropertiesPanel AND the
   *  Transformer's `boundBoxFunc` enforcement during drag resize.
   *  Shift held during a drag inverts the effective lock state for
   *  that gesture. */
  aspectLocked?: boolean
  // Text
  text?: string
  fontFamily?: string
  fontSize?: number
  fontStyle?: string    // 'normal' | 'bold' | 'italic' | 'bold italic'
  align?: 'left' | 'center' | 'right'
  // Shape
  shapeType?: 'rect' | 'ellipse' | 'triangle'
  cornerRadius?: number
  // Shared (text + shape)
  fill?: string
  stroke?: string
  strokeWidth?: number
  // Drop shadow (all layer types). Legacy single-shadow fields below are
  // still read for backwards compat (one-time migrated into `shadows[0]`
  // on first edit) but no longer written. New thumbnails use the
  // `shadows` array. Disabled when `shadowEnabled` is false/undefined
  // AND `shadows` is empty.
  /** @deprecated Migrated into `shadows[0]` on load. Kept on disk so old
   *  files round-trip during the migration window. */
  shadowEnabled?: boolean
  /** @deprecated */ shadowColor?: string
  /** @deprecated */ shadowOffsetX?: number
  /** @deprecated */ shadowOffsetY?: number
  /** @deprecated */ shadowBlur?: number
  /** @deprecated */ shadowOpacity?: number    // 0–100
  /** Ordered back-to-front. Each entry renders as its own ghost clone of
   *  the layer behind the original, so the shadows visually stack
   *  (multiple soft halos / heavier drop). Combine with the outline
   *  effect below for spread — the shadow attaches to the dilated
   *  silhouette, giving a wider footprint than offset+blur alone can. */
  shadows?: ThumbnailShadow[]
  // Outline (all layer types). For text + shape, implemented via Konva's
  // native stroke; for image, via a custom alpha-dilation filter. When
  // enabled together with shadows, the shadows radiate from the dilated
  // silhouette → effective spread shadow.
  outlineEnabled?: boolean
  outlineColor?: string
  outlineWidth?: number     // pixels (in layer-local space)
  // Konva filters (image layers only). Master toggle so all slider values
  // persist when the user temporarily disables effects without losing them.
  filtersEnabled?: boolean
  filterBrightness?: number     // -1..1
  filterContrast?: number       // -100..100
  filterBlur?: number           // 0..40 (px radius)
  filterHue?: number            // -180..180 (HSL filter)
  filterSaturation?: number     // -2..10 (HSL filter)
  filterLuminance?: number      // -2..2 (HSL filter)
  filterPixelate?: number       // 0..100 (off when <=1)
  filterPosterize?: number      // 0..1 (off when 0)
  filterEnhance?: number        // -1..1
  filterThreshold?: number      // 0..1 (off when 0)
  filterGrayscale?: boolean
  filterSepia?: boolean
  filterInvert?: boolean
  filterEmboss?: boolean
}

export interface ThumbnailCanvasFile {
  version: 1
  templateId?: string
  updatedAt: number
  layers: ThumbnailLayer[]
}

export interface ThumbnailTemplate {
  id: string            // filename without extension
  name: string
  createdAt: number
  updatedAt: number
  layers: ThumbnailLayer[]
}

export interface ThumbnailRecentEntry {
  folderPath: string
  date: string
  title?: string
  templateId?: string
  updatedAt: number
}

export interface PlayerRecentEntry {
  filePath: string
  fileName: string
  streamTitle?: string
  streamDate?: string
  openedAt: number
}

export interface LauncherApp {
  id: string
  name: string
  path: string
}

export interface LauncherGroup {
  id: string
  name: string
  icon?: string  // kebab-case lucide icon name, e.g. "rocket"
  apps: LauncherApp[]
}

// ── Clip mode ─────────────────────────────────────────────────────────────────

export type CropAspect = 'off' | 'original' | '16:9' | '1:1' | '9:16'
// Retained for back-compat; prefer CropAspect
export type CropMode = CropAspect

export interface BleepRegion {
  id: string
  start: number   // seconds
  end: number     // seconds
}

export interface ClipRegion {
  id: string
  inPoint: number   // seconds
  outPoint: number  // seconds
  // Per-region 9:16 crop overrides. Undefined = fall back to defaults (0.5, 0.5, 1.0).
  cropX?: number    // 0–1; horizontal centre (0 = left, 1 = right)
  cropY?: number    // 0–1; vertical centre (only meaningful when cropScale < 1)
  cropScale?: number // 0.2–1.0; 1.0 = crop fills full video height, smaller = zoomed in
}

export interface ClipState {
  clipRegions: ClipRegion[]   // sorted by inPoint; no overlaps
  cropAspect: CropAspect
  cropX: number               // 0–1; horizontal center of the 9:16 crop region (0 = left, 0.5 = centre, 1 = right)
  bleepRegions: BleepRegion[]
  bleepVolume: number         // 0–1; shared across all bleep markers
}

export interface TimelineViewport {
  viewStart: number   // seconds
  viewEnd: number     // seconds
}
