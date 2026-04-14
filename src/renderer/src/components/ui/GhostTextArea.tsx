/**
 * GhostTextArea — a contenteditable div that looks like a textarea and supports
 * inline gray "ghost" suggestion text at any cursor position.
 *
 * Props:
 *   value / onChange — controlled plain-text value
 *   suggestion       — text to show as gray ghost, or ''
 *   insertAt         — character offset where the ghost starts (default: end)
 *   onRequestSuggestion — called with (prefix, suffix) when Ctrl+Space is pressed
 *   onAccept / onDismiss — called when the user presses Tab / Escape
 *   rows             — minimum visible rows (drives min-height)
 */
import React, { useRef, useLayoutEffect, forwardRef, useImperativeHandle } from 'react'

export interface GhostTextAreaHandle {
  focus(): void
  /** Move the cursor to a character offset within the real text */
  setCursorOffset(offset: number): void
}

interface Props {
  value: string
  onChange: (value: string) => void
  suggestion?: string
  insertAt?: number
  onRequestSuggestion?: (prefix: string, suffix: string) => void
  onAccept?: () => void
  onDismiss?: () => void
  rows?: number
  className?: string
  placeholder?: string
  onFocus?: () => void
  onBlur?: () => void
}

// ── DOM helpers ───────────────────────────────────────────────────────────────

function isGhostNode(node: Node): boolean {
  return node instanceof HTMLElement && node.dataset.ghost === 'true'
}

/** Extract plain text, skipping any ghost span. */
function extractText(el: HTMLElement): string {
  let text = ''
  for (const node of Array.from(el.childNodes)) {
    if (isGhostNode(node)) continue
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent ?? ''
    } else if (node instanceof HTMLElement) {
      if (node.tagName === 'BR') text += '\n'
      else text += extractText(node) // nested divs (Chrome sometimes wraps new lines)
    }
  }
  return text
}

/** Set the div's real content (no ghost span), splitting \n into <br>. */
function setRealContent(el: HTMLElement, text: string) {
  el.textContent = ''
  const lines = text.split('\n')
  lines.forEach((line, i) => {
    if (line) el.appendChild(document.createTextNode(line))
    if (i < lines.length - 1) el.appendChild(document.createElement('br'))
  })
}

/** Find the DOM node + offset for a given character offset within real text. */
function findPosition(el: HTMLElement, charOffset: number): { node: Node; offset: number } | null {
  let remaining = charOffset
  for (const node of Array.from(el.childNodes)) {
    if (isGhostNode(node)) continue
    if (node.nodeType === Node.TEXT_NODE) {
      const len = (node.textContent ?? '').length
      if (remaining <= len) return { node, offset: remaining }
      remaining -= len
    } else if (node instanceof HTMLElement && node.tagName === 'BR') {
      if (remaining === 0) return { node, offset: 0 }
      remaining -= 1
    }
  }
  return null
}

/** Get the current cursor position as a character offset within real text. */
function getCursorOffset(el: HTMLElement): number {
  const sel = window.getSelection()
  if (!sel?.rangeCount) return extractText(el).length
  const range = sel.getRangeAt(0)

  // When the cursor sits between block-level children (e.g. after a <br>),
  // the browser sets startContainer = the div itself and startOffset = the
  // index of the child node where the cursor is.  Count characters up to
  // that child index.
  if (range.startContainer === el) {
    let offset = 0
    const children = Array.from(el.childNodes)
    for (let i = 0; i < range.startOffset && i < children.length; i++) {
      const node = children[i]
      if (isGhostNode(node)) continue
      if (node.nodeType === Node.TEXT_NODE) {
        offset += (node.textContent ?? '').length
      } else if (node instanceof HTMLElement && node.tagName === 'BR') {
        offset += 1
      }
    }
    return offset
  }

  // Normal case: startContainer is a text node (or BR) that is a direct child.
  let offset = 0
  for (const node of Array.from(el.childNodes)) {
    if (isGhostNode(node)) continue
    if (node === range.startContainer) { offset += range.startOffset; break }
    if (node.nodeType === Node.TEXT_NODE) {
      offset += (node.textContent ?? '').length
    } else if (node instanceof HTMLElement && node.tagName === 'BR') {
      offset += 1
    }
  }
  return offset
}

/** Place the cursor at a given character offset. */
function setCursor(el: HTMLElement, charOffset: number) {
  const sel = window.getSelection()
  if (!sel) return
  const pos = findPosition(el, charOffset)
  const range = document.createRange()
  if (pos) {
    range.setStart(pos.node, pos.offset)
  } else {
    range.selectNodeContents(el)
    range.collapse(false)
  }
  range.collapse(true)
  sel.removeAllRanges()
  sel.addRange(range)
}

/** Remove any existing ghost span from the element. */
function removeGhost(el: HTMLElement) {
  el.querySelector('[data-ghost="true"]')?.remove()
}

