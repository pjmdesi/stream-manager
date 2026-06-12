import React, { useState, useRef, useMemo, useEffect, useLayoutEffect, useCallback } from 'react'
import ReactDOM from 'react-dom'
import { X } from 'lucide-react'
import { getTagColor, getTagTextureStyle } from '../../constants/tagColors'
import { Tooltip } from './Tooltip'

/**
 * Single chip with truncation-aware Tooltip. Detects overflow via
 * scrollWidth > clientWidth on the inner text span; only renders the
 * Tooltip when the chip is actually clipped, so short tags don't
 * carry a redundant hover tip with the same text. Pulled into its own
 * component because hooks can't be called inside the .map() loop.
 *
 * Optional selection + reorder:
 *   - `onSelect` flips the chip into a clickable affordance; `isSelected`
 *     adds a purple ring (the app's themed `purple-400/70`, NOT the real
 *     twitch purple — see StreamsPage's Topics/Games row where this is
 *     used: selection drives both YT title's {game} merge field AND the
 *     Twitch category, so a Twitch-specific accent would mis-signal the
 *     scope).
 *   - When `onSelect` is present the truncation-only tooltip is
 *     replaced with a contextual "click to select / push to apply"
 *     hint (full chip text is still readable inline).
 *   - `draggable` + `onDragStart/Enter/End` make the chip a drag source
 *     for reorder; the parent splices the array on dragenter so the row
 *     animates a live preview rather than waiting for drop.
 */
function ComboTagChip({
  text, chipClassName, textureStyle, onRemove,
  isSelected, onSelect,
  draggable, onDragStart, onDragEnter, onDragEnd, onDragOver,
}: {
  text: string
  chipClassName: string
  textureStyle?: React.CSSProperties
  onRemove: () => void
  isSelected?: boolean
  onSelect?: () => void
  draggable?: boolean
  onDragStart?: () => void
  onDragEnter?: () => void
  onDragEnd?: () => void
  onDragOver?: (e: React.DragEvent) => void
}) {
  const [truncated, setTruncated] = useState(false)
  // Callback ref so the observer follows whichever inner span is
  // currently mounted — see DisplayTagChip in legacyStreamsShared for
  // the long version. useRef + useLayoutEffect would leave the
  // observer bound to the previous detached span across the
  // wrap-toggle remount.
  const obsCleanupRef = useRef<(() => void) | null>(null)
  const setTextRef = useCallback((el: HTMLSpanElement | null) => {
    obsCleanupRef.current?.()
    obsCleanupRef.current = null
    if (!el) return
    const check = () => setTruncated(el.scrollWidth > el.clientWidth)
    check()
    let raf = 0
    const obs = new ResizeObserver(() => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(check)
    })
    obs.observe(el)
    obsCleanupRef.current = () => {
      cancelAnimationFrame(raf)
      obs.disconnect()
    }
  }, [])
  useEffect(() => () => { obsCleanupRef.current?.() }, [])

  const selectionRing = isSelected ? 'ring-2 ring-purple-400/70 ring-offset-1 ring-offset-navy-900' : ''
  // Cursor signals primary affordance: drag wins when both are present
  // (matches OS convention — visible grab handle suggests reorder, the
  // click still works on mouseup-without-drag).
  const cursorClass = draggable ? 'cursor-grab active:cursor-grabbing' : (onSelect ? 'cursor-pointer' : '')
  const chip = (
    <span
      className={`${chipClassName} ${selectionRing} ${cursorClass}`}
      style={textureStyle}
      draggable={draggable}
      onDragStart={draggable ? (e => {
        // Without setData Firefox refuses to start the drag. Empty
        // string is fine — the parent tracks the source index in React
        // state, not via DataTransfer.
        e.dataTransfer.setData('text/plain', text)
        e.dataTransfer.effectAllowed = 'move'
        onDragStart?.()
      }) : undefined}
      onDragEnter={draggable ? (() => onDragEnter?.()) : undefined}
      onDragOver={draggable ? (e => { e.preventDefault(); onDragOver?.(e) }) : undefined}
      onDragEnd={draggable ? (() => onDragEnd?.()) : undefined}
      onClick={onSelect ? (() => onSelect()) : undefined}
    >
      <span ref={setTextRef} className="truncate min-w-0">{text}</span>
      <button
        type="button"
        // stopPropagation so removing a chip doesn't also select it on
        // its way out. preventDefault keeps the input from losing
        // focus when the user mousedowns the X.
        onMouseDown={e => { e.preventDefault(); e.stopPropagation(); onRemove() }}
        // Inert during drag — HTML5 DnD on a child button can hijack
        // the parent span's drag handlers in some browsers.
        draggable={false}
        className="opacity-60 hover:opacity-100 transition-opacity shrink-0"
      >
        <X size={10} />
      </button>
    </span>
  )
  // Tooltip selection: when selectable, show contextual affordance
  // hint; otherwise fall back to the truncation-only behaviour so
  // short chips don't carry a redundant tip echoing their own text.
  const tooltipContent = onSelect
    ? (isSelected
        ? 'Active topic / game — push YouTube + Twitch to apply'
        : 'Click to set as active topic / game · Drag to reorder')
    : (truncated ? text : null)
  // inline-block + max-w-full + min-w-0 on the Tooltip wrapper — see
  // DisplayTagChip in legacyStreamsShared for the long version. Default
  // inline-flex wrapper would collapse to chip natural width and break
  // the truncation cascade; min-w-0 overrides the flex-item
  // min-content default so max-w-full actually cascades.
  return tooltipContent
    ? <Tooltip content={tooltipContent} side="top" triggerClassName="inline-block max-w-full min-w-0">{chip}</Tooltip>
    : chip
}

