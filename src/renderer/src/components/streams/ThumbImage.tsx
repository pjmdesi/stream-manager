import { useState, useEffect, useRef } from 'react'
import { Loader2, Cloud, AlertTriangle } from 'lucide-react'

export function friendlyDate(iso: string): string {
  const [year, month, day] = iso.split('-')
  const d = new Date(parseInt(year), parseInt(month) - 1, parseInt(day))
  return d.toLocaleDateString(undefined, { weekday: 'long' })
}

export function toFileUrl(absPath: string): string {
  return 'file:///' + absPath.replace(/\\/g, '/')
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
  path, thumbsKey, isLocal = true, hydrate = false, className, style,
  placeholderClassName, placeholderStyle, draggable, iconSize = 14, onLoad,
}: {
  path: string
  thumbsKey: number
  isLocal?: boolean
  hydrate?: boolean
  className?: string
  style?: React.CSSProperties
  placeholderClassName?: string
  placeholderStyle?: React.CSSProperties
  draggable?: boolean
  iconSize?: number
  onLoad?: () => void
}) {
  const [status, setStatus] = useState<'loading' | 'loaded' | 'syncing' | 'cloud' | 'error'>(
    isLocal ? 'loading' : (hydrate ? 'syncing' : 'cloud')
  )
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    setStatus(isLocal ? 'loading' : (hydrate ? 'syncing' : 'cloud'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, thumbsKey, isLocal])

  useEffect(() => {
    if (isLocal) return
    setStatus(prev => prev === 'loaded' || prev === 'loading' ? prev : (hydrate ? 'syncing' : 'cloud'))
  }, [hydrate, isLocal])

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

  if (status === 'cloud' || status === 'syncing' || status === 'error') {
    const baseCls = 'flex flex-col items-center justify-center gap-1 bg-navy-800/40'
    const cls = `${baseCls} ${placeholderClassName ?? className ?? ''}`
    const tooltip = status === 'syncing' ? 'Downloading from cloud…'
                  : status === 'error'   ? 'Cloud download failed — provider may be stuck or file is missing'
                                         : 'Cloud — open in the carousel to download'
    return (
      <div className={cls} style={placeholderStyle} title={tooltip}>
        {status === 'syncing' && <Loader2 size={iconSize} className="text-gray-400 animate-spin" />}
        {status === 'cloud'   && <Cloud   size={iconSize} className="text-gray-400" />}
        {status === 'error'   && <AlertTriangle size={iconSize} className="text-yellow-500" />}
        {status === 'syncing' && <span className="text-[9px] text-gray-400 leading-none">Syncing…</span>}
        {status === 'error'   && <span className="text-[9px] text-yellow-600 leading-none">Sync failed</span>}
      </div>
    )
  }

  const src = `${toFileUrl(path)}?t=${thumbsKey}&r=${reloadKey}`

  // A file:// image can already be decoded by the time React attaches `onLoad`
  // (e.g. rows mounted on scroll with a warm OS cache), so the load event is
  // missed and status sticks on 'loading'. Catch that case after each commit.
  const imgRef = useRef<HTMLImageElement>(null)
  useEffect(() => {
    if (status !== 'loading') return
    const el = imgRef.current
    if (el && el.complete && el.naturalWidth > 0) { setStatus('loaded'); onLoad?.() }
  })

  return (
    <>
      <img
        ref={imgRef}
        src={src}
        className={className}
        style={style}
        draggable={draggable}
        onLoad={() => { setStatus('loaded'); onLoad?.() }}
        onError={() => setStatus('syncing')}
      />
      {status !== 'loaded' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-navy-900" />
      )}
    </>
  )
}
