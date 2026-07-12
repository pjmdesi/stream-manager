import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

/** Which surface currently holds a file open. Used as the reason a delete is
 *  blocked, so the disabled control can explain itself. */
export type OpenSource = 'player' | 'thumbnail' | 'combine'

interface OpenItemsValue {
  /** Register the file(s) a surface currently has open, replacing its prior
   *  set. Pass [] to clear when the surface closes. */
  setOpen: (source: OpenSource, paths: string[]) => void
  /** Which surface has this exact file open, or null. */
  openReason: (path: string) => OpenSource | null
  /** Which surface has any file under this stream folder open, or null. */
  folderOpenReason: (folderPath: string) => OpenSource | null
}

const norm = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '')

const OpenItemsContext = createContext<OpenItemsValue>({
  setOpen: () => {},
  openReason: () => null,
  folderOpenReason: () => null,
})

/**
 * Tracks the files currently open across the app's surfaces (the player's
 * loaded video, the thumbnail editor's open variant) so the Streams page can
 * block deleting anything that's in use — the same way the converter guard
 * blocks files held by a running job. All renderer-side and same-process, so
 * the reads are reactive *and* authoritative (no IPC lag to race).
 */
export function OpenItemsProvider({ children }: { children: ReactNode }) {
  const [open, setOpen_] = useState<Record<OpenSource, string[]>>({ player: [], thumbnail: [], combine: [] })

  const setOpen = useCallback((source: OpenSource, paths: string[]) => {
    setOpen_(prev => {
      const next = paths.map(norm)
      const cur = prev[source]
      // Skip the update (and the re-render) when nothing changed — these fire
      // from effects that re-run on unrelated state changes.
      if (cur.length === next.length && cur.every((v, i) => v === next[i])) return prev
      return { ...prev, [source]: next }
    })
  }, [])

  const openReason = useCallback((path: string): OpenSource | null => {
    const p = norm(path)
    if (open.player.includes(p)) return 'player'
    if (open.thumbnail.includes(p)) return 'thumbnail'
    if (open.combine.includes(p)) return 'combine'
    return null
  }, [open])

  const folderOpenReason = useCallback((folderPath: string): OpenSource | null => {
    const f = norm(folderPath)
    const under = (p: string): boolean => p === f || p.startsWith(f + '/')
    if (open.player.some(under)) return 'player'
    if (open.thumbnail.some(under)) return 'thumbnail'
    if (open.combine.some(under)) return 'combine'
    return null
  }, [open])

  const value = useMemo(() => ({ setOpen, openReason, folderOpenReason }), [setOpen, openReason, folderOpenReason])
  return <OpenItemsContext.Provider value={value}>{children}</OpenItemsContext.Provider>
}

export function useOpenItems(): OpenItemsValue {
  return useContext(OpenItemsContext)
}

/** Human-readable reason text for a block source (converter or an open surface). */
export function blockReasonText(source: OpenSource | 'converter'): string {
  switch (source) {
    case 'converter': return 'in use by the converter'
    case 'player': return 'open in the player'
    case 'thumbnail': return 'open in the thumbnail editor'
    case 'combine': return 'being combined'
  }
}
