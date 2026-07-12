import React, { createContext, useCallback, useContext, useState } from 'react'

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
  /** A combine run is in progress (not merely files listed). */
  combineRunning: boolean
  setPlayerHasVideo: (v: boolean) => void
  setThumbnailHasCanvas: (v: boolean) => void
  setCombineRunning: (v: boolean) => void
}

const PageActivityContext = createContext<PageActivityContextValue | null>(null)

export function PageActivityProvider({ children }: { children: React.ReactNode }) {
  const [playerHasVideo, setPlayerHasVideoRaw] = useState(false)
  const [thumbnailHasCanvas, setThumbnailHasCanvasRaw] = useState(false)
  const [combineRunning, setCombineRunningRaw] = useState(false)

  // Memoize setters so consumer useEffects keyed on them don't loop.
  const setPlayerHasVideo = useCallback((v: boolean) => setPlayerHasVideoRaw(v), [])
  const setThumbnailHasCanvas = useCallback((v: boolean) => setThumbnailHasCanvasRaw(v), [])
  const setCombineRunning = useCallback((v: boolean) => setCombineRunningRaw(v), [])

  return (
    <PageActivityContext.Provider value={{ playerHasVideo, thumbnailHasCanvas, combineRunning, setPlayerHasVideo, setThumbnailHasCanvas, setCombineRunning }}>
      {children}
    </PageActivityContext.Provider>
  )
}

export function usePageActivity() {
  const ctx = useContext(PageActivityContext)
  if (!ctx) throw new Error('usePageActivity must be used within PageActivityProvider')
  return ctx
}
