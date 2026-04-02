import ffmpeg from 'fluent-ffmpeg'
import ffmpegStatic from 'ffmpeg-static'
import ffprobeStatic from 'ffprobe-static'
import { spawn, spawnSync } from 'child_process'
import { app } from 'electron'
import path from 'path'
import fs from 'fs'

// Set binary paths
if (ffmpegStatic) {
  ffmpeg.setFfmpegPath(ffmpegStatic)
}
ffmpeg.setFfprobePath(ffprobeStatic.path)

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

export async function probeFile(filePath: string): Promise<VideoInfo> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) {
        reject(new Error(`FFprobe error: ${err.message}`))
        return
      }

      const videoStream = metadata.streams.find(s => s.codec_type === 'video')
      const audioStreams = metadata.streams.filter(s => s.codec_type === 'audio')

      const audioTracks: AudioTrackInfo[] = audioStreams.map((stream, idx) => ({
        index: idx,
        codec: stream.codec_name || 'unknown',
        language: stream.tags?.language,
        title: stream.tags?.title,
        channels: stream.channels || 2,
        sampleRate: stream.sample_rate ? parseInt(stream.sample_rate) : undefined
      }))

      const fps = videoStream?.r_frame_rate
        ? (() => {
            const parts = videoStream.r_frame_rate.split('/')
            return parts.length === 2 ? parseFloat(parts[0]) / parseFloat(parts[1]) : parseFloat(parts[0])
          })()
        : undefined

      resolve({
        path: filePath,
        duration: metadata.format.duration || 0,
        width: videoStream?.width || 0,
        height: videoStream?.height || 0,
        audioTracks,
        videoCodec: videoStream?.codec_name,
        fps
      })
    })
  })
}

let _extractCancel: (() => void) | null = null

export function cancelExtraction(): void {
  if (_extractCancel) _extractCancel()
}

export async function extractAudioTracks(
  filePath: string,
  tempDir: string,
  onProgress: (trackIndex: number, percent: number) => void,
  baseNameOverride?: string,
  trackIndices?: number[]
): Promise<string[]> {
  const info = await probeFile(filePath)

  if (info.audioTracks.length === 0) return []

  const baseName = path.basename(filePath, path.extname(filePath))
  const safeBase = baseNameOverride ?? baseName.replace(/[^a-zA-Z0-9_-]/g, '_')
  const indicesToExtract = trackIndices ?? info.audioTracks.map((_, i) => i)

  // Sparse array — unselected slots stay as empty string
  const outputPaths: string[] = new Array(info.audioTracks.length).fill('')
  let cancelled = false
  _extractCancel = () => { cancelled = true }

  try {
    for (const i of indicesToExtract) {
      if (cancelled) throw new Error('cancelled')
      if (i >= info.audioTracks.length) continue
      const outputPath = path.join(tempDir, `${safeBase}_track_${i}.opus`)
      outputPaths[i] = outputPath

      await new Promise<void>((resolve, reject) => {
        const duration = info.duration
        const cmd = ffmpeg(filePath)
          .outputOptions([`-map 0:a:${i}`, '-c:a libopus', '-b:a 192k', '-vn'])
          .output(outputPath)
          .on('progress', (progress) => {
            if (cancelled) { try { (cmd as any).kill('SIGKILL') } catch (_) {}; return }
            if (duration > 0 && progress.timemark) {
              const parts = progress.timemark.split(':')
              const seconds =
                parseFloat(parts[0]) * 3600 +
                parseFloat(parts[1]) * 60 +
                parseFloat(parts[2])
              onProgress(i, Math.min(100, Math.round((seconds / duration) * 100)))
            } else if (progress.percent != null) {
              onProgress(i, Math.round(progress.percent))
            }
          })
          .on('end', () => { onProgress(i, 100); resolve() })
          .on('error', (err) => {
            if (cancelled || err.message.includes('SIGKILL') || err.message.includes('killed')) {
              reject(new Error('cancelled'))
            } else {
              reject(new Error(`Failed to extract track ${i}: ${err.message}`))
            }
          })

        _extractCancel = () => {
          cancelled = true
          try { (cmd as any).kill('SIGKILL') } catch (_) {}
        }
        cmd.run()
      })
    }
  } finally {
    _extractCancel = null
  }

  if (cancelled) throw new Error('cancelled')
  return outputPaths
}

