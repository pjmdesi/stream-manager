import { ipcMain, BrowserWindow, app } from 'electron'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { v4 as uuidv4 } from 'uuid'
import { getStore } from './store'

/** Form state for the simplified custom-preset editor. Stored on the preset so
 *  the user can re-open and edit it in form mode later, and so exports preserve
 *  enough metadata for a recipient to do the same. Absent for raw-text presets
 *  (and HandBrake-imported presets) — those open in Advanced mode only. */
export interface CustomPresetForm {
  container: 'mp4' | 'mkv' | 'mov' | 'webm'
  video: {
    codec: 'h264' | 'h265' | 'av1' | 'copy'
    /** Only meaningful when codec !== 'copy'. */
    encoder: 'cpu' | 'nvenc' | 'qsv' | 'amf'
    /** 0 (fastest, lower quality) → 100 (slowest, highest quality). Combined
     *  with the codec/encoder choice this controls both the CRF/CQ value AND
     *  the speed preset — they're tied together because a slower preset always
     *  produces better quality at the same numeric CRF. */
    quality: number
  }
  audio: {
    codec: 'aac' | 'mp3' | 'opus' | 'copy' | 'none'
    /** kbps. Ignored when codec is 'copy' or 'none'. */
    bitrate: number
    channels: 'original' | 'stereo' | 'mono'
    /** When true, every audio track in the input is preserved (re-encoded
     *  with the same codec/bitrate, or copied if codec='copy'). When false
     *  (default), ffmpeg's default behaviour applies: only the first audio
     *  stream is included. Most useful for OBS multi-track recordings. */
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
  /** Where this preset came from. 'imported' = HandBrake JSON; 'custom' =
   *  built in the simplified editor. Only set for non-builtin presets. */
  source?: 'imported' | 'custom'
  /** Snapshot of the form state when the preset was authored in the simplified
   *  editor. Lets the user re-open and edit in form mode. Absent when the
   *  preset was authored in Advanced (raw-args) mode or imported from HandBrake. */
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
  /** Display label for the group (e.g. "Archive · 2026-04-26"). */
  groupLabel?: string
  /** When true, the job's outputFile is a temp file alongside the input that
   *  replaces the input on success (unlink original → rename temp). Used for
   *  in-place archive operations. */
  replaceInput?: boolean
  /** Fired in the main process once every job sharing this groupId has reached
   *  status 'done'. Skipped if any job in the group failed or was cancelled. */
  groupCompletionHook?: GroupCompletionHook
}

const BUILTIN_PRESETS: ConversionPreset[] = [
  {
    id: 'youtube-h264',
    name: 'YouTube Ready (H.264)',
    description: 'Compress to 8Mbps H.264/AAC for YouTube upload',
    ffmpegArgs: '-c:v libx264 -b:v 8M -maxrate 8M -bufsize 16M -c:a aac -b:a 192k -movflags +faststart',
    outputExtension: 'mp4',
    isBuiltin: true
  },
  {
    id: 'compress-h265',
    name: 'Compress VOD (H.265)',
    description: 'Compress to 4Mbps H.265/AAC for smaller file size',
    ffmpegArgs: '-c:v libx265 -b:v 4M -maxrate 4M -bufsize 8M -c:a aac -b:a 128k -tag:v hvc1',
    outputExtension: 'mp4',
    isBuiltin: true
  },
  {
    id: 'extract-audio',
    name: 'Extract Audio Mix',
    description: 'Merge all audio tracks to stereo MP3',
    ffmpegArgs: '-vn -c:a libmp3lame -b:a 320k -ac 2',
    outputExtension: 'mp3',
    isBuiltin: true
  },
  {
    id: 'fast-preview',
    name: 'Fast Web Preview',
    description: 'Low bitrate quick preview version for web',
    ffmpegArgs: '-c:v libx264 -b:v 1M -maxrate 1M -bufsize 2M -c:a aac -b:a 96k -preset ultrafast -movflags +faststart',
    outputExtension: 'mp4',
    isBuiltin: true
  },
  {
    id: 'lossless-copy',
    name: 'Lossless Copy (Remux to MP4)',
    description: 'Stream copy to MP4 container (no re-encoding)',
    ffmpegArgs: '-c:v copy -c:a copy',
    outputExtension: 'mp4',
    isBuiltin: true
  },
  {
    id: 'archive-av1',
    name: 'Archive (SVT-AV1)',
    description: 'Cold storage archive — CRF 28 SVT-AV1, preserves fine detail at a strong size ratio. Auto-swaps to a hardware AV1 encoder (NVENC / QSV / AMF) when one is available.',
    ffmpegArgs: '-c:v libsvtav1 -crf 28 -preset 6 -c:a aac -b:a 128k',
    outputExtension: 'mkv',
    isBuiltin: true
  },
  {
    id: 'archive-h265',
    name: 'Archive (H.265)',
    description: 'Cold storage archive — CRF 26 H.265, widely compatible. GPU-accelerated automatically if available.',
    ffmpegArgs: '-c:v libx265 -crf 26 -c:a aac -b:a 128k',
    outputExtension: 'mkv',
    isBuiltin: true
  }
]

// Job registry
const jobs = new Map<string, ConversionJob>()
const cancellers = new Map<string, () => void>()
const pausers   = new Map<string, () => void>()
const resumers  = new Map<string, () => void>()
// Set when a job is in the cloud-download wait so the renderer-driven cancel
// can flip the flag and let the poll loop exit promptly. Per job id.
const downloadCancelFlags = new Map<string, { cancelled: boolean }>()
// Tracks job IDs whose pre-encode hydrate task has already been kicked off.
// Prevents duplicate hydrate loops if addQueuedGroup is somehow called twice
// for overlapping job sets, or if a job that already finished hydrating in
// background later gets picked up by startConversionJob's inline hydrate.
const hydrateInFlight = new Set<string>()

/** Broadcast an IPC event to every renderer window. Module-scoped so
 *  helpers outside startConversionJob can notify status changes too. */
function notifyAll(channel: string, data: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(channel, data)
  }
}

/** Update a job's status in the registry and notify renderers. No-op when
 *  the job has been removed from the registry (e.g. cancelled + cleared). */
function setJobStatus(jobId: string, status: ConversionJob['status']): void {
  const cur = jobs.get(jobId)
  if (!cur) return
  jobs.set(jobId, { ...cur, status })
  notifyAll('converter:jobStatus', { jobId, status })
}

