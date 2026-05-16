import { useEffect, useState, useMemo } from 'react'

// How many peaks to render across the visible viewport.
// 1200 gives ~1 peak per pixel on a 1200px-wide strip and is fast to compute.
const TARGET_PEAKS = 1200

const SAMPLE_RATE = 200 // must match ffmpegService '-ar' value

// Module-level cache of raw samples keyed by file path — survives tab switches
const rawCache = new Map<string, Float32Array>()

function toFloat32(buf: Uint8Array): Float32Array {
  // buf may have a non-zero byteOffset if it's a subarray of a shared ArrayBuffer
  const aligned = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  return new Float32Array(aligned)
}

function globalMax(raw: Float32Array): number {
  let mx = 0
  for (let i = 0; i < raw.length; i++) {
    const v = Math.abs(raw[i])
    if (v > mx) mx = v
  }
  return mx
}

// Re-bucket raw samples from [vStart, vEnd] into exactly targetPeaks min/max pairs.
function rebucket(raw: Float32Array, vStart: number, vEnd: number, targetPeaks: number): { mins: Float32Array; maxs: Float32Array } {
  const startSample = Math.max(0, Math.floor(vStart * SAMPLE_RATE))
  const endSample   = Math.min(raw.length, Math.ceil(vEnd * SAMPLE_RATE))
  const sampleCount = endSample - startSample
  const mins = new Float32Array(targetPeaks)
  const maxs = new Float32Array(targetPeaks)

  if (sampleCount <= 0) return { mins, maxs }

  const samplesPerPeak = sampleCount / targetPeaks
  for (let i = 0; i < targetPeaks; i++) {
    const s = Math.floor(startSample + i * samplesPerPeak)
    const e = Math.min(Math.floor(startSample + (i + 1) * samplesPerPeak), endSample)
    let mn = 0, mx = 0
    for (let j = s; j < e; j++) {
      const v = raw[j]
      if (v < mn) mn = v
      if (v > mx) mx = v
    }
    mins[i] = mn
    maxs[i] = mx
  }
  return { mins, maxs }
}

function buildSvgPath(mins: Float32Array, maxs: Float32Array, gmax: number): string {
  const n = mins.length
  if (n === 0) return ''
  const amp = 47
  const mid = 50
  const scale = gmax > 0 ? 1 / gmax : 1

  const parts: string[] = []
  for (let i = 0; i < n; i++) {
    parts.push(`${i === 0 ? 'M' : 'L'}${i},${(mid - maxs[i] * scale * amp).toFixed(1)}`)
  }
  for (let i = n - 1; i >= 0; i--) {
    parts.push(`L${i},${(mid - mins[i] * scale * amp).toFixed(1)}`)
  }
  parts.push('Z')
  return parts.join(' ')
}

// sources: array of file paths — single for original file, multiple for extracted tracks
export function useWaveform(sources: string[], vStart: number, vEnd: number, duration: number) {
  const cacheKey = sources.join('\0')

  const [rawArrays, setRawArrays] = useState<Float32Array[]>(() =>
    sources.map(s => rawCache.get(s) ?? new Float32Array(0))
  )
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (sources.length === 0) { setRawArrays([]); setLoading(false); return }

    // All sources already in cache?
    const cached = sources.map(s => rawCache.get(s))
    if (cached.every(Boolean)) {
      setRawArrays(cached as Float32Array[])
      return
    }

    let cancelled = false
    setLoading(true)
    setRawArrays(sources.map(s => rawCache.get(s) ?? new Float32Array(0)))

    Promise.all(sources.map(async s => {
      if (rawCache.has(s)) return rawCache.get(s)!
      const buf = await window.api.getWaveform(s)
      const raw = toFloat32(buf)
      rawCache.set(s, raw)
      return raw
    })).then(arrays => {
      if (cancelled) return
      setRawArrays(arrays)
      setLoading(false)
    }).catch(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
  }, [cacheKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const { svgPath, svgPaths } = useMemo(() => {
    if (rawArrays.length === 0) return { svgPath: '', svgPaths: [] as string[] }

    const safeStart = Math.max(0, vStart)
    const safeEnd   = duration > 0 ? Math.min(duration, vEnd) : vEnd

    // Re-bucket each source. Empty arrays produce no buckets — the slot
    // in svgPaths stays as '' so callers can still index by source order.
    const bucketed = rawArrays.map(raw =>
      raw.length > 0 ? rebucket(raw, safeStart, safeEnd, TARGET_PEAKS) : null
    )

    // Shared gmax — max across every loaded source. This is what makes
    // per-source paths comparable: a quiet mic track and a loud game
    // track end up with peaks at proportional heights instead of each
    // filling its row.
    const filledRaw = rawArrays.filter(r => r.length > 0)
    if (filledRaw.length === 0) {
      return { svgPath: '', svgPaths: rawArrays.map(() => '') }
    }
    const gmax = Math.max(...filledRaw.map(globalMax))

    // Per-source paths, each normalised to the SHARED gmax so the
    // amplitude difference between tracks is honest.
    const svgPaths = bucketed.map(b => b ? buildSvgPath(b.mins, b.maxs, gmax) : '')

    // Combined min-of-mins / max-of-maxs across sources, also scaled to
    // gmax so it lines up with the per-source paths if both are shown.
    const combinedMins = new Float32Array(TARGET_PEAKS)
    const combinedMaxs = new Float32Array(TARGET_PEAKS)
    for (let i = 0; i < TARGET_PEAKS; i++) {
      let mn = 0, mx = 0
      for (const b of bucketed) {
        if (!b) continue
        if (b.mins[i] < mn) mn = b.mins[i]
        if (b.maxs[i] > mx) mx = b.maxs[i]
      }
      combinedMins[i] = mn
      combinedMaxs[i] = mx
    }
    const svgPath = buildSvgPath(combinedMins, combinedMaxs, gmax)

    return { svgPath, svgPaths }
  }, [rawArrays, vStart, vEnd, duration])

  return { svgPath, svgPaths, peakCount: TARGET_PEAKS, loading }
}
