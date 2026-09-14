import React, { useLayoutEffect, useRef, useState } from 'react'

/**
 * A floating control strip attached to a rectangle inside a container:
 * centered under the rectangle's bottom edge, flipped INSIDE the rectangle
 * when the container has no room below, and clamped fully into the
 * container when the rectangle's edges run out of view. Measures itself
 * after every render, since both its content and the anchor move (drags,
 * zoom, pan). Used by the player's crop controls and the thumbnail
 * editor's selection tools (THU-28).
 */
export function AnchoredPanel({ anchor, boundsW, boundsH, gap = 6, className = '', onMouseDown, children }: {
  /** The anchor rect in CONTAINER coordinates (already mapped through any
   *  zoom/pan transform the content sits under). */
  anchor: { x: number; y: number; w: number; h: number }
  boundsW: number
  boundsH: number
  /** Space between the anchor's edge and the panel. */
  gap?: number
  /** Appended to the panel's base classes (border color, spacing). */
  className?: string
  /** The panel is usually a SIBLING of a zoom/pan wrapper, so stage
   *  gestures do not bubble to it naturally; callers forward middle-click
   *  here to keep panning available from anywhere on the stage. */
  onMouseDown?: (e: React.MouseEvent) => void
  children: React.ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: 8, top: 8 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const gw = el.offsetWidth
    const gh = el.offsetHeight
    const PAD = 8
    // X: centered on the anchor, clamped into the container.
    let left = anchor.x + anchor.w / 2 - gw / 2
    left = Math.max(PAD, Math.min(left, boundsW - gw - PAD))
    // Y: below the anchor's bottom edge; flip to INSIDE the anchor when
    // the container has no room below; the final clamp snaps it to the
    // container's bottom (still anchor-centered in X) when the anchor's
    // bottom edge itself is out of view.
    let top = anchor.y + anchor.h + gap
    if (top + gh > boundsH - PAD) top = anchor.y + anchor.h - gap - gh
    top = Math.max(PAD, Math.min(top, boundsH - gh - PAD))
    setPos(p => (Math.abs(p.left - left) < 0.5 && Math.abs(p.top - top) < 0.5 ? p : { left, top }))
  })
  return (
    <div
      ref={ref}
      className={`absolute z-20 flex items-center rounded-lg bg-navy-800/95 shadow-xl ${className}`}
      style={{ left: pos.left, top: pos.top }}
      onMouseDown={onMouseDown}
    >
      {children}
    </div>
  )
}
