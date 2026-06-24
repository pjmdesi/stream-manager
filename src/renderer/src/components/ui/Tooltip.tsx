import React, { useState, useRef, useCallback, useLayoutEffect, useEffect } from 'react'
import { createPortal } from 'react-dom'

type TooltipSide = 'top' | 'bottom' | 'left' | 'right'

interface TooltipProps {
  content: React.ReactNode
  side?: TooltipSide
  width?: string
  /** Override the default `max-w-xs` cap. Use Tailwind classes like
   *  'max-w-md' or 'max-w-[480px]' for tooltips that need to fit longer
   *  prose (e.g. full stream descriptions). */
  maxWidth?: string
  /** Extra classes applied to the trigger wrapper div (e.g. 'w-full block' for full-width triggers) */
  triggerClassName?: string
  /** Inline style for the trigger wrapper. Used together with
   *  `triggerClassName="fixed pointer-events-none"` + an externally
   *  controlled `open` flag to position the wrapper precisely over a
   *  non-React-rendered visual element — the Tooltip then anchors off
   *  that fixed-position wrapper instead of wherever it'd otherwise
   *  flow in the DOM. */
  triggerStyle?: React.CSSProperties
  /** When true, the tooltip body becomes pointer-event-active and stays
   *  open while the cursor is over it (with a brief grace period to
   *  traverse the gap from trigger to tooltip). A click anywhere inside
   *  the tooltip auto-dismisses it, so consumers can wire selection
   *  handlers on inner buttons without managing tooltip visibility. */
  interactive?: boolean
  /** Optional shortcut hint rendered as a smaller, dimmer last line in the
   *  tooltip (e.g. "Ctrl+N") — surfaces a button's keyboard shortcut. */
  shortcut?: React.ReactNode
  /** Externally-controlled visibility. When set, the internal hover
   *  triggers are bypassed and the tooltip mirrors the prop. Used by
   *  consumers that can't make the actual visual element a React
   *  child (e.g. tokens inside a contenteditable). The caller is
   *  responsible for positioning the trigger wrapper over the real
   *  visual element so getBoundingClientRect() anchors the tooltip
   *  at the right spot. Leave undefined for the standard
   *  hover-driven behavior. */
  open?: boolean
  children: React.ReactNode
}

const TRANSFORM: Record<TooltipSide, string> = {
  top:    'translate(-50%, -100%)',
  bottom: 'translate(-50%, 0)',
  left:   'translate(-100%, -50%)',
  right:  'translate(0, -50%)',
}

const ARROW: Record<TooltipSide, string> = {
  top:    'absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-white/10',
  bottom: 'absolute bottom-full left-1/2 -translate-x-1/2 border-4 border-transparent border-b-white/10',
  left:   'absolute left-full top-1/2 -translate-y-1/2 border-4 border-transparent border-l-white/10',
  right:  'absolute right-full top-1/2 -translate-y-1/2 border-4 border-transparent border-r-white/10',
}

// Fallback order when the preferred side doesn't fit
const SIDE_PRIORITY: Record<TooltipSide, TooltipSide[]> = {
  top:    ['top',    'left',  'right', 'bottom'],
  bottom: ['bottom', 'left',  'right', 'top'   ],
  left:   ['left',   'top',   'bottom','right'  ],
  right:  ['right',  'top',   'bottom','left'   ],
}

const GAP = 8

function computeAnchor(r: DOMRect, s: TooltipSide): { top: number; left: number } {
  switch (s) {
    case 'top':    return { top: r.top    - GAP,           left: r.left + r.width  / 2 }
    case 'bottom': return { top: r.bottom + GAP,           left: r.left + r.width  / 2 }
    case 'left':   return { top: r.top    + r.height / 2,  left: r.left  - GAP         }
    case 'right':  return { top: r.top    + r.height / 2,  left: r.right + GAP         }
  }
}

function fits(rect: DOMRect, vw: number, vh: number): boolean {
  return rect.left >= GAP && rect.right <= vw - GAP &&
         rect.top  >= GAP && rect.bottom <= vh - GAP
}

