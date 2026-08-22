import { useRef, useState, useLayoutEffect, useEffect, useCallback } from 'react'
import { cleanIpcError } from '../lib/ipcError'

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
  /** Called with the suggestion text when the user EXPLICITLY dismisses it
   *  with Esc — and only then. Blur-dismiss and typing-over don't count as
   *  rejections (they can happen for unrelated reasons), so they stay
   *  silent. Feeds the per-stream rejected-suggestions memory. */
  onReject?: (text: string) => void,
) {
  const [suggestion, setSuggestion] = useState('')
  const [insertAt, setInsertAt] = useState(0)
  const [loading, setLoading] = useState(false)
  // Last generation error, surfaced inline by the field. Auto-clears so a
  // stale failure (out of credits, model revoked, rate limit) doesn't linger.
  const [error, setError] = useState<string | null>(null)
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
  const onRejectRef = useRef(onReject)
  onRejectRef.current = onReject

  // After React renders the controlled value, patch the DOM to show the
  // suggestion inserted at the cursor and selected.
  //
  // Deliberately NO dependency array: ReactDOM restores a controlled
  // input's DOM value to the React value whenever the component commits
  // any prop change — and the event handlers in `sg.props` get new
  // identities on every parent-driven re-render, so ANY unrelated state
  // cascade (the periodic YouTube check was the visible one — todo streams
  // #9) silently wiped the painted suggestion while the hook still
  // considered it pending (which is why Tab afterwards still accepted it).
  // Running after every commit lets the repaint win — layout effects fire
  // after React's DOM writes — and the value guard keeps it a no-op (no
  // selection stomping) while the DOM is already showing the suggestion.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !suggestion) return
    const expected = value.slice(0, insertAt) + suggestion + value.slice(insertAt)
    if (el.value === expected) return
    el.value = expected
    el.setSelectionRange(insertAt, insertAt + suggestion.length)
  })

  const dismiss = useCallback(() => {
    if (suggestionRef.current) setSuggestion('')
  }, [])

  const requestSuggestion = useCallback(async () => {
    if (suggestionRef.current || loadingRef.current) return
    const el = ref.current
    const cursorPos = el?.selectionStart ?? valueRef.current.length
    const prefix = valueRef.current.slice(0, cursorPos)
    const suffix = valueRef.current.slice(cursorPos)
    setError(null)
    setLoading(true)
    try {
      const result = await fetchSuggestion(prefix, suffix)
      if (result && !suggestionRef.current) {
        setInsertAt(cursorPos)
        setSuggestion(result)
      }
    } catch (e) {
      // Surface the cause inline (no toast system) so the user knows why
      // nothing appeared — e.g. out of credits, model unavailable, rate limit.
      setError(cleanIpcError(e))
    } finally {
      setLoading(false)
    }
  }, [fetchSuggestion])

  // Auto-dismiss the inline error after a few seconds.
  useEffect(() => {
    if (!error) return
    const id = setTimeout(() => setError(null), 6000)
    return () => clearTimeout(id)
  }, [error])

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
      onRejectRef.current?.(suggestionRef.current)
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

  const hint = error ? 'error' : loading ? 'loading' : suggestion ? 'accept' : ''

  const props = {
    onKeyDown: handleKeyDown,
    onChange: handleChange,
    onBlur: handleBlur,
  }

  return { ref, props, hint, loading, error, hasSuggestion: !!suggestion, dismiss, requestSuggestion }
}
