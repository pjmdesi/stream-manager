import React, { useState, useEffect, useCallback, useMemo, useRef, useLayoutEffect } from 'react'
import { flushSync } from 'react-dom'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import ReactDOM from 'react-dom'
import {
  Plus, FolderOpen, AlertTriangle, PencilLine,
  RefreshCw, Radio, X, ChevronDown, ImageOff,
  ChevronLeft, ChevronRight, ChevronUp, ChevronsUp, ChevronsDown, Expand, Archive, CheckSquare,
  Square, CheckCheck, Loader2, CheckCircle2, XCircle, Check,
  Film, Scissors, Zap, Combine, ListFilter, Trash2, Tags, Upload, CalendarClock, Info, Sparkles, LayoutTemplate,
  Globe, EyeOff, Lock, Image as ImageIcon, CloudOff, Cloud, LayoutList, LayoutGrid
} from 'lucide-react'

// Inline SVG brand icons — lucide-react has deprecated all YouTube/Twitch exports
function LucideYoutube({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
    </svg>
  )
}
function LucideTwitch({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z" />
    </svg>
  )
}
import type { StreamFolder, StreamMeta, ConversionPreset, YTTitleTemplate, YTDescriptionTemplate, YTTagTemplate, LiveBroadcast, ThumbnailTemplate } from '../../types'
import { useStore } from '../../hooks/useStore'
import { useThumbnailEditor } from '../../context/ThumbnailEditorContext'
import { useFieldSuggestion } from '../../hooks/useFieldSuggestion'
import { GhostTextArea } from '../ui/GhostTextArea'
import type { GhostTextAreaHandle } from '../ui/GhostTextArea'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'
import { TagComboBox } from '../ui/TagComboBox'
import { ManageTagsModal } from '../ui/ManageTagsModal'
import { TemplatesModal } from '../ui/TemplatesModal'
import { Checkbox } from '../ui/Checkbox'
import { Tooltip } from '../ui/Tooltip'
import { getTagColor, getTagTextureStyle, pickColorForNewTag, pickTextureForNewTag } from '../../constants/tagColors'

// ─── Helpers ────────────────────────────────────────────────────────────────

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function friendlyDate(iso: string): string {
  const [year, month, day] = iso.split('-')
  const d = new Date(parseInt(year), parseInt(month) - 1, parseInt(day))
  return d.toLocaleDateString(undefined, { weekday: 'long' })
}

function toFileUrl(absPath: string): string {
  return 'file:///' + absPath.replace(/\\/g, '/')
}

// ─── ThumbImage ──────────────────────────────────────────────────────────────
// Renders a thumbnail image cloud-aware:
//   - When `isLocal` is false and `hydrate` is false → renders a Cloud icon
//     and never makes a file:// request. This avoids hanging the renderer on a
//     broken cloud-provider state (where Windows file APIs block indefinitely).
//   - When `isLocal` is false and `hydrate` is true → kicks off a cloud
//     download and shows a spinner; switches to <img> once the file becomes local.
//   - When `isLocal` is true → renders <img> normally. If the load fails (file
//     was supposedly local but isn't), falls back to the cloud-download flow.

function ThumbImage({ path, thumbsKey, isLocal = true, hydrate = false, className, placeholderClassName, placeholderStyle, draggable, iconSize = 14, onLoad }: {
  path: string
  thumbsKey: number
  /** False = file is a cloud placeholder. Default true (legacy callers / sites
   *  where local-flag isn't computed). */
  isLocal?: boolean
  /** When true and the file isn't local, request a cloud download. Used by the
   *  active image in carousels/lightbox so the user can preview by navigating. */
  hydrate?: boolean
  className?: string
  /** Classes applied to the placeholder element (cloud / syncing / error
   *  states). When omitted, falls back to `className`. Use this when the
   *  caller's className is image-specific (e.g. object-contain, max-w-[…]) and
   *  the placeholder needs different sizing rules. */
  placeholderClassName?: string
  /** Inline style for the placeholder element. Useful for size constraints
   *  that can't be expressed cleanly in Tailwind (e.g. min(…, calc(…))). */
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
  }, [path, thumbsKey, isLocal, hydrate])

  // Listen for cloud-download-done events whenever we're showing a placeholder.
  // The active hydrate instance kicks off the download; other instances of the
  // same file (e.g., the filmstrip thumb in a carousel) just listen so they
  // can swap to <img> once the file becomes local.
  useEffect(() => {
    if (status === 'loaded' || status === 'loading') return
    const unsub = window.api.onCloudDownloadDone(done => {
      if (done === path) { setReloadKey(k => k + 1); setStatus('loading') }
    })
    return unsub
  }, [status, path])

  // Active hydrate instance initiates the download and tracks the 30s timeout.
  // If the cloud provider is broken (Synology Drive in a stuck state, etc.),
  // the poller in main can run forever — surface an error after 30s.
  useEffect(() => {
    if (status !== 'syncing') return
    window.api.startCloudDownload(path).catch(() => {})
    const errorTimeoutId = setTimeout(() => setStatus('error'), 30_000)
    return () => {
      clearTimeout(errorTimeoutId)
      window.api.cancelCloudDownload(path).catch(() => {})
    }
  }, [status, path])

  // Cloud / syncing / error → render a sized placeholder. NEVER a file://
  // request here — that's what avoids hanging Chromium on a stuck cloud
  // provider. The caller controls the placeholder's shape via
  // placeholderClassName / placeholderStyle (defaults to className).
  if (status === 'cloud' || status === 'syncing' || status === 'error') {
    const baseCls = 'flex flex-col items-center justify-center gap-1 bg-navy-800/40'
    const cls = `${baseCls} ${placeholderClassName ?? className ?? ''}`
    const tooltip = status === 'syncing' ? 'Downloading from cloud…'
                  : status === 'error'   ? 'Cloud download failed — provider may be stuck or file is missing'
                                         : 'Cloud — open in the carousel to download'
    return (
      <div className={cls} style={placeholderStyle} title={tooltip}>
        {status === 'syncing' && <Loader2 size={iconSize} className="text-gray-600 animate-spin" />}
        {status === 'cloud'   && <Cloud   size={iconSize} className="text-gray-600" />}
        {status === 'error'   && <AlertTriangle size={iconSize} className="text-yellow-500" />}
        {status === 'syncing' && <span className="text-[9px] text-gray-600 leading-none">Syncing…</span>}
        {status === 'error'   && <span className="text-[9px] text-yellow-600 leading-none">Sync failed</span>}
      </div>
    )
  }

  const src = `${toFileUrl(path)}?t=${thumbsKey}&r=${reloadKey}`

  return (
    <>
      <img
        src={src}
        className={className}
        draggable={draggable}
        onLoad={() => { setStatus('loaded'); onLoad?.() }}
        onError={() => setStatus('syncing')}
      />
      {status !== 'loaded' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-navy-900">
          {/* loading state — silent placeholder */}
        </div>
      )}
    </>
  )
}

/** Returns the stream index from a folder name: 1 for base, 2+ for -N suffixed. */
function streamIndex(folderName: string): number {
  const m = folderName.match(/^\d{4}-\d{2}-\d{2}-(\d+)$/)
  return m ? parseInt(m[1], 10) : 1
}

// Normalise legacy string streamType values from stored JSON to the new string[] format
function normalizeStreamTypes(v: string | string[] | undefined): string[] {
  if (!v) return []
  return Array.isArray(v) ? v : [v]
}

