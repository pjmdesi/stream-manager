import ffmpeg from 'fluent-ffmpeg'
import ffmpegStatic from 'ffmpeg-static'
import ffprobeStatic from 'ffprobe-static'
import { spawn, spawnSync } from 'child_process'
import { app } from 'electron'
import path from 'path'
import fs from 'fs'

// When running from a packaged asar, binaries are unpacked to app.asar.unpacked
function fixAsarPath(p: string): string {
  return p.replace(/app\.asar([/\\])/, 'app.asar.unpacked$1')
}

const ffmpegBin = ffmpegStatic ? fixAsarPath(ffmpegStatic) : null
const ffprobeBin = fixAsarPath(ffprobeStatic.path)

// Set binary paths
if (ffmpegBin) {
  ffmpeg.setFfmpegPath(ffmpegBin)
}
ffmpeg.setFfprobePath(ffprobeBin)

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
  /** Container start time in seconds (the PTS of the first packet) */
  startTime: number
  width: number
  height: number
  audioTracks: AudioTrackInfo[]
  videoCodec?: string
  fps?: number
  /** Video stream bitrate in bits/sec from ffprobe (may be absent for some containers) */
  videoBitrate?: number
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
        sampleRate: stream.sample_rate ? Number(stream.sample_rate) : undefined
      }))

      const fps = videoStream?.r_frame_rate
        ? (() => {
            const parts = videoStream.r_frame_rate.split('/')
            return parts.length === 2 ? parseFloat(parts[0]) / parseFloat(parts[1]) : parseFloat(parts[0])
          })()
        : undefined

      // Prefer the per-stream bitrate; fall back to overall container bitrate
      const rawBitrate = videoStream?.bit_rate ?? metadata.format.bit_rate
      const videoBitrate = rawBitrate ? Number(rawBitrate) : undefined

      resolve({
        path: filePath,
        duration: metadata.format.duration || 0,
        startTime: metadata.format.start_time ? Number(metadata.format.start_time) : 0,
        width: videoStream?.width || 0,
        height: videoStream?.height || 0,
        audioTracks,
        videoCodec: videoStream?.codec_name,
        fps,
        videoBitrate,
      })
    })
  })
}

/** Read the `encoded_by` container tag from a file. Returns the raw string
 *  or undefined if not set / probe fails. Used as a fast pre-flight to
 *  detect files we've already archived (the archive ffmpeg run writes a
 *  marker into this tag). Lighter than `probeFile` since we only need
 *  format-level metadata, not stream details. */
