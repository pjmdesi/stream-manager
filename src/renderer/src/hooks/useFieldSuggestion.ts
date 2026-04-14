import { useRef, useState, useLayoutEffect, useCallback } from 'react'

type FieldEl = HTMLInputElement | HTMLTextAreaElement

/**
 * Provides inline AI suggestions for a controlled input or textarea.
 *
 * Press Ctrl+Space to request a suggestion at the current cursor position.
 * The suggestion is inserted AT the cursor position and selected, so existing
 * text is preserved on both sides.
 *
 *   Tab   → accept: the suggestion becomes part of the value
 *   Esc   → dismiss without accepting
 *   typing → replaces the selected suggestion text naturally
 *
 * Usage:
 *   const sg = useFieldSuggestion(value, setValue, (pre, suf) => fetchFor('title', pre, suf))
 *   <input ref={sg.ref} {...sg.props} />
 *   {sg.hint === 'loading' && <Spinner />}
 *   {sg.hint === 'accept' && <span>Tab to accept · Esc to dismiss</span>}
 */
export function useFieldSuggestion(
  value: string,
  onChange: (v: string) => void,
  fetchSuggestion: (prefix: string, suffix: string) => Promise<string | null>,
) {
  const [suggestion, setSuggestion] = useState('')
  const [insertAt, setInsertAt] = useState(0)
  const [loading, setLoading] = useState(false)
  const ref = useRef<FieldEl>(null)

  // Stale-closure-safe refs
  const valueRef = useRef(value)
  valueRef.current = value
  const suggestionRef = useRef(suggestion)
  suggestionRef.current = suggestion
  const insertAtRef = useRef(insertAt)
  insertAtRef.current = insertAt
  const loadingRef = useRef(loading)
  loadingRef.current = loading

  // After React renders the controlled value, patch the DOM to show the
  // suggestion inserted at the cursor and selected.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !suggestion) return
    const before = value.slice(0, insertAt)
    const after = value.slice(insertAt)
    el.value = before + suggestion + after
    el.setSelectionRange(insertAt, insertAt + suggestion.length)
  }, [suggestion, insertAt, value])

  const dismiss = useCallback(() => {
    if (suggestionRef.current) setSuggestion('')
  }, [])

  const requestSuggestion = useCallback(async () => {
    if (suggestionRef.current || loadingRef.current) return
    const el = ref.current
    const cursorPos = el?.selectionStart ?? valueRef.current.length
    const prefix = valueRef.current.slice(0, cursorPos)
    const suffix = valueRef.current.slice(cursorPos)
    setLoading(true)
    try {
      const result = await fetchSuggestion(prefix, suffix)
      if (result && !suggestionRef.current) {
        setInsertAt(cursorPos)
        setSuggestion(result)
      }
    } catch {
      // Suggestions are best-effort; silently swallow errors
    } finally {
      setLoading(false)
    }
  }, [fetchSuggestion])

  const handleKeyDown = (e: React.KeyboardEvent<FieldEl>) => {
    // Ctrl+Space — request a suggestion at current cursor position
    if ((e.ctrlKey || e.metaKey) && e.key === ' ') {
      e.preventDefault()
      if (!suggestionRef.current) requestSuggestion()
      return
    }

    if (!suggestionRef.current) return

    if (e.key === 'Tab') {
      e.preventDefault()
      const pos = insertAtRef.current
      const sug = suggestionRef.current
      const accepted = valueRef.current.slice(0, pos) + sug + valueRef.current.slice(pos)
      setSuggestion('')
      onChange(accepted)
      // Move cursor to end of accepted suggestion after React re-renders
      requestAnimationFrame(() => {
        ref.current?.setSelectionRange(pos + sug.length, pos + sug.length)
      })
    } else if (e.key === 'Escape') {
      e.preventDefault()
      dismiss()
    }
    // All other keys fall through — the browser replaces the selection with
    // the typed character, then onChange fires and clears the suggestion state
  }

  const handleChange = (e: React.ChangeEvent<FieldEl>) => {
    if (suggestionRef.current) setSuggestion('')
    onChange(e.target.value)
  }

  const handleBlur = () => dismiss()

  const hint = loading ? 'loading' : suggestion ? 'accept' : ''

  const props = {
    onKeyDown: handleKeyDown,
    onChange: handleChange,
    onBlur: handleBlur,
  }

  return { ref, props, hint, loading, hasSuggestion: !!suggestion, dismiss, requestSuggestion }
}