/**
 * Pre-encode hydrate task. Runs in parallel for every job in a group so the
 * second/third/etc. files don't sit idle as 'queued' while the first one
 * downloads — they all start hydrating at the same time. The encode phase
 * still serializes (one ffmpeg at a time per group) via startNextInGroup.
 *
 * Lifecycle:
 *   queued → 'downloading' → (poll) → 'queued' (hydrated, ready to encode)
 *
 * Cancellation flips the same flag startConversionJob's inline hydrate uses,
 * so the existing cancel IPC works without changes.
 */
async function ensureHydrated(jobId: string): Promise<void> {
  const job = jobs.get(jobId)
  if (!job) return
  if (hydrateInFlight.has(jobId)) return
  hydrateInFlight.add(jobId)
  try {
    const { isFileConfirmedLocal, checkLocalFiles } = await import('./files')
    // Cheap upfront check — if the file is already local, no work to do.
    if (isFileConfirmedLocal(job.inputFile)) return
    // Don't kick off if the job has already been advanced past 'queued'
    // (e.g. cancelled before this task got scheduled).
    const cur = jobs.get(jobId)
    if (!cur || cur.status !== 'queued') return

    setJobStatus(jobId, 'downloading')
    const flag = { cancelled: false }
    downloadCancelFlags.set(jobId, flag)
    cancellers.set(jobId, () => { flag.cancelled = true })

    // Touching the file is what nudges the OS sync provider to start
    // hydrating. Reading 1 byte is enough; the actual content streams in
    // afterward as the provider downloads it.
    fs.open(job.inputFile, 'r', (err, fd) => {
      if (err) return
      const buf = Buffer.alloc(1)
      fs.read(fd, buf, 0, 1, 0, () => fs.close(fd, () => {}))
    })

    // Async batch poll — non-blocking PowerShell call, won't tie up the
    // main thread when many parallel hydrates are running concurrently.
    while (!flag.cancelled) {
      const [local] = await checkLocalFiles([job.inputFile])
      if (local) break
      await new Promise(r => setTimeout(r, 2000))
    }

    downloadCancelFlags.delete(jobId)
    cancellers.delete(jobId)

    if (flag.cancelled) {
      // Cancelled mid-hydrate. Mark the job and let the group orchestrator
      // pick the next one (cancel doesn't short-circuit the rest of the
      // group, matching the "errors don't abort the whole batch" pattern).
      const cur2 = jobs.get(jobId)
      if (cur2) {
        jobs.set(jobId, { ...cur2, status: 'cancelled' })
        notifyAll('converter:jobStatus', { jobId, status: 'cancelled' })
        notifyAll('converter:jobError', { jobId, error: 'Cancelled' })
      }
      if (job.groupId) startNextInGroup(job.groupId)
      return
    }

    // Hydrate finished — drop back to 'queued' so startNextInGroup can pick
    // it up when the encoder slot frees. If it's already free (no other
    // group sibling is encoding), this kicks the encode immediately.
    setJobStatus(jobId, 'queued')
    if (job.groupId) startNextInGroup(job.groupId)
  } finally {
    hydrateInFlight.delete(jobId)
  }
}

// ── Pending-queue persistence ─────────────────────────────────────────────
// Only jobs with status 'queued' (auto-rules with start-immediately disabled)
// survive across restarts. Running/paused/done/error/cancelled are dropped
// because their underlying ffmpeg state isn't recoverable.
const PENDING_JOBS_KEY = 'pendingJobs'

function persistPendingJobs(): void {
  const queued = [...jobs.values()].filter(j => j.status === 'queued')
  getStore().set(PENDING_JOBS_KEY, queued)
}

export function restorePendingJobs(): void {
  const persisted = (getStore().get(PENDING_JOBS_KEY, []) as ConversionJob[]) || []
  let dropped = 0
  for (const job of persisted) {
    if (job.status !== 'queued') continue
    // Drop entries whose source no longer exists — the job would fail anyway.
    if (!fs.existsSync(job.inputFile)) { dropped++; continue }
    jobs.set(job.id, { ...job, progress: 0 })
  }
  if (dropped > 0) {
    console.warn(`[converter] dropped ${dropped} pending job(s) — input file missing`)
    persistPendingJobs()
  }
}

// ── HandBrake JSON → ffmpeg args translation ───────────────────────────────

const VIDEO_CODEC_MAP: Record<string, string> = {
  nvenc_h265:  'hevc_nvenc',
  nvenc_h264:  'h264_nvenc',
  x264:        'libx264',
  x265:        'libx265',
  qsv_h264:    'h264_qsv',
  qsv_h265:    'hevc_qsv',
  vce_h264:    'h264_amf',
  vce_h265:    'hevc_amf',
  theora:      'libtheora',
  VP8:         'libvpx',
  VP9:         'libvpx-vp9',
  ffv1:        'ffv1',
}

const AUDIO_CODEC_MAP: Record<string, string> = {
  av_aac:    'aac',
  fdk_aac:   'libfdk_aac',
  mp3:       'libmp3lame',
  vorbis:    'libvorbis',
  opus:      'libopus',
  ac3:       'ac3',
  eac3:      'eac3',
  flac16:    'flac',
  flac24:    'flac',
}

const MIXDOWN_CHANNELS: Record<string, number> = {
  mono:     1,
  stereo:   2,
  '5point1': 6,
  '6point1': 7,
  '7point1': 8,
}

const FORMAT_TO_EXT: Record<string, string> = {
  av_mp4:  'mp4',
  av_mkv:  'mkv',
  av_webm: 'webm',
}