/** Insert a ghost span at the given character offset. */
function insertGhost(el: HTMLElement, text: string, charOffset: number) {
  removeGhost(el)
  const span = document.createElement('span')
  span.dataset.ghost = 'true'
  span.contentEditable = 'false'
  span.className = 'text-gray-600 pointer-events-none select-none'
  span.textContent = text

  const pos = findPosition(el, charOffset)
  if (pos && pos.node.nodeType === Node.TEXT_NODE) {
    // Split the text node and insert span between the two halves
    const textNode = pos.node as Text
    const before = textNode.textContent!.slice(0, pos.offset)
    const after = textNode.textContent!.slice(pos.offset)
    const beforeNode = document.createTextNode(before)
    const afterNode = document.createTextNode(after)
    textNode.parentNode!.replaceChild(afterNode, textNode)
    afterNode.parentNode!.insertBefore(span, afterNode)
    afterNode.parentNode!.insertBefore(beforeNode, span)
    // Position cursor just before the ghost span
    setCursor(el, charOffset)
  } else if (pos && pos.node instanceof HTMLElement) {
    pos.node.parentNode!.insertBefore(span, pos.node)
    setCursor(el, charOffset)
  } else {
    el.appendChild(span)
    setCursor(el, charOffset)
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export const GhostTextArea = forwardRef<GhostTextAreaHandle, Props>(function GhostTextArea(
  {
    value, onChange,
    suggestion = '', insertAt,
    onRequestSuggestion, onAccept, onDismiss,
    rows = 4, className = '', placeholder,
    onFocus, onBlur,
  },
  ref,
) {
  const divRef = useRef<HTMLDivElement>(null)
  // Suppress the sync useLayoutEffect when WE just fired onChange (not an external change)
  const selfChange = useRef(false)
  const composing = useRef(false)

  useImperativeHandle(ref, () => ({
    focus: () => divRef.current?.focus(),
    setCursorOffset: (offset) => {
      if (divRef.current) setCursor(divRef.current, offset)
    },
  }))

  // ── Initial render ──────────────────────────────────────────────────────────
  useLayoutEffect(() => {
    if (divRef.current) setRealContent(divRef.current, value)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // mount only

  // ── External value change (template applied, Tab accept, etc.) ──────────────
  useLayoutEffect(() => {
    const el = divRef.current
    if (!el || selfChange.current) return
    const current = extractText(el)
    if (current === value) return
    removeGhost(el)
    setRealContent(el, value)
    // Move cursor to end
    setCursor(el, value.length)
  }, [value])

  // ── Ghost suggestion ────────────────────────────────────────────────────────
  useLayoutEffect(() => {
    const el = divRef.current
    if (!el) return
    if (!suggestion) {
      removeGhost(el)
      return
    }
    const offset = insertAt ?? extractText(el).length
    insertGhost(el, suggestion, offset)
  }, [suggestion, insertAt])

  // ── Handlers ────────────────────────────────────────────────────────────────

  const handleInput = () => {
    if (composing.current) return
    const el = divRef.current
    if (!el) return
    // Remove ghost if user typed (browser may have clobbered the span)
    if (!el.querySelector('[data-ghost="true"]') && suggestion) {
      onDismiss?.()
    }
    selfChange.current = true
    onChange(extractText(el))
    selfChange.current = false
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    // Ctrl+Space — request a suggestion
    if ((e.ctrlKey || e.metaKey) && e.key === ' ') {
      e.preventDefault()
      if (!suggestion && onRequestSuggestion) {
        const el = divRef.current
        if (el) {
          const offset = getCursorOffset(el)
          const text = extractText(el)
          onRequestSuggestion(text.slice(0, offset), text.slice(offset))
        }
      }
      return
    }

    if (suggestion) {
      if (e.key === 'Tab') {
        e.preventDefault()
        onAccept?.()
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        onDismiss?.()
        return
      }
      // Any printable key — dismiss ghost so the browser replaces it naturally
      if (e.key.length === 1) onDismiss?.()
    }

    // Newlines: intercept Enter to keep content flat (no <div> wrapping)
    if (e.key === 'Enter') {
      e.preventDefault()
      const sel = window.getSelection()
      if (sel?.rangeCount) {
        const range = sel.getRangeAt(0)
        range.deleteContents()
        const br = document.createElement('br')
        range.insertNode(br)
        // Move cursor after the <br>
        range.setStartAfter(br)
        range.collapse(true)
        sel.removeAllRanges()
        sel.addRange(range)
        selfChange.current = true
        onChange(extractText(divRef.current!))
        selfChange.current = false
      }
    }
  }

  const minH = `${rows * 1.5}rem`

  return (
    <div
      ref={divRef}
      contentEditable
      suppressContentEditableWarning
      onInput={handleInput}
      onKeyDown={handleKeyDown}
      onFocus={onFocus}
      onBlur={onBlur}
      onCompositionStart={() => { composing.current = true }}
      onCompositionEnd={() => { composing.current = false; handleInput() }}
      className={`whitespace-pre-wrap break-words outline-none ${className}`}
      style={{ minHeight: minH }}
      data-placeholder={placeholder}
    />
  )
})
