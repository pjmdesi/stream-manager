import React, { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react'
import { GripHorizontal, Loader2, AlertTriangle } from 'lucide-react'
import { Tooltip } from './Tooltip'
import { TruncatedText } from './TruncatedText'
import { cleanClaudeError } from '../../lib/claudeError'

// ─── Chip styling (shared between in-editor chips + picker buttons) ─────────

/** Shared chip class — applied both to in-editor token chips and to
 *  the picker buttons below the field so the two render identically.
 *  Uses palette colors (no arbitrary hex values) so Tailwind's JIT
 *  scanner picks them up regardless of whether the class is set in
 *  JSX or imperatively on a DOM element. `box-border` + `leading-none`
 *  pin the chip's box to its content so neither line-height nor
 *  border-box mode causes drift between the two contexts. */
export const MERGE_FIELD_CHIP_CLASS = 'inline-flex items-center box-border leading-none text-[10px] text-purple-300 bg-purple-950 border border-purple-800 rounded px-1.5 py-0.5'
/** Red variant — applied to tokens that exist in the body but don't
 *  apply to the current target (e.g. {episode} on a standalone stream).
 *  Caller decides which keys are inapplicable; the chip still serializes
 *  back as its original `{key}` so flipping the set returns it to the
 *  normal style without losing the token. */
export const MERGE_FIELD_CHIP_CLASS_INAPPLICABLE = 'inline-flex items-center box-border leading-none text-[10px] text-red-300 bg-red-950 border border-red-800 rounded px-1.5 py-0.5'
/** Value-rendering chip — stacks a tiny merge-field name label over the
 *  field's resolved value (which may span multiple lines). Used when the
 *  editor is given a `resolvedValues` map so the user sees what each token
 *  actually renders to, inline. `align-bottom` keeps it sitting on the text
 *  baseline; the column grows to whatever the value needs. */
export const MERGE_FIELD_VALUE_CHIP_CLASS = 'inline-flex flex-col align-bottom box-border mx-px my-0.5 rounded border border-purple-800 bg-purple-950/60 px-1.5 py-0.5 select-none'

// ─── Source <-> DOM helpers ─────────────────────────────────────────────────

/** Read a contenteditable token editor back as its source string.
 *  Chip spans carry their original `{key}` token in `data-token`; plain
 *  text nodes contribute their content verbatim. `<br>` elements
 *  serialize to a single newline (browsers may insert these on Enter
 *  in some environments even when we try to redirect Enter through
 *  execCommand('insertText', '\n')). */
function serialize(el: HTMLElement): string {
  let result = ''
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      result += node.textContent ?? ''
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return
    const elem = node as HTMLElement
    const tok = elem.dataset.token
    if (tok) { result += tok; return }
    if (elem.tagName === 'BR') { result += '\n'; return }
    // Block-level wrappers (`<div>` from default Enter behavior in
    // some browsers, `<p>` from rich paste). Treat each as a line
    // separator at the source level.
    const isBlock = elem.tagName === 'DIV' || elem.tagName === 'P'
    if (isBlock && result.length > 0 && !result.endsWith('\n')) result += '\n'
    for (const child of Array.from(node.childNodes)) walk(child)
  }
  for (const child of Array.from(el.childNodes)) walk(child)
  return result
}

/** Rebuild the contenteditable's DOM to match the given source string.
 *  `{key}` sequences for keys in `knownKeys` become non-editable chip
 *  spans showing just the key name; everything else stays as plain
 *  text nodes (newlines included — `white-space: pre-wrap` on the
 *  editor takes care of rendering them).
 *
 *  Tokens whose key is in `inapplicableKeys` render with the red chip
 *  class plus a `data-inapplicable` attribute that the editor uses to
 *  route hover events to a shared Tooltip. */
