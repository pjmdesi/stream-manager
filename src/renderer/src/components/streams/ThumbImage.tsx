import { useState, useEffect, useRef } from 'react'
import { Loader2, Cloud, AlertTriangle } from 'lucide-react'
import { Tooltip } from '../ui/Tooltip'
import { getCachedHydration, subscribeHydration } from '../../lib/hydrationCache'

/** Tooltip text for stream date labels: weekday plus the full date
 *  ("Saturday, July 25, 2026") — a complete human-readable restatement of
 *  the compact ISO label it hovers over. */
export function friendlyDate(iso: string): string {
  const [year, month, day] = iso.split('-')
  const d = new Date(parseInt(year), parseInt(month) - 1, parseInt(day))
  return d.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
}

export function toFileUrl(absPath: string): string {
  return 'file:///' + absPath.replace(/\\/g, '/')
}

// One IPC listener for the row-thumbnail ready event, fanned out to every
// mounted row (STR-17). A listener per row would put a few hundred on the
// ipcRenderer emitter and trip Node's max-listeners warning.
type RowThumbInfo = { path: string; url: string }
const rowThumbListeners = new Set<(info: RowThumbInfo) => void>()
let rowThumbUnsub: (() => void) | null = null
function subscribeRowThumbReady(cb: (info: RowThumbInfo) => void): () => void {
  rowThumbListeners.add(cb)
  if (!rowThumbUnsub) rowThumbUnsub = window.api.onRowThumbReady(info => { for (const l of rowThumbListeners) l(info) })
  return () => {
    rowThumbListeners.delete(cb)
    if (rowThumbListeners.size === 0 && rowThumbUnsub) { rowThumbUnsub(); rowThumbUnsub = null }
  }
}

/**
 * Renders a thumbnail image cloud-aware:
 *   - When `isLocal` is false and `hydrate` is false → renders a Cloud icon
 *     and never makes a file:// request. This avoids hanging the renderer on
 *     a broken cloud-provider state (where Windows file APIs block
 *     indefinitely).
 *   - When `isLocal` is false and `hydrate` is true → kicks off a cloud
 *     download and shows a spinner; switches to <img> once local.
 *   - When `isLocal` is true → renders <img> normally. If load fails (file
 *     was supposedly local but isn't), falls back to the cloud-download flow.
 */
