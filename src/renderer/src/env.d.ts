/// <reference types="vite/client" />

import type {
  VideoInfo,
  ConversionPreset,
  ConversionJob,
  FolderTemplate,
  WatchRule,
  WatchEvent,
  AppConfig,
  FileInfo,
  StreamMeta,
  StreamFolder,
  YTTitleTemplate,
  YTDescriptionTemplate,
  YTTagTemplate,
  LiveBroadcast,
} from './types'

declare global {
  interface Window {
    api: {
      // ── Video ────────────────────────────────────────────────────────────────
      probeFile(filePath: string): Promise<VideoInfo>
      extractAudioTracks(filePath: string, trackIndices?: number[]): Promise<string[]>
      cancelExtractAudioTracks(): Promise<void>
      cleanupTracks(paths: string[]): Promise<void>
      getWaveform(filePath: string): Promise<Array<{ min: number; max: number }>>
      clearAudioCache(): Promise<void>
      getAudioCacheSize(): Promise<number>
      getThumbnailCache(filePath: string): Promise<{ timecodes: number[]; frameUrls: string[] } | null>
      saveThumbnailFrame(filePath: string, index: number, dataUrl: string): Promise<void>
      finalizeThumbnailCache(filePath: string, timecodes: number[]): Promise<void>
      onExtractProgress(cb: (data: { trackIndex: number; percent: number }) => void): () => void

      // ── Files ────────────────────────────────────────────────────────────────
      openFileDialog(options?: Electron.OpenDialogOptions): Promise<string[]>
      openDirectoryDialog(): Promise<string | null>
      moveFile(src: string, dest: string): Promise<void>
      copyFile(src: string, dest: string): Promise<void>
      renameFile(filePath: string, newName: string): Promise<string>
      deleteFile(filePath: string): Promise<void>
      listFiles(dir: string): Promise<FileInfo[]>
      listFileNames(dirPath: string): Promise<{ name: string; isDirectory: boolean }[]>
      fileExists(filePath: string): Promise<boolean>
      mkdir(dirPath: string): Promise<void>
      openUrl(url: string): Promise<void>
      openInExplorer(filePath: string): Promise<void>
      readFile(filePath: string): Promise<string>
      saveScreenshot(destPath: string, base64Data: string): Promise<string>
      checkLocalFiles(filePaths: string[]): Promise<boolean[]>

      // ── File Watcher ─────────────────────────────────────────────────────────
      startWatcher(rules: WatchRule[]): Promise<void>
      stopWatcher(): Promise<void>
      onFileMatched(cb: (event: WatchEvent) => void): () => void

      // ── Templates ────────────────────────────────────────────────────────────
      getTemplates(): Promise<FolderTemplate[]>
      saveTemplate(template: FolderTemplate): Promise<void>
      deleteTemplate(id: string): Promise<void>
      applyTemplate(templateId: string, basePath: string, variables: Record<string, string>): Promise<void>

      // ── Converter ────────────────────────────────────────────────────────────
      getBuiltinPresets(): Promise<ConversionPreset[]>
      importPreset(filePath: string): Promise<ConversionPreset>
      getImportedPresets(): Promise<ConversionPreset[]>
      deleteImportedPreset(id: string): Promise<void>
      renameImportedPreset(id: string, newName: string): Promise<void>
      addToQueue(job: ConversionJob): Promise<string>
      cancelJob(jobId: string): Promise<void>
      pauseJob(jobId: string): Promise<void>
      resumeJob(jobId: string): Promise<void>
      getJobs(): Promise<ConversionJob[]>
      onJobProgress(cb: (data: { jobId: string; percent: number; status?: string }) => void): () => void
      onJobComplete(cb: (data: { jobId: string; outputPath: string }) => void): () => void
      onJobError(cb: (data: { jobId: string; error: string }) => void): () => void

      // ── Store ────────────────────────────────────────────────────────────────
      getConfig(): Promise<AppConfig>
      setConfig(config: Partial<AppConfig>): Promise<void>
      getWatchRules(): Promise<WatchRule[]>
      setWatchRules(rules: WatchRule[]): Promise<void>

      // ── Streams ──────────────────────────────────────────────────────────────
      listStreams(dir: string): Promise<StreamFolder[]>
      writeStreamMeta(folderPath: string, meta: StreamMeta): Promise<void>
      listStreamTemplates(streamsDir: string): Promise<{ name: string; path: string }[]>
      createStreamFolder(parentDir: string, date: string, meta?: StreamMeta, thumbnailTemplatePath?: string, prevEpisodeFolderPath?: string): Promise<string>
      stampArchived(dir: string): Promise<number>
      watchStreamsDir(dir: string): Promise<void>
      unwatchStreamsDir(): Promise<void>
      onStreamsChanged(cb: () => void): () => void
      archiveFolders(folderPaths: string[], preset: ConversionPreset): Promise<{ errors: string[] }>
      cancelArchive(): Promise<void>
      deleteStreamFolder(folderPath: string): Promise<void>
      removeStreamOrphans(streamsDir: string, folderNames: string[]): Promise<void>
      onArchiveProgress(cb: (data: any) => void): () => void

      // ── Combine ──────────────────────────────────────────────────────────────
      combineFiles(files: string[], outputPath: string, totalDurationSec: number): Promise<void>
      onCombineProgress(cb: (data: { percent: number }) => void): () => void

      // ── YouTube ──────────────────────────────────────────────────────────────
      youtubeGetStatus(): Promise<{ connected: boolean; channelName?: string }>
      youtubeConnect(): Promise<void>
      youtubeDisconnect(): Promise<void>
      youtubeGetBroadcasts(): Promise<LiveBroadcast[]>
      youtubeUpdateBroadcast(broadcastId: string, snippet: { title: string; description: string; gameTitle?: string }, tags: string[]): Promise<void>
      getYTTitleTemplates(): Promise<YTTitleTemplate[]>
      setYTTitleTemplates(v: YTTitleTemplate[]): Promise<void>
      getYTDescriptionTemplates(): Promise<YTDescriptionTemplate[]>
      setYTDescriptionTemplates(v: YTDescriptionTemplate[]): Promise<void>
      getYTTagTemplates(): Promise<YTTagTemplate[]>
      setYTTagTemplates(v: YTTagTemplate[]): Promise<void>

      // ── Twitch ───────────────────────────────────────────────────────────────
      twitchGetStatus(): Promise<{ connected: boolean; channelName?: string }>
      twitchConnect(): Promise<void>
      twitchDisconnect(): Promise<void>
      twitchUpdateChannel(title: string, gameName?: string): Promise<void>

      // ── Window Controls ──────────────────────────────────────────────────────
      windowMinimize(): void
      windowMaximize(): void
      windowClose(): void
    }
  }
}
