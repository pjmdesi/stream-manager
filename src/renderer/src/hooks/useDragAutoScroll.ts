import { useEffect, type RefObject } from 'react'

/** Distance from the container's top or bottom edge, in px, inside which
 *  a drag starts scrolling it. */
const EDGE_PX = 36
/** Fastest scroll, in px per frame, reached at the very edge. */
const MAX_STEP = 14

/**
 * Edge auto-scroll for a scrollable container whose children are native
 * HTML5 drag sources or targets (the layers panel, a reorderable list).
 * While a drag hovers near the container's top or bottom edge, the
 * container scrolls toward that edge, faster the closer the pointer is,
 * so a long list can be reordered end to end without dropping halfway.
 * Chromium did not do this for the layers list on its own, and the wheel
 * did not scroll it during the drag either, so without this the rows
 * beyond the viewport were unreachable (style guide, "Drag and drop in
 * scrollable containers"). Native listeners, so the caller's React
 * handlers are untouched; the loop runs only while a drag is over the
 * container and near an edge.
 */
export function useDragAutoScroll(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let step = 0
    let raf: number | null = null
    const tick = () => {
      raf = null
      if (step === 0) return
      const before = el.scrollTop
      el.scrollTop += step
      // Stop at the end of travel; dragover restarts the loop when the
      // pointer moves.
      if (el.scrollTop !== before) raf = requestAnimationFrame(tick)
    }
    const onDragOver = (e: DragEvent) => {
      const r = el.getBoundingClientRect()
      const fromTop = e.clientY - r.top
      const fromBottom = r.bottom - e.clientY
      if (fromTop < EDGE_PX) step = -Math.ceil(((EDGE_PX - Math.max(0, fromTop)) / EDGE_PX) * MAX_STEP)
      else if (fromBottom < EDGE_PX) step = Math.ceil(((EDGE_PX - Math.max(0, fromBottom)) / EDGE_PX) * MAX_STEP)
      else step = 0
      if (step !== 0 && raf === null) raf = requestAnimationFrame(tick)
    }
    const stop = () => { step = 0 }
    const onDragLeave = (e: DragEvent) => {
      const related = e.relatedTarget as Node | null
      if (related && el.contains(related)) return
      stop()
    }
    el.addEventListener('dragover', onDragOver)
    el.addEventListener('dragleave', onDragLeave)
    el.addEventListener('drop', stop)
    document.addEventListener('dragend', stop)
    return () => {
      el.removeEventListener('dragover', onDragOver)
      el.removeEventListener('dragleave', onDragLeave)
      el.removeEventListener('drop', stop)
      document.removeEventListener('dragend', stop)
      step = 0
      if (raf !== null) cancelAnimationFrame(raf)
    }
  }, [ref])
}
