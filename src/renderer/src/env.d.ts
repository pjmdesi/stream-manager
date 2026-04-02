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
  StreamFolder
} from './types'

declare global {
  interface Window {
    api: {
      // Video
      probeFile(filePath: string): Promise<VideoInfo>
      extractAudioTracks(filePath: string): Promise<string[]>
      cleanupTracks(paths: string[]): Promise<void>
      getWaveform(filePath: string): Promise<Array<{ min: number; max: number }>>
      onExtractProgress(cb: (data: { trackIndex: number; percent: number }) => void): () => void
      getThumbnailCache(filePath: string): Promise<{ timecodes: number[]; frameUrls: string[] } | null>
      saveThumbnailFrame(filePath: string, index: number, dataUrl: string): Promise<void>
      finalizeThumbnailCache(filePath: string, timecodes: number[]): Promise<void>

      // Files
      openFileDialog(options?: Electron.OpenDialogOptions): Promise<string[]>
      openDirectoryDialog(): Promise<string | null>
      moveFile(src: string, dest: string): Promise<void>
      copyFile(src: string, dest: string): Promise<void>
      renameFile(filePath: string, newName: string): Promise<string>
      deleteFile(filePath: string): Promise<void>
      listFiles(dir: string): Promise<FileInfo[]>
      fileExists(filePath: string): Promise<boolean>
      mkdir(dirPath: string): Promise<void>
      openInExplorer(filePath: string): Promise<void>
      readFile(filePath: string): Promise<string>
      saveScreenshot(destPath: string, base64Data: string): Promise<string>
      checkLocalFiles(filePaths: string[]): Promise<boolean[]>
      listFileNames(dirPath: string): Promise<{ name: string; isDirectory: boolean }[]>

      // Watcher
      startWatcher(rules: WatchRule[]): Promise<void>
      stopWatcher(): Promise<void>
      onFileMatched(cb: (event: WatchEvent) => void): () => void

      // Templates
      getTemplates(): Promise<FolderTemplate[]>
      saveTemplate(template: FolderTemplate): Promise<void>
      deleteTemplate(id: string): Promise<void>
      applyTemplate(templateId: string, basePath: string, variables: Record<string, string>): Promise<void>

      // Converter
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
      onJobProgress(cb: (data: { jobId: string; percent: number }) => void): () => void
      onJobComplete(cb: (data: { jobId: string; outputPath: string }) => void): () => void
      onJobError(cb: (data: { jobId: string; error: string }) => void): () => void

      // Store
      getConfig(): Promise<AppConfig>
      setConfig(config: Partial<AppConfig>): Promise<void>
      getWatchRules(): Promise<WatchRule[]>
      setWatchRules(rules: WatchRule[]): Promise<void>

      // Streams
      listStreams(dir: string): Promise<StreamFolder[]>
      writeStreamMeta(folderPath: string, meta: StreamMeta): Promise<void>
      createStreamFolder(parentDir: string, date: string, meta?: StreamMeta): Promise<string>
      deleteStreamFolder(folderPath: string): Promise<void>
      removeStreamOrphans(streamsDir: string, folderNames: string[]): Promise<void>

      // Window
      windowMinimize(): void
      windowMaximize(): void
      windowClose(): void
    }
  }
}