function HighlightMatch({ text, query }: { text: string; query: string }) {
  const idx = text.toLowerCase().indexOf(query.toLowerCase())
  if (idx === -1) return <>{text}</>
  return (
    <>
      {text.slice(0, idx)}
      <span className="font-semibold text-purple-300">{text.slice(idx, idx + query.length)}</span>
      {text.slice(idx + query.length)}
    </>
  )
}

function SuggestionsPortal({
  anchorRef,
  children,
}: {
  anchorRef: React.RefObject<HTMLElement | null>
  children: React.ReactNode
}) {
  const [rect, setRect] = useState<DOMRect | null>(null)

  useEffect(() => {
    const el = anchorRef.current
    if (!el) return
    // Find the nearest scrolling ancestor so we can hide the dropdown
    // when the anchor scrolls out of its visible bounds — e.g. when a
    // long modal body is scrolled and the input leaves the viewport.
    // Without this the portal kept showing at the (now-invisible)
    // anchor's position and overlapped the modal header.
    const getScrollParent = (node: HTMLElement | null): HTMLElement | null => {
      let cur = node?.parentElement ?? null
      while (cur) {
        const style = getComputedStyle(cur)
        if (/auto|scroll|overlay/.test(style.overflowY)) return cur
        cur = cur.parentElement
      }
      return null
    }
    const scrollParent = getScrollParent(el)
    // Coalesce rect updates through rAF so a rapid scroll doesn't trigger
    // a setState per pixel — one update per frame is plenty for tracking
    // a fixed-position dropdown to its anchor.
    let raf = 0
    const update = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const anchorRect = el.getBoundingClientRect()
        if (scrollParent) {
          const parentRect = scrollParent.getBoundingClientRect()
          // Hide when the anchor is entirely above or below the scroll
          // container's visible area. Partial overlap still renders the
          // dropdown — that matches native <select> behaviour and lets
          // the user keep typing as they scroll the input into view.
          if (anchorRect.bottom < parentRect.top || anchorRect.top > parentRect.bottom) {
            setRect(null)
            return
          }
        }
        setRect(anchorRect)
      })
    }
    update()
    const obs = new ResizeObserver(update)
    obs.observe(el)
    // capture:true catches scrolls of any ancestor (modal body, page,
    // anything nested) so the dropdown follows the input wherever it
    // moves. Without this, the portal stayed pinned at its initial
    // viewport coordinates while the user scrolled.
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    return () => {
      cancelAnimationFrame(raf)
      obs.disconnect()
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
  }, [anchorRef])

  if (!rect) return null
  return ReactDOM.createPortal(
    <div
      style={{ position: 'fixed', top: rect.bottom + 4, left: rect.left, width: rect.width, zIndex: 9999 }}
      className="bg-navy-700 border border-white/10 rounded-lg shadow-xl overflow-hidden max-h-44 overflow-y-auto"
    >
      {children}
    </div>,
    document.body
  )
}

interface TagComboBoxProps {
  values: string[]
  onChange: (values: string[]) => void
  allOptions: string[]
  placeholder?: string
  emptyLabel?: string
  tagColors?: Record<string, string>
  tagTextures?: Record<string, string>
  /** Called when a tag is added that didn't previously exist in allOptions */
  onNewTag?: (tag: string) => void
  /** Renders chips at a slightly smaller size — for high-volume lists like Topics/Games */
  compact?: boolean
  /** When set, the chip whose value equals this gets a purple ring and
   *  the chips become click-to-select. Used for the Topics/Games row to
   *  expose `meta.primaryGame` selection (which drives the YT title's
   *  `{game}` merge field AND the Twitch category push). */
  selectedValue?: string
  onSelectValue?: (value: string) => void
  /** When true, chips become drag-source for reorder. The parent's
   *  `onChange` is called with the new array on every drag-enter so the
   *  row animates a live reorder preview during the drag, not only on
   *  drop. */
  reorderable?: boolean
}

