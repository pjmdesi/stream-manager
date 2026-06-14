import React, { useState, useRef, useEffect, useLayoutEffect } from 'react'
import { Tooltip } from './Tooltip'

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
      const baseCls = inapplicable ? MERGE_FIELD_CHIP_CLASS_INAPPLICABLE : MERGE_FIELD_CHIP_CLASS
      chip.className = baseCls + ' mx-px align-baseline select-none'
      if (inapplicable) chip.dataset.inapplicable = key
      chip.textContent = key
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
  value, onSave, placeholder, knownKeys, inapplicableKeys, tabAttached, tabActive, multiline, minHeight, insertRef, autoFocus,
}: {
  value: string
  onSave: (v: string) => Promise<void> | void
  placeholder?: string
  knownKeys: ReadonlySet<string>
  inapplicableKeys?: ReadonlySet<string>
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
}) {
  const [local, setLocal] = useState(value)
  const [saving, setSaving] = useState(false)
  const editorRef = useRef<HTMLDivElement>(null)
  const lastInapplicableRef = useRef<ReadonlySet<string> | undefined>(undefined)

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
    if (!inapplicableChanged && serialize(el) === local) return
    const owns = document.activeElement === el
    const offset = owns ? getCursorOffset(el) : -1
    render(el, local, knownKeys, inapplicableKeys)
    lastInapplicableRef.current = inapplicableKeys
    if (offset >= 0) setCursorOffset(el, offset)
  }, [local, knownKeys, inapplicableKeys])

  useEffect(() => {
    if (!autoFocus) return
    editorRef.current?.focus()
  }, [autoFocus])

  const handleInput = () => {
    const el = editorRef.current
    if (!el) return
    setLocal(serialize(el))
  }

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
    if (local === value) return
    setSaving(true)
    try { await onSave(local) }
    catch (err) {
      console.error('Autosave failed', err)
      setLocal(value)
    }
    finally { setSaving(false) }
  }

  // Enter:
  //   single-line → preventDefault + blur (commits the save flow);
  //   multiline   → preventDefault + execCommand('insertText', '\n')
  //                 so the line break lands as an actual '\n' character
  //                 in the underlying text node instead of the browser-
  //                 default <div>/<br>. Our serializer handles all three
  //                 just in case.
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
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
  const wrapCls = multiline ? 'whitespace-pre-wrap leading-relaxed' : 'whitespace-nowrap overflow-x-auto leading-snug'
  const cls = `template-body-editor w-full bg-navy-900/70 border ${borderCls} ${cornerCls} px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-purple-500/50 focus:bg-navy-900 transition-colors ${saving ? 'opacity-60' : ''} ${wrapCls}`

  return (
    <>
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
        className={cls}
        style={multiline ? { minHeight: minHeight ?? 96 } : undefined}
      />
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