function hbPresetToFfmpegArgs(p: any): string {
  const args: string[] = []

  // ── Video codec ────────────────────────────────────────────────────────────
  const videoCodec = VIDEO_CODEC_MAP[p.VideoEncoder] ?? p.VideoEncoder ?? 'libx264'
  args.push(`-c:v ${videoCodec}`)

  // Quality
  if (p.VideoQualityType === 2) {
    const q = p.VideoQualitySlider ?? 23
    // NVENC / hardware encoders use -cq; software encoders use -crf
    if (videoCodec.includes('nvenc') || videoCodec.includes('qsv') || videoCodec.includes('amf')) {
      args.push(`-cq ${q}`)
    } else {
      args.push(`-crf ${q}`)
    }
  } else if (p.VideoQualityType === 1 && p.VideoAvgBitrate) {
    args.push(`-b:v ${p.VideoAvgBitrate}k`)
  }

  // Encoder speed preset
  if (p.VideoPreset && p.VideoPreset !== 'none') {
    args.push(`-preset ${p.VideoPreset}`)
  }

  // Tune (x264/x265)
  if (p.VideoTune && p.VideoTune !== '' && p.VideoTune !== 'none') {
    args.push(`-tune ${p.VideoTune}`)
  }

  // Extra encoder options ("key=value:key2=value2")
  if (p.VideoOptionExtra) {
    for (const pair of p.VideoOptionExtra.split(/[:;]/)) {
      const eq = pair.indexOf('=')
      if (eq > 0) {
        args.push(`-${pair.slice(0, eq).trim()}`, pair.slice(eq + 1).trim())
      } else if (pair.trim()) {
        args.push(`-${pair.trim()}`)
      }
    }
  }

  // ── Audio codec ────────────────────────────────────────────────────────────
  const audioList: any[] = p.AudioList ?? []
  const a = audioList[0]

  if (a) {
    const isCopy = a.AudioEncoder?.startsWith('copy')
    const audioCodec = isCopy ? 'copy' : (AUDIO_CODEC_MAP[a.AudioEncoder] ?? 'aac')

    // Map all audio tracks when the preset requests it
    if (p.AudioTrackSelectionBehavior === 'all') {
      args.push('-map', '0:v:0', '-map', '0:a')
    }

    args.push(`-c:a ${audioCodec}`)

    if (!isCopy) {
      if (a.AudioBitrate) args.push(`-b:a ${a.AudioBitrate}k`)
      const ch = MIXDOWN_CHANNELS[a.AudioMixdown]
      if (ch) args.push(`-ac ${ch}`)
    }
  }

  // Web optimisation (faststart for MP4)
  if (p.Optimize) args.push('-movflags +faststart')

  return args.join(' ')
}

function parseHBJson(jsonContent: string, id: string): ConversionPreset {
  const data = JSON.parse(jsonContent)
  const p = data.PresetList?.[0] ?? {}

  const name: string = p.PresetName || 'Imported Preset'
  const outputExtension: string = FORMAT_TO_EXT[p.FileFormat] ?? 'mp4'
  const ffmpegArgs = hbPresetToFfmpegArgs(p)

  // Human-readable description
  const codec = VIDEO_CODEC_MAP[p.VideoEncoder] ?? p.VideoEncoder ?? 'unknown'
  const qualityStr = p.VideoQualityType === 2 ? `CQ/CRF ${p.VideoQualitySlider}` : ''
  const description = [codec, qualityStr, p.VideoPreset].filter(Boolean).join(', ')

  return { id, name, description, ffmpegArgs, outputExtension, isBuiltin: false }
}

// ── Preset storage ─────────────────────────────────────────────────────────

function getPresetsDir(): string {
  const dir = path.join(app.getPath('userData'), 'hb-presets')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

// ── IPC handlers ───────────────────────────────────────────────────────────

/** Broadcast a job-added event so any renderer window (e.g. ConverterPage) appends it to local state. */
function broadcastJobAdded(job: ConversionJob): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('converter:jobAdded', job)
  }
}

/** Add a job in the queued state WITHOUT running it. Used by auto-rules when the user has
 * opted out of "start immediately" — the user manually starts it from the ConverterPage. */
export function addPendingJob(job: ConversionJob): string {
  const id = job.id || uuidv4()
  const queuedJob: ConversionJob = { ...job, id, status: 'queued', progress: 0 }
  jobs.set(id, queuedJob)
  persistPendingJobs()
  broadcastJobAdded(queuedJob)
  return id
}

/** Start the first queued job in a group. Used to serialize execution within
 *  a group (archive batches) — kicked off when a group is submitted, then
 *  re-fired on each job-end so the next one begins.
 *
 *  Note: 'downloading' is NOT considered in-flight here because hydrate runs
 *  in parallel for the whole group via ensureHydrated(). Only encoding-phase
 *  states (running / replacing / paused) block the next encode slot. */
function startNextInGroup(groupId: string): void {
  const groupJobs = [...jobs.values()].filter(j => j.groupId === groupId)
  const encoding = groupJobs.some(j =>
    j.status === 'running' || j.status === 'replacing' || j.status === 'paused'
  )
  if (encoding) return
  // Pick the first 'queued' job (preserves submission order). Note this
  // catches both already-hydrated jobs and any that haven't been touched
  // yet — startConversionJob's inline hydrate handles the latter as a
  // fallback if a job somehow slips through ensureHydrated.
  const next = groupJobs.find(j => j.status === 'queued')
  if (!next) return
  startConversionJob(next).catch(() => { /* error broadcast separately */ })
}

/** Best-effort delete of a file that may be temporarily locked. Aimed at temp
 *  files left by killed/failed ffmpeg processes — Windows can take longer than
 *  expected to release file handles after process termination, especially when
 *  cloud-sync clients (Synology Drive, OneDrive) or AV products are scanning.
 *
 *  Strategy: ~30s window with a slowly-escalating retry. If after that the
 *  file is still locked, log a warning so the user knows (we can't cleanly
 *  recover — they'll need to remove it manually). */
function deleteWithRetry(filePath: string, label: string): void {
  if (!filePath) return
  // Delays in ms — about 30s total before giving up.
  const delays = [250, 500, 750, 1000, 1500, 2000, 2500, 3000, 4000, 5000, 5000, 5000]
  let attempt = 0
  const tryOnce = () => {
    if (!fs.existsSync(filePath)) return
    try {
      fs.unlinkSync(filePath)
    } catch (err: any) {
      attempt++
      if (attempt < delays.length) {
        setTimeout(tryOnce, delays[attempt])
      } else {
        console.warn(`[converter] could not delete ${label} after ${delays.length} attempts:`, filePath, err?.message)
      }
    }
  }
  setTimeout(tryOnce, delays[0])
}

/** Resolve a preset by id from builtins or the user's imported presets store. */
export function getPresetById(id: string): ConversionPreset | null {
  const builtin = BUILTIN_PRESETS.find(p => p.id === id)
  if (builtin) return builtin
  const imported = getStore().get('importedPresets', []) as ConversionPreset[]
  return imported.find(p => p.id === id) ?? null
}

