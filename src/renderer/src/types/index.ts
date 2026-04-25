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

export interface ConversionPreset {
  id: string
  name: string
  description?: string
  ffmpegArgs: string
  outputExtension: string
  isBuiltin: boolean
}


export interface ConversionJob {
  id: string
  inputFile: string
  outputFile: string
  preset: ConversionPreset
  status: 'queued' | 'running' | 'paused' | 'done' | 'error' | 'cancelled'
  progress: number
  error?: string
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

export interface StreamFolder {
  folderName: string
  folderPath: string
  date: string
  meta: StreamMeta | null
  hasMeta: boolean
  detectedGames: string[]
  thumbnails: string[]
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
