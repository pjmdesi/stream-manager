import { ipcMain, BrowserWindow, app } from 'electron'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { v4 as uuidv4 } from 'uuid'
import { getStore } from './store'

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
    description: 'Cold storage archive — CRF 32 SVT-AV1, excellent quality-to-size ratio. Requires a recent FFmpeg build.',
    ffmpegArgs: '-c:v libsvtav1 -crf 32 -preset 6 -c:a aac -b:a 128k',
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
  broadcastJobAdded(queuedJob)
  return id
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
 * Used by both the `converter:addToQueue` IPC and auto-rules (fileWatcher). */
export async function startConversionJob(
  job: ConversionJob,
  onProgress?: (pct: number) => void
): Promise<{ id: string; done: Promise<void> }> {
  const id = job.id || uuidv4()
  const newJob: ConversionJob = { ...job, id, status: 'running', progress: 0 }
  jobs.set(id, newJob)

  const notifyAll = (channel: string, data: any) => {
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) w.webContents.send(channel, data)
    }
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
      jobs.set(id, { ...jobs.get(id)!, status: 'done', progress: 100 })
      cancellers.delete(id)
      notifyAll('converter:jobComplete', { jobId: id, outputPath: job.outputFile })
      resolve()
    }
    const handleError = (err: Error) => {
      jobs.set(id, { ...jobs.get(id)!, status: 'error', error: err.message })
      cancellers.delete(id)
      notifyAll('converter:jobError', { jobId: id, error: err.message })
      reject(err)
    }
    ;(async () => {
      try {
        const { runConversion, applyGpuAcceleration, probeFile } = await import('../services/ffmpegService')
        const gpuArgs = await applyGpuAcceleration(job.preset.ffmpegArgs)
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

export function getConverterStatus(): { active: boolean; percent: number; label: string } {
  const running = [...jobs.values()].filter(j => j.status === 'running' || j.status === 'queued')
  if (running.length === 0) return { active: false, percent: 0, label: 'Idle' }
  const current = running.find(j => j.status === 'running') ?? running[0]
  const name = current.outputFile.split(/[\\/]/).pop() ?? ''
  const queued = running.length - 1
  const label = queued > 0 ? `${Math.round(current.progress ?? 0)}% — ${name} (+${queued} queued)` : `${Math.round(current.progress ?? 0)}% — ${name}`
  return { active: true, percent: current.progress ?? 0, label }
}

export function registerConverterIPC(): void {
  ipcMain.handle('converter:getBuiltinPresets', async () => BUILTIN_PRESETS)

  ipcMain.handle('converter:checkEncoderAvailable', async (_event, name: string) => {
    const { checkEncoderAvailable } = await import('../services/ffmpegService')
    return checkEncoderAvailable(name)
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

  ipcMain.handle('converter:addToQueue', async (_event, job: ConversionJob) => {
    const { id, done } = await startConversionJob(job)
    // Don't await `done` — the renderer gets completion via the broadcast 'converter:jobComplete' event.
    done.catch(() => { /* error broadcast separately */ })
    return id
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
    const j = jobs.get(jobId)
    if (j) {
      jobs.set(jobId, { ...j, status: 'cancelled' })
      const config = getStore().get('config')
      if (config.autoDeletePartialOnCancel && j.outputFile) {
        const outputFile = j.outputFile
        // SIGKILL is async — retry deletion until the process releases the handle
        const tryDelete = (attemptsLeft: number) => {
          try {
            fs.unlinkSync(outputFile)
          } catch (_) {
            if (attemptsLeft > 1) setTimeout(() => tryDelete(attemptsLeft - 1), 500)
          }
        }
        setTimeout(() => tryDelete(6), 250) // up to ~3 seconds total
      }
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
