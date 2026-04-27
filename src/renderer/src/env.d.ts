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
  DetectedStructure,
  ClipDraft,
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
      listFilesRecursive(dir: string, maxDepth?: number): Promise<FileInfo[]>
      listFileNames(dirPath: string): Promise<{ name: string; isDirectory: boolean }[]>
      fileExists(filePath: string): Promise<boolean>
      mkdir(dirPath: string): Promise<void>
      openUrl(url: string): Promise<void>
      openInExplorer(filePath: string): Promise<void>
      readFile(filePath: string): Promise<string>
      saveScreenshot(destPath: string, base64Data: string): Promise<string>
      checkLocalFiles(filePaths: string[]): Promise<boolean[]>
      startCloudDownload(filePath: string): Promise<void>
      debugFileAttrs(filePath: string): Promise<{
        exists: boolean
        raw: number
        hex: string
        flags: Record<string, boolean>
        isLocalByMask: boolean
      }>
      cancelCloudDownload(filePath: string): Promise<void>
      onCloudDownloadDone(cb: (filePath: string) => void): () => void

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
      checkEncoderAvailable(name: string): Promise<boolean>
      detectAvailableEncoders(): Promise<string[]>
      importPreset(filePath: string): Promise<ConversionPreset>
      getImportedPresets(): Promise<ConversionPreset[]>
      deleteImportedPreset(id: string): Promise<void>
      renameImportedPreset(id: string, newName: string): Promise<void>
      saveCustomPreset(preset: ConversionPreset): Promise<string>
      addToQueue(job: ConversionJob): Promise<string>
      addQueuedGroup(jobs: ConversionJob[]): Promise<string[]>
      addClipToQueue(params: {
        job: ConversionJob
        clipRegions: Array<{ id: string; inPoint: number; outPoint: number; cropX?: number; cropY?: number; cropScale?: number }>
        cropAspect: 'off' | 'original' | '16:9' | '1:1' | '9:16'
        videoWidth: number
        videoHeight: number
        cropX: number
        bleepRegions: Array<{ id: string; start: number; end: number }>
        bleepVolume: number
      }): Promise<string>
      cancelJob(jobId: string): Promise<void>
      cancelJobGroup(groupId: string): Promise<void>
      pauseJob(jobId: string): Promise<void>
      resumeJob(jobId: string): Promise<void>
      startQueuedJob(jobId: string): Promise<void>
      getJobs(): Promise<ConversionJob[]>
      onJobProgress(cb: (data: { jobId: string; percent: number; status?: string }) => void): () => void
      onJobComplete(cb: (data: { jobId: string; outputPath: string }) => void): () => void
      onJobError(cb: (data: { jobId: string; error: string }) => void): () => void
      onJobAdded(cb: (job: ConversionJob) => void): () => void
      onJobStatus(cb: (data: { jobId: string; status: ConversionJob['status'] }) => void): () => void

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
      detectStreamStructure(dir: string): Promise<DetectedStructure>
      writeStreamMeta(folderPath: string, meta: StreamMeta, metaKey?: string): Promise<void>
      updateStreamMeta(folderPath: string, partial: Partial<StreamMeta>, metaKey?: string): Promise<void>
      saveClipDraft(folderPath: string, draft: ClipDraft, metaKey?: string): Promise<void>
      deleteClipDraft(folderPath: string, draftId: string, metaKey?: string): Promise<void>
      clipTagExport(folderPath: string, outputFilename: string, sourceName: string, clipState: unknown, draftId?: string | null, metaKey?: string): Promise<void>
      listStreamTemplates(streamsDir: string): Promise<{ name: string; path: string }[]>
      createStreamFolder(parentDir: string, date: string, meta?: StreamMeta, thumbnailTemplatePath?: string, prevEpisodeFolderPath?: string, mode?: 'folder-per-stream' | 'dump-folder'): Promise<string>

      listFilesForDate(dir: string, date: string): Promise<string[]>
      deleteStreamFiles(dir: string, date: string): Promise<void>
      watchStreamsDir(dir: string, mode?: 'folder-per-stream' | 'dump-folder'): Promise<void>
      unwatchStreamsDir(): Promise<void>
      onStreamsChanged(cb: () => void): () => void
      previewReschedule(folderPath: string, oldDate: string, newDate: string): Promise<{
        isDump: boolean
        folderConflict: boolean
        folderRename: { from: string; to: string } | null
        filesToRename: { from: string; to: string; collision: boolean }[]
        hasCollisions: boolean
      }>
      rescheduleStream(folderPath: string, oldDate: string, newDate: string): Promise<{ newFolderPath: string; renamedCount: number; skippedCount: number }>
      deleteStreamFolder(folderPath: string): Promise<void>
      removeStreamOrphans(streamsDir: string, folderNames: string[]): Promise<void>
      convertDumpFolder(dirPath: string): Promise<{ moved: number; skipped: number; manifest: { moves: { from: string; to: string }[]; createdFolders: string[] } }>
      undoConvertDumpFolder(manifest: { moves: { from: string; to: string }[]; createdFolders: string[] }): Promise<void>

      // ── Combine ──────────────────────────────────────────────────────────────
      combineFiles(files: string[], outputPath: string, totalDurationSec: number): Promise<void>
      onCombineProgress(cb: (data: { percent: number }) => void): () => void

      // ── YouTube ──────────────────────────────────────────────────────────────
      youtubeGetStatus(): Promise<{ connected: boolean; channelName?: string }>
      youtubeConnect(): Promise<void>
      youtubeDisconnect(): Promise<void>
      youtubeGetPrivacyStatuses(videoIds: string[]): Promise<Record<string, string>>
      youtubeCheckBroadcastIsLive(broadcastId: string): Promise<{ isLive: boolean; privacyStatus: string | null }>
      youtubeGetBroadcasts(): Promise<LiveBroadcast[]>
      youtubeCreateBroadcast(params: { title: string; description: string; scheduledStartTime: string; privacyStatus: 'public' | 'unlisted' | 'private' }): Promise<LiveBroadcast>
      youtubeGetCompletedBroadcasts(): Promise<LiveBroadcast[]>
      youtubeGetVideoById(videoId: string): Promise<LiveBroadcast | null>
      youtubeUpdateVideo(videoId: string, title: string, description: string, tags: string[]): Promise<void>
      youtubeValidateToken(): Promise<{ valid: boolean; error?: string }>
      youtubeGetQualifyingThumbnails(paths: string[]): Promise<string[]>
      youtubeUploadThumbnail(videoId: string, imagePath: string): Promise<void>
      youtubeUpdateBroadcast(broadcastId: string, snippet: { title: string; description: string }, tags: string[]): Promise<void>
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

      // ── Thumbnail Editor ─────────────────────────────────────────────────────
      thumbnailEnsureAssetsDir(streamsDir: string): Promise<void>
      thumbnailListTemplates(streamsDir: string): Promise<ThumbnailTemplate[]>
      thumbnailSaveTemplate(streamsDir: string, template: ThumbnailTemplate, pngDataUrl?: string): Promise<ThumbnailTemplate>
      thumbnailDeleteTemplate(streamsDir: string, templateId: string): Promise<void>
      thumbnailLoadCanvas(folderPath: string, date: string): Promise<ThumbnailCanvasFile | null>
      thumbnailSaveCanvas(folderPath: string, date: string, canvasFile: ThumbnailCanvasFile, pngDataUrl: string): Promise<void>
      thumbnailCacheAsset(streamsDir: string, srcPath: string): Promise<string>
      thumbnailGetRecents(): Promise<ThumbnailRecentEntry[]>
      thumbnailAddRecent(entry: ThumbnailRecentEntry): Promise<ThumbnailRecentEntry[]>
      thumbnailRemoveRecent(folderPath: string, date: string): Promise<ThumbnailRecentEntry[]>
      thumbnailGetLastFont(): Promise<string>
      thumbnailSetLastFont(font: string): Promise<void>

      // ── File utilities ───────────────────────────────────────────────────────
      getPathForFile(file: File): string

      // ── Window Controls ──────────────────────────────────────────────────────
      windowMinimize(): void
      windowMaximize(): void
      windowClose(): void
      windowMinimizeToTray(): void
      windowIsMaximized(): Promise<boolean>
      onMaximizeChange(cb: (maximized: boolean) => void): () => void
      onConfirmQuit(cb: (data: { running: number; queued: number }) => void): () => void
      proceedQuit(): void
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