export function ThumbImage({
  path, thumbsKey, isLocal = true, hydrate = false, small = false, className, style,
  placeholderClassName, placeholderStyle, draggable, iconSize = 14, onLoad,
}: {
  path: string
  thumbsKey: number
  isLocal?: boolean
  hydrate?: boolean
  /** STR-17: swap in the pre-scaled row thumbnail from the cache once main
   *  has it. The full image renders first, exactly as without the flag, so
   *  nothing waits on the cache; the cloud state machine is untouched. For
   *  surfaces that show the image small and animate over it (the stream
   *  rows' hover zoom). */
  small?: boolean
  className?: string
  style?: React.CSSProperties
  placeholderClassName?: string
  placeholderStyle?: React.CSSProperties
  draggable?: boolean
  iconSize?: number
  onLoad?: (dims?: { width: number; height: number }) => void
}) {
  // The `isLocal` prop carries the folder's SCAN-TIME flag. The shared
  // hydration cache is the live truth: a pin/offload completing anywhere
  // (batch cloud op, player hydration, another surface's check) lands there
  // immediately, while the scan flag stays stale until the next folder
  // reload. Cache wins when it has an entry — that's what flips a stream
  // row's cloud icon into the real image the moment its pin finishes.
  const [liveLocal, setLiveLocal] = useState<boolean | undefined>(() => getCachedHydration([path])[path])
  useEffect(() => {
    setLiveLocal(getCachedHydration([path])[path])
    return subscribeHydration((p, isL) => { if (p === path) setLiveLocal(isL) })
  }, [path])
  const effectiveIsLocal = liveLocal ?? isLocal

  const [status, setStatus] = useState<'loading' | 'loaded' | 'syncing' | 'cloud' | 'error'>(
    effectiveIsLocal ? 'loading' : (hydrate ? 'syncing' : 'cloud')
  )
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    setStatus(effectiveIsLocal ? 'loading' : (hydrate ? 'syncing' : 'cloud'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, thumbsKey, effectiveIsLocal])

  useEffect(() => {
    if (effectiveIsLocal) return
    setStatus(prev => prev === 'loaded' || prev === 'loading' ? prev : (hydrate ? 'syncing' : 'cloud'))
  }, [hydrate, effectiveIsLocal])

  useEffect(() => {
    if (status === 'loaded' || status === 'loading') return
    const unsub = window.api.onCloudDownloadDone(done => {
      if (done === path) { setReloadKey(k => k + 1); setStatus('loading') }
    })
    return unsub
  }, [status, path])

  useEffect(() => {
    if (status !== 'syncing') return
    window.api.startCloudDownload(path).catch(() => {})
    const errorTimeoutId = setTimeout(() => setStatus('error'), 30_000)
    return () => {
      clearTimeout(errorTimeoutId)
      window.api.cancelCloudDownload(path).catch(() => {})
    }
  }, [status, path])

  // A file:// image can already be decoded by the time React attaches `onLoad`
  // (e.g. rows mounted on scroll with a warm OS cache), so the load event is
  // missed and status sticks on 'loading'. Catch that case after each commit.
  // MUST be declared before the early return below — otherwise the hook count
  // drops when `status` flips to a placeholder state (cloud/syncing/error),
  // which throws "rendered fewer hooks than expected" (e.g. a reschedule
  // renames the folder and the old thumbnail path 404s → status='syncing').
  const imgRef = useRef<HTMLImageElement>(null)
  useEffect(() => {
    if (status !== 'loading') return
    const el = imgRef.current
    if (el && el.complete && el.naturalWidth > 0) { setStatus('loaded'); onLoad?.({ width: el.naturalWidth, height: el.naturalHeight }) }
  })

  // Pre-scaled version (STR-17). Requested whenever the source may have
  // changed (path, thumbsKey, a hydration); main answers at once from the
  // cache or later through the ready event. Reset to the full image in the
  // meantime, so a re-rendered thumbnail is never shown stale. Declared up
  // here with the other hooks, above the placeholder return, for the same
  // reason as imgRef: the first build of STR-17 had these below it, and a
  // row whose status flipped to a placeholder state threw React error 300
  // (found 2026-09-19 on the packaged build after the window sat idle).
  const [smallSrc, setSmallSrc] = useState<string | null>(null)
  useEffect(() => {
    if (!small || !effectiveIsLocal) { setSmallSrc(null); return }
    let cancelled = false
    setSmallSrc(null)
    window.api.getRowThumb(path).then(url => { if (!cancelled && url) setSmallSrc(url) }).catch(() => {})
    const unsub = subscribeRowThumbReady(({ path: p, url }) => { if (!cancelled && p === path) setSmallSrc(url) })
    return () => { cancelled = true; unsub() }
  }, [small, path, thumbsKey, effectiveIsLocal])

  if (status === 'cloud' || status === 'syncing' || status === 'error') {
    const baseCls = 'flex flex-col items-center justify-center gap-1 bg-navy-800/40'
    const cls = `${baseCls} ${placeholderClassName ?? className ?? ''}`
    const tooltip = status === 'syncing' ? 'Downloading from cloud…'
                  : status === 'error'   ? 'Cloud download failed — provider may be stuck or file is missing'
                                         : 'Cloud — open in the carousel to download'
    // The Tooltip's trigger wrapper IS the placeholder box (triggerClassName /
    // triggerStyle carry the placeholder's classes + style), so the DOM shape
    // stays a single styled div — no layout change vs the old native title=.
    return (
      <Tooltip content={tooltip} triggerClassName={cls} triggerStyle={placeholderStyle}>
        {status === 'syncing' && <Loader2 size={iconSize} className="text-gray-400 animate-spin" />}
        {status === 'cloud'   && <Cloud   size={iconSize} className="text-gray-400" />}
        {status === 'error'   && <AlertTriangle size={iconSize} className="text-yellow-500" />}
        {status === 'syncing' && <span className="text-[9px] text-gray-400 leading-none">Syncing…</span>}
        {status === 'error'   && <span className="text-[9px] text-yellow-600 leading-none">Sync failed</span>}
      </Tooltip>
    )
  }

  const src = smallSrc ?? `${toFileUrl(path)}?t=${thumbsKey}&r=${reloadKey}`

  return (
    <>
      <img
        ref={imgRef}
        src={src}
        // Decode off the main thread so a burst of thumbnails (e.g. the detail
        // sidebar mounting on open) doesn't stutter the slide animation.
        decoding="async"
        className={className}
        style={style}
        draggable={draggable}
        onLoad={e => {
          setStatus('loaded')
          const im = e.currentTarget
          onLoad?.(im.naturalWidth > 0 ? { width: im.naturalWidth, height: im.naturalHeight } : undefined)
        }}
        // A cached small file that fails to load (the cache was cleared under
        // it) drops back to the full image; only the source's own failure
        // means the file is not local.
        onError={() => { if (smallSrc) setSmallSrc(null); else setStatus('syncing') }}
      />
      {status !== 'loaded' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-navy-900" />
      )}
    </>
  )
}
