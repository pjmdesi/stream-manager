import React, { createContext, useContext, useState, useCallback } from 'react'
import type { StreamMeta } from '../types'

export interface PendingThumbnailStream {
  folderPath: string
  date: string
  title?: string
  meta?: StreamMeta
}

interface ThumbnailEditorContextValue {
  pendingStream: PendingThumbnailStream | null
  clearPendingStream: () => void
  openEditor: (stream: PendingThumbnailStream) => void
  /** Set by App.tsx — navigates to the thumbnails page */
  _setNavigate: (fn: (stream: PendingThumbnailStream) => void) => void
}

const ThumbnailEditorContext = createContext<ThumbnailEditorContextValue | null>(null)

export function ThumbnailEditorProvider({ children }: { children: React.ReactNode }) {
  const [pendingStream, setPendingStream] = useState<PendingThumbnailStream | null>(null)
  const [navigateFn, setNavigateFn] = useState<((s: PendingThumbnailStream) => void) | null>(null)

  const _setNavigate = useCallback((fn: (stream: PendingThumbnailStream) => void) => {
    setNavigateFn(() => fn)
  }, [])

  const openEditor = useCallback((stream: PendingThumbnailStream) => {
    setPendingStream(stream)
    navigateFn?.(stream)
  }, [navigateFn])

  const clearPendingStream = useCallback(() => setPendingStream(null), [])

  return (
    <ThumbnailEditorContext.Provider value={{ pendingStream, clearPendingStream, openEditor, _setNavigate }}>
      {children}
    </ThumbnailEditorContext.Provider>
  )
}

export function useThumbnailEditor() {
  const ctx = useContext(ThumbnailEditorContext)
  if (!ctx) throw new Error('useThumbnailEditor must be used within ThumbnailEditorProvider')
  return ctx
}
