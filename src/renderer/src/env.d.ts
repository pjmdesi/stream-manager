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
  LauncherGroup,
} from './types'

declare global {
  interface Window {
    api: {
      // ── Video ────────────────────────────────────────────────────────────────
      probeFile(filePath: string): Promise<VideoInfo>
      extractAudioTracks(filePath: string, trackIndices?: number[]): Promise<string[]>
      cancelExtractAudioTracks(): Promise<void>
      cleanupTracks(paths: string[]): Promise<void>
      getWaveform(filePath: string): Promise<Uint8Array>
      clearAudioCache(): Promise<void>
      getAudioCacheSize(): Promise<number>
      getThumbnailCache(filePath: string): Promise<{ timecodes: number[]; frameUrls: string[] } | null>
      saveThumbnailFrame(filePath: string, index: number, dataUrl: string): Promise<void>
      finalizeThumbnailCache(filePath: string, timecodes: number[]): Promise<void>
      onExtractProgress(cb: (data: { trackIndex: number; percent: number }) => void): () => void

      // ── Files ────────────────────────────────────────────────────────────────
      openFileDialog(options?: Electron.OpenDialogOptions): Promise<string[]>
      saveFileDialog(options?: Electron.SaveDialogOptions): Promise<string | null>
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
      addClipToQueue(params: {
        job: ConversionJob
        clipRegions: Array<{ id: string; inPoint: number; outPoint: number }>
        cropMode: 'none' | '9:16'
        videoWidth: number
        videoHeight: number
        cropX: number
        bleepRegions: Array<{ id: string; start: number; end: number }>
        bleepVolume: number
      }): Promise<string>
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
      getStreamTypeTags(): Promise<Record<string, string>>
      setStreamTypeTags(v: Record<string, string>): Promise<void>
      getStreamTypeTextures(): Promise<Record<string, string>>
      setStreamTypeTextures(v: Record<string, string>): Promise<void>

      // ── Streams ──────────────────────────────────────────────────────────────
      listStreams(dir: string, mode?: 'folder-per-stream' | 'dump-folder'): Promise<StreamFolder[]>
      writeStreamMeta(folderPath: string, meta: StreamMeta): Promise<void>
      listStreamTemplates(streamsDir: string): Promise<{ name: string; path: string }[]>
      createStreamFolder(parentDir: string, date: string, meta?: StreamMeta, thumbnailTemplatePath?: string, prevEpisodeFolderPath?: string, mode?: 'folder-per-stream' | 'dump-folder'): Promise<string>
      stampArchived(dir: string, mode?: 'folder-per-stream' | 'dump-folder'): Promise<number>
      listFilesForDate(dir: string, date: string): Promise<string[]>
      deleteStreamFiles(dir: string, date: string): Promise<void>
      watchStreamsDir(dir: string, mode?: 'folder-per-stream' | 'dump-folder'): Promise<void>
      unwatchStreamsDir(): Promise<void>
      onStreamsChanged(cb: () => void): () => void
      archiveFolders(sessions: Array<{ folderPath: string; date: string; filePaths?: string[] }>, preset: ConversionPreset): Promise<{ errors: string[] }>
      cancelArchive(): Promise<void>
      previewReschedule(folderPath: string, newDate: string): Promise<{ conflictExists: boolean; filesToRename: { oldName: string; newName: string }[] }>
      rescheduleStream(folderPath: string, newDate: string): Promise<string>
      deleteStreamFolder(folderPath: string): Promise<void>
      removeStreamOrphans(streamsDir: string, folderNames: string[]): Promise<void>
      convertDumpFolder(dirPath: string): Promise<{ moved: number; skipped: number; manifest: { moves: { from: string; to: string }[]; createdFolders: string[] } }>
      undoConvertDumpFolder(manifest: { moves: { from: string; to: string }[]; createdFolders: string[] }): Promise<void>
      onArchiveProgress(cb: (data: any) => void): () => void

      // ── Combine ──────────────────────────────────────────────────────────────
      combineFiles(files: string[], outputPath: string, totalDurationSec: number): Promise<void>
      onCombineProgress(cb: (data: { percent: number }) => void): () => void

      // ── YouTube ──────────────────────────────────────────────────────────────
      youtubeGetStatus(): Promise<{ connected: boolean; channelName?: string }>
      youtubeConnect(): Promise<void>
      youtubeDisconnect(): Promise<void>
      youtubeGetBroadcasts(): Promise<LiveBroadcast[]>
      youtubeGetCompletedBroadcasts(): Promise<LiveBroadcast[]>
      youtubeGetVideoById(videoId: string): Promise<LiveBroadcast | null>
      youtubeUpdateVideo(videoId: string, title: string, description: string, tags: string[]): Promise<void>
      youtubeValidateToken(): Promise<{ valid: boolean; error?: string }>
      youtubeGetQualifyingThumbnails(paths: string[]): Promise<string[]>
      youtubeUploadThumbnail(videoId: string, imagePath: string): Promise<void>
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

      // ── Video Popup ───────────────────────────────────────────────────────────
      openVideoPopup(offerSdp: string, videoWidth: number, videoHeight: number, cropMode?: string, cropX?: number): Promise<void>
      closeVideoPopup(): Promise<void>
      setCropPopup(videoWidth: number, videoHeight: number, cropMode: string, cropX: number): Promise<void>
      onVideoPopupClosed(cb: () => void): () => void
      onPopupRtcSignal(cb: (data: unknown) => void): () => void

      // ── Claude AI ────────────────────────────────────────────────────────────
      claudeGenerate(field: string, context: Record<string, unknown>): Promise<string | null>
      claudeTestKey(apiKey: string): Promise<{ valid: boolean; error?: string }>

      // ── File utilities ───────────────────────────────────────────────────────
      getPathForFile(file: File): string

      // ── Window Controls ──────────────────────────────────────────────────────
      windowMinimize(): void
      windowMaximize(): void
      windowClose(): void
      windowMinimizeToTray(): void
      getStartupSettings(): Promise<{ startWithWindows: boolean; startMinimized: boolean }>
      setStartupSettings(startWithWindows: boolean, startMinimized: boolean): Promise<void>
      resetOnboarding(): Promise<void>

      // ── Launcher ─────────────────────────────────────────────────────────────
      getLauncherGroups(): Promise<LauncherGroup[]>
      setLauncherGroups(groups: LauncherGroup[]): Promise<void>
      launchGroup(groupId: string): Promise<{ launched: number }>
      launchApp(filePath: string): Promise<{ launched: boolean }>
      getFileIcon(filePath: string): Promise<string | null>
      resolveShortcut(filePath: string): Promise<string>
      getStartMenuPath(): Promise<string>
    }
  }
}