export async function probeArchiveTag(filePath: string): Promise<string | undefined> {
  return new Promise(resolve => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) { resolve(undefined); return }
      const tags = (metadata.format as { tags?: Record<string, string> }).tags
      resolve(tags?.encoded_by ?? tags?.ENCODED_BY)
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

let _encodersOutput: string | undefined = undefined
let _gpuVendorCache: GpuVendor | undefined = undefined

function getEncodersOutput(): Promise<string> {
  if (_encodersOutput !== undefined) return Promise.resolve(_encodersOutput)
  return new Promise(resolve => {
    if (!ffmpegBin) { _encodersOutput = ''; resolve(''); return }
    const proc = spawn(ffmpegBin, ['-hide_banner', '-encoders'], {
      stdio: ['ignore', 'pipe', 'ignore']
    })
    let out = ''
    proc.stdout!.on('data', (c: Buffer) => out += c.toString())
    proc.on('close', () => { _encodersOutput = out; resolve(out) })
    proc.on('error', () => { _encodersOutput = ''; resolve('') })
  })
}

export async function checkEncoderAvailable(name: string): Promise<boolean> {
  const out = await getEncodersOutput()
  return out.includes(name)
}

/** Whether an encoder *actually works on this machine* — i.e. the hardware
 *  and runtime libraries it depends on are present. ffmpeg-static is built
 *  with every GPU encoder family compiled in, so checkEncoderAvailable
 *  returns true for all of them regardless of hardware. To know if e.g.
 *  h264_nvenc will actually run, we have to invoke the encoder against a
 *  synthetic test frame and see whether ffmpeg exits 0 or with a "cannot
 *  load nvcuda.dll" / "no AMF runtime" / similar error. */
async function testEncoderRuntime(name: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    if (!ffmpegBin) { resolve(false); return }
    // Synthetic single-frame source via lavfi → forced yuv420p (most GPU
    // encoders reject the default yuv444p) → encoder under test → null sink.
    // <1s on success, near-instant fail when the hardware/runtime is missing.
    // SIGKILL fallback in case the process hangs (rare but possible with
    // broken drivers).
    const proc = spawn(ffmpegBin, [
      '-hide_banner', '-loglevel', 'warning',
      // 320×240 chosen to clear every encoder's minimum-dimension check
      // (notably AV1 NVENC requires ≥144×96 in some driver branches and
      // others bump it higher; 320×240 is safely above all of them while
      // still being tiny). ~30 frames so AV1 hardware encoders (which
      // buffer for B-frame lookahead) actually emit packets before the
      // source ends.
      '-f', 'lavfi', '-i', 'color=size=320x240:rate=30:duration=1',
      '-pix_fmt', 'yuv420p',
      '-c:v', name,
      '-f', 'null', '-',
    ], { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderrBuf = ''
    proc.stderr?.on('data', (chunk: Buffer) => { stderrBuf += chunk.toString('utf8') })
    let settled = false
    const finish = (ok: boolean, exitCode?: number | null) => {
      if (settled) return
      settled = true
      // Full stderr dump on failure so we can diagnose without truncation.
      if (!ok) {
        const trimmed = stderrBuf.trim() || '(no stderr)'
        console.warn(`[encoder-probe] ${name} failed (exit ${exitCode}):\n  ${trimmed.replace(/\n/g, '\n  ')}`)
      }
      try { proc.kill('SIGKILL') } catch {}
      resolve(ok)
    }
    proc.on('close', code => finish(code === 0, code))
    proc.on('error', () => finish(false))
    setTimeout(() => finish(false), 5000)
  })
}

type GpuMakers = { nvidia: boolean; amd: boolean; intel: boolean }

let _gpuMakersCache: GpuMakers | null = null

/** Query Windows for installed GPU adapters and map each to a vendor flag.
 *  More reliable than runtime encoder probing because some encoders' runtime
 *  init succeeds on the wrong adapter (AMF will sometimes init against an
 *  Intel iGPU when no AMD GPU is present, producing a false positive). WMI
 *  reports the actual hardware. */
async function detectGpuMakersViaWMI(): Promise<GpuMakers> {
  if (_gpuMakersCache) return _gpuMakersCache
  const empty: GpuMakers = { nvidia: false, amd: false, intel: false }
  if (process.platform !== 'win32') {
    _gpuMakersCache = empty
    return empty
  }
  return new Promise<GpuMakers>(resolve => {
    const proc = spawn('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      "(Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name) -join '|'"
    ], { stdio: ['ignore', 'pipe', 'ignore'] })
    let out = ''
    proc.stdout.on('data', c => { out += c.toString('utf8') })
    const finish = () => {
      // Each GPU on its own line. Most names contain a clear vendor token
      // (NVIDIA "GeForce…", AMD "Radeon…", Intel "Intel(R) …"). Patterns are
      // intentionally narrow — a stray "AMD" elsewhere in a description
      // shouldn't flip the AMF flag on. Specifically: AMD requires "Radeon"
      // or "Vega" (every shipping AMD GPU has one of those tokens).
      const adapters = out.split('|').map(s => s.trim()).filter(Boolean)
      const lower = adapters.join(' | ').toLowerCase()
      const result: GpuMakers = {
        nvidia: /nvidia|geforce|quadro|tesla/.test(lower),
        amd:    /radeon|\bvega\b/.test(lower),
        intel:  /intel\(r\)|uhd graphics|iris|\barc /.test(lower),
      }
      console.log(`[gpu-detect] adapters: ${adapters.join(' | ') || '<none>'}`)
      console.log(`[gpu-detect] makers:`, result)
      _gpuMakersCache = result
      resolve(result)
    }
    proc.on('close', finish)
    proc.on('error', () => { _gpuMakersCache = empty; resolve(empty) })
    setTimeout(() => { try { proc.kill() } catch {}; resolve(empty) }, 5000)
  })
}

