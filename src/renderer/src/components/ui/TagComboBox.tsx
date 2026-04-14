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
    setRect(el.getBoundingClientRect())
    const obs = new ResizeObserver(() => setRect(el.getBoundingClientRect()))
    obs.observe(el)
    return () => obs.disconnect()
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
