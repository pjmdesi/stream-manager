import type { CustomPresetForm } from '../../types'

/** Maps a (codec × encoder type) pair to:
 *  - The actual ffmpeg encoder name to use.
 *  - The CRF/CQ range that maps to the slider's 0–100% interval. The pair is
 *    [worstQuality, bestQuality] — the slider's 0% picks the first (highest
 *    CRF = lowest quality) and 100% picks the second (lowest CRF = highest
 *    quality). The "sane band" — outside this users either waste bitrate or
 *    produce garbage.
 *  - An ordered list of speed presets, fastest first. The slider also picks
 *    a preset linearly from this array (0% = first / fastest, 100% = last /
 *    slowest practical). Capped well short of the absolute slowest preset
 *    each encoder supports — the truly slowest options are impractically
 *    slow on consumer hardware and offer minimal extra quality.
 *  - The flag name for the quality value: -crf for CPU/software, -cq for
 *    GPU encoders, -global_quality for QSV (some forks).
 *  - The preset flag name (always -preset for our supported encoders).
 *  - Any extra flags the encoder requires for true CRF mode (libaom-av1
 *    needs -b:v 0). */
interface EncoderProfile {
  encoderName: string
  qualityRange: [number, number]      // [worst, best]
  presets: string[]                   // fastest → slowest (practical)
  qualityFlag: string                 // '-crf' | '-cq' | '-global_quality'
  presetFlag: string                  // '-preset' | '-cpu-used'
  extraFlags?: string                 // '-b:v 0' for libaom etc.
}

type CodecKey = 'h264' | 'h265' | 'av1'
type EncoderKey = 'cpu' | 'nvenc' | 'qsv' | 'amf'

