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
  watchPath: string
  pattern: string
  action: 'move' | 'copy' | 'rename'
  destinationMode?: 'static' | 'auto'
  destination?: string
  autoMatchDate?: boolean
  namePattern?: string
  onlyNewFiles?: boolean
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
  defaultGame: string
  streamsDir: string
  streamMode: StreamMode
  archivePresetId: string
  defaultThumbnailTemplate: string
  checkEpisodeIteration: boolean
  audioCacheLimit: number
  youtubeClientId: string
  youtubeClientSecret: string
  twitchClientId: string
  twitchClientSecret: string
}

export interface StreamMeta {
  date: string
  streamType: 'games' | 'other'
  games: string[]
  comments: string
  archived?: boolean
  // YouTube
  ytTitle?: string
  ytDescription?: string
  ytGameTitle?: string
  ytTags?: string[]
  // Twitch
  twitchTitle?: string
  twitchGameName?: string
  // Sync flag: when true, twitchTitle mirrors ytTitle
  syncTitle?: boolean
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

export type Page = 'streams' | 'player' | 'templates' | 'rules' | 'converter' | 'combine' | 'youtube' | 'settings'

// ── Clip mode ─────────────────────────────────────────────────────────────────

export type CropMode = 'none' | '9:16'

export interface BleepRegion {
  id: string
  start: number   // seconds
  end: number     // seconds
}

export interface ClipState {
  inPoint: number | null    // seconds; null = not set
  outPoint: number | null   // seconds; null = not set
  cropMode: CropMode
  cropX: number             // 0–1; horizontal center of the 9:16 crop region (0 = left, 0.5 = centre, 1 = right)
  bleepRegions: BleepRegion[]
}

export interface TimelineViewport {
  viewStart: number   // seconds
  viewEnd: number     // seconds
}
