import React, { useEffect, useState } from 'react'
import { Film } from 'lucide-react'

// Cache generated frames by file path so a thumbnail isn't re-decoded when the
// same file remounts somewhere else (converter panels, the files grid, etc.).
const thumbCache = new Map<string, { url: string; aspect: number }>()

// Offscreen decodes currently holding a Chromium read handle on their file,
// keyed by path. The handle lives from src-set until cleanup — long enough on
// multi-GB videos to block moving the file to the recycle bin (media opens
// without delete sharing on Windows). Delete flows call releaseThumbDecodes()
// first so the handle drops before main touches the file; main's trash retry
// ladder absorbs the asynchronous release.
const activeDecodes = new Map<string, Set<() => void>>()

/** Cancel any in-flight offscreen frame decodes for these paths, releasing
 *  their file handles. Paths with no active decode are ignored. */
export function releaseThumbDecodes(paths: string[]): void {
  for (const p of paths) {
    const set = activeDecodes.get(p)
    if (!set) continue
    activeDecodes.delete(p)
    for (const cancel of [...set]) cancel()
  }
}

/** Checkerboard backdrop — shows through the letterbox bars of contained media
 *  (non-16:9 video, transparent images) so the content reads clearly. */
export const CHECKER: React.CSSProperties = {
  backgroundColor: '#171c2b',
  backgroundImage:
    'linear-gradient(45deg, rgba(255,255,255,0.06) 25%, transparent 25%, transparent 75%, rgba(255,255,255,0.06) 75%),' +
    'linear-gradient(45deg, rgba(255,255,255,0.06) 25%, transparent 25%, transparent 75%, rgba(255,255,255,0.06) 75%)',
  backgroundSize: '12px 12px',
  backgroundPosition: '0 0, 6px 6px',
}

/**
 * VideoThumb — grabs a frame at the midpoint of a video via an offscreen
 * <video> + canvas (same approach as the player's session-video items). Only
 * runs for confirmed-local files so cloud placeholders aren't hydrated, and
 * caches by path so moving between surfaces reuses the already-decoded frame.
 *
 * Pass `height` only → width follows the video's aspect ratio (good for inline
 * rows). Pass both `width` and `height` → fixed box, frame cropped via
 * object-cover (good for aligned grid cards).
 */
export function VideoThumb({ path, width, height = 56, checker = false, rounded = 'rounded-md' }: { path: string; width?: number; height?: number; checker?: boolean; rounded?: string }) {
  const cached = thumbCache.get(path)
  const [thumbnail, setThumbnail] = useState<string | null>(cached?.url ?? null)
  const [aspect, setAspect] = useState(cached?.aspect ?? 16 / 9)

  useEffect(() => {
    if (thumbCache.has(path)) return // in-memory (L1) hit — nothing to do
    let cancelled = false
    let cleanupDecode: (() => void) | null = null

    // Renderer fallback: decode one frame at the midpoint via an offscreen
    // <video> + canvas, then persist it as the keystone so next time it's free.
    const decode = (): (() => void) => {
      const vid = document.createElement('video')
      vid.src = `file://${path.replace(/\\/g, '/')}`
      vid.muted = true
      vid.preload = 'metadata'
      let sought = false
      const cleanup = () => {
        const set = activeDecodes.get(path)
        if (set) { set.delete(cleanup); if (set.size === 0) activeDecodes.delete(path) }
        vid.removeEventListener('loadedmetadata', onMeta)
        vid.removeEventListener('seeked', onSeeked)
        vid.removeEventListener('error', onErr)
        vid.src = ''
        // Detach the resource for real — without load() Chromium can keep
        // the old file's handle open well past the src clear.
        vid.load()
      }
      const onMeta = () => {
        const dur = vid.duration
        if (isFinite(dur) && dur > 0) {
          if (vid.videoWidth > 0 && vid.videoHeight > 0) setAspect(vid.videoWidth / vid.videoHeight)
          if (!sought) { sought = true; vid.currentTime = dur * 0.5 }
        } else cleanup()
      }
      const onSeeked = () => {
        const vw = vid.videoWidth || 80
        const vh = vid.videoHeight || 45
        const canvas = document.createElement('canvas')
        canvas.height = 64
        canvas.width = Math.round(64 * (vw / vh))
        const ctx = canvas.getContext('2d')
        if (ctx) {
          try {
            ctx.drawImage(vid, 0, 0, canvas.width, canvas.height)
            const url = canvas.toDataURL('image/jpeg', 0.7)
            thumbCache.set(path, { url, aspect: vw / vh })
            if (!cancelled) setThumbnail(url)
            window.api.saveKeystoneThumbnail(path, url).catch(() => {})
          } catch { /* decode error */ }
        }
        cleanup()
      }
      const onErr = () => cleanup()
      vid.addEventListener('loadedmetadata', onMeta)
      vid.addEventListener('seeked', onSeeked)
      vid.addEventListener('error', onErr)
      const set = activeDecodes.get(path) ?? new Set<() => void>()
      set.add(cleanup)
      activeDecodes.set(path, set)
      return cleanup
    }

    void (async () => {
      // Cloud gate: never touch a non-local file — probing/decoding would
      // hydrate it.
      let isLocal = false
      try { isLocal = !!(await window.api.checkLocalFiles([path]))[0] } catch { /* assume cloud */ }
      if (cancelled || !isLocal) return

      // Disk keystone (L2), or one minted from the player's strip cache.
      let keystone: string | null = null
      try { keystone = await window.api.getKeystoneThumbnail(path) } catch { /* fall through */ }
      if (cancelled) return
      if (keystone) {
        thumbCache.set(path, { url: keystone, aspect })
        setThumbnail(keystone)
        return
      }
      // Nothing cached anywhere → generate it ourselves.
      cleanupDecode = decode()
    })()

    return () => { cancelled = true; cleanupDecode?.() }
  }, [path]) // eslint-disable-line react-hooks/exhaustive-deps

  const H = height
  const W = width ?? Math.round(H * aspect)
  return (
    <div className={`relative shrink-0 ${rounded} overflow-hidden flex items-center justify-center ${checker ? '' : 'bg-white/5'}`} style={checker ? { width: W, height: H, ...CHECKER } : { width: W, height: H }}>
      {thumbnail
        ? (
          <img
            src={thumbnail}
            alt=""
            className="w-full h-full object-contain"
            onLoad={e => {
              // A keystone arrives as a URL with no known aspect — read it off the
              // loaded frame so the converter's aspect-derived width is correct.
              const im = e.currentTarget
              if (im.naturalWidth > 0 && im.naturalHeight > 0) {
                const a = im.naturalWidth / im.naturalHeight
                setAspect(a)
                const c = thumbCache.get(path)
                if (c) thumbCache.set(path, { url: c.url, aspect: a })
              }
            }}
          />
        )
        : (
          // Opaque fill so the (always-present) checker backdrop doesn't show
          // behind the placeholder — only behind a real, letterboxed frame.
          <div className="w-full h-full flex items-center justify-center bg-navy-800">
            <Film size={13} className="text-gray-500" />
          </div>
        )}
    </div>
  )
}
