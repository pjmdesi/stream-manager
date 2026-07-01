import { useCallback, useMemo } from 'react'
import { useOpenItems, blockReasonText } from '../context/OpenItemsContext'
import { useConversionJobs } from '../context/ConversionContext'

// Job statuses that still hold the input file (mirrors the main-process guard).
const CONVERTER_IN_USE = new Set(['queued', 'downloading', 'running', 'replacing', 'paused'])
const norm = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '')

/**
 * Combined "can't delete, it's in use" check across all sources: a running
 * converter job, or a file open in the player / thumbnail editor. Returns the
 * human-readable reason (or null when deletable) so callers can disable the
 * control and explain why. Reactive via ConversionContext + OpenItemsContext,
 * and same-process for the open-items half, so it's authoritative for those.
 */
export function useInUse() {
  const { openReason, folderOpenReason } = useOpenItems()
  const { jobs } = useConversionJobs()

  const converterPaths = useMemo(() => {
    const s = new Set<string>()
    for (const j of jobs) if (CONVERTER_IN_USE.has(j.status)) s.add(norm(j.inputFile))
    return s
  }, [jobs])

  /** Reason a single file can't be deleted, or null. */
  const fileReason = useCallback((path: string): string | null => {
    if (converterPaths.has(norm(path))) return blockReasonText('converter')
    const open = openReason(path)
    return open ? blockReasonText(open) : null
  }, [converterPaths, openReason])

  /**
   * Reason a whole stream can't be deleted, or null. In dump mode the folder is
   * shared across streams, so pass the stream's own files and they're checked
   * directly; in folder mode omit `dumpFiles` and the entire folder is checked
   * (catches clips in sub-folders too).
   */
  const streamReason = useCallback((folderPath: string, dumpFiles?: string[]): string | null => {
    const open = dumpFiles ? (dumpFiles.map(openReason).find(Boolean) ?? null) : folderOpenReason(folderPath)
    if (open) return blockReasonText(open)
    const f = norm(folderPath)
    const convBusy = dumpFiles
      ? dumpFiles.some(p => converterPaths.has(norm(p)))
      : [...converterPaths].some(p => p === f || p.startsWith(f + '/'))
    return convBusy ? blockReasonText('converter') : null
  }, [converterPaths, openReason, folderOpenReason])

  return { fileReason, streamReason }
}
