import { useEffect, useState, useMemo } from 'react'

export interface Thumbnail {
  time: number
  dataUrl: string
}

const DISPLAY_HEIGHT = 32
const RENDER_SCALE = 3
const FIXED_COUNT = 200

function closestFrame(frames: Thumbnail[], targetTime: number): Thumbnail {
  return frames.reduce((best, f) =>
    Math.abs(f.time - targetTime) < Math.abs(best.time - targetTime) ? f : best
  )
}

export function useThumbnailStrip(
  filePath: string | null,
  videoUrl: string | null,
  duration: number,
  videoWidth: number,
  videoHeight: number,
  containerWidth: number
) {
  const [cachedFrames, setCachedFrames] = useState<Thumbnail[]>([])
  const [generating, setGenerating] = useState(false)

  // Generate / load the fixed 200-frame cache
  useEffect(() => {
    if (!filePath || !videoUrl || duration <= 0 || videoWidth <= 0 || videoHeight <= 0) {
      setCachedFrames([])
      setGenerating(false)
      return
    }

    let cancelled = false

    const run = async () => {
      // 1. Try cache first
      const cached = await window.api.getThumbnailCache(filePath)
      if (cached && !cancelled) {
        setCachedFrames(cached.timecodes.map((time, i) => ({ time, dataUrl: cached.frameUrls[i] })))
        setGenerating(false)
        return
      }

      // 2. Generate from video
      const renderWidth = Math.round(DISPLAY_HEIGHT * RENDER_SCALE * (videoWidth / videoHeight))
      const renderHeight = DISPLAY_HEIGHT * RENDER_SCALE

      setCachedFrames([])
      setGenerating(true)

      const vid = document.createElement('video')
      vid.src = videoUrl
      vid.muted = true
      vid.preload = 'metadata'

      const canvas = document.createElement('canvas')
      canvas.width = renderWidth
      canvas.height = renderHeight
      const ctx = canvas.getContext('2d')!

      const captureAt = (time: number): Promise<string | null> =>
        new Promise(resolve => {
          const timer = setTimeout(() => { vid.onseeked = null; resolve(null) }, 3000)
          vid.onseeked = () => {
            clearTimeout(timer)
            vid.onseeked = null
            try {
              ctx.drawImage(vid, 0, 0, renderWidth, renderHeight)
              resolve(canvas.toDataURL('image/jpeg', 0.8))
            } catch {
              resolve(null)
            }
          }
          vid.currentTime = time
        })

      await new Promise<void>(resolve => {
        if (vid.readyState >= 1) { resolve(); return }
        vid.onloadedmetadata = () => resolve()
        vid.onerror = () => resolve()
      })

      const timecodes: number[] = Array.from({ length: FIXED_COUNT }, (_, i) =>
        i === 0 ? 0 : i === FIXED_COUNT - 1 ? duration : (i / (FIXED_COUNT - 1)) * duration
      )

      const results: Thumbnail[] = []
      for (let i = 0; i < FIXED_COUNT; i++) {
        if (cancelled) break
        const time = timecodes[i]
        const dataUrl = await captureAt(time)
        if (cancelled) break
        if (dataUrl) {
          results.push({ time, dataUrl })
          setCachedFrames([...results])
          // Save each frame to disk as it's generated
          window.api.saveThumbnailFrame(filePath, i, dataUrl)
        }
      }

      vid.src = ''

      if (!cancelled && results.length === FIXED_COUNT) {
        window.api.finalizeThumbnailCache(filePath, timecodes)
      }

      if (!cancelled) setGenerating(false)
    }

    run().catch(() => { if (!cancelled) setGenerating(false) })

    return () => { cancelled = true }
  }, [filePath, videoUrl, duration, videoWidth, videoHeight])

  // Map the fixed 200 frames to however many slots fit the current container width
  const thumbnails = useMemo(() => {
    if (cachedFrames.length === 0 || containerWidth < 10 || videoWidth <= 0 || videoHeight <= 0) return []
    const displayThumbWidth = Math.round(DISPLAY_HEIGHT * (videoWidth / videoHeight))
    const slotCount = Math.max(2, Math.floor(containerWidth / displayThumbWidth))
    return Array.from({ length: slotCount }, (_, i) => {
      const targetTime = i === 0 ? 0 : i === slotCount - 1 ? duration : (i / (slotCount - 1)) * duration
      return closestFrame(cachedFrames, targetTime)
    })
  }, [cachedFrames, containerWidth, duration, videoWidth, videoHeight])

  return { thumbnails, generating }
}