const GPU_ENCODER_CANDIDATES = [
  'h264_nvenc', 'hevc_nvenc', 'av1_nvenc',
  'h264_qsv',   'hevc_qsv',   'av1_qsv',
  'h264_amf',   'hevc_amf',   'av1_amf',
] as const

let _availableEncodersCache: Set<string> | null = null

/** Returns the set of GPU encoder names that actually work on this machine.
 *  Two-step detection:
 *    1. Query Windows for installed GPU vendors (NVIDIA / AMD / Intel).
 *       Hardware-truthful — encoder names are gated by vendor presence.
 *    2. For AV1 encoders specifically, also runtime-probe — they require
 *       very recent GPU generations (RTX 40 / RX 7000 / Arc) and the
 *       vendor flag alone isn't enough.
 *  CPU encoders aren't probed; they're always assumed available. */
export async function detectAvailableEncoders(): Promise<Set<string>> {
  if (_availableEncodersCache) return _availableEncodersCache
  const compiled = await getEncodersOutput()
  const makers = await detectGpuMakersViaWMI()

  const isCompiled = (n: string) => compiled.includes(n)
  const result = new Set<string>()

  // h264 / h265: vendor present is sufficient — NVENC/QSV/AMF for these
  // codecs has shipped on essentially every supported GPU generation.
  if (makers.nvidia && isCompiled('h264_nvenc')) result.add('h264_nvenc')
  if (makers.nvidia && isCompiled('hevc_nvenc')) result.add('hevc_nvenc')
  if (makers.intel  && isCompiled('h264_qsv'))   result.add('h264_qsv')
  if (makers.intel  && isCompiled('hevc_qsv'))   result.add('hevc_qsv')
  if (makers.amd    && isCompiled('h264_amf'))   result.add('h264_amf')
  if (makers.amd    && isCompiled('hevc_amf'))   result.add('hevc_amf')

  // AV1: probe at runtime in addition to the vendor check, because hardware
  // AV1 needs specific GPU generations (NVIDIA RTX 40+, AMD RX 7000+, Intel
  // Arc+). Probing in parallel keeps the wait minimal.
  const av1Probes: Promise<void>[] = []
  if (makers.nvidia && isCompiled('av1_nvenc')) {
    av1Probes.push(testEncoderRuntime('av1_nvenc').then(ok => { if (ok) result.add('av1_nvenc') }))
  }
  if (makers.intel && isCompiled('av1_qsv')) {
    av1Probes.push(testEncoderRuntime('av1_qsv').then(ok => { if (ok) result.add('av1_qsv') }))
  }
  if (makers.amd && isCompiled('av1_amf')) {
    av1Probes.push(testEncoderRuntime('av1_amf').then(ok => { if (ok) result.add('av1_amf') }))
  }
  await Promise.all(av1Probes)

  _availableEncodersCache = result
  return result
}

async function detectGpuVendor(): Promise<GpuVendor> {
  if (_gpuVendorCache !== undefined) return _gpuVendorCache
  // Real hardware probe — picks the first family that actually works, not
  // just the first one compiled in.
  const available = await detectAvailableEncoders()
  const vendor: GpuVendor =
    available.has('h264_nvenc') ? 'nvenc' :
    available.has('h264_qsv')   ? 'qsv'   :
    available.has('h264_amf')   ? 'amf'   : null
  _gpuVendorCache = vendor
  return vendor
}

