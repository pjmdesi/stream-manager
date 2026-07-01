import React, { useState, useRef, useEffect, useCallback } from 'react'
import { X, Loader2, Trash2, Copy, Check, AlertTriangle } from 'lucide-react'
import { Tooltip } from './Tooltip'
import { TruncatedText } from './TruncatedText'
import { useFieldSuggestion } from '../../hooks/useFieldSuggestion'

function EditorTagChip({
  tag, chipCls, onRemove,
}: {
  tag: string
  chipCls: string
  onRemove: () => void
}) {
  const [truncated, setTruncated] = useState(false)
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

  const chip = (
    <span className={chipCls}>
      <span ref={setTextRef} className="truncate min-w-0">{tag}</span>
      <button
        type="button"
        onClick={onRemove}
        className="text-gray-500 hover:text-red-400 transition-colors leading-none shrink-0"
        aria-label={`Remove ${tag}`}
      >
        <X size={9} />
      </button>
    </span>
  )
  return truncated ? (
    <Tooltip content={tag} side="top" triggerClassName="inline-block max-w-full min-w-0">{chip}</Tooltip>
  ) : chip
}

/**
 * TagChipEditor — visible removable chips + a trailing input. Enter or comma
 * commits, Backspace on an empty input pops the last chip, blur commits any
 * pending input text. Case-insensitive dedupe across the existing chip list.
 */