// ── GPU acceleration ───────────────────────────────────────────────────────

type GpuVendor = 'nvenc' | 'amf' | 'qsv' | null

let _gpuVendorCache: GpuVendor | undefined = undefined

async function detectGpuVendor(): Promise<GpuVendor> {
  if (_gpuVendorCache !== undefined) return _gpuVendorCache

  return new Promise(resolve => {
    if (!ffmpegStatic) { _gpuVendorCache = null; resolve(null); return }

    const proc = spawn(ffmpegStatic, ['-hide_banner', '-encoders'], {
      stdio: ['ignore', 'pipe', 'ignore']
    })
    let out = ''
    proc.stdout!.on('data', (c: Buffer) => out += c.toString())
    proc.on('close', () => {
      const vendor: GpuVendor =
        out.includes('h264_nvenc') ? 'nvenc' :
        out.includes('h264_amf')   ? 'amf'   :
        out.includes('h264_qsv')   ? 'qsv'   : null
      _gpuVendorCache = vendor
      resolve(vendor)
    })
    proc.on('error', () => { _gpuVendorCache = null; resolve(null) })
  })
}

// CPU codec → GPU equivalent per vendor
const GPU_CODEC_MAP: Record<string, Partial<Record<'nvenc' | 'amf' | 'qsv', string>>> = {
  libx264: { nvenc: 'h264_nvenc', amf: 'h264_amf', qsv: 'h264_qsv' },
  libx265: { nvenc: 'hevc_nvenc', amf: 'hevc_amf', qsv: 'hevc_qsv' },
}

// Presets valid for x264/x265 but meaningless/invalid on GPU encoders
const SOFTWARE_PRESETS = new Set([
  'ultrafast', 'superfast', 'veryfast', 'faster', 'fast',
  'medium', 'slow', 'slower', 'veryslow', 'placebo'
])

function substituteGpuArgs(args: string, vendor: GpuVendor): string {
  if (!vendor) return args

  const tokens = parseArgsString(args)
  const out: string[] = []
  let replacedCodec = false

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]

    // Swap CPU video codec for GPU equivalent
    if (tok === '-c:v' && i + 1 < tokens.length) {
      const codec = tokens[i + 1]
      const gpuCodec = GPU_CODEC_MAP[codec]?.[vendor]
      if (gpuCodec) {
        out.push('-c:v', gpuCodec)
        i++
        replacedCodec = true
        continue
      }
    }

    // -crf is CPU-only; GPU encoders use -cq for constant quality
    if (tok === '-crf' && replacedCodec) {
      out.push('-cq')
      continue
    }

    // Drop software-only preset values (e.g. ultrafast)
    if (tok === '-preset' && i + 1 < tokens.length && SOFTWARE_PRESETS.has(tokens[i + 1])) {
      i++ // skip preset value too
      continue
    }

    // -tune is not supported by GPU encoders
    if (tok === '-tune' && i + 1 < tokens.length) {
      i++
      continue
    }

    out.push(tok)
  }

  return out.join(' ')
}

const WIN_NT_TYPE_DEF = `
using System;
using System.Runtime.InteropServices;
public class NtProc {
    [DllImport("ntdll.dll")] public static extern int NtSuspendProcess(IntPtr handle);
    [DllImport("ntdll.dll")] public static extern int NtResumeProcess(IntPtr handle);
}
`

function suspendProcess(pid: number): void {
  if (process.platform === 'win32') {
    spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command',
      `Add-Type -TypeDefinition '${WIN_NT_TYPE_DEF.replace(/\n/g, ' ')}'; $p=[System.Diagnostics.Process]::GetProcessById(${pid}); [NtProc]::NtSuspendProcess($p.Handle)`
    ], { timeout: 5000 })
  } else {
    process.kill(pid, 'SIGSTOP')
  }
}

function resumeProcess(pid: number): void {
  if (process.platform === 'win32') {
    spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command',
      `Add-Type -TypeDefinition '${WIN_NT_TYPE_DEF.replace(/\n/g, ' ')}'; $p=[System.Diagnostics.Process]::GetProcessById(${pid}); [NtProc]::NtResumeProcess($p.Handle)`
    ], { timeout: 5000 })
  } else {
    process.kill(pid, 'SIGCONT')
  }
}

