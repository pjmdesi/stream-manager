import React, { createContext, useContext, useState, useCallback } from 'react'
import type { StreamMeta } from '../types'

export interface PendingThumbnailStream {
  folderPath: string
  date: string
  title?: string
  meta?: StreamMeta
  /** Total episodes in this stream's series+season (including this stream).
   *  Pre-computed at navigation time because the thumbnail editor doesn't
   *  load the full streams list. Used for the {total_episodes} merge field. */
  totalEpisodes?: number
}

interface ThumbnailEditorContextValue {
  pendingStream: PendingThumbnailStream | null
  clearPendingStream: () => void
  openEditor: (stream: PendingThumbnailStream) => void
  /** Navigate to the thumbnails page without binding to a specific stream
   *  (e.g. user wants to author a new built-in template). */
  navigateToEditor: () => void
  /** Set by App.tsx — navigates to the thumbnails page */
  _setNavigate: (fn: (stream: PendingThumbnailStream | null) => void) => void
}

const ThumbnailEditorContext = createContext<ThumbnailEditorContextValue | null>(null)

export function ThumbnailEditorProvider({ children }: { children: React.ReactNode }) {
  const [pendingStream, setPendingStream] = useState<PendingThumbnailStream | null>(null)
  const [navigateFn, setNavigateFn] = useState<((s: PendingThumbnailStream | null) => void) | null>(null)

  const _setNavigate = useCallback((fn: (stream: PendingThumbnailStream | null) => void) => {
    setNavigateFn(() => fn)
  }, [])

  const openEditor = useCallback((stream: PendingThumbnailStream) => {
    setPendingStream(stream)
    navigateFn?.(stream)
  }, [navigateFn])

  const navigateToEditor = useCallback(() => {
    setPendingStream(null)
    navigateFn?.(null)
  }, [navigateFn])

  const clearPendingStream = useCallback(() => setPendingStream(null), [])

  return (
    <ThumbnailEditorContext.Provider value={{ pendingStream, clearPendingStream, openEditor, navigateToEditor, _setNavigate }}>
      {children}
    </ThumbnailEditorContext.Provider>
  )
}

export function useThumbnailEditor() {
  const ctx = useContext(ThumbnailEditorContext)
  if (!ctx) throw new Error('useThumbnailEditor must be used within ThumbnailEditorProvider')
  return ctx
}