// ─── Video count tooltip ─────────────────────────────────────────────────────

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(0)} MB`
  return `${(bytes / 1e3).toFixed(0)} KB`
}

const CATEGORY_LABEL: Record<string, string> = { full: 'vid', short: 'short', clip: 'clip' }
const CATEGORY_STYLES: Record<string, string> = {
  full:  'text-purple-400 border-purple-400/50',
  short: 'text-blue-400 border-blue-400/50',
  clip:  'text-gray-400 border-gray-600',
}

/** videoMap is keyed by the video's path relative to its stream folder, forward-slash
 *  normalized. For flat layouts that's just the basename; for nested layouts (e.g.
 *  clips/highlight.mp4) it includes the sub-folder. */
function videoMapKey(folderPath: string, videoPath: string): string {
  // Normalize both to forward slashes, then strip the folder prefix.
  const fp = folderPath.replace(/\\/g, '/').replace(/\/$/, '')
  const vp = videoPath.replace(/\\/g, '/')
  return vp.startsWith(fp + '/') ? vp.slice(fp.length + 1) : vp.split('/').pop() ?? vp
}

function VideoCountTooltip({ videos, videoMap, folderPath, children }: { videos: string[]; videoMap?: Record<string, import('../../types').VideoEntry>; folderPath: string; children: React.ReactNode }) {
  const [visible, setVisible] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number; maxHeight?: number }>({ top: 0, left: 0 })
  const [durations, setDurations] = useState<Record<string, number | null>>({})
  const [offlineFiles, setOfflineFiles] = useState<Set<string>>(new Set())
  const anchorRef = useRef<HTMLDivElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const probedRef = useRef(false)

  // Initial position: just below the anchor. useLayoutEffect repositions if it overflows.
  const show = async () => {
    if (!anchorRef.current) return
    const rect = anchorRef.current.getBoundingClientRect()
    setPos({ top: rect.bottom + 6, left: rect.left })
    setVisible(true)
    if (!probedRef.current) {
      probedRef.current = true
      const localFlags = await window.api.checkLocalFiles(videos)
      videos.forEach(async (v, i) => {
        if (!localFlags[i]) {
          setOfflineFiles(prev => new Set([...prev, v]))
          return
        }
        try {
          const info = await window.api.probeFile(v)
          setDurations(prev => ({ ...prev, [v]: info.duration }))
        } catch {
          setDurations(prev => ({ ...prev, [v]: null }))
        }
      })
    }
  }

  // After the tooltip renders, check whether it fits below the anchor. If not, flip to above.
  // If neither side fits, pick whichever has more room and cap height with internal scroll.
  useLayoutEffect(() => {
    if (!visible || !anchorRef.current || !tooltipRef.current) return
    const anchor = anchorRef.current.getBoundingClientRect()
    const tip = tooltipRef.current.getBoundingClientRect()
    const vh = window.innerHeight
    const GAP = 6
    const PAD = 8
    const spaceBelow = vh - anchor.bottom - GAP - PAD
    const spaceAbove = anchor.top - GAP - PAD
    const next: { top: number; left: number; maxHeight?: number } = { top: anchor.bottom + GAP, left: anchor.left }
    if (tip.height <= spaceBelow) {
      next.top = anchor.bottom + GAP
    } else if (tip.height <= spaceAbove) {
      next.top = anchor.top - tip.height - GAP
    } else if (spaceBelow >= spaceAbove) {
      next.top = anchor.bottom + GAP
      next.maxHeight = Math.max(80, spaceBelow)
    } else {
      next.maxHeight = Math.max(80, spaceAbove)
      next.top = anchor.top - next.maxHeight - GAP
    }
    if (next.top !== pos.top || next.maxHeight !== pos.maxHeight) setPos(next)
  }, [visible, videos.length, durations, offlineFiles, pos.top, pos.maxHeight])

  if (videos.length === 0) return <>{children}</>

  return (
    <>
      <div ref={anchorRef} onMouseEnter={show} onMouseLeave={() => setVisible(false)}>
        {children}
      </div>
      {visible && ReactDOM.createPortal(
        <div
          ref={tooltipRef}
          style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 9999, maxHeight: pos.maxHeight, overflowY: pos.maxHeight ? 'auto' : undefined }}
          className="bg-navy-700 border border-white/10 rounded-lg shadow-xl py-1.5 min-w-[260px] max-w-[420px]"
          onMouseEnter={() => setVisible(true)}
          onMouseLeave={() => setVisible(false)}
        >
          {videos.map(v => {
            const name = v.split(/[\\/]/).pop() ?? v
            const relKey = videoMapKey(folderPath, v)
            const entry = videoMap?.[relKey]
            const dur = entry?.duration ?? durations[v]
            const isOffline = offlineFiles.has(v)
            const category = entry?.category
            // For nested files (clips/, recordings/, etc.), show the sub-folder
            // path so the user can tell which file is which.
            const display = relKey.includes('/') ? relKey : name
            return (
              <div key={v} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-2 px-3 py-1.5">
                <span className="text-xs text-gray-300 truncate min-w-0" title={display}>{display}</span>
                <span className="shrink-0">
                  {category
                    ? <span className={`inline-block -translate-y-0.5 text-[10px] font-mono border rounded px-1 ${CATEGORY_STYLES[category] ?? ''}`}>{CATEGORY_LABEL[category] ?? category}</span>
                    : null}
                </span>
                <span className="text-xs text-gray-400 shrink-0 tabular-nums">
                  {entry?.size !== undefined ? formatBytes(entry.size) : ''}
                </span>
                <span className="text-xs font-mono shrink-0">
                  {isOffline
                    ? <span className="text-gray-400 italic">cloud</span>
                    : dur !== undefined
                      ? (dur !== null ? <span className="text-gray-400">{formatDuration(dur)}</span> : <span className="text-gray-500">—</span>)
                      : v in durations
                        ? <span className="text-gray-500">—</span>
                        : <Loader2 size={10} className="animate-spin text-gray-500" />
                  }
                </span>
              </div>
            )
          })}
        </div>,
        document.body
      )}
    </>
  )
}

// ─── Lightbox ────────────────────────────────────────────────────────────────

interface LightboxProps {
  thumbnails: string[]
  index: number
  thumbsKey?: number
  preferredThumbnail?: string
  onSetAsThumbnail?: (path: string) => void
  onClose: () => void
  onNavigate: (index: number) => void
  /** Parallel to `thumbnails`; false → cloud placeholder. */
  localFlags?: boolean[]
}

function Lightbox({ thumbnails, index, thumbsKey, preferredThumbnail, onSetAsThumbnail, onClose, onNavigate, localFlags }: LightboxProps) {
  const total = thumbnails.length
  const currentPath = thumbnails[index]
  const currentIsLocal = localFlags?.[index] ?? true
  const filename = currentPath.split(/[\\/]/).pop() ?? ''
  const isPreferred = preferredThumbnail
    ? filename === preferredThumbnail
    : index === 0
  const filmstripBtnRefs = useRef<(HTMLButtonElement | null)[]>([])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft')  onNavigate(Math.max(0, index - 1))
      if (e.key === 'ArrowRight') onNavigate(Math.min(total - 1, index + 1))
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [index, total, onClose, onNavigate])

  // Keep the active filmstrip thumbnail in view as the user navigates.
  useEffect(() => {
    filmstripBtnRefs.current[index]?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
  }, [index])

  return (
    <div
      className="fixed inset-x-0 bottom-0 top-10 z-50 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm select-none"
      onClick={onClose}
    >
      {/* Close */}
      <button
        onClick={onClose}
        className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/25 text-white transition-colors"
      >
        <X size={20} />
      </button>

      {/* Counter */}
      {total > 1 && (
        <div className="absolute top-5 left-1/2 -translate-x-1/2 text-xs text-gray-400 font-mono bg-black/50 px-3 py-1 rounded-full">
          {index + 1} / {total}
        </div>
      )}

      {/* Prev arrow */}
      {index > 0 && (
        <button
          onClick={e => { e.stopPropagation(); onNavigate(index - 1) }}
          className="absolute left-4 top-1/2 -translate-y-1/2 p-3 rounded-full bg-white/10 hover:bg-white/25 text-white transition-colors"
        >
          <ChevronLeft size={28} />
        </button>
      )}

      {/* Main image */}
      <div className="flex flex-col items-center relative" onClick={e => e.stopPropagation()}>
        <div className="relative">
          <ThumbImage
            key={currentPath}
            path={currentPath}
            thumbsKey={thumbsKey ?? 0}
            isLocal={currentIsLocal}
            hydrate
            className="max-h-[75vh] max-w-[85vw] object-contain shadow-2xl shadow-black"
            placeholderClassName="rounded shadow-2xl shadow-black"
            placeholderStyle={{
              // Largest 16:9 box that fits both viewport constraints
              width: 'min(85vw, calc(75vh * 16 / 9))',
              aspectRatio: '16 / 9',
            }}
            iconSize={48}
            draggable={false}
          />
        </div>
        <div className="mt-3 flex items-center gap-3">
          <p className="text-sm text-gray-400 font-mono">{filename}</p>
          {onSetAsThumbnail && (
            isPreferred ? (
              <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-purple-600/30 border border-purple-500/40 text-purple-300 text-xs font-medium">
                <Check size={12} /> Currently shown
              </span>
            ) : (
              <button
                onClick={() => onSetAsThumbnail(currentPath)}
                className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/10 hover:bg-purple-600/40 border border-white/20 hover:border-purple-500/50 text-gray-300 hover:text-purple-200 text-xs font-medium transition-colors"
              >
                <ImageIcon size={12} /> Set as item thumbnail
              </button>
            )
          )}
        </div>
      </div>

      {/* Next arrow */}
      {index < total - 1 && (
        <button
          onClick={e => { e.stopPropagation(); onNavigate(index + 1) }}
          className="absolute right-4 top-1/2 -translate-y-1/2 p-3 rounded-full bg-white/10 hover:bg-white/25 text-white transition-colors"
        >
          <ChevronRight size={28} />
        </button>
      )}

      {/* Filmstrip */}
      {total > 1 && (
        <div className="absolute inset-x-0 bottom-5 px-5 flex justify-center pointer-events-none">
        <div
          className="flex items-center gap-2 px-4 py-2 bg-black/60 rounded-xl max-w-full overflow-x-auto pointer-events-auto"
          onClick={e => e.stopPropagation()}
        >
          {thumbnails.map((t, i) => (
            <button
              key={t}
              ref={el => { filmstripBtnRefs.current[i] = el }}
              onClick={() => onNavigate(i)}
              className={`shrink-0 h-10 aspect-video bg-navy-600 rounded overflow-hidden border-2 transition-all ${
                i === index
                  ? 'border-purple-500 opacity-100 scale-105'
                  : 'border-transparent opacity-40 hover:opacity-75'
              }`}
            >
              <div className="relative w-full h-full">
                <ThumbImage
                  path={t}
                  thumbsKey={thumbsKey ?? 0}
                  isLocal={localFlags?.[i] ?? true}
                  className="w-full h-full object-cover"
                  placeholderClassName="w-full h-full"
                  iconSize={10}
                  draggable={false}
                />
              </div>
            </button>
          ))}
        </div>
        </div>
      )}
    </div>
  )
}

// ─── Thumbnail carousel ──────────────────────────────────────────────────────

interface ThumbnailCarouselProps {
  thumbnails: string[]
  thumbsKey?: number
  preferredThumbnail?: string
  onSetAsThumbnail?: (path: string) => void
  /** Parallel to `thumbnails`. Each element is true if the file's data is local
   *  on disk; false if it's a cloud-provider placeholder. The active image
   *  hydrates on demand; other slots show the cloud icon until they become active. */
  localFlags?: boolean[]
}

function ThumbnailCarousel({ thumbnails, thumbsKey, preferredThumbnail, onSetAsThumbnail, localFlags }: ThumbnailCarouselProps) {
  const [index, setIndex] = useState(0)
  const [translateX, setTranslateX] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const imgRefs = useRef<(HTMLElement | null)[]>([])
  const single = thumbnails.length === 1

  const recenter = useCallback(() => {
    const el = imgRefs.current[index]
    const container = containerRef.current
    if (!el || !container) return
    const itemCenter = el.offsetLeft + el.offsetWidth / 2
    setTranslateX(container.clientWidth / 2 - itemCenter)
  }, [index])

  useLayoutEffect(() => { recenter() }, [recenter])

  const currentPath = thumbnails[index]
  const filename = currentPath.split(/[\\/]/).pop() ?? ''
  const isPreferred = preferredThumbnail
    ? filename === preferredThumbnail
    : index === 0

  return (
    <div className="flex flex-col gap-1.5">
      <div className="relative overflow-hidden" style={{ height: 200 }} ref={containerRef}>
        <div
          className="flex items-center gap-2 h-full transition-transform duration-200"
          style={{ transform: `translateX(${translateX}px)` }}
        >
          {thumbnails.map((t, i) => {
            const slotIsLocal = localFlags?.[i] ?? true
            // Cloud placeholders need an explicit shape since there's no <img>
            // to size the slot. Default to 16:9 with a faint background.
            const slotShapeClasses = slotIsLocal ? 'h-full' : 'h-full aspect-video bg-navy-800/40 rounded'
            return (
              <div
                key={t}
                ref={el => { imgRefs.current[i] = el }}
                className={`relative shrink-0 ${slotShapeClasses}`}
                onClick={() => setIndex(i)}
              >
                <ThumbImage
                  path={t}
                  thumbsKey={thumbsKey ?? 0}
                  isLocal={slotIsLocal}
                  hydrate={i === index}
                  className={`h-full w-auto cursor-pointer transition-opacity duration-150 ${i === index ? 'opacity-100' : 'opacity-40 hover:opacity-70'}`}
                  placeholderClassName={`w-full h-full rounded cursor-pointer transition-opacity duration-150 ${i === index ? 'opacity-100' : 'opacity-40 hover:opacity-70'}`}
                  iconSize={20}
                  onLoad={recenter}
                />
              </div>
            )
          })}
        </div>
        {!single && (
          <>
            <button
              onClick={() => setIndex(i => (i - 1 + thumbnails.length) % thumbnails.length)}
              className="absolute left-1 top-1/2 -translate-y-1/2 flex items-center justify-center w-7 h-7 rounded-full bg-black/50 hover:bg-black/70 text-white transition-colors"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              onClick={() => setIndex(i => (i + 1) % thumbnails.length)}
              className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center justify-center w-7 h-7 rounded-full bg-black/50 hover:bg-black/70 text-white transition-colors"
            >
              <ChevronRight size={16} />
            </button>
          </>
        )}
      </div>
      <div className="flex items-center justify-between px-1 min-h-[20px]">
        {!single ? (
          <p className="text-xs text-gray-500 truncate flex-1 text-center px-7">{filename}</p>
        ) : <span />}
        {onSetAsThumbnail && (
          isPreferred ? (
            <span className="flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-purple-600/25 border border-purple-500/35 text-purple-300 text-xs font-medium whitespace-nowrap ml-2">
              <Check size={11} /> Currently shown
            </span>
          ) : (
            <button
              onClick={() => onSetAsThumbnail(currentPath)}
              className="flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-white/8 hover:bg-purple-600/30 border border-white/15 hover:border-purple-500/45 text-gray-400 hover:text-purple-200 text-xs font-medium whitespace-nowrap ml-2 transition-colors"
            >
              <ImageIcon size={11} /> Set as item thumbnail
            </button>
          )
        )}
      </div>
    </div>
  )
}

// ─── Metadata modal ─────────────────────────────────────────────────────────

interface MetaModalProps {
  mode: 'new' | 'edit' | 'add'
  initialMeta?: StreamMeta | null
  /** Authoritative date from the folder name — overrides initialMeta.date in edit/add mode */
  folderDate?: string
  detectedGames?: string[]
  allGames?: string[]
  allStreamTypes?: string[]
  allFolders?: StreamFolder[]
  templates?: { name: string; path: string }[]
  defaultTemplateName?: string
  builtinTemplates?: ThumbnailTemplate[]
  defaultBuiltinTemplateId?: string
  useBuiltinByDefault?: boolean
  thumbnails?: string[]
  /** Parallel to `thumbnails`; false → cloud placeholder. */
  thumbnailLocalFlags?: boolean[]
  thumbsKey?: number
  preferredThumbnail?: string
  onSetAsThumbnail?: (path: string) => void
  tagColors?: Record<string, string>
  tagTextures?: Record<string, string>
  onNewStreamType?: (tag: string) => void
  claudeEnabled?: boolean
  onSave: (meta: StreamMeta, date: string, thumbnailTemplatePath?: string, prevEpisodeFolderPath?: string, builtinTemplateId?: string) => Promise<void>
  onClose: () => void
}

function applyMergeFields(template: string, fields: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => fields[key] ?? `{${key}}`)
}

function detectEpisodeNumber(allFolders: StreamFolder[], gameName: string, season: string, beforeDate?: string): number {
  if (!gameName) return 1
  const lower = gameName.toLowerCase()
  const s = season || '1'
  const matching = allFolders.filter(f =>
    f.meta?.games?.some(g => g.toLowerCase() === lower) &&
    (f.meta?.ytSeason ?? '1') === s &&
    (!beforeDate || f.date < beforeDate)
  )
  return matching.length + 1
}

// Counts all streams in the series+season including the current one (+1 because allFolders always excludes it)
function detectTotalEpisodes(allFolders: StreamFolder[], gameName: string, season: string): number {
  if (!gameName) return 1
  const lower = gameName.toLowerCase()
  const s = season || '1'
  return allFolders.filter(f =>
    f.meta?.games?.some(g => g.toLowerCase() === lower) &&
    (f.meta?.ytSeason ?? '1') === s
  ).length + 1
}

// Inherits the season from the most recent preceding stream in the same series
function detectSeason(allFolders: StreamFolder[], gameName: string, beforeDate?: string): string {
  if (!gameName) return '1'
  const lower = gameName.toLowerCase()
  const prev = allFolders
    .filter(f =>
      f.meta?.games?.some(g => g.toLowerCase() === lower) &&
      (!beforeDate || f.date < beforeDate)
    )
    .sort((a, b) => b.date.localeCompare(a.date))[0]
  return prev?.meta?.ytSeason ?? '1'
}

function folderMetaBase(folder: StreamFolder): StreamMeta {
  return folder.meta ?? { date: folder.date, streamType: [], games: [], comments: '' }
}

const PREV_EPISODE_SENTINEL = '__copy_prev_episode__'

function getPrevEpisodeFolder(gamesList: string[], allFolders: StreamFolder[], season: string): StreamFolder | null {
  const mainGame = gamesList[0]
  if (!mainGame) return null
  const episodeNum = detectEpisodeNumber(allFolders, mainGame, season)
  if (episodeNum <= 1) return null
  const gameLower = mainGame.toLowerCase()
  const s = season || '1'
  return allFolders
    .filter(f =>
      f.meta?.games?.some(g => g.toLowerCase() === gameLower) &&
      (f.meta?.ytSeason ?? '1') === s
    )
    .sort((a, b) => b.date.localeCompare(a.date))[0] ?? null
}

// panelAnimate built inside StreamsPage so duration can react to slowAnimations setting

function MetaModal({ mode, initialMeta, folderDate, detectedGames = [], allGames = [], allStreamTypes = [], allFolders = [], templates = [], defaultTemplateName = '', builtinTemplates = [], defaultBuiltinTemplateId = '', useBuiltinByDefault = true, thumbnails = [], thumbnailLocalFlags, thumbsKey, preferredThumbnail, onSetAsThumbnail, tagColors = {}, tagTextures = {}, claudeEnabled = false, onNewStreamType, onSave, onClose }: MetaModalProps) {
  const defaultTemplate = templates.find(t => t.name === defaultTemplateName) ?? templates[0] ?? null
  const defaultBuiltinTemplate = builtinTemplates.find(t => t.id === defaultBuiltinTemplateId) ?? builtinTemplates[0] ?? null
  const { navigateToEditor } = useThumbnailEditor()

  // In edit/add mode the folder name is the authoritative date source — the stored meta.date
  // may be wrong if the file was created with the wrong date (e.g. migration artefact).
  const [date, setDate] = useState(
    mode === 'new' ? (initialMeta?.date ?? today()) : (folderDate ?? initialMeta?.date ?? today())
  )
  const [streamTypes, setStreamTypes] = useState<string[]>(
    normalizeStreamTypes(initialMeta?.streamType)
  )
  const [games, setGames] = useState<string[]>(
    initialMeta?.games?.length ? initialMeta.games : detectedGames
  )
  const [ytSeason, setYtSeason] = useState(initialMeta?.ytSeason ?? '1')
  const ytSeasonUserEdited = useRef(!!initialMeta?.ytSeason)

  const prevEpisodeFolder = useMemo(
    () => mode === 'new' ? getPrevEpisodeFolder(games, allFolders, ytSeason) : null,
    [mode, games, allFolders, ytSeason]
  )
  // Only show the copy option if the previous folder actually has thumbnails
  const hasPrevThumbnails = (prevEpisodeFolder?.thumbnails.length ?? 0) > 0

  const [useBuiltinThumbnail, setUseBuiltinThumbnail] = useState<boolean>(useBuiltinByDefault)
  const [selectedBuiltinTemplateId, setSelectedBuiltinTemplateId] = useState<string>(defaultBuiltinTemplate?.id ?? '')
  const [selectedTemplatePath, setSelectedTemplatePath] = useState<string>(() => {
    const initGames = initialMeta?.games?.length ? initialMeta.games : detectedGames
    const initSeason = initialMeta?.ytSeason ?? '1'
    const initPrevFolder = mode === 'new' ? getPrevEpisodeFolder(initGames, allFolders, initSeason) : null
    const hasPrev = (initPrevFolder?.thumbnails.length ?? 0) > 0
    return hasPrev ? PREV_EPISODE_SENTINEL : (defaultTemplate?.path ?? '')
  })
  const [comments, setComments] = useState(initialMeta?.comments ?? '')
  const [archived, setArchived] = useState(initialMeta?.archived ?? false)
  const [localPreferredThumbnail, setLocalPreferredThumbnail] = useState<string | undefined>(
    initialMeta?.preferredThumbnail
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // ── YouTube state ──────────────────────────────────────────────────────────
  const [ytConnected, setYtConnected] = useState(false)
  const [ytTitleTemplates, setYtTitleTemplates] = useState<YTTitleTemplate[]>([])
  const [ytDescTemplates, setYtDescTemplates] = useState<YTDescriptionTemplate[]>([])
  const [ytTagTemplates, setYtTagTemplates] = useState<YTTagTemplate[]>([])
  const [ytBroadcasts, setYtBroadcasts] = useState<LiveBroadcast[]>([])
  const [ytVods, setYtVods] = useState<LiveBroadcast[]>([])
  const [ytBroadcastsLoading, setYtBroadcastsLoading] = useState(false)
  const [ytVodsLoaded, setYtVodsLoaded] = useState(false)
  const [ytBroadcastError, setYtBroadcastError] = useState('')
  const [ytSelectedBroadcastId, setYtSelectedBroadcastId] = useState('')
  const [ytVideoUnlinked, setYtVideoUnlinked] = useState(false)
  const [ytManualUrl, setYtManualUrl] = useState('')
  const [ytManualLoading, setYtManualLoading] = useState(false)
  const [ytManualError, setYtManualError] = useState('')
  const [ytNewPrivacy, setYtNewPrivacy] = useState<'public' | 'unlisted' | 'private'>('public')
  const [ytCreatingBroadcast, setYtCreatingBroadcast] = useState(false)
  const [ytCreateError, setYtCreateError] = useState('')

  const isPastStream = date < today()
  const isNextUpcomingStream = !isPastStream && (() => {
    if (mode === 'new') return true
    if (!folderDate) return false
    const todayStr = today()
    const earliestOther = allFolders.map(f => f.date).filter(d => d >= todayStr).sort()[0]
    return !earliestOther || folderDate <= earliestOther
  })()
  const [ytSelectedTitleId, setYtSelectedTitleId] = useState('')
  const [ytSelectedDescId, setYtSelectedDescId] = useState('')
  const [ytSelectedTagId, setYtSelectedTagId] = useState('')
  const [ytTitle, setYtTitle] = useState(initialMeta?.ytTitle ?? '')
  const [ytDescription, setYtDescription] = useState(initialMeta?.ytDescription ?? '')
  const [ytGameTitle, setYtGameTitle] = useState(initialMeta?.ytGameTitle ?? '')
  const [ytTagsText, setYtTagsText] = useState(initialMeta?.ytTags?.join(', ') ?? '')

  // ── Claude AI suggestions ─────────────────────────────────────────────────
  // Build context lazily so each fetch always uses the latest state values
  const gamesRef = useRef(games)
  const streamTypesRef = useRef(streamTypes)
  const dateRef = useRef(date)
  const ytTitleRef = useRef(ytTitle)
  const ytDescriptionRef = useRef(ytDescription)
  useEffect(() => { gamesRef.current = games }, [games])
  useEffect(() => { streamTypesRef.current = streamTypes }, [streamTypes])
  useEffect(() => { dateRef.current = date }, [date])
  useEffect(() => { ytTitleRef.current = ytTitle }, [ytTitle])
  useEffect(() => { ytDescriptionRef.current = ytDescription }, [ytDescription])

  const buildContext = useCallback(() => ({
    date: dateRef.current,
    streamTypes: streamTypesRef.current,
    games: gamesRef.current,
    currentTitle: ytTitleRef.current || undefined,
    currentDescription: ytDescriptionRef.current || undefined,
  }), [])

  const noop = useCallback((_pre: string, _suf: string) => Promise.resolve(null), [])
  const fetchTitle = useCallback((prefix: string, suffix: string) => window.api.claudeGenerate('title', { ...buildContext(), prefix, suffix }), [buildContext])
  const fetchDescription = useCallback((prefix: string, suffix: string) => window.api.claudeGenerate('description', { ...buildContext(), prefix, suffix }), [buildContext])
  const fetchTags = useCallback((prefix: string, suffix: string) => window.api.claudeGenerate('tags', { ...buildContext(), prefix, suffix }), [buildContext])

  // User-input setters — clear the template selection so the dropdown shows the current
  // field as custom (and lets the user re-pick the same template to reset).
  const handleTitleUserChange = useCallback((v: string) => {
    setYtTitle(v)
    setYtSelectedTitleId(prev => prev ? '' : prev)
  }, [])
  const handleTagsUserChange = useCallback((v: string) => {
    setYtTagsText(v)
    setYtSelectedTagId(prev => prev ? '' : prev)
  }, [])
  const handleDescUserChange = useCallback((v: string) => {
    setYtDescription(v)
    setYtSelectedDescId(prev => prev ? '' : prev)
  }, [])

  const titleSg = useFieldSuggestion(ytTitle, handleTitleUserChange, claudeEnabled ? fetchTitle : noop)
  const tagsSg = useFieldSuggestion(ytTagsText, handleTagsUserChange, claudeEnabled ? fetchTags : noop)

  // Description — uses GhostTextArea with inline suggestion state
  const descRef = useRef<GhostTextAreaHandle>(null)
  const [descSuggestion, setDescSuggestion] = useState('')
  const [descInsertAt, setDescInsertAt] = useState(0)
  const [descLoading, setDescLoading] = useState(false)
  const descSuggestionRef = useRef('')
  const descLoadingRef = useRef(false)
  useEffect(() => { descSuggestionRef.current = descSuggestion }, [descSuggestion])
  useEffect(() => { descLoadingRef.current = descLoading }, [descLoading])

  const handleDescRequest = useCallback(async (prefix: string, suffix: string) => {
    if (descSuggestionRef.current || descLoadingRef.current || !claudeEnabled) return
    descLoadingRef.current = true
    setDescLoading(true)
    try {
      const result = await fetchDescription(prefix, suffix)
      if (result && !descSuggestionRef.current) {
        setDescInsertAt(prefix.length)
        setDescSuggestion(result)
      }
    } catch {
      // best-effort
    } finally {
      descLoadingRef.current = false
      setDescLoading(false)
    }
  }, [claudeEnabled, fetchDescription])

  const descInsertAtRef = useRef(0)
  useEffect(() => { descInsertAtRef.current = descInsertAt }, [descInsertAt])

  const handleDescAccept = useCallback(() => {
    const pos = descInsertAtRef.current
    const sug = descSuggestionRef.current
    const val = ytDescriptionRef.current
    setYtDescription(val.slice(0, pos) + sug + val.slice(pos))
    setYtSelectedDescId(prev => prev ? '' : prev)
    setDescSuggestion('')
    requestAnimationFrame(() => descRef.current?.setCursorOffset(pos + sug.length))
  }, [])

  const handleDescDismiss = useCallback(() => setDescSuggestion(''), [])
  const [ytEpisode, setYtEpisode] = useState(initialMeta?.ytEpisode ?? '1')
  const ytEpisodeUserEdited = useRef(!!initialMeta?.ytEpisode)
  const [ytTotalEpisodes, setYtTotalEpisodes] = useState(() => String(detectTotalEpisodes(allFolders, games[0] ?? '', ytSeason)))
  const [ytCatchyTitle, setYtCatchyTitle] = useState(initialMeta?.ytCatchyTitle ?? '')
  const [alsoUpdateTwitch, setAlsoUpdateTwitch] = useState(isNextUpcomingStream)
  const [pushing, setPushing] = useState(false)
  const [pushError, setPushError] = useState('')
  const [pushSuccess, setPushSuccess] = useState(false)
  const [ytQualifyingThumbnails, setYtQualifyingThumbnails] = useState<string[]>([])
  const [ytSelectedThumbnail, setYtSelectedThumbnail] = useState<string | null>(null)

  // ── Twitch state ───────────────────────────────────────────────────────────
  const [twConnected, setTwConnected] = useState(false)
  const [syncTitle, setSyncTitle] = useState(initialMeta?.syncTitle ?? true)
  const [twitchTitle, setTwitchTitle] = useState(initialMeta?.twitchTitle ?? '')
  const [twitchGameName, setTwitchGameName] = useState(initialMeta?.twitchGameName ?? '')

  const [isDirty, setIsDirty] = useState(false)
  const initialSnapshot = useRef(JSON.stringify({
    streamTypes: normalizeStreamTypes(initialMeta?.streamType),
    games: initialMeta?.games?.length ? initialMeta.games : detectedGames,
    comments: initialMeta?.comments ?? '',
    archived: initialMeta?.archived ?? false,
    ytTitle: initialMeta?.ytTitle ?? '',
    ytDescription: initialMeta?.ytDescription ?? '',
    ytGameTitle: initialMeta?.ytGameTitle ?? '',
    ytTagsText: initialMeta?.ytTags?.join(', ') ?? '',
    ytSeason: initialMeta?.ytSeason ?? '1',
    ytEpisode: initialMeta?.ytEpisode ?? '1',
    ytCatchyTitle: initialMeta?.ytCatchyTitle ?? '',
    twitchTitle: initialMeta?.twitchTitle ?? '',
    twitchGameName: initialMeta?.twitchGameName ?? '',
    syncTitle: initialMeta?.syncTitle ?? true,
    ytVideoId: initialMeta?.ytVideoId,
    preferredThumbnail: initialMeta?.preferredThumbnail,
  }))
  useEffect(() => {
    const current = JSON.stringify({
      streamTypes, games, comments, archived, ytTitle, ytDescription, ytGameTitle,
      ytTagsText, ytSeason, ytEpisode, ytCatchyTitle, twitchTitle, twitchGameName, syncTitle,
      ytVideoId: ytVideoUnlinked ? undefined : (ytSelectedBroadcastId || initialMeta?.ytVideoId || undefined),
      preferredThumbnail: localPreferredThumbnail,
    })
    setIsDirty(current !== initialSnapshot.current)
  }, [streamTypes, games, comments, archived, ytTitle, ytDescription, ytGameTitle,
      ytTagsText, ytSeason, ytEpisode, ytCatchyTitle, twitchTitle, twitchGameName, syncTitle,
      ytVideoUnlinked, ytSelectedBroadcastId, localPreferredThumbnail])

  // Keep Twitch title in sync with YT title when syncTitle is on
  useEffect(() => {
    if (syncTitle) setTwitchTitle(ytTitle)
  }, [syncTitle, ytTitle])

  // Auto-fill twitchGameName from first game (same as ytGameTitle)
  useEffect(() => {
    if (games.length > 0) setTwitchGameName(games[0])
  }, [games])

  useEffect(() => {
    window.api.twitchGetStatus?.().then((s: { connected: boolean }) => {
      setTwConnected(s.connected)
    }).catch(() => {})
  }, [])

  const parseYouTubeVideoId = (input: string): string | null => {
    const s = input.trim()
    // watch?v=ID
    const watchMatch = s.match(/[?&]v=([a-zA-Z0-9_-]{11})/)
    if (watchMatch) return watchMatch[1]
    // studio.youtube.com/video/ID[/...]
    const studioMatch = s.match(/studio\.youtube\.com\/video\/([a-zA-Z0-9_-]{11})/)
    if (studioMatch) return studioMatch[1]
    // youtu.be/ID or youtube.com/live/ID or youtube.com/shorts/ID
    const pathMatch = s.match(/(?:youtu\.be|youtube\.com\/(?:live|shorts))\/([a-zA-Z0-9_-]{11})/)
    if (pathMatch) return pathMatch[1]
    // bare 11-char ID
    if (/^[a-zA-Z0-9_-]{11}$/.test(s)) return s
    return null
  }

  const utcToLocalDate = (isoString: string): string => {
    const d = new Date(isoString)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }

  const handleManualUrlChange = async (value: string) => {
    setYtManualUrl(value)
    setYtManualError('')
    if (!value.trim()) return
    const videoId = parseYouTubeVideoId(value)
    if (!videoId) { setYtManualError('Could not find a video ID in that URL.'); return }
    setYtManualLoading(true)
    try {
      const video = await window.api.youtubeGetVideoById(videoId)
      if (!video) { setYtManualError('Video not found or not accessible.'); return }
      setYtVods(prev => prev.some(v => v.id === video.id) ? prev : [video, ...prev])
      setYtSelectedBroadcastId(video.id)
      setYtManualUrl('')
    } catch (e: any) {
      setYtManualError(e.message ?? 'Failed to fetch video info.')
    } finally {
      setYtManualLoading(false)
    }
  }

  const loadAllVods = async () => {
    if (ytVodsLoaded || ytBroadcastsLoading) return
    setYtBroadcastsLoading(true)
    setYtBroadcastError('')
    try {
      const items: LiveBroadcast[] = await window.api.youtubeGetCompletedBroadcasts()
      setYtVods(items)
      setYtVodsLoaded(true)
      // If nothing is selected yet, try to match by date
      if (!ytSelectedBroadcastId) {
        const dateMatch = items.find(v =>
          utcToLocalDate(v.snippet.actualStartTime ?? v.snippet.scheduledStartTime ?? '') === date
        )
        if (dateMatch) setYtSelectedBroadcastId(dateMatch.id)
      }
    } catch (e: any) {
      setYtBroadcastError(e.message ?? 'Failed to load VODs')
    } finally {
      setYtBroadcastsLoading(false)
    }
  }

  useEffect(() => {
    window.api.youtubeGetStatus().then((s: { connected: boolean }) => {
      console.log('[YT renderer] getStatus:', s)
      setYtConnected(s.connected)
      if (!s.connected) return
      Promise.allSettled([
        window.api.getYTTitleTemplates(),
        window.api.getYTDescriptionTemplates(),
        window.api.getYTTagTemplates(),
      ]).then(([titlesR, descsR, tagsR]) => {
        if (titlesR.status === 'fulfilled') setYtTitleTemplates(titlesR.value)
        if (descsR.status === 'fulfilled') setYtDescTemplates(descsR.value)
        if (tagsR.status === 'fulfilled') setYtTagTemplates(tagsR.value)
      })

      if (!isPastStream) {
        // Only the next upcoming stream gets the active broadcast auto-attached
        if (!isNextUpcomingStream) return
        setYtBroadcastsLoading(true)
        window.api.youtubeGetBroadcasts().then((items: LiveBroadcast[]) => {
          console.log('[YT renderer] broadcasts:', items.length, items.map((b: any) => b.id))
          setYtBroadcasts(items)
          const savedId = initialMeta?.ytVideoId
          if (savedId) {
            setYtSelectedBroadcastId(savedId)
          } else {
            const dateMatch = items.find(v =>
              utcToLocalDate(v.snippet.scheduledStartTime ?? '') === date
            )
            setYtSelectedBroadcastId(dateMatch?.id ?? '')
          }
        }).catch((e: any) => {
          setYtBroadcastError(e.message ?? 'Failed to load broadcasts')
        }).finally(() => setYtBroadcastsLoading(false))
      } else {
        const savedId = initialMeta?.ytVideoId
        if (savedId) {
          // Already linked — fetch just that one video to show it; full list loads lazily on dropdown click
          window.api.youtubeGetVideoById(savedId).then(video => {
            if (video) { setYtVods([video]); setYtSelectedBroadcastId(savedId) }
          }).catch(() => {})
        } else {
          // No saved video — leave blank; loadAllVods will date-match when the dropdown is opened
        }
      }
    }).catch((e: any) => { console.error('[YT renderer] getStatus failed:', e) })
  }, [])

  // Fetch qualifying thumbnails for YouTube upload
  useEffect(() => {
    if (thumbnails.length === 0) return
    window.api.youtubeGetQualifyingThumbnails(thumbnails).then(qualified => {
      setYtQualifyingThumbnails(qualified)
      setYtSelectedThumbnail(qualified[0] ?? null)
    })
  }, [thumbnails])

  // Auto-fill game title from first game
  useEffect(() => {
    if (games.length > 0) setYtGameTitle(games[0])
  }, [games])

  // Auto-detect season — inherit from the most recent preceding stream in the same series
  useEffect(() => {
    if (ytSeasonUserEdited.current) return
    if (games.length > 0) setYtSeason(detectSeason(allFolders, games[0], date))
  }, [games, allFolders, date])

  // Auto-detect episode — skip if the user has manually edited the value
  // Season is included as a dep so changing season triggers re-detection
  useEffect(() => {
    if (ytEpisodeUserEdited.current) return
    if (games.length > 0) setYtEpisode(String(detectEpisodeNumber(allFolders, games[0], ytSeason, date)))
  }, [games, allFolders, date, ytSeason])

  // Auto-detect total episodes in the series+season; always at least as large as the current episode
  useEffect(() => {
    if (games.length === 0) return
    const detected = detectTotalEpisodes(allFolders, games[0], ytSeason)
    const ep = parseInt(ytEpisode, 10) || 1
    setYtTotalEpisodes(String(Math.max(detected, ep)))
  }, [games, allFolders, ytSeason, ytEpisode])

  // Apply title template when selection or merge fields change
  useEffect(() => {
    const tmpl = ytTitleTemplates.find(t => t.id === ytSelectedTitleId)
    if (!tmpl) return
    const rendered = applyMergeFields(tmpl.template, { game: ytGameTitle, season: ytSeason, episode: ytEpisode, title: ytCatchyTitle, total_episodes: ytTotalEpisodes })
    setYtTitle(rendered)
    requestAnimationFrame(() => {
      const el = titleSg.ref.current as HTMLInputElement | null
      if (el) { el.focus(); el.setSelectionRange(rendered.length, rendered.length) }
    })
  }, [ytSelectedTitleId, ytTitleTemplates, ytGameTitle, ytSeason, ytEpisode, ytCatchyTitle, ytTotalEpisodes])

  // Apply description template
  useEffect(() => {
    const tmpl = ytDescTemplates.find(t => t.id === ytSelectedDescId)
    if (!tmpl) return
    const rendered = applyMergeFields(tmpl.description, { game: ytGameTitle, season: ytSeason, episode: ytEpisode, title: ytCatchyTitle, total_episodes: ytTotalEpisodes })
    setYtDescription(rendered)
    requestAnimationFrame(() => {
      descRef.current?.focus()
      descRef.current?.setCursorOffset(rendered.length)
    })
  }, [ytSelectedDescId, ytDescTemplates])

  // Apply tag template
  useEffect(() => {
    const tmpl = ytTagTemplates.find(t => t.id === ytSelectedTagId)
    if (!tmpl) return
    const rendered = tmpl.tags.join(', ')
    setYtTagsText(rendered)
    requestAnimationFrame(() => {
      const el = tagsSg.ref.current as HTMLTextAreaElement | null
      if (el) { el.focus(); el.setSelectionRange(rendered.length, rendered.length) }
    })
  }, [ytSelectedTagId, ytTagTemplates])

  // Find a tag template whose name matches one of the selected games
  const gameMatchedTagTemplate = useMemo(() => {
    if (!games.length || !ytTagTemplates.length) return null
    for (const game of games) {
      const match = ytTagTemplates.find(t => t.name.toLowerCase() === game.toLowerCase())
      if (match) return match
    }
    return null
  }, [games, ytTagTemplates])

  // "Save as template" availability — only show when current value doesn't match any existing template
  const canSaveTitleTemplate = useMemo(
    () => ytTitle.trim().length > 0 && !ytTitleTemplates.some(t => t.template === ytTitle),
    [ytTitle, ytTitleTemplates]
  )
  const canSaveDescTemplate = useMemo(
    () => ytDescription.trim().length > 0 && !ytDescTemplates.some(t => t.description === ytDescription),
    [ytDescription, ytDescTemplates]
  )
  const canSaveTagsTemplate = useMemo(() => {
    const tags = ytTagsText.split(',').map(t => t.trim()).filter(Boolean)
    if (tags.length === 0) return false
    const currentKey = [...tags].sort().join('|').toLowerCase()
    return !ytTagTemplates.some(t => [...t.tags].sort().join('|').toLowerCase() === currentKey)
  }, [ytTagsText, ytTagTemplates])

  const saveTitleAsTemplate = useCallback(async (name: string) => {
    const tpl: YTTitleTemplate = { id: crypto.randomUUID(), name, template: ytTitle }
    const next = [...ytTitleTemplates, tpl]
    setYtTitleTemplates(next)
    await window.api.setYTTitleTemplates(next)
    setYtSelectedTitleId(tpl.id)
  }, [ytTitle, ytTitleTemplates])

  const saveDescAsTemplate = useCallback(async (name: string) => {
    const tpl: YTDescriptionTemplate = { id: crypto.randomUUID(), name, description: ytDescription }
    const next = [...ytDescTemplates, tpl]
    setYtDescTemplates(next)
    await window.api.setYTDescriptionTemplates(next)
    setYtSelectedDescId(tpl.id)
  }, [ytDescription, ytDescTemplates])

  const saveTagsAsTemplate = useCallback(async (name: string) => {
    const tags = ytTagsText.split(',').map(t => t.trim()).filter(Boolean)
    const tpl: YTTagTemplate = { id: crypto.randomUUID(), name, tags }
    const next = [...ytTagTemplates, tpl]
    setYtTagTemplates(next)
    await window.api.setYTTagTemplates(next)
    setYtSelectedTagId(tpl.id)
  }, [ytTagsText, ytTagTemplates])

  const selectedBroadcast = useMemo(
    () => (isPastStream ? ytVods : ytBroadcasts).find(b => b.id === ytSelectedBroadcastId) ?? null,
    [isPastStream, ytVods, ytBroadcasts, ytSelectedBroadcastId]
  )

  const broadcastMismatch = useMemo(() => {
    if (!selectedBroadcast) return false
    if (selectedBroadcast.snippet.title !== ytTitle) return true
    if (selectedBroadcast.snippet.description !== ytDescription) return true
    if (selectedBroadcast.snippet.gameTitle && selectedBroadcast.snippet.gameTitle !== ytGameTitle) return true
    const bcTags = selectedBroadcast.snippet.tags?.join(', ') ?? ''
    if (bcTags && bcTags !== ytTagsText) return true
    return false
  }, [selectedBroadcast, ytTitle, ytDescription, ytGameTitle, ytTagsText])

  const applyBroadcastToMeta = () => {
    if (!selectedBroadcast) return
    const newTitle = selectedBroadcast.snippet.title
    const newGame = selectedBroadcast.snippet.gameTitle
    setYtTitle(newTitle)
    setYtDescription(selectedBroadcast.snippet.description)
    if (newGame) setYtGameTitle(newGame)
    if (selectedBroadcast.snippet.tags?.length) setYtTagsText(selectedBroadcast.snippet.tags.join(', '))
    if (alsoUpdateTwitch && twConnected) {
      if (syncTitle) setTwitchTitle(newTitle)
      if (newGame) setTwitchGameName(newGame)
    }
  }

  const handleSave = async () => {
    if (!date) { setError('Date is required.'); return }
    setSaving(true)
    setError('')
    try {
      const tags = ytTagsText.split(',').map(t => t.trim()).filter(Boolean)
      const isPrevEpisode = selectedTemplatePath === PREV_EPISODE_SENTINEL
      const effectiveTwitchTitle = syncTitle ? ytTitle : twitchTitle
      await onSave(
        {
          date, streamType: streamTypes, games, comments,
          archived: mode === 'edit' ? archived : undefined,
          preferredThumbnail: localPreferredThumbnail,
          ytVideoId: ytVideoUnlinked ? undefined : (ytSelectedBroadcastId || initialMeta?.ytVideoId || undefined),
          ytTitle: ytTitle || undefined,
          ytDescription: ytDescription || undefined,
          ytGameTitle: ytGameTitle || undefined,
          ytCatchyTitle: ytCatchyTitle || undefined,
          ytSeason: ytSeason !== '1' ? ytSeason : undefined,
          ytEpisode: ytEpisode || undefined,
          ytTags: tags.length > 0 ? tags : undefined,
          twitchTitle: effectiveTwitchTitle || undefined,
          twitchGameName: twitchGameName || undefined,
          syncTitle,
        },
        date,
        mode === 'new' && !isPrevEpisode && !useBuiltinThumbnail ? (selectedTemplatePath || undefined) : undefined,
        mode === 'new' && isPrevEpisode ? (prevEpisodeFolder?.folderPath ?? undefined) : undefined,
        mode === 'new' && !isPrevEpisode && useBuiltinThumbnail ? (selectedBuiltinTemplateId || undefined) : undefined,
      )
      initialSnapshot.current = JSON.stringify({
        streamTypes, games, comments, archived, ytTitle, ytDescription, ytGameTitle,
        ytTagsText, ytSeason, ytEpisode, ytCatchyTitle, twitchTitle, twitchGameName, syncTitle,
        ytVideoId: ytVideoUnlinked ? undefined : (ytSelectedBroadcastId || initialMeta?.ytVideoId || undefined),
        preferredThumbnail: localPreferredThumbnail,
      })
      setIsDirty(false)
      setSaving(false)
      if (mode === 'new') onClose()
    } catch (e: any) {
      console.error('[YT debug] error during save:', e)
      setError(e.message)
      setSaving(false)
    }
  }

  const handlePush = async () => {
    if (!ytConnected || !ytSelectedBroadcastId) return
    setPushing(true)
    setPushError('')
    setPushSuccess(false)
    try {
      const tags = ytTagsText.split(',').map(t => t.trim()).filter(Boolean)
      if (isPastStream) {
        await window.api.youtubeUpdateVideo(ytSelectedBroadcastId, ytTitle, ytDescription, tags)
      } else {
        await window.api.youtubeUpdateBroadcast(
          ytSelectedBroadcastId,
          { title: ytTitle, description: ytDescription },
          tags
        )
      }
      if (ytSelectedThumbnail) {
        await window.api.youtubeUploadThumbnail(ytSelectedBroadcastId, ytSelectedThumbnail)
      }
      if (alsoUpdateTwitch && twConnected) {
        const effectiveTwitchTitle = syncTitle ? ytTitle : twitchTitle
        await window.api.twitchUpdateChannel(effectiveTwitchTitle, twitchGameName || undefined)
      }
      // Update the local broadcast/VOD entry so the dropdown reflects the new info
      const updater = (items: LiveBroadcast[]) => items.map(b =>
        b.id === ytSelectedBroadcastId
          ? { ...b, snippet: { ...b.snippet, title: ytTitle, description: ytDescription } }
          : b
      )
      if (isPastStream) setYtVods(updater)
      else setYtBroadcasts(updater)
      setPushSuccess(true)
      setTimeout(() => setPushSuccess(false), 4000)
    } catch (e: any) {
      setPushError(e.message)
    } finally {
      setPushing(false)
    }
  }

  const title = mode === 'new' ? 'New Stream' : mode === 'add' ? 'Add Metadata' : 'Edit Metadata'

  return (
    <Modal
      isOpen
      noOverlay
      onClose={onClose}
      title={title}
      width="2xl"
      dismissible={false}
      footer={
        <>
          {mode === 'edit' && isPastStream && (
            <div className="mr-auto flex flex-row gap-3">
              <Checkbox checked={archived} onChange={setArchived} label="Archived" color="green" />
              {archived && !initialMeta?.archived && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-950/50 border border-amber-600/30 text-xs text-amber-300/90">
                  <AlertTriangle size={13} className="shrink-0 mt-0.5 text-amber-400" />
                  <span>This marks the stream as archived. Use the <strong>Archive</strong> process for a complete archive.</span>
                </div>
              )}
            </div>
          )}
          <Button variant="ghost" onClick={onClose} className={isDirty ? 'text-red-400 hover:text-red-300' : ''}>{isDirty ? 'Cancel' : 'Close'}</Button>
          <Button variant="primary" loading={saving} onClick={handleSave} disabled={!isDirty}>
            {mode === 'new' ? 'Create Stream' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        {/* Thumbnail carousel */}
        {thumbnails.length > 0 && (
          <ThumbnailCarousel
            thumbnails={thumbnails}
            localFlags={thumbnailLocalFlags}
            thumbsKey={thumbsKey}
            preferredThumbnail={localPreferredThumbnail ?? preferredThumbnail}
            onSetAsThumbnail={onSetAsThumbnail ? (path) => {
              setLocalPreferredThumbnail(path.split(/[\\/]/).pop() ?? '')
              onSetAsThumbnail(path)
            } : undefined}
          />
        )}

        {/* Date */}
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-300">Date</label>
          {!isPastStream && mode !== 'new' ? (
            <Tooltip content='To change the date, use the "Reschedule" button in the stream item row.' side="bottom">
              <input
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                disabled
                className="w-full bg-navy-900 border border-white/10 text-gray-200 text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500/50 disabled:opacity-50 [color-scheme:dark]"
              />
            </Tooltip>
          ) : (
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              disabled={mode !== 'new'}
              className="w-full bg-navy-900 border border-white/10 text-gray-200 text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500/50 disabled:opacity-50 [color-scheme:dark]"
            />
          )}
          {mode === 'new' && date && (() => {
            const sameDayCount = allFolders.filter(f => f.date === date).length
            if (sameDayCount === 0) return null
            return (
              <p className="text-xs text-blue-400 mt-0.5">
                A stream already exists on this date. This will be created as Stream {sameDayCount + 1}.
              </p>
            )
          })()}
        </div>

        {/* Stream type */}
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium text-gray-300">Stream Type</label>
          <TagComboBox
            values={streamTypes}
            onChange={setStreamTypes}
            allOptions={allStreamTypes}
            placeholder="e.g. games, just chatting…"
            emptyLabel="No types added"
            tagColors={tagColors}
            tagTextures={tagTextures}
            onNewTag={onNewStreamType}
          />
        </div>

        {/* Topics / Games */}
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium text-gray-300">
            Topics / Games
            {detectedGames.length > 0 && !initialMeta && (
              <span className="ml-2 text-xs text-gray-500 font-normal">(auto-detected from files)</span>
            )}
          </label>
          <TagComboBox
            values={games}
            onChange={setGames}
            allOptions={allGames}
            placeholder="Type a topic or game and press Enter…"
            emptyLabel="No topics added"
            compact
          />
        </div>

        {/* Thumbnail template — new streams only */}
        {mode === 'new' && (
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium text-gray-300">Thumbnail Template</label>
            <Checkbox
              checked={useBuiltinThumbnail}
              onChange={setUseBuiltinThumbnail}
              label="Use built-in thumbnail creator"
            />
            {useBuiltinThumbnail ? (
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <select
                    value={selectedBuiltinTemplateId}
                    onChange={e => setSelectedBuiltinTemplateId(e.target.value)}
                    className="w-full appearance-none bg-navy-900 border border-white/10 text-gray-200 text-sm rounded-lg px-3 py-2 pr-8 focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                    disabled={builtinTemplates.length === 0}
                  >
                    <option value="">— None —</option>
                    {builtinTemplates.map(t => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                  <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
                </div>
                {builtinTemplates.length === 0 && (
                  <Button variant="secondary" size="sm" onClick={() => { onClose(); navigateToEditor() }}>
                    Create Template
                  </Button>
                )}
              </div>
            ) : (
              (templates.length > 0 || hasPrevThumbnails) && (
                <div className="relative">
                  <select
                    value={selectedTemplatePath}
                    onChange={e => setSelectedTemplatePath(e.target.value)}
                    className="w-full appearance-none bg-navy-900 border border-white/10 text-gray-200 text-sm rounded-lg px-3 py-2 pr-8 focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                  >
                    <option value="">— None —</option>
                    {hasPrevThumbnails && (
                      <option value={PREV_EPISODE_SENTINEL}>* Copy Previous Episode Thumbnail *</option>
                    )}
                    {templates.map(t => (
                      <option key={t.path} value={t.path}>{t.name}</option>
                    ))}
                  </select>
                  <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
                </div>
              )
            )}
          </div>
        )}

        {/* Comments */}
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-300">Comments</label>
          <textarea
            value={comments}
            onChange={e => setComments(e.target.value)}
            rows={3}
            placeholder="Notes about this stream…"
            className="w-full bg-navy-900 border border-white/10 text-gray-200 text-sm rounded-lg px-3 py-2 placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-500/50 resize-none"
          />
        </div>

        {/* ── Publishing Info ──────────────────────────────────────────────── */}
        <div className="flex flex-col gap-4 pt-1 border-t border-white/5">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Publishing Info</h3>

          {/* Merge field inputs */}
          <div className="grid grid-cols-[1fr_auto_auto_1fr] gap-2 items-start">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-400 flex items-center gap-1.5">Game Title <span className="font-mono text-purple-400 font-normal">{'{game}'}</span><LucideYoutube size={11} className="text-red-400/70" /></label>
              <input
                value={ytGameTitle}
                onChange={e => setYtGameTitle(e.target.value)}
                className="w-full bg-navy-900 border border-white/10 text-gray-200 text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-purple-500/40"
              />
              <span className="text-[10px] text-gray-500">Set manually in YouTube Studio</span>
            </div>
            <div className="flex flex-col gap-1 items-center">
              <label className="text-xs font-medium text-gray-500 whitespace-nowrap flex items-center gap-1">
                <Tooltip content="Auto-inherited from the most recent preceding stream in the same series. Change it to start a new season — episode numbering will restart from 1." side="top">
                  <Info size={11} className="text-gray-500 cursor-default" />
                </Tooltip>
                <span className="font-mono text-purple-400">{'{season}'}</span>
              </label>
              <input
                value={ytSeason}
                onChange={e => { ytSeasonUserEdited.current = true; ytEpisodeUserEdited.current = false; setYtSeason(e.target.value) }}
                className="w-10 bg-navy-900 border border-white/10 text-gray-200 text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-purple-500/40"
              />
            </div>
            <div className="flex items-end gap-1.5">
              <div className="flex flex-col gap-1 items-end">
                <label className="text-xs font-medium text-gray-500 whitespace-nowrap flex items-center gap-1">
                  <Tooltip content="Auto-detected by counting preceding streams with the same game and season. Resets to 1 when season changes. Can be overridden manually." side="top">
                    <Info size={11} className="text-gray-500 cursor-default" />
                  </Tooltip>
                  <span className="font-mono text-purple-400">{'{episode}'}</span>
                </label>
                <input
                  value={ytEpisode}
                  onChange={e => { ytEpisodeUserEdited.current = true; setYtEpisode(e.target.value) }}
                  className="w-10 bg-navy-900 border border-white/10 text-gray-200 text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-purple-500/40"
                />
              </div>
              <span className="text-gray-600 text-xs pb-1.5 shrink-0">/</span>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-gray-500 whitespace-nowrap flex items-center gap-1">
                  <span className="font-mono text-purple-400">{'{total_episodes}'}</span>
                  <Tooltip content="Total episodes in this season. Auto-counted from all streams sharing the same game and season, including this one. Can be overridden manually." side="top">
                    <Info size={11} className="text-gray-500 cursor-default" />
                  </Tooltip>
                </label>
                <input
                  value={ytTotalEpisodes}
                  onChange={e => setYtTotalEpisodes(e.target.value)}
                  className="w-10 bg-navy-900 border border-white/10 text-gray-200 text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-purple-500/40"
                />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500"><span className="font-mono text-purple-400">{'{title}'}</span></label>
              <input
                value={ytCatchyTitle}
                onChange={e => setYtCatchyTitle(e.target.value)}
                placeholder="catchy title…"
                className="w-full bg-navy-900 border border-white/10 text-gray-200 text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-purple-500/40 placeholder-gray-700"
              />
            </div>
          </div>

          {/* Title */}
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-gray-400 flex items-center gap-1.5">
                Title
                <LucideYoutube size={11} className="text-red-400/70" />
                {(!twConnected || syncTitle) && <LucideTwitch size={11} className="text-twitch-400/70" />}
                <span className="text-gray-600 font-normal">(editable)</span>
              </label>
              <div className="flex items-center gap-3">
                {twConnected && (
                  <Checkbox checked={syncTitle} onChange={setSyncTitle} label="Sync with Twitch" size="sm" />
                )}
                {canSaveTitleTemplate && <SaveAsTemplateButton onSave={saveTitleAsTemplate} />}
                <InlineTemplateSelect items={ytTitleTemplates} value={ytSelectedTitleId} onChange={setYtSelectedTitleId} />
              </div>
            </div>
            <input
              ref={titleSg.ref as React.RefObject<HTMLInputElement>}
              value={ytTitle}
              maxLength={100}
              className="w-full bg-navy-900 border border-white/10 text-gray-200 text-xs rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500/40"
              {...titleSg.props}
            />
            <div className="flex items-center justify-between min-h-[16px]">
              {claudeEnabled && titleSg.hint === 'loading' && <Loader2 size={10} className="animate-spin text-gray-600" />}
              {claudeEnabled && titleSg.hint === 'accept' && <span className="flex items-center gap-1 text-[10px] text-gray-600"><Sparkles size={9} />Tab to accept · Esc to dismiss</span>}
              {(!claudeEnabled || !titleSg.hint) && <span />}
              <p className="text-xs text-gray-500">{ytTitle.length}/100</p>
            </div>
          </div>

          {/* Separate Twitch title when not synced */}
          {twConnected && !syncTitle && (
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-400 flex items-center gap-1.5">
                Twitch title
                <LucideTwitch size={11} className="text-twitch-400/70" />
              </label>
              <input
                value={twitchTitle}
                onChange={e => setTwitchTitle(e.target.value)}
                maxLength={140}
                className="w-full bg-navy-900 border border-white/10 text-gray-200 text-xs rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500/40"
              />
              <p className="text-right text-xs text-gray-700">{twitchTitle.length}/140</p>
            </div>
          )}

          {/* Description */}
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-gray-400 flex items-center gap-1.5">
                Description
                <LucideYoutube size={11} className="text-red-400/70" />
              </label>
              <div className="flex items-center gap-3">
                {canSaveDescTemplate && <SaveAsTemplateButton onSave={saveDescAsTemplate} />}
                <InlineTemplateSelect items={ytDescTemplates} value={ytSelectedDescId} onChange={setYtSelectedDescId} />
              </div>
            </div>
            <GhostTextArea
              ref={descRef}
              value={ytDescription}
              onChange={handleDescUserChange}
              suggestion={claudeEnabled ? descSuggestion : ''}
              insertAt={descInsertAt}
              onRequestSuggestion={claudeEnabled ? handleDescRequest : undefined}
              onAccept={handleDescAccept}
              onDismiss={handleDescDismiss}
              rows={6}
              className="w-full bg-navy-900 border border-white/10 text-gray-200 text-xs rounded-lg px-3 py-2 focus:ring-2 focus:ring-purple-500/40"
            />
            <div className="flex items-center min-h-[16px]">
              {claudeEnabled && descLoading && <Loader2 size={10} className="animate-spin text-gray-600" />}
              {claudeEnabled && !descLoading && descSuggestion && <span className="flex items-center gap-1 text-[10px] text-gray-600"><Sparkles size={9} />Tab to accept · Esc to dismiss</span>}
            </div>
          </div>

          {/* Tags */}
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-gray-400 flex items-center gap-1.5">
                Tags
                <LucideYoutube size={11} className="text-red-400/70" />
                <span className="text-gray-600 font-normal">(comma-separated)</span>
              </label>
              <div className="flex items-center gap-3">
                {gameMatchedTagTemplate && (
                  <button
                    type="button"
                    onClick={() => setYtTagsText(gameMatchedTagTemplate.tags.join(', '))}
                    className="text-xs text-gray-400 hover:text-gray-200 transition-colors"
                  >
                    Use &ldquo;{gameMatchedTagTemplate.name}&rdquo; tags
                  </button>
                )}
                {canSaveTagsTemplate && <SaveAsTemplateButton onSave={saveTagsAsTemplate} />}
                <InlineTemplateSelect items={ytTagTemplates} value={ytSelectedTagId} onChange={setYtSelectedTagId} />
              </div>
            </div>
            <textarea
              ref={tagsSg.ref as React.RefObject<HTMLTextAreaElement>}
              value={ytTagsText}
              rows={2}
              className="w-full bg-navy-900 border border-white/10 text-gray-200 text-xs font-mono rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500/40 resize-none"
              {...tagsSg.props}
            />
            <div className="flex items-center justify-between min-h-[16px]">
              {claudeEnabled && tagsSg.hint === 'loading' && <Loader2 size={10} className="animate-spin text-gray-600" />}
              {claudeEnabled && tagsSg.hint === 'accept' && <span className="flex items-center gap-1 text-[10px] text-gray-600"><Sparkles size={9} />Tab to accept · Esc to dismiss</span>}
              {(!claudeEnabled || !tagsSg.hint) && <span />}
              <p className="text-xs text-gray-700">{ytTagsText.split(',').map(t => t.trim()).filter(Boolean).length} tags</p>
            </div>
          </div>

          {/* Twitch category */}
          {twConnected && (
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-400 flex items-center gap-1.5">
                Twitch category
                <LucideTwitch size={11} className="text-twitch-400/70" />
              </label>
              <input
                value={twitchGameName}
                onChange={e => setTwitchGameName(e.target.value)}
                placeholder="e.g. Elden Ring"
                className="w-full bg-navy-900 border border-white/10 text-gray-200 text-xs rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500/40 placeholder-gray-700"
              />
              <p className="text-xs text-gray-600">Searched against Twitch categories — closest match will be used.</p>
            </div>
          )}
        </div>

        {/* ── YouTube ─────────────────────────────────────────────────────── */}
        {ytConnected && (
          <div className="flex flex-col gap-3 pt-1 border-t border-white/5">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
              <LucideYoutube size={13} className="text-red-400" /> YouTube
            </h3>

            {/* Broadcast / VOD picker */}
            {!isPastStream && !isNextUpcomingStream ? (
              <p className="text-xs text-gray-500 italic">Only the next upcoming stream can be linked to a live broadcast.</p>
            ) : ytBroadcastError ? (
              <p className="text-xs text-red-400 flex items-center gap-1.5">
                <AlertTriangle size={12} className="shrink-0" />
                {ytBroadcastError}
              </p>
            ) : !isPastStream && ytBroadcasts.length === 0 && !ytBroadcastsLoading ? (
              <div className="flex flex-col gap-2">
                <p className="text-xs text-gray-500 italic">No upcoming or active broadcasts found.</p>
                <div className="flex items-center gap-2">
                  <label className="text-xs text-gray-400 shrink-0">Privacy</label>
                  <div className="relative">
                    <select
                      value={ytNewPrivacy}
                      onChange={e => setYtNewPrivacy(e.target.value as 'public' | 'unlisted' | 'private')}
                      disabled={ytCreatingBroadcast}
                      className="appearance-none bg-navy-900 border border-white/10 text-gray-200 text-xs rounded-lg pl-3 pr-7 py-1.5 focus:outline-none focus:ring-2 focus:ring-red-500/40 disabled:opacity-50"
                    >
                      <option value="public">Public</option>
                      <option value="unlisted">Unlisted</option>
                      <option value="private">Private</option>
                    </select>
                    <ChevronDown size={11} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
                  </div>
                  <Button
                    variant="primary"
                    size="sm"
                    loading={ytCreatingBroadcast}
                    onClick={async () => {
                      setYtCreatingBroadcast(true)
                      setYtCreateError('')
                      try {
                        // Use the stream's date at noon local, or now+5min if that's already past
                        const noon = new Date(`${date}T12:00:00`).getTime()
                        const future = Date.now() + 5 * 60 * 1000
                        const scheduledStartTime = new Date(Math.max(noon, future)).toISOString()
                        const created = await window.api.youtubeCreateBroadcast({
                          title: ytTitle || 'Untitled stream',
                          description: ytDescription || '',
                          scheduledStartTime,
                          privacyStatus: ytNewPrivacy,
                        })
                        setYtBroadcasts(prev => [created, ...prev])
                        setYtSelectedBroadcastId(created.id)
                        setYtVideoUnlinked(false)
                      } catch (err: any) {
                        setYtCreateError(err?.message ?? 'Failed to create broadcast')
                      } finally {
                        setYtCreatingBroadcast(false)
                      }
                    }}
                  >
                    Create broadcast
                  </Button>
                </div>
                {ytCreateError && (
                  <p className="text-xs text-red-400 flex items-center gap-1.5">
                    <AlertTriangle size={12} className="shrink-0" />
                    {ytCreateError}
                  </p>
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <label className="text-xs font-medium text-gray-400">
                  {isPastStream ? 'VOD' : 'Broadcast'}
                </label>
                <div className="flex items-center gap-1.5">
                  <div className="relative flex-1">
                    <select
                      value={ytSelectedBroadcastId}
                      onChange={e => { setYtSelectedBroadcastId(e.target.value); setYtManualUrl(''); setYtManualError('') }}
                      onMouseDown={() => isPastStream && loadAllVods()}
                      disabled={ytBroadcastsLoading}
                      className="w-full appearance-none bg-navy-900 border border-white/10 text-gray-200 text-xs rounded-lg px-3 py-2 pr-8 focus:outline-none focus:ring-2 focus:ring-red-500/40 disabled:opacity-50 disabled:cursor-wait"
                    >
                      {!ytSelectedBroadcastId && (
                        <option value="">— No video found for this date —</option>
                      )}
                      {(isPastStream ? ytVods : ytBroadcasts).map(b => {
                        const startDate = utcToLocalDate(b.snippet.actualStartTime ?? b.snippet.scheduledStartTime ?? '')
                        return (
                          <option key={b.id} value={b.id}>
                            {b.snippet.title}{isPastStream && startDate ? ` · ${startDate}` : ''}
                          </option>
                        )
                      })}
                    </select>
                    {ytBroadcastsLoading
                      ? <Loader2 size={12} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 animate-spin pointer-events-none" />
                      : <ChevronDown size={12} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
                    }
                  </div>
                  {ytSelectedBroadcastId && (
                    <button
                      type="button"
                      onClick={() => { setYtSelectedBroadcastId(''); setYtVideoUnlinked(true); setYtManualUrl(''); setYtManualError('') }}
                      className="p-1.5 rounded-lg text-gray-500 hover:text-gray-300 hover:bg-white/5 transition-colors shrink-0"
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>
                {!ytSelectedBroadcastId && (
                  <div className="flex flex-col gap-1">
                    <input
                      value={ytManualUrl}
                      onChange={e => handleManualUrlChange(e.target.value)}
                      placeholder="Paste YouTube URL or video ID to link manually…"
                      className="w-full bg-navy-900 border border-white/10 text-gray-200 text-xs rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-500/40 placeholder-gray-600"
                    />
                    {ytManualLoading && (
                      <p className="text-xs text-gray-500 flex items-center gap-1.5">
                        <Loader2 size={11} className="animate-spin shrink-0" />
                        Looking up video…
                      </p>
                    )}
                    {ytManualError && (
                      <p className="text-xs text-red-400 flex items-center gap-1.5">
                        <AlertTriangle size={11} className="shrink-0" />
                        {ytManualError}
                      </p>
                    )}
                  </div>
                )}
                {(broadcastMismatch || ytSelectedBroadcastId) && (
                  <div className="flex items-center gap-2">
                    {broadcastMismatch && (
                      <button
                        type="button"
                        onClick={applyBroadcastToMeta}
                        className="flex items-center gap-1.5 text-xs text-yellow-300 bg-yellow-500/10 border border-yellow-500/30 hover:bg-yellow-500/20 transition-colors rounded-lg px-3 py-1.5"
                      >
                        <AlertTriangle size={11} className="shrink-0" />
                        {isPastStream ? 'Update metadata to match YouTube VOD info' : 'Update metadata to match YouTube stream info'}
                      </button>
                    )}
                    {ytSelectedBroadcastId && (
                      <button
                        type="button"
                        onClick={() => window.api.openUrl(`https://studio.youtube.com/video/${ytSelectedBroadcastId}`)}
                        className="flex items-center gap-1.5 text-xs text-gray-200 bg-surface-100 border border-white/10 hover:bg-surface-200 transition-colors rounded-lg px-3 py-1.5"
                      >
                        <LucideYoutube size={11} />
                        Open in YouTube Studio
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Thumbnail picker */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-gray-400">Thumbnail to upload</label>
              {ytQualifyingThumbnails.length === 0 ? (
                <p className="text-xs text-gray-600 italic">
                  {thumbnails.length === 0
                    ? 'No images found in this stream folder.'
                    : 'No images meet YouTube\'s requirements (JPG/PNG/GIF/WebP, max 2 MB).'}
                </p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {ytQualifyingThumbnails.map(p => {
                    const isSelected = p === ytSelectedThumbnail
                    const name = p.split(/[\\/]/).pop() ?? ''
                    return (
                      <Tooltip key={p} content={name}>
                        <button
                          type="button"
                          onClick={() => setYtSelectedThumbnail(isSelected ? null : p)}
                          className={`relative w-20 h-14 rounded overflow-hidden border-2 transition-all shrink-0 ${isSelected ? 'border-red-400 ring-1 ring-red-400/50' : 'border-white/10 hover:border-white/30'}`}
                        >
                          <img src={`${toFileUrl(p)}${thumbsKey ? `?t=${thumbsKey}` : ''}`} alt={name} className="w-full h-full object-cover" />
                          {isSelected && (
                            <div className="absolute inset-0 bg-red-500/20 flex items-center justify-center">
                              <Check size={14} className="text-white drop-shadow" />
                            </div>
                          )}
                        </button>
                      </Tooltip>
                    )
                  })}
                </div>
              )}
              <p className="text-[10px] text-gray-600">Recommended: 1280×720 or larger. Uploads when you click 'Update YouTube Info'.</p>
            </div>

            {/* Push action */}
            <div className="flex flex-col gap-2">
              {pushError && (
                <p className="text-xs text-red-400 flex items-center gap-1.5">
                  <AlertTriangle size={12} className="shrink-0" />
                  {pushError}
                </p>
              )}
              {pushSuccess && (
                <p className="text-xs text-green-400 flex items-center gap-1.5">
                  <CheckCircle2 size={12} className="shrink-0" />
                  {isPastStream ? 'YouTube VOD updated.' : 'YouTube stream info updated.'}
                  {alsoUpdateTwitch && twConnected && ' Twitch updated too.'}
                </p>
              )}
              <div className="flex items-center gap-3 flex-wrap">
                <Button
                  variant="primary"
                  icon={pushing ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                  onClick={handlePush}
                  disabled={!ytSelectedBroadcastId || pushing}
                >
                  {pushing ? 'Updating…' : 'Update YouTube Info'}
                </Button>
                {twConnected && (
                  <Checkbox
                    checked={alsoUpdateTwitch}
                    onChange={setAlsoUpdateTwitch}
                    label="Also update Twitch"
                    size="sm"
                  />
                )}
              </div>
            </div>
          </div>
        )}

        {error && <p className="text-xs text-red-400">{error}</p>}
      </div>
    </Modal>
  )
}