// CPU codec → GPU equivalent per vendor
const GPU_CODEC_MAP: Record<string, Partial<Record<'nvenc' | 'amf' | 'qsv', string>>> = {
  libx264:   { nvenc: 'h264_nvenc',  amf: 'h264_amf',  qsv: 'h264_qsv'  },
  libx265:   { nvenc: 'hevc_nvenc',  amf: 'hevc_amf',  qsv: 'hevc_qsv'  },
  libsvtav1: { nvenc: 'av1_nvenc',   amf: 'av1_amf',   qsv: 'av1_qsv'   },
}

// AV1 GPU encoders use a different preset naming scheme (p1-p7) — drop any
// numeric SVT-AV1 preset values rather than forwarding them verbatim.
const AV1_GPU_ENCODERS = new Set(['av1_nvenc', 'av1_amf', 'av1_qsv'])

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
  let gpuCodecName = ''

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
        gpuCodecName = gpuCodec
        continue
      }
    }

    // -crf is CPU-only; GPU encoders use -cq for constant quality
    if (tok === '-crf' && replacedCodec) {
      out.push('-cq')
      continue
    }

    // Drop software-only preset values (e.g. ultrafast) or numeric SVT-AV1
    // presets (0-13 scale) when the codec was swapped to an AV1 GPU encoder.
    if (tok === '-preset' && i + 1 < tokens.length) {
      const val = tokens[i + 1]
      const dropNumeric = AV1_GPU_ENCODERS.has(gpuCodecName) && /^\d+$/.test(val)
      if (SOFTWARE_PRESETS.has(val) || dropNumeric) {
        i++
        continue
      }
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
  onError: (err: Error) => void,
  inputOptions?: string[]
): { cancel: () => void; pause: () => void; resume: () => void } {
  const args = parseArgsString(ffmpegArgs)
  let command = ffmpeg(inputFile)
  if (inputOptions && inputOptions.length > 0) command = command.inputOptions(inputOptions)
  command = command.outputOptions(args).output(outputFile)
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


// Returns raw mono PCM at 200 samples/sec as a Buffer of f32le floats.
// The renderer holds the full buffer and re-buckets dynamically per viewport.
export async function extractWaveformData(filePath: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    if (!ffmpegBin) { reject(new Error('ffmpeg binary not found')); return }

    const chunks: Buffer[] = []

    const proc = spawn(ffmpegBin, [
      '-i', filePath,
      '-map', '0:a:0',
      '-ac', '1',
      '-ar', '200',   // 200 samples/sec — ~5.8 MB for a 2-hour file
      '-f', 'f32le',
      '-vn',
      'pipe:1'
    ], { stdio: ['ignore', 'pipe', 'ignore'] })

    proc.stdout!.on('data', (chunk: Buffer) => chunks.push(chunk))
    proc.on('close', () => resolve(Buffer.concat(chunks)))
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

/**
 * Stream-copies a time range from `inputFile` into a new MKV file.
 *
 * Uses a demuxer seek (`-ss` as input option) and `-c copy` so no decoding
 * occurs — this runs at near I/O speed regardless of where in the file the
 * segment lives.  Original PTS timestamps are preserved, so the output can be
 * used with trim/atrim filters that reference the original absolute timecodes.
 *
 * A 10-second margin is added before `inPoint` to ensure the keyframe that
 * precedes the clip is included in the temp file.
 *
 * Returns `{ promise, kill }` — call `kill()` to abort mid-extraction.
 */
export function extractSegmentToFile(
  inputFile: string,
  outputFile: string,
  inPoint: number,
  outPoint: number
): { promise: Promise<void>; kill: () => void } {
  const margin = 10 // seconds before inPoint to ensure keyframe capture
  const seekTime = Math.max(0, inPoint - margin)
  const duration = (outPoint - inPoint) + margin + 5 // small tail buffer

  let proc: ReturnType<typeof spawn> | null = null
  let killed = false

  const promise = new Promise<void>((resolve, reject) => {
    if (!ffmpegBin) { reject(new Error('ffmpeg binary not found')); return }

    let stderr = ''
    proc = spawn(ffmpegBin, [
      '-ss', seekTime.toFixed(3),
      '-t',  duration.toFixed(3),
      '-i',  inputFile,
      '-map', '0',      // copy ALL streams (default only picks "best" audio)
      '-c',  'copy',
      '-copyts',        // preserve original PTS so trim= timestamps still match
      '-y',
      outputFile,
    ], { stdio: ['ignore', 'ignore', 'pipe'] })

    proc.stderr!.on('data', (c: Buffer) => {
      stderr += c.toString()
      if (stderr.length > 4000) stderr = stderr.slice(-2000)
    })
    proc.on('close', code => {
      if (killed) { reject(new Error('cancelled')); return }
      if (code === 0) resolve()
      else reject(new Error(`Segment extraction failed (code ${code}): ${stderr.slice(-500)}`))
    })
    proc.on('error', err => { if (!killed) reject(err) })
  })

  return {
    promise,
    kill: () => { killed = true; try { proc?.kill('SIGKILL') } catch (_) {} },
  }
}

/**
 * Encodes clip regions using `filter_complex` applied to pre-extracted temp
 * segment files.  Call `extractSegmentToFile` for each region first, then
 * pass the resulting paths as `inputFiles`.
 *
 * Because each temp file is only a few seconds long, FFmpeg processes them
 * near-instantly — no slow linear reads through a multi-hour source file.
 */
export function runClipConversion(params: {
  inputFiles: string[]    // one temp file per segment, in order
  outputFile: string
  filterComplex: string
  outputArgs: string[]    // e.g. ['-map','[vout]','-map','[aout]','-c:v','libx264',...]
  totalDuration: number   // sum of all segment durations, for progress calculation
  onProgress: (percent: number) => void
  onComplete: () => void
  onError: (err: Error) => void
}): { cancel: () => void; pause: () => void; resume: () => void } {
  const { inputFiles, outputFile, filterComplex, outputArgs, totalDuration, onProgress, onComplete, onError } = params

  if (!ffmpegBin) {
    onError(new Error('ffmpeg binary not found'))
    return { cancel: () => {}, pause: () => {}, resume: () => {} }
  }

  // Build args: -i temp0 -i temp1 ... -filter_complex "..." [output args] outputFile
  const args: string[] = []
  for (const f of inputFiles) args.push('-i', f)
  args.push('-filter_complex', filterComplex)
  args.push(...outputArgs, outputFile)

  let cancelled = false
  let ffmpegPid: number | null = null
  let stderrBuf = ''

  const proc = spawn(ffmpegBin, args, { stdio: ['ignore', 'ignore', 'pipe'] })
  ffmpegPid = proc.pid ?? null

  proc.stderr!.on('data', (chunk: Buffer) => {
    stderrBuf += chunk.toString()
    // FFmpeg writes progress as: "… time=HH:MM:SS.ss …"
    const m = /time=(\d{2}):(\d{2}):(\d{2})[.,](\d+)/.exec(stderrBuf)
    if (m && totalDuration > 0) {
      const secs = parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseInt(m[3]) + parseInt(m[4]) / 100
      onProgress(Math.min(100, Math.round((secs / totalDuration) * 1000) / 10))
    }
    if (stderrBuf.length > 8000) stderrBuf = stderrBuf.slice(-4000)
  })

  proc.on('close', code => {
    if (cancelled) return
    if (code === 0) { onProgress(100); onComplete() }
    else onError(new Error(`ffmpeg exited with code ${code ?? '?'}: ${stderrBuf.slice(-2000)}`))
  })

  proc.on('error', err => { if (!cancelled) onError(err) })

  return {
    cancel:  () => { cancelled = true; try { proc.kill('SIGKILL') } catch (_) {} },
    pause:   () => { if (ffmpegPid) suspendProcess(ffmpegPid) },
    resume:  () => { if (ffmpegPid) resumeProcess(ffmpegPid) },
  }
}

