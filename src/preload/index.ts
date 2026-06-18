import { contextBridge, ipcRenderer, webUtils } from 'electron'

// Expose a typed API surface to the renderer process
contextBridge.exposeInMainWorld('api', {
  // ── Video ──────────────────────────────────────────────────────────────────
  probeFile: (filePath: string) =>
    ipcRenderer.invoke('video:probe', filePath),

  extractAudioTracks: (filePath: string, trackIndices?: number[]) =>
    ipcRenderer.invoke('video:extractTracks', filePath, trackIndices),

  getCachedAudioTracks: (filePath: string) =>
    ipcRenderer.invoke('video:getCachedTracks', filePath),

  cancelExtractAudioTracks: (trackIndex?: number) =>
    ipcRenderer.invoke('video:cancelExtract', trackIndex),

  cleanupTracks: (paths: string[]) =>
    ipcRenderer.invoke('video:cleanupTracks', paths),

  getWaveform: (filePath: string) =>
    ipcRenderer.invoke('video:getWaveform', filePath),

  clearAudioCache: () =>
    ipcRenderer.invoke('video:clearAudioCache'),

  getAudioCacheSize: () =>
    ipcRenderer.invoke('video:getAudioCacheSize'),

  getThumbnailCache: (filePath: string) =>
    ipcRenderer.invoke('video:getThumbnailCache', filePath),

  saveThumbnailFrame: (filePath: string, index: number, dataUrl: string) =>
    ipcRenderer.invoke('video:saveThumbnailFrame', filePath, index, dataUrl),

  finalizeThumbnailCache: (filePath: string, timecodes: number[]) =>
    ipcRenderer.invoke('video:finalizeThumbnailCache', filePath, timecodes),

  onExtractProgress: (
    callback: (data: { trackIndex: number; percent: number }) => void
  ) => {
    const handler = (_event: Electron.IpcRendererEvent, data: any) => callback(data)
    ipcRenderer.on('video:extractProgress', handler)
    return () => ipcRenderer.removeListener('video:extractProgress', handler)
  },

  // ── Files ──────────────────────────────────────────────────────────────────
  openFileDialog: (options?: Electron.OpenDialogOptions) =>
    ipcRenderer.invoke('files:openFileDialog', options),

  saveFileDialog: (options?: Electron.SaveDialogOptions) =>
    ipcRenderer.invoke('files:saveFileDialog', options),

  openDirectoryDialog: () =>
    ipcRenderer.invoke('files:openDirectoryDialog'),

  moveFile: (src: string, dest: string) =>
    ipcRenderer.invoke('files:move', src, dest),

  copyFile: (src: string, dest: string) =>
    ipcRenderer.invoke('files:copy', src, dest),

  renameFile: (filePath: string, newName: string) =>
    ipcRenderer.invoke('files:rename', filePath, newName),

  deleteFile: (filePath: string) =>
    ipcRenderer.invoke('files:delete', filePath),

  listFiles: (dir: string) =>
    ipcRenderer.invoke('files:list', dir),

  listFilesRecursive: (dir: string, maxDepth?: number) =>
    ipcRenderer.invoke('files:listRecursive', dir, maxDepth),

  fileExists: (filePath: string) =>
    ipcRenderer.invoke('files:exists', filePath),

  mkdir: (dirPath: string) =>
    ipcRenderer.invoke('files:mkdir', dirPath),

  openUrl: (url: string) =>
    ipcRenderer.invoke('files:openUrl', url),

  openInExplorer: (filePath: string) =>
    ipcRenderer.invoke('files:openInExplorer', filePath),

  readFile: (filePath: string) =>
    ipcRenderer.invoke('files:readFile', filePath),

  saveScreenshot: (destPath: string, base64Data: string) =>
    ipcRenderer.invoke('files:saveScreenshot', destPath, base64Data),

  trashFile: (filePath: string) =>
    ipcRenderer.invoke('files:trashFile', filePath),

  getFileSizes: (paths: string[]) =>
    ipcRenderer.invoke('files:getFileSizes', paths),

  getNativeThumbnail: (filePath: string, size?: number) =>
    ipcRenderer.invoke('files:getNativeThumbnail', filePath, size),

  checkLocalFiles: (filePaths: string[]) =>
    ipcRenderer.invoke('files:checkLocalFiles', filePaths),

  startCloudDownload: (filePath: string) =>
    ipcRenderer.invoke('files:startCloudDownload', filePath),

  // Diagnostic for cloud-placeholder detection — call from devtools:
  //   await window.api.debugFileAttrs('D:\\path\\to\\file.jpg')
  debugFileAttrs: (filePath: string): Promise<{ exists: boolean; raw: number; hex: string; flags: Record<string, boolean>; isLocalByMask: boolean }> =>
    ipcRenderer.invoke('files:debugFileAttrs', filePath),

  cancelCloudDownload: (filePath: string) =>
    ipcRenderer.invoke('files:cancelCloudDownload', filePath),

  // ── Cloud sync (offload to NAS / OneDrive / etc.) ──────────────────────────
  cloudSyncIsActive: (): Promise<boolean> =>
    ipcRenderer.invoke('cloud-sync:is-active'),

  // ── Update check ───────────────────────────────────────────────────────────
  checkForUpdate: (force?: boolean): Promise<{
    current: string
    latest: string | null
    hasUpdate: boolean
    releaseUrl: string | null
    releaseNotes: string | null
  }> => ipcRenderer.invoke('update:check', force ?? false),

  cloudSyncOffload: (paths: string[], batchId: string): Promise<void> =>
    ipcRenderer.invoke('cloud-sync:offload', paths, batchId),

  cloudSyncCancelOffload: (): Promise<void> =>
    ipcRenderer.invoke('cloud-sync:cancel-offload'),

  cloudSyncPin: (paths: string[], batchId: string): Promise<void> =>
    ipcRenderer.invoke('cloud-sync:pin', paths, batchId),

  cloudSyncCancelPin: (): Promise<void> =>
    ipcRenderer.invoke('cloud-sync:cancel-pin'),

  onCloudSyncProgress: (
    callback: (event:
      | { type: 'init'; direction: 'offload' | 'hydrate'; batchId: string; eligible: string[]; skippedProtected: string[] }
      | { type: 'item'; direction: 'offload' | 'hydrate'; batchId: string; path: string; status: 'running' | 'done' | 'already-offline' | 'already-local' | 'failed'; reason?: string }
      | { type: 'complete'; direction: 'offload' | 'hydrate'; batchId: string; ok: number; failed: number; alreadyOffline?: number; alreadyLocal?: number; cancelled: boolean }
    ) => void
  ) => {
    const handler = (_e: Electron.IpcRendererEvent, data: any) => callback(data)
    ipcRenderer.on('cloud-sync:progress', handler)
    return () => ipcRenderer.removeListener('cloud-sync:progress', handler)
  },

  onCloudDownloadDone: (callback: (filePath: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, filePath: string) => callback(filePath)
    ipcRenderer.on('files:cloudDownloadDone', handler)
    return () => ipcRenderer.removeListener('files:cloudDownloadDone', handler)
  },

  listFileNames: (dirPath: string) =>
    ipcRenderer.invoke('files:listNames', dirPath),

  // ── File Watcher ───────────────────────────────────────────────────────────
  startWatcher: (rules: any[]) =>
    ipcRenderer.invoke('watcher:start', rules),

  stopWatcher: () =>
    ipcRenderer.invoke('watcher:stop'),

  onFileMatched: (callback: (event: any) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: any) => callback(data)
    ipcRenderer.on('watcher:fileMatched', handler)
    return () => ipcRenderer.removeListener('watcher:fileMatched', handler)
  },

  // ── Templates ─────────────────────────────────────────────────────────────
  getTemplates: () =>
    ipcRenderer.invoke('templates:getAll'),

  saveTemplate: (template: any) =>
    ipcRenderer.invoke('templates:save', template),

  deleteTemplate: (id: string) =>
    ipcRenderer.invoke('templates:delete', id),

  applyTemplate: (templateId: string, basePath: string, variables: Record<string, string>) =>
    ipcRenderer.invoke('templates:apply', templateId, basePath, variables),

  // ── Converter ─────────────────────────────────────────────────────────────
  getBuiltinPresets: () =>
    ipcRenderer.invoke('converter:getBuiltinPresets'),

  checkEncoderAvailable: (name: string) =>
    ipcRenderer.invoke('converter:checkEncoderAvailable', name),

  checkAlreadyArchived: (paths: string[]): Promise<string[]> =>
    ipcRenderer.invoke('converter:checkAlreadyArchived', paths),

  detectAvailableEncoders: () =>
    ipcRenderer.invoke('converter:detectAvailableEncoders'),

  importPreset: (filePath: string) =>
    ipcRenderer.invoke('converter:importPreset', filePath),

  getImportedPresets: () =>
    ipcRenderer.invoke('converter:getImportedPresets'),

  deleteImportedPreset: (id: string) =>
    ipcRenderer.invoke('converter:deleteImportedPreset', id),

  renameImportedPreset: (id: string, newName: string) =>
    ipcRenderer.invoke('converter:renameImportedPreset', id, newName),

  saveCustomPreset: (preset: any) =>
    ipcRenderer.invoke('converter:saveCustomPreset', preset),

  addToQueue: (job: any) =>
    ipcRenderer.invoke('converter:addToQueue', job),

  addQueuedGroup: (jobs: any[]) =>
    ipcRenderer.invoke('converter:addQueuedGroup', jobs),

  addClipToQueue: (params: any) =>
    ipcRenderer.invoke('converter:addClipToQueue', params),

  cancelJob: (jobId: string) =>
    ipcRenderer.invoke('converter:cancelJob', jobId),

  cancelJobGroup: (groupId: string) =>
    ipcRenderer.invoke('converter:cancelGroup', groupId),

  startQueuedJob: (jobId: string) =>
    ipcRenderer.invoke('converter:startQueued', jobId),

  pauseJob: (jobId: string) =>
    ipcRenderer.invoke('converter:pauseJob', jobId),

  resumeJob: (jobId: string) =>
    ipcRenderer.invoke('converter:resumeJob', jobId),

  getJobs: () =>
    ipcRenderer.invoke('converter:getJobs'),

  onJobProgress: (callback: (data: { jobId: string; percent: number }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: any) => callback(data)
    ipcRenderer.on('converter:jobProgress', handler)
    return () => ipcRenderer.removeListener('converter:jobProgress', handler)
  },

  onJobComplete: (callback: (data: { jobId: string; outputPath: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: any) => callback(data)
    ipcRenderer.on('converter:jobComplete', handler)
    return () => ipcRenderer.removeListener('converter:jobComplete', handler)
  },

  onJobError: (callback: (data: { jobId: string; error: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: any) => callback(data)
    ipcRenderer.on('converter:jobError', handler)
    return () => ipcRenderer.removeListener('converter:jobError', handler)
  },

  onJobAdded: (callback: (job: any) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: any) => callback(data)
    ipcRenderer.on('converter:jobAdded', handler)
    return () => ipcRenderer.removeListener('converter:jobAdded', handler)
  },

  onJobStatus: (callback: (data: { jobId: string; status: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: any) => callback(data)
    ipcRenderer.on('converter:jobStatus', handler)
    return () => ipcRenderer.removeListener('converter:jobStatus', handler)
  },

  // ── Store ─────────────────────────────────────────────────────────────────
  getConfig: () =>
    ipcRenderer.invoke('store:getConfig'),

  setConfig: (config: any) =>
    ipcRenderer.invoke('store:setConfig', config),

  getWatchRules: () =>
    ipcRenderer.invoke('store:getWatchRules'),

  setWatchRules: (rules: any[]) =>
    ipcRenderer.invoke('store:setWatchRules', rules),

  // ── Streams ───────────────────────────────────────────────────────────────
  listStreams: (dir: string, mode?: 'folder-per-stream' | 'dump-folder') =>
    ipcRenderer.invoke('streams:list', dir, mode),

  detectStreamStructure: (dir: string) =>
    ipcRenderer.invoke('streams:detectStructure', dir),

  writeStreamMeta: (folderPath: string, meta: any, metaKey?: string) =>
    ipcRenderer.invoke('streams:writeMeta', folderPath, meta, metaKey),

  updateStreamMeta: (folderPath: string, partial: any, metaKey?: string) =>
    ipcRenderer.invoke('streams:updateMeta', folderPath, partial, metaKey),

  backfillThumbnailHashes: (dir: string, mode?: 'folder-per-stream' | 'dump-folder') =>
    ipcRenderer.invoke('streams:backfillThumbnailHashes', dir, mode),

  saveClipDraft: (folderPath: string, draft: any, metaKey?: string) =>
    ipcRenderer.invoke('clipDraft:save', folderPath, draft, metaKey),

  deleteClipDraft: (folderPath: string, draftId: string, metaKey?: string) =>
    ipcRenderer.invoke('clipDraft:delete', folderPath, draftId, metaKey),

  clipTagExport: (folderPath: string, outputFilename: string, sourceName: string, clipState: any, draftId?: string | null, metaKey?: string) =>
    ipcRenderer.invoke('clip:tagExport', folderPath, outputFilename, sourceName, clipState, draftId, metaKey),

  listStreamTemplates: (streamsDir: string) =>
    ipcRenderer.invoke('streams:listTemplates', streamsDir),

  createStreamFolder: (parentDir: string, date: string, meta?: any, thumbnailTemplatePath?: string, prevEpisodeFolderPath?: string, mode?: 'folder-per-stream' | 'dump-folder') =>
    ipcRenderer.invoke('streams:createFolder', parentDir, date, meta, thumbnailTemplatePath, prevEpisodeFolderPath, mode),


  listFilesForDate: (dir: string, date: string) =>
    ipcRenderer.invoke('streams:listFilesForDate', dir, date),

  deleteStreamFiles: (dir: string, date: string) =>
    ipcRenderer.invoke('streams:deleteStreamFiles', dir, date),

  watchStreamsDir: (dir: string, mode?: 'folder-per-stream' | 'dump-folder') =>
    ipcRenderer.invoke('streams:watchDir', dir, mode),

  unwatchStreamsDir: () =>
    ipcRenderer.invoke('streams:unwatchDir'),

  onStreamsChanged: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('streams:changed', handler)
    return () => ipcRenderer.removeListener('streams:changed', handler)
  },

  previewReschedule: (folderPath: string, oldDate: string, newDate: string) =>
    ipcRenderer.invoke('streams:previewReschedule', folderPath, oldDate, newDate),

  rescheduleStream: (folderPath: string, oldDate: string, newDate: string) =>
    ipcRenderer.invoke('streams:reschedule', folderPath, oldDate, newDate),

  deleteStreamFolder: (folderPath: string) =>
    ipcRenderer.invoke('streams:deleteFolder', folderPath),

  removeStreamOrphans: (streamsDir: string, folderNames: string[]) =>
    ipcRenderer.invoke('streams:removeOrphans', streamsDir, folderNames),

  convertDumpFolder: (dirPath: string) =>
    ipcRenderer.invoke('streams:convertDumpFolder', dirPath),

  undoConvertDumpFolder: (manifest: { moves: { from: string; to: string }[]; createdFolders: string[] }) =>
    ipcRenderer.invoke('streams:undoConvertDumpFolder', manifest),

  // ── Combine ───────────────────────────────────────────────────────────────
  combineFiles: (files: string[], outputPath: string, totalDurationSec: number) =>
    ipcRenderer.invoke('combine:run', files, outputPath, totalDurationSec),

  onCombineProgress: (callback: (data: { percent: number }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: any) => callback(data)
    ipcRenderer.on('combine:progress', handler)
    return () => ipcRenderer.removeListener('combine:progress', handler)
  },

  // ── YouTube ───────────────────────────────────────────────────────────────
  youtubeGetStatus: () =>
    ipcRenderer.invoke('youtube:getStatus'),

  youtubeGetQuotaState: () =>
    ipcRenderer.invoke('youtube:getQuotaState'),

  // Dev-only: forcibly mark quota as exceeded so the renderer's outage
  // banner + all gated calls behave as if YouTube returned a quota
  // 403. Returns the resulting state after applying the change.
  youtubeSetForcedQuotaExceeded: (forced: boolean) =>
    ipcRenderer.invoke('youtube:setForcedQuotaExceeded', forced),
  youtubeGetForcedQuotaExceeded: (): Promise<boolean> =>
    ipcRenderer.invoke('youtube:getForcedQuotaExceeded'),

  // Pushed by the main process when quota state changes (mark or
  // auto-clear). Callback receives the same shape as `getQuotaState`.
  onYouTubeQuotaChanged: (cb: (state: { exceeded: boolean; resetsAt: string | null }) => void) => {
    const listener = (_e: unknown, state: { exceeded: boolean; resetsAt: string | null }) => cb(state)
    ipcRenderer.on('youtube:quota-changed', listener)
    return () => { ipcRenderer.removeListener('youtube:quota-changed', listener) }
  },

  youtubeGetChannelId: (): Promise<string> =>
    ipcRenderer.invoke('youtube:getChannelId'),

  youtubeConnect: () =>
    ipcRenderer.invoke('youtube:connect'),

  youtubeDisconnect: () =>
    ipcRenderer.invoke('youtube:disconnect'),

  youtubeGetVideoStatuses: (videoIds: string[]) =>
    ipcRenderer.invoke('youtube:getVideoStatuses', videoIds),

  youtubeCheckBroadcastsAreLive: (broadcastIds: string[]) =>
    ipcRenderer.invoke('youtube:checkBroadcastsAreLive', broadcastIds),

  youtubeGetBroadcasts: () =>
    ipcRenderer.invoke('youtube:getBroadcasts'),

  youtubeCreateBroadcast: (params: { title: string; description: string; scheduledStartTime: string; privacyStatus: 'public' | 'unlisted' | 'private' }) =>
    ipcRenderer.invoke('youtube:createBroadcast', params),

  youtubeGetDefaultStreamKey: () =>
    ipcRenderer.invoke('youtube:getDefaultStreamKey'),

  youtubeGetCompletedBroadcasts: () =>
    ipcRenderer.invoke('youtube:getCompletedBroadcasts'),

  youtubeGetVideoById: (videoId: string) =>
    ipcRenderer.invoke('youtube:getVideoById', videoId),
  youtubeGetVideosByIds: (ids: string[]) =>
    ipcRenderer.invoke('youtube:getVideosByIds', ids),

  youtubeGetBroadcastById: (broadcastId: string) =>
    ipcRenderer.invoke('youtube:getBroadcastById', broadcastId),

  youtubeGetCategories: (regionCode?: string) =>
    ipcRenderer.invoke('youtube:getCategories', regionCode),

  youtubeUpdateVideo: (
    videoId: string,
    title: string,
    description: string,
    tags: string[],
    categoryId?: string,
  ) => ipcRenderer.invoke('youtube:updateVideo', videoId, title, description, tags, categoryId),

  youtubeValidateToken: () =>
    ipcRenderer.invoke('youtube:validateToken'),

  youtubeGetQualifyingThumbnails: (paths: string[]) =>
    ipcRenderer.invoke('youtube:getQualifyingThumbnails', paths),

  youtubeUploadThumbnail: (videoId: string, imagePath: string) =>
    ipcRenderer.invoke('youtube:uploadThumbnail', videoId, imagePath),

  youtubeUpdateBroadcast: (
    broadcastId: string,
    snippet: { title: string; description: string; scheduledStartTime?: string },
    tags: string[],
    categoryId?: string,
  ) => ipcRenderer.invoke('youtube:updateBroadcast', broadcastId, snippet, tags, categoryId),

  youtubeUpdateBroadcastStatus: (
    broadcastId: string,
    privacyStatus: 'public' | 'unlisted' | 'private',
  ) => ipcRenderer.invoke('youtube:updateBroadcastStatus', broadcastId, privacyStatus),

  youtubeDeleteVideo: (videoId: string) =>
    ipcRenderer.invoke('youtube:deleteVideo', videoId),

  // ── YouTube Templates ─────────────────────────────────────────────────────
  getYTTitleTemplates: () => ipcRenderer.invoke('store:getYTTitleTemplates'),
  setYTTitleTemplates: (v: any[]) => ipcRenderer.invoke('store:setYTTitleTemplates', v),
  getYTDescriptionTemplates: () => ipcRenderer.invoke('store:getYTDescriptionTemplates'),
  setYTDescriptionTemplates: (v: any[]) => ipcRenderer.invoke('store:setYTDescriptionTemplates', v),
  getYTTagTemplates: () => ipcRenderer.invoke('store:getYTTagTemplates'),
  setYTTagTemplates: (v: any[]) => ipcRenderer.invoke('store:setYTTagTemplates', v),

  getTwitchTagTemplates: () => ipcRenderer.invoke('store:getTwitchTagTemplates'),
  setTwitchTagTemplates: (v: any[]) => ipcRenderer.invoke('store:setTwitchTagTemplates', v),
  getStreamTypeTags: (): Promise<Record<string, string>> => ipcRenderer.invoke('store:getStreamTypeTags'),
  setStreamTypeTags: (v: Record<string, string>) => ipcRenderer.invoke('store:setStreamTypeTags', v),
  getStreamTypeTextures: (): Promise<Record<string, string>> => ipcRenderer.invoke('store:getStreamTypeTextures'),
  setStreamTypeTextures: (v: Record<string, string>) => ipcRenderer.invoke('store:setStreamTypeTextures', v),
  getGameTagsLinks: (): Promise<Record<string, string>> => ipcRenderer.invoke('store:getGameTagsLinks'),
  setGameTagsLinks: (v: Record<string, string>) => ipcRenderer.invoke('store:setGameTagsLinks', v),

  // ── Twitch ────────────────────────────────────────────────────────────────
  twitchGetStatus: () =>
    ipcRenderer.invoke('twitch:getStatus'),

  twitchConnect: () =>
    ipcRenderer.invoke('twitch:connect'),

  twitchDisconnect: () =>
    ipcRenderer.invoke('twitch:disconnect'),

  twitchUpdateChannel: (title: string, gameName?: string, tags?: string[]) =>
    ipcRenderer.invoke('twitch:updateChannel', title, gameName, tags),

  twitchGetChannel: () =>
    ipcRenderer.invoke('twitch:getChannel'),

  // ── Video Popup ───────────────────────────────────────────────────────────
  // offerSdp is the WebRTC offer SDP from the main renderer's RTCPeerConnection.
  // The popup receives it, answers, and streams the video from the main window.
  openVideoPopup: (offerSdp: string, videoWidth: number, videoHeight: number, cropMode?: string, cropX?: number) =>
    ipcRenderer.invoke('popup:open', offerSdp, videoWidth, videoHeight, cropMode, cropX),

  closeVideoPopup: () =>
    ipcRenderer.invoke('popup:close'),

  setCropPopup: (videoWidth: number, videoHeight: number, cropMode: string, cropX: number) =>
    ipcRenderer.invoke('popup:setcrop', videoWidth, videoHeight, cropMode, cropX),

  onVideoPopupClosed: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('popup:closed', handler)
    return () => ipcRenderer.removeListener('popup:closed', handler)
  },

  // WebRTC signaling: receive answer SDP from popup → main renderer
  onPopupRtcSignal: (callback: (data: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data)
    ipcRenderer.on('popup:rtc-p2m', handler)
    return () => ipcRenderer.removeListener('popup:rtc-p2m', handler)
  },

  // ── Window Controls ───────────────────────────────────────────────────────
  windowMinimize: () => ipcRenderer.send('window:minimize'),
  windowMaximize: () => ipcRenderer.send('window:maximize'),
  windowClose: () => ipcRenderer.send('window:close'),
  windowMinimizeToTray: () => ipcRenderer.send('window:minimizeToTray'),
  // Native redo for the focused editable field (Ctrl/Cmd+Shift+Z parity).
  editRedo: () => ipcRenderer.send('edit:redo'),
  windowIsMaximized: (): Promise<boolean> => ipcRenderer.invoke('window:isMaximized'),
  onMaximizeChange: (cb: (maximized: boolean) => void) => {
    const handler = (_: Electron.IpcRendererEvent, val: boolean) => cb(val)
    ipcRenderer.on('window:maximizeChange', handler)
    return () => ipcRenderer.removeListener('window:maximizeChange', handler)
  },

  // ── Quit confirmation ─────────────────────────────────────────────────────
  onConfirmQuit: (cb: (data: { running: number; queued: number }) => void) => {
    const handler = (_: Electron.IpcRendererEvent, data: { running: number; queued: number }) => cb(data)
    ipcRenderer.on('app:confirmQuit', handler)
    return () => ipcRenderer.removeListener('app:confirmQuit', handler)
  },
  proceedQuit: () => ipcRenderer.send('app:proceedQuit'),

  // ── Startup settings ──────────────────────────────────────────────────────
  getStartupSettings: (): Promise<{ startWithWindows: boolean; startMinimized: boolean }> =>
    ipcRenderer.invoke('app:getStartupSettings'),
  setStartupSettings: (startWithWindows: boolean, startMinimized: boolean): Promise<void> =>
    ipcRenderer.invoke('app:setStartupSettings', startWithWindows, startMinimized),

  // ── Launcher ──────────────────────────────────────────────────────────────
  getLauncherGroups: () =>
    ipcRenderer.invoke('launcher:getGroups'),
  setLauncherGroups: (groups: any[]) =>
    ipcRenderer.invoke('launcher:setGroups', groups),
  launchGroup: (groupId: string) =>
    ipcRenderer.invoke('launcher:launchGroup', groupId),
  launchApp: (filePath: string) =>
    ipcRenderer.invoke('launcher:launchApp', filePath),
  getFileIcon: (filePath: string) =>
    ipcRenderer.invoke('launcher:getFileIcon', filePath),
  resolveShortcut: (filePath: string) =>
    ipcRenderer.invoke('launcher:resolveShortcut', filePath),
  getStartMenuPath: () =>
    ipcRenderer.invoke('launcher:getStartMenuPath'),

  // ── Dev tools ─────────────────────────────────────────────────────────────
  resetOnboarding: () => ipcRenderer.invoke('store:resetOnboarding'),

  // ── Claude AI ─────────────────────────────────────────────────────────────
  claudeGenerate: (field: string, context: Record<string, unknown>) =>
    ipcRenderer.invoke('claude:generate', { field, context }),
  claudeTestKey: (apiKey: string) =>
    ipcRenderer.invoke('claude:testKey', apiKey),

  // ── Thumbnail Editor ──────────────────────────────────────────────────────
  thumbnailEnsureAssetsDir: (streamsDir: string) =>
    ipcRenderer.invoke('thumbnail:ensureAssetsDir', streamsDir),
  thumbnailListTemplates: (streamsDir: string) =>
    ipcRenderer.invoke('thumbnail:listTemplates', streamsDir),
  thumbnailSaveTemplate: (streamsDir: string, template: any, pngDataUrl?: string) =>
    ipcRenderer.invoke('thumbnail:saveTemplate', streamsDir, template, pngDataUrl),
  thumbnailDeleteTemplate: (streamsDir: string, templateId: string) =>
    ipcRenderer.invoke('thumbnail:deleteTemplate', streamsDir, templateId),
  thumbnailLoadCanvas: (folderPath: string, date: string, ordinal: number = 1) =>
    ipcRenderer.invoke('thumbnail:loadCanvas', folderPath, date, ordinal),
  thumbnailSaveCanvas: (folderPath: string, date: string, canvasFile: any, pngDataUrl: string, ordinal: number = 1) =>
    ipcRenderer.invoke('thumbnail:saveCanvas', folderPath, date, canvasFile, pngDataUrl, ordinal),
  /** List the ordinals of every SM-thumbnail variant present in the
   *  stream's folder. `[1]` for a legacy single-thumbnail stream, `[]`
   *  for none, `[1, 2]` for one + first alternative, etc. */
  thumbnailListVariants: (folderPath: string, date: string): Promise<number[]> =>
    ipcRenderer.invoke('thumbnail:listVariants', folderPath, date),
  thumbnailCacheAsset: (streamsDir: string, srcPath: string) =>
    ipcRenderer.invoke('thumbnail:cacheAsset', streamsDir, srcPath),
  thumbnailHashFile: (filePath: string): Promise<string | null> =>
    ipcRenderer.invoke('thumbnail:hashFile', filePath),
  thumbnailHashFiles: (filePaths: string[]): Promise<Record<string, string | null>> =>
    ipcRenderer.invoke('thumbnail:hashFiles', filePaths),
  thumbnailGetRecents: () =>
    ipcRenderer.invoke('thumbnail:getRecents'),
  thumbnailAddRecent: (entry: any) =>
    ipcRenderer.invoke('thumbnail:addRecent', entry),
  thumbnailRemoveRecent: (folderPath: string, date: string) =>
    ipcRenderer.invoke('thumbnail:removeRecent', folderPath, date),
  thumbnailClearRecents: () =>
    ipcRenderer.invoke('thumbnail:clearRecents'),
  playerGetRecents: () =>
    ipcRenderer.invoke('player:getRecents'),
  playerAddRecent: (entry: any) =>
    ipcRenderer.invoke('player:addRecent', entry),
  playerRemoveRecent: (filePath: string) =>
    ipcRenderer.invoke('player:removeRecent', filePath),
  playerClearRecents: () =>
    ipcRenderer.invoke('player:clearRecents'),
  thumbnailGetLastFont: () =>
    ipcRenderer.invoke('thumbnail:getLastFont'),
  thumbnailSetLastFont: (font: string) =>
    ipcRenderer.invoke('thumbnail:setLastFont', font),

  // ── Stream Relay ──────────────────────────────────────────────────────────
  // Localhost RTMP relay that forwards OBS/Aitum to YouTube. Subscriptions
  // (onRelayStatus / onRelayStats / etc.) return an unsubscribe function so
  // callers can clean up in React useEffect teardowns.
  streamRelayGetStatus: () =>
    ipcRenderer.invoke('stream-relay:get-status'),
  streamRelayEnable: () =>
    ipcRenderer.invoke('stream-relay:enable'),
  streamRelayDisable: () =>
    ipcRenderer.invoke('stream-relay:disable'),
  streamRelayReapplyConfig: () =>
    ipcRenderer.invoke('stream-relay:reapply-config'),
  onRelayStatus: (cb: (status: any) => void) => {
    const listener = (_: unknown, payload: any) => cb(payload)
    ipcRenderer.on('stream-relay:status', listener)
    return () => ipcRenderer.removeListener('stream-relay:status', listener)
  },
  onRelayStats: (cb: (stats: any) => void) => {
    const listener = (_: unknown, payload: any) => cb(payload)
    ipcRenderer.on('stream-relay:stats', listener)
    return () => ipcRenderer.removeListener('stream-relay:stats', listener)
  },
  onRelayStreamStarted: (cb: () => void) => {
    const listener = () => cb()
    ipcRenderer.on('stream-relay:stream-started', listener)
    return () => ipcRenderer.removeListener('stream-relay:stream-started', listener)
  },
  onRelayStreamStopped: (cb: (payload: { code: number | null }) => void) => {
    const listener = (_: unknown, payload: any) => cb(payload)
    ipcRenderer.on('stream-relay:stream-stopped', listener)
    return () => ipcRenderer.removeListener('stream-relay:stream-stopped', listener)
  },
  onRelayError: (cb: (msg: string) => void) => {
    const listener = (_: unknown, payload: any) => cb(payload)
    ipcRenderer.on('stream-relay:error', listener)
    return () => ipcRenderer.removeListener('stream-relay:error', listener)
  },
  streamRelayGetUpcomingBroadcasts: (force?: boolean) =>
    ipcRenderer.invoke('stream-relay:get-upcoming-broadcasts', force ?? false),
  streamRelayGetActiveBroadcast: () =>
    ipcRenderer.invoke('stream-relay:get-active-broadcast'),
  streamRelaySetActiveBroadcast: (broadcastId: string | null) =>
    ipcRenderer.invoke('stream-relay:set-active-broadcast', broadcastId),
  onRelayActiveBroadcastChanged: (cb: (result: any) => void) => {
    const listener = (_: unknown, payload: any) => cb(payload)
    ipcRenderer.on('stream-relay:active-changed', listener)
    return () => ipcRenderer.removeListener('stream-relay:active-changed', listener)
  },
  onRelayUpcomingChanged: (cb: (list: any) => void) => {
    const listener = (_: unknown, payload: any) => cb(payload)
    ipcRenderer.on('stream-relay:upcoming-changed', listener)
    return () => ipcRenderer.removeListener('stream-relay:upcoming-changed', listener)
  },
  onRelayLifecycle: (cb: (ev: any) => void) => {
    const listener = (_: unknown, payload: any) => cb(payload)
    ipcRenderer.on('stream-relay:lifecycle', listener)
    return () => ipcRenderer.removeListener('stream-relay:lifecycle', listener)
  },

  // ── File utilities ────────────────────────────────────────────────────────
  // File.prototype.path was removed in Electron 34; use webUtils instead.
  getPathForFile: (file: File): string => webUtils.getPathForFile(file)
})