// ─── Preset picker modal ─────────────────────────────────────────────────────

interface PresetPickerProps {
  onPick: (preset: ConversionPreset, setAsDefault: boolean) => void
  onClose: () => void
}

function PresetPickerModal({ onPick, onClose }: PresetPickerProps) {
  const [presets, setPresets] = useState<ConversionPreset[]>([])
  const [selected, setSelected] = useState<string>('')
  const [setAsDefault, setSetAsDefault] = useState(true)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([window.api.getBuiltinPresets(), window.api.getImportedPresets()])
      .then(([builtin, imported]) => {
        const all = [...builtin, ...imported]
        setPresets(all)
        if (all.length > 0) setSelected(all[0].id)
        setLoading(false)
      })
  }, [])

  const confirm = () => {
    const preset = presets.find(p => p.id === selected)
    if (preset) onPick(preset, setAsDefault)
  }

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Choose Archive Preset"
      width="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={confirm} disabled={!selected || loading}>
            Archive
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-gray-400">No default archive preset is set. Choose which converter preset to use for compression.</p>
        {loading ? (
          <div className="flex items-center gap-2 text-gray-500 text-sm"><Loader2 size={14} className="animate-spin" /> Loading presets…</div>
        ) : presets.length === 0 ? (
          <p className="text-sm text-yellow-600">No presets found. Configure your presets directory in Settings first.</p>
        ) : (
          <div className="relative">
            <select
              value={selected}
              onChange={e => setSelected(e.target.value)}
              className="w-full appearance-none bg-navy-900 border border-white/10 text-gray-200 text-sm rounded-lg px-3 py-2 pr-8 focus:outline-none focus:ring-2 focus:ring-purple-500/50"
            >
              {presets.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
          </div>
        )}
        <Checkbox checked={setAsDefault} onChange={setSetAsDefault} label="Save as default archive preset" />
      </div>
    </Modal>
  )
}

