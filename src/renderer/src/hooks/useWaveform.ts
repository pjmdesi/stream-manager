import { useEffect, useState, useMemo } from 'react'

export interface WaveformPeak { min: number; max: number }

// Module-level cache keyed by joined paths — survives component unmounts (tab switches)
const peakCache = new Map<string, WaveformPeak[]>()

function combinePeaks(allPeaks: WaveformPeak[][]): WaveformPeak[] {
  if (allPeaks.length === 0) return []
  if (allPeaks.length === 1) return allPeaks[0]

  const n = Math.max(...allPeaks.map(p => p.length))
  const result: WaveformPeak[] = []

  for (let i = 0; i < n; i++) {
    let mn = 0, mx = 0
    for (const peaks of allPeaks) {
      if (peaks.length === 0) continue
      const idx = Math.min(i, peaks.length - 1)
      if (peaks[idx].min < mn) mn = peaks[idx].min
      if (peaks[idx].max > mx) mx = peaks[idx].max
    }
    result.push({ min: mn, max: mx })
  }
  return result
}

function normalizePeaks(peaks: WaveformPeak[]): WaveformPeak[] {
  if (peaks.length === 0) return []
  let globalMax = 0
  for (const p of peaks) {
    const v = Math.max(Math.abs(p.min), Math.abs(p.max))
    if (v > globalMax) globalMax = v
  }
  if (globalMax === 0) return peaks
  return peaks.map(p => ({ min: p.min / globalMax, max: p.max / globalMax }))
}

// sources: array of file paths — single path for pre-merge, multiple for post-merge
export function useWaveform(sources: string[]) {
  const cacheKey = sources.join('\0')

  const [peaks, setPeaks] = useState<WaveformPeak[]>(
    () => peakCache.get(cacheKey) ?? []
  )
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (sources.length === 0) { setPeaks([]); setLoading(false); return }

    const cached = peakCache.get(cacheKey)
    if (cached) { setPeaks(cached); return }

    let cancelled = false
    setLoading(true)
    setPeaks([])

    Promise.all(sources.map(p => window.api.getWaveform(p)))
      .then(allPeaks => {
        if (cancelled) return
        const combined = combinePeaks(allPeaks)
        const normalized = normalizePeaks(combined)
        peakCache.set(cacheKey, normalized)
        setPeaks(normalized)
        setLoading(false)
      })
      .catch(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
  }, [cacheKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const svgPath = useMemo(() => {
    if (peaks.length === 0) return ''
    const n = peaks.length
    const mid = 50
    const amp = 47

    const parts: string[] = []
    for (let i = 0; i < n; i++) {
      parts.push(`${i === 0 ? 'M' : 'L'}${i},${(mid - peaks[i].max * amp).toFixed(1)}`)
    }
    for (let i = n - 1; i >= 0; i--) {
      parts.push(`L${i},${(mid - peaks[i].min * amp).toFixed(1)}`)
    }
    parts.push('Z')
    return parts.join(' ')
  }, [peaks])

  return { peaks, svgPath, peakCount: peaks.length, loading }
}