export function Tooltip({ content, side = 'top', width = 'w-max', maxWidth = 'max-w-xs', triggerClassName, triggerStyle, interactive, open, shortcut, children }: TooltipProps) {
  const [visible, setVisible] = useState(false)
  const [pos, setPos]         = useState({ top: 0, left: 0 })
  const triggerRef            = useRef<HTMLDivElement>(null)
  const tooltipRef            = useRef<HTMLDivElement>(null)
  const arrowRef              = useRef<HTMLDivElement>(null)
  const closeTimerRef         = useRef<ReturnType<typeof setTimeout> | null>(null)
  // When `open` is supplied, externally-controlled visibility wins —
  // internal hover state is ignored. Default to the hover-driven flag.
  const effectiveVisible = open ?? visible

  const cancelClose = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
  }, [])

  const show = useCallback(() => {
    cancelClose()
    if (!triggerRef.current) return
    const r = triggerRef.current.getBoundingClientRect()
    const { top, left } = computeAnchor(r, side)
    setPos({ top, left })
    setVisible(true)
  }, [side, cancelClose])

  // For interactive tooltips the user needs a moment to traverse the
  // gap between the trigger and the tooltip body without it disappearing.
  // Non-interactive tooltips close instantly to match prior behavior.
  const close = useCallback(() => {
    if (!interactive) { setVisible(false); return }
    cancelClose()
    closeTimerRef.current = setTimeout(() => {
      setVisible(false)
      closeTimerRef.current = null
    }, 140)
  }, [interactive, cancelClose])

  // Dismiss immediately when the trigger is clicked. Without this a
  // non-interactive tooltip can stick open after a click that re-renders or
  // disables the trigger (the browser may never fire mouseleave), leaving the
  // portaled bubble floating at z-[10001] over the rest of the UI.
  const hideNow = useCallback(() => {
    cancelClose()
    setVisible(false)
  }, [cancelClose])

  useEffect(() => () => cancelClose(), [cancelClose])

  // When externally opened, re-anchor pos from the trigger ref before
  // the side-priority layout effect runs (no-op when hover-driven —
  // `show()` already did this). Runs in layout phase so position is
  // committed before paint.
  useLayoutEffect(() => {
    if (open !== true) return
    const trig = triggerRef.current
    if (!trig) return
    const r = trig.getBoundingClientRect()
    const { top, left } = computeAnchor(r, side)
    setPos(prev => prev.top === top && prev.left === left ? prev : { top, left })
  })

  // After the tooltip portal renders, try each fallback side in priority order
  // until one fits inside the viewport. Runs before paint — no visible flash.
  useLayoutEffect(() => {
    if (!effectiveVisible || !tooltipRef.current || !triggerRef.current) return
    const el      = tooltipRef.current
    const arrowEl = arrowRef.current
    const r       = triggerRef.current.getBoundingClientRect()
    const vw      = window.innerWidth
    const vh      = window.innerHeight

    for (const trySide of SIDE_PRIORITY[side]) {
      const { top, left } = computeAnchor(r, trySide)
      el.style.top       = `${top}px`
      el.style.left      = `${left}px`
      el.style.transform = TRANSFORM[trySide]
      if (arrowEl) { arrowEl.className = ARROW[trySide]; arrowEl.style.left = ''; arrowEl.style.top = '' }
      if (fits(el.getBoundingClientRect(), vw, vh)) return
    }

    // Nothing fit cleanly on any side. Leaving the tooltip on the last-tried
    // fallback ('bottom' for a top-preferred trigger) can shove it off-screen
    // — that's the intermittent "delete tooltip shows below the button" bug: a
    // wide tooltip above a wide button in the bottom-right corner overflows the
    // right edge, so top/left/right all fail and it lands on bottom. Instead
    // keep the PREFERRED side and clamp along the cross axis so it stays in
    // view, then nudge the arrow back toward the trigger so it still points at
    // it.
    const { top, left } = computeAnchor(r, side)
    el.style.transform = TRANSFORM[side]
    if (arrowEl) { arrowEl.className = ARROW[side]; arrowEl.style.left = ''; arrowEl.style.top = '' }
    const { width: tw, height: th } = el.getBoundingClientRect()
    if (side === 'top' || side === 'bottom') {
      const half = tw / 2
      const clamped = Math.max(GAP + half, Math.min(vw - GAP - half, left))
      el.style.left = `${clamped}px`
      el.style.top  = `${top}px`
      if (arrowEl) arrowEl.style.left = `${left - clamped + half}px`
    } else {
      const half = th / 2
      const clamped = Math.max(GAP + half, Math.min(vh - GAP - half, top))
      el.style.top  = `${clamped}px`
      el.style.left = `${left}px`
      if (arrowEl) arrowEl.style.top = `${top - clamped + half}px`
    }
  }, [effectiveVisible, pos, side])

  // Internal hover handlers are wired only when `open` isn't controlled
  // — callers using external control don't want surprise visibility
  // changes from a stray mouse event on the (typically invisible)
  // trigger wrapper.
  const wantsInternalHover = open === undefined

  return (
    <>
      <div
        ref={triggerRef}
        className={triggerClassName ?? 'inline-flex'}
        style={triggerStyle}
        onMouseEnter={wantsInternalHover ? show : undefined}
        onMouseLeave={wantsInternalHover ? close : undefined}
        onClick={wantsInternalHover && !interactive ? hideNow : undefined}
      >
        {children}
      </div>
      {effectiveVisible && createPortal(
        <div
          ref={tooltipRef}
          className={`fixed ${interactive ? 'pointer-events-auto' : 'pointer-events-none'} z-[10001] ${width} ${maxWidth} rounded-lg bg-navy-800 border border-white/10 px-3 py-2.5 text-xs text-gray-300 leading-relaxed shadow-xl`}
          style={{ top: pos.top, left: pos.left, transform: TRANSFORM[side] }}
          onMouseEnter={interactive ? cancelClose : undefined}
          onMouseLeave={interactive ? close : undefined}
          onClick={interactive ? () => setVisible(false) : undefined}
        >
          {content}
          {shortcut != null && <div className="mt-1 text-[10px] text-center text-gray-400">{shortcut}</div>}
          <div ref={arrowRef} className={ARROW[side]} />
        </div>,
        document.body
      )}
    </>
  )
}
