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
}

export interface WatchEvent {
  ruleId: string
  ruleName: string
  filePath: string
  action: WatchRule['action']
  destination?: string
  timestamp: number
  status: 'matched' | 'applied' | 'error'
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

export interface AppConfig {
  defaultWatchDir: string
  defaultOutputDir: string
  tempDir: string
  theme: 'dark' | 'light'
  autoStartWatcher: boolean
  streamerName: string
  defaultGame: string
  streamsDir: string
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
