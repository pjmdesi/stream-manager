import { useEffect, useRef, useState } from 'react'
import { Tooltip } from './Tooltip'

/**
 * Single-line truncating label that shows the full text in the app's custom
 * Tooltip — but only when the text is actually truncated. Replaces the native
 * `title=` attribute (app rule: ALWAYS the custom Tooltip, never `title`),
 * mirroring the ClampedComment pattern for one-line `truncate` labels.
 *
 * `className` styles the text element itself and should include `truncate`
 * (plus any color/size classes).
 *
 * The Tooltip wrapper is ALWAYS rendered, with visibility gated via the
 * `open` prop (undefined = hover-driven, false = suppressed). Conditionally
 * wrapping instead swaps the span between two tree positions, remounting it —
 * and the ResizeObserver, still watching the detached old node, fires a final
 * 0×0 measurement that flips `truncated` back off and leaves the NEW span
 * unobserved: ellipsis visible, tooltip permanently missing. A stable tree
 * keeps one span (and one valid observer) for the component's lifetime.
 */
export function TruncatedText({ text, className = 'truncate', side = 'top', triggerClassName = 'block min-w-0' }: {
  text: string
  className?: string
  side?: 'top' | 'bottom' | 'left' | 'right'
  /** Classes for the Tooltip trigger wrapper. The default (block + min-w-0)
   *  shrink-fits in both block and flex parents; pass e.g. 'flex-1 min-w-0'
   *  when the label itself is a growing flex child. */
  triggerClassName?: string
}) {
  const ref = useRef<HTMLSpanElement>(null)
  const [truncated, setTruncated] = useState(false)

  // Re-measure when the text changes AND when the element resizes (cards
  // reflow with the sidebar width, so truncation can appear/disappear
  // without a text change). Skip detached-node callbacks defensively.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => { if (el.isConnected) setTruncated(el.scrollWidth > el.clientWidth) }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [text])

  return (
    <Tooltip content={text} side={side} open={truncated ? undefined : false} triggerClassName={triggerClassName}>
      <span ref={ref} className={`block ${className}`}>
        {text}
      </span>
    </Tooltip>
  )
}