const ENCODER_PROFILES: Record<CodecKey, Partial<Record<EncoderKey, EncoderProfile>>> = {
  h264: {
    cpu:   { encoderName: 'libx264',     qualityRange: [28, 18], presets: ['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow'], qualityFlag: '-crf', presetFlag: '-preset' },
    nvenc: { encoderName: 'h264_nvenc',  qualityRange: [28, 18], presets: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'],                                qualityFlag: '-cq',  presetFlag: '-preset' },
    qsv:   { encoderName: 'h264_qsv',    qualityRange: [28, 18], presets: ['veryfast', 'faster', 'fast', 'medium', 'slow', 'slower'],                qualityFlag: '-global_quality', presetFlag: '-preset' },
    amf:   { encoderName: 'h264_amf',    qualityRange: [28, 18], presets: ['speed', 'balanced', 'quality'],                                          qualityFlag: '-cq',  presetFlag: '-quality' },
  },
  h265: {
    cpu:   { encoderName: 'libx265',     qualityRange: [32, 22], presets: ['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow'], qualityFlag: '-crf', presetFlag: '-preset' },
    nvenc: { encoderName: 'hevc_nvenc',  qualityRange: [28, 18], presets: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'],                                qualityFlag: '-cq',  presetFlag: '-preset' },
    qsv:   { encoderName: 'hevc_qsv',    qualityRange: [28, 18], presets: ['veryfast', 'faster', 'fast', 'medium', 'slow', 'slower'],                qualityFlag: '-global_quality', presetFlag: '-preset' },
    amf:   { encoderName: 'hevc_amf',    qualityRange: [28, 18], presets: ['speed', 'balanced', 'quality'],                                          qualityFlag: '-cq',  presetFlag: '-quality' },
  },
  av1: {
    // libaom-av1 (NOT libsvtav1) — bundled ffmpeg-static doesn't include
    // libsvtav1, but libaom-av1 is universally available. The substitution
    // layer in ffmpegService still swaps to libsvtav1 on systems that have
    // it, so users with custom builds get the faster encoder for free.
    cpu:   { encoderName: 'libaom-av1',  qualityRange: [35, 25], presets: ['8', '7', '6', '5', '4'],                                                 qualityFlag: '-crf', presetFlag: '-cpu-used', extraFlags: '-b:v 0 -row-mt 1' },
    nvenc: { encoderName: 'av1_nvenc',   qualityRange: [40, 28], presets: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'],                                qualityFlag: '-cq',  presetFlag: '-preset' },
    qsv:   { encoderName: 'av1_qsv',     qualityRange: [40, 28], presets: ['veryfast', 'faster', 'fast', 'medium', 'slow', 'slower'],                qualityFlag: '-global_quality', presetFlag: '-preset' },
    amf:   { encoderName: 'av1_amf',     qualityRange: [40, 28], presets: ['speed', 'balanced', 'quality'],                                          qualityFlag: '-cq',  presetFlag: '-quality' },
  },
}

/** Pick a preset from an array based on the slider position (0–100). 0% picks
 *  the first preset (fastest), 100% picks the last (slowest practical). */
function pickPreset(presets: string[], quality: number): string {
  const t = Math.max(0, Math.min(100, quality)) / 100
  const idx = Math.round(t * (presets.length - 1))
  return presets[idx]
}

/** Linearly interpolate between worst (0%) and best (100%) CRF values. */
function pickQualityValue(range: [number, number], quality: number): number {
  const t = Math.max(0, Math.min(100, quality)) / 100
  const [worst, best] = range
  return Math.round(worst + (best - worst) * t)
}

export interface ResolvedQuality {
  /** ffmpeg encoder name, e.g. 'libx264', 'av1_nvenc'. */
  encoderName: string
  /** Numeric CRF/CQ value (e.g. 23). Comparable across the chosen encoder. */
  qualityValue: number
  /** Speed preset string (e.g. 'medium', 'p5', '6'). */
  presetValue: string
  /** Human label for the speed preset ("Fast", "Balanced", "Slow") — for UI hints. */
  speedLabel: string
}

/** Resolve a quality slider position (0–100) for a chosen codec/encoder pair
 *  to concrete encoder name + CRF/CQ value + preset. Used both by the args
 *  builder (to assemble flags) and by the UI (to show "CRF 23, Balanced" hints
 *  to power users). Returns null when the codec/encoder combination is not
 *  supported. */
export function resolveQuality(codec: CodecKey, encoder: EncoderKey, quality: number): ResolvedQuality | null {
  const profile = ENCODER_PROFILES[codec]?.[encoder]
  if (!profile) return null
  const presetValue = pickPreset(profile.presets, quality)
  const qualityValue = pickQualityValue(profile.qualityRange, quality)
  // Three-bucket label that doesn't lie about the underlying preset count:
  // 0–33% → Fast, 34–66% → Balanced, 67–100% → Slow.
  const speedLabel = quality < 34 ? 'Fast' : quality < 67 ? 'Balanced' : 'Slow'
  return {
    encoderName: profile.encoderName,
    qualityValue,
    presetValue,
    speedLabel,
  }
}

const AUDIO_CODEC_NAMES: Record<string, string> = {
  aac: 'aac',
  mp3: 'libmp3lame',
  opus: 'libopus',
}

const AUDIO_CHANNEL_FLAG: Record<CustomPresetForm['audio']['channels'], string> = {
  original: '',
  stereo:   '-ac 2',
  mono:     '-ac 1',
}

/** Compile a CustomPresetForm into ffmpeg output args + final container ext.
 *  Returns null if the form's codec/encoder combination is invalid (UI should
 *  prevent this, but we double-check). */
export function buildFfmpegArgs(form: CustomPresetForm): { args: string; outputExtension: string } | null {
  const parts: string[] = []

  // When keepAllTracks is on, explicitly map every video + audio stream from
  // the input. Without this, ffmpeg's default picks only ONE audio stream
  // (typically the first), losing OBS's multi-track recordings. -map is
  // additive across `-map` flags; we put video first for output ordering.
  if (form.audio.codec !== 'none' && form.audio.keepAllTracks) {
    parts.push('-map 0:v', '-map 0:a')
  }

  // Video
  if (form.video.codec === 'copy') {
    parts.push('-c:v copy')
  } else {
    const profile = ENCODER_PROFILES[form.video.codec]?.[form.video.encoder]
    if (!profile) return null
    const resolved = resolveQuality(form.video.codec, form.video.encoder, form.video.quality)
    if (!resolved) return null
    parts.push(
      `-c:v ${profile.encoderName}`,
      `${profile.qualityFlag} ${resolved.qualityValue}`,
      `${profile.presetFlag} ${resolved.presetValue}`,
    )
    if (profile.extraFlags) parts.push(profile.extraFlags)
  }

  // Audio
  if (form.audio.codec === 'none') {
    parts.push('-an')
  } else if (form.audio.codec === 'copy') {
    parts.push('-c:a copy')
  } else {
    const codecName = AUDIO_CODEC_NAMES[form.audio.codec]
    parts.push(`-c:a ${codecName}`, `-b:a ${form.audio.bitrate}k`)
    const channels = AUDIO_CHANNEL_FLAG[form.audio.channels]
    if (channels) parts.push(channels)
  }

  return {
    args: parts.join(' '),
    outputExtension: form.container,
  }
}

/** Encoder names we'll probe at modal open to know which encoders are
 *  available on this machine. Drives which encoder options are offered for
 *  each codec. (CPU encoders are always assumed available — they're in
 *  ffmpeg-static.) */
export const PROBE_ENCODERS: { codec: CodecKey; encoder: EncoderKey; name: string }[] = [
  { codec: 'h264', encoder: 'nvenc', name: 'h264_nvenc' },
  { codec: 'h264', encoder: 'qsv',   name: 'h264_qsv' },
  { codec: 'h264', encoder: 'amf',   name: 'h264_amf' },
  { codec: 'h265', encoder: 'nvenc', name: 'hevc_nvenc' },
  { codec: 'h265', encoder: 'qsv',   name: 'hevc_qsv' },
  { codec: 'h265', encoder: 'amf',   name: 'hevc_amf' },
  { codec: 'av1',  encoder: 'nvenc', name: 'av1_nvenc' },
  { codec: 'av1',  encoder: 'qsv',   name: 'av1_qsv' },
  { codec: 'av1',  encoder: 'amf',   name: 'av1_amf' },
]

/** Priority order when auto-picking an encoder — hardware encoders preferred
 *  over CPU because most users want speed, NVENC first because its output
 *  quality is generally considered the best of the hardware encoders, then
 *  QSV (Intel), then AMF (AMD). CPU is the always-available fallback. */
const ENCODER_PRIORITY: EncoderKey[] = ['nvenc', 'qsv', 'amf', 'cpu']

/** Pick the best available encoder for a codec. Returns 'cpu' if nothing
 *  better is available — CPU encoders are always shipped with ffmpeg-static
 *  so they're effectively always available. */
export function pickBestEncoder(codec: CodecKey, availableKeys: Set<string>): EncoderKey {
  for (const e of ENCODER_PRIORITY) {
    if (availableKeys.has(`${codec}_${e}`)) return e
  }
  return 'cpu'
}

/** Compute the set of slider positions (0–100) where the output args
 *  *actually change* for a given codec/encoder. The slider has 101 distinct
 *  inputs but only N distinct outputs (a CRF value × a preset), so the slider
 *  snaps to these "stops" — every nudge produces a visible difference instead
 *  of dead zones where the user is moving the thumb but nothing's changing.
 *
 *  0 and 100 are always included as natural endpoints — without explicit
 *  inclusion of 100, dragging to the right edge would snap backward to the
 *  FIRST position that produces the best combo, which violates user
 *  expectation that the slider's max value is reachable. */
export function computeQualityStops(codec: CodecKey, encoder: EncoderKey): number[] {
  const profile = ENCODER_PROFILES[codec]?.[encoder]
  if (!profile) return [0, 100]
  const seen = new Set<string>()
  const stops = new Set<number>([0, 100])
  for (let q = 0; q <= 100; q++) {
    const r = resolveQuality(codec, encoder, q)
    if (!r) continue
    const key = `${r.qualityValue}|${r.presetValue}`
    if (!seen.has(key)) {
      seen.add(key)
      stops.add(q)
    }
  }
  return [...stops].sort((a, b) => a - b)
}

/** Snap a quality value to the nearest stop. Used by the slider's onChange
 *  so dragging only ever lands on positions where the output args change. */
export function snapQualityToStop(stops: number[], value: number): number {
  if (stops.length === 0) return value
  let best = stops[0]
  let bestDist = Math.abs(best - value)
  for (let i = 1; i < stops.length; i++) {
    const d = Math.abs(stops[i] - value)
    if (d < bestDist) { best = stops[i]; bestDist = d }
  }
  return best
}
