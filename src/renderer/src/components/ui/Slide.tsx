import React, { useEffect, useRef, useState } from 'react'

/**
 * Height-reveal animation primitives for the nav rail's choreography (nav
 * redesign). Both use the animatable grid-rows 0fr↔1fr height-to-auto
 * trick — same family as CollapsibleLabel's grid-cols.
 */

/** jQuery slideDown/slideUp-style height reveal, caller-driven: eases open
 *  when `open` goes true (double-rAF so the zero-height frame paints
 *  first), eases shut when it goes false — the caller keeps it mounted
 *  through the close animation and unmounts afterward. Mounting in the
 *  steady-open state renders open without an entrance slide. */
export function SlideOpen({ open, durationMs, children }: { open: boolean; durationMs: number; children: React.ReactNode }) {
  const [shown, setShown] = useState(open)
  useEffect(() => {
    if (!open) { setShown(false); return }
    let raf2 = 0
    const raf1 = requestAnimationFrame(() => { raf2 = requestAnimationFrame(() => setShown(true)) })
    return () => { cancelAnimationFrame(raf1); cancelAnimationFrame(raf2) }
  }, [open])
  return (
    <div
      className="grid transition-[grid-template-rows]"
      style={{ gridTemplateRows: shown ? '1fr' : '0fr', transitionDuration: `${durationMs}ms` }}
    >
      <div className="overflow-hidden min-h-0">{children}</div>
    </div>
  )
}

/** Slide-open/slide-shut visibility for live info content: content
 *  appearing eases the block open, content disappearing eases it shut
 *  while HOLDING the last rendered state through the exit (a finishing
 *  job closes on its "100%" rather than blanking), then unmounts.
 *  Mounting in the steady-shown state renders open without an entrance
 *  slide. */
export function SlideBlock({ show, durationMs, children }: { show: boolean; durationMs: number; children?: React.ReactNode }) {
  const [shown, setShown] = useState(show)
  const [mounted, setMounted] = useState(show)
  const heldRef = useRef<React.ReactNode>(show ? children : null)
  if (show) heldRef.current = children
  useEffect(() => {
    if (show) {
      setMounted(true)
      let raf2 = 0
      const raf1 = requestAnimationFrame(() => { raf2 = requestAnimationFrame(() => setShown(true)) })
      return () => { cancelAnimationFrame(raf1); cancelAnimationFrame(raf2) }
    }
    setShown(false)
    const t = setTimeout(() => { setMounted(false); heldRef.current = null }, durationMs)
    return () => clearTimeout(t)
  }, [show, durationMs])
  if (!mounted) return null
  return (
    <div
      className="grid transition-[grid-template-rows] ease-out"
      style={{ gridTemplateRows: shown ? '1fr' : '0fr', transitionDuration: `${durationMs}ms` }}
    >
      <div className="overflow-hidden min-h-0">{heldRef.current}</div>
    </div>
  )
}