/** Start a conversion job. Broadcasts progress/complete/error events to all renderer windows so
 * the ConversionWidget stays in sync regardless of which process triggered the job. Returns the
 * job id immediately and a `done` promise that resolves on completion (or rejects on error).
 * Used by both the `converter:addToQueue` IPC and auto-rules (fileWatcher).
 *
 * Now also handles two extra modes:
 *   - cloud-placeholder inputs: detected via Windows attribute mask; the job
 *     enters status='downloading', triggers the OS cloud-sync hydrate, and
 *     polls until the file is local (or the cancel flag fires) before ffmpeg
 *     starts. Avoids long ffmpeg blocking on a syscall that can't be cleanly
 *     cancelled.
 *   - replaceInput: the configured outputFile is treated as a temp path next
 *     to the input; on successful encode we unlink the input and rename the
 *     temp into place. Used by archive jobs.
 */
export async function startConversionJob(
  job: ConversionJob,
  onProgress?: (pct: number) => void
): Promise<{ id: string; done: Promise<void> }> {
  const id = job.id || uuidv4()
  const newJob: ConversionJob = { ...job, id, status: 'running', progress: 0 }
  jobs.set(id, newJob)
  // If this job was previously queued, drop it from the persisted queue now that it's running.
  persistPendingJobs()

  const notifyAll = (channel: string, data: any) => {
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) w.webContents.send(channel, data)
    }
  }
  const setStatus = (status: ConversionJob['status']) => {
    const cur = jobs.get(id)
    if (!cur) return
    jobs.set(id, { ...cur, status })
    notifyAll('converter:jobStatus', { jobId: id, status })
  }
  notifyAll('converter:jobProgress', { jobId: id, percent: 0 })

  const handleProgress = (percent: number) => {
    const j = jobs.get(id)
    if (j) jobs.set(id, { ...j, progress: percent })
    notifyAll('converter:jobProgress', { jobId: id, percent })
    onProgress?.(percent)
  }

  const done = new Promise<void>((resolve, reject) => {
    const handleComplete = () => {
      const cur = jobs.get(id)!
      // For replaceInput jobs the output is a temp file — swap it into the
      // input's place before declaring success. If the preset's output
      // extension differs from the input's (e.g. archiving a .mp4 with an
      // mkv-output preset), the final file takes the new extension so the
      // container matches the actual content.
      if (job.replaceInput) {
        setStatus('replacing')
        try {
          const inputExt = (job.inputFile.match(/\.[^.]+$/)?.[0] ?? '').toLowerCase()
          const outputExt = (job.outputFile.match(/\.[^.]+$/)?.[0] ?? '').toLowerCase()
          const finalPath = inputExt === outputExt
            ? job.inputFile
            : job.inputFile.replace(/\.[^.]+$/, outputExt)
          fs.unlinkSync(job.inputFile)
          fs.renameSync(job.outputFile, finalPath)
        } catch (e: any) {
          try { if (fs.existsSync(job.outputFile)) fs.unlinkSync(job.outputFile) } catch {}
          handleError(new Error(`Replace failed: ${e.message}`))
          return
        }
      }
      jobs.set(id, { ...cur, status: 'done', progress: 100 })
      cancellers.delete(id)
      pausers.delete(id)
      resumers.delete(id)
      downloadCancelFlags.delete(id)
      notifyAll('converter:jobComplete', { jobId: id, outputPath: job.outputFile })
      // Group bookkeeping — fire completion hook if this is the last successful
      // job in the group (and no group siblings have failed/cancelled).
      maybeFireGroupHook(id)
      // Advance the group: start the next queued job in the same group.
      if (job.groupId) startNextInGroup(job.groupId)
      resolve()
    }
    const handleError = (err: Error) => {
      jobs.set(id, { ...jobs.get(id)!, status: 'error', error: err.message })
      cancellers.delete(id)
      pausers.delete(id)
      resumers.delete(id)
      downloadCancelFlags.delete(id)
      notifyAll('converter:jobError', { jobId: id, error: err.message })
      // For replaceInput jobs, clean up the temp output that ffmpeg wrote
      // before failing — otherwise __arc_tmp.* files accumulate.
      if (job.replaceInput && job.outputFile) {
        deleteWithRetry(job.outputFile, 'archive temp file (error path)')
      }
      // Group bookkeeping — a failure short-circuits the hook for the whole group.
      maybeFireGroupHook(id)
      // Group continues despite errors (preserves the prior archive behaviour
      // of trying every file in the folder even if some fail).
      if (job.groupId) startNextInGroup(job.groupId)
      reject(err)
    }
    ;(async () => {
      try {
        // ── Cloud-hydrate wait ──────────────────────────────────────────────
        // If the input is a cloud placeholder, kick the OS into hydrating it
        // and poll until it's local. Cancel-aware — the cancel IPC flips the
        // flag, the next poll iteration sees it and aborts.
        const { isFileConfirmedLocal } = await import('./files')
        if (!isFileConfirmedLocal(job.inputFile)) {
          setStatus('downloading')
          const flag = { cancelled: false }
          downloadCancelFlags.set(id, flag)
          // Cancel handler available during the download wait — the cancel IPC
          // looks up cancellers.get(id) and calls it.
          cancellers.set(id, () => { flag.cancelled = true })
          fs.open(job.inputFile, 'r', (err, fd) => {
            if (err) return
            const buf = Buffer.alloc(1)
            fs.read(fd, buf, 0, 1, 0, () => fs.close(fd, () => {}))
          })
          while (!flag.cancelled && !isFileConfirmedLocal(job.inputFile)) {
            await new Promise(r => setTimeout(r, 2000))
          }
          downloadCancelFlags.delete(id)
          if (flag.cancelled) {
            handleError(new Error('Cancelled'))
            return
          }
          setStatus('running')
        }

        const { runConversion, applyGpuAcceleration, probeFile } = await import('../services/ffmpegService')
        let gpuArgs = await applyGpuAcceleration(job.preset.ffmpegArgs)
        // Stamp archive outputs with a provenance tag in the file's container
        // metadata so the file itself remembers it's been archived (survives
        // moves/renames/_meta.json loss). Detection looks for "Archived
        // Stream" — a generic marker that survives any product-name change.
        if (job.groupCompletionHook?.type === 'archiveMarkAsArchived') {
          const { app } = await import('electron')
          gpuArgs = `${gpuArgs} -metadata encoded_by="Archived Stream — Stream Manager v${app.getVersion()}"`
        }
        const duration = await probeFile(job.inputFile).then(info => info.duration).catch(() => 0)
        const result = runConversion(job.inputFile, job.outputFile, gpuArgs, duration, handleProgress, handleComplete, handleError)
        cancellers.set(id, result.cancel)
        pausers.set(id, result.pause)
        resumers.set(id, result.resume)
      } catch (err: any) {
        handleError(err instanceof Error ? err : new Error(String(err)))
      }
    })()
  })

  return { id, done }
}

