import React, { useState, useRef, useMemo, useEffect } from 'react'
import ReactDOM from 'react-dom'
import { X, Plus } from 'lucide-react'
import { getTagColor } from '../../constants/tagColors'

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
  const rect = anchorRef.current?.getBoundingClientRect()
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
  onNewTag,
  compact,
}: TagComboBoxProps) {
  const [input, setInput] = useState('')
  const [open, setOpen] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

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

  return (
    <div className="flex flex-col gap-2">
      {/* Selected tags */}
      <div className="flex flex-wrap gap-1.5 min-h-[28px]">
        {values.map(v => {
          const color = getTagColor(tagColors?.[v])
          return (
            <span
              key={v}
              className={`inline-flex items-center gap-1 border rounded-full ${color.chip} ${compact ? 'text-[11px] px-1.5 py-0' : 'text-xs px-2 py-1'}`}
            >
              {v}
              <button onClick={() => remove(v)} className="opacity-60 hover:opacity-100 transition-opacity">
                <X size={10} />
              </button>
            </span>
          )
        })}
        {values.length === 0 && emptyLabel && (
          <span className="text-xs text-gray-600 italic">{emptyLabel}</span>
        )}
      </div>

      {/* Input + Add button */}
      <div className="relative flex gap-2">
        <div className="relative flex-1">
          <input
            ref={inputRef}
            className="w-full bg-navy-900 border border-white/10 text-gray-200 text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500/50"
            value={input}
            onChange={e => { setInput(e.target.value); setOpen(true) }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 120)}
            onKeyDown={e => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setOpen(true)
                setHighlightedIndex(i => Math.min(i + 1, suggestions.length - 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setHighlightedIndex(i => Math.max(i - 1, 0))
              } else if (e.key === 'Enter') {
                e.preventDefault()
                if (open && suggestions.length > 0) add(suggestions[highlightedIndex])
                else add()
              } else if (e.key === 'Escape') {
                setOpen(false)
              }
            }}
            placeholder={placeholder}
            autoComplete="off"
          />
          {open && (suggestions.length > 0 || showAddNew) && (
            <SuggestionsPortal anchorRef={inputRef}>
              {suggestions.map((o, i) => {
                const color = getTagColor(tagColors?.[o])
                return (
                  <button
                    key={o}
                    type="button"
                    onMouseDown={e => { e.preventDefault(); add(o) }}
                    onMouseEnter={() => setHighlightedIndex(i)}
                    className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                      i === highlightedIndex
                        ? `${color.highlight} ${color.text}`
                        : 'text-gray-300'
                    }`}
                  >
                    {input ? <HighlightMatch text={o} query={input} /> : o}
                  </button>
                )
              })}
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
        <button
          type="button"
          onClick={() => add()}
          className="flex items-center gap-1 px-3 py-1.5 text-xs text-gray-300 bg-white/5 border border-white/10 rounded-lg hover:bg-white/10 transition-colors shrink-0"
        >
          <Plus size={12} />
          Add
        </button>
      </div>
    </div>
  )
}