export function TagComboBox({
  values,
  onChange,
  allOptions,
  placeholder = 'Type and press Enter…',
  emptyLabel,
  tagColors,
  tagTextures,
  onNewTag,
  compact,
  selectedValue,
  onSelectValue,
  reorderable,
}: TagComboBoxProps) {
  const [input, setInput] = useState('')
  const [open, setOpen] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  // Index of the chip currently being dragged. Updated on each
  // drag-enter so we can keep splicing relative to the chip's most
  // recent position rather than its original start position.
  const [dragIndex, setDragIndex] = useState<number | null>(null)

  const suggestions = useMemo(() => {
    const q = input.toLowerCase()
    return allOptions.filter(o => !values.includes(o) && (q === '' || o.toLowerCase().includes(q)))
  }, [allOptions, values, input])

  useEffect(() => { setHighlightedIndex(0) }, [suggestions])

  const add = (name?: string) => {
    const trimmed = (name ?? input).trim()
    if (trimmed && !values.includes(trimmed)) {
      onChange([...values, trimmed])
      if (onNewTag && !allOptions.includes(trimmed)) onNewTag(trimmed)
    }
    setInput('')
    inputRef.current?.focus()
  }

  const remove = (v: string) => onChange(values.filter(x => x !== v))

  // Splice-and-insert reorder. Called on drag-enter against a different
  // chip — moves the dragged chip to the target index immediately so the
  // user sees a continuous preview, then updates dragIndex to the new
  // position so subsequent drag-enters move from there.
  const reorder = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0) return
    const next = [...values]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    onChange(next)
    setDragIndex(to)
  }

  const showAddNew = input.trim() !== '' &&
    !allOptions.some(o => o.toLowerCase() === input.trim().toLowerCase()) &&
    !values.includes(input.trim())

  const chipSize = compact ? 'text-[11px] px-1.5 py-0' : 'text-xs px-2 py-0.5'

  return (
    <div
      ref={containerRef}
      className="flex flex-wrap items-center gap-1.5 min-h-[38px] w-full bg-navy-900 border border-white/10 rounded-lg px-2 py-1.5 cursor-text focus-within:ring-2 focus-within:ring-purple-500/50"
      onClick={() => inputRef.current?.focus()}
    >
      {values.map((v, idx) => {
        const color = getTagColor(tagColors?.[v])
        return (
          <ComboTagChip
            key={v}
            text={v}
            chipClassName={`inline-flex items-center gap-1 border rounded-full shrink-0 max-w-full ${color.chip} ${chipSize}`}
            textureStyle={getTagTextureStyle(tagTextures?.[v])}
            onRemove={() => remove(v)}
            isSelected={selectedValue !== undefined && selectedValue === v}
            onSelect={onSelectValue ? () => onSelectValue(v) : undefined}
            draggable={reorderable && values.length > 1}
            onDragStart={() => setDragIndex(idx)}
            onDragEnter={() => { if (dragIndex !== null) reorder(dragIndex, idx) }}
            onDragEnd={() => setDragIndex(null)}
          />
        )
      })}

      <input
        ref={inputRef}
        className="flex-1 min-w-[120px] bg-transparent text-gray-200 text-sm outline-none placeholder:text-gray-600"
        value={input}
        onChange={e => { setInput(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={e => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
            e.preventDefault()
            setOpen(true)
            setHighlightedIndex(i => Math.min(i + 1, suggestions.length - 1))
          } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
            e.preventDefault()
            setHighlightedIndex(i => Math.max(i - 1, 0))
          } else if (e.key === 'Enter') {
            e.preventDefault()
            if (open && suggestions.length > 0) add(suggestions[highlightedIndex])
            else add()
          } else if (e.key === 'Escape') {
            if (open) {
              e.preventDefault()
              e.stopPropagation()
              setOpen(false)
            }
          } else if (e.key === 'Backspace' && input === '' && values.length > 0) {
            remove(values[values.length - 1])
          }
        }}
        placeholder={values.length === 0 ? placeholder : ''}
        autoComplete="off"
      />

      {open && (suggestions.length > 0 || showAddNew) && (
        <SuggestionsPortal anchorRef={containerRef}>
          <div className="p-2 flex flex-wrap gap-1.5">
            {suggestions.map((o, i) => {
              const color = getTagColor(tagColors?.[o])
              const highlighted = i === highlightedIndex
              return (
                <button
                  key={o}
                  type="button"
                  onMouseDown={e => { e.preventDefault(); add(o) }}
                  onMouseEnter={() => setHighlightedIndex(i)}
                  className={`inline-flex items-center border rounded-full text-xs px-2 py-0.5 transition-all ${color.chip} ${color.text} ${
                    highlighted ? `ring-2 ${color.ring} ring-offset-1 ring-offset-navy-700` : 'opacity-70 hover:opacity-100'
                  }`}
                >
                  {input ? <HighlightMatch text={o} query={input} /> : o}
                </button>
              )
            })}
          </div>
          {showAddNew && (
            <button
              type="button"
              onMouseDown={e => { e.preventDefault(); add(input.trim()) }}
              className="w-full text-left px-3 py-2 text-sm text-purple-400 hover:bg-purple-600/20 transition-colors border-t border-white/5"
            >
              Add "{input.trim()}"
            </button>
          )}
        </SuggestionsPortal>
      )}
    </div>
  )
}