function render(
  el: HTMLElement,
  text: string,
  knownKeys: ReadonlySet<string>,
  inapplicableKeys?: ReadonlySet<string>,
  resolvedValues?: ReadonlyMap<string, string>,
): void {
  while (el.firstChild) el.removeChild(el.firstChild)
  const re = /\{(\w+)\}/g
  let lastIdx = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > lastIdx) {
      el.appendChild(document.createTextNode(text.slice(lastIdx, m.index)))
    }
    const tok = m[0]
    const key = m[1]
    if (knownKeys.has(key)) {
      const chip = document.createElement('span')
      chip.contentEditable = 'false'
      chip.dataset.token = tok
      const inapplicable = inapplicableKeys?.has(key) ?? false
      if (inapplicable) chip.dataset.inapplicable = key
      // When a resolved-values map is supplied and the (applicable) token has
      // an entry, render the live value inside the chip (name label on top,
      // value — possibly multi-line — below). Otherwise fall back to the
      // compact name-only chip.
      if (!inapplicable && resolvedValues?.has(key)) {
        chip.className = MERGE_FIELD_VALUE_CHIP_CLASS
        const nameEl = document.createElement('span')
        nameEl.className = 'block text-[8px] uppercase tracking-wider text-purple-400 leading-none mb-0.5'
        nameEl.textContent = key
        const valEl = document.createElement('span')
        const value = resolvedValues.get(key) ?? ''
        if (value) {
          valEl.className = 'block text-xs text-purple-100 leading-snug whitespace-pre-wrap'
          valEl.textContent = value
        } else {
          valEl.className = 'block text-xs italic text-purple-300/60 leading-snug'
          valEl.textContent = '(empty)'
        }
        chip.appendChild(nameEl)
        chip.appendChild(valEl)
      } else {
        const baseCls = inapplicable ? MERGE_FIELD_CHIP_CLASS_INAPPLICABLE : MERGE_FIELD_CHIP_CLASS
        chip.className = baseCls + ' mx-px align-baseline select-none'
        chip.textContent = key
      }
      el.appendChild(chip)
    } else {
      el.appendChild(document.createTextNode(tok))
    }
    lastIdx = m.index + tok.length
  }
  if (lastIdx < text.length) {
    el.appendChild(document.createTextNode(text.slice(lastIdx)))
  }
}

function sourceLengthOf(node: Node): number {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent?.length ?? 0
  if (node.nodeType !== Node.ELEMENT_NODE) return 0
  const el = node as HTMLElement
  const tok = el.dataset.token
  if (tok) return tok.length
  if (el.tagName === 'BR') return 1
  let n = 0
  if (el.tagName === 'DIV' || el.tagName === 'P') n += 1  // implicit leading newline
  for (const child of Array.from(node.childNodes)) n += sourceLengthOf(child)
  return n
}

/** Cursor's start position as an offset into the serialized source. */
function getCursorOffset(root: HTMLElement): number {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return -1
  const range = sel.getRangeAt(0)
  if (!root.contains(range.startContainer)) return -1
  let offset = 0
  const walk = (node: Node): boolean => {
    if (node === range.startContainer) {
      if (node.nodeType === Node.TEXT_NODE) {
        offset += range.startOffset
        return true
      }
      for (let i = 0; i < range.startOffset; i++) {
        const child = node.childNodes[i]
        if (child) offset += sourceLengthOf(child)
      }
      return true
    }
    if (node.nodeType === Node.TEXT_NODE) {
      offset += node.textContent?.length ?? 0
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement
      const tok = el.dataset.token
      if (tok) { offset += tok.length; return false }
      if (el.tagName === 'BR') { offset += 1; return false }
      for (const child of Array.from(node.childNodes)) {
        if (walk(child)) return true
      }
    }
    return false
  }
  for (const child of Array.from(root.childNodes)) {
    if (walk(child)) return offset
  }
  return offset
}