// ─── Archive progress modal ───────────────────────────────────────────────────

interface FolderArchiveStatus {
  folderPath: string
  folderName: string
  phase: 'queued' | 'converting' | 'replacing' | 'done' | 'error'
  percent: number
  currentFile: string
  fileIndex: number
  fileCount: number
  error?: string
}

interface ArchiveProgressModalProps {
  statuses: FolderArchiveStatus[]
  onCancel: () => void
  onClose: () => void
  done: boolean
}

function ArchiveProgressModal({ statuses, onCancel, onClose, done }: ArchiveProgressModalProps) {
  const total = statuses.length
  const doneCount = statuses.filter(s => s.phase === 'done').length
  const errorCount = statuses.filter(s => s.phase === 'error').length

  return (
    <Modal
      isOpen
      onClose={done ? onClose : () => {}}
      title={done ? 'Archive Complete' : 'Archiving Streams…'}
      width="md"
      footer={
        done ? (
          <Button variant="primary" onClick={onClose}>Close</Button>
        ) : (
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        )
      }
    >
      <div className="flex flex-col gap-3">
        {!done && (
          <div className="flex items-center gap-2 text-sm text-gray-400">
            <Loader2 size={14} className="animate-spin text-purple-400" />
            Processing {doneCount + errorCount + 1} of {total}…
          </div>
        )}
        {done && (
          <div className="text-sm text-gray-400">
            {doneCount} archived{errorCount > 0 ? `, ${errorCount} failed` : ''}.
          </div>
        )}
        <div className="flex flex-col gap-2 max-h-64 overflow-y-auto">
          {statuses.map(s => (
            <div key={s.folderPath} className="flex flex-col gap-1 p-2 rounded-lg bg-white/5">
              <div className="flex items-center gap-2">
                {s.phase === 'done' && <CheckCircle2 size={14} className="text-green-400 shrink-0" />}
                {s.phase === 'error' && <XCircle size={14} className="text-red-400 shrink-0" />}
                {(s.phase === 'converting' || s.phase === 'replacing') && <Loader2 size={14} className="animate-spin text-purple-400 shrink-0" />}
                {s.phase === 'queued' && <Square size={14} className="text-gray-600 shrink-0" />}
                <span className="text-sm text-gray-200 font-mono">{s.folderName}</span>
                {s.phase !== 'queued' && s.fileCount > 0 && (
                  <span className="text-xs text-gray-600 ml-auto">
                    {s.fileIndex + 1}/{s.fileCount}
                  </span>
                )}
              </div>
              {s.phase === 'converting' && (
                <>
                  <div className="text-xs text-gray-500 truncate pl-5">{s.currentFile}</div>
                  <div className="pl-5">
                    <div className="h-1 bg-white/10 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-purple-500 rounded-full transition-all duration-300"
                        style={{ width: `${s.percent}%` }}
                      />
                    </div>
                  </div>
                </>
              )}
              {s.phase === 'replacing' && (
                <div className="text-xs text-gray-500 pl-5">Replacing original…</div>
              )}
              {s.phase === 'error' && s.error && (
                <div className="text-xs text-red-400 pl-5">{s.error}</div>
              )}
            </div>
          ))}
        </div>
      </div>
    </Modal>
  )
}

// ─── Inline template select ───────────────────────────────────────────────────

function InlineTemplateSelect<T extends { id: string; name: string }>({
  items,
  value,
  onChange,
  placeholder = 'Template…',
}: {
  items: T[]
  value: string
  onChange: (id: string) => void
  placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const selected = items.find(t => t.id === value)

  const close = () => setOpen(false)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      const target = e.target as Node
      if (
        anchorRef.current && !anchorRef.current.contains(target) &&
        dropdownRef.current && !dropdownRef.current.contains(target)
      ) close()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const rect = anchorRef.current?.getBoundingClientRect()

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 transition-colors focus:outline-none"
      >
        <span>{selected ? selected.name : placeholder}</span>
        <ChevronDown size={10} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && rect && ReactDOM.createPortal(
        <div
          ref={dropdownRef}
          style={{ position: 'fixed', top: rect.bottom + 4, right: window.innerWidth - rect.right, zIndex: 9999, minWidth: 160 }}
          className="bg-navy-700 border border-white/10 rounded-lg shadow-xl overflow-hidden"
          onMouseDown={e => e.preventDefault()}
        >
          {value && (
            <button
              className="w-full text-left px-3 py-2 text-xs text-gray-500 hover:bg-white/5 transition-colors border-b border-white/5"
              onClick={() => { onChange(''); close() }}
            >
              — Clear —
            </button>
          )}
          {items.length === 0 && (
            <p className="px-3 py-2 text-xs text-gray-600 italic">No templates</p>
          )}
          {items.map(t => (
            <button
              key={t.id}
              className={`w-full text-left px-3 py-2 text-xs transition-colors ${
                t.id === value ? 'text-purple-300 bg-purple-600/20' : 'text-gray-300 hover:bg-white/5'
              }`}
              onClick={() => { onChange(t.id); close() }}
            >
              {t.name}
            </button>
          ))}
        </div>,
        document.body
      )}
    </>
  )
}

/** Inline "Save as template" text-link that expands into a name input with save/cancel. */
function SaveAsTemplateButton({ onSave }: { onSave: (name: string) => Promise<void> | void }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  const cancel = () => { setEditing(false); setName('') }
  const save = async () => {
    const trimmed = name.trim()
    if (!trimmed || saving) return
    setSaving(true)
    try { await onSave(trimmed); setEditing(false); setName('') }
    finally { setSaving(false) }
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="text-xs text-gray-400 hover:text-gray-200 transition-colors"
      >
        Save as template
      </button>
    )
  }

  return (
    <div className="flex items-center gap-1">
      <input
        ref={inputRef}
        value={name}
        onChange={e => setName(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); save() }
          else if (e.key === 'Escape') { e.preventDefault(); cancel() }
        }}
        placeholder="Template name…"
        className="text-xs bg-navy-900 border border-white/10 text-gray-200 rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-purple-500/40 w-32"
      />
      <button
        type="button"
        onClick={save}
        disabled={!name.trim() || saving}
        className="p-0.5 text-green-400 hover:text-green-300 disabled:text-gray-600 disabled:cursor-default transition-colors"
        title="Save"
      >
        <Check size={12} />
      </button>
      <button
        type="button"
        onClick={cancel}
        className="p-0.5 text-gray-500 hover:text-gray-300 transition-colors"
        title="Cancel"
      >
        <X size={12} />
      </button>
    </div>
  )
}

// ─── Bulk tag modal ───────────────────────────────────────────────────────────

function BulkTagModal({
  count,
  allStreamTypes,
  allGames,
  presentStreamTypes,
  presentGames,
  tagColors,
  onNewStreamType,
  onApply,
  onClose,
}: {
  count: number
  allStreamTypes: string[]
  allGames: string[]
  presentStreamTypes: string[]
  presentGames: string[]
  tagColors: Record<string, string>
  onNewStreamType: (tag: string) => void
  onApply: (mode: 'add' | 'remove', streamTypes: string[], games: string[], onProgress: (done: number) => void) => void
  onClose: () => void
}) {
  const [mode, setMode] = useState<'add' | 'remove'>('add')
  const [streamTypes, setStreamTypes] = useState<string[]>([])
  const [games, setGames] = useState<string[]>([])
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)

  const switchMode = (next: 'add' | 'remove') => {
    setMode(next)
    setStreamTypes([])
    setGames([])
  }

  const canApply = (streamTypes.length > 0 || games.length > 0) && !progress
  const isRemoving = mode === 'remove'

  const handleApply = () => {
    setProgress({ done: 0, total: count })
    onApply(mode, streamTypes, games, (done) => setProgress({ done, total: count }))
  }

  const pct = progress ? Math.round((progress.done / progress.total) * 100) : 0

  return (
    <Modal
      isOpen
      onClose={progress ? () => {} : onClose}
      title={`Edit Tags — ${count} stream${count !== 1 ? 's' : ''}`}
      width="sm"
      footer={
        progress ? (
          <div className="flex flex-col gap-2 w-full">
            <div className="w-full bg-white/5 rounded-full h-1.5 overflow-hidden">
              <div
                className="bg-purple-500 h-full rounded-full transition-all duration-150"
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="text-xs text-gray-400 text-center">
              {progress.done} / {progress.total} streams updated…
            </p>
          </div>
        ) : (
          <div className="flex gap-2 justify-end w-full">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button
              variant="primary"
              icon={<Tags size={13} />}
              onClick={handleApply}
              disabled={!canApply}
            >
              {isRemoving ? 'Remove from' : 'Add to'} {count}
            </Button>
          </div>
        )
      }
    >
      <div className="flex flex-col gap-5">
        {/* Mode toggle */}
        {!progress && (
          <div className="flex rounded-lg overflow-hidden border border-white/10 self-start">
            <button
              onClick={() => switchMode('add')}
              className={`px-4 py-1.5 text-xs font-medium transition-colors ${mode === 'add' ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'}`}
            >
              Add Tags
            </button>
            <button
              onClick={() => switchMode('remove')}
              className={`px-4 py-1.5 text-xs font-medium transition-colors border-l border-white/10 ${mode === 'remove' ? 'bg-red-700/70 text-white' : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'}`}
            >
              Remove Tags
            </button>
          </div>
        )}
        {!progress && (
          <p className="text-xs text-gray-500 -mt-2">
            {isRemoving
              ? <>Selected tags will be <span className="text-red-400">removed from</span> each stream's existing tags.</>
              : <>Selected tags will be <span className="text-gray-300">added to</span> each stream's existing tags.</>
            }
          </p>
        )}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-gray-400 uppercase tracking-wide">Stream Types</label>
          <TagComboBox
            values={streamTypes}
            onChange={progress ? () => {} : setStreamTypes}
            allOptions={isRemoving ? presentStreamTypes : allStreamTypes}
            placeholder={isRemoving ? 'Select tags to remove…' : 'Type to search or add…'}
            emptyLabel="No stream types selected"
            tagColors={tagColors}
            onNewTag={isRemoving ? undefined : onNewStreamType}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-gray-400 uppercase tracking-wide">Topics / Games</label>
          <TagComboBox
            values={games}
            onChange={progress ? () => {} : setGames}
            allOptions={isRemoving ? presentGames : allGames}
            placeholder={isRemoving ? 'Select topics to remove…' : 'Type to search or add…'}
            emptyLabel="No topics selected"
            compact
          />
        </div>
      </div>
    </Modal>
  )
}

// ─── Cloud download modal ─────────────────────────────────────────────────────

function CloudDownloadModal({
  fileName,
  filePath,
  stage,
  onConfirm,
  onCancel,
}: {
  fileName: string
  filePath: string
  stage: 'confirm' | 'downloading'
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <Modal
      isOpen
      onClose={onCancel}
      title="File Not Available Locally"
      width="sm"
      footer={
        stage === 'confirm' ? (
          <div className="flex gap-2 justify-end w-full">
            <Button variant="ghost" onClick={onCancel}>Dismiss</Button>
            <Button variant="primary" icon={<CloudOff size={13} />} onClick={onConfirm}>
              Download
            </Button>
          </div>
        ) : (
          <div className="flex gap-2 justify-end w-full">
            <Button variant="ghost" onClick={onCancel}>Cancel Download</Button>
          </div>
        )
      }
    >
      {stage === 'confirm' ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-gray-300">
            <span className="font-medium text-gray-100">{fileName}</span> is stored in cloud storage and is not available on this device.
          </p>
          <p className="text-sm text-gray-400">
            Download it now? The file will be sent to the player automatically once it's ready.
          </p>
          <p className="text-xs text-gray-600 font-mono truncate" title={filePath}>{filePath}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <Loader2 size={16} className="shrink-0 text-purple-400 animate-spin" />
            <p className="text-sm text-gray-300">
              Downloading <span className="font-medium text-gray-100">{fileName}</span>…
            </p>
          </div>
          <p className="text-xs text-gray-500">
            The file will be sent automatically once the download is complete.
          </p>
        </div>
      )}
    </Modal>
  )
}

// ─── Video picker modal ───────────────────────────────────────────────────────

function VideoPickerModal({
  files,
  action,
  offlineFiles,
  onPick,
  onPickAll,
  onClose,
}: {
  files: string[]
  action: 'player' | 'converter' | 'combine'
  offlineFiles?: Set<string>
  onPick: (file: string) => void
  onPickAll?: (files: string[]) => void
  onClose: () => void
}) {
  const isCombine = action === 'combine'
  const title = isCombine ? 'Send to Combine' : `Send to ${action === 'player' ? 'Player' : 'Converter'}`
  const localFiles = offlineFiles ? files.filter(f => !offlineFiles.has(f)) : files

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={title}
      width="sm"
      footer={
        <div className="flex gap-2 justify-end w-full">
          {isCombine && onPickAll && (
            <Button variant="primary" icon={<Combine size={13} />} onClick={() => { onPickAll(localFiles); onClose() }}>
              Combine All
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
        </div>
      }
    >
      <div className="flex flex-col gap-1">
        <p className="text-xs text-gray-500 mb-2">
          {isCombine ? 'Multiple video files found — combine all or pick one:' : 'Multiple video files found — choose one:'}
        </p>
        {files.map(f => {
          const name = f.split(/[\\/]/).pop() ?? f
          const isOffline = offlineFiles?.has(f) ?? false
          return isOffline ? (
            <div
              key={f}
              className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg border border-white/5 opacity-50 cursor-not-allowed"
              title="Not available locally — sync from cloud first"
            >
              <CloudOff size={13} className="text-gray-600 shrink-0" />
              <span className="text-sm text-gray-500 font-mono truncate">{name}</span>
              <span className="ml-auto text-[10px] text-gray-600 shrink-0">cloud only</span>
            </div>
          ) : (
            <button
              key={f}
              onClick={() => { onPick(f); onClose() }}
              className="w-full text-left px-3 py-2.5 rounded-lg text-sm text-gray-200 hover:bg-purple-600/20 hover:text-purple-200 border border-transparent hover:border-purple-600/30 transition-colors font-mono truncate"
              title={f}
            >
              {name}
            </button>
          )
        })}
      </div>
    </Modal>
  )
}

// ─── Main page ───────────────────────────────────────────────────────────────

type ModalState =
  | { mode: 'none' }
  | { mode: 'new' }
  | { mode: 'edit'; folder: StreamFolder }
  | { mode: 'add'; folder: StreamFolder }

interface TreeNode {
  name: string
  isDirectory: boolean
  children?: TreeNode[]
}

async function buildTree(dirPath: string): Promise<TreeNode[]> {
  try {
    const entries = await window.api.listFileNames(dirPath)
    const nodes = await Promise.all(
      entries.map(async (e): Promise<TreeNode> => {
        if (e.isDirectory) {
          return { name: e.name, isDirectory: true, children: await buildTree(`${dirPath}/${e.name}`) }
        }
        return { name: e.name, isDirectory: false }
      })
    )
    return nodes.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
      return a.name.localeCompare(b.name)
    })
  } catch {
    return []
  }
}

