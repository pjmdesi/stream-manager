import { ipcMain, BrowserWindow, app } from 'electron'
import fs from 'fs'
import path from 'path'
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

export function registerConverterIPC(): void {
  ipcMain.handle('converter:getBuiltinPresets', async () => BUILTIN_PRESETS)

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

  ipcMain.handle('converter:addToQueue', async (event, job: ConversionJob) => {
    const id = job.id || uuidv4()
    const newJob: ConversionJob = { ...job, id, status: 'running', progress: 0 }
    jobs.set(id, newJob)

    const win = BrowserWindow.fromWebContents(event.sender)
    win?.webContents.send('converter:jobProgress', { jobId: id, percent: 0 })

    const onProgress = (percent: number) => {
      const j = jobs.get(id)
      if (j) jobs.set(id, { ...j, progress: percent })
      if (win && !win.isDestroyed()) {
        win.webContents.send('converter:jobProgress', { jobId: id, percent })
      }
    }
    const onComplete = () => {
      jobs.set(id, { ...jobs.get(id)!, status: 'done', progress: 100 })
      cancellers.delete(id)
      if (win && !win.isDestroyed()) {
        win.webContents.send('converter:jobComplete', { jobId: id, outputPath: job.outputFile })
      }
    }
    const onError = (err: Error) => {
      jobs.set(id, { ...jobs.get(id)!, status: 'error', error: err.message })
      cancellers.delete(id)
      if (win && !win.isDestroyed()) {
        win.webContents.send('converter:jobError', { jobId: id, error: err.message })
      }
    }

    const { runConversion, applyGpuAcceleration, probeFile } = await import('../services/ffmpegService')
    const gpuArgs = await applyGpuAcceleration(job.preset.ffmpegArgs)
    const duration = await probeFile(job.inputFile).then(info => info.duration).catch(() => 0)
    const result = runConversion(job.inputFile, job.outputFile, gpuArgs, duration, onProgress, onComplete, onError)
    cancellers.set(id, result.cancel)
    pausers.set(id, result.pause)
    resumers.set(id, result.resume)
    return id
  })

  ipcMain.handle('converter:addClipToQueue', async (event, params: {
    job: ConversionJob
    inPoint: number
    outPoint: number
    cropMode: 'none' | '9:16'
    cropX: number
    videoWidth: number
    videoHeight: number
    bleepRegions: Array<{ id: string; start: number; end: number }>
  }) => {
    const { job, inPoint, outPoint, cropMode, cropX, videoWidth, videoHeight, bleepRegions } = params
    const id = job.id || uuidv4()
    const clipDuration = outPoint - inPoint
    const hasCrop  = cropMode === '9:16'
    const hasBleep = bleepRegions.length > 0

    const { runConversion, probeFile } = await import('../services/ffmpegService')
    const fileInfo = await probeFile(job.inputFile).catch(() => null)
    const audioTrackCount = fileInfo?.audioTracks?.length ?? 1
    const hasMultiTrack = audioTrackCount > 1

    // Build between(t,...) expressions relative to clip start (input-side -ss resets t to 0)
    const betweenExpr = bleepRegions
      .map(r => `between(t,${(r.start - inPoint).toFixed(3)},${(r.end - inPoint).toFixed(3)})`)
      .join('+')

    // Assemble filter_complex graph
    const fcParts: string[] = []
    let aMap = '-map 0:a:0'
    let vMap = '-map 0:v'

    if (hasCrop) {
      // Ensure even dimensions — required by libx264
      const cropW = Math.floor(videoHeight * 9 / 16 / 2) * 2
      const cropOffsetX = Math.floor(cropX * (videoWidth - cropW) / 2) * 2
      fcParts.push(`[0:v]crop=${cropW}:${videoHeight}:${cropOffsetX}:0[vout]`)
      vMap = '-map "[vout]"'
    }

    // Merge all audio tracks into one before any bleep processing
    let audioSrc = '[0:a:0]'
    if (hasMultiTrack) {
      const trackInputs = Array.from({ length: audioTrackCount }, (_, i) => `[0:a:${i}]`).join('')
      fcParts.push(`${trackInputs}amix=inputs=${audioTrackCount}:normalize=0:duration=first[mixed]`)
      audioSrc = '[mixed]'
    }

    if (hasBleep) {
      const notExpr = `not(${betweenExpr})`
      const bExpr   = `0.25*(${betweenExpr})`
      fcParts.push(`${audioSrc}volume=volume='${notExpr}':eval=frame[muted]`)
      fcParts.push(`sine=frequency=1000[sine_raw]`)
      fcParts.push(`[sine_raw]volume=volume='${bExpr}':eval=frame[bleep]`)
      fcParts.push(`[muted][bleep]amix=inputs=2:normalize=0:duration=shortest[aout]`)
      aMap = '-map "[aout]"'
    } else if (hasMultiTrack) {
      aMap = '-map "[mixed]"'
    }

    const mapArgs = `${vMap} ${aMap}`
    const filterPart = fcParts.length > 0
      ? `-filter_complex "${fcParts.join(';')}" ${mapArgs}`
      : ''
    const ffmpegArgs = [filterPart, '-c:v libx264 -crf 18 -preset fast -c:a aac -b:a 192k -ac 2']
      .filter(Boolean).join(' ')

    const inputOptions = ['-ss', `${inPoint}`, '-to', `${outPoint}`]
    const newJob: ConversionJob = { ...job, id, status: 'running', progress: 0 }
    jobs.set(id, newJob)

    const win = BrowserWindow.fromWebContents(event.sender)
    win?.webContents.send('converter:jobProgress', { jobId: id, percent: 0 })

    const onProgress = (percent: number) => {
      const j = jobs.get(id)
      if (j) jobs.set(id, { ...j, progress: percent })
      if (win && !win.isDestroyed()) win.webContents.send('converter:jobProgress', { jobId: id, percent })
    }
    const onComplete = () => {
      jobs.set(id, { ...jobs.get(id)!, status: 'done', progress: 100 })
      cancellers.delete(id)
      if (win && !win.isDestroyed()) win.webContents.send('converter:jobComplete', { jobId: id, outputPath: job.outputFile })
    }
    const onError = (err: Error) => {
      jobs.set(id, { ...jobs.get(id)!, status: 'error', error: err.message })
      cancellers.delete(id)
      if (win && !win.isDestroyed()) win.webContents.send('converter:jobError', { jobId: id, error: err.message })
    }

    const result = runConversion(job.inputFile, job.outputFile, ffmpegArgs, clipDuration, onProgress, onComplete, onError, inputOptions)
    cancellers.set(id, result.cancel)
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
    if (j) jobs.set(jobId, { ...j, status: 'cancelled' })
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
