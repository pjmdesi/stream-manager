import { useEffect, useRef, useState } from 'react'
import { Tooltip } from './Tooltip'

/**
 * Single-line truncating label that shows the full text in the app's custom
 * Tooltip — but only when the text is actually truncated. Replaces the native
 * `title=` attribute (app rule: ALWAYS the custom Tooltip, never `title`),
 * mirroring the ClampedComment pattern for one-line `truncate` labels.
 *
 * `className` styles the text element itself and should include `truncate`
 * (plus any color/size classes). The Tooltip's trigger wrapper is forced to
 * block + min-w-0 so truncation keeps working inside flex parents.
 */
export function TruncatedText({ text, className = 'truncate', side = 'top' }: {
  text: string
  className?: string
  side?: 'top' | 'bottom' | 'left' | 'right'
}) {
  const ref = useRef<HTMLSpanElement>(null)
  const [truncated, setTruncated] = useState(false)

  // Re-measure when the text changes AND when the element resizes (cards
  // reflow with the sidebar width, so truncation can appear/disappear
  // without a text change).
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setTruncated(el.scrollWidth > el.clientWidth)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [text])

  const label = (
    <span ref={ref} className={`block ${className}`}>
      {text}
    </span>
  )

  if (!truncated) return label
  return (
    <Tooltip content={text} side={side} triggerClassName="block w-full min-w-0">
      {label}
    </Tooltip>
  )
}