/** Group-completion bookkeeping. When all jobs sharing a groupId have
 *  finished AND every one succeeded, fire the configured hook. Any failure
 *  or cancellation short-circuits the hook for the whole group. */
function maybeFireGroupHook(jobId: string): void {
  const job = jobs.get(jobId)
  if (!job?.groupId) return
  const groupJobs = [...jobs.values()].filter(j => j.groupId === job.groupId)
  const finalStates: ConversionJob['status'][] = ['done', 'error', 'cancelled']
  if (groupJobs.some(j => !finalStates.includes(j.status))) return
  // All done — but only fire if every one succeeded.
  const allSucceeded = groupJobs.every(j => j.status === 'done')
  if (!allSucceeded) return
  // Find the hook on any job in the group (we copy it onto every group job at
  // submission, so any of them works).
  const hook = groupJobs.find(j => j.groupCompletionHook)?.groupCompletionHook
  if (!hook) return
  fireGroupCompletionHook(hook).catch(err =>
    console.error('[converter] group completion hook failed:', err)
  )
}

async function fireGroupCompletionHook(hook: GroupCompletionHook): Promise<void> {
  if (hook.type === 'archiveMarkAsArchived') {
    // Read + write _meta.json in the streams root, marking the date entry as
    // archived. Mirrors the inline logic the old archiveFolders used to run.
    const { streamsDir, date } = hook
    const metaPath = path.join(streamsDir, '_meta.json')
    let allMeta: Record<string, any> = {}
    try { allMeta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) } catch {}
    allMeta[date] = {
      ...(allMeta[date] ?? { date, streamType: ['games'], games: [], comments: '' }),
      archived: true,
    }
    // On Windows the _meta.json is hidden (+H attribute) — unhide before write,
    // re-hide after.
    const isWin = process.platform === 'win32'
    if (isWin && fs.existsSync(metaPath)) {
      try { (await import('child_process')).spawnSync('attrib', ['-H', metaPath], { timeout: 2000 }) } catch {}
    }
    fs.writeFileSync(metaPath, JSON.stringify(allMeta, null, 2), 'utf-8')
    if (isWin) {
      try { (await import('child_process')).spawnSync('attrib', ['+H', metaPath], { timeout: 2000 }) } catch {}
    }
    // Tell the renderer to refresh the streams page.
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) w.webContents.send('streams:changed')
    }
  }
}

export function getConverterStatus(): { active: boolean; percent: number; label: string } {
  const running = [...jobs.values()].filter(j => j.status === 'running' || j.status === 'queued')
  if (running.length === 0) return { active: false, percent: 0, label: 'Idle' }
  const current = running.find(j => j.status === 'running') ?? running[0]
  const name = current.outputFile.split(/[\\/]/).pop() ?? ''
  const queued = running.length - 1
  const label = queued > 0 ? `${Math.round(current.progress ?? 0)}% — ${name} (+${queued} queued)` : `${Math.round(current.progress ?? 0)}% — ${name}`
  return { active: true, percent: current.progress ?? 0, label }
}

export function getActiveConversionCounts(): { running: number; queued: number } {
  let running = 0, queued = 0
  for (const j of jobs.values()) {
    if (j.status === 'running') running++
    else if (j.status === 'queued') queued++
  }
  return { running, queued }
}