function setCursorOffset(root: HTMLElement, target: number): void {
  let remaining = target
  const placeText = (node: Text, off: number) => {
    const sel = window.getSelection()
    if (!sel) return
    const range = document.createRange()
    range.setStart(node, off)
    range.collapse(true)
    sel.removeAllRanges()
    sel.addRange(range)
  }
  const placeAfter = (node: Node) => {
    const sel = window.getSelection()
    if (!sel) return
    const range = document.createRange()
    range.setStartAfter(node)
    range.collapse(true)
    sel.removeAllRanges()
    sel.addRange(range)
  }
  const walk = (node: Node): boolean => {
    if (node.nodeType === Node.TEXT_NODE) {
      const len = node.textContent?.length ?? 0
      if (remaining <= len) { placeText(node as Text, remaining); return true }
      remaining -= len
      return false
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return false
    const el = node as HTMLElement
    const tok = el.dataset.token
    if (tok) {
      if (remaining < tok.length) { placeAfter(el); return true }
      remaining -= tok.length
      return false
    }
    if (el.tagName === 'BR') {
      if (remaining < 1) { placeAfter(el); return true }
      remaining -= 1
      return false
    }
    for (const child of Array.from(node.childNodes)) {
      if (walk(child)) return true
    }
    return false
  }
  for (const child of Array.from(root.childNodes)) {
    if (walk(child)) return
  }
  const sel = window.getSelection()
  if (sel) {
    const range = document.createRange()
    range.selectNodeContents(root)
    range.collapse(false)
    sel.removeAllRanges()
    sel.addRange(range)
  }
}

/** Resolve a source offset to a concrete DOM point. Returns the text node +
 *  in-node offset when the position lands inside plain text; for a position
 *  at a chip/`<br>` boundary it returns the element with `after: true` so the
 *  caller can use setStartAfter/setEndAfter. Used to paint a selection over
 *  an AI suggestion that was just spliced into the source. */
function domPointAtOffset(root: HTMLElement, target: number): { node: Node; offset?: number; after?: boolean } | null {
  let remaining = target
  let found: { node: Node; offset?: number; after?: boolean } | null = null
  const walk = (node: Node): boolean => {
    if (node.nodeType === Node.TEXT_NODE) {
      const len = node.textContent?.length ?? 0
      if (remaining <= len) { found = { node, offset: remaining }; return true }
      remaining -= len
      return false
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return false
    const el = node as HTMLElement
    const tok = el.dataset.token
    if (tok) {
      if (remaining < tok.length) { found = { node: el, after: true }; return true }
      remaining -= tok.length
      return false
    }
    if (el.tagName === 'BR') {
      if (remaining < 1) { found = { node: el, after: true }; return true }
      remaining -= 1
      return false
    }
    for (const child of Array.from(node.childNodes)) {
      if (walk(child)) return true
    }
    return false
  }
  for (const child of Array.from(root.childNodes)) {
    if (walk(child)) break
  }
  return found
}

/** Paint a selection across the source range [start, end). Returns false if
 *  either endpoint couldn't be resolved (caller falls back to a collapsed
 *  caret). */
function selectSourceRange(root: HTMLElement, start: number, end: number): boolean {
  const a = domPointAtOffset(root, start)
  const b = domPointAtOffset(root, end)
  const sel = window.getSelection()
  if (!a || !b || !sel) return false
  const range = document.createRange()
  if (a.after) range.setStartAfter(a.node); else range.setStart(a.node, a.offset ?? 0)
  if (b.after) range.setEndAfter(b.node); else range.setEnd(b.node, b.offset ?? 0)
  sel.removeAllRanges()
  sel.addRange(range)
  return true
}

// ─── TemplateBodyEditor ─────────────────────────────────────────────────────

/**
 * TemplateBodyEditor — contenteditable input that renders known
 * `{key}` merge-field tokens as atomic non-editable chips. Single-line
 * by default; pass `multiline` for description-style bodies that allow
 * newlines.
 *
 * The chip rendering is imperative (React + contenteditable don't
 * compose cleanly for the inner content), so a layout effect tracks
 * source-text changes and rebuilds the DOM while preserving the
 * cursor via offset helpers.
 */
export function TemplateBodyEditor({
  value, onSave, placeholder, knownKeys, inapplicableKeys, resolvedValues, tabAttached, tabActive, multiline, minHeight, insertRef, autoFocus, height, onHeightChange, aiFetcher,
}: {
  value: string
  onSave: (v: string) => Promise<void> | void
  placeholder?: string
  knownKeys: ReadonlySet<string>
  inapplicableKeys?: ReadonlySet<string>
  /** When provided, known tokens render as chips showing their resolved value
   *  (name label + value) instead of just the token name. Pass a stable
   *  (memoized) map so the editor only rebuilds chips when values change. */
  resolvedValues?: ReadonlyMap<string, string>
  /** Controlled manual-resize height (px) for the multiline drag handle.
   *  `null`/undefined = auto-grow to content. Pair with `onHeightChange` to
   *  persist the dragged height (e.g. to keep it across an edit⇄preview
   *  toggle). */
  height?: number | null
  onHeightChange?: (h: number | null) => void
  tabAttached?: boolean
  tabActive?: boolean
  /** When true, the editor accepts newlines (Enter inserts '\n', paste
   *  preserves line breaks, body wraps via white-space: pre-wrap).
   *  Default false — Enter blurs (saves) and content stays one line. */
  multiline?: boolean
  /** Minimum visible height in px when `multiline` is true. Defaults
   *  to ~6 lines for the description-template form. Ignored when
   *  single-line. */
  minHeight?: number
  insertRef?: React.MutableRefObject<((text: string) => void) | null>
  /** Focus the editor on mount. Useful when the form pops open and
   *  the body field is the primary edit target. */
  autoFocus?: boolean
  /** When provided, Ctrl+Space requests a Claude suggestion at the caret.
   *  The returned text is spliced in and selected; Tab accepts, Esc removes
   *  it, and typing replaces it (same UX as the plain-textarea fields).
   *  `prefix`/`suffix` are the source text on either side of the caret. */
  aiFetcher?: (prefix: string, suffix: string) => Promise<string | null>
}) {
  const [local, setLocal] = useState(value)
  const [saving, setSaving] = useState(false)
  const editorRef = useRef<HTMLDivElement>(null)
  const lastInapplicableRef = useRef<ReadonlySet<string> | undefined>(undefined)
  const lastResolvedRef = useRef<ReadonlyMap<string, string> | undefined>(undefined)

  // ── AI suggestion state ───────────────────────────────────────────────────
  // `aiPending` tracks an inserted-but-unaccepted suggestion as a source
  // [start, start+length) span so Tab (accept) / Esc (remove) / typing
  // (replace) can act on it. Refs mirror the latest values for the keydown
  // and async-completion closures.
  const [aiLoading, setAiLoading] = useState(false)
  const [aiPending, setAiPending] = useState<{ start: number; length: number } | null>(null)
  // Last generation error, surfaced inline (no toast system) and auto-cleared.
  const [aiError, setAiError] = useState<string | null>(null)
  const localRef = useRef(local)
  localRef.current = local
  const aiPendingRef = useRef(aiPending)
  aiPendingRef.current = aiPending
  const aiLoadingRef = useRef(aiLoading)
  aiLoadingRef.current = aiLoading
  const aiFetcherRef = useRef(aiFetcher)
  aiFetcherRef.current = aiFetcher

  // Focus-aware refresh — only sync from props when the user isn't
  // mid-edit. Same pattern as EditableTextField.
  useEffect(() => {
    if (document.activeElement !== editorRef.current) setLocal(value)
  }, [value])

  // Re-render the editor whenever local diverges from what the DOM
  // currently shows OR when the inapplicable set changes (chip colors
  // need to refresh). Preserves cursor across the rebuild.
  useLayoutEffect(() => {
    const el = editorRef.current
    if (!el) return
    const inapplicableChanged = lastInapplicableRef.current !== inapplicableKeys
    const resolvedChanged = lastResolvedRef.current !== resolvedValues
    if (!inapplicableChanged && !resolvedChanged && serialize(el) === local) return
    const owns = document.activeElement === el
    const offset = owns ? getCursorOffset(el) : -1
    render(el, local, knownKeys, inapplicableKeys, resolvedValues)
    lastInapplicableRef.current = inapplicableKeys
    lastResolvedRef.current = resolvedValues
    if (offset >= 0) setCursorOffset(el, offset)
  }, [local, knownKeys, inapplicableKeys, resolvedValues])

  useEffect(() => {
    if (!autoFocus) return
    editorRef.current?.focus()
  }, [autoFocus])

  const handleInput = () => {
    const el = editorRef.current
    if (!el) return
    setLocal(serialize(el))
    // Any real keystroke replaces/edits the pending suggestion — drop the
    // tracking so Tab/Esc no longer act on the now-stale span.
    if (aiPendingRef.current) setAiPending(null)
  }

  // Ctrl+Space → fetch a suggestion at the caret, splice it into the source,
  // and mark it pending. Best-effort: errors are swallowed (no toast system),
  // matching the plain-textarea fields.
  const requestAi = useCallback(async () => {
    const el = editorRef.current
    const fetcher = aiFetcherRef.current
    if (!el || !fetcher || aiPendingRef.current || aiLoadingRef.current) return
    const offset = getCursorOffset(el)
    const base = localRef.current
    const safeOffset = offset < 0 ? base.length : offset
    const prefix = base.slice(0, safeOffset)
    const suffix = base.slice(safeOffset)
    setAiError(null)
    setAiLoading(true)
    try {
      const result = await fetcher(prefix, suffix)
      // Bail if the field changed underneath us or a suggestion is already
      // showing — avoids clobbering edits made during the request.
      if (result && localRef.current === base && !aiPendingRef.current) {
        setLocal(base.slice(0, safeOffset) + result + base.slice(safeOffset))
        setAiPending({ start: safeOffset, length: result.length })
      }
    } catch (e) {
      setAiError(cleanClaudeError(e))
    } finally {
      setAiLoading(false)
    }
  }, [])

  // Auto-dismiss the inline error after a few seconds.
  useEffect(() => {
    if (!aiError) return
    const id = setTimeout(() => setAiError(null), 6000)
    return () => clearTimeout(id)
  }, [aiError])

  // After the chip-render layout effect rebuilds the DOM for a freshly
  // inserted suggestion, paint the selection over its span so the user can
  // see what will be accepted. Runs after the render effect (declared
  // earlier) in the same commit.
  useLayoutEffect(() => {
    if (!aiPending) return
    const el = editorRef.current
    if (!el) return
    el.focus()
    if (!selectSourceRange(el, aiPending.start, aiPending.start + aiPending.length)) {
      setCursorOffset(el, aiPending.start + aiPending.length)
    }
  }, [aiPending])

  // Expose an insert() handle so the picker below the editor can
  // splice tokens in at the cursor position without juggling refs.
  useEffect(() => {
    if (!insertRef) return
    insertRef.current = (text: string) => {
      const el = editorRef.current
      if (!el) return
      const owns = document.activeElement === el
      const offset = owns ? getCursorOffset(el) : local.length
      const safeOffset = offset < 0 ? local.length : offset
      const next = local.slice(0, safeOffset) + text + local.slice(safeOffset)
      setLocal(next)
      requestAnimationFrame(() => {
        const e2 = editorRef.current
        if (!e2) return
        e2.focus()
        setCursorOffset(e2, safeOffset + text.length)
      })
    }
    return () => { if (insertRef) insertRef.current = null }
  }, [insertRef, local])

  const handleBlur = async () => {
    // Leaving the field accepts whatever's currently shown (keeps the text).
    if (aiPendingRef.current) setAiPending(null)
    if (local === value) return
    setSaving(true)
    try { await onSave(local) }
    catch (err) {
      console.error('Autosave failed', err)
      setLocal(value)
    }
    finally { setSaving(false) }
  }

  // Drag-to-resize via the handle strip below the editor (multiline only).
  // Sets an explicit height on the editor (which switches off auto-grow until
  // double-clicked), and reports it up via onHeightChange so callers can keep
  // the height across remounts / a sibling preview. Mirrors EditableTextField.
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    if (!multiline) return
    e.preventDefault()
    const el = editorRef.current
    if (!el) return
    const startY = e.clientY
    const startHeight = el.offsetHeight
    const onMove = (me: MouseEvent) => {
      const next = Math.max(40, startHeight + me.clientY - startY)
      el.style.height = `${next}px`
      onHeightChange?.(next)
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [multiline, onHeightChange])

  // Double-click the handle → back to content-fitting auto-grow.
  const handleResizeReset = useCallback(() => {
    if (!multiline) return
    const el = editorRef.current
    if (el) el.style.height = ''
    onHeightChange?.(null)
  }, [multiline, onHeightChange])

  // Enter:
  //   single-line → preventDefault + blur (commits the save flow);
  //   multiline   → preventDefault + execCommand('insertText', '\n')
  //                 so the line break lands as an actual '\n' character
  //                 in the underlying text node instead of the browser-
  //                 default <div>/<br>. Our serializer handles all three
  //                 just in case.
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    // ── AI suggestion controls ──
    if ((e.ctrlKey || e.metaKey) && e.key === ' ') {
      e.preventDefault()
      if (aiFetcherRef.current && !aiPendingRef.current) requestAi()
      return
    }
    if (aiPendingRef.current) {
      if (e.key === 'Tab') {
        // Accept — keep the text, collapse the caret to its end.
        e.preventDefault()
        const p = aiPendingRef.current
        setAiPending(null)
        requestAnimationFrame(() => {
          const el = editorRef.current
          if (el) { el.focus(); setCursorOffset(el, p.start + p.length) }
        })
        return
      }
      if (e.key === 'Escape') {
        // Dismiss — splice the suggestion back out, caret to where it was.
        e.preventDefault()
        const p = aiPendingRef.current
        const base = localRef.current
        setLocal(base.slice(0, p.start) + base.slice(p.start + p.length))
        setAiPending(null)
        requestAnimationFrame(() => {
          const el = editorRef.current
          if (el) { el.focus(); setCursorOffset(el, p.start) }
        })
        return
      }
    }
    if (e.key === 'Enter') {
      if (!multiline) {
        e.preventDefault()
        ;(e.currentTarget as HTMLDivElement).blur()
        return
      }
      // Multiline: insert a newline character at the caret.
      e.preventDefault()
      document.execCommand('insertText', false, '\n')
    }
  }

  // Paste as plain text. Single-line: strip newlines to spaces.
  // Multiline: keep newlines so paragraphs survive the paste.
  const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault()
    const raw = e.clipboardData.getData('text/plain')
    const text = multiline ? raw.replace(/\r\n/g, '\n') : raw.replace(/\r?\n/g, ' ')
    document.execCommand('insertText', false, text)
  }

  // Inapplicable-chip hover state. The chip is created imperatively
  // (so the shared Tooltip can't wrap it directly), so we delegate
  // hover detection at the editor level and feed the shared Tooltip
  // an externally-controlled `open` flag + a virtual trigger that
  // positions itself over the hovered chip.
  const [hoveredInapplicable, setHoveredInapplicable] = useState<{
    key: string
    rect: { top: number; left: number; width: number; height: number }
  } | null>(null)
  const handleEditorMouseOver = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement | null
    const key = target?.dataset?.inapplicable
    if (!key) return
    const r = target.getBoundingClientRect()
    setHoveredInapplicable({ key, rect: { top: r.top, left: r.left, width: r.width, height: r.height } })
  }
  const handleEditorMouseOut = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement | null
    if (target?.dataset?.inapplicable) setHoveredInapplicable(null)
  }

  const borderCls = tabActive ? 'border-white/[0.18]' : 'border-white/10'
  const cornerCls = tabAttached ? 'rounded-lg rounded-tr-none' : 'rounded-lg'
  // overflow-y-auto lets content scroll once the user drags a height shorter
  // than the content; with no explicit height it just grows. The drag handle
  // below provides the resize (custom strip, larger hit target than the native
  // corner) — same pattern as the sidebar's EditableTextField.
  const wrapCls = multiline ? 'whitespace-pre-wrap leading-relaxed overflow-y-auto resize-none' : 'whitespace-nowrap overflow-x-auto leading-snug'
  const cls = `template-body-editor w-full bg-navy-900/70 border ${borderCls} ${cornerCls} px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-purple-500/50 focus:bg-navy-900 transition-colors ${saving ? 'opacity-60' : ''} ${wrapCls}`

  const editor = (
    <div
      ref={editorRef}
      role="textbox"
      contentEditable={!saving}
      suppressContentEditableWarning
      onInput={handleInput}
      onKeyDown={handleKeyDown}
      onPaste={handlePaste}
      onBlur={handleBlur}
      onMouseOver={handleEditorMouseOver}
      onMouseOut={handleEditorMouseOut}
      data-placeholder={placeholder}
      className={`${cls}${multiline ? ' relative z-10' : ''}`}
      style={multiline ? { minHeight: minHeight ?? 96, height: height ?? undefined } : undefined}
    />
  )

  return (
    <>
      {multiline ? (
        // Wrap with the custom drag-to-resize strip below (full-width hit
        // target tucked behind the editor's rounded bottom corners).
        <div className="w-full flex flex-col">
          {editor}
          <div
            onMouseDown={handleResizeStart}
            onDoubleClick={handleResizeReset}
            className="group relative z-0 cursor-ns-resize flex items-center justify-center h-4 rounded-b-lg hover:bg-white/5 transition-colors pt-[8px] mt-[-8px]"
          >
            <Tooltip content="Drag to resize · double-click to reset" side="bottom">
              <GripHorizontal size={10} className="text-gray-500 group-hover:text-gray-300" />
            </Tooltip>
          </div>
        </div>
      ) : editor}
      {aiFetcher && (
        <p className="flex items-center gap-1 text-[10px] text-gray-400 mt-0.5 min-h-[14px] min-w-0">
          {aiError
            ? <span className="flex items-center gap-1 text-red-400 min-w-0">
                <AlertTriangle size={9} className="shrink-0" /><TruncatedText text={aiError} className="truncate" />
              </span>
            : aiLoading
              ? <><Loader2 size={9} className="animate-spin" />Generating…</>
              : aiPending
                ? <>Tab to accept · Esc to dismiss</>
                : <span>Ctrl+Space for AI suggestion</span>}
        </p>
      )}
      {hoveredInapplicable && (
        <Tooltip
          open
          side="top"
          triggerClassName="fixed pointer-events-none"
          triggerStyle={{
            top: hoveredInapplicable.rect.top,
            left: hoveredInapplicable.rect.left,
            width: hoveredInapplicable.rect.width,
            height: hoveredInapplicable.rect.height,
          }}
          content={<>
            <span className="font-mono text-red-300">{`{${hoveredInapplicable.key}}`}</span>{' '}
            doesn't apply to standalone streams — turn on{' '}
            <span className="font-medium text-gray-200">Series</span> to use it.
          </>}
        >
          {null}
        </Tooltip>
      )}
    </>
  )
}

/**
 * MergeFieldPicker — small click-to-insert button strip rendered under
 * the TemplateBodyEditor. Each button inserts its `{key}` token at the
 * current cursor position via the parent's insertion callback.
 */
export function MergeFieldPicker({
  keys, onInsert,
}: {
  keys: readonly string[]
  onInsert: (key: string) => void
}) {
  return (
    <div className="mt-1 flex items-center flex-wrap gap-1">
      <span className="text-[10px] uppercase tracking-wide text-gray-500 mr-1">Insert</span>
      {keys.map(k => (
        <button
          key={k}
          type="button"
          // onMouseDown over onClick + preventDefault so the editor
          // doesn't lose focus before we insert.
          onMouseDown={e => { e.preventDefault(); onInsert(k) }}
          className={`${MERGE_FIELD_CHIP_CLASS} hover:bg-purple-900 hover:border-purple-700 transition-colors`}
        >
          {k}
        </button>
      ))}
    </div>
  )
}
