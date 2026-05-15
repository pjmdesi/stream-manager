import React, { useState, useRef, useMemo, useEffect } from 'react'
import ReactDOM from 'react-dom'
import { X } from 'lucide-react'
import { getTagColor, getTagTextureStyle } from '../../constants/tagColors'

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
}: TagComboBoxProps) {
  const [input, setInput] = useState('')
  const [open, setOpen] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

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
      {values.map(v => {
        const color = getTagColor(tagColors?.[v])
        return (
          <span
            key={v}
            className={`inline-flex items-center gap-1 border rounded-full shrink-0 ${color.chip} ${chipSize}`}
            style={getTagTextureStyle(tagTextures?.[v])}
          >
            {v}
            <button
              type="button"
              onMouseDown={e => { e.preventDefault(); remove(v) }}
              className="opacity-60 hover:opacity-100 transition-opacity"
            >
              <X size={10} />
            </button>
          </span>
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
