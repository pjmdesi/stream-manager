import React, { useState, useRef, useCallback, useLayoutEffect } from 'react'
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

export function Tooltip({ content, side = 'top', width = 'w-max', maxWidth = 'max-w-xs', triggerClassName, children }: TooltipProps) {
  const [visible, setVisible] = useState(false)
  const [pos, setPos]         = useState({ top: 0, left: 0 })
  const triggerRef            = useRef<HTMLDivElement>(null)
  const tooltipRef            = useRef<HTMLDivElement>(null)
  const arrowRef              = useRef<HTMLDivElement>(null)

  const show = useCallback(() => {
    if (!triggerRef.current) return
    const r = triggerRef.current.getBoundingClientRect()
    const { top, left } = computeAnchor(r, side)
    setPos({ top, left })
    setVisible(true)
  }, [side])

  // After the tooltip portal renders, try each fallback side in priority order
  // until one fits inside the viewport. Runs before paint — no visible flash.
  useLayoutEffect(() => {
    if (!visible || !tooltipRef.current || !triggerRef.current) return
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
      if (arrowEl) arrowEl.className = ARROW[trySide]
      if (fits(el.getBoundingClientRect(), vw, vh)) return
    }
  }, [visible, pos, side])

  return (
    <>
      <div ref={triggerRef} className={triggerClassName ?? 'inline-flex'} onMouseEnter={show} onMouseLeave={() => setVisible(false)}>
        {children}
      </div>
      {visible && createPortal(
        <div
          ref={tooltipRef}
          className={`fixed pointer-events-none z-[10001] ${width} ${maxWidth} rounded-lg bg-navy-800 border border-white/10 px-3 py-2.5 text-xs text-gray-300 leading-relaxed shadow-xl`}
          style={{ top: pos.top, left: pos.left, transform: TRANSFORM[side] }}
        >
          {content}
          <div ref={arrowRef} className={ARROW[side]} />
        </div>,
        document.body
      )}
    </>
  )
}