export function StreamsPage({
  isVisible: _isVisible,
  onSendToPlayer,
  onSendToConverter,
  onSendToCombine,
}: {
  isVisible: boolean
  onSendToPlayer: (file: string) => void
  onSendToConverter: (file: string) => void
  onSendToCombine: (files: string[]) => void
}) {
  const { config, updateConfig, loading: configLoading } = useStore()

  const MIN_THUMB_WIDTH = 85
  const MAX_THUMB_WIDTH = 170
  const [thumbWidth, setThumbWidth] = useState(() => config.listThumbWidth ?? MIN_THUMB_WIDTH)
  const dragThumbWidthRef = useRef(thumbWidth)
  const listScrollRef = useRef<HTMLDivElement>(null)
  const dragThumbElRef = useRef<HTMLElement | null>(null)
  const dragStartThumbTopRef = useRef<number>(0)
  useLayoutEffect(() => {
    const thumbEl = dragThumbElRef.current
    const scrollEl = listScrollRef.current
    if (!thumbEl || !scrollEl) return
    const drift = thumbEl.getBoundingClientRect().top - dragStartThumbTopRef.current
    if (Math.abs(drift) > 0.1) scrollEl.scrollTop += drift
  })
  const startThumbResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startWidth = dragThumbWidthRef.current
    // Store the dragged element and its current visual top — useLayoutEffect corrects drift after each render
    const thumbEl = (e.currentTarget as HTMLElement).closest('td') as HTMLElement | null
    dragThumbElRef.current = thumbEl
    dragStartThumbTopRef.current = thumbEl?.getBoundingClientRect().top ?? 0
    const onMove = (me: MouseEvent) => {
      const newWidth = Math.round(Math.max(MIN_THUMB_WIDTH, Math.min(MAX_THUMB_WIDTH, startWidth + me.clientX - startX)))
      dragThumbWidthRef.current = newWidth
      setThumbWidth(newWidth)
    }
    const onUp = () => {
      dragThumbElRef.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      updateConfig({ listThumbWidth: dragThumbWidthRef.current })
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [updateConfig])

  const osReducedMotion = useReducedMotion()
  const noAnimation = osReducedMotion || !!config.disableAnimations
  const animMult = config.slowAnimations ? 5 : 1
  const panelAnimate = { opacity: 1, y: 0, transition: { duration: 0.22 * animMult, ease: 'easeOut' as const } }
  const { openEditor: openThumbnailEditor } = useThumbnailEditor()
  const [folders, setFolders] = useState<StreamFolder[]>([])
  const suppressNextReload = useRef(false)
  const [thumbsKey, setThumbsKey] = useState(() => Date.now())
  const [loading, setLoading] = useState(false)
  const [modal, setModal] = useState<ModalState>({ mode: 'none' })
  const [slideDirection, setSlideDirection] = useState<'up' | 'down' | null>(null)
  const [showManageTags, setShowManageTags] = useState(false)
  const [showTemplatesModal, setShowTemplatesModal] = useState(false)
  const [tagColors, setTagColors] = useState<Record<string, string>>({})
  const [tagTextures, setTagTextures] = useState<Record<string, string>>({})
  const [lightbox, setLightbox] = useState<{ thumbnails: string[]; localFlags?: boolean[]; index: number; folderPath: string; folderDate: string; preferredThumbnail: string | undefined } | null>(null)

  // ── YouTube live detection ─────────────────────────────────────────────────
  const [ytConnectedOuter, setYtConnectedOuter] = useState(false)
  const [ytIsLive, setYtIsLive] = useState(false)
  const [ytPrivacyMap, setYtPrivacyMap] = useState<Record<string, string>>({})

  useEffect(() => {
    window.api.youtubeGetStatus().then((s: { connected: boolean }) => setYtConnectedOuter(s.connected)).catch(() => {})
  }, [])

  // Startup warning: archive preset configured but missing
  const [archivePresetWarning, setArchivePresetWarning] = useState(false)

  // Orphan (missing folder) handling
  const [orphanConfirmOpen, setOrphanConfirmOpen] = useState(false)
  const [orphanDismissed, setOrphanDismissed] = useState(false)

  // Delete confirmation
  const [rescheduleTarget, setRescheduleTarget] = useState<StreamFolder | null>(null)
  const [rescheduleDate, setRescheduleDate] = useState('')
  const [reschedulePreview, setReschedulePreview] = useState<{ conflictExists: boolean; filesToRename: { oldName: string; newName: string }[] } | null>(null)
  const [rescheduleLoading, setRescheduleLoading] = useState(false)
  const [rescheduling, setRescheduling] = useState(false)

  useEffect(() => {
    if (!rescheduleTarget || !rescheduleDate || rescheduleDate === rescheduleTarget.date) {
      setReschedulePreview(null)
      return
    }
    setRescheduleLoading(true)
    window.api.previewReschedule(rescheduleTarget.folderPath, rescheduleDate)
      .then(setReschedulePreview)
      .finally(() => setRescheduleLoading(false))
  }, [rescheduleTarget, rescheduleDate])

  const [deleteTarget, setDeleteTarget] = useState<StreamFolder | null>(null)
  const [deleteTree, setDeleteTree] = useState<TreeNode[]>([])
  const [deleteFileList, setDeleteFileList] = useState<string[]>([])

  useEffect(() => {
    if (!deleteTarget) { setDeleteTree([]); setDeleteFileList([]); return }
    if (isDumpMode) {
      window.api.listFilesForDate(deleteTarget.folderPath, deleteTarget.date).then(setDeleteFileList)
    } else {
      buildTree(deleteTarget.folderPath).then(setDeleteTree)
    }
  }, [deleteTarget])

  useEffect(() => {
    window.api.getStreamTypeTags().then(setTagColors)
    window.api.getStreamTypeTextures().then(setTagTextures)
  }, [])

  const saveTagColors = useCallback((updated: Record<string, string>) => {
    setTagColors(updated)
    window.api.setStreamTypeTags(updated)
  }, [])

  const saveTagTextures = useCallback((updated: Record<string, string>) => {
    setTagTextures(updated)
    window.api.setStreamTypeTextures(updated)
  }, [])

  useEffect(() => {
    if (configLoading || !config.archivePresetId) return
    Promise.all([window.api.getBuiltinPresets(), window.api.getImportedPresets()])
      .then(([builtin, imported]) => {
        const all = [...builtin, ...imported]
        setArchivePresetWarning(!all.some((p: ConversionPreset) => p.id === config.archivePresetId))
      })
  }, [configLoading, config.archivePresetId])

  // Select mode
  const [selectMode, setSelectMode] = useState(false)
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set())
  const lastClickedIndex = useRef<number | null>(null)
  const lastClickedAction = useRef<'add' | 'remove'>('add')
  const [showBulkTag, setShowBulkTag] = useState(false)

  // Drag-to-select
  const isDragging = useRef(false)
  const dragStartIndex = useRef<number | null>(null)
  const dragAction = useRef<'add' | 'remove'>('add')
  const preDragPaths = useRef<Set<string>>(new Set())
  const dragMoved = useRef(false)

  // Archive
  const [showPresetPicker, setShowPresetPicker] = useState(false)
  const [archiveStatuses, setArchiveStatuses] = useState<FolderArchiveStatus[] | null>(null)
  const [archiveDone, setArchiveDone] = useState(false)

  const [templates, setTemplates] = useState<{ name: string; path: string }[]>([])
  const [builtinTemplates, setBuiltinTemplates] = useState<ThumbnailTemplate[]>([])

  const streamsDir = config.streamsDir
  const streamMode = config.streamMode || 'folder-per-stream'
  const isDumpMode = streamMode === 'dump-folder'

  const loadFolders = useCallback(async (dir: string) => {
    if (!dir) return
    setLoading(true)
    try {
      const result = await window.api.listStreams(dir, streamMode as any)
      setFolders(result)
      setThumbsKey(Date.now())
      const hasMissing = result.some(f => f.isMissing)
      if (hasMissing) {
        setOrphanDismissed(prev => {
          if (!prev) setOrphanConfirmOpen(true)
          return prev
        })
      } else {
        setOrphanDismissed(false)
        setOrphanConfirmOpen(false)
      }
    } catch (_) {}
    setLoading(false)
  }, [streamMode]) // eslint-disable-line react-hooks/exhaustive-deps

  // Only re-run when streamsDir or streamMode changes.
  useEffect(() => {
    if (!streamsDir) return
    loadFolders(streamsDir)
    window.api.listStreamTemplates(streamsDir).then(setTemplates)
    window.api.thumbnailListTemplates(streamsDir).then(setBuiltinTemplates).catch(() => setBuiltinTemplates([]))
    window.api.watchStreamsDir(streamsDir, streamMode as any)
    return () => { window.api.unwatchStreamsDir() }
  }, [streamsDir]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-refresh when external changes are detected in the streams directory
  useEffect(() => {
    const unsub = window.api.onStreamsChanged(() => {
      if (suppressNextReload.current) { suppressNextReload.current = false; return }
      loadFolders(streamsDir)
    })
    return unsub
  }, [streamsDir, loadFolders])

  // Archive progress listener
  useEffect(() => {
    const unsub = window.api.onArchiveProgress((data: any) => {
      setArchiveStatuses(prev => {
        if (!prev) return prev
        return prev.map(s => {
          if (s.folderPath !== data.folderPath) return s
          return {
            ...s,
            phase: data.phase,
            percent: data.percent,
            currentFile: data.fileName,
            fileIndex: data.fileIndex,
            fileCount: data.fileCount,
            error: data.error,
          }
        })
      })
    })
    return unsub
  }, [])

  // Cloud download completion listener
  useEffect(() => {
    const unsub = window.api.onCloudDownloadDone((filePath: string) => {
      setCloudDownload(prev => {
        if (!prev || prev.filePath !== filePath) return prev
        const { action } = prev
        if (action === 'player') onSendToPlayer(filePath)
        else if (action === 'converter') onSendToConverter(filePath)
        else onSendToCombine([filePath])
        return null
      })
    })
    return unsub
  }, [onSendToPlayer, onSendToConverter, onSendToCombine])

  const pickDir = async () => {
    const dir = await window.api.openDirectoryDialog()
    if (!dir) return
    await updateConfig({ streamsDir: dir })
    loadFolders(dir) // immediate load without waiting for effect
  }

  const [viewMode, setViewMode] = useState<'list' | 'grid'>(
    () => (localStorage.getItem('streamsViewMode') as 'list' | 'grid') ?? 'list'
  )
  const [videoPicker, setVideoPicker] = useState<{ files: string[]; action: 'player' | 'converter' | 'combine'; offlineFiles?: Set<string> } | null>(null)
  const [cloudDownload, setCloudDownload] = useState<{
    filePath: string
    fileName: string
    action: 'player' | 'converter' | 'combine'
    stage: 'confirm' | 'downloading'
  } | null>(null)

  const VIDEO_EXTS_RENDERER = new Set([
    '.mkv', '.mp4', '.mov', '.avi', '.ts', '.flv', '.webm',
    '.wmv', '.m4v', '.mpg', '.mpeg', '.m2ts', '.mts', '.vob',
    '.divx', '.3gp', '.ogv', '.asf', '.rmvb', '.f4v', '.hevc'
  ])

  const getVideosForFolder = async (folder: StreamFolder): Promise<string[]> => {
    // Main's listStreams already walks the stream folder recursively (handles
    // sub-org layouts like clips/, recordings/, exports/). Just reuse that list
    // — listFiles is non-recursive and would miss files in sub-folders.
    return folder.videos
  }

  const sendVideo = async (folder: StreamFolder, action: 'player' | 'converter') => {
    const videos = await getVideosForFolder(folder)
    if (videos.length === 0) return
    // Check which files are actually present on disk (not just cloud placeholders)
    const localFlags = await window.api.checkLocalFiles(videos)
    const localVideos = videos.filter((_, i) => localFlags[i])
    if (localVideos.length === 0) {
      const filePath = videos[0]
      setCloudDownload({ filePath, fileName: filePath.split(/[\\/]/).pop() ?? 'video file', action, stage: 'confirm' })
      return
    }
    // Player has a built-in Session Videos panel that lets users switch between videos in the
    // same folder, so we don't need a picker modal — just open the first available video.
    if (action === 'player') {
      onSendToPlayer(localVideos[0])
      return
    }
    if (localVideos.length === 1) {
      onSendToConverter(localVideos[0])
    } else {
      // Pass all files + offline set so the picker can mark unavailable ones
      const offline = new Set(videos.filter((_, i) => !localFlags[i]))
      setVideoPicker({ files: videos, action, offlineFiles: offline })
    }
  }

  const sendToCombine = async (folder: StreamFolder) => {
    const videos = await getVideosForFolder(folder)
    if (videos.length === 0) return
    const localFlags = await window.api.checkLocalFiles(videos)
    const localVideos = videos.filter((_, i) => localFlags[i])
    if (localVideos.length === 0) {
      const filePath = videos[0]
      setCloudDownload({ filePath, fileName: filePath.split(/[\\/]/).pop() ?? 'video file', action: 'combine', stage: 'confirm' })
      return
    }
    if (localVideos.length === 1) {
      onSendToCombine(localVideos)
    } else {
      const offline = new Set(videos.filter((_, i) => !localFlags[i]))
      setVideoPicker({ files: videos, action: 'combine', offlineFiles: offline })
    }
  }



  const toggleSelectMode = () => {
    setSelectMode(m => !m)
    setSelectedPaths(new Set())
    lastClickedIndex.current = null
  }

  const toggleSelected = (key: string, shiftKey: boolean, index: number) => {
    setSelectedPaths(prev => {
      const next = new Set(prev)
      if (shiftKey && lastClickedIndex.current !== null) {
        const start = Math.min(lastClickedIndex.current, index)
        const end = Math.max(lastClickedIndex.current, index)
        for (let i = start; i <= end; i++) {
          const f = filteredFolders[i]
          const k = f ? selectionKey(f) : undefined
          if (k) lastClickedAction.current === 'add' ? next.add(k) : next.delete(k)
        }
      } else {
        const wasSelected = next.has(key)
        wasSelected ? next.delete(key) : next.add(key)
        lastClickedAction.current = wasSelected ? 'remove' : 'add'
        lastClickedIndex.current = index
      }
      return next
    })
  }

  const selectionKey = (f: StreamFolder) => isDumpMode ? f.date : f.folderPath

  const selectAll = () => setSelectedPaths(new Set(filteredFolders.map(selectionKey)))
  const clearSelection = () => { setSelectedPaths(new Set()); lastClickedIndex.current = null }

  const startDrag = (index: number) => {
    const key = selectionKey(filteredFolders[index])
    isDragging.current = true
    dragStartIndex.current = index
    dragAction.current = selectedPaths.has(key) ? 'remove' : 'add'
    preDragPaths.current = new Set(selectedPaths)
    dragMoved.current = false
  }

  const updateDrag = (index: number) => {
    if (!isDragging.current || dragStartIndex.current === null) return
    dragMoved.current = true
    const start = Math.min(dragStartIndex.current, index)
    const end = Math.max(dragStartIndex.current, index)
    setSelectedPaths(() => {
      const next = new Set(preDragPaths.current)
      for (let i = start; i <= end; i++) {
        const f = filteredFolders[i]
        if (!f) continue
        dragAction.current === 'add' ? next.add(selectionKey(f)) : next.delete(selectionKey(f))
      }
      return next
    })
  }

  useEffect(() => {
    const handler = () => { isDragging.current = false }
    document.addEventListener('mouseup', handler)
    return () => document.removeEventListener('mouseup', handler)
  }, [])

  const startArchive = async (preset: ConversionPreset, setAsDefault: boolean) => {
    if (setAsDefault) await updateConfig({ archivePresetId: preset.id })
    setShowPresetPicker(false)

    const selectedFolders = folders.filter(f => selectedPaths.has(f.folderPath) || selectedPaths.has(f.date))

    const sessions = selectedFolders.map(f => isDumpMode
      ? { folderPath: f.folderPath, date: f.date, filePaths: f.videos }
      : { folderPath: f.folderPath, date: f.date }
    )

    const initialStatuses: FolderArchiveStatus[] = sessions.map(s => ({
      folderPath: s.folderPath,
      folderName: s.date,
      phase: 'queued',
      percent: 0,
      currentFile: '',
      fileIndex: 0,
      fileCount: 0,
    }))
    setArchiveStatuses(initialStatuses)
    setArchiveDone(false)

    await window.api.archiveFolders(sessions, preset)

    setArchiveDone(true)
    await loadFolders(streamsDir)
  }

  const clickArchive = async () => {
    if (selectedPaths.size === 0) return
    if (config.archivePresetId) {
      const [builtin, imported] = await Promise.all([window.api.getBuiltinPresets(), window.api.getImportedPresets()])
      const preset = [...builtin, ...imported].find((p: ConversionPreset) => p.id === config.archivePresetId)
      if (preset) { startArchive(preset, false); return }
    }
    setShowPresetPicker(true)
  }

  const handleBulkEditTags = async (
    mode: 'add' | 'remove',
    editStreamTypes: string[],
    editGames: string[],
    onProgress: (done: number) => void
  ) => {
    const selectedFolders = folders.filter(f => selectedPaths.has(selectionKey(f)))
    const removing = new Set(editStreamTypes)
    const removingGames = new Set(editGames)
    let done = 0
    for (const f of selectedFolders) {
      const existing = folderMetaBase(f)
      const merged: StreamMeta = mode === 'add'
        ? {
            ...existing,
            streamType: Array.from(new Set([...normalizeStreamTypes(existing.streamType), ...editStreamTypes])),
            games: Array.from(new Set([...(existing.games ?? []), ...editGames])),
          }
        : {
            ...existing,
            streamType: normalizeStreamTypes(existing.streamType).filter(t => !removing.has(t)),
            games: (existing.games ?? []).filter(g => !removingGames.has(g)),
          }
      await window.api.writeStreamMeta(f.folderPath, merged, f.relativePath)
      onProgress(++done)
    }
    setShowBulkTag(false)
    await loadFolders(streamsDir)
  }

  const updateFolderMeta = useCallback(async (folder: StreamFolder, meta: StreamMeta) => {
    // Pass the canonical relativePath as the meta key. Required in dump mode
    // where every folder shares folderPath = the dump dir; without this,
    // all writes would overwrite the same entry.
    await window.api.writeStreamMeta(folder.folderPath, meta, folder.relativePath)
    suppressNextReload.current = true
    setFolders(prev => prev.map(f => {
      if (f.relativePath !== folder.relativePath) return f
      // If preferredThumbnail changed, optimistically reorder the thumbnails array so the
      // visible thumbnail updates immediately without waiting for a full reload.
      let thumbnails = f.thumbnails
      if (meta.preferredThumbnail && thumbnails.length > 1) {
        const idx = thumbnails.findIndex(t => (t.split(/[\\/]/).pop() ?? '') === meta.preferredThumbnail)
        if (idx > 0) {
          thumbnails = [thumbnails[idx], ...thumbnails.slice(0, idx), ...thumbnails.slice(idx + 1)]
        }
      }
      return { ...f, meta, hasMeta: true, thumbnails, detectedGames: meta.games?.length ? meta.games : f.detectedGames }
    }))
  }, [])

  const handleSave = useCallback(async (meta: StreamMeta, date: string, thumbnailTemplatePath?: string, prevEpisodeFolderPath?: string, builtinTemplateId?: string) => {
    if (modal.mode === 'new') {
      const finalMeta = builtinTemplateId ? { ...meta, smThumbnailTemplate: builtinTemplateId } : meta
      await window.api.createStreamFolder(streamsDir, date, finalMeta, thumbnailTemplatePath, prevEpisodeFolderPath, streamMode as any)
      await loadFolders(streamsDir)
    } else if (modal.mode === 'edit' || modal.mode === 'add') {
      await updateFolderMeta(modal.folder, meta)
    }
  }, [modal, streamsDir, loadFolders, updateFolderMeta])

  const navigateModal = useCallback((folder: StreamFolder, dir: 'up' | 'down') => {
    flushSync(() => setSlideDirection(dir))
    setModal({ mode: 'edit', folder })
  }, [])

  const openFolderInExplorer = useCallback((folder: StreamFolder) => {
    if (isDumpMode && folder.videos.length > 0) window.api.openInExplorer(folder.videos[0])
    else window.api.openInExplorer(folder.folderPath)
  }, [isDumpMode])

  const missingMetaCount = folders.filter(f => !f.hasMeta).length

  // Maps folderPath → ordinal position among same-day streams (1-based, by folderName asc)
  const sameDayIndexMap = useMemo(() => {
    const result = new Map<string, number>()
    const byDate = new Map<string, StreamFolder[]>()
    for (const f of folders) {
      if (!byDate.has(f.date)) byDate.set(f.date, [])
      byDate.get(f.date)!.push(f)
    }
    for (const group of byDate.values()) {
      [...group]
        .sort((a, b) => a.folderName.localeCompare(b.folderName))
        .forEach((f, i) => result.set(f.folderPath, i + 1))
    }
    return result
  }, [folders])

  const allGames = useMemo(() => {
    const set = new Set<string>()
    folders.forEach(f => f.meta?.games?.forEach(g => set.add(g)))
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [folders])

  const allStreamTypes = useMemo(() => {
    const set = new Set<string>(Object.keys(tagColors))
    set.add('games')
    set.add('other')
    folders.forEach(f => normalizeStreamTypes(f.meta?.streamType).forEach(t => set.add(t)))
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [folders, tagColors])

  const [filterGames, setFilterGames] = useState<Set<string>>(new Set())
  const [filterTypes, setFilterTypes] = useState<Set<string>>(new Set())
  const toggleTypeFilter = (t: string) => setFilterTypes(prev => {
    const next = new Set(prev)
    next.has(t) ? next.delete(t) : next.add(t)
    return next
  })
  const [openFilter, setOpenFilter] = useState<'type' | 'games' | null>(null)

  const typeFilterAnchorRef = useRef<HTMLDivElement>(null)
  const gridTypeFilterAnchorRef = useRef<HTMLDivElement>(null)
  const gridGameFilterAnchorRef = useRef<HTMLDivElement>(null)
  const [typeFilterMaxHeight, setTypeFilterMaxHeight] = useState(600)
  const updateTypeFilterMaxHeight = useCallback(() => {
    if (typeFilterAnchorRef.current) {
      const rect = typeFilterAnchorRef.current.getBoundingClientRect()
      setTypeFilterMaxHeight(window.innerHeight - rect.bottom - 12)
    }
  }, [])
  const openTypeFilter = useCallback(() => {
    if (openFilter === 'type') { setOpenFilter(null); return }
    updateTypeFilterMaxHeight()
    setOpenFilter('type')
  }, [openFilter, updateTypeFilterMaxHeight])
  useEffect(() => {
    if (openFilter !== 'type') return
    window.addEventListener('resize', updateTypeFilterMaxHeight)
    return () => window.removeEventListener('resize', updateTypeFilterMaxHeight)
  }, [openFilter, updateTypeFilterMaxHeight])

  const gameFilterAnchorRef = useRef<HTMLDivElement>(null)
  const [gameFilterMaxHeight, setGameFilterMaxHeight] = useState(600)

  const updateGameFilterMaxHeight = useCallback(() => {
    if (gameFilterAnchorRef.current) {
      const rect = gameFilterAnchorRef.current.getBoundingClientRect()
      setGameFilterMaxHeight(window.innerHeight - rect.bottom - 12)
    }
  }, [])

  const openGameFilter = useCallback(() => {
    if (openFilter === 'games') { setOpenFilter(null); return }
    updateGameFilterMaxHeight()
    setOpenFilter('games')
  }, [openFilter, updateGameFilterMaxHeight])

  useEffect(() => {
    if (openFilter !== 'games') return
    window.addEventListener('resize', updateGameFilterMaxHeight)
    return () => window.removeEventListener('resize', updateGameFilterMaxHeight)
  }, [openFilter, updateGameFilterMaxHeight])

  const filteredFolders = useMemo(() => {
    return folders.filter(f => {
      if (f.isMissing) return true
      if (filterTypes.size > 0 && !Array.from(filterTypes).every(t => normalizeStreamTypes(f.meta?.streamType).includes(t))) return false
      if (filterGames.size > 0) {
        const fGames = f.meta?.games?.length ? f.meta.games : f.detectedGames
        if (!Array.from(filterGames).every(g => fGames.includes(g))) return false
      }
      return true
    })
  }, [folders, filterGames, filterTypes])

  const viableTypeOptions = useMemo(() => {
    return new Set(
      allStreamTypes.filter(t => {
        if (filterTypes.has(t)) return true
        const candidate = new Set([...filterTypes, t])
        return folders.some(f => {
          if (f.isMissing) return false
          if (!Array.from(candidate).every(c => normalizeStreamTypes(f.meta?.streamType).includes(c))) return false
          if (filterGames.size > 0) {
            const fGames = f.meta?.games?.length ? f.meta.games : f.detectedGames
            if (!Array.from(filterGames).every(g => fGames.includes(g))) return false
          }
          return true
        })
      })
    )
  }, [allStreamTypes, filterTypes, filterGames, folders])

  // Games that would still yield ≥1 result if added to the current filter set
  const viableGameOptions = useMemo(() => {
    return new Set(
      allGames.filter(g => {
        if (filterGames.has(g)) return true
        const candidate = new Set([...filterGames, g])
        return folders.some(f => {
          if (f.isMissing) return false
          if (filterTypes.size > 0 && !Array.from(filterTypes).every(t => normalizeStreamTypes(f.meta?.streamType).includes(t))) return false
          const fGames = f.meta?.games?.length ? f.meta.games : f.detectedGames
          return Array.from(candidate).every(c => fGames.includes(c))
        })
      })
    )
  }, [allGames, filterGames, filterTypes, folders])

  const nextUpcomingFolderPath = useMemo(() => {
    const todayStr = today()
    const upcoming = folders.filter(f =>
      !f.isMissing && !f.meta?.archived && f.date >= todayStr &&
      !f.videos.some(v => (v.split(/[\\/]/).pop() ?? '').startsWith(f.date))
    )
    upcoming.sort((a, b) => a.date.localeCompare(b.date))
    return upcoming[0]?.folderPath ?? null
  }, [folders])

  // Bulk-fetch privacy statuses for all linked videos whenever the set of linked
  // YouTube IDs changes. Depending on `folders` directly would re-fire the batch
  // every time loadFolders produces a new array reference, even with identical
  // content — costly on large libraries.
  const linkedYtIdsKey = useMemo(() => {
    return folders.map(f => f.meta?.ytVideoId).filter(Boolean).sort().join(',')
  }, [folders])
  useEffect(() => {
    if (!ytConnectedOuter || !linkedYtIdsKey) return
    const ids = linkedYtIdsKey.split(',')
    window.api.youtubeGetPrivacyStatuses(ids).then(setYtPrivacyMap).catch(() => {})
  }, [ytConnectedOuter, linkedYtIdsKey])

  // Resolve the broadcast id to poll for the live indicator. Derived as a stable
  // string so the polling effect below doesn't tear down + re-fire whenever the
  // `folders` array reference changes with identical content.
  const nextUpcomingBroadcastId = useMemo(() => {
    if (!ytConnectedOuter || !nextUpcomingFolderPath) return null
    const f = folders.find(f => f.folderPath === nextUpcomingFolderPath)
    if (!f || f.date !== today() || !f.meta?.ytVideoId) return null
    return f.meta.ytVideoId
  }, [ytConnectedOuter, nextUpcomingFolderPath, folders])

  // Poll the upcoming broadcast every 60s to detect if it's live
  useEffect(() => {
    if (!nextUpcomingBroadcastId) { setYtIsLive(false); return }
    const broadcastId = nextUpcomingBroadcastId
    const check = () => window.api.youtubeCheckBroadcastIsLive(broadcastId)
      .then(r => {
        setYtIsLive(r.isLive)
        if (r.privacyStatus) setYtPrivacyMap(prev => ({ ...prev, [broadcastId]: r.privacyStatus! }))
      })
      .catch(() => {})
    check()
    const interval = setInterval(check, 60_000)
    return () => clearInterval(interval)
  }, [nextUpcomingBroadcastId])

  const toggleGameFilter = (game: string) => {
    setFilterGames(prev => {
      const next = new Set(prev)
      next.has(game) ? next.delete(game) : next.add(game)
      return next
    })
  }

  // ── Empty state ──────────────────────────────────────────────────────────
  if (!streamsDir) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <div className="p-4 rounded-full bg-white/5">
          <Radio size={36} className="text-gray-600" />
        </div>
        <div className="text-center">
          <p className="text-gray-300 font-medium">No streams directory set</p>
          <p className="text-sm text-gray-600 mt-1">Choose the folder where your stream session folders live.</p>
        </div>
        <Button variant="primary" icon={<FolderOpen size={14} />} onClick={pickDir}>
          Choose Directory
        </Button>
      </div>
    )
  }

  // ── Main view ────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-white/5 shrink-0">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold">Live Streams</h1>
            <Tooltip content="Reload">
              <button
                onClick={() => loadFolders(streamsDir)}
                disabled={loading}
                className="p-1 rounded text-gray-600 hover:text-gray-300 hover:bg-white/5 transition-colors"
              >
                <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
              </button>
            </Tooltip>
          </div>
          <Tooltip content={streamsDir} side="bottom" width="w-72">
            <button
              className="text-xs text-gray-500 font-mono truncate mt-0.5 hover:text-gray-300 transition-colors text-left"
              onClick={() => window.api.openInExplorer(streamsDir)}
            >
              {streamsDir}
            </button>
          </Tooltip>
        </div>
        {selectMode ? (
          <>
            <span className="text-xs text-gray-400 shrink-0">{selectedPaths.size} selected</span>
            <Tooltip content={selectedPaths.size === filteredFolders.length ? 'Deselect all streams' : 'Select all streams'} side="bottom">
              <Button variant="ghost" size="sm" icon={selectedPaths.size === filteredFolders.length ? <Square size={14} /> : <CheckCheck size={14} />} onClick={selectedPaths.size === filteredFolders.length ? clearSelection : selectAll}>
                <span className="hidden wide:inline">{selectedPaths.size === filteredFolders.length ? 'Deselect All' : 'Select All'}</span>
              </Button>
            </Tooltip>
            <Tooltip content="Edit tags for selected streams" side="bottom">
              <Button
                variant="ghost"
                size="sm"
                icon={<Tags size={14} />}
                onClick={() => setShowBulkTag(true)}
                disabled={selectedPaths.size === 0}
              >
                <span className="hidden wide:inline">Edit Tags {selectedPaths.size > 0 ? `(${selectedPaths.size})` : ''}</span>
              </Button>
            </Tooltip>
            <Tooltip content="Archive selected streams" side="bottom">
              <Button
                variant="primary"
                size="sm"
                icon={<Archive size={14} />}
                onClick={clickArchive}
                disabled={selectedPaths.size === 0}
              >
                <span className="hidden wide:inline">Archive {selectedPaths.size > 0 ? `(${selectedPaths.size})` : ''}</span>
              </Button>
            </Tooltip>
            <Tooltip content="Exit selection mode" side="bottom">
              <Button variant="ghost" size="sm" icon={<X size={14} />} onClick={toggleSelectMode}>
                <span className="hidden wide:inline">Stop Selecting</span>
              </Button>
            </Tooltip>
          </>
        ) : (
          <>
            <Tooltip content="Change streams folder" side="bottom">
              <Button variant="ghost" size="sm" icon={<FolderOpen size={14} />} onClick={pickDir}>
                <span className="hidden wide:inline">Change</span>
              </Button>
            </Tooltip>

            <Tooltip content="Manage title, description, and tag templates" side="bottom">
              <Button
                variant="ghost"
                size="sm"
                icon={<LayoutTemplate size={14} />}
                onClick={() => setShowTemplatesModal(true)}
              >
                <span className="hidden wide:inline">Templates</span>
              </Button>
            </Tooltip>
            <Tooltip content="Manage stream type tags" side="bottom">
              <Button
                variant="ghost"
                size="sm"
                icon={<Tags size={14} />}
                onClick={() => setShowManageTags(true)}
              >
                <span className="hidden wide:inline">Manage Tags</span>
              </Button>
            </Tooltip>
            <div className="flex items-center rounded-lg border border-white/10 overflow-hidden shrink-0">
              <Tooltip content="List view" side="bottom">
                <button
                  onClick={() => { setViewMode('list'); localStorage.setItem('streamsViewMode', 'list') }}
                  className={`p-1.5 transition-colors ${viewMode === 'list' ? 'bg-white/10 text-gray-200' : 'text-gray-600 hover:text-gray-400 hover:bg-white/5'}`}
                >
                  <LayoutList size={14} />
                </button>
              </Tooltip>
              <Tooltip content="Grid view" side="bottom">
                <button
                  onClick={() => { setViewMode('grid'); localStorage.setItem('streamsViewMode', 'grid') }}
                  className={`p-1.5 transition-colors ${viewMode === 'grid' ? 'bg-white/10 text-gray-200' : 'text-gray-600 hover:text-gray-400 hover:bg-white/5'}`}
                >
                  <LayoutGrid size={14} />
                </button>
              </Tooltip>
            </div>
            <Tooltip content="Select streams" side="bottom">
              <Button
                variant="ghost"
                size="sm"
                icon={<CheckSquare size={14} />}
                onClick={toggleSelectMode}
              >
                <span className="hidden wide:inline">Select</span>
              </Button>
            </Tooltip>
            <Tooltip content="Create a new stream entry" side="bottom">
              <Button
                variant="primary"
                size="sm"
                icon={<Plus size={14} />}
                onClick={() => setModal({ mode: 'new' })}
              >
                <span className="hidden wide:inline">New Stream</span>
              </Button>
            </Tooltip>
          </>
        )}
      </div>

      {/* Summary bar */}
      {folders.length > 0 && (
        <div className="flex items-center gap-4 px-6 py-2 border-b border-white/5 bg-navy-800/50 shrink-0 text-xs text-gray-500">
          <span>
            {filteredFolders.length !== folders.length
              ? <>{filteredFolders.length} <span className="text-gray-600">/ {folders.length}</span> sessions</>
              : <>{folders.length} session{folders.length !== 1 ? 's' : ''}</>
            }
          </span>
          {missingMetaCount > 0 && (
            <span className="flex items-center gap-1 text-yellow-600">
              <AlertTriangle size={11} />
              {missingMetaCount} missing metadata
            </span>
          )}
          {viewMode === 'grid' && (
            <div className="ml-auto flex items-center gap-2">
              {/* Type filter */}
              <div ref={gridTypeFilterAnchorRef} className="relative">
                <button
                  onClick={openTypeFilter}
                  className={`flex items-center gap-1 px-2 py-1 rounded border transition-colors text-[11px] ${filterTypes.size > 0 ? 'border-purple-600/50 text-purple-400 bg-purple-900/20' : 'border-white/10 text-gray-500 hover:text-gray-300 hover:border-white/20'}`}
                >
                  <ListFilter size={11} />
                  Type{filterTypes.size > 0 && ` (${filterTypes.size})`}
                </button>
                {openFilter === 'type' && (
                  <>
                    <div className="fixed inset-0 z-20" onClick={() => setOpenFilter(null)} />
                    <div className="absolute top-full right-0 mt-1 z-30 bg-navy-700 border border-white/10 rounded-lg shadow-xl overflow-hidden min-w-[160px] overflow-y-auto" style={{ maxHeight: typeFilterMaxHeight }}>
                      {allStreamTypes.length === 0 ? (
                        <p className="px-3 py-2 text-xs text-gray-600">No types tagged yet</p>
                      ) : (
                        <>
                          <button onClick={() => { setFilterTypes(new Set()); setOpenFilter(null) }} disabled={filterTypes.size === 0} className="flex items-center gap-2 w-full px-3 py-1.5 text-left text-xs border-b border-white/5 transition-colors disabled:opacity-30 disabled:cursor-default text-purple-400 hover:text-purple-300 hover:bg-white/5 disabled:hover:bg-transparent disabled:hover:text-purple-400">
                            <X size={11} className="shrink-0" /> Clear filters
                          </button>
                          {allStreamTypes.map(t => {
                            const color = getTagColor(tagColors[t])
                            const viable = viableTypeOptions.has(t)
                            return (
                              <button key={t} onClick={() => viable && toggleTypeFilter(t)} className={`flex items-center gap-2 w-full px-3 py-1 text-left text-xs capitalize transition-colors ${!viable && !filterTypes.has(t) ? 'opacity-30 cursor-default' : filterTypes.has(t) ? `${color.text} hover:bg-white/5` : 'text-gray-300 hover:bg-white/5'}`}>
                                <span className={`w-3.5 h-3.5 rounded border shrink-0 flex items-center justify-center ${filterTypes.has(t) ? `${color.highlight} border-transparent` : 'border-white/20'}`} style={filterTypes.has(t) ? getTagTextureStyle(tagTextures[t]) : undefined}>
                                  {filterTypes.has(t) && <span className={`text-[9px] leading-none ${color.text}`}>✓</span>}
                                </span>
                                {t}
                              </button>
                            )
                          })}
                        </>
                      )}
                    </div>
                  </>
                )}
              </div>
              {/* Game filter */}
              <div ref={gridGameFilterAnchorRef} className="relative">
                <button
                  onClick={openGameFilter}
                  className={`flex items-center gap-1 px-2 py-1 rounded border transition-colors text-[11px] ${filterGames.size > 0 ? 'border-blue-600/50 text-blue-400 bg-blue-900/20' : 'border-white/10 text-gray-500 hover:text-gray-300 hover:border-white/20'}`}
                >
                  <ListFilter size={11} />
                  Topic{filterGames.size > 0 && ` (${filterGames.size})`}
                </button>
                {openFilter === 'games' && (
                  <>
                    <div className="fixed inset-0 z-20" onClick={() => setOpenFilter(null)} />
                    <div className="absolute top-full right-0 mt-1 z-30 bg-navy-700 border border-white/10 rounded-lg shadow-xl overflow-hidden min-w-[160px] overflow-y-auto" style={{ maxHeight: gameFilterMaxHeight }}>
                      {allGames.length === 0 ? (
                        <p className="px-3 py-2 text-xs text-gray-600">No games tagged yet</p>
                      ) : (
                        <>
                          <button onClick={() => { setFilterGames(new Set()); setOpenFilter(null) }} disabled={filterGames.size === 0} className="flex items-center gap-2 w-full px-3 py-1.5 text-left text-xs border-b border-white/5 transition-colors disabled:opacity-30 disabled:cursor-default text-blue-400 hover:text-blue-300 hover:bg-white/5 disabled:hover:bg-transparent disabled:hover:text-blue-400">
                            <X size={11} className="shrink-0" /> Clear filters
                          </button>
                          {allGames.map(g => {
                            const viable = viableGameOptions.has(g)
                            return (
                              <button key={g} onClick={() => viable && toggleGameFilter(g)} className={`flex items-center gap-2 w-full px-3 py-1 text-left text-xs transition-colors ${!viable && !filterGames.has(g) ? 'opacity-30 cursor-default' : filterGames.has(g) ? 'text-blue-300 hover:bg-white/5' : 'text-gray-300 hover:bg-white/5'}`}>
                                <span className={`w-3.5 h-3.5 rounded border shrink-0 ${filterGames.has(g) ? 'bg-blue-500 border-transparent' : 'border-white/20'}`} />
                                {g}
                              </button>
                            )
                          })}
                        </>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Cloud download modal */}
      {cloudDownload && (
        <CloudDownloadModal
          fileName={cloudDownload.fileName}
          filePath={cloudDownload.filePath}
          stage={cloudDownload.stage}
          onConfirm={async () => {
            setCloudDownload(prev => prev ? { ...prev, stage: 'downloading' } : null)
            await window.api.startCloudDownload(cloudDownload.filePath)
          }}
          onCancel={async () => {
            if (cloudDownload.stage === 'downloading') {
              await window.api.cancelCloudDownload(cloudDownload.filePath)
            }
            setCloudDownload(null)
          }}
        />
      )}

      {/* Missing folders warning banner (shown after user dismisses the confirm modal) */}
      {orphanDismissed && folders.some(f => f.isMissing) && (
        <div className="flex items-center gap-2 px-6 py-2 bg-red-900/20 border-b border-red-700/30 text-xs text-red-400 shrink-0">
          <AlertTriangle size={12} className="shrink-0" />
          <span>
            {folders.filter(f => f.isMissing).length} stream {folders.filter(f => f.isMissing).length === 1 ? 'session' : 'sessions'} {isDumpMode ? 'with no files detected' : 'could not be found on disk'}. Missing items are shown in red below.
          </span>
          <button onClick={() => setOrphanConfirmOpen(true)} className="ml-auto underline hover:text-red-300">
            Review
          </button>
        </div>
      )}

      {/* Archive preset warning */}
      {archivePresetWarning && (
        <div className="flex items-center gap-2 px-6 py-2 bg-yellow-900/20 border-b border-yellow-700/30 text-xs text-yellow-400 shrink-0">
          <AlertTriangle size={12} className="shrink-0" />
          <span>The configured archive preset could not be found. Check your <strong>Presets Directory</strong> in Settings.</span>
          <button onClick={() => setArchivePresetWarning(false)} className="ml-auto text-yellow-600 hover:text-yellow-300">
            <X size={12} />
          </button>
        </div>
      )}

      {/* Content area */}
      <div className="flex-1 overflow-hidden pr-2">
      <div ref={listScrollRef} className="h-full overflow-y-auto [scrollbar-gutter:stable]">
        {loading && folders.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-gray-600 text-sm gap-2">
            <RefreshCw size={14} className="animate-spin" /> Loading…
          </div>
        ) : folders.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 gap-2 text-gray-600">
            <p className="text-sm">No stream folders found in this directory.</p>
            <Button variant="primary" size="sm" icon={<Plus size={12} />} onClick={() => setModal({ mode: 'new' })}>
              Create First Stream
            </Button>
          </div>
        ) : viewMode === 'grid' ? (
          <div className="p-4">
            {filteredFolders.length === 0 ? (
              <p className="text-center py-12 text-gray-600 text-sm">No sessions match the current filters.</p>
            ) : (
              <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
                {filteredFolders.map((folder, i) => {
                  const todayStr = today()
                  const pending = !folder.isMissing && folder.date >= todayStr && !folder.meta?.archived
                    && !folder.videos.some(v => (v.split(/[\\/]/).pop() ?? '').startsWith(folder.date))
                  return (
                    <StreamCard
                      key={isDumpMode ? folder.date : folder.folderPath}
                      folder={folder}
                      zebra={i % 2 === 0}
                      selectMode={selectMode}
                      selected={selectedPaths.has(selectionKey(folder))}
                      isNextUpcoming={folder.folderPath === nextUpcomingFolderPath}
                      isPending={pending}
                      isLive={ytIsLive && folder.folderPath === nextUpcomingFolderPath}
                      privacyStatus={folder.meta?.ytVideoId ? ytPrivacyMap[folder.meta.ytVideoId] ?? null : null}
                      tagColors={tagColors}
                      tagTextures={tagTextures}
                      onToggleSelect={(shiftKey) => {
                        if (dragMoved.current) { dragMoved.current = false; return }
                        toggleSelected(selectionKey(folder), shiftKey, i)
                      }}
                      onDragStart={() => startDrag(i)}
                      onDragEnter={() => updateDrag(i)}
                      onEdit={() => setModal({ mode: 'edit', folder })}
                      onAdd={() => setModal({ mode: 'add', folder })}
                      onReschedule={() => { setRescheduleTarget(folder); setRescheduleDate(folder.date) }}
                      onOpen={() => openFolderInExplorer(folder)}
                      onDelete={() => setDeleteTarget(folder)}
                      onSendToPlayer={() => sendVideo(folder, 'player')}
                      onSendToConverter={() => sendVideo(folder, 'converter')}
                      onSendToCombine={() => sendToCombine(folder)}
                      onOpenThumbnails={() => openThumbnailEditor({
                        folderPath: folder.folderPath,
                        date: folder.date,
                        title: folder.meta?.ytTitle ?? folder.meta?.games?.join(', '),
                        meta: folder.meta ?? undefined,
                      })}
                      onThumbClick={folder.thumbnails.length > 0
                        ? (i) => setLightbox({ thumbnails: folder.thumbnails, localFlags: folder.thumbnailLocalFlags, index: i, folderPath: folder.folderPath, folderDate: folder.date, preferredThumbnail: folder.meta?.preferredThumbnail })
                        : undefined}
                      thumbsKey={thumbsKey}
                      sameDayIndex={sameDayIndexMap.get(folder.folderPath)}
                    />
                  )
                })}
              </div>
            )}
          </div>
        ) : (
          <table className="w-full text-sm border-collapse table-fixed">
            <thead className="sticky top-0 bg-navy-900 z-10">
              <tr className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                {selectMode && <th className="pl-4 py-2 w-[40px]" />}
                <th className="p-0" style={{ width: thumbWidth }}>Thumbnail</th>
                <th className="px-2 py-2 w-[44px]"></th>
                <th className="text-left px-2 py-2 w-[220px]">Date</th>
                {/* Type column with filter */}
                <th className="text-left px-2 py-2 min-w-[120px]">
                  <div ref={typeFilterAnchorRef} className="relative flex items-center gap-1">
                    <span>Type</span>
                    <Tooltip content="Filter by type" side="bottom">
                      <button
                        onClick={openTypeFilter}
                        className={`p-0.5 rounded transition-colors ${filterTypes.size > 0 ? 'text-purple-400' : 'text-gray-600 hover:text-gray-400'}`}
                      >
                        <ListFilter size={12} />
                      </button>
                    </Tooltip>
                    {openFilter === 'type' && (
                      <>
                        <div className="fixed inset-0 z-20" onClick={() => setOpenFilter(null)} />
                        <div className="absolute top-full left-0 mt-1 z-30 bg-navy-700 border border-white/10 rounded-lg shadow-xl overflow-hidden min-w-[160px] overflow-y-auto" style={{ maxHeight: typeFilterMaxHeight }}>
                          {allStreamTypes.length === 0 ? (
                            <p className="px-3 py-2 text-xs text-gray-600">No types tagged yet</p>
                          ) : (
                            <>
                              <button
                                onClick={() => { setFilterTypes(new Set()); setOpenFilter(null) }}
                                disabled={filterTypes.size === 0}
                                className="flex items-center gap-2 w-full px-3 py-1.5 text-left text-xs border-b border-white/5 transition-colors disabled:opacity-30 disabled:cursor-default text-purple-400 hover:text-purple-300 hover:bg-white/5 disabled:hover:bg-transparent disabled:hover:text-purple-400"
                              >
                                <X size={11} className="shrink-0" />
                                Clear filters
                              </button>
                              {allStreamTypes.map(t => {
                                const color = getTagColor(tagColors[t])
                                const viable = viableTypeOptions.has(t)
                                return (
                                  <button
                                    key={t}
                                    onClick={() => viable && toggleTypeFilter(t)}
                                    className={`flex items-center gap-2 w-full px-3 py-1 text-left text-xs capitalize transition-colors ${
                                      !viable && !filterTypes.has(t)
                                        ? 'opacity-30 cursor-default'
                                        : filterTypes.has(t)
                                          ? `${color.text} hover:bg-white/5`
                                          : 'text-gray-300 hover:bg-white/5'
                                    }`}
                                  >
                                    <span
                                      className={`w-3.5 h-3.5 rounded border shrink-0 flex items-center justify-center ${filterTypes.has(t) ? `${color.highlight} border-transparent` : 'border-white/20'}`}
                                      style={filterTypes.has(t) ? getTagTextureStyle(tagTextures[t]) : undefined}
                                    >
                                      {filterTypes.has(t) && <span className={`text-[9px] leading-none ${color.text}`}>✓</span>}
                                    </span>
                                    {t}
                                  </button>
                                )
                              })}
                            </>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </th>
                {/* Topics / Games column with filter */}
                <th className="text-left px-2 py-2 min-w-[120px]">
                  <div ref={gameFilterAnchorRef} className="relative flex items-center gap-1">
                    <span>Topics / Games</span>
                    <Tooltip content="Filter by topic or game" side="bottom">
                      <button
                        onClick={openGameFilter}
                        className={`p-0.5 rounded transition-colors ${filterGames.size > 0 ? 'text-blue-400' : 'text-gray-600 hover:text-gray-400'}`}
                      >
                        <ListFilter size={12} />
                      </button>
                    </Tooltip>
                    {openFilter === 'games' && (
                      <>
                        <div className="fixed inset-0 z-20" onClick={() => setOpenFilter(null)} />
                        <div className="absolute top-full left-0 mt-1 z-30 bg-navy-700 border border-white/10 rounded-lg shadow-xl overflow-hidden min-w-[160px] overflow-y-auto" style={{ maxHeight: gameFilterMaxHeight }}>
                          {allGames.length === 0 ? (
                            <p className="px-3 py-2 text-xs text-gray-600">No games tagged yet</p>
                          ) : (
                            <>
                              <button
                                onClick={() => { setFilterGames(new Set()); setOpenFilter(null) }}
                                disabled={filterGames.size === 0}
                                className="flex items-center gap-2 w-full px-3 py-1.5 text-left text-xs border-b border-white/5 transition-colors disabled:opacity-30 disabled:cursor-default text-blue-400 hover:text-blue-300 hover:bg-white/5 disabled:hover:bg-transparent disabled:hover:text-blue-400"
                              >
                                <X size={11} className="shrink-0" />
                                Clear filters
                              </button>
                              {allGames.map(g => {
                                const viable = viableGameOptions.has(g)
                                return (
                                  <button
                                    key={g}
                                    onClick={() => viable && toggleGameFilter(g)}
                                    className={`flex items-center gap-2 w-full px-3 py-1 text-left text-xs transition-colors ${
                                      !viable && !filterGames.has(g)
                                        ? 'opacity-30 cursor-default'
                                        : filterGames.has(g)
                                          ? 'text-blue-300 hover:bg-white/5'
                                          : 'text-gray-300 hover:bg-white/5'
                                    }`}
                                  >
                                    <span className={`w-3.5 h-3.5 rounded border shrink-0 flex items-center justify-center ${filterGames.has(g) ? 'bg-blue-500 border-blue-500' : 'border-white/20'}`}>
                                      {filterGames.has(g) && <span className="text-white text-[9px] leading-none">✓</span>}
                                    </span>
                                    {g}
                                  </button>
                                )
                              })}
                            </>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </th>
                <th className="text-left px-2 py-2 min-w-[100px] hidden xl:table-cell">Comments</th>
                <th className="text-right px-2 py-2 min-w-[160px]">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredFolders.length === 0 ? (
                <tr><td colSpan={selectMode ? 8 : 7} className="text-center py-12 text-gray-600 text-sm">No sessions match the current filters.</td></tr>
              ) : filteredFolders.map((folder, i) => {
                const todayStr = today()
                const pending = !folder.isMissing && folder.date >= todayStr && !folder.meta?.archived
                  && !folder.videos.some(v => (v.split(/[\\/]/).pop() ?? '').startsWith(folder.date))
return (
                <React.Fragment key={isDumpMode ? folder.date : folder.folderPath}>
                <StreamRow
                  folder={folder}
                  zebra={i % 2 === 0}
                  selectMode={selectMode}
                  selected={selectedPaths.has(selectionKey(folder))}
                  isNextUpcoming={folder.folderPath === nextUpcomingFolderPath}
                  isPending={pending}
                  isLive={ytIsLive && folder.folderPath === nextUpcomingFolderPath}
                  privacyStatus={folder.meta?.ytVideoId ? ytPrivacyMap[folder.meta.ytVideoId] ?? null : null}
                  tagColors={tagColors}
                  tagTextures={tagTextures}
                  onToggleSelect={(shiftKey) => {
                    if (dragMoved.current) { dragMoved.current = false; return }
                    toggleSelected(selectionKey(folder), shiftKey, i)
                  }}
                  onDragStart={() => startDrag(i)}
                  onDragEnter={() => updateDrag(i)}
                  onEdit={() => setModal({ mode: 'edit', folder })}
                  onAdd={() => setModal({ mode: 'add', folder })}
                  onReschedule={() => { setRescheduleTarget(folder); setRescheduleDate(folder.date) }}
                  onOpen={() => isDumpMode && folder.videos.length > 0
                    ? window.api.openInExplorer(folder.videos[0])
                    : window.api.openInExplorer(folder.folderPath)}
                  onDelete={() => setDeleteTarget(folder)}
                  onSendToPlayer={() => sendVideo(folder, 'player')}
                  onSendToConverter={() => sendVideo(folder, 'converter')}
                  onSendToCombine={() => sendToCombine(folder)}
                  onOpenThumbnails={() => openThumbnailEditor({
                    folderPath: folder.folderPath,
                    date: folder.date,
                    title: folder.meta?.ytTitle ?? folder.meta?.games?.join(', '),
                    meta: folder.meta ?? undefined,
                  })}
                  onThumbClick={folder.thumbnails.length > 0
                    ? (i) => setLightbox({ thumbnails: folder.thumbnails, localFlags: folder.thumbnailLocalFlags, index: i, folderPath: folder.folderPath, folderDate: folder.date, preferredThumbnail: folder.meta?.preferredThumbnail })
                    : undefined}
                  thumbsKey={thumbsKey}
                  sameDayIndex={sameDayIndexMap.get(folder.folderPath)}
                  thumbWidth={thumbWidth}
                  onThumbResizeStart={startThumbResize}
                />
                </React.Fragment>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
      </div>

      {/* Lightbox */}

      {lightbox && (
        <Lightbox
          thumbnails={lightbox.thumbnails}
          localFlags={lightbox.localFlags}
          index={lightbox.index}
          thumbsKey={thumbsKey}
          preferredThumbnail={lightbox.preferredThumbnail}
          onSetAsThumbnail={async (filePath) => {
            const basename = filePath.split(/[\\/]/).pop() ?? ''
            const folder = folders.find(f => f.folderPath === lightbox.folderPath && f.date === lightbox.folderDate)
            if (!folder) return
            const meta: StreamMeta = { ...folderMetaBase(folder), preferredThumbnail: basename }
            await updateFolderMeta(folder, meta)
            setLightbox(prev => prev ? { ...prev, preferredThumbnail: basename } : null)
          }}
          onClose={() => setLightbox(null)}
          onNavigate={(i) => setLightbox(prev => prev ? { ...prev, index: i } : null)}
        />
      )}

      {/* Delete confirmation modal */}
      {rescheduleTarget && (
        <Modal
          isOpen
          onClose={() => { setRescheduleTarget(null); setReschedulePreview(null) }}
          title="Reschedule stream"
          width="sm"
          footer={
            <>
              <Button variant="ghost" size="sm" onClick={() => { setRescheduleTarget(null); setReschedulePreview(null) }}>Cancel</Button>
              <Button
                variant="primary"
                size="sm"
                loading={rescheduling}
                disabled={!reschedulePreview || reschedulePreview.conflictExists || rescheduleDate === rescheduleTarget.date || rescheduling}
                onClick={async () => {
                  if (!rescheduleTarget || !rescheduleDate) return
                  setRescheduling(true)
                  try {
                    await window.api.rescheduleStream(rescheduleTarget.folderPath, rescheduleDate)
                    setRescheduleTarget(null)
                    setReschedulePreview(null)
                    loadFolders(streamsDir)
                  } finally {
                    setRescheduling(false)
                  }
                }}
              >
                Confirm reschedule
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-gray-400">New date</label>
              <input
                type="date"
                value={rescheduleDate}
                onChange={e => setRescheduleDate(e.target.value)}
                className="w-full bg-navy-900 border border-white/10 text-gray-200 text-xs rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500/40 [color-scheme:dark]"
              />
            </div>

            {rescheduleDate === rescheduleTarget.date && (
              <p className="text-xs text-gray-500 italic">Choose a different date to reschedule.</p>
            )}

            {rescheduleDate !== rescheduleTarget.date && rescheduleLoading && (
              <p className="text-xs text-gray-500 flex items-center gap-1.5">
                <Loader2 size={11} className="animate-spin shrink-0" />
                Checking…
              </p>
            )}

            {reschedulePreview && rescheduleDate !== rescheduleTarget.date && !rescheduleLoading && (
              <>
                {reschedulePreview.conflictExists ? (
                  <p className="text-xs text-red-400 flex items-center gap-1.5">
                    <AlertTriangle size={11} className="shrink-0" />
                    A stream folder already exists for {rescheduleDate}. Choose a different date.
                  </p>
                ) : (
                  <div className="flex flex-col gap-2">
                    <p className="text-xs text-gray-400">
                      The following will be renamed from <span className="font-mono text-gray-300">{rescheduleTarget.date}</span> to <span className="font-mono text-gray-300">{rescheduleDate}</span>:
                    </p>
                    <ul className="flex flex-col gap-0.5 max-h-48 overflow-y-auto">
                      <li className="text-xs font-mono text-gray-400 bg-navy-900 rounded px-2 py-1">
                        📁 {rescheduleTarget.date}/ → {rescheduleDate}/
                      </li>
                      {reschedulePreview.filesToRename.map(f => (
                        <li key={f.oldName} className="text-xs font-mono text-gray-500 px-2 py-0.5">
                          {f.oldName} → {f.newName}
                        </li>
                      ))}
                      {reschedulePreview.filesToRename.length === 0 && (
                        <li className="text-xs text-gray-600 italic px-2 py-0.5">No files to rename inside folder.</li>
                      )}
                    </ul>
                  </div>
                )}
              </>
            )}
          </div>
        </Modal>
      )}

      {deleteTarget && (
        <Modal
          isOpen
          onClose={() => setDeleteTarget(null)}
          title={isDumpMode ? 'Move files to Recycle Bin?' : 'Move folder to Recycle Bin?'}
          width="sm"
          footer={
            <>
              <Button variant="ghost" size="sm" onClick={() => setDeleteTarget(null)}>Cancel</Button>
              <Button
                variant="primary"
                size="sm"
                onClick={async () => {
                  const target = deleteTarget
                  setDeleteTarget(null)
                  if (isDumpMode) {
                    await window.api.deleteStreamFiles(target.folderPath, target.date)
                  } else {
                    await window.api.deleteStreamFolder(target.folderPath)
                  }
                  await loadFolders(streamsDir)
                }}
              >
                Move to Recycle Bin
              </Button>
            </>
          }
        >
          <p className="text-sm text-gray-300 mb-3">
            The following will be moved to the Recycle Bin:
          </p>
          <div className="bg-white/5 rounded-lg px-3 py-2.5 mb-3 font-mono text-sm text-gray-200 max-h-64 overflow-y-auto">
            {isDumpMode ? (
              deleteFileList.length === 0
                ? <span className="text-gray-600 italic text-xs">No files found for this date.</span>
                : deleteFileList.map(f => (
                    <div key={f} className="flex items-center gap-1.5 text-gray-500 py-px">
                      <span className="shrink-0 text-gray-700">·</span>
                      <span className="truncate">{f.split(/[\\/]/).pop()}</span>
                    </div>
                  ))
            ) : (
              <TreeView nodes={deleteTree} depth={0} rootName={deleteTarget.folderName} />
            )}
          </div>
          <p className="text-xs text-gray-600">This action can be undone from the Recycle Bin.</p>
        </Modal>
      )}

      {/* Missing folders confirmation modal */}
      <Modal
        isOpen={orphanConfirmOpen}
        onClose={() => { setOrphanConfirmOpen(false); setOrphanDismissed(true) }}
        title={isDumpMode ? 'Stream sessions with no files' : 'Stream folders not found'}
        width="sm"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => { setOrphanConfirmOpen(false); setOrphanDismissed(true) }}>
              Keep
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={async () => {
                const missing = folders.filter(f => f.isMissing)
                await window.api.removeStreamOrphans(streamsDir, missing.map(f => f.folderName))
                setOrphanConfirmOpen(false)
                setOrphanDismissed(false)
                await loadFolders(streamsDir)
              }}
            >
              Remove from records
            </Button>
          </>
        }
      >
        <p className="text-sm text-gray-300 mb-3">
          {isDumpMode
            ? 'The following stream sessions have metadata records but no files were detected on disk. They may have been deleted or moved outside of the app.'
            : 'The following stream folders could not be found on disk. They may have been deleted or moved outside of the app.'}
        </p>
        <ul className="space-y-1 mb-3">
          {folders.filter(f => f.isMissing).map(f => (
            <li key={f.folderName} className="flex items-center gap-2 text-sm text-red-400 font-mono">
              <AlertTriangle size={12} className="shrink-0 text-red-500" />
              {f.folderName}
            </li>
          ))}
        </ul>
        <p className="text-xs text-gray-500">
          <strong className="text-gray-400">Remove from records</strong> — deletes their metadata entries from the app.<br />
          <strong className="text-gray-400">Keep</strong> — retains the records and shows a warning in the list.
        </p>
      </Modal>

      {/* Meta modal — backdrop (not animated, always behind the panel) */}
      {modal.mode !== 'none' && (
        <div className="fixed inset-x-0 bottom-0 top-10 bg-black/60 backdrop-blur-sm z-[49]" onClick={() => { setModal({ mode: 'none' }); setSlideDirection(null) }} />
      )}

      {/* Meta modal — nav buttons (fixed at z-[60], outside the animated panel so transforms don't affect positioning) */}
      {(modal.mode === 'edit' || modal.mode === 'add') && (() => {
        const navigableFolders = filteredFolders.filter(f => !f.isMissing)
        const modalIdx = navigableFolders.findIndex(f => f.folderPath === modal.folder.folderPath)
        const prevFolder = modalIdx >= 0 && modalIdx < navigableFolders.length - 1 ? navigableFolders[modalIdx + 1] : undefined
        const nextFolder = modalIdx > 0 ? navigableFolders[modalIdx - 1] : undefined
        const primaryGame = (modal.folder.meta?.games?.length ? modal.folder.meta.games : modal.folder.detectedGames)[0] ?? null
        const currentSeason = modal.folder.meta?.ytSeason ?? '1'
        const seriesFolders = primaryGame
          ? folders
              .filter(f =>
                !f.isMissing &&
                (f.meta?.games?.includes(primaryGame) || f.detectedGames?.includes(primaryGame)) &&
                (f.meta?.ytSeason ?? '1') === currentSeason
              )
              .sort((a, b) => {
                const epA = parseInt(a.meta?.ytEpisode ?? '', 10)
                const epB = parseInt(b.meta?.ytEpisode ?? '', 10)
                return (isNaN(epA) ? Infinity : epA) - (isNaN(epB) ? Infinity : epB)
              })
          : []
        const seriesIdx = seriesFolders.findIndex(f => f.folderPath === modal.folder.folderPath)
        const prevSeriesFolder = seriesIdx > 0 ? seriesFolders[seriesIdx - 1] : undefined
        const nextSeriesFolder = seriesIdx >= 0 && seriesIdx < seriesFolders.length - 1 ? seriesFolders[seriesIdx + 1] : undefined
        return (
          <div className="fixed inset-x-0 bottom-0 top-10 z-[60] flex items-center justify-center p-4 pointer-events-none">
            <div className="relative w-full max-w-4xl">
              <div className="absolute right-full top-1/2 -translate-y-1/2 pr-3 flex flex-row gap-2 items-center pointer-events-auto">
                <Tooltip content="Previous in series" side="right">
                  <button onClick={() => navigateModal(prevSeriesFolder!, 'up')} disabled={!prevSeriesFolder} className="p-2 rounded-full bg-navy-700/60 border border-white/10 text-gray-500 hover:text-gray-300 hover:bg-navy-600/80 transition-colors shadow-md disabled:opacity-30 disabled:cursor-default disabled:hover:bg-navy-700/60 disabled:hover:text-gray-500"><ChevronsDown size={16} /></button>
                </Tooltip>
                <Tooltip content="Previous stream" side="right">
                  <button onClick={() => navigateModal(prevFolder!, 'up')} disabled={!prevFolder} className="p-3 rounded-full bg-navy-700/80 border border-white/10 text-gray-400 hover:text-gray-200 hover:bg-navy-600 transition-colors shadow-lg disabled:opacity-30 disabled:cursor-default disabled:hover:bg-navy-700/80 disabled:hover:text-gray-400"><ChevronDown size={22} /></button>
                </Tooltip>
              </div>
              <div className="absolute left-full top-1/2 -translate-y-1/2 pl-3 flex flex-row gap-2 items-center pointer-events-auto">
                <Tooltip content="Next stream" side="left">
                  <button onClick={() => navigateModal(nextFolder!, 'down')} disabled={!nextFolder} className="p-3 rounded-full bg-navy-700/80 border border-white/10 text-gray-400 hover:text-gray-200 hover:bg-navy-600 transition-colors shadow-lg disabled:opacity-30 disabled:cursor-default disabled:hover:bg-navy-700/80 disabled:hover:text-gray-400"><ChevronUp size={22} /></button>
                </Tooltip>
                <Tooltip content="Next in series" side="left">
                  <button onClick={() => navigateModal(nextSeriesFolder!, 'down')} disabled={!nextSeriesFolder} className="p-2 rounded-full bg-navy-700/60 border border-white/10 text-gray-500 hover:text-gray-300 hover:bg-navy-600/80 transition-colors shadow-md disabled:opacity-30 disabled:cursor-default disabled:hover:bg-navy-700/60 disabled:hover:text-gray-500"><ChevronsUp size={16} /></button>
                </Tooltip>
              </div>
            </div>
          </div>
        )
      })()}

      {/* Meta modal — animated panel (motion.div is the direct AnimatePresence child so exit animations work) */}
      <AnimatePresence mode="wait">
        {modal.mode !== 'none' && (
          <motion.div
            key={(modal.mode === 'edit' || modal.mode === 'add') ? modal.folder.folderPath : 'new'}
            className="fixed inset-x-0 bottom-0 top-10 z-50 flex items-center justify-center p-4"
            initial={noAnimation ? false : { opacity: 0, y: slideDirection === 'up' ? 60 : slideDirection === 'down' ? -60 : 0 }}
            animate={noAnimation ? {} : panelAnimate}
            exit={noAnimation ? {} : { opacity: 0, y: slideDirection === 'up' ? -60 : slideDirection === 'down' ? 60 : 0, transition: { duration: 0.18 * animMult, ease: 'easeIn' as const } }}
          >
            <MetaModal
              mode={modal.mode}
              initialMeta={(modal.mode === 'edit' || modal.mode === 'add') ? modal.folder.meta : null}
              folderDate={(modal.mode === 'edit' || modal.mode === 'add') ? modal.folder.date : undefined}
              detectedGames={(modal.mode === 'edit' || modal.mode === 'add') ? modal.folder.detectedGames : []}
              thumbnails={(modal.mode === 'edit' || modal.mode === 'add') ? modal.folder.thumbnails : []}
              thumbnailLocalFlags={(modal.mode === 'edit' || modal.mode === 'add') ? modal.folder.thumbnailLocalFlags : undefined}
              thumbsKey={thumbsKey}
              preferredThumbnail={(modal.mode === 'edit' || modal.mode === 'add') ? modal.folder.meta?.preferredThumbnail : undefined}
              onSetAsThumbnail={(modal.mode === 'edit' || modal.mode === 'add') ? async (filePath) => {
                if (modal.mode !== 'edit' && modal.mode !== 'add') return
                const folder = modal.folder
                const basename = filePath.split(/[\\/]/).pop() ?? ''
                const meta: StreamMeta = { ...folderMetaBase(folder), preferredThumbnail: basename }
                await updateFolderMeta(folder, meta)
              } : undefined}
              allGames={allGames}
              allStreamTypes={allStreamTypes}
              allFolders={modal.mode === 'edit' ? folders.filter(f => f.folderPath !== modal.folder.folderPath) : folders}
              templates={templates}
              defaultTemplateName={config.defaultThumbnailTemplate}
              builtinTemplates={builtinTemplates}
              defaultBuiltinTemplateId={config.defaultBuiltinThumbnailTemplate}
              useBuiltinByDefault={config.useBuiltinThumbnailByDefault}
              claudeEnabled={!!config.claudeApiKey}
              tagColors={tagColors}
              tagTextures={tagTextures}
              onNewStreamType={tag => {
                setTagColors(prev => {
                  const updated = { ...prev, [tag]: pickColorForNewTag(prev) }
                  window.api.setStreamTypeTags(updated)
                  return updated
                })
                setTagTextures(prev => {
                  const updated = { ...prev, [tag]: pickTextureForNewTag(prev) }
                  window.api.setStreamTypeTextures(updated)
                  return updated
                })
              }}
              onSave={handleSave}
              onClose={() => { setModal({ mode: 'none' }); setSlideDirection(null) }}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Video picker */}
      {videoPicker && (
        <VideoPickerModal
          files={videoPicker.files}
          action={videoPicker.action}
          offlineFiles={videoPicker.offlineFiles}
          onPick={file => {
            if (videoPicker.action === 'player') onSendToPlayer(file)
            else if (videoPicker.action === 'converter') onSendToConverter(file)
            else onSendToCombine([file])
          }}
          onPickAll={videoPicker.action === 'combine' ? onSendToCombine : undefined}
          onClose={() => setVideoPicker(null)}
        />
      )}

      {/* Preset picker */}
      {showPresetPicker && (
        <PresetPickerModal
          onPick={(preset, setAsDefault) => startArchive(preset, setAsDefault)}
          onClose={() => setShowPresetPicker(false)}
        />
      )}

      {/* Archive progress */}
      {archiveStatuses && (
        <ArchiveProgressModal
          statuses={archiveStatuses}
          done={archiveDone}
          onCancel={() => window.api.cancelArchive()}
          onClose={() => {
            setArchiveStatuses(null)
            setArchiveDone(false)
            setSelectMode(false)
            setSelectedPaths(new Set())
          }}
        />
      )}

      {/* Manage Tags */}
      {showManageTags && (
        <ManageTagsModal
          tags={allStreamTypes}
          tagColors={tagColors}
          tagTextures={tagTextures}
          games={allGames}
          folders={folders}
          onColorChange={(tag, colorKey) => {
            saveTagColors({ ...tagColors, [tag]: colorKey })
          }}
          onTextureChange={(tag, textureKey) => {
            saveTagTextures({ ...tagTextures, [tag]: textureKey })
          }}
          onAddTag={(name, colorKey, textureKey) => {
            saveTagColors({ ...tagColors, [name]: colorKey })
            saveTagTextures({ ...tagTextures, [name]: textureKey })
          }}
          onDeleteTag={tag => {
            const affected = folders.filter(f =>
              normalizeStreamTypes(f.meta?.streamType).includes(tag)
            )
            Promise.all(
              affected.map(f =>
                window.api.writeStreamMeta(f.folderPath, {
                  ...f.meta!,
                  streamType: normalizeStreamTypes(f.meta?.streamType).filter(t => t !== tag),
                }, f.relativePath)
              )
            ).then(() => {
              const updatedColors = { ...tagColors }
              delete updatedColors[tag]
              saveTagColors(updatedColors)
              const updatedTextures = { ...tagTextures }
              delete updatedTextures[tag]
              saveTagTextures(updatedTextures)
              loadFolders(streamsDir)
            })
          }}
          onCombineTags={(dying, survivor) => {
            const allDying = new Set(dying)
            const affected = folders.filter(f =>
              normalizeStreamTypes(f.meta?.streamType).some(t => allDying.has(t))
            )
            Promise.all(
              affected.map(f => {
                const types = normalizeStreamTypes(f.meta?.streamType)
                const merged = types.includes(survivor)
                  ? types.filter(t => !allDying.has(t))
                  : [survivor, ...types.filter(t => !allDying.has(t))]
                return window.api.writeStreamMeta(f.folderPath, { ...f.meta!, streamType: merged }, f.relativePath)
              })
            ).then(() => {
              const updatedColors = { ...tagColors }
              const updatedTextures = { ...tagTextures }
              for (const d of dying) { delete updatedColors[d]; delete updatedTextures[d] }
              saveTagColors(updatedColors)
              saveTagTextures(updatedTextures)
              loadFolders(streamsDir)
            })
          }}
          onDeleteGame={game => {
            const affected = folders.filter(f => f.meta?.games?.includes(game))
            Promise.all(
              affected.map(f =>
                window.api.writeStreamMeta(f.folderPath, {
                  ...f.meta!,
                  games: (f.meta!.games ?? []).filter(g => g !== game),
                }, f.relativePath)
              )
            ).then(() => loadFolders(streamsDir))
          }}
          onCombineGames={(dying, survivor) => {
            const allDying = new Set(dying)
            const affected = folders.filter(f =>
              (f.meta?.games ?? []).some(g => allDying.has(g))
            )
            Promise.all(
              affected.map(f => {
                const gs = f.meta!.games ?? []
                const merged = gs.includes(survivor)
                  ? gs.filter(g => !allDying.has(g))
                  : [survivor, ...gs.filter(g => !allDying.has(g))]
                return window.api.writeStreamMeta(f.folderPath, { ...f.meta!, games: merged }, f.relativePath)
              })
            ).then(() => loadFolders(streamsDir))
          }}
          onClose={() => setShowManageTags(false)}
        />
      )}

      {/* Templates */}
      <TemplatesModal
        isOpen={showTemplatesModal}
        onClose={() => setShowTemplatesModal(false)}
        onSaved={() => {}}
      />

      {/* Bulk tag */}
      {showBulkTag && (() => {
        const selectedFolders = folders.filter(f => selectedPaths.has(selectionKey(f)))
        const presentStreamTypes = Array.from(new Set(selectedFolders.flatMap(f => normalizeStreamTypes(f.meta?.streamType)))).sort()
        const presentGames = Array.from(new Set(selectedFolders.flatMap(f => f.meta?.games ?? []))).sort()
        return (
          <BulkTagModal
            count={selectedPaths.size}
            allStreamTypes={allStreamTypes}
            allGames={allGames}
            presentStreamTypes={presentStreamTypes}
            presentGames={presentGames}
            tagColors={tagColors}
            onNewStreamType={tag => {
              setTagColors(prev => {
                const updated = { ...prev, [tag]: pickColorForNewTag(prev) }
                window.api.setStreamTypeTags(updated)
                return updated
              })
            }}
            onApply={handleBulkEditTags}
            onClose={() => setShowBulkTag(false)}
          />
        )
      })()}
    </div>
  )
}

// ─── Folder tree view ────────────────────────────────────────────────────────

function TreeView({ nodes, depth, rootName }: { nodes: TreeNode[]; depth: number; rootName?: string }) {
  return (
    <div>
      {rootName !== undefined && (
        <div className="flex items-center gap-1.5 text-gray-300 mb-0.5">
          <FolderOpen size={12} className="shrink-0 text-gray-500" />
          <span>{rootName}/</span>
        </div>
      )}
      {nodes.length === 0 && depth === 0 && (
        <div style={{ paddingLeft: 20 }} className="text-gray-600 italic text-xs">Empty folder</div>
      )}
      {nodes.map(node => (
        <div key={node.name} style={{ paddingLeft: rootName !== undefined || depth > 0 ? 20 : 0 }}>
          {node.isDirectory ? (
            <TreeView nodes={node.children ?? []} depth={depth + 1} rootName={node.name} />
          ) : (
            <div className="flex items-center gap-1.5 text-gray-500 py-px">
              <span className="shrink-0 text-gray-700">·</span>
              <span className="truncate">{node.name}</span>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// ─── Clamped tooltip ─────────────────────────────────────────────────────────
// Only renders the Tooltip when the text is actually truncated by line-clamp.

function ClampedComment({ text }: { text: string }) {
  const spanRef = useRef<HTMLSpanElement>(null)
  const [clamped, setClamped] = useState(false)

  useEffect(() => {
    const el = spanRef.current
    if (el) setClamped(el.scrollHeight > el.clientHeight)
  }, [text])

  const span = (
    <span ref={spanRef} className="text-[10px] leading-tight text-gray-400 line-clamp-3 whitespace-pre-wrap">
      {text}
    </span>
  )

  // Always render a block-level wrapper so both clamped and non-clamped states
  // stay out of inline formatting context — prevents the Tooltip's inline-flex
  // wrapper from adding descender space and making the row taller.
  return (
    <div className="leading-[0]">
      {clamped ? (
        <Tooltip content={<span className="whitespace-pre-wrap">{text}</span>} side="left" width="w-72">{span}</Tooltip>
      ) : span}
    </div>
  )
}

// ─── Stream card (grid view) ─────────────────────────────────────────────────

function StreamCard({ folder, selectMode, selected, isNextUpcoming, isPending, isLive, privacyStatus, tagColors, tagTextures, onToggleSelect, onEdit, onAdd, onOpen, onReschedule, onDelete, onSendToPlayer, onSendToConverter, onSendToCombine, onOpenThumbnails, onThumbClick, thumbsKey, sameDayIndex }: StreamRowProps) {
  const { meta, hasMeta, detectedGames, date, thumbnails, thumbnailLocalFlags, videoCount, videos } = folder
  const displayGames = meta?.games?.length ? meta.games : detectedGames
  const firstThumb = thumbnails[0]
  const firstThumbLocal = thumbnailLocalFlags?.[0] ?? true
  const extraThumbs = thumbnails.length - 1
  const hasSMThumbnail = thumbnails.some(t => /[_-]sm-thumbnail\./i.test(t))

  if (folder.isMissing) {
    return (
      <div className="rounded-lg border border-red-900/30 bg-red-950/10 overflow-hidden">
        <div className="aspect-video bg-red-900/20 flex items-center justify-center">
          <AlertTriangle size={20} className="text-red-700" />
        </div>
        <div className="p-2">
          <p className="text-xs font-mono text-red-400 truncate">{folder.folderName}</p>
          <p className="text-[10px] text-red-700 italic mt-0.5">Folder not found on disk</p>
        </div>
      </div>
    )
  }

  const privacyLabel = privacyStatus === 'public' ? 'Public' : privacyStatus === 'unlisted' ? 'Unlisted' : privacyStatus === 'private' ? 'Private' : null
  const PrivacyIcon = privacyStatus === 'unlisted' ? EyeOff : privacyStatus === 'private' ? Lock : privacyStatus === 'public' ? Globe : null

  return (
    <div
      className={`group rounded-lg border overflow-hidden flex flex-col transition-colors ${
        isPending
          ? 'border-teal-900/40 bg-teal-950/20 hover:bg-teal-950/30'
          : selected
            ? 'border-purple-600/40 bg-purple-900/10'
            : 'border-purple-900/25 bg-white/[0.02] hover:bg-white/[0.04] hover:border-purple-800/40'
      }`}
      onClick={selectMode ? () => onToggleSelect(false) : undefined}
      style={selectMode ? { cursor: 'pointer', userSelect: 'none' } : undefined}
    >
      {/* Thumbnail */}
      <div
        className={`relative aspect-video bg-navy-900 overflow-hidden ${onThumbClick && !selectMode ? 'cursor-zoom-in' : ''}`}
        onClick={!selectMode ? () => onThumbClick?.(0) : undefined}
      >
        {firstThumb ? (
          <>
            <ThumbImage
              path={firstThumb}
              thumbsKey={thumbsKey}
              isLocal={firstThumbLocal}
              className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-105"
              draggable={false}
              iconSize={18}
            />
            {extraThumbs > 0 && (
              <span className="absolute bottom-0.5 right-0.5 bg-black/70 text-white text-[10px] font-medium px-1 rounded leading-4 pointer-events-none">
                +{extraThumbs}
              </span>
            )}
          </>
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-1">
            <ImageOff size={18} className="text-gray-700" />
            <span className="text-[9px] text-gray-700">no thumbnail</span>
          </div>
        )}

        {/* Select checkbox overlay */}
        {selectMode && (
          <div className={`absolute inset-0 flex items-center justify-center transition-colors ${selected ? 'bg-purple-900/40' : 'bg-black/20'}`}>
            <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${selected ? 'bg-purple-700 border-purple-700' : 'border-white/60 bg-black/30'}`}>
              {selected && <CheckCheck size={12} className="text-white" />}
            </div>
          </div>
        )}

      </div>

      {/* Info */}
      <div className="flex flex-col gap-1.5 p-2.5 flex-1">
        <div className="flex flex-col">
          <div className='flex items-center justify-between'>
            <div className="flex items-center gap-1.5 mt-0.5">
              <Tooltip content={friendlyDate(date)} side="top">
                <span className="font-mono text-sm font-medium text-gray-200">{date}</span>
              </Tooltip>
              {sameDayIndex && sameDayIndex > 1 && (
                <span className="font-mono text-sm font-medium text-purple-400/70">#{sameDayIndex}</span>
              )}
              </div>
            <div className="inline-flex gap-1">
                {meta?.archived && (
                    <Tooltip content="Archived">
                        <span className="inline-flex items-center p-1 rounded bg-green-900/30 text-green-400 border border-green-800/30">
                        <Archive size={11} />
                        </span>
                    </Tooltip>
                )}
                {isPending && (
                  isNextUpcoming && meta?.ytVideoId ? (
                    <Tooltip content={isLive ? 'Live now' : (privacyLabel ? `Open in YouTube Studio · ${privacyLabel}` : 'Open in YouTube Studio')}>
                      <button
                        onClick={e => { e.stopPropagation(); window.api.openUrl(`https://studio.youtube.com/video/${meta.ytVideoId}/livestreaming`) }}
                        className={`inline-flex items-center gap-0.5 p-1 rounded border transition-colors shrink-0 ${
                          isLive
                            ? 'bg-green-900/30 text-green-400 border-green-800/30 hover:bg-green-900/50 hover:text-green-300'
                            : 'bg-teal-900/30 text-teal-400 border-teal-800/30 hover:bg-teal-900/50 hover:text-teal-300'
                        }`}
                      >
                        <Radio size={11} />
                        {PrivacyIcon && <PrivacyIcon size={11} />}
                      </button>
                    </Tooltip>
                  ) : (
                    <Tooltip content={isNextUpcoming ? "Upcoming — stream hasn't happened yet" : 'Scheduled upcoming stream'}>
                      <span className="inline-flex items-center p-1 rounded bg-teal-900/30 text-teal-400 border border-teal-800/30 shrink-0">
                        <Radio size={11} />
                      </span>
                    </Tooltip>
                  )
                )}
                {/* YT link for past streams */}
                {!isPending && meta?.ytVideoId && (
                    <Tooltip content={privacyLabel ? `YouTube · ${privacyLabel}` : 'YouTube'}>
                      <button
                        onClick={e => { e.stopPropagation(); window.api.openUrl(`https://studio.youtube.com/video/${meta.ytVideoId}`) }}
                        className="inline-flex items-center gap-0.5 p-1 rounded bg-red-900/30 text-red-400 border border-red-800/30 hover:bg-red-900/50 transition-colors shrink-0"
                      >
                        <LucideYoutube size={11} />
                        {PrivacyIcon && <PrivacyIcon size={11} />}
                      </button>
                    </Tooltip>
                  )}
            </div>
            </div>
            {(meta?.ytTitle || meta?.twitchTitle) && (
              <Tooltip content={meta.ytTitle || meta.twitchTitle} side="bottom" triggerClassName="block mt-0.5">
                <span className="text-[10px] leading-normal text-gray-400 line-clamp-2">{meta.ytTitle || meta.twitchTitle}</span>
              </Tooltip>
            )}
        </div>

        {/* Stream types */}
        {meta && normalizeStreamTypes(meta.streamType).length > 0 && (
          <div className="flex flex-wrap gap-1">
            {normalizeStreamTypes(meta.streamType).map(t => {
              const color = getTagColor(tagColors[t])
              return (
                <span key={t} className={`inline-block text-xs leading-tight px-2 py-0.5 rounded-full border ${color.chip}`} style={getTagTextureStyle(tagTextures[t])}>
                  {t}
                </span>
              )
            })}
          </div>
        )}

        {/* Games */}
        {displayGames.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {displayGames.map(g =>
              meta?.games?.includes(g) ? (
                <span key={g} className="text-[10px] leading-tight px-1.5 py-0.5 rounded-full bg-purple-900/20 text-purple-300 border border-purple-300/30">{g}</span>
              ) : (
                <Tooltip key={g} content="Detected from filename">
                  <span className="text-[10px] leading-tight px-1.5 py-0.5 rounded-full bg-white/5 text-gray-500 border border-gray-500/30 italic">{g}</span>
                </Tooltip>
              )
            )}
          </div>
        )}

        {/* Comments */}
        {meta?.comments && (
          <ClampedComment text={meta.comments} />
        )}
      </div>

      {/* Footer actions */}
      <div className="flex items-center gap-1 px-2 pb-2">
        <div className="mr-auto">
          <VideoCountTooltip videos={videos} videoMap={meta?.videoMap ?? undefined} folderPath={folder.folderPath}>
            {(() => {
              const vm = meta?.videoMap
              const fullCount = vm ? Object.values(vm).filter(e => e.category === 'full').length : videoCount
              const shortClipCount = vm ? Object.values(vm).filter(e => e.category === 'short' || e.category === 'clip').length : 0
              return (
                <div className="flex items-center gap-2 cursor-default">
                  <div className={`flex items-center gap-1 text-xs font-mono ${fullCount > 0 ? 'text-gray-400' : 'text-gray-700'}`}>
                    <Film size={11} className="shrink-0" />
                    <span>{fullCount}</span>
                  </div>
                  {shortClipCount > 0 && (
                    <div className="flex items-center gap-1 text-xs font-mono text-blue-400">
                      <Scissors size={11} className="shrink-0" />
                      <span>{shortClipCount}</span>
                    </div>
                  )}
                </div>
              )
            })()}
          </VideoCountTooltip>
        </div>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {!hasMeta && (
            <Tooltip content="No metadata">
              <span className="text-yellow-600"><AlertTriangle size={11} /></span>
            </Tooltip>
          )}
          {videoCount > 0 && (
            <Tooltip content="Send to Player">
              <button onClick={e => { e.stopPropagation(); onSendToPlayer() }} className="p-1 rounded text-gray-600 hover:text-gray-300 hover:bg-white/5 transition-colors">
                <Film size={12} />
              </button>
            </Tooltip>
          )}
          {videoCount > 0 && (
            <Tooltip content="Send to Converter">
              <button onClick={e => { e.stopPropagation(); onSendToConverter() }} className="p-1 rounded text-gray-600 hover:text-gray-300 hover:bg-white/5 transition-colors">
                <Zap size={12} />
              </button>
            </Tooltip>
          )}
          {videoCount > 1 && (
            <Tooltip content="Combine videos">
              <button onClick={e => { e.stopPropagation(); onSendToCombine() }} className="p-1 rounded text-gray-600 hover:text-gray-300 hover:bg-white/5 transition-colors">
                <Combine size={12} />
              </button>
            </Tooltip>
          )}
          <Tooltip content={hasSMThumbnail ? 'Edit thumbnail' : 'Create thumbnail'}>
            <button onClick={e => { e.stopPropagation(); onOpenThumbnails() }} className="p-1 rounded text-gray-600 hover:text-gray-300 hover:bg-white/5 transition-colors">
              <ImageIcon size={12} />
            </button>
          </Tooltip>
          <Tooltip content={hasMeta ? 'Edit metadata' : 'Add metadata'}>
            <button onClick={e => { e.stopPropagation(); hasMeta ? onEdit() : onAdd() }} className="p-1 rounded text-gray-600 hover:text-gray-300 hover:bg-white/5 transition-colors">
              <PencilLine size={12} />
            </button>
          </Tooltip>
          <Tooltip content="Open folder">
            <button onClick={e => { e.stopPropagation(); onOpen() }} className="p-1 rounded text-gray-600 hover:text-gray-300 hover:bg-white/5 transition-colors">
              <FolderOpen size={12} />
            </button>
          </Tooltip>
          {isPending && (
            <Tooltip content="Reschedule">
              <button onClick={e => { e.stopPropagation(); onReschedule() }} className="p-1 rounded text-gray-600 hover:text-gray-300 hover:bg-white/5 transition-colors">
                <CalendarClock size={12} />
              </button>
            </Tooltip>
          )}
          <Tooltip content="Delete">
            <button onClick={e => { e.stopPropagation(); onDelete() }} className="p-1 rounded text-gray-700 hover:text-red-400 hover:bg-red-500/10 transition-colors">
              <Trash2 size={12} />
            </button>
          </Tooltip>
        </div>
      </div>
    </div>
  )
}

// ─── Stream row ──────────────────────────────────────────────────────────────

interface StreamRowProps {
  folder: StreamFolder
  zebra: boolean
  selectMode: boolean
  selected: boolean
  isNextUpcoming: boolean
  isPending: boolean
  isLive: boolean
  privacyStatus?: string | null
  tagColors: Record<string, string>
  tagTextures: Record<string, string>
  onToggleSelect: (shiftKey: boolean) => void
  onDragStart: () => void
  onDragEnter: () => void
  onEdit: () => void
  onAdd: () => void
  onOpen: () => void
  onReschedule: () => void
  onDelete: () => void
  onSendToPlayer: () => void
  onSendToConverter: () => void
  onSendToCombine: () => void
  onOpenThumbnails: () => void
  onThumbClick?: (index: number) => void
  thumbsKey: number
  sameDayIndex?: number
  thumbWidth?: number
  onThumbResizeStart?: (e: React.MouseEvent) => void
}

function StreamRow({ folder, zebra, selectMode, selected, isNextUpcoming, isPending, isLive, privacyStatus, tagColors, tagTextures, onToggleSelect, onDragStart, onDragEnter, onEdit, onAdd, onOpen, onReschedule, onDelete, onSendToPlayer, onSendToConverter, onSendToCombine, onOpenThumbnails, onThumbClick, thumbsKey, sameDayIndex, thumbWidth = 85, onThumbResizeStart }: StreamRowProps) {
  if (folder.isMissing) {
    return (
      <tr className={`border-b border-red-900/30 ${zebra ? 'bg-red-950/10' : ''}`}>
        {selectMode && <td className="pl-4 align-middle" />}
        <td className="p-0 align-middle" style={{ width: thumbWidth }}>
          <div className="w-full bg-red-900/20 flex items-center justify-center" style={{ height: thumbWidth * (9 / 16) }}>
            <AlertTriangle size={14} className="text-red-700" />
          </div>
        </td>
        <td colSpan={selectMode ? 6 : 5} className="px-2 py-2 align-middle">
          <div className="flex items-center gap-3">
            <span className="text-sm font-mono text-red-400">{folder.folderName}</span>
            <span className="text-xs text-red-700 italic">Folder not found on disk</span>
          </div>
        </td>
        <td className="px-2 py-2 align-middle w-[160px]" />
      </tr>
    )
  }

  const { meta, hasMeta, detectedGames, date, thumbnails, thumbnailLocalFlags, videoCount, videos } = folder
  const displayGames = meta?.games?.length ? meta.games : detectedGames
  const firstThumb = thumbnails[0]
  const firstThumbLocal = thumbnailLocalFlags?.[0] ?? true
  const extraCount = thumbnails.length - 1
  const hasSMThumbnail = thumbnails.some(t => /[_-]sm-thumbnail\./i.test(t))

  return (
    <tr
      className={`border-b group transition-colors ${
        isPending
          ? `border-teal-900/30 hover:bg-teal-900/30 ${zebra ? 'bg-teal-900/20' : 'bg-teal-900/15'}`
          : `border-white/5 hover:bg-white/[0.03] ${zebra ? 'bg-white/[0.02]' : ''}`
      } ${selected ? 'bg-purple-900/10' : ''}`}
      onClick={selectMode ? (e) => onToggleSelect(e.shiftKey) : undefined}
      onMouseDown={selectMode ? (e) => { e.preventDefault(); onDragStart() } : undefined}
      onMouseEnter={selectMode ? onDragEnter : undefined}
      style={selectMode ? { cursor: 'pointer', userSelect: 'none' } : undefined}
    >

      {/* Checkbox */}
      {selectMode && (
        <td className="pl-4 align-middle" onClick={e => { e.stopPropagation(); onToggleSelect(e.shiftKey) }}>
          <div className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${selected ? 'bg-purple-700 border-purple-700' : 'border-gray-600 hover:border-gray-400'}`}>
            {selected && <CheckCheck size={10} className="text-white" />}
          </div>
        </td>
      )}

      {/* Thumbnail */}
      <td className="p-0 align-middle relative" style={{ width: thumbWidth }}>
        <div
          className={`relative overflow-hidden shrink-0 ${onThumbClick ? 'cursor-zoom-in' : ''}`}
          style={{ width: thumbWidth, height: thumbWidth * (9 / 16) }}
          onClick={() => onThumbClick?.(0)}
        >
          {firstThumb ? (
            <>
              <ThumbImage
                path={firstThumb}
                thumbsKey={thumbsKey}
                isLocal={firstThumbLocal}
                className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-105"
                draggable={false}
                iconSize={12}
              />
              {onThumbClick && (
                <div className="absolute inset-0 bg-black/0 hover:bg-black/35 transition-colors flex items-center justify-center group/thumb">
                  <Expand size={14} className="text-white opacity-0 group-hover/thumb:opacity-100 transition-opacity drop-shadow" />
                </div>
              )}
              {extraCount > 0 && (
                <span className="absolute bottom-0.5 right-0.5 bg-black/70 text-white text-[10px] font-medium px-1 rounded leading-4 pointer-events-none">
                  +{extraCount}
                </span>
              )}
            </>
          ) : (
            <div className="w-full h-full bg-white/5 flex flex-col items-center justify-center gap-0.5">
              <ImageOff size={14} className="text-gray-700" />
              <span className="text-[9px] text-gray-700 leading-none">none</span>
            </div>
          )}
        </div>
        {/* Resize handle */}
        <div
          className="group/resize absolute top-0 right-0 w-2 h-full cursor-ew-resize z-10"
          onMouseDown={onThumbResizeStart}
        >
          <div className="absolute top-0 right-0 w-px h-full bg-purple-500 opacity-0 group-hover/resize:opacity-100 transition-opacity" />
        </div>
      </td>

      {/* Video count */}
      <td className="px-2 py-2 align-middle w-[44px]">
        <VideoCountTooltip videos={videos} videoMap={meta?.videoMap ?? undefined} folderPath={folder.folderPath}>
          {(() => {
            const vm = meta?.videoMap
            const fullCount = vm ? Object.values(vm).filter(e => e.category === 'full').length : videoCount
            const shortClipCount = vm ? Object.values(vm).filter(e => e.category === 'short' || e.category === 'clip').length : 0
            return (
              <div className="flex flex-col items-center gap-0.5 cursor-default">
                <div className={`flex items-center gap-1 text-xs font-mono ${fullCount > 0 ? 'text-gray-400' : 'text-gray-700'}`}>
                  <Film size={11} className="shrink-0" />
                  <span>{fullCount}</span>
                </div>
                {shortClipCount > 0 && (
                  <div className="flex items-center gap-1 text-xs font-mono text-blue-400">
                    <Scissors size={11} className="shrink-0" />
                    <span>{shortClipCount}</span>
                  </div>
                )}
              </div>
            )
          })()}
        </VideoCountTooltip>
      </td>

      {/* Date */}
      <td className="p-1 align-middle min-w-[220px]">
        <div className="flex items-center justify-between gap-1.5 w-full">
          <div className="inline-flex gap-1 mt-0.5">
            <Tooltip content={friendlyDate(date)} side="top">
                <span className="font-mono text-sm text-gray-200">{date}</span>
            </Tooltip>
            {sameDayIndex && sameDayIndex > 1 && (
                <span className="font-mono text-sm text-purple-400/70 font-semibold">#{sameDayIndex}</span>
            )}
          </div>
          <div className="inline-flex gap-1">
              {meta?.archived && (
                <Tooltip content="Archived">
                  <span className="inline-flex items-center p-0.5 rounded bg-green-900/30 text-green-400 border border-green-800/30 shrink-0">
                    <Archive size={12} />
                  </span>
                </Tooltip>
              )}
              {isPending && (
                isNextUpcoming && meta?.ytVideoId ? (() => {
                  const privacyLabel = privacyStatus === 'public' ? 'Public' : privacyStatus === 'unlisted' ? 'Unlisted' : privacyStatus === 'private' ? 'Private' : null
                  const liveLabel = isLive ? 'Live now' : 'Open in YouTube Studio'
                  const tooltipText = privacyLabel ? `${liveLabel} · ${privacyLabel}` : liveLabel
                  const PrivacyIcon = privacyStatus === 'unlisted' ? EyeOff : privacyStatus === 'private' ? Lock : privacyStatus === 'public' ? Globe : null
                  return (
                    <Tooltip content={tooltipText}>
                      <button
                        onClick={e => { e.stopPropagation(); window.api.openUrl(`https://studio.youtube.com/video/${meta.ytVideoId}/livestreaming`) }}
                        className={`inline-flex items-center gap-0.5 p-0.5 rounded border transition-colors shrink-0 ${
                          isLive
                            ? 'bg-green-900/30 text-green-400 border-green-800/30 hover:bg-green-900/50 hover:text-green-300'
                            : 'bg-teal-900/30 text-teal-400 border-teal-800/30 hover:bg-teal-900/50 hover:text-teal-300'
                        }`}
                      >
                        <Radio size={12} />
                        {PrivacyIcon && <PrivacyIcon size={12} />}
                      </button>
                    </Tooltip>
                  )
                })() : (
                  <Tooltip content={isNextUpcoming ? 'Upcoming — stream hasn\'t happened yet' : 'Scheduled upcoming stream'}>
                    <span className="inline-flex items-center p-0.5 rounded bg-teal-900/30 text-teal-400 border border-teal-800/30 shrink-0">
                      <Radio size={12} />
                    </span>
                  </Tooltip>
                )
              )}
            {!isPending && meta?.ytVideoId && (() => {
                const privacyLabel = privacyStatus === 'public' ? 'Public' : privacyStatus === 'unlisted' ? 'Unlisted' : privacyStatus === 'private' ? 'Private' : null
                const PrivacyIcon = privacyStatus === 'unlisted' ? EyeOff : privacyStatus === 'private' ? Lock : privacyStatus === 'public' ? Globe : null
                return (
                <Tooltip content={privacyLabel ? `Edit on YouTube · ${privacyLabel}` : 'Edit on YouTube'}>
                    <button
                    onClick={e => { e.stopPropagation(); window.api.openUrl(`https://studio.youtube.com/video/${meta.ytVideoId}`) }}
                    className="inline-flex items-center gap-0.5 p-0.5 rounded bg-red-900/30 text-red-400 border border-red-800/30 hover:bg-red-900/50 hover:text-red-300 transition-colors shrink-0"
                    >
                    <LucideYoutube size={12} />
                    {PrivacyIcon && <PrivacyIcon size={12} />}
                    </button>
                </Tooltip>
                )
            })()}
          </div>
        </div>
        {(meta?.ytTitle || meta?.twitchTitle) && (
          <Tooltip content={meta.ytTitle || meta.twitchTitle} side="bottom" triggerClassName="block">
            <div className="text-[10px] leading-normal text-gray-400 truncate max-w-[204px] overflow-auto">{meta.ytTitle || meta.twitchTitle}</div>
          </Tooltip>
        )}
      </td>

      {/* Type */}
      <td className="px-2 py-2 align-middle">
        {meta ? (
          <div className="flex flex-wrap gap-1">
            {normalizeStreamTypes(meta.streamType).map(t => {
              const color = getTagColor(tagColors[t])
              return (
                <span key={t} className={`inline-block text-xs leading-tight px-2 py-0.5 rounded-full border ${color.chip}`} style={getTagTextureStyle(tagTextures[t])}>
                  {t}
                </span>
              )
            })}
          </div>
        ) : (
          <span className="text-xs text-gray-700">—</span>
        )}
      </td>

      {/* Games */}
      <td className="px-2 py-2 align-middle max-w-[240px]">
        {displayGames.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {displayGames.map(g =>
              meta?.games?.includes(g) ? (
                <span
                  key={g}
                  className="text-[10px] leading-tight px-1.5 py-0.5 rounded-full bg-purple-900/20 text-purple-300 border border-purple-300/30"
                >
                  {g}
                </span>
              ) : (
                <Tooltip key={g} content="Detected from filename">
                  <span className="text-[10px] leading-tight px-1.5 py-0.5 rounded-full bg-white/5 text-gray-500 border border-gray-500/30 italic">
                    {g}
                  </span>
                </Tooltip>
              )
            )}
          </div>
        ) : (
          <span className="text-xs text-gray-700">—</span>
        )}
      </td>

      {/* Comments */}
      <td className="px-2 py-2 align-middle hidden xl:table-cell">
        {meta?.comments ? (
          <ClampedComment text={meta.comments} />
        ) : (
          <span className="text-xs text-gray-700">—</span>
        )}
      </td>

      {/* Actions */}
      <td className="px-2 py-2 align-middle">
        <div className="flex items-center justify-end opacity-0 group-hover:opacity-100 transition-opacity">
          {!hasMeta && (
            <span className="flex items-center gap-1 text-xs text-yellow-600 mr-1 shrink-0">
              <AlertTriangle size={11} />
              No meta
            </span>
          )}
          {videoCount > 0 && <Tooltip content="Send to Player"><Button variant="ghost" size="icon-sm" icon={<Film size={12} />} onClick={onSendToPlayer} /></Tooltip>}
          {videoCount > 0 && <Tooltip content="Send to Converter"><Button variant="ghost" size="icon-sm" icon={<Zap size={12} />} onClick={onSendToConverter} /></Tooltip>}
          {videoCount > 1 && (
            <Tooltip content="Send to Combine"><Button variant="ghost" size="icon-sm" icon={<Combine size={12} />} onClick={onSendToCombine} /></Tooltip>
          )}
          <Tooltip content={hasSMThumbnail ? 'Edit Stream Manager Thumbnail' : 'Create Stream Manager Thumbnail'}>
            <Button variant="ghost" size="icon-sm" icon={<ImageIcon size={12} />} onClick={onOpenThumbnails} />
          </Tooltip>
          <Tooltip content={hasMeta ? 'Edit metadata' : 'Add metadata'}>
            <Button
              variant="ghost"
              size="icon-sm"
              icon={<PencilLine size={12} />}
              onClick={hasMeta ? onEdit : onAdd}
            />
          </Tooltip>
          <Tooltip content="Open folder">
            <Button variant="ghost" size="icon-sm" icon={<FolderOpen size={12} />} onClick={onOpen} />
          </Tooltip>
          {isPending && (
            <Tooltip content="Reschedule">
              <Button variant="ghost" size="icon-sm" icon={<CalendarClock size={12} />} onClick={onReschedule} />
            </Tooltip>
          )}
          <div className="w-px h-3.5 bg-white/10" />
          <Tooltip content="Delete folder">
            <button
              onClick={onDelete}
              className="p-2 rounded-lg text-gray-700 hover:text-red-400 hover:bg-red-500/10 transition-colors"
            >
              <Trash2 size={12} />
            </button>
          </Tooltip>
        </div>
      </td>
    </tr>
  )
}
