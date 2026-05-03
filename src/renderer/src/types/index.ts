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
  | { type: 'archiveMarkAsArchived'; streamsDir: string; date: string }

export interface ConversionJob {
  id: string
  inputFile: string
  outputFile: string
  preset: ConversionPreset
  status: 'queued' | 'downloading' | 'running' | 'replacing' | 'paused' | 'done' | 'error' | 'cancelled'
  progress: number
  error?: string
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
  defaultThumbnailTemplate: string
  defaultBuiltinThumbnailTemplate: string
  useBuiltinThumbnailByDefault: boolean
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
  clipDurationThreshold: number  // seconds; videos ≤ this length classified as clips
  claudeApiKey: string
  claudeSystemPrompt: string
  launcherWidgetGroupId: string
  listThumbWidth: number
  checkForUpdates: boolean
}

export type VideoCategory = 'full' | 'short' | 'clip'

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
  ytDescription?: string
  ytGameTitle?: string
  ytCatchyTitle?: string
  ytSeason?: string
  ytEpisode?: string
  ytTags?: string[]
  // Twitch
  twitchTitle?: string
  twitchGameName?: string
  // Sync flag: when true, twitchTitle mirrors ytTitle
  syncTitle?: boolean
  // Thumbnail
  smThumbnail?: boolean
  smThumbnailTemplate?: string
  preferredThumbnail?: string
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

// ── Thumbnail Editor ──────────────────────────────────────────────────────────

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
  // Drop shadow (all layer types). Disabled when shadowEnabled is false/undefined.
  shadowEnabled?: boolean
  shadowColor?: string
  shadowOffsetX?: number
  shadowOffsetY?: number
  shadowBlur?: number
  shadowOpacity?: number    // 0–100
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
