import React, { createContext, useCallback, useContext, useState } from 'react'
import type { Page } from '../types'

/**
 * Lifted "page has something open" signals — read by App.tsx to drive
 * the nav rail's per-item activity indicator (brightness shift + right-
 * edge accent). The PlayerPage / ThumbnailPage both keep their working
 * state local to the page; rather than refactoring that state into
 * shared context, each page publishes a minimal boolean here whenever
 * its activity toggles, and App.tsx consumes that boolean.
 *
 * Converter is intentionally NOT here — its job list already lives in
 * ConversionContext and App.tsx reads from it directly.
 */
interface PageActivityContextValue {
  playerHasVideo: boolean
  thumbnailHasCanvas: boolean
  /** Files are listed on the combine page (same presence semantics as the
   *  player's has-video and the thumbnail editor's has-canvas). */
  combineHasFiles: boolean
  setPlayerHasVideo: (v: boolean) => void
  setThumbnailHasCanvas: (v: boolean) => void
  setCombineHasFiles: (v: boolean) => void
  /** Context line shown under a nav item's title (nav redesign Pass C):
   *  the open stream's title on Streams/Player/Thumbnails, the pinned
   *  launch group on Launcher. Absent = no subtext, item renders as a
   *  plain single-line row. */
  navSubtext: Partial<Record<Page, string>>
  /** Publish (or clear, with null) a page's nav subtext. Identical values
   *  are ignored so publishers can call this from effects keyed on
   *  frequently-changing state without re-render churn. */
  setNavSubtext: (page: Page, text: string | null) => void
}

const PageActivityContext = createContext<PageActivityContextValue | null>(null)

export function PageActivityProvider({ children }: { children: React.ReactNode }) {
  const [playerHasVideo, setPlayerHasVideoRaw] = useState(false)
  const [thumbnailHasCanvas, setThumbnailHasCanvasRaw] = useState(false)
  const [combineHasFiles, setCombineHasFilesRaw] = useState(false)

  // Memoize setters so consumer useEffects keyed on them don't loop.
  const setPlayerHasVideo = useCallback((v: boolean) => setPlayerHasVideoRaw(v), [])
  const setThumbnailHasCanvas = useCallback((v: boolean) => setThumbnailHasCanvasRaw(v), [])
  const setCombineHasFiles = useCallback((v: boolean) => setCombineHasFilesRaw(v), [])

  const [navSubtext, setNavSubtextRaw] = useState<Partial<Record<Page, string>>>({})
  const setNavSubtext = useCallback((page: Page, text: string | null) => {
    setNavSubtextRaw(prev => {
      const next = text?.trim() || null
      if ((next ?? undefined) === prev[page]) return prev
      const map = { ...prev }
      if (next) map[page] = next
      else delete map[page]
      return map
    })
  }, [])

  return (
    <PageActivityContext.Provider value={{ playerHasVideo, thumbnailHasCanvas, combineHasFiles, setPlayerHasVideo, setThumbnailHasCanvas, setCombineHasFiles, navSubtext, setNavSubtext }}>
      {children}
    </PageActivityContext.Provider>
  )
}

export function usePageActivity() {
  const ctx = useContext(PageActivityContext)
  if (!ctx) throw new Error('usePageActivity must be used within PageActivityProvider')
  return ctx
}