export function registerConverterIPC(): void {
  // Restore queued jobs persisted from a previous session
  restorePendingJobs()

  ipcMain.handle('converter:getBuiltinPresets', async () => BUILTIN_PRESETS)

  /** Probe the given files for the archive-provenance tag we write into the
   *  container metadata (`encoded_by` containing "Archived Stream").
   *  Returns the subset of paths that are tagged. Cloud placeholders are
   *  excluded — probing them would force a hydrate, which we never want for
   *  a pre-flight check. */
  ipcMain.handle('converter:checkAlreadyArchived', async (_event, paths: string[]): Promise<string[]> => {
    if (!Array.isArray(paths) || paths.length === 0) return []
    const { checkLocalFiles } = await import('./files')
    const localFlags = await checkLocalFiles(paths)
    const eligible = paths.filter((_, i) => localFlags[i])
    if (eligible.length === 0) return []
    const { probeArchiveTag } = await import('../services/ffmpegService')
    // Cap concurrency so a 60-probe pre-flight doesn't overwhelm the system.
    const CONCURRENCY = 4
    const tagged: string[] = []
    let cursor = 0
    const workers = Array.from({ length: Math.min(CONCURRENCY, eligible.length) }, async () => {
      while (cursor < eligible.length) {
        const idx = cursor++
        const p = eligible[idx]
        try {
          const tag = await probeArchiveTag(p)
          if (tag && tag.includes('Archived Stream')) tagged.push(p)
        } catch { /* skip files that fail to probe */ }
      }
    })
    await Promise.all(workers)
    return tagged
  })

  ipcMain.handle('converter:checkEncoderAvailable', async (_event, name: string) => {
    const { checkEncoderAvailable } = await import('../services/ffmpegService')
    return checkEncoderAvailable(name)
  })

  /** Returns the set of GPU encoder names that actually work on this machine
   *  (probed by invoking each one against a synthetic frame). Differs from
   *  checkEncoderAvailable, which only tells you whether the encoder is
   *  compiled into the binary. */
  ipcMain.handle('converter:detectAvailableEncoders', async (): Promise<string[]> => {
    const { detectAvailableEncoders } = await import('../services/ffmpegService')
    return [...await detectAvailableEncoders()]
  })

  ipcMain.handle('converter:importPreset', async (_event, srcPath: string) => {
    const content = fs.readFileSync(srcPath, 'utf-8')
    const data = JSON.parse(content)
    if (!data.PresetList || !Array.isArray(data.PresetList) || data.PresetList.length === 0) {
      throw new Error('Not a valid HandBrake preset file (no PresetList found).')
    }

    const uid = uuidv4()
    const destPath = path.join(getPresetsDir(), `${uid}.json`)
    fs.copyFileSync(srcPath, destPath)

    const preset = parseHBJson(content, `hb-${uid}`)

    const store = getStore()
    const existing: ConversionPreset[] = store.get('importedPresets', []) as ConversionPreset[]
    store.set('importedPresets', [...existing, preset])

    return preset
  })

  ipcMain.handle('converter:getImportedPresets', async () => {
    const store = getStore()
    const presets = store.get('importedPresets', []) as ConversionPreset[]

    // Heal any stored presets that have empty ffmpegArgs by re-translating from their source JSON
    let changed = false
    const healed = presets.map(p => {
      if (p.ffmpegArgs) return p
      const uid = p.id.replace(/^hb-/, '')
      const jsonPath = path.join(getPresetsDir(), `${uid}.json`)
      try {
        const content = fs.readFileSync(jsonPath, 'utf-8')
        const fresh = parseHBJson(content, p.id)
        changed = true
        return { ...p, ffmpegArgs: fresh.ffmpegArgs, outputExtension: fresh.outputExtension }
      } catch (_) {
        return p
      }
    })

    if (changed) store.set('importedPresets', healed)
    return healed
  })

  ipcMain.handle('converter:deleteImportedPreset', async (_event, id: string) => {
    const store = getStore()
    const presets: ConversionPreset[] = store.get('importedPresets', []) as ConversionPreset[]
    // Clean up the stored JSON file (id = "hb-{uuid}")
    const uid = id.replace(/^hb-/, '')
    const jsonPath = path.join(getPresetsDir(), `${uid}.json`)
    try { fs.unlinkSync(jsonPath) } catch (_) {}
    store.set('importedPresets', presets.filter(p => p.id !== id))
  })

  ipcMain.handle('converter:renameImportedPreset', async (_event, id: string, newName: string) => {
    const store = getStore()
    const presets: ConversionPreset[] = store.get('importedPresets', []) as ConversionPreset[]
    store.set('importedPresets', presets.map(p => p.id === id ? { ...p, name: newName.trim() } : p))
  })

  /** Save a preset built in the simplified editor. Stored alongside imported
   *  presets — same store key, distinguished by `source: 'custom'`. */
  ipcMain.handle('converter:saveCustomPreset', async (_event, preset: ConversionPreset): Promise<string> => {
    const id = preset.id || `custom-${uuidv4()}`
    const stored: ConversionPreset = {
      ...preset,
      id,
      isBuiltin: false,
      source: 'custom',
    }
    const store = getStore()
    const existing = store.get('importedPresets', []) as ConversionPreset[]
    // If an id was provided and already exists, treat as edit (replace in
    // place, preserving order).
    const idx = existing.findIndex(p => p.id === id)
    const next = idx >= 0 ? existing.map((p, i) => i === idx ? stored : p) : [...existing, stored]
    store.set('importedPresets', next)
    return id
  })

  ipcMain.handle('converter:addToQueue', async (_event, job: ConversionJob) => {
    const { id, done } = await startConversionJob(job)
    // Don't await `done` — the renderer gets completion via the broadcast 'converter:jobComplete' event.
    done.catch(() => { /* error broadcast separately */ })
    return id
  })

  // Add a batch of jobs (all sharing a groupId) and start the first one. The
  // rest enter 'queued' state and start one-by-one as each preceding one
  // finishes (handleComplete/handleError → startNextInGroup). Used by the
  // archive flow so multiple files in a folder don't fight for ffmpeg / GPU
  // resources.
  ipcMain.handle('converter:addQueuedGroup', async (_event, jobsList: ConversionJob[]): Promise<string[]> => {
    const ids: string[] = []
    for (const j of jobsList) ids.push(addPendingJob(j))
    // Kick off hydrate for every job in parallel — files needing cloud
    // download all start hydrating immediately rather than waiting their
    // turn behind the previous file's encode. Each ensureHydrated task
    // fires startNextInGroup when it completes, so encoding starts as
    // soon as the first hydrated job finishes (or immediately if a file
    // was already local).
    for (const id of ids) {
      ensureHydrated(id).catch(() => { /* hydrate errors handled per-task */ })
    }
    const groupIds = new Set(jobsList.map(j => j.groupId).filter(Boolean) as string[])
    for (const gid of groupIds) startNextInGroup(gid)
    return ids
  })

  // Start a job that was previously added in the 'queued' state (e.g. from an auto-rule
  // with "Start conversion immediately" unchecked).
  ipcMain.handle('converter:startQueued', async (_event, jobId: string) => {
    const existing = jobs.get(jobId)
    if (!existing || existing.status !== 'queued') return
    const { done } = await startConversionJob(existing)
    done.catch(() => { /* error broadcast separately */ })
  })

  ipcMain.handle('converter:addClipToQueue', async (event, params: {
    job: ConversionJob
    clipRegions: Array<{ id: string; inPoint: number; outPoint: number; cropX?: number; cropY?: number; cropScale?: number }>
    cropAspect: 'off' | 'original' | '16:9' | '1:1' | '9:16'
    cropX: number
    videoWidth: number
    videoHeight: number
    bleepRegions: Array<{ id: string; start: number; end: number }>
    bleepVolume: number
  }) => {
    const { job, clipRegions, cropAspect, cropX, videoWidth, videoHeight, bleepRegions, bleepVolume } = params
    if (clipRegions.length === 0) return
    const id = job.id || uuidv4()

    const totalDuration = clipRegions.reduce((acc, r) => acc + (r.outPoint - r.inPoint), 0)
    const hasCrop  = cropAspect !== 'off'
    const hasBleep = bleepRegions.length > 0
    const n = clipRegions.length

    const { extractSegmentToFile, runClipConversion, probeFile, applyGpuAcceleration } = await import('../services/ffmpegService')
    const fileInfo = await probeFile(job.inputFile).catch(() => null)
    const audioTrackCount = fileInfo?.audioTracks?.length ?? 1
    const hasMultiTrack = audioTrackCount > 1

    // Resolve the target aspect ratio (width / height). 'original' uses the video's native ratio.
    const videoAspect = videoWidth / videoHeight
    const ar =
      cropAspect === '16:9' ? 16 / 9 :
      cropAspect === '9:16' ? 9 / 16 :
      cropAspect === '1:1'  ? 1 :
      videoAspect  // 'original' / 'off'

    // Max crop box at scale=1 — snugly fits within the video, limited by whichever dim matches the aspect.
    let maxCropW: number, maxCropH: number
    if (ar > videoAspect) { maxCropW = videoWidth;  maxCropH = videoWidth / ar }
    else                  { maxCropH = videoHeight; maxCropW = videoHeight * ar }

    // Compute per-region crop geometry.
    const regionCrops = clipRegions.map(r => {
      const rCropX = r.cropX ?? cropX
      const rCropY = r.cropY ?? 0.5
      const rScale = r.cropScale ?? 1
      const rCropW = Math.floor(maxCropW * rScale / 2) * 2
      const rCropH = Math.floor(maxCropH * rScale / 2) * 2
      const rOffsetX = Math.floor(rCropX * (videoWidth - rCropW) / 2) * 2
      const rOffsetY = Math.floor(rCropY * (videoHeight - rCropH) / 2) * 2
      return { cropW: rCropW, cropH: rCropH, offsetX: rOffsetX, offsetY: rOffsetY }
    })
    // Unified output dims = largest cropped size (i.e. scale=1 region if any exists). Other segments
    // get upscaled to match. This keeps all segments the same resolution for concat.
    const outW = regionCrops.length > 0 ? Math.max(...regionCrops.map(c => c.cropW)) : Math.floor(maxCropW / 2) * 2
    const outH = regionCrops.length > 0 ? Math.max(...regionCrops.map(c => c.cropH)) : Math.floor(maxCropH / 2) * 2
    const sampleRate  = fileInfo?.audioTracks?.[0]?.sampleRate ?? 48000

    // -bf 0: disable B-frames — prevents DTS/PTS ordering confusion at concat boundaries
    // -g 60: keyframe every 60 frames (~1s at 60fps) — simpler than expr: and works on GPU encoders
    const rawCodecArgs = '-c:v libx264 -crf 18 -preset fast -bf 0 -g 60 -c:a aac -b:a 192k -ac 2'
    const gpuCodecArgs = await applyGpuAcceleration(rawCodecArgs)
    const outputArgs = ['-map', '[vout]', '-map', '[aout]', ...gpuCodecArgs.split(/\s+/).filter(Boolean)]

    // Register the job immediately so it appears in the UI
    const newJob: ConversionJob = { ...job, id, status: 'running', progress: 0 }
    jobs.set(id, newJob)

    const win = BrowserWindow.fromWebContents(event.sender)

    const sendProgress = (percent: number) => {
      const j = jobs.get(id)
      if (j) jobs.set(id, { ...j, progress: percent })
      if (win && !win.isDestroyed()) win.webContents.send('converter:jobProgress', { jobId: id, percent })
    }
    const onComplete = () => {
      jobs.set(id, { ...jobs.get(id)!, status: 'done', progress: 100 })
      cancellers.delete(id); pausers.delete(id); resumers.delete(id)
      if (win && !win.isDestroyed()) win.webContents.send('converter:jobComplete', { jobId: id, outputPath: job.outputFile })
    }
    const onError = (err: Error) => {
      jobs.set(id, { ...jobs.get(id)!, status: 'error', error: err.message })
      cancellers.delete(id); pausers.delete(id); resumers.delete(id)
      if (win && !win.isDestroyed()) win.webContents.send('converter:jobError', { jobId: id, error: err.message })
    }

    win?.webContents.send('converter:jobProgress', { jobId: id, percent: 0 })

    // Temp directory — one MKV per segment will be stream-copied here
    const tempDir = path.join(os.tmpdir(), `sm-clip-${id}`)
    fs.mkdirSync(tempDir, { recursive: true })

    const cleanup = () => {
      try { fs.rmSync(tempDir, { recursive: true, force: true }) } catch (_) {}
    }

    let cancelled = false
    let currentKill: () => void = () => {}

    // Install canceller early so the user can cancel during extraction
    const installCanceller = (kill: () => void) => {
      currentKill = kill
      cancellers.set(id, () => {
        cancelled = true
        currentKill()
        cleanup()
        const j = jobs.get(id)
        if (j) jobs.set(id, { ...j, status: 'cancelled' })
        cancellers.delete(id); pausers.delete(id); resumers.delete(id)
      })
    }
    installCanceller(() => {})
    pausers.set(id, () => {})  // no-op during extraction phase
    resumers.set(id, () => {}) // no-op during extraction phase

    // ── Phase 1: Stream-copy each segment to a temp file (I/O speed) ─────────
    // After extraction we probe each temp file to get its actual start_time.
    // FFmpeg subtracts start_time from all PTS values before passing them to the
    // filtergraph, so trim/atrim must use (absTime - tempStartTime), not absTime.
    const tempFiles: string[] = []
    const tempStartTimes: number[] = []
    try {
      for (let i = 0; i < n; i++) {
        if (cancelled) { cleanup(); return id }
        const { inPoint, outPoint } = clipRegions[i]
        const tempFile = path.join(tempDir, `seg_${i}.mkv`)
        tempFiles.push(tempFile)

        const { promise, kill } = extractSegmentToFile(job.inputFile, tempFile, inPoint, outPoint)
        installCanceller(kill)
        await promise
        installCanceller(() => {})

        // Probe the temp file to get the actual container start_time
        const tempInfo = await probeFile(tempFile).catch(() => null)
        tempStartTimes.push(tempInfo?.startTime ?? 0)
      }
    } catch (err) {
      if (!cancelled) { cleanup(); onError(err as Error) }
      return id
    }

    if (cancelled) { cleanup(); return id }

    // ── Build filter_complex (after Phase 1 so tempStartTimes are known) ─────
    const fcParts: string[] = []

    for (let i = 0; i < n; i++) {
      const { inPoint, outPoint } = clipRegions[i]
      const ts = tempStartTimes[i]
      const trimStart = Math.max(0, inPoint - ts)
      const trimEnd   = outPoint - ts

      let vChain = `[${i}:v]trim=start=${trimStart}:end=${trimEnd},setpts=PTS-STARTPTS`
      if (hasCrop) {
        const rc = regionCrops[i]
        vChain += `,crop=${rc.cropW}:${rc.cropH}:${rc.offsetX}:${rc.offsetY}`
        // Normalize all segments to the same output dims so the concat filter accepts them
        if (rc.cropW !== outW || rc.cropH !== outH) {
          vChain += `,scale=${outW}:${outH}`
        }
        // Force square pixels — scale/crop can leave inherited SAR values that don't match
        // between segments, which would fail concat even when width/height agree.
        vChain += ',setsar=1'
      }
      fcParts.push(`${vChain}[v${i}]`)

      let audioIn = `[${i}:a:0]`
      if (hasMultiTrack) {
        const trackInputs = Array.from({ length: audioTrackCount }, (_, t) => `[${i}:a:${t}]`).join('')
        fcParts.push(`${trackInputs}amix=inputs=${audioTrackCount}:normalize=0:duration=first[amix${i}]`)
        audioIn = `[amix${i}]`
      }

      let aChain = `${audioIn}atrim=start=${trimStart}:end=${trimEnd},asetpts=PTS-STARTPTS`

      const segDur    = outPoint - inPoint
      const segBleeps = bleepRegions.filter(b => b.end > inPoint && b.start < outPoint)
      if (hasBleep && segBleeps.length > 0) {
        const betweenExpr = segBleeps
          .map(b => `between(t,${Math.max(0, b.start - inPoint).toFixed(3)},${Math.min(outPoint - inPoint, b.end - inPoint).toFixed(3)})`)
          .join('+')
        const notExpr = `not(${betweenExpr})`
        const bExpr   = `${bleepVolume.toFixed(4)}*(${betweenExpr})`
        fcParts.push(`${aChain}[atrimmed${i}]`)
        fcParts.push(`[atrimmed${i}]volume=volume='${notExpr}':eval=frame[muted${i}]`)
        // Explicit sample_rate and duration so the sine source exactly matches
        // the segment audio — prevents sample-count drift that causes a freeze at the cut point
        fcParts.push(`sine=frequency=1000:sample_rate=${sampleRate}:duration=${segDur.toFixed(3)}[sine${i}]`)
        fcParts.push(`[sine${i}]volume=volume='${bExpr}':eval=frame[bleep${i}]`)
        // duration=first: output ends when muted (atrim-derived, exact duration) ends
        fcParts.push(`[muted${i}][bleep${i}]amix=inputs=2:normalize=0:duration=first[a${i}]`)
      } else {
        fcParts.push(`${aChain}[a${i}]`)
      }
    }

    const concatInputs = Array.from({ length: n }, (_, i) => `[v${i}][a${i}]`).join('')
    fcParts.push(`${concatInputs}concat=n=${n}:v=1:a=1[vout][aout]`)
    const filterComplex = fcParts.join(';')

    if (cancelled) { cleanup(); return id }

    // ── Phase 2: Encode using filter_complex on the small temp files ──────────
    const result = runClipConversion({
      inputFiles: tempFiles,
      outputFile: job.outputFile,
      filterComplex,
      outputArgs,
      totalDuration,
      onProgress: sendProgress,
      onComplete: () => { cleanup(); onComplete() },
      onError:    (err) => { cleanup(); onError(err) },
    })

    // Update canceller and pause/resume to control the encoding process
    installCanceller(result.cancel)
    pausers.set(id, result.pause)
    resumers.set(id, result.resume)

    return id
  })

  ipcMain.handle('converter:cancelJob', async (_event, jobId: string) => {
    const cancel = cancellers.get(jobId)
    if (cancel) { cancel(); cancellers.delete(jobId) }
    pausers.delete(jobId)
    resumers.delete(jobId)
    // Flip the download-wait flag too, in case the job is mid-cloud-hydrate.
    const dlFlag = downloadCancelFlags.get(jobId)
    if (dlFlag) dlFlag.cancelled = true
    const j = jobs.get(jobId)
    if (j) {
      const wasQueued = j.status === 'queued'
      jobs.set(jobId, { ...j, status: 'cancelled' })
      if (wasQueued) persistPendingJobs()
      const config = getStore().get('config')
      // For replaceInput jobs the temp output is internal — clean it up
      // unconditionally so we don't leave __arc_tmp.* files behind.
      if (j.replaceInput && j.outputFile) {
        deleteWithRetry(j.outputFile, 'archive temp file (cancel)')
      } else if (config.autoDeletePartialOnCancel && j.outputFile) {
        deleteWithRetry(j.outputFile, 'cancelled output')
      }
      maybeFireGroupHook(jobId)
      // Cancellation of one job in a group shouldn't stop the others; advance.
      if (j.groupId) startNextInGroup(j.groupId)
    }
  })

  // Cancel every job belonging to a group. Useful for the archive-batch UI's
  // single "Cancel all" button so the user doesn't have to hit cancel N times.
  ipcMain.handle('converter:cancelGroup', async (_event, groupId: string) => {
    const groupJobs = [...jobs.values()].filter(j => j.groupId === groupId)
    for (const j of groupJobs) {
      if (j.status === 'done' || j.status === 'cancelled' || j.status === 'error') continue
      const cancel = cancellers.get(j.id)
      if (cancel) { cancel(); cancellers.delete(j.id) }
      pausers.delete(j.id)
      resumers.delete(j.id)
      const dlFlag = downloadCancelFlags.get(j.id)
      if (dlFlag) dlFlag.cancelled = true
      const wasQueued = j.status === 'queued'
      jobs.set(j.id, { ...j, status: 'cancelled' })
      if (wasQueued) persistPendingJobs()
      if (j.replaceInput && j.outputFile) {
        deleteWithRetry(j.outputFile, 'archive temp file (cancel-group)')
      }
      const notifyAll = (channel: string, data: any) => {
        for (const w of BrowserWindow.getAllWindows()) {
          if (!w.isDestroyed()) w.webContents.send(channel, data)
        }
      }
      notifyAll('converter:jobStatus', { jobId: j.id, status: 'cancelled' })
    }
  })

  ipcMain.handle('converter:pauseJob', async (_event, jobId: string) => {
    pausers.get(jobId)?.()
    const j = jobs.get(jobId)
    if (j) jobs.set(jobId, { ...j, status: 'paused' })
  })

  ipcMain.handle('converter:resumeJob', async (_event, jobId: string) => {
    resumers.get(jobId)?.()
    const j = jobs.get(jobId)
    if (j) jobs.set(jobId, { ...j, status: 'running' })
  })

  ipcMain.handle('converter:getJobs', async () => Array.from(jobs.values()))
}