export function TagChipEditor({
  value,
  onChange,
  placeholder,
  tabAttached,
  tabActive,
  aiFetcher,
  footerRight,
  sortOnBlur,
}: {
  value: string[]
  onChange: (next: string[]) => Promise<void> | void
  placeholder?: string
  /** Alphabetically sort the chips (case-insensitive) when the field loses
   *  focus. Used for YouTube tags so SM's order matches YouTube, which
   *  re-sorts tags alphabetically on its end. Off by default. */
  sortOnBlur?: boolean
  /** Drops the top-right corner rounding so an InlineTemplateSelect tab
   *  can sit flush against it. */
  tabAttached?: boolean
  /** Lightens the border (focus state still wins) to indicate an
   *  attached tab is "active" — paired with InlineTemplateSelect's
   *  tabActive flag. */
  tabActive?: boolean
  /** Optional Claude suggestion fetcher — wires Ctrl+Space inside the
   *  trailing input. */
  aiFetcher?: (prefix: string, suffix: string) => Promise<string | null>
  /** Rendered flush-right on the same row as the AI hint. */
  footerRight?: React.ReactNode
}) {
  const [input, setInput] = useState('')
  // Clear-all arms on first click and confirms on second so users can't
  // wipe their chip list with a single misclick. Resets whenever the
  // chip list changes (any edit pulls the user out of the confirm flow)
  // or the editor loses pointer focus.
  const [clearArmed, setClearArmed] = useState(false)
  useEffect(() => { setClearArmed(false) }, [value])
  // Brief visual ack after a successful copy so the user knows the
  // click landed. Auto-resets after 1.5s.
  const [justCopied, setJustCopied] = useState(false)
  useEffect(() => {
    if (!justCopied) return
    const id = setTimeout(() => setJustCopied(false), 1500)
    return () => clearTimeout(id)
  }, [justCopied])

  const noopFetcher = useCallback((_p: string, _s: string) => Promise.resolve(null), [])
  const sg = useFieldSuggestion(input, setInput, aiFetcher ?? noopFetcher)
  const aiEnabled = !!aiFetcher

  // Merge comma/typed input into the current chip list, deduped
  // case-insensitively. Returns the same `value` reference when nothing new
  // was added so callers can skip a no-op onChange.
  const mergeInput = (raw: string): string[] => {
    const fresh = raw.split(',').map(t => t.trim()).filter(Boolean)
    if (fresh.length === 0) return value
    const seen = new Set(value.map(t => t.toLowerCase()))
    const additions = fresh.filter(t => {
      const k = t.toLowerCase()
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
    return additions.length > 0 ? [...value, ...additions] : value
  }

  const commit = (raw: string) => {
    const next = mergeInput(raw)
    if (next !== value) onChange(next)
    setInput('')
  }

  const removeAt = (i: number) => {
    onChange(value.filter((_, idx) => idx !== i))
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // AI suggestion accept — when Tab is pressed with a suggestion
    // showing, commit the merged DOM text directly as chips instead
    // of routing through useFieldSuggestion's accept-then-wait-for-
    // comma flow. The hook injects the suggestion into the DOM
    // element's `value` via a layout effect (React's controlled
    // `input` state is still '' / the pre-suggestion text), so
    // `currentTarget.value` reads the prefix + suggestion + suffix
    // string the user is looking at.
    if (e.key === 'Tab' && sg.hasSuggestion) {
      e.preventDefault()
      const accepted = e.currentTarget.value
      sg.dismiss()
      commit(accepted)
      return
    }
    sg.props.onKeyDown(e)
    if (e.defaultPrevented) return
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      commit(input)
    } else if (e.key === 'Backspace' && input === '' && value.length > 0) {
      e.preventDefault()
      onChange(value.slice(0, -1))
    }
  }

  const handleBlur = () => {
    sg.props.onBlur()
    let next = mergeInput(input)
    if (input) setInput('')
    if (sortOnBlur) {
      const sorted = [...next].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
      if (sorted.some((t, i) => t !== next[i])) next = sorted
    }
    if (next !== value) onChange(next)
  }

  const chipCls = 'inline-flex items-center gap-1 text-[10px] text-purple-300/80 bg-purple-500/10 border border-purple-500/25 rounded px-1.5 py-0.5 max-w-full'

  return (
    <div className="flex flex-col">
      <div className={`flex flex-wrap gap-1 items-center min-h-[1.75rem] bg-navy-900/70 border ${tabActive ? 'border-white/[0.18]' : 'border-white/10'} px-1.5 py-1 focus-within:border-purple-500/50 focus-within:bg-navy-900 transition-colors ${tabAttached ? 'rounded-lg rounded-tr-none' : 'rounded-lg'}`}>
        {value.map((tag, i) => (
          <EditorTagChip
            key={`${tag}-${i}`}
            tag={tag}
            chipCls={chipCls}
            onRemove={() => removeAt(i)}
          />
        ))}
        <input
          ref={sg.ref as React.RefObject<HTMLInputElement>}
          type="text"
          value={input}
          onChange={sg.props.onChange}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          placeholder={value.length === 0 ? placeholder : ''}
          className="flex-1 min-w-[80px] bg-transparent text-[11px] text-gray-200 placeholder-gray-500 outline-none border-none p-0.5"
        />
        {value.length > 0 && (
          <>
            <Tooltip content={justCopied ? 'Copied!' : 'Copy tags as comma-separated text'} side="top">
              <button
                type="button"
                // onMouseDown + preventDefault for the same focus-preservation
                // reason as the clear button — keeps a half-typed tag in
                // the trailing input alive across the click.
                onMouseDown={e => {
                  e.preventDefault()
                  void navigator.clipboard.writeText(value.join(', ')).then(
                    () => setJustCopied(true),
                    () => {},
                  )
                }}
                aria-label="Copy tags as comma-separated text"
                className={`shrink-0 p-1 rounded transition-colors leading-none ${
                  justCopied
                    ? 'text-green-400 bg-green-500/10'
                    : 'text-gray-500 hover:text-gray-200'
                }`}
              >
                {justCopied ? <Check size={11} /> : <Copy size={11} />}
              </button>
            </Tooltip>
            <Tooltip
              content={clearArmed ? `Click again to clear ${value.length} tag${value.length === 1 ? '' : 's'}` : 'Clear all tags'}
              side="top"
            >
              <button
                type="button"
                // onMouseDown over onClick so the trailing input's blur
                // doesn't fire first and commit a half-typed tag right
                // before we wipe everything. preventDefault keeps focus
                // on whatever currently has it.
                onMouseDown={e => {
                  e.preventDefault()
                  if (!clearArmed) { setClearArmed(true); return }
                  onChange([])
                  setClearArmed(false)
                  setInput('')
                }}
                onBlur={() => setClearArmed(false)}
                aria-label={clearArmed ? 'Confirm clear all tags' : 'Clear all tags'}
                className={`shrink-0 p-1 rounded transition-colors leading-none ${
                  clearArmed
                    ? 'text-amber-400 hover:text-amber-300 bg-amber-500/10'
                    : 'text-gray-500 hover:text-red-400'
                }`}
              >
                <Trash2 size={11} />
              </button>
            </Tooltip>
          </>
        )}
      </div>
      {(aiEnabled || footerRight) && (
        <div className="flex items-center justify-between gap-2 mt-0.5 min-h-[14px]">
          {aiEnabled ? (
            <p className="flex items-center gap-1 text-[10px] text-gray-400 min-w-0">
              {sg.hint === 'loading' && <><Loader2 size={9} className="animate-spin" />Generating…</>}
              {sg.hint === 'accept' && <>Tab to accept · Esc to dismiss</>}
              {sg.hint === 'error' && (
                <span className="flex items-center gap-1 text-red-400 min-w-0">
                  <AlertTriangle size={9} className="shrink-0" /><TruncatedText text={sg.error ?? ''} className="truncate" />
                </span>
              )}
              {!sg.hint && <span>Ctrl+Space for AI suggestion</span>}
            </p>
          ) : <span />}
          {footerRight}
        </div>
      )}
    </div>
  )
}