export async function applyGpuAcceleration(ffmpegArgs: string): Promise<string> {
  // Skip GPU substitution for stream-copy or audio-only jobs
  if (!ffmpegArgs.includes('-c:v') || ffmpegArgs.includes('-c:v copy')) return ffmpegArgs
  const vendor = await detectGpuVendor()
  return substituteGpuArgs(ffmpegArgs, vendor)
}

export function runConversion(
  inputFile: string,
  outputFile: string,
  ffmpegArgs: string,
  duration: number,
  onProgress: (percent: number) => void,
  onComplete: () => void,
  onError: (err: Error) => void
): { cancel: () => void; pause: () => void; resume: () => void } {
  const args = parseArgsString(ffmpegArgs)
  let command = ffmpeg(inputFile).outputOptions(args).output(outputFile)
  let ffmpegPid: number | null = null

  command
    .on('start', () => {
      // ffmpegProc is set synchronously before start fires, but defer one tick to be safe
      setImmediate(() => {
        ffmpegPid = (command as any).ffmpegProc?.pid ?? null
      })
    })
    .on('progress', (progress) => {
      if (duration > 0 && progress.timemark) {
        const parts = progress.timemark.split(':')
        const seconds = parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2])
        onProgress(Math.min(100, Math.round((seconds / duration) * 1000) / 10))
      } else if (progress.percent != null) {
        onProgress(Math.min(100, Math.round(progress.percent * 10) / 10))
      }
    })
    .on('end', () => {
      onProgress(100)
      onComplete()
    })
    .on('error', (err) => {
      if (err.message.includes('SIGKILL') || err.message.includes('killed')) return
      onError(err)
    })

  command.run()

  return {
    cancel: () => { try { command.kill('SIGKILL') } catch (_) {} },
    pause:  () => { if (ffmpegPid) suspendProcess(ffmpegPid) },
    resume: () => { if (ffmpegPid) resumeProcess(ffmpegPid) },
  }
}


export interface WaveformPeak { min: number; max: number }

export async function extractWaveformPeaks(
  filePath: string,
  numPeaks = 2000
): Promise<WaveformPeak[]> {
  return new Promise((resolve, reject) => {
    if (!ffmpegStatic) { reject(new Error('ffmpeg binary not found')); return }

    const chunks: Buffer[] = []

    const proc = spawn(ffmpegStatic, [
      '-i', filePath,
      '-map', '0:a:0',
      '-ac', '1',
      '-ar', '200',   // 200 samples/sec — ~8 MB for a 3-hour file
      '-f', 'f32le',
      '-vn',
      'pipe:1'
    ], { stdio: ['ignore', 'pipe', 'ignore'] })

    proc.stdout!.on('data', (chunk: Buffer) => chunks.push(chunk))

    proc.on('close', () => {
      if (chunks.length === 0) { resolve([]); return }

      const buf = Buffer.concat(chunks)
      const floatCount = Math.floor(buf.byteLength / 4)

      const samplesPerPeak = Math.max(1, Math.floor(floatCount / numPeaks))
      const actualPeaks = Math.min(numPeaks, Math.ceil(floatCount / samplesPerPeak))
      const peaks: WaveformPeak[] = []

      for (let i = 0; i < actualPeaks; i++) {
        const start = i * samplesPerPeak
        const end = Math.min(start + samplesPerPeak, floatCount)
        let mn = 0, mx = 0
        for (let j = start; j < end; j++) {
          const v = buf.readFloatLE(j * 4)
          if (v < mn) mn = v
          if (v > mx) mx = v
        }
        peaks.push({ min: Math.max(-1, mn), max: Math.min(1, mx) })
      }

      resolve(peaks)
    })

    proc.on('error', reject)
  })
}

function parseArgsString(argsStr: string): string[] {
  const result: string[] = []
  const regex = /(?:[^\s"']+|"[^"]*"|'[^']*')+/g
  let match
  while ((match = regex.exec(argsStr)) !== null) {
    result.push(match[0].replace(/^["']|["']$/g, ''))
  }
  return result
}

