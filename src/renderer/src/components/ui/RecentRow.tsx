import React, { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { Tooltip } from './Tooltip'

/** Canvas-downscaled thumbnail with object-cover semantics. Chromium's
 *  compositor keeps a fast low-quality resample path at extreme downscale
 *  ratios (1280×720 → ~80px is ~16×) even with the image-rendering hint, so
 *  we resample ourselves: crop to cover, then repeated HALVING with
 *  high-quality smoothing down to ~2× target, then the final draw. Quality
 *  holds at any ratio. Renders at devicePixelRatio for crisp HiDPI. */
export function SmoothThumb({ src, className, onError }: { src: string; className?: string; onError?: () => void }) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    let cancelled = false
    const img = new Image()
    img.onload = () => {
      if (cancelled) return
      const wrap = wrapRef.current
      const canvas = canvasRef.current
      if (!wrap || !canvas || wrap.clientWidth === 0 || wrap.clientHeight === 0) return
      const dpr = window.devicePixelRatio || 1
      const bw = Math.max(1, Math.round(wrap.clientWidth * dpr))
      const bh = Math.max(1, Math.round(wrap.clientHeight * dpr))
      // Cover-crop region of the source.
      const scale = Math.max(bw / img.width, bh / img.height)
      const sw = bw / scale
      const sh = bh / scale
      const sx = (img.width - sw) / 2
      const sy = (img.height - sh) / 2
      // Working canvas at the cropped source size, then halve repeatedly.
      let cur = document.createElement('canvas')
      cur.width = Math.max(1, Math.round(sw))
      cur.height = Math.max(1, Math.round(sh))
      const wctx = cur.getContext('2d')!
      wctx.imageSmoothingEnabled = true
      wctx.imageSmoothingQuality = 'high'
      wctx.drawImage(img, sx, sy, sw, sh, 0, 0, cur.width, cur.height)
      while (cur.width > bw * 2 && cur.height > bh * 2) {
        const next = document.createElement('canvas')
        next.width = Math.max(bw, Math.floor(cur.width / 2))
        next.height = Math.max(bh, Math.floor(cur.height / 2))
        const nctx = next.getContext('2d')!
        nctx.imageSmoothingEnabled = true
        nctx.imageSmoothingQuality = 'high'
        nctx.drawImage(cur, 0, 0, next.width, next.height)
        cur = next
      }
      canvas.width = bw
      canvas.height = bh
      const ctx = canvas.getContext('2d')!
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(cur, 0, 0, cur.width, cur.height, 0, 0, bw, bh)
    }
    img.onerror = () => { if (!cancelled) onError?.() }
    img.src = src
    return () => { cancelled = true }
  }, [src]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div ref={wrapRef} className={className}>
      <canvas ref={canvasRef} className="w-full h-full" />
    </div>
  )
}

/**
 * RecentRow — the shared "recent item" row used by the player overview and
 * the thumbnail overview: smooth thumbnail | title + subtitle | trailing
 * label | hover-revealed remove button. Callers style subtitle/trailing
 * themselves (they differ per page); the row owns the frame, thumb box,
 * and remove affordance so the two pages can't drift apart again.
 */
export function RecentRow({ thumbSrc, thumbIsLocal, thumbFallback, title, subtitle, trailing, onOpen, onRemove }: {
  /** file:// URL of the thumbnail (cache-busted by the caller), or null. */
  thumbSrc: string | null
  /** false = cloud placeholder — never load it (a file:// read would
   *  trigger a recall); the fallback icon renders instead. */
  thumbIsLocal?: boolean
  thumbFallback: React.ReactNode
  title: React.ReactNode
  subtitle?: React.ReactNode
  trailing?: React.ReactNode
  onOpen: () => void
  onRemove: () => void
}) {
  const [err, setErr] = useState(false)
  useEffect(() => { setErr(false) }, [thumbSrc])
  const showImage = !!thumbSrc && thumbIsLocal !== false && !err
  return (
    <div className="group flex items-center gap-3 pr-1 rounded-lg bg-navy-800 border border-white/5 hover:border-white/15 hover:bg-white/5 transition-colors overflow-hidden">
      <button onClick={onOpen} className="flex items-center gap-3 flex-1 min-w-0 text-left">
        <div className="w-20 shrink-0 self-stretch bg-navy-900 rounded-l-lg overflow-hidden flex items-center justify-center">
          {showImage
            ? <SmoothThumb src={thumbSrc} className="w-full h-full" onError={() => setErr(true)} />
            : thumbFallback}
        </div>
        <div className="flex-1 min-w-0 py-2">
          <p className="text-xs text-gray-300 truncate">{title}</p>
          {subtitle}
        </div>
      </button>
      {trailing}
      <Tooltip content="Remove from recents" triggerClassName="shrink-0">
        <button
          onClick={onRemove}
          className="p-1.5 rounded text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition-colors opacity-0 group-hover:opacity-100"
          aria-label="Remove from recents"
        >
          <X size={13} />
        </button>
      </Tooltip>
    </div>
  )
}
