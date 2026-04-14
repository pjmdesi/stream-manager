import { useEffect, useState, useMemo, useRef } from 'react'

export interface Thumbnail {
  time: number
  dataUrl: string
}

const DISPLAY_HEIGHT = 32
const RENDER_SCALE = 3
const FIXED_COUNT = 300
const ZOOM_COUNT = 50
const ZOOM_DEBOUNCE_MS = 500
const ZOOM_FILL_THRESHOLD = 0.75 // trigger when < 75% of visible slots have a frame
const ZOOM_BUFFER_SLOTS = 5      // extra slots to pre-generate on each side of the view

export function useThumbnailStrip(
  filePath: string | null,
  videoUrl: string | null,
  duration: number,
  videoWidth: number,
  videoHeight: number,
  containerWidth: number,
  viewStart: number = 0,
  viewEnd: number = 0,
) {
  const [cachedFrames, setCachedFrames] = useState<Thumbnail[]>([])
  const [zoomFrames, setZoomFrames] = useState<Thumbnail[]>([])
  const [generating, setGenerating] = useState(false)
  const [zoomGenerating, setZoomGenerating] = useState(false)

  // Stale-closure-safe refs used inside debounced/async callbacks
  const allFramesRef = useRef<Thumbnail[]>([])
  useEffect(() => { allFramesRef.current = [...cachedFrames, ...zoomFrames] }, [cachedFrames, zoomFrames])

  const generatingRef = useRef(false)
  useEffect(() => { generatingRef.current = generating }, [generating])

  // Per-generation cancel handle for zoom; calling it aborts the current seek loop
  const cancelZoomRef = useRef<() => void>(() => {})
  const zoomTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Helpers ──────────────────────────────────────────────────────────────

  const makeCapturer = (videoUrl: string, videoWidth: number, videoHeight: number) => {
    const renderWidth  = Math.round(DISPLAY_HEIGHT * RENDER_SCALE * (videoWidth / videoHeight))
    const renderHeight = DISPLAY_HEIGHT * RENDER_SCALE

    const vid = document.createElement('video')
    vid.src   = videoUrl
    vid.muted = true
    vid.preload = 'metadata'

    const canvas = document.createElement('canvas')
    canvas.width  = renderWidth
    canvas.height = renderHeight
    const ctx = canvas.getContext('2d')!

    const captureAt = (time: number): Promise<string | null> =>
      new Promise(resolve => {
        let done = false
        const finish = (result: string | null) => { if (!done) { done = true; resolve(result) } }
        const capture = () => {
          try {
            ctx.drawImage(vid, 0, 0, renderWidth, renderHeight)
            finish(canvas.toDataURL('image/jpeg', 0.8))
          } catch { finish(null) }
        }
        // Check BEFORE mutating currentTime — after assignment the browser reports the new
        // value immediately, so the "already there" test would always be true otherwise.
        const alreadyThere = vid.readyState >= 2 && Math.abs(vid.currentTime - time) < 0.001
        if (alreadyThere) { capture(); return }

        const onSeeked = () => {
          vid.removeEventListener('seeked', onSeeked)
          clearTimeout(timer)
          capture()
        }
        const timer = setTimeout(() => {
          vid.removeEventListener('seeked', onSeeked)
          finish(null)
        }, 3000)
        vid.addEventListener('seeked', onSeeked)
        vid.currentTime = time
      })

    const ready = new Promise<void>(resolve => {
      if (vid.readyState >= 1) { resolve(); return }
      vid.onloadedmetadata = () => resolve()
      vid.onerror          = () => resolve()
    })

    const destroy = () => { vid.src = '' }

    return { captureAt, ready, destroy }
  }

  // ── Base generation (300 frames, persisted to disk) ───────────────────────

  useEffect(() => {
    if (!filePath || !videoUrl || duration <= 0 || videoWidth <= 0 || videoHeight <= 0) {
      setCachedFrames([])
      setZoomFrames([])
      setGenerating(false)
      return
    }

    let cancelled = false
    cancelZoomRef.current() // abort any zoom generation for the old file

    const run = async () => {
      // 1. Try disk cache first
      const cached = await window.api.getThumbnailCache(filePath)
      if (cached && !cancelled) {
        setCachedFrames(cached.timecodes.map((time, i) => ({ time, dataUrl: cached.frameUrls[i] })))
        setZoomFrames([])
        setGenerating(false)
        return
      }

      // 2. Generate from video
      setCachedFrames([])
      setZoomFrames([])
      setGenerating(true)

      const { captureAt, ready, destroy } = makeCapturer(videoUrl, videoWidth, videoHeight)
      await ready

      const timecodes: number[] = Array.from({ length: FIXED_COUNT }, (_, i) =>
        i === 0 ? 0 : i === FIXED_COUNT - 1 ? duration : (i / (FIXED_COUNT - 1)) * duration
      )

      const results: Thumbnail[] = []
      for (let i = 0; i < FIXED_COUNT; i++) {
        if (cancelled) break
        const dataUrl = await captureAt(timecodes[i])
        if (cancelled) break
        if (dataUrl) {
          results.push({ time: timecodes[i], dataUrl })
          setCachedFrames([...results])
          window.api.saveThumbnailFrame(filePath, i, dataUrl)
        }
      }

      destroy()

      if (!cancelled && results.length === FIXED_COUNT) {
        window.api.finalizeThumbnailCache(filePath, timecodes)
      }

      if (!cancelled) setGenerating(false)
    }

    run().catch(() => { if (!cancelled) setGenerating(false) })

    return () => { cancelled = true }
  }, [filePath, videoUrl, duration, videoWidth, videoHeight])

  // ── Zoom generation (50 frames, in-memory only) ───────────────────────────

  useEffect(() => {
    if (!videoUrl || duration <= 0 || videoWidth <= 0 || videoHeight <= 0 || containerWidth < 10) return
    if (viewEnd <= viewStart) return

    // Cancel previous generation and reset debounce
    cancelZoomRef.current()
    if (zoomTimerRef.current) clearTimeout(zoomTimerRef.current)

    zoomTimerRef.current = setTimeout(() => {
      if (generatingRef.current) return // base generation is still running

      const displayThumbWidth = Math.round(DISPLAY_HEIGHT * (videoWidth / videoHeight))
      const slotCount = Math.max(2, Math.floor(containerWidth / displayThumbWidth))

      const vs = viewStart
      const ve = viewEnd > 0 ? viewEnd : duration
      const span = Math.max(0.001, ve - vs)

      // Count how many visible slots are already covered (slot-based, not raw frame count).
      const coveredSlots = new Set<number>()
      for (const f of allFramesRef.current) {
        if (f.time < vs || f.time > ve) continue
        const slotPos = Math.round(((f.time - vs) / span) * (slotCount - 1))
        if (slotPos >= 0 && slotPos < slotCount) coveredSlots.add(slotPos)
      }

      // Skip if coverage is already good enough
      if (coveredSlots.size >= slotCount * ZOOM_FILL_THRESHOLD) return

      // Expand generation range by a buffer on each side so panning reveals pre-loaded frames
      const timePerSlot = span / Math.max(1, slotCount - 1)
      const bufferTime = ZOOM_BUFFER_SLOTS * timePerSlot
      const genStart = Math.max(0, vs - bufferTime)
      const genEnd   = Math.min(duration, ve + bufferTime)
      const genSpan  = Math.max(0.001, genEnd - genStart)

      // Arm cancellation for this generation
      let cancelled = false
      cancelZoomRef.current = () => { cancelled = true; setZoomGenerating(false) }

      const run = async () => {
        setZoomGenerating(true)
        // Keep old zoom frames visible — they stay until replaced slot-by-slot

        const { captureAt, ready, destroy } = makeCapturer(videoUrl, videoWidth, videoHeight)
        await ready
        if (cancelled) { destroy(); return }

        const timecodes = Array.from({ length: ZOOM_COUNT }, (_, i) =>
          ZOOM_COUNT === 1 ? genStart : genStart + (i / (ZOOM_COUNT - 1)) * genSpan
        )

        for (let i = 0; i < ZOOM_COUNT; i++) {
          if (cancelled) break
          const dataUrl = await captureAt(timecodes[i])
          if (cancelled) break
          if (dataUrl) {
            const frame: Thumbnail = { time: timecodes[i], dataUrl }
            setZoomFrames(prev => [...prev, frame])
          }
        }

        destroy()
        if (!cancelled) setZoomGenerating(false)
      }

      run().catch(() => { setZoomGenerating(false) })
    }, ZOOM_DEBOUNCE_MS)

    return () => {
      if (zoomTimerRef.current) clearTimeout(zoomTimerRef.current)
      cancelZoomRef.current()
    }
  }, [viewStart, viewEnd, videoUrl, duration, videoWidth, videoHeight, containerWidth])

  // ── Map all frames to visible slots ───────────────────────────────────────

  const thumbnails = useMemo((): (Thumbnail | null)[] => {
    const allFrames = [...cachedFrames, ...zoomFrames]
    if (allFrames.length === 0 || containerWidth < 10 || videoWidth <= 0 || videoHeight <= 0) return []

    const displayThumbWidth = Math.round(DISPLAY_HEIGHT * (videoWidth / videoHeight))
    const slotCount = Math.max(2, Math.floor(containerWidth / displayThumbWidth))

    const vs = viewStart
    const ve = viewEnd > 0 ? viewEnd : duration
    const span = Math.max(0.001, ve - vs)

    const slots: (Thumbnail | null)[] = Array(slotCount).fill(null)

    for (const frame of allFrames) {
      const slotPos = Math.round(((frame.time - vs) / span) * (slotCount - 1))
      if (slotPos < 0 || slotPos >= slotCount) continue

      const targetTime = vs + (slotPos / (slotCount - 1)) * span
      const existing = slots[slotPos]
      if (!existing || Math.abs(frame.time - targetTime) < Math.abs(existing.time - targetTime)) {
        slots[slotPos] = frame
      }
    }

    return slots
  }, [cachedFrames, zoomFrames, containerWidth, duration, videoWidth, videoHeight, viewStart, viewEnd])

  return { thumbnails, generating, zoomGenerating }
}
