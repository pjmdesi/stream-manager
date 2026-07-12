// ⚠️  LEGACY FILE — kept temporarily for its shared exports:
//     VideoCountTooltip, ThumbnailCarousel, PresetPickerModal,
//     SaveAsTemplateButton, BulkTagModal
//
// The old StreamsPage component (and its MetaModal / StreamCard /
// StreamRow / TreeView / various helpers) are now dead code — they're
// no longer referenced from App.tsx after the switchover to the new
// list+sidebar streams page. Plan to extract the 5 shared exports into
// dedicated files under `components/streams/` and delete this file
// entirely in a follow-up pass.
import React, { useState, useEffect, useCallback, useMemo, useRef, useLayoutEffect } from 'react'
import { flushSync } from 'react-dom'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import ReactDOM from 'react-dom'
import {
  Plus, FolderOpen, AlertTriangle, PencilLine, CopyPlus,
  RefreshCw, Radio, X, ChevronDown, ImageOff,
  ChevronLeft, ChevronRight, ChevronUp, ChevronsUp, ChevronsDown, Expand, Archive, CheckSquare,
  Square, CheckCheck, Loader2, CheckCircle2, XCircle, Check,
  Film, Scissors, Zap, Combine, ListFilter, Trash2, Tags, CalendarClock, Info, Sparkles, SquareDashedText,
  Globe, EyeOff, Lock, Image as ImageIcon, CloudOff, Cloud, CloudCheck, CloudDownload, LayoutList, LayoutGrid, List,
  RadioTower, Clapperboard, Unlink2, Bookmark
} from 'lucide-react'

import { Youtube as LucideYoutube, Twitch as LucideTwitch } from '../ui/BrandIcons'
import { VideoRow } from '../ui/VideoRow'
import { getCachedHydration, rememberHydration, stalePaths, subscribeHydration } from '../../lib/hydrationCache'
import { videoMapKey } from '../../lib/videoMapKey'
import { v4 as uuidv4 } from 'uuid'
import type { StreamFolder, StreamMeta, ConversionPreset, ConversionJob, YTTitleTemplate, YTDescriptionTemplate, YTTagTemplate, TwitchTagTemplate, LiveBroadcast, ThumbnailTemplate } from '../../types'
import { useStore } from '../../hooks/useStore'
import { ytTagCharCount, YT_TAG_CHAR_LIMIT } from '../../lib/ytTagCount'
import { toTwitchCompatibleTags, TWITCH_TAG_MAX_COUNT } from '../../lib/twitchTags'
import { useThumbnailEditor } from '../../context/ThumbnailEditorContext'
import { useFieldSuggestion } from '../../hooks/useFieldSuggestion'
import { useMediaQuery } from '../../hooks/useMediaQuery'
import { useAnimationConfig } from '../../hooks/useAnimationConfig'
import { GhostTextArea } from '../ui/GhostTextArea'
import type { GhostTextAreaHandle } from '../ui/GhostTextArea'
import { Button } from '../ui/Button'
import { Modal, useModalOpenRegistration } from '../ui/Modal'
import { TagComboBox } from '../ui/TagComboBox'
import { BroadcastPicker, BroadcastLinkRef } from '../ui/BroadcastPicker'
import { ManageTagsModal } from '../ui/ManageTagsModal'
import { TemplatesModal } from '../ui/TemplatesModal'
import { useCloudOps } from '../../context/CloudOpsContext'
import { useRelayPrompt } from '../../context/RelayPromptContext'
import { useConversionJobs } from '../../context/ConversionContext'
import { Checkbox } from '../ui/Checkbox'
import { Tooltip } from '../ui/Tooltip'
import { TruncatedText } from '../ui/TruncatedText'
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

// Session-level set of paths the cloud provider has finished downloading
// during this app run. Populated by a module-scoped subscription to the
// main-process IPC event. Reads from here let a freshly-mounted
// ThumbImage know that a sibling instance (or a previous mount) already
// got the file local, even though the `isLocal` prop coming from
// folder.thumbnailLocalFlags is still stale (the folder data hasn't been
// re-scanned yet). Treating "downloaded this session" as equivalent to
// `isLocal` here avoids re-triggering the cloud download when, e.g., the
// lightbox opens on the same path the inline carousel just hydrated.
const DOWNLOADED_PATHS = new Set<string>()
if (typeof window !== 'undefined' && window.api?.onCloudDownloadDone) {
  window.api.onCloudDownloadDone((filePath: string) => {
    DOWNLOADED_PATHS.add(filePath)
  })
}

function ThumbImage({ path, thumbsKey, isLocal = true, hydrate = false, className, style, placeholderClassName, placeholderStyle, draggable, iconSize = 14, onLoad }: {
  path: string
  thumbsKey: number
  /** False = file is a cloud placeholder. Default true (legacy callers / sites
   *  where local-flag isn't computed). */
  isLocal?: boolean
  /** When true and the file isn't local, request a cloud download. Used by the
   *  active image in carousels/lightbox so the user can preview by navigating. */
  hydrate?: boolean
  className?: string
  /** Inline style for the loaded <img>. Useful for size constraints that
   *  can't be expressed cleanly in Tailwind (e.g. min(…, calc(…))). */
  style?: React.CSSProperties
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
  // Effective "is local" combines the prop (from folder.thumbnailLocalFlags)
  // with the session-level downloaded-paths set. A path that's been
  // downloaded earlier this session is treated as local even if the
  // folder data hasn't been re-scanned to flip the flag yet — that's
  // what stops the lightbox from re-downloading a file the inline
  // carousel just hydrated.
  const effectiveIsLocal = isLocal || DOWNLOADED_PATHS.has(path)
  const [status, setStatus] = useState<'loading' | 'loaded' | 'syncing' | 'cloud' | 'error'>(
    effectiveIsLocal ? 'loading' : (hydrate ? 'syncing' : 'cloud')
  )
  const [reloadKey, setReloadKey] = useState(0)

  // Reset whenever the file identity (path / cache-key / local-ness) changes —
  // a different file means the loaded image is stale.
  useEffect(() => {
    setStatus(effectiveIsLocal ? 'loading' : (hydrate ? 'syncing' : 'cloud'))
    // hydrate intentionally NOT in deps: it flips for every carousel slot when
    // the active item changes, and resetting a local file to 'loading' would
    // re-show the placeholder over a cached <img> whose onLoad never re-fires.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, thumbsKey, effectiveIsLocal])

  // Hydrate transitions (cloud → syncing or back) only matter for non-local
  // files that haven't loaded yet. Never disturb 'loaded'/'loading' here.
  useEffect(() => {
    if (effectiveIsLocal) return
    setStatus(prev => prev === 'loaded' || prev === 'loading' ? prev : (hydrate ? 'syncing' : 'cloud'))
  }, [hydrate, effectiveIsLocal])

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

  const src = `${toFileUrl(path)}?t=${thumbsKey}&r=${reloadKey}`
  const imgRef = useRef<HTMLImageElement>(null)

  // Catch the "cached on second visit" case: when the user navigates
  // away from this stream and back, the <img> remounts with the same
  // src. The browser serves it from cache and the load event can fire
  // BEFORE React attaches its `onLoad` handler — leaving status stuck
  // at 'loading' and the dark placeholder permanently overlaying the
  // image. Reading `img.complete && naturalHeight > 0` after mount
  // detects images that already finished loading and flips status to
  // 'loaded' even when no load event ever reached our handler.
  //
  // MUST live above the cloud/syncing/error early-return below — those
  // states don't render the <img>, but React tracks hook order across
  // ALL renders of this component, so hooks gated behind a conditional
  // return would change the call sequence when status transitions
  // (e.g., cloud → loading during hydration) and trip Rules of Hooks.
  useLayoutEffect(() => {
    if (status !== 'loading') return
    const el = imgRef.current
    if (el && el.complete && el.naturalHeight > 0) {
      setStatus('loaded')
      onLoad?.()
    }
  }, [src, status, onLoad])

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

  return (
    <>
      <img
        ref={imgRef}
        src={src}
        // Decode off the main thread so a burst of thumbnails doesn't stutter
        // the detail-sidebar slide animation.
        decoding="async"
        className={className}
        style={style}
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

/** Module-level cache for shell-thumbnail data URLs, keyed by
 *  `${path}@${thumbsKey}`. OS thumbnails are stable until the underlying
 *  file changes, so the cache is valid for the session — and re-opening the
 *  picker doesn't re-issue IPC calls. Bust by bumping thumbsKey. */
const NATIVE_THUMB_CACHE = new Map<string, string | null>()
const NATIVE_THUMB_INFLIGHT = new Map<string, Promise<string | null>>()

/** Lightweight <img> wrapper that displays the OS shell thumbnail for a file
 *  via files:getNativeThumbnail. Decodes a few-KB PNG instead of the full
 *  source image — drops the picker's per-image bitmap cost by ~100×, which
 *  is the difference between a snappy grid and a stalled renderer when
 *  there are 50+ thumbnails. Falls back to the raw file:// URL if the OS
 *  has no cached thumbnail (rare on Windows; reasonable cross-platform). */
export function PickerThumbImage({ path, thumbsKey, alt }: { path: string; thumbsKey?: number; alt: string }) {
  const cacheKey = `${path}@${thumbsKey ?? 0}`
  // Lazy useState initializer — runs once per mount, pulls any cached value
  // synchronously so the <img> renders with a real src on the first paint.
  const [dataUrl, setDataUrl] = useState<string | null | undefined>(() => NATIVE_THUMB_CACHE.get(cacheKey))
  // Tracks whether the underlying <img> finished decoding. Stays false while
  // the IPC is in flight, AND while the <img> is loading/decoding the data
  // URL — including the indefinite period when loading="lazy" is deferring
  // the load because the element is offscreen. We use it to keep a spinner
  // visible the entire time and avoid the broken-image flash.
  const [imgLoaded, setImgLoaded] = useState(false)

  useEffect(() => {
    // Cached values are already in state via the useState initializer. Don't
    // touch imgLoaded here — the <img>'s onLoad can fire synchronously for
    // a data URL on the same render, and an effect-level reset would race
    // against (and clobber) that onLoad, leaving the spinner stuck forever.
    if (NATIVE_THUMB_CACHE.has(cacheKey)) return
    let cancelled = false
    // Dedupe in-flight requests so React strict-mode double-mount or
    // multiple visible instances of the same path don't fire duplicate IPC.
    let p = NATIVE_THUMB_INFLIGHT.get(cacheKey)
    if (!p) {
      p = window.api.getNativeThumbnail(path).catch(() => null).then(url => {
        NATIVE_THUMB_CACHE.set(cacheKey, url)
        NATIVE_THUMB_INFLIGHT.delete(cacheKey)
        return url
      })
      NATIVE_THUMB_INFLIGHT.set(cacheKey, p)
    }
    p.then(url => { if (!cancelled) setDataUrl(url) })
    return () => { cancelled = true }
  }, [cacheKey, path])

  // Fall back to the direct file:// URL when the OS has no thumbnail to give
  // (still rendered with loading="lazy" so it defers until near-viewport).
  const fallback = `${toFileUrl(path)}${thumbsKey ? `?t=${thumbsKey}` : ''}`
  const src = dataUrl === undefined ? undefined : (dataUrl ?? fallback)
  return (
    <>
      {src !== undefined && (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          onLoad={() => setImgLoaded(true)}
          className="w-full h-full object-cover"
        />
      )}
      {!imgLoaded && (
        <div className="absolute inset-0 flex items-center justify-center bg-navy-900 pointer-events-none">
          <Loader2 size={12} className="animate-spin text-gray-400" />
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

// videoMapKey moved to lib/videoMapKey so the modern page + files grid share
// the same lookup rule (basename-only lookups miss subfolder entries).

/** A stream is "pending" when it hasn't aired yet:
 *   - missing or archived → never pending
 *   - past date           → never pending
 *   - future date         → always pending (don't second-guess pre-staged files)
 *   - today               → pending until a full recording (category 'full', i.e. a
 *                           "vid"-tagged file) dated today appears in the folder.
 *                           Clips and shorts don't auto-flip the badge — those can
 *                           legitimately be pre-staged for the upcoming session. */
function isPendingStream(folder: import('../../types').StreamFolder, todayStr: string): boolean {
  if (folder.isMissing || folder.meta?.archived) return false
  if (folder.date < todayStr) return false
  if (folder.date > todayStr) return true
  const map = folder.meta?.videoMap
  return !folder.videos.some(v => {
    const name = v.split(/[\\/]/).pop() ?? ''
    if (!name.startsWith(folder.date)) return false
    const key = videoMapKey(folder.folderPath, v)
    return map?.[key]?.category === 'full'
  })
}

export function VideoCountTooltip({ videos, videoMap, folderPath, cloudSyncActive, onVideoClick, children }: { videos: string[]; videoMap?: Record<string, import('../../types').VideoEntry>; folderPath: string; cloudSyncActive: boolean; onVideoClick?: (path: string) => void; children: React.ReactNode }) {
  const [visible, setVisible] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number; maxHeight?: number; maxWidth?: number }>({ top: 0, left: 0 })
  // Per-file hydration, re-checked on every hover (a cached duration says
  // nothing about a file's *current* local/offloaded state). VideoRow handles
  // its own duration/encoding probing from here. Seeded from the shared
  // cross-surface cache so a re-hover (or a hover after the stream's been
  // opened) shows the last-known cloud icons immediately instead of re-spinning.
  const [localStatus, setLocalStatus] = useState<Record<string, boolean>>(() => getCachedHydration(videos))
  const anchorRef = useRef<HTMLDivElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  // Grace timer for crossing the 6px anchor→tooltip gap. The old instant
  // close on mouseleave made the tooltip's click rows nearly unreachable —
  // leaving the anchor killed it before the pointer arrived.
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cancelClose = () => {
    if (closeTimerRef.current) { clearTimeout(closeTimerRef.current); closeTimerRef.current = null }
  }
  const scheduleClose = () => {
    cancelClose()
    closeTimerRef.current = setTimeout(() => { setVisible(false); closeTimerRef.current = null }, 150)
  }
  useEffect(() => cancelClose, [])

  // Mirror shared-cache status changes into this tooltip's state while mounted
  // — the files grid's check (or a completed download) keeps our icons honest
  // without a hover-time re-check.
  useEffect(() => {
    const mine = new Set(videos)
    return subscribeHydration((path, isLocal) => {
      if (!mine.has(path)) return
      setLocalStatus(prev => prev[path] === isLocal ? prev : { ...prev, [path]: isLocal })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videos.join('|')])

  // Initial position: just below the anchor. useLayoutEffect repositions if it overflows.
  const show = async () => {
    if (!anchorRef.current) return
    cancelClose()
    const rect = anchorRef.current.getBoundingClientRect()
    setPos({ top: rect.bottom + 6, left: rect.left })
    setVisible(true)

    if (videos.length === 0) return
    // Adopt whatever the shared cache already knows (the sidebar's grid may
    // have just verified these), then re-check only the paths whose status is
    // missing or older than the shared TTL — hovering right after opening the
    // sidebar shouldn't repeat the exact check the grid just ran.
    const cached = getCachedHydration(videos)
    if (Object.keys(cached).length) setLocalStatus(prev => ({ ...prev, ...cached }))
    const toCheck = stalePaths(videos)
    if (toCheck.length === 0) return
    const localFlags = await window.api.checkLocalFiles(toCheck)
    const updates: Record<string, boolean> = {}
    toCheck.forEach((v, i) => { updates[v] = !!localFlags[i] })
    rememberHydration(updates)
    setLocalStatus(prev => ({ ...prev, ...updates }))
  }

  // After the tooltip renders, fit it inside the viewport. Vertically: flip
  // above the anchor if there's no room below; cap height + scroll if neither
  // side has enough. Horizontally: the tooltip grows with its content (no
  // hard cap on width), but if the natural width pushes it off-screen we
  // shift it leftward and impose a maxWidth that triggers filename
  // truncation only as a last resort.
  useLayoutEffect(() => {
    if (!visible || !anchorRef.current || !tooltipRef.current) return
    const anchor = anchorRef.current.getBoundingClientRect()
    // Use scrollHeight/scrollWidth, not getBoundingClientRect, for the
    // cap decisions. The bounding rect returns the *clamped* size when
    // maxHeight/maxWidth is already applied — using it caused an
    // infinite update loop on tall tooltips:
    //   iter 1: natural height 800 > space 600 → apply maxHeight=600
    //   iter 2: rect height now 600, fits in space → drop maxHeight
    //   iter 3: natural height 800 again → re-apply cap → loop
    // scrollHeight/scrollWidth always report the natural content size
    // regardless of the cap, so the decision stays stable.
    const tipNaturalHeight = tooltipRef.current.scrollHeight
    const tipNaturalWidth = tooltipRef.current.scrollWidth
    const vw = window.innerWidth
    const vh = window.innerHeight
    const GAP = 6
    const PAD = 8

    // Vertical
    const spaceBelow = vh - anchor.bottom - GAP - PAD
    const spaceAbove = anchor.top - GAP - PAD
    const next: { top: number; left: number; maxHeight?: number; maxWidth?: number } = { top: anchor.bottom + GAP, left: anchor.left }
    if (tipNaturalHeight <= spaceBelow) {
      next.top = anchor.bottom + GAP
    } else if (tipNaturalHeight <= spaceAbove) {
      next.top = anchor.top - tipNaturalHeight - GAP
    } else if (spaceBelow >= spaceAbove) {
      next.top = anchor.bottom + GAP
      next.maxHeight = Math.max(80, spaceBelow)
    } else {
      next.maxHeight = Math.max(80, spaceAbove)
      next.top = anchor.top - next.maxHeight - GAP
    }

    // Horizontal — clamp left so the tooltip stays on-screen, then cap
    // width if there still isn't enough room. The filename column inside
    // is `1fr` with `truncate`, so it only ellipsises when the grid is
    // forced narrower than its natural content width.
    const maxAvailWidth = vw - PAD * 2
    if (tipNaturalWidth > maxAvailWidth) next.maxWidth = maxAvailWidth
    const effectiveWidth = Math.min(tipNaturalWidth, next.maxWidth ?? tipNaturalWidth)
    if (anchor.left + effectiveWidth > vw - PAD) {
      next.left = Math.max(PAD, vw - effectiveWidth - PAD)
    }

    if (
      next.top !== pos.top ||
      next.left !== pos.left ||
      next.maxHeight !== pos.maxHeight ||
      next.maxWidth !== pos.maxWidth
    ) setPos(next)
  }, [visible, videos.length, localStatus, pos.top, pos.left, pos.maxHeight, pos.maxWidth])

  if (videos.length === 0) return <>{children}</>

  return (
    <>
      <div ref={anchorRef} onMouseEnter={show} onMouseLeave={scheduleClose}>
        {children}
      </div>
      {visible && ReactDOM.createPortal(
        <div
          ref={tooltipRef}
          style={{
            position: 'fixed',
            top: pos.top,
            left: pos.left,
            zIndex: 9999,
            maxHeight: pos.maxHeight,
            maxWidth: pos.maxWidth,
            overflowY: pos.maxHeight ? 'auto' : undefined,
          }}
          className="bg-navy-700 border border-white/10 rounded-lg shadow-xl p-1.5 min-w-[320px] max-w-[460px] flex flex-col gap-0.5"
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
          // Portals bubble through the REACT tree, not the DOM — without this
          // stop, a row click inside the tooltip also fired the stream row's
          // own click handler and toggled the sidebar.
          onClick={e => e.stopPropagation()}
        >
          {/* Each video is a shared VideoRow (thumbnail + filename + encoding /
              timecode / size + hydration). Clicking a row hands the path to
              onVideoClick (streams page: open the sidebar + flash the file in
              the media grid) — direct file access stays behind the sidebar's
              Open Folder button by design. */}
          {videos.map(v => {
            const name = v.split(/[\\/]/).pop() ?? v
            const relKey = videoMapKey(folderPath, v)
            // For nested files (clips/, recordings/, …), show the sub-folder
            // path so the user can tell which file is which.
            const display = relKey.includes('/') ? relKey : name
            return (
              <VideoRow
                key={v}
                path={v}
                displayName={display}
                entry={videoMap?.[relKey]}
                isLocal={localStatus[v]}
                cloudSyncActive={cloudSyncActive}
                onClick={onVideoClick ? () => { setVisible(false); onVideoClick(v) } : undefined}
              />
            )
          })}
        </div>,
        document.body
      )}
    </>
  )
}

/**
 * Right-side hover tooltip listing every episode in a series+season. The user
 * can mouse INTO the tooltip (short hide delay so a brief gap between anchor
 * and popup doesn't dismiss), and clicking an episode jumps to that row in the
 * list. The currently-open episode is highlighted and not clickable. Falls
 * back to rendering just the children when there's only one episode in scope.
 */
function SeriesEpisodesTooltip({
  episodes, currentFolderPath, onJump, children,
}: {
  episodes: StreamFolder[]
  currentFolderPath: string
  onJump: (folder: StreamFolder) => void
  children: React.ReactNode
}) {
  const [visible, setVisible] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number; maxHeight?: number; maxWidth?: number }>({ top: 0, left: 0 })
  const anchorRef = useRef<HTMLSpanElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const hideTimerRef = useRef<number | null>(null)

  const show = () => {
    if (hideTimerRef.current) { clearTimeout(hideTimerRef.current); hideTimerRef.current = null }
    if (!anchorRef.current) return
    const rect = anchorRef.current.getBoundingClientRect()
    setPos({ top: rect.top, left: rect.right + 6 })
    setVisible(true)
  }
  const scheduleHide = () => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
    hideTimerRef.current = window.setTimeout(() => setVisible(false), 120)
  }
  useEffect(() => () => { if (hideTimerRef.current) clearTimeout(hideTimerRef.current) }, [])

  // Right-side preferred; flip left when there's no room. Vertically clamp
  // into the viewport, capping height with scroll if the list is taller than
  // the available space. Uses scrollHeight/scrollWidth (not the clamped rect)
  // to avoid the maxHeight/maxWidth feedback loop noted in VideoCountTooltip.
  useLayoutEffect(() => {
    if (!visible || !anchorRef.current || !tooltipRef.current) return
    const anchor = anchorRef.current.getBoundingClientRect()
    const tipH = tooltipRef.current.scrollHeight
    const tipW = tooltipRef.current.scrollWidth
    const vw = window.innerWidth
    const vh = window.innerHeight
    const GAP = 6
    const PAD = 8

    const next: { top: number; left: number; maxHeight?: number; maxWidth?: number } = {
      top: anchor.top,
      left: anchor.right + GAP,
    }
    if (next.left + tipW > vw - PAD) {
      const leftSide = anchor.left - tipW - GAP
      if (leftSide >= PAD) {
        next.left = leftSide
      } else {
        next.maxWidth = Math.max(180, vw - next.left - PAD)
      }
    }
    if (tipH > vh - PAD * 2) {
      next.top = PAD
      next.maxHeight = vh - PAD * 2
    } else if (next.top + tipH > vh - PAD) {
      next.top = Math.max(PAD, vh - tipH - PAD)
    }

    if (
      next.top !== pos.top ||
      next.left !== pos.left ||
      next.maxHeight !== pos.maxHeight ||
      next.maxWidth !== pos.maxWidth
    ) setPos(next)
  }, [visible, episodes.length, pos.top, pos.left, pos.maxHeight, pos.maxWidth])

  if (episodes.length <= 1) return <>{children}</>

  return (
    <>
      <span ref={anchorRef} onMouseEnter={show} onMouseLeave={scheduleHide}>
        {children}
      </span>
      {visible && ReactDOM.createPortal(
        <div
          ref={tooltipRef}
          style={{
            position: 'fixed',
            top: pos.top,
            left: pos.left,
            zIndex: 9999,
            maxHeight: pos.maxHeight,
            maxWidth: pos.maxWidth,
            overflowY: pos.maxHeight ? 'auto' : undefined,
          }}
          className="bg-navy-700 border border-white/10 rounded-lg shadow-xl py-1 min-w-[220px] max-w-md"
          onMouseEnter={show}
          onMouseLeave={scheduleHide}
        >
          {episodes.map(ep => {
            const isCurrent = ep.folderPath === currentFolderPath
            const epNum = ep.meta?.ytEpisode || '?'
            const title = ep.meta?.ytTitle || ep.meta?.games?.join(', ') || ep.date
            const inner = (
              <div className="flex items-baseline gap-2 px-3 py-1 text-xs">
                <span className={`tabular-nums shrink-0 w-6 text-right ${isCurrent ? 'text-purple-300' : 'text-gray-400'}`}>{epNum}:</span>
                <span className={`tabular-nums shrink-0 ${isCurrent ? 'text-purple-300' : 'text-gray-400'}`}>{ep.date}</span>
                <span className={`shrink-0 ${isCurrent ? 'text-purple-300' : 'text-gray-400'}`}>·</span>
                <TruncatedText text={title} className={`truncate ${isCurrent ? 'text-purple-300 font-medium' : 'text-gray-200'}`} />
              </div>
            )
            return isCurrent ? (
              <div key={ep.folderPath} className="bg-purple-900/25 cursor-default">{inner}</div>
            ) : (
              <button
                key={ep.folderPath}
                onClick={() => { setVisible(false); onJump(ep) }}
                className="block w-full text-left hover:bg-white/5 transition-colors"
              >
                {inner}
              </button>
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
  /** Fired when the user confirms a delete in the inline confirm pair.
   *  Caller is expected to move the file to the recycle bin and refresh
   *  the source thumbnails list so the lightbox re-renders without it. */
  onDeleteImage?: (path: string) => Promise<void> | void
  /** Non-null disables the delete control for the CURRENT image, with
   *  this text as the tooltip reason (e.g. the image is open in the
   *  thumbnail editor — same guard the files grid applies). */
  deleteBlockReason?: string | null
  /** Opens the SM thumbnail editor for the folder. Surfaced as an "Edit
   *  thumbnail" button only when the current image is an SM thumbnail.
   *  Caller is expected to close the lightbox as part of the transition. */
  /** Receives the variant ordinal (1 = primary `_sm-thumbnail.png`,
   *  N ≥ 2 = `_sm-thumbnail-N.png`) of the carousel image the user
   *  clicked from, so the editor can open the matching variant
   *  instead of always defaulting to the preferred one. */
  onEditThumbnail?: (variantOrdinal?: number) => void
  onClose: () => void
  onNavigate: (index: number) => void
  /** Parallel to `thumbnails`; false → cloud placeholder. */
  localFlags?: boolean[]
}

export function Lightbox({ thumbnails, index, thumbsKey, preferredThumbnail, onSetAsThumbnail, onDeleteImage, deleteBlockReason, onEditThumbnail, onClose, onNavigate, localFlags }: LightboxProps) {
  // Register as an open overlay so page-level shortcut handlers (Esc
  // closes the detail sidebar) stand down — the Lightbox isn't a Modal,
  // so isAnyModalOpen() didn't know about it and one Esc closed both.
  useModalOpenRegistration(true)
  const total = thumbnails.length
  const currentPath = thumbnails[index]
  const currentIsLocal = localFlags?.[index] ?? true
  const filename = currentPath.split(/[\\/]/).pop() ?? ''
  const isPreferred = preferredThumbnail
    ? filename === preferredThumbnail
    : index === 0
  const filmstripBtnRefs = useRef<(HTMLButtonElement | null)[]>([])
  // Tracks the path that's pending delete confirmation. Cleared whenever the
  // user navigates away from that image so the confirm pair doesn't carry
  // over to a different file.
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  useEffect(() => { setDeleteConfirm(null) }, [currentPath])

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

  // Reserved vertical space below the image. Because the wrapper uses
  // `justify-center`, any content height takes equal margin above AND
  // below — so to leave a real gap above the filmstrip the reservation
  // must be roughly *twice* the filmstrip's footprint (~76px) plus the
  // button row (~36px) plus the title bar offset (`top-10` = 40px) and a
  // bit of breathing room. ~16rem (256px) gives a clean ~14px gap at
  // every window size. The 75vh cap keeps the image from getting
  // absurdly large on tall monitors.
  const IMAGE_MAX_H = 'min(calc(100vh - 16rem), 75vh)'

  return (
    <div
      className="fixed inset-x-0 bottom-0 top-10 z-50 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm select-none"
      onClick={onClose}
    >
      {/* Close */}
      <button
        onClick={onClose}
        className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/25 text-white transition-colors z-10"
      >
        <X size={20} />
      </button>

      {/* Counter */}
      {total > 1 && (
        <div className="absolute top-5 left-1/2 -translate-x-1/2 text-xs text-gray-400 font-mono bg-black/50 px-3 py-1 rounded-full z-10">
          {index + 1} / {total}
        </div>
      )}

      {/* Prev arrow */}
      {index > 0 && (
        <button
          onClick={e => { e.stopPropagation(); onNavigate(index - 1) }}
          className="absolute left-4 top-1/2 -translate-y-1/2 p-3 rounded-full bg-white/10 hover:bg-white/25 text-white transition-colors z-10"
        >
          <ChevronLeft size={28} />
        </button>
      )}

      {/* Next arrow */}
      {index < total - 1 && (
        <button
          onClick={e => { e.stopPropagation(); onNavigate(index + 1) }}
          className="absolute right-4 top-1/2 -translate-y-1/2 p-3 rounded-full bg-white/10 hover:bg-white/25 text-white transition-colors z-10"
        >
          <ChevronRight size={28} />
        </button>
      )}

      {/* Image + caption/button row, centered. The image carries a
          viewport-relative max-height that already accounts for the
          filmstrip and button row, so on short windows it shrinks to
          leave both visible rather than overflowing them. */}
      <div className="flex flex-col items-center" onClick={e => e.stopPropagation()}>
        <ThumbImage
          path={currentPath}
          thumbsKey={thumbsKey ?? 0}
          isLocal={currentIsLocal}
          hydrate
          className="max-w-[85vw] object-contain shadow-2xl shadow-black"
          style={{ maxHeight: IMAGE_MAX_H }}
          placeholderClassName="rounded shadow-2xl shadow-black"
          placeholderStyle={{
            aspectRatio: '16 / 9',
            width: `min(85vw, calc(${IMAGE_MAX_H} * 16 / 9))`,
            maxHeight: IMAGE_MAX_H,
          }}
          iconSize={48}
          draggable={false}
        />
        <div className="mt-3 flex items-center gap-3">
          <p className="text-sm text-gray-400 font-mono">{filename}</p>
          {/* Edit control — only for SM-generated thumbnails (matches the
              `<date>_sm-thumbnail.png` pattern). Opens the thumbnail editor
              for the stream item via the parent's callback. Same gate used
              in the inline ThumbnailCarousel below. */}
          {onEditThumbnail && SM_THUMB_REGEX.test(currentPath) && (
            <button
              onClick={() => onEditThumbnail(parseSmThumbnailOrdinal(currentPath) ?? undefined)}
              className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/10 hover:bg-purple-600/40 border border-white/20 hover:border-purple-500/50 text-gray-300 hover:text-purple-200 text-xs font-medium transition-colors"
            >
              <PencilLine size={12} /> Edit thumbnail
            </button>
          )}
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
                <Bookmark size={12} /> Set as item thumbnail
              </button>
            )
          )}
          {/* Delete control. Hidden for the preferred thumbnail so the user
              has to demote it before they can trash it — prevents accidentally
              orphaning the row's main image. The icon button expands inline
              into a Cancel / Delete pair on first click. */}
          {!isPreferred && onDeleteImage && deleteBlockReason && (
            <Tooltip content={deleteBlockReason}>
              <button
                disabled
                className="flex items-center justify-center p-1.5 rounded-full bg-white/10 border border-white/20 text-gray-400 opacity-40 cursor-not-allowed"
              >
                <Trash2 size={12} />
              </button>
            </Tooltip>
          )}
          {!isPreferred && onDeleteImage && !deleteBlockReason && (
            deleteConfirm === currentPath ? (
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setDeleteConfirm(null)}
                  className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/10 hover:bg-white/20 border border-white/20 text-gray-300 text-xs font-medium transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={async () => {
                    const path = currentPath
                    setDeleteConfirm(null)
                    await onDeleteImage(path)
                  }}
                  className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-red-600/40 hover:bg-red-600/60 border border-red-500/50 text-red-100 text-xs font-medium transition-colors"
                >
                  <Trash2 size={12} /> Delete
                </button>
              </div>
            ) : (
              <Tooltip content="Delete image (moves to Recycle Bin)">
              <button
                onClick={() => setDeleteConfirm(currentPath)}
                className="flex items-center justify-center p-1.5 rounded-full bg-white/10 hover:bg-red-600/30 border border-white/20 hover:border-red-500/50 text-gray-400 hover:text-red-300 transition-colors"
              >
                <Trash2 size={12} />
              </button>
              </Tooltip>
            )
          )}
        </div>
      </div>

      {/* Filmstrip — absolute at the bottom; the image's max-height
          already reserves space for it so it never overlaps the
          image/button row. */}
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
  /** Fired when the user confirms a delete in the inline confirm pair.
   *  Caller is expected to move the file to the recycle bin and refresh
   *  the source list so the carousel re-renders without it. */
  onDeleteImage?: (path: string) => Promise<void> | void
  /** Opens the thumbnail editor for the current SM-generated thumbnail.
   *  The carousel only renders the Edit button when the displayed image
   *  is an SM thumbnail (matches `<date>_sm-thumbnail.png` pattern); the
   *  caller decides what "edit" means (typically closes the modal and
   *  navigates to the thumbnail editor for the folder). */
  /** Receives the variant ordinal (1 = primary `_sm-thumbnail.png`,
   *  N ≥ 2 = `_sm-thumbnail-N.png`) of the carousel image the user
   *  clicked from, so the editor can open the matching variant
   *  instead of always defaulting to the preferred one. */
  onEditThumbnail?: (variantOrdinal?: number) => void
  /** Parallel to `thumbnails`. Each element is true if the file's data is local
   *  on disk; false if it's a cloud-provider placeholder. The active image
   *  hydrates on demand; other slots show the cloud icon until they become active. */
  localFlags?: boolean[]
  /** Click on the currently-active image opens the full-screen Lightbox
   *  at the given index. Inactive images still navigate to themselves
   *  (matches the carousel's existing inline browsing UX). Optional —
   *  carousels rendered without a parent-managed lightbox just no-op. */
  onOpenLightbox?: (index: number) => void
}

// Matches both the primary `<date>_sm-thumbnail.png` and any
// `<date>_sm-thumbnail-N.png` ordinal variants. The optional `(?:-\d+)?`
// captures the suffix without consuming non-numeric ad-hoc names.
const SM_THUMB_REGEX = /[_-]sm-thumbnail(?:-\d+)?\./i

/** Pull the variant ordinal from a thumbnail's filename — e.g.
 *  `…_sm-thumbnail.png` → 1, `…_sm-thumbnail-3.png` → 3. Returns null
 *  if the path isn't an SM-created thumbnail at all. Used by the
 *  carousel + lightbox to tell the editor WHICH variant to open. */
function parseSmThumbnailOrdinal(path: string): number | null {
  const m = path.match(/[_-]sm-thumbnail(?:-(\d+))?\.[a-z0-9]+$/i)
  if (!m) return null
  return m[1] ? parseInt(m[1], 10) : 1
}

export function ThumbnailCarousel({ thumbnails, thumbsKey, preferredThumbnail, onSetAsThumbnail, onDeleteImage, onEditThumbnail, localFlags, onOpenLightbox }: ThumbnailCarouselProps) {
  const [index, setIndex] = useState(0)
  const [translateX, setTranslateX] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  const imgRefs = useRef<(HTMLElement | null)[]>([])
  const single = thumbnails.length === 1
  // Animation duration honors the user's "Disable animations" /
  // "Slow animations (5x)" settings via the shared useAnimationConfig
  // hook — keeps thumbnail navigation in lockstep with the rest of the
  // app's transitions.
  const animDurationMs = useAnimationConfig().duration(200)

  // Clamp the active index when the list shrinks (e.g. after a delete).
  // Without this, deleting the last image leaves index pointing past the end
  // and currentPath becomes undefined.
  useEffect(() => {
    if (thumbnails.length > 0 && index >= thumbnails.length) {
      setIndex(thumbnails.length - 1)
    }
  }, [thumbnails.length, index])

  const recenter = useCallback(() => {
    const el = imgRefs.current[index]
    const container = containerRef.current
    if (!el || !container) return
    const itemCenter = el.offsetLeft + el.offsetWidth / 2
    setTranslateX(container.clientWidth / 2 - itemCenter)
  }, [index])

  // Snap the carousel to the centered position WITHOUT the
  // transform transition. Used for events where the item's "real"
  // dimensions just became known (image onLoad, container resize) —
  // animating from a position the user briefly saw with 0-width
  // items would call attention to the layout shift. Mirrors the
  // resize path's strategy below: write transform direct to the
  // DOM, force a layout flush, then restore the transition. React
  // state is also synced so the next index-change animation starts
  // from the correct origin.
  const recenterInstant = useCallback(() => {
    const el = imgRefs.current[index]
    const container = containerRef.current
    const inner = innerRef.current
    if (!el || !container || !inner) return
    const itemCenter = el.offsetLeft + el.offsetWidth / 2
    const newX = container.clientWidth / 2 - itemCenter
    const prevDuration = inner.style.transitionDuration
    inner.style.transitionDuration = '0s'
    inner.style.transform = `translateX(${newX}px)`
    // Force a layout flush so the zero-duration write commits before
    // the next style mutation re-enables the animation. Without the
    // reflow read, the browser would collapse both writes into one
    // paint and the transform transition would still play.
    void inner.offsetHeight
    inner.style.transitionDuration = prevDuration
    setTranslateX(newX)
  }, [index])

  useLayoutEffect(() => { recenter() }, [recenter])

  // Re-center on container resize. Without this, dragging the window
  // narrower/wider leaves the active thumbnail offset until the user
  // clicks something that triggers another layout pass. Width changes
  // only — height never moves the centerline so we don't need to react
  // to them. Uses recenterInstant so the parent sidebar's slide-in
  // (which fires the observer ~60 times) doesn't queue 60 stacked
  // 200ms animations on the carousel.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    let lastWidth = container.clientWidth
    const obs = new ResizeObserver(() => {
      if (container.clientWidth === lastWidth) return
      lastWidth = container.clientWidth
      recenterInstant()
    })
    obs.observe(container)
    return () => obs.disconnect()
  }, [recenterInstant])

  const currentPath = thumbnails[index]
  const filename = currentPath?.split(/[\\/]/).pop() ?? ''
  const isPreferred = preferredThumbnail
    ? filename === preferredThumbnail
    : index === 0

  // Pending delete-confirm path. Reset when the active image changes so the
  // confirm pair doesn't carry across navigations or re-renders.
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  useEffect(() => { setDeleteConfirm(null) }, [currentPath])

  return (
    <div className="flex flex-col gap-1.5">
      <div className="relative overflow-hidden" style={{ height: 100 }} ref={containerRef}>
        <div
          ref={innerRef}
          className="flex items-center gap-2 h-full transition-transform"
          style={{ transform: `translateX(${translateX}px)`, transitionDuration: `${animDurationMs}ms` }}
        >
          {thumbnails.map((t, i) => {
            const slotIsLocal = localFlags?.[i] ?? true
            // Cloud placeholders need an explicit shape since there's no <img>
            // to size the slot. Default to 16:9 with a faint background.
            const slotShapeClasses = slotIsLocal ? 'h-full' : 'h-full aspect-video bg-navy-800/40 rounded'
            // Inactive-slot opacity goes on the SLOT WRAPPER, not the
            // individual ThumbImage children, so it cascades through
            // EVERYTHING inside — including the loading placeholder
            // that ThumbImage stacks over the <img> until onLoad
            // fires. Otherwise the placeholder's full-opacity
            // bg-navy-900 stays solid dark on inactive slots,
            // producing what looks like a dark overlay on the
            // currently-loading thumbnail.
            const slotOpacityClasses = i === index ? 'opacity-100' : 'opacity-40 hover:opacity-70'
            return (
              <div
                key={t}
                ref={el => { imgRefs.current[i] = el }}
                className={`group relative shrink-0 cursor-pointer transition-opacity duration-150 ${slotOpacityClasses} ${slotShapeClasses}`}
                onClick={() => {
                  // Active image → open lightbox; inactive → navigate to it.
                  // Falls back to navigate when no lightbox handler is wired.
                  if (i === index && onOpenLightbox) onOpenLightbox(i)
                  else setIndex(i)
                }}
              >
                <ThumbImage
                  path={t}
                  thumbsKey={thumbsKey ?? 0}
                  isLocal={slotIsLocal}
                  hydrate={i === index}
                  className="h-full w-auto"
                  placeholderClassName="w-full h-full rounded"
                  iconSize={20}
                  // Instant (no transition): the layout just learned the
                  // image's true dimensions, so any animation here would
                  // be chasing a position the user only briefly saw at
                  // the wrong location.
                  onLoad={recenterInstant}
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
      <div className="flex items-center justify-center gap-2 px-1 min-h-[20px] flex-wrap">
        {!single && (
          <TruncatedText text={filename} className="text-xs text-gray-400 truncate max-w-[14rem]" triggerClassName="block min-w-0 max-w-[14rem]" />
        )}
        <div className="flex items-center gap-1.5">
          {/* Edit control — only for SM-generated thumbnails (matches
              `<date>_sm-thumbnail.png`). Opens the thumbnail editor for
              the stream item via the parent's callback. Hidden otherwise
              because there's nothing for the SM editor to load for non-SM
              images. */}
          {onEditThumbnail && currentPath && SM_THUMB_REGEX.test(currentPath) && (
            <Tooltip content="Edit thumbnail">
            <button
              onClick={() => onEditThumbnail(parseSmThumbnailOrdinal(currentPath) ?? undefined)}
              className="flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-white/8 hover:bg-purple-600/30 border border-white/15 hover:border-purple-500/45 text-gray-400 hover:text-purple-200 text-xs font-medium whitespace-nowrap transition-colors"
            >
              <PencilLine size={11} /> Edit thumbnail
            </button>
            </Tooltip>
          )}
          {onSetAsThumbnail && (
            isPreferred ? (
              <span className="flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-purple-600/25 border border-purple-500/35 text-purple-300 text-xs font-medium whitespace-nowrap">
                <Check size={11} /> Item thumbnail
              </span>
            ) : (
              <button
                onClick={() => onSetAsThumbnail(currentPath)}
                className="flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-white/8 hover:bg-purple-600/30 border border-white/15 hover:border-purple-500/45 text-gray-400 hover:text-purple-200 text-xs font-medium whitespace-nowrap transition-colors"
              >
                <ImageIcon size={11} /> Set as item thumbnail
              </button>
            )
          )}
          {/* Delete control — hidden for the preferred thumbnail so the user
              has to demote it before they can trash it. Icon button expands
              into a Cancel / Delete pair on first click. */}
          {!isPreferred && onDeleteImage && currentPath && (
            deleteConfirm === currentPath ? (
              <>
                <button
                  onClick={() => setDeleteConfirm(null)}
                  className="flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-white/8 hover:bg-white/15 border border-white/15 text-gray-400 text-xs font-medium whitespace-nowrap transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={async () => {
                    const path = currentPath
                    setDeleteConfirm(null)
                    await onDeleteImage(path)
                  }}
                  className="flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-red-600/35 hover:bg-red-600/55 border border-red-500/45 text-red-100 text-xs font-medium whitespace-nowrap transition-colors"
                >
                  <Trash2 size={11} /> Delete
                </button>
              </>
            ) : (
              <Tooltip content="Delete image (moves to Recycle Bin)">
              <button
                onClick={() => setDeleteConfirm(currentPath)}
                className="flex items-center justify-center p-1 rounded-full bg-white/8 hover:bg-red-600/25 border border-white/15 hover:border-red-500/45 text-gray-400 hover:text-red-300 transition-colors"
              >
                <Trash2 size={11} />
              </button>
              </Tooltip>
            )
          )}
        </div>
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
  /** Set when in 'new' mode invoked from the row's Duplicate / New Episode
   *  action. Pins the prev-episode source to this specific folder (overrides
   *  the auto-detect that picks the most recent in series), defaults the
   *  thumbnail picker to "copy from this stream", and updates the picker
   *  label so users know exactly which stream the thumbnails come from. */
  sourceFolder?: StreamFolder
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
  /** Trash a single carousel image and refresh the modal's thumbnails list.
   *  Wired through to the embedded ThumbnailCarousel's delete button. */
  onDeleteImage?: (path: string) => Promise<void> | void
  /** Open the thumbnail editor for the current stream item. Wired through
   *  to the embedded ThumbnailCarousel — surfaces an Edit button when the
   *  user is looking at the SM-generated thumbnail. Parent is expected to
   *  close the metamodal as part of this transition. */
  /** Receives the variant ordinal (1 = primary `_sm-thumbnail.png`,
   *  N ≥ 2 = `_sm-thumbnail-N.png`) of the carousel image the user
   *  clicked from, so the editor can open the matching variant
   *  instead of always defaulting to the preferred one. */
  onEditThumbnail?: (variantOrdinal?: number) => void
  tagColors?: Record<string, string>
  tagTextures?: Record<string, string>
  onNewStreamType?: (tag: string) => void
  claudeEnabled?: boolean
  /** Default HH:MM pre-filled into the broadcast-creation time input. */
  defaultBroadcastTime?: string
  onSave: (meta: StreamMeta, date: string, thumbnailTemplatePath?: string, prevEpisodeFolderPath?: string, builtinTemplateId?: string) => Promise<void>
  onClose: () => void
  /** New-mode only: true when the current `initialMeta` came from the
   *  parent's in-memory draft rather than a fresh source. Drives the
   *  "Resumed from previous session" hint + "Start fresh" link. */
  newDraftPresent?: boolean
  /** New-mode only: called on any user-initiated close (Cancel / X) with
   *  the modal's current field values so the parent can stash a draft.
   *  Pass `null` to explicitly clear the draft (e.g. closing an empty
   *  form after "Clear all fields"). Save-success path skips this and
   *  goes straight to onClose. */
  onDraftCapture?: (meta: Partial<StreamMeta> | null) => void
  /** New-mode only: clears the parent's draft AND forces the modal to
   *  remount with empty fields (parent bumps a session counter). */
  onDraftClear?: () => void
}

function applyMergeFields(template: string, fields: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => fields[key] ?? `{${key}}`)
}

/**
 * Compute the value for the `{season_links}` description merge field. Returns
 * a multi-line string of links to previous episodes in the same series+season,
 * formatted as `Episode {n}: {title} - {url}` — one entry per line, newest
 * previous episode first. Returns '' (no leading/trailing whitespace) when
 * there are no eligible previous episodes.
 *
 * Eligibility: same first-game tag, same season, date strictly before the
 * current stream's date, and the episode has a `ytVideoId` set (no link =
 * nothing useful to share).
 *
 * Title resolution per episode: ytCatchyTitle → ytTitle → YouTube API fetch
 * (blocking for that episode). API fallback is only invoked for episodes
 * that lack both stored titles, so the common case has zero network calls.
 */
async function computeSeasonLinks(
  allFolders: StreamFolder[],
  game: string,
  season: string,
  currentDate: string,
): Promise<string> {
  if (!game) return ''
  const lower = game.toLowerCase()
  const s = season || '1'
  const previous = allFolders.filter(f =>
    f.meta?.games?.some(g => g.toLowerCase() === lower) &&
    (f.meta?.ytSeason ?? '1') === s &&
    f.date < currentDate &&
    !!f.meta?.ytVideoId
  )
  if (previous.length === 0) return ''

  // Position in chronological order is the fallback episode number when
  // ytEpisode isn't set on a folder.
  const chronological = [...previous].sort((a, b) => a.date.localeCompare(b.date))
  const positionByPath = new Map<string, number>()
  chronological.forEach((f, i) => positionByPath.set(f.folderPath, i + 1))

  // Identify episodes missing both stored titles. Block on API fetch only
  // for those (rare).
  const needsApi = previous.filter(f => !(f.meta?.ytCatchyTitle || f.meta?.ytTitle))
  const fetchedTitles = new Map<string, string>()
  if (needsApi.length > 0) {
    await Promise.all(needsApi.map(async f => {
      const id = f.meta?.ytVideoId
      if (!id) return
      try {
        const video = await window.api.youtubeGetVideoById(id)
        if (video?.snippet?.title) fetchedTitles.set(f.folderPath, video.snippet.title)
      } catch { /* missing title → fall through to placeholder */ }
    }))
  }

  // Output order: newest previous episode first (descending by date).
  const ordered = [...previous].sort((a, b) => b.date.localeCompare(a.date))
  const lines = ordered.map(f => {
    const ep = f.meta?.ytEpisode || String(positionByPath.get(f.folderPath) ?? '?')
    const title = f.meta?.ytCatchyTitle || f.meta?.ytTitle || fetchedTitles.get(f.folderPath) || '(unknown)'
    const url = `https://youtu.be/${f.meta?.ytVideoId}`
    return `Episode ${ep}: ${title} - ${url}`
  })
  return lines.join('\n')
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

/** Count streams in this folder's series+season, INCLUDING this folder.
 *  Used for the thumbnail-editor {total_episodes} merge field. Returns 0 if
 *  the folder has no game tag (no series to count). */
function seriesEpisodeCount(folders: StreamFolder[], folder: StreamFolder): number {
  const game = folder.meta?.games?.[0] ?? folder.detectedGames?.[0]
  if (!game) return 0
  const lower = game.toLowerCase()
  const season = folder.meta?.ytSeason ?? '1'
  return folders.filter(f =>
    f.meta?.games?.some(g => g.toLowerCase() === lower) &&
    (f.meta?.ytSeason ?? '1') === season
  ).length
}

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

function MetaModal({ mode, initialMeta, folderDate, sourceFolder, detectedGames = [], allGames = [], allStreamTypes = [], allFolders = [], templates = [], defaultTemplateName = '', builtinTemplates = [], defaultBuiltinTemplateId = '', useBuiltinByDefault = true, thumbnails = [], thumbnailLocalFlags, thumbsKey, preferredThumbnail, onSetAsThumbnail, onDeleteImage, onEditThumbnail, tagColors = {}, tagTextures = {}, claudeEnabled = false, defaultBroadcastTime = '19:00', onNewStreamType, onSave, onClose, newDraftPresent = false, onDraftCapture, onDraftClear }: MetaModalProps) {
  const defaultTemplate = templates.find(t => t.name === defaultTemplateName) ?? templates[0] ?? null

  // In edit/add mode the folder name is the authoritative date source — the stored meta.date
  // may be wrong if the file was created with the wrong date (e.g. migration artefact).
  const [date, setDate] = useState(
    // `||` (not `??`) so the New Episode flow — which passes an empty-string
    // date in initialMeta — still falls back to today().
    mode === 'new' ? (initialMeta?.date || today()) : (folderDate ?? initialMeta?.date ?? today())
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
    // sourceFolder takes priority — when invoked via row Duplicate / New
    // Episode, that explicit choice should win over the most-recent-in-series
    // auto-detect. The user might be intentionally duplicating a much older
    // stream because they want THAT stream's content, not the latest.
    () => mode === 'new'
      ? (sourceFolder ?? getPrevEpisodeFolder(games, allFolders, ytSeason))
      : null,
    [mode, sourceFolder, games, allFolders, ytSeason]
  )
  // Only show the copy option if the previous folder actually has thumbnails
  const hasPrevThumbnails = (prevEpisodeFolder?.thumbnails.length ?? 0) > 0

  // Two checkboxes in 'new' mode replace the previous dropdown selectors.
  //   useBuiltinThumbnail → controls future thumbnail workflow for this stream
  //                         (built-in canvas editor vs. external file).
  //                         When checked, the SM editor's first-open template
  //                         picker handles which built-in template to start
  //                         from. When unchecked, the user's default external
  //                         template (from Settings) is copied as the seed.
  //   copyFromSource     → triggers the file-copy path that grabs every
  //                         *thumbnail* file from prevEpisodeFolder (the
  //                         explicit sourceFolder when invoked from a row's
  //                         New Episode button, or the auto-detected most-
  //                         recent in series otherwise). Works for SM editor
  //                         JSON+PNG and external thumbnails uniformly.
  // For New Episode, default useBuiltin to match the source's workflow so
  // the user lands on the right side without thinking.
  const [useBuiltinThumbnail, setUseBuiltinThumbnail] = useState<boolean>(
    sourceFolder ? !!sourceFolder.meta?.smThumbnail : useBuiltinByDefault
  )
  // Default checked whenever a copy source exists (explicit sourceFolder OR
  // auto-detected most-recent-in-series) AND that source has at least one
  // thumbnail file to copy.
  const [copyFromSource, setCopyFromSource] = useState<boolean>(hasPrevThumbnails)
  const [comments, setComments] = useState(initialMeta?.comments ?? '')
  const [archived, setArchived] = useState(initialMeta?.archived ?? false)
  const [localPreferredThumbnail, setLocalPreferredThumbnail] = useState<string | undefined>(
    initialMeta?.preferredThumbnail
  )
  const [saving, setSaving] = useState(false)

  // ── YouTube state ──────────────────────────────────────────────────────────
  const [ytConnected, setYtConnected] = useState(false)
  const [ytTitleTemplates, setYtTitleTemplates] = useState<YTTitleTemplate[]>([])
  const [ytDescTemplates, setYtDescTemplates] = useState<YTDescriptionTemplate[]>([])
  const [ytTagTemplates, setYtTagTemplates] = useState<YTTagTemplate[]>([])
  const [twitchTagTemplates, setTwitchTagTemplates] = useState<TwitchTagTemplate[]>([])
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
  // 24-hour HH:MM. Seeded from the user's configured default broadcast time
  // (Settings), falling back to 19:00.
  const [ytNewTime, setYtNewTime] = useState<string>(defaultBroadcastTime)
  const [ytCreatingBroadcast, setYtCreatingBroadcast] = useState(false)
  const [ytCreateError, setYtCreateError] = useState('')

  const isPastStream = date < today()
  // True when this stream item is the soonest upcoming one. Previously had
  // a `mode === 'new'` short-circuit that always returned true for new
  // items — that defaulted the "Also update Twitch" checkbox to checked
  // even when the user was creating a stream item scheduled later than an
  // existing one. Now uses the current `date` state so it stays accurate
  // as the user picks/changes the date in the modal.
  const isNextUpcomingStream = !isPastStream && (() => {
    const todayStr = today()
    const earliestOther = allFolders.map(f => f.date).filter(d => d >= todayStr).sort()[0]
    return !earliestOther || date <= earliestOther
  })()
  const [ytSelectedTitleId, setYtSelectedTitleId] = useState('')
  const [ytSelectedDescId, setYtSelectedDescId] = useState('')
  const [ytSelectedTagId, setYtSelectedTagId] = useState('')
  const [selectedTwitchTagId, setSelectedTwitchTagId] = useState('')
  const [ytTitle, setYtTitle] = useState(initialMeta?.ytTitle ?? '')
  const [ytDescription, setYtDescription] = useState(initialMeta?.ytDescription ?? '')
  const [ytGameTitle, setYtGameTitle] = useState(initialMeta?.ytGameTitle ?? '')
  const [ytTagsText, setYtTagsText] = useState(initialMeta?.ytTags?.join(', ') ?? '')
  // Twitch tags live alongside YT tags so the useFieldSuggestion hook below
  // can reference both fields' state in the order React requires.
  const [twitchTagsText, setTwitchTagsText] = useState(initialMeta?.twitchTags?.join(', ') ?? '')

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
  const fetchTwitchTags = useCallback((prefix: string, suffix: string) => window.api.claudeGenerate('twitch-tags', { ...buildContext(), prefix, suffix }), [buildContext])

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
  const handleTwitchTagsUserChange = useCallback((v: string) => {
    setTwitchTagsText(v)
    setSelectedTwitchTagId(prev => prev ? '' : prev)
  }, [])
  const handleDescUserChange = useCallback((v: string) => {
    setYtDescription(v)
    setYtSelectedDescId(prev => prev ? '' : prev)
  }, [])

  const titleSg = useFieldSuggestion(ytTitle, handleTitleUserChange, claudeEnabled ? fetchTitle : noop)
  const tagsSg = useFieldSuggestion(ytTagsText, handleTagsUserChange, claudeEnabled ? fetchTags : noop)
  const twitchTagsSg = useFieldSuggestion(twitchTagsText, handleTwitchTagsUserChange, claudeEnabled ? fetchTwitchTags : noop)

  // Auto-resize the tags textarea so it grows with content instead of
  // forcing an inner scrollbar. min-height on the element handles the floor;
  // we just set height to scrollHeight on every value change. Reset to 'auto'
  // first so the textarea can also *shrink* when tags are removed.
  useLayoutEffect(() => {
    const el = tagsSg.ref.current as HTMLTextAreaElement | null
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [ytTagsText, tagsSg.ref])
  useLayoutEffect(() => {
    const el = twitchTagsSg.ref.current as HTMLTextAreaElement | null
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [twitchTagsText, twitchTagsSg.ref])

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
  // Push-to-platform checkboxes for the unified save+push action in the
  // modal footer. Auto-default reactively to the relevant condition; once
  // the user manually toggles, the touched ref freezes that choice — until
  // a successful push, which resets both the touched ref and the "has
  // pending push" flag so the next edit re-auto-checks the box.
  const [pushYouTube, setPushYouTube] = useState(false)
  const pushYouTubeTouched = useRef(false)
  const [pushTwitch, setPushTwitch] = useState(isNextUpcomingStream)
  const pushTwitchTouched = useRef(false)
  // Twitch push pending — we can't fetch Twitch's current channel state on
  // open, so compare the to-be-pushed payload against a snapshot of what
  // was last known to match (set on mount and after each successful push).
  // YouTube uses broadcastMismatch instead, which compares against the
  // actual broadcast resource fetched from YT.
  const [twitchPushSnapshot, setTwitchPushSnapshot] = useState<string | null>(null)

  const handlePushTwitchChange = (checked: boolean) => {
    pushTwitchTouched.current = true
    setPushTwitch(checked)
  }
  const handlePushYouTubeChange = (checked: boolean) => {
    pushYouTubeTouched.current = true
    setPushYouTube(checked)
  }

  const [pushing, setPushing] = useState(false)
  // Footer banner — single source of truth for save/push outcome messages.
  // 'success' auto-dismisses after 4s; 'error' sticks until the user closes it.
  type BannerState = { type: 'success' | 'error'; message: string }
  const [banner, setBanner] = useState<BannerState | null>(null)
  const bannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const showBanner = useCallback((b: BannerState) => {
    if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current)
    setBanner(b)
    if (b.type === 'success') {
      bannerTimerRef.current = setTimeout(() => setBanner(null), 4000)
    }
  }, [])
  useEffect(() => () => { if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current) }, [])
  // Thumbnails the picker can show: bestFit are aspect-matched (16:9 / 1:1 /
  // 9:16, ≥720px on the longer side) and shown by default; rest gates behind
  // a "Show all" link so logos and other non-thumbnail assets don't clutter
  // the picker. Cloud-only files always land in bestFit since we can't probe
  // their dimensions without triggering a download.
  const [ytQualifyingThumbnails, setYtQualifyingThumbnails] = useState<{ bestFit: string[]; rest: string[] }>({ bestFit: [], rest: [] })
  const [ytShowAllThumbs, setYtShowAllThumbs] = useState(false)
  const [ytSelectedThumbnail, setYtSelectedThumbnail] = useState<string | null>(null)
  // When checked (default) the YT thumbnail upload reuses whatever image is
  // currently shown as the stream item's thumbnail in the streams list — no
  // separate pick needed. Unchecking reveals the manual picker. Independent
  // of ytSelectedThumbnail: toggling off → on → off preserves the previous
  // manual pick, only the upload-effective selection swaps.
  const [useStreamItemThumb, setUseStreamItemThumb] = useState(true)
  // Resolve the stream item's "main" thumbnail the same way the row does:
  // preferredThumbnail basename → matching path → first thumbnail. The local
  // override (from clicking "Set as item thumbnail" inside the modal) wins
  // over the persisted prop so toggling reflects the current choice.
  const resolvedStreamItemThumb = useMemo<string | null>(() => {
    if (thumbnails.length === 0) return null
    const preferredName = localPreferredThumbnail ?? preferredThumbnail
    if (preferredName) {
      const match = thumbnails.find(p => (p.split(/[\\/]/).pop() ?? '') === preferredName)
      if (match) return match
    }
    return thumbnails[0]
  }, [thumbnails, localPreferredThumbnail, preferredThumbnail])
  // The actual path used for the YouTube upload. handleAction and the
  // thumbnail-hash detection both source from this.
  const effectiveYtThumb = useStreamItemThumb ? resolvedStreamItemThumb : ytSelectedThumbnail

  // ── Twitch state ───────────────────────────────────────────────────────────
  const [twConnected, setTwConnected] = useState(false)
  const [syncTitle, setSyncTitle] = useState(initialMeta?.syncTitle ?? true)
  const [twitchTitle, setTwitchTitle] = useState(initialMeta?.twitchTitle ?? '')
  const [twitchGameName, setTwitchGameName] = useState(initialMeta?.twitchGameName ?? '')
  // Sync flag for Twitch game field. Twitch tags don't have a sync option —
  // their format rules (alphanumeric only, ≤25 chars) diverge enough from
  // YouTube's that sharing a single list mostly produces "X skipped" noise.
  const [syncGame, setSyncGame] = useState(initialMeta?.syncGame ?? true)

  // ── Pending-push tracking + auto-check effects ────────────────────────
  // YouTube: broadcastMismatch (defined below) compares local fields against
  // the fetched YT broadcast resource — that's the source of truth.
  // Wait for selectedBroadcast to populate before drawing a conclusion
  // (until then, no mismatch can be detected → checkbox stays unchecked).

  // Twitch: build a payload string of what we'd send. Compare to a snapshot
  // captured at mount + after each successful push. Mismatch == pending.
  const currentTwitchPushPayload = useMemo(() => JSON.stringify({
    title: syncTitle ? ytTitle : twitchTitle,
    game: syncGame ? ytGameTitle : twitchGameName,
    tags: twitchTagsText.split(',').map(t => t.trim()).filter(Boolean).slice().sort().join('|'),
  }), [syncTitle, ytTitle, twitchTitle, syncGame, ytGameTitle, twitchGameName, twitchTagsText])
  // Initialize the Twitch snapshot once when the modal opens. Done in a
  // requestAnimationFrame so the auto-sync effects (syncTitle/syncGame
  // mirroring) have had a chance to run first — otherwise the snapshot
  // would capture a transient "pre-sync" payload and every later mirror
  // would look like a user change.
  useEffect(() => {
    if (twitchPushSnapshot !== null) return
    const handle = requestAnimationFrame(() => setTwitchPushSnapshot(currentTwitchPushPayload))
    return () => cancelAnimationFrame(handle)
  }, [twitchPushSnapshot, currentTwitchPushPayload])
  const hasPendingTwitchPush = twitchPushSnapshot !== null && twitchPushSnapshot !== currentTwitchPushPayload

  // Thumbnail-change detection for the YT push. We hash the selected
  // thumbnail's bytes and compare against the hash recorded at the last
  // push (persisted as meta.ytThumbnailPushedHash). Differs → the thumbnail
  // changed → offer to (re)push even when no other metadata changed. A
  // missing baseline (never pushed) counts as "needs push".
  const [currentThumbnailHash, setCurrentThumbnailHash] = useState<string | null>(null)
  const [lastPushedThumbnailHash, setLastPushedThumbnailHash] = useState<string | undefined>(initialMeta?.ytThumbnailPushedHash)
  useEffect(() => {
    if (!effectiveYtThumb) { setCurrentThumbnailHash(null); return }
    let cancelled = false
    window.api.thumbnailHashFile(effectiveYtThumb)
      .then(h => { if (!cancelled) setCurrentThumbnailHash(h) })
      .catch(() => { if (!cancelled) setCurrentThumbnailHash(null) })
    return () => { cancelled = true }
  }, [effectiveYtThumb, thumbsKey])
  const thumbnailNeedsPush = !!effectiveYtThumb && currentThumbnailHash !== null && currentThumbnailHash !== lastPushedThumbnailHash

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
    twitchTagsText: initialMeta?.twitchTags?.join(', ') ?? '',
    syncTitle: initialMeta?.syncTitle ?? true,
    syncGame: initialMeta?.syncGame ?? true,
    ytVideoId: initialMeta?.ytVideoId,
    preferredThumbnail: initialMeta?.preferredThumbnail,
  }))
  useEffect(() => {
    const current = JSON.stringify({
      streamTypes, games, comments, archived, ytTitle, ytDescription, ytGameTitle,
      ytTagsText, ytSeason, ytEpisode, ytCatchyTitle, twitchTitle, twitchGameName, twitchTagsText,
      syncTitle, syncGame,
      ytVideoId: ytVideoUnlinked ? undefined : (ytSelectedBroadcastId || initialMeta?.ytVideoId || undefined),
      preferredThumbnail: localPreferredThumbnail,
    })
    setIsDirty(current !== initialSnapshot.current)
  }, [streamTypes, games, comments, archived, ytTitle, ytDescription, ytGameTitle,
      ytTagsText, ytSeason, ytEpisode, ytCatchyTitle, twitchTitle, twitchGameName, twitchTagsText,
      syncTitle, syncGame,
      ytVideoUnlinked, ytSelectedBroadcastId, localPreferredThumbnail])

  // Keep Twitch title in sync with YT title when syncTitle is on
  useEffect(() => {
    if (syncTitle) setTwitchTitle(ytTitle)
  }, [syncTitle, ytTitle])

  // Keep Twitch category in sync with YT game when syncGame is on.
  // (Auto-fill from `games` only seeds it the first time — once the user
  // edits ytGameTitle manually, that's the source of truth.)
  useEffect(() => {
    if (syncGame) setTwitchGameName(ytGameTitle)
  }, [syncGame, ytGameTitle])

  // Seed twitchGameName from `games` when nothing is set yet (parity with
  // ytGameTitle which has its own auto-fill).
  useEffect(() => {
    if (!syncGame && !twitchGameName && games.length > 0) setTwitchGameName(games[0])
  }, [games, syncGame, twitchGameName])

  useEffect(() => {
    window.api.twitchGetStatus?.().then((s: { connected: boolean }) => {
      setTwConnected(s.connected)
    }).catch(() => {})
  }, [])

  // Twitch tag templates load independently of YT connection — the user
  // might use them even without YT for local storage / future Twitch push.
  useEffect(() => {
    window.api.getTwitchTagTemplates().then(setTwitchTagTemplates).catch(() => {})
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
        // Used to gate on isNextUpcomingStream; removed now that the picker
        // surfaces multi-link warnings — users can deliberately link any
        // upcoming stream to any broadcast, and the warning makes the
        // implication visible at pick-time.
        setYtBroadcastsLoading(true)
        window.api.youtubeGetBroadcasts().then((items: LiveBroadcast[]) => {
          console.log('[YT renderer] broadcasts:', items.length, items.map((b: any) => b.id))
          setYtBroadcasts(items)
          const savedId = initialMeta?.ytVideoId
          if (savedId) {
            setYtSelectedBroadcastId(savedId)
          } else {
            // Setter callback: if the user has already picked or created a
            // broadcast while this fetch was in flight, don't clobber their
            // selection with our auto-pick. This race bit a real bug —
            // creating a new broadcast in a new-stream modal would have its
            // id overwritten when this still-pending fetch resolved, and
            // the stream item would save without ytVideoId.
            setYtSelectedBroadcastId(prev => {
              if (prev) return prev
              const dateMatch = items.find(v =>
                utcToLocalDate(v.snippet.scheduledStartTime ?? '') === date
              )
              return dateMatch?.id ?? ''
            })
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

  // Fetch qualifying thumbnails for YouTube upload — categorized into
  // bestFit (aspect-correct) and rest (everything else that still passes the
  // basic ext + size check). Reset state synchronously at the top of every
  // cycle so a "Show all" click on one stream's modal doesn't carry over
  // when the user navigates between siblings via the prev/next arrows. If
  // bestFit ends up empty we auto-expand so the picker is never accidentally
  // blank when files actually exist.
  useEffect(() => {
    setYtQualifyingThumbnails({ bestFit: [], rest: [] })
    setYtShowAllThumbs(false)
    if (thumbnails.length === 0) {
      setYtSelectedThumbnail(null)
      return
    }
    window.api.youtubeGetQualifyingThumbnails(thumbnails).then(qualified => {
      setYtQualifyingThumbnails(qualified)
      setYtSelectedThumbnail(qualified.bestFit[0] ?? qualified.rest[0] ?? null)
      if (qualified.bestFit.length === 0) setYtShowAllThumbs(true)
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
    const rendered = applyMergeFields(tmpl.template, { game: ytGameTitle, season: ytSeason, episode: ytEpisode, tagline: ytCatchyTitle, title: ytCatchyTitle, total_episodes: ytTotalEpisodes })
    setYtTitle(rendered)
    requestAnimationFrame(() => {
      const el = titleSg.ref.current as HTMLInputElement | null
      if (el) { el.focus(); el.setSelectionRange(rendered.length, rendered.length) }
    })
  }, [ytSelectedTitleId, ytTitleTemplates, ytGameTitle, ytSeason, ytEpisode, ytCatchyTitle, ytTotalEpisodes])

  // Apply description template. {season_links} is substituted ONCE here at
  // template-select time (not on every keystroke) — its value walks
  // allFolders and may hit the YouTube API for missing titles. Subsequent
  // edits in the description textarea aren't re-substituted; the user can
  // tweak the rendered list by hand.
  useEffect(() => {
    const tmpl = ytDescTemplates.find(t => t.id === ytSelectedDescId)
    if (!tmpl) return
    let cancelled = false
    ;(async () => {
      let body = tmpl.description
      if (body.includes('{season_links}')) {
        const links = await computeSeasonLinks(allFolders, games[0] ?? '', ytSeason, date)
        body = body.replace(/\{season_links\}/g, links)
      }
      if (cancelled) return
      const rendered = applyMergeFields(body, { game: ytGameTitle, season: ytSeason, episode: ytEpisode, tagline: ytCatchyTitle, title: ytCatchyTitle, total_episodes: ytTotalEpisodes })
      setYtDescription(rendered)
      requestAnimationFrame(() => {
        descRef.current?.focus()
        descRef.current?.setCursorOffset(rendered.length)
      })
    })()
    return () => { cancelled = true }
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

  // Apply Twitch tag template
  useEffect(() => {
    const tmpl = twitchTagTemplates.find(t => t.id === selectedTwitchTagId)
    if (!tmpl) return
    const rendered = tmpl.tags.join(', ')
    setTwitchTagsText(rendered)
    requestAnimationFrame(() => {
      const el = twitchTagsSg.ref.current as HTMLTextAreaElement | null
      if (el) { el.focus(); el.setSelectionRange(rendered.length, rendered.length) }
    })
  }, [selectedTwitchTagId, twitchTagTemplates])

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
  const canSaveTwitchTagsTemplate = useMemo(() => {
    const entered = twitchTagsText.split(',').map(t => t.trim()).filter(Boolean)
    const { compat } = toTwitchCompatibleTags(entered)
    if (compat.length === 0) return false
    const currentKey = [...compat].sort().join('|').toLowerCase()
    return !twitchTagTemplates.some(t => [...t.tags].sort().join('|').toLowerCase() === currentKey)
  }, [twitchTagsText, twitchTagTemplates])

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

  const saveTwitchTagsAsTemplate = useCallback(async (name: string) => {
    // Save only the Twitch-compatible subset — incompatible tags would never
    // push anyway, and persisting them sets up future "why are these gone?"
    // confusion when the template is reapplied.
    const entered = twitchTagsText.split(',').map(t => t.trim()).filter(Boolean)
    const { compat } = toTwitchCompatibleTags(entered)
    const tpl: TwitchTagTemplate = { id: crypto.randomUUID(), name, tags: compat }
    const next = [...twitchTagTemplates, tpl]
    setTwitchTagTemplates(next)
    await window.api.setTwitchTagTemplates(next)
    setSelectedTwitchTagId(tpl.id)
  }, [twitchTagsText, twitchTagTemplates])

  const selectedBroadcast = useMemo(
    () => (isPastStream ? ytVods : ytBroadcasts).find(b => b.id === ytSelectedBroadcastId) ?? null,
    [isPastStream, ytVods, ytBroadcasts, ytSelectedBroadcastId]
  )

  // Local override for the broadcast's privacy. Used so the selector reflects
  // the user's just-clicked value before the YT round-trip completes (and
  // since we don't re-fetch the broadcast resource after save). Cleared on
  // broadcast change so a freshly-loaded selectedBroadcast.status.privacyStatus
  // wins again.
  const [privacyOverride, setPrivacyOverride] = useState<'public' | 'unlisted' | 'private' | null>(null)
  const [savingPrivacy, setSavingPrivacy] = useState(false)
  const [privacyError, setPrivacyError] = useState('')
  useEffect(() => {
    setPrivacyOverride(null)
    setPrivacyError('')
  }, [selectedBroadcast?.id])
  const currentPrivacy = (privacyOverride ?? selectedBroadcast?.status.privacyStatus) as
    'public' | 'unlisted' | 'private' | undefined
  const changePrivacy = useCallback(async (next: 'public' | 'unlisted' | 'private') => {
    if (!selectedBroadcast || currentPrivacy === next || savingPrivacy) return
    setPrivacyOverride(next)
    setSavingPrivacy(true)
    setPrivacyError('')
    try {
      await window.api.youtubeUpdateBroadcastStatus(selectedBroadcast.id, next)
    } catch (err: any) {
      setPrivacyOverride(null)
      setPrivacyError(err?.message ?? 'Failed to update privacy')
    } finally {
      setSavingPrivacy(false)
    }
  }, [selectedBroadcast, currentPrivacy, savingPrivacy])

  // Build the cross-link list so the BroadcastPicker can warn when a broadcast
  // is already linked from another stream item. `allFolders` is pre-filtered
  // by the caller to exclude the current folder (edit mode), so every entry
  // here represents a "linked elsewhere" reference. We allow multi-link by
  // design — see _todo.md / Discord — but surface it loudly so the user can
  // catch accidental double-links.
  const broadcastLinks = useMemo<BroadcastLinkRef[]>(() => {
    const refs: BroadcastLinkRef[] = []
    for (const f of allFolders) {
      const id = f.meta?.ytVideoId
      if (!id) continue
      const title = f.meta?.ytTitle?.trim() || f.meta?.twitchTitle?.trim()
      refs.push({
        broadcastId: id,
        folderDate: f.date,
        folderTitle: title || undefined,
      })
    }
    return refs
  }, [allFolders])

  /** Cross-link refs for the currently-selected broadcast, if any. Used to
   *  surface a "shared with other items" banner in the linked-state UI. */
  const selectedBroadcastSharedLinks = useMemo<BroadcastLinkRef[]>(() => {
    if (!ytSelectedBroadcastId) return []
    return broadcastLinks.filter(l => l.broadcastId === ytSelectedBroadcastId)
  }, [ytSelectedBroadcastId, broadcastLinks])

  const broadcastMismatch = useMemo(() => {
    if (!selectedBroadcast) return false
    // Title: direct compare (trim both sides — YT sometimes adds/strips
    // trailing whitespace on round-trip).
    if ((selectedBroadcast.snippet.title ?? '').trim() !== ytTitle.trim()) return true
    // Description: normalize line endings (YT returns \r\n, local can be
    // either) and trim, so a no-op edit doesn't read as a mismatch.
    const normDesc = (s: string | undefined) => (s ?? '').replace(/\r\n/g, '\n').trim()
    if (normDesc(selectedBroadcast.snippet.description) !== normDesc(ytDescription)) return true
    if (selectedBroadcast.snippet.gameTitle && selectedBroadcast.snippet.gameTitle !== ytGameTitle) return true
    // Tags: compare as a sorted, case-folded set rather than an ordered
    // string. Whitespace around commas / casing / order shouldn't count
    // as "mismatched."
    const normTagSet = (tags: string[] | undefined) =>
      [...(tags ?? [])].map(t => t.trim().toLowerCase()).filter(Boolean).sort().join('|')
    const localTagSet = normTagSet(ytTagsText.split(','))
    const remoteTagSet = normTagSet(selectedBroadcast.snippet.tags)
    // Only flag tag mismatch when the remote actually has tags (some YT
    // broadcasts come back with tags=undefined even though we set them —
    // tags hydrate from a separate videos.list call that may not have run
    // yet) OR the local list has tags that the remote doesn't.
    if (remoteTagSet && remoteTagSet !== localTagSet) return true
    if (!remoteTagSet && localTagSet) return true
    return false
  }, [selectedBroadcast, ytTitle, ytDescription, ytGameTitle, ytTagsText])

  // Auto-check pushYouTube reactively against broadcastMismatch. No-op once
  // the user manually toggles. broadcastMismatch is false until the YT
  // broadcasts list loads, so on a fresh modal mount the checkbox starts
  // unchecked and only flips on once we've confirmed there are unpushed
  // differences. Falsifies cleanly after a successful push too — the local
  // broadcast cache gets updated to match what we sent.
  useEffect(() => {
    if (pushYouTubeTouched.current) return
    setPushYouTube(ytConnected && !!ytSelectedBroadcastId && (broadcastMismatch || thumbnailNeedsPush))
  }, [ytConnected, ytSelectedBroadcastId, broadcastMismatch, thumbnailNeedsPush])
  // Auto-check pushTwitch the same way, against the snapshot-driven flag.
  useEffect(() => {
    if (pushTwitchTouched.current) return
    setPushTwitch(twConnected && !isPastStream && isNextUpcomingStream && hasPendingTwitchPush)
  }, [twConnected, isPastStream, isNextUpcomingStream, hasPendingTwitchPush])

  const applyBroadcastToMeta = () => {
    if (!selectedBroadcast) return
    const newTitle = selectedBroadcast.snippet.title
    const newGame = selectedBroadcast.snippet.gameTitle
    setYtTitle(newTitle)
    setYtDescription(selectedBroadcast.snippet.description)
    if (newGame) setYtGameTitle(newGame)
    if (selectedBroadcast.snippet.tags?.length) setYtTagsText(selectedBroadcast.snippet.tags.join(', '))
    if (pushTwitch && twConnected) {
      if (syncTitle) setTwitchTitle(newTitle)
      if (newGame) setTwitchGameName(newGame)
    }
  }

  // Unified action handler: saves SM meta (when dirty) and pushes to the
  // platforms whose checkboxes are on. Each stage is wrapped in its own
  // try/catch so a Twitch failure after a successful YT push doesn't roll
  // back the YT-pending flag, and the user sees exactly which stage failed.
  const willPushYouTube = pushYouTube && ytConnected && !!ytSelectedBroadcastId
  const willPushTwitch = pushTwitch && twConnected && !isPastStream
  const handleAction = async () => {
    if (!date) { showBanner({ type: 'error', message: 'Date is required.' }); return }
    setSaving(true)
    setPushing(true)
    setBanner(null)

    const tags = ytTagsText.split(',').map(t => t.trim()).filter(Boolean)
    const twitchOverrideTags = twitchTagsText.split(',').map(t => t.trim()).filter(Boolean)
    const effectiveTwitchTitle = syncTitle ? ytTitle : twitchTitle
    const effectiveTwitchGame = syncGame ? ytGameTitle : twitchGameName
    let savedOK = false
    let ytPushedOK = false
    let ytThumbnailWarning = ''
    let twitchPushedOK = false

    // When we're pushing the thumbnail, record its hash so future opens know
    // it's already pushed. This also forces a meta save even when nothing
    // else changed (thumbnail-only push) — otherwise the new hash wouldn't
    // persist and the modal would keep offering the push.
    const recordThumbnailHash = willPushYouTube && thumbnailNeedsPush && !!currentThumbnailHash
    const nextThumbnailPushedHash: string | undefined = recordThumbnailHash
      ? (currentThumbnailHash ?? undefined)
      : (lastPushedThumbnailHash ?? initialMeta?.ytThumbnailPushedHash)

    // ── Save SM meta (for new mode, when dirty, or to persist a thumbnail
    //    hash from a thumbnail-only push) ──
    if (isDirty || mode === 'new' || recordThumbnailHash) {
      try {
        await onSave(
          {
            date, streamType: streamTypes, games, comments,
            archived: mode === 'edit' ? archived : undefined,
            preferredThumbnail: localPreferredThumbnail,
            smThumbnail: mode === 'new' ? (useBuiltinThumbnail || undefined) : initialMeta?.smThumbnail,
            smThumbnailTemplate: mode === 'new' ? initialMeta?.smThumbnailTemplate : initialMeta?.smThumbnailTemplate,
            ytVideoId: ytVideoUnlinked ? undefined : (ytSelectedBroadcastId || initialMeta?.ytVideoId || undefined),
            ytTitle: ytTitle || undefined,
            ytDescription: ytDescription || undefined,
            ytGameTitle: ytGameTitle || undefined,
            ytCatchyTitle: ytCatchyTitle || undefined,
            ytSeason: ytSeason !== '1' ? ytSeason : undefined,
            ytEpisode: ytEpisode || undefined,
            ytTags: tags.length > 0 ? tags : undefined,
            twitchTitle: effectiveTwitchTitle || undefined,
            twitchGameName: effectiveTwitchGame || undefined,
            twitchTags: twitchOverrideTags.length > 0 ? twitchOverrideTags : undefined,
            syncTitle,
            syncGame,
            ytThumbnailPushedHash: nextThumbnailPushedHash,
          },
          date,
          mode === 'new' && !useBuiltinThumbnail && !copyFromSource ? (defaultTemplate?.path || undefined) : undefined,
          mode === 'new' && copyFromSource ? (prevEpisodeFolder?.folderPath ?? undefined) : undefined,
          undefined,
        )
        initialSnapshot.current = JSON.stringify({
          streamTypes, games, comments, archived, ytTitle, ytDescription, ytGameTitle,
          ytTagsText, ytSeason, ytEpisode, ytCatchyTitle, twitchTitle, twitchGameName, twitchTagsText,
          syncTitle, syncGame,
          ytVideoId: ytVideoUnlinked ? undefined : (ytSelectedBroadcastId || initialMeta?.ytVideoId || undefined),
          preferredThumbnail: localPreferredThumbnail,
        })
        setIsDirty(false)
        savedOK = true
      } catch (e: any) {
        console.error('[modal action] save failed:', e)
        showBanner({ type: 'error', message: `Save failed: ${e.message ?? e}` })
        setSaving(false); setPushing(false)
        return
      }
    }

    // ── Push to YouTube ───────────────────────────────────────────────────
    if (willPushYouTube) {
      try {
        if (isPastStream) {
          await window.api.youtubeUpdateVideo(ytSelectedBroadcastId, ytTitle, ytDescription, tags)
        } else {
          await window.api.youtubeUpdateBroadcast(
            ytSelectedBroadcastId,
            { title: ytTitle, description: ytDescription },
            tags
          )
        }
        // Thumbnail upload is non-fatal — metadata above has committed.
        if (effectiveYtThumb) {
          try {
            await window.api.youtubeUploadThumbnail(ytSelectedBroadcastId, effectiveYtThumb)
            // Record the pushed hash so the thumbnail-change detector knows
            // this exact thumbnail is now live — unchecks the push offer.
            if (currentThumbnailHash) setLastPushedThumbnailHash(currentThumbnailHash)
          } catch (e: any) {
            ytThumbnailWarning = e.message || 'Thumbnail upload failed.'
          }
        }
        // Refresh the local broadcast/VOD cache to reflect the values we
        // just pushed. broadcastMismatch is the source of truth for the YT
        // push checkbox — so this update is what makes the checkbox uncheck
        // after a successful push. Must include tags + gameTitle, not just
        // title/description, or the comparison will still see "mismatch."
        const updater = (items: LiveBroadcast[]) => items.map(b =>
          b.id === ytSelectedBroadcastId
            ? {
                ...b,
                snippet: {
                  ...b.snippet,
                  title: ytTitle,
                  description: ytDescription,
                  gameTitle: ytGameTitle || b.snippet.gameTitle,
                  tags: tags.length > 0 ? tags : undefined,
                },
              }
            : b
        )
        if (isPastStream) setYtVods(updater); else setYtBroadcasts(updater)
        // Reset the manual-touch flag so future field changes re-auto-check
        // the checkbox via the broadcastMismatch-driven effect.
        pushYouTubeTouched.current = false
        ytPushedOK = true
      } catch (e: any) {
        console.error('[modal action] yt push failed:', e)
        showBanner({ type: 'error', message: `YouTube push failed: ${e.message ?? e}` })
        setSaving(false); setPushing(false)
        return
      }
    }

    // ── Push to Twitch ────────────────────────────────────────────────────
    if (willPushTwitch) {
      try {
        const { compat: twitchSendTags } = toTwitchCompatibleTags(twitchOverrideTags)
        await window.api.twitchUpdateChannel(
          effectiveTwitchTitle,
          effectiveTwitchGame || undefined,
          twitchSendTags,
        )
        // Snapshot the payload we just sent so future renders know there's
        // nothing pending until the user changes something.
        setTwitchPushSnapshot(currentTwitchPushPayload)
        pushTwitchTouched.current = false
        twitchPushedOK = true
      } catch (e: any) {
        console.error('[modal action] twitch push failed:', e)
        showBanner({ type: 'error', message: `Twitch push failed: ${e.message ?? e}` })
        setSaving(false); setPushing(false)
        return
      }
    }

    // ── Success banner — describes exactly what happened.
    const parts: string[] = []
    if (savedOK) parts.push('Saved')
    if (ytPushedOK) parts.push(isPastStream ? 'Pushed to YouTube VOD' : 'Pushed to YouTube')
    if (twitchPushedOK) parts.push('Pushed to Twitch')
    if (parts.length > 0) {
      const msg = parts.join(' & ') + (ytThumbnailWarning ? ` (thumbnail upload failed: ${ytThumbnailWarning})` : '')
      showBanner({ type: 'success', message: msg })
    }
    setSaving(false); setPushing(false)
    if (mode === 'new') onClose()
  }

  const title = mode === 'new' ? 'New Stream' : mode === 'add' ? 'Add Metadata' : 'Edit Metadata'

  // Dynamic action-button label reflects exactly what the click will do.
  // For "new" mode the SM-save is always required (the folder doesn't exist
  // yet), so the verb is always "Create Stream" with any pushes appended.
  // For edit/add the verb branches on whether SM meta is dirty.
  const actionLabel = (() => {
    const pushParts: string[] = []
    if (willPushYouTube) pushParts.push('YouTube')
    if (willPushTwitch) pushParts.push('Twitch')
    const pushSuffix = pushParts.length > 0 ? ` & Push to ${pushParts.join(' + ')}` : ''
    if (mode === 'new') return `Create Stream${pushSuffix}`
    if (isDirty) return `Save${pushSuffix}`
    if (pushParts.length > 0) return `Push to ${pushParts.join(' + ')}`
    return 'Save'
  })()
  const actionDisabled = mode === 'new'
    ? !date
    : !isDirty && !willPushYouTube && !willPushTwitch

  // User-initiated close in new mode: hand the parent a draft snapshot of
  // the current form fields before letting the modal unmount, so reopening
  // the new-stream modal can restore the in-progress work. Edit/add mode
  // doesn't need this (saves are explicit; dirty changes are lost on
  // cancel as before). Save-success uses bare onClose() so the freshly-
  // cleared draft in the parent isn't immediately re-populated.
  const closeWithDraft = () => {
    if (mode === 'new' && onDraftCapture) {
      const ytTagsArr = ytTagsText.split(',').map(t => t.trim()).filter(Boolean)
      const twitchTagsArr = twitchTagsText.split(',').map(t => t.trim()).filter(Boolean)
      // Treat the form as "empty" when none of the user-input fields have
      // meaningful content. Without this guard, closing a freshly-cleared
      // modal would re-capture the blank state as a draft and the
      // "draft in progress" caption under the New Stream button would
      // stay stuck on. Excludes:
      //   - date / syncTitle / syncGame — always have defaults
      //   - ytEpisode / ytSeason '1' — auto-detected defaults
      //   - ytGameTitle — auto-populated from games[0] when games is set
      // Detection of "user actually entered something" relies on the
      // text-input fields the user has to actively type into.
      const hasContent =
        !!ytTitle || !!ytDescription || !!ytCatchyTitle ||
        (!!ytEpisode && ytEpisode !== '1') ||
        (!!ytSeason && ytSeason !== '1') ||
        ytTagsArr.length > 0 ||
        !!twitchTitle || !!twitchGameName || twitchTagsArr.length > 0 ||
        !!comments || games.length > 0 || streamTypes.length > 0
      if (!hasContent) {
        onDraftCapture(null)
      } else {
        onDraftCapture({
          date,
          streamType: streamTypes,
          games,
          comments,
          ytTitle: ytTitle || undefined,
          ytDescription: ytDescription || undefined,
          ytGameTitle: ytGameTitle || undefined,
          ytCatchyTitle: ytCatchyTitle || undefined,
          ytSeason: ytSeason !== '1' ? ytSeason : undefined,
          ytEpisode: ytEpisode || undefined,
          ytTags: ytTagsArr.length > 0 ? ytTagsArr : undefined,
          twitchTitle: twitchTitle || undefined,
          twitchGameName: twitchGameName || undefined,
          twitchTags: twitchTagsArr.length > 0 ? twitchTagsArr : undefined,
          syncTitle,
          syncGame,
          preferredThumbnail: localPreferredThumbnail,
        })
      }
    }
    onClose()
  }

  return (
    <Modal
      isOpen
      noOverlay
      onClose={closeWithDraft}
      title={title}
      width="2xl"
      dismissible={false}
      headerExtra={mode === 'new' && onDraftClear ? (
        <button
          type="button"
          onClick={() => onDraftClear()}
          className="text-xs text-gray-400 hover:text-red-300 hover:bg-red-500/10 px-2.5 py-1 rounded-md border border-white/10 hover:border-red-500/40 transition-colors"
        >
          Clear all fields
        </button>
      ) : undefined}
      autoFocus={mode === 'new' ? 'initial-only' : 'none'}
      footer={
        <div className="w-full flex flex-col">
          {/* Banner — attached to the top of the footer. Spans the full
              modal width via negative horizontal margin that cancels the
              footer's px-6. Success auto-dismisses; error sticks until
              the user clicks the X. */}
          {banner && (
            <div className={`-mx-6 -mt-4 mb-3 px-6 py-2 border-b text-xs flex items-center gap-2 ${
              banner.type === 'error'
                ? 'bg-red-900/30 border-red-400/30 text-red-300'
                : 'bg-green-900/30 border-green-400/30 text-green-300'
            }`}>
              {banner.type === 'error'
                ? <AlertTriangle size={12} className="shrink-0" />
                : <CheckCircle2 size={12} className="shrink-0" />}
              <span className="flex-1 whitespace-pre-wrap">{banner.message}</span>
              {banner.type === 'error' && (
                <button
                  onClick={() => setBanner(null)}
                  className="shrink-0 p-0.5 rounded hover:bg-white/10 text-red-300 hover:text-red-200 transition-colors"
                  aria-label="Dismiss"
                >
                  <X size={12} />
                </button>
              )}
            </div>
          )}
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          {/* Left: Cancel/Close + (edit/past) Archived checkbox */}
          <div className="flex items-center gap-3 justify-start min-w-0">
            <Button variant="ghost" onClick={closeWithDraft} className={(mode !== 'new' && isDirty) ? 'text-red-400 hover:text-red-300' : ''}>{(mode !== 'new' && isDirty) ? 'Cancel' : 'Close'}</Button>
            {mode === 'edit' && isPastStream && (
              <>
                <Checkbox checked={archived} onChange={setArchived} label="Archived" color="green" />
                {archived && !initialMeta?.archived && (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-950/50 border border-amber-600/30 text-xs text-amber-300/90">
                    <AlertTriangle size={13} className="shrink-0 mt-0.5 text-amber-400" />
                    <span>This marks the stream as archived. Use the <strong>Archive</strong> process for a complete archive.</span>
                  </div>
                )}
              </>
            )}
          </div>
          {/* Center: per-platform push checkboxes. Stays centered regardless
              of how wide the left or right groups grow. Past streams hide
              the Twitch checkbox entirely (pushing finished-stream info to
              the live channel doesn't make sense). */}
          <div className="flex items-center gap-3 justify-center">
            <Checkbox
              checked={pushYouTube}
              onChange={handlePushYouTubeChange}
              disabled={!ytConnected || !ytSelectedBroadcastId}
              label="Push to YouTube"
              size="sm"
            />
            {!isPastStream && (
              <Checkbox
                checked={pushTwitch}
                onChange={handlePushTwitchChange}
                disabled={!twConnected}
                label="Push to Twitch"
                size="sm"
              />
            )}
          </div>
          {/* Right: the unified action button */}
          <div className="flex justify-end">
            <Button variant="primary" loading={saving || pushing} onClick={handleAction} disabled={actionDisabled}>
              {actionLabel}
            </Button>
          </div>
          </div>
        </div>
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
            onDeleteImage={onDeleteImage}
            onEditThumbnail={onEditThumbnail}
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
              <span className="ml-2 text-xs text-gray-400 font-normal">(auto-detected from files)</span>
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

        {/* Thumbnail — new streams only.
            Two checkboxes replace the per-stream template pickers. The
            specific built-in template is asked at the SM editor's first open
            on the new stream; the external template defaults to the user's
            Settings choice. Power users who want a per-stream override can
            still drop a thumbnail file into the new folder afterward. */}
        {mode === 'new' && (
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium text-gray-300">Thumbnail</label>
            <Checkbox
              checked={useBuiltinThumbnail}
              onChange={setUseBuiltinThumbnail}
              label="Use built-in thumbnail creator"
            />
            {hasPrevThumbnails && (
              <Checkbox
                checked={copyFromSource}
                onChange={setCopyFromSource}
                label={sourceFolder ? "Copy thumbnails from this stream" : 'Copy thumbnails from previous episode'}
              />
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
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Stream Details</h3>
            {!twConnected && (
              <p className="text-[10px] text-gray-400 italic flex items-center gap-1.5">
                <LucideTwitch size={11} className="text-twitch-400/70" />
                Twitch not connected — fields save locally only. Configure in Integrations to push to Twitch.
              </p>
            )}
          </div>

          {/* Merge-field params: Game, {tagline}, Season, Episode/Total.
              Order: Game (the primary metadata input) → tagline (the catchy
              part that gets templated into titles/descriptions) → season →
              episode/total. The Game cell hosts the Twitch sync checkbox
              underneath since it's the only field here that pushes to Twitch. */}
          <div className="grid grid-cols-[1fr_1fr_auto_auto] gap-2 items-start">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-400 flex items-center gap-1.5">
                Game Title
                <span className="font-mono text-purple-400 font-normal">{'{game}'}</span>
                <LucideYoutube size={11} className="text-red-400/70" />
                {twConnected && syncGame && <LucideTwitch size={11} className="text-twitch-400/70" />}
              </label>
              <input
                value={ytGameTitle}
                onChange={e => setYtGameTitle(e.target.value)}
                className="w-full bg-navy-900 border border-white/10 text-gray-200 text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-purple-500/40"
              />
              {twConnected ? (
                <Checkbox checked={syncGame} onChange={setSyncGame} label="Sync with Twitch" size="sm" />
              ) : (
                <span className="text-[10px] text-gray-400">Set manually in YouTube Studio</span>
              )}
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-400">
                Tagline <span className="font-mono text-purple-400 font-normal">{'{tagline}'}</span>
              </label>
              <input
                value={ytCatchyTitle}
                onChange={e => setYtCatchyTitle(e.target.value)}
                placeholder="catchy tagline…"
                className="w-full bg-navy-900 border border-white/10 text-gray-200 text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-purple-500/40 placeholder-gray-700"
              />
            </div>
            <div className="flex flex-col gap-1 items-center">
              <label className="text-xs font-medium text-gray-400 whitespace-nowrap flex items-center gap-1">
                <Tooltip content="Auto-inherited from the most recent preceding stream in the same series. Change it to start a new season — episode numbering will restart from 1." side="top">
                  <Info size={11} className="text-gray-400 cursor-default" />
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
                <label className="text-xs font-medium text-gray-400 whitespace-nowrap flex items-center gap-1">
                  <Tooltip content="Auto-detected by counting preceding streams with the same game and season. Resets to 1 when season changes. Can be overridden manually." side="top">
                    <Info size={11} className="text-gray-400 cursor-default" />
                  </Tooltip>
                  <span className="font-mono text-purple-400">{'{episode}'}</span>
                </label>
                <input
                  value={ytEpisode}
                  onChange={e => { ytEpisodeUserEdited.current = true; setYtEpisode(e.target.value) }}
                  className="w-10 bg-navy-900 border border-white/10 text-gray-200 text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-purple-500/40"
                />
              </div>
              <span className="text-gray-400 text-xs pb-1.5 shrink-0">/</span>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-gray-400 whitespace-nowrap flex items-center gap-1">
                  <span className="font-mono text-purple-400">{'{total_episodes}'}</span>
                  <Tooltip content="Total episodes in this season. Auto-counted from all streams sharing the same game and season, including this one. Can be overridden manually." side="top">
                    <Info size={11} className="text-gray-400 cursor-default" />
                  </Tooltip>
                </label>
                <input
                  value={ytTotalEpisodes}
                  onChange={e => setYtTotalEpisodes(e.target.value)}
                  className="w-10 bg-navy-900 border border-white/10 text-gray-200 text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-purple-500/40"
                />
              </div>
            </div>
          </div>

          {/* Stream/Video Title — the actual title that gets pushed to
              YouTube + Twitch. Templated via merge fields above. */}
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-gray-400 flex items-center gap-1.5">
                Stream/Video Title
                <LucideYoutube size={11} className="text-red-400/70" />
                {twConnected && syncTitle && <LucideTwitch size={11} className="text-twitch-400/70" />}
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
              {claudeEnabled && titleSg.hint === 'loading' && <Loader2 size={10} className="animate-spin text-gray-400" />}
              {claudeEnabled && titleSg.hint === 'accept' && <span className="flex items-center gap-1 text-[10px] text-gray-400"><Sparkles size={9} />Tab to accept · Esc to dismiss</span>}
              {(!claudeEnabled || !titleSg.hint) && <span />}
              <p className="text-xs text-gray-400">{ytTitle.length}/100</p>
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
              <p className="text-right text-xs text-gray-400">{twitchTitle.length}/140</p>
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
              {claudeEnabled && descLoading && <Loader2 size={10} className="animate-spin text-gray-400" />}
              {claudeEnabled && !descLoading && descSuggestion && <span className="flex items-center gap-1 text-[10px] text-gray-400"><Sparkles size={9} />Tab to accept · Esc to dismiss</span>}
            </div>
          </div>

          {/* Tags */}
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-gray-400 flex items-center gap-1.5">
                Tags
                <LucideYoutube size={11} className="text-red-400/70" />
                <span className="text-gray-400 font-normal">(comma-separated)</span>
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
                {canSaveTagsTemplate && (
                  <SaveAsTemplateButton
                    onSave={saveTagsAsTemplate}
                    suggestedName={(() => {
                      const game = games[0]?.trim()
                      if (!game) return undefined
                      const exists = ytTagTemplates.some(t => t.name.toLowerCase() === game.toLowerCase())
                      return exists ? undefined : game
                    })()}
                  />
                )}
                <InlineTemplateSelect items={ytTagTemplates} value={ytSelectedTagId} onChange={setYtSelectedTagId} />
              </div>
            </div>
            <textarea
              ref={tagsSg.ref as React.RefObject<HTMLTextAreaElement>}
              value={ytTagsText}
              className="w-full min-h-[3.25rem] bg-navy-900 border border-white/10 text-gray-200 text-xs font-mono rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500/40 resize-none overflow-hidden"
              {...tagsSg.props}
            />
            <div className="flex items-center justify-between min-h-[16px]">
              {claudeEnabled && tagsSg.hint === 'loading' && <Loader2 size={10} className="animate-spin text-gray-400" />}
              {claudeEnabled && tagsSg.hint === 'accept' && <span className="flex items-center gap-1 text-[10px] text-gray-400"><Sparkles size={9} />Tab to accept · Esc to dismiss</span>}
              {(!claudeEnabled || !tagsSg.hint) && <span />}
              {(() => {
                const tagCount = ytTagsText.split(',').map(t => t.trim()).filter(Boolean).length
                const charCount = ytTagCharCount(ytTagsText)
                const overLimit = charCount > YT_TAG_CHAR_LIMIT
                const nearLimit = !overLimit && charCount >= YT_TAG_CHAR_LIMIT * 0.85
                const colorCls = overLimit ? 'text-red-400' : nearLimit ? 'text-amber-400' : 'text-gray-400'
                return (
                  <p className={`text-xs tabular-nums ${colorCls}`}>
                    {tagCount} tags · {charCount} / {YT_TAG_CHAR_LIMIT} chars
                  </p>
                )
              })()}
            </div>
          </div>

          {/* Twitch tags — independent field with its own templates + Claude
              support. Twitch's tag rules diverge enough from YouTube's that
              syncing the two would just surface "X skipped" everywhere it
              gets used; better to treat them as separate first-class lists. */}
          {twConnected && (
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-gray-400 flex items-center gap-1.5">
                  Twitch tags
                  <LucideTwitch size={11} className="text-twitch-400/70" />
                  <span className="text-gray-400 font-normal">(comma-separated)</span>
                </label>
                <div className="flex items-center gap-3">
                  {canSaveTwitchTagsTemplate && (
                    <SaveAsTemplateButton
                      onSave={saveTwitchTagsAsTemplate}
                      suggestedName={(() => {
                        const game = games[0]?.trim()
                        if (!game) return undefined
                        // Twitch tag names can include spaces in the template label.
                        const exists = twitchTagTemplates.some(t => t.name.toLowerCase() === game.toLowerCase())
                        return exists ? undefined : game
                      })()}
                    />
                  )}
                  <InlineTemplateSelect items={twitchTagTemplates} value={selectedTwitchTagId} onChange={setSelectedTwitchTagId} />
                </div>
              </div>
              <textarea
                ref={twitchTagsSg.ref as React.RefObject<HTMLTextAreaElement>}
                value={twitchTagsText}
                className="w-full min-h-[3.25rem] bg-navy-900 border border-white/10 text-gray-200 text-xs font-mono rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500/40 resize-none overflow-hidden"
                {...twitchTagsSg.props}
              />
              <div className="flex items-center justify-between min-h-[16px]">
                {claudeEnabled && twitchTagsSg.hint === 'loading' && <Loader2 size={10} className="animate-spin text-gray-400" />}
                {claudeEnabled && twitchTagsSg.hint === 'accept' && <span className="flex items-center gap-1 text-[10px] text-gray-400"><Sparkles size={9} />Tab to accept · Esc to dismiss</span>}
                {(!claudeEnabled || !twitchTagsSg.hint) && <span />}
                {(() => {
                  const entered = twitchTagsText.split(',').map(t => t.trim()).filter(Boolean)
                  const { compat, skipped } = toTwitchCompatibleTags(entered)
                  return (
                    <p className="text-[10px] tabular-nums text-gray-400">
                      {compat.length} / {TWITCH_TAG_MAX_COUNT} valid
                      {skipped.length > 0 && <span className="text-amber-400 ml-1">· {skipped.length} invalid (alphanumeric only, ≤25 chars)</span>}
                    </p>
                  )
                })()}
              </div>
            </div>
          )}

          {/* Twitch category override — only shown when syncGame is off.
              When sync is on, the YouTube game title above is auto-resolved
              to a Twitch category at push time via /search/categories. */}
          {twConnected && !syncGame && (
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
              <p className="text-xs text-gray-400">Searched against Twitch categories — closest match will be used.</p>
            </div>
          )}
        </div>

        {/* ── YouTube ─────────────────────────────────────────────────────── */}
        {!ytConnected && (
          <div className="flex flex-col gap-2 pt-1 border-t border-white/5">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
              <LucideYoutube size={13} className="text-red-400" /> YouTube VOD/Video Connection
              <span className="text-gray-400 font-normal normal-case tracking-normal">— Not connected</span>
            </h3>
            <p className="text-xs text-gray-400 leading-relaxed">
              The fields above will be saved locally. Connect YouTube in <span className="text-gray-200">Integrations</span> to link a broadcast, push metadata, and upload thumbnails.
            </p>
          </div>
        )}
        {ytConnected && (
          <div className="flex flex-col gap-3 pt-1 border-t border-white/5">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
              <LucideYoutube size={13} className="text-red-400" /> YouTube VOD/Video Connection
            </h3>

            {/* Broadcast / VOD picker.
                State machine:
                  Linked    (ytSelectedBroadcastId set) → dropdown shows selected, X to unlink, Push button enabled
                  Unlinked  (no id) → three options stacked vertically: pick, paste, create
                The "Create" affordance is only available for future-dated
                streams (you can't schedule a broadcast in the past), and is
                hidden entirely for past-stream metadata edits. */}
            {ytBroadcastError ? (
              <p className="text-xs text-red-400 flex items-center gap-1.5">
                <AlertTriangle size={12} className="shrink-0" />
                {ytBroadcastError}
              </p>
            ) : (() => {
              // Future-date gate for the Create section. The "Create" option
              // is only meaningful for a stream that hasn't happened yet.
              const streamDateInFuture = !isPastStream && (() => {
                const [y, m, d] = date.split('-').map(n => parseInt(n, 10))
                if (!y || !m || !d) return false
                const eod = new Date(y, m - 1, d, 23, 59, 59, 999)
                return eod.getTime() > Date.now()
              })()
              const createBroadcast = async () => {
                setYtCreatingBroadcast(true)
                setYtCreateError('')
                try {
                  // Build scheduledStartTime from the stream's date + user's
                  // chosen time. If that ends up in the past (e.g. user picks
                  // an early time on a same-day stream), clamp to now+5min so
                  // YouTube doesn't reject the request.
                  const [hh, mm] = ytNewTime.split(':').map(n => parseInt(n, 10))
                  const [y, m, d] = date.split('-').map(n => parseInt(n, 10))
                  const target = new Date(y, m - 1, d, hh, mm, 0, 0).getTime()
                  const future = Date.now() + 5 * 60 * 1000
                  const scheduledStartTime = new Date(Math.max(target, future)).toISOString()
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
              }
              return (
                <div className="flex flex-col gap-2">
                  <label className="text-xs font-medium text-gray-400">
                    {isPastStream ? 'VOD' : 'Broadcast'}
                  </label>

                  {/* Dropdown — primary picker. Lists existing broadcasts
                      (including the user's default broadcast if they have
                      one set up). The X clears the selection so the user can
                      switch via dropdown or fall through to URL/Create.
                      Rich-row rendering + cross-link warnings live inside
                      the BroadcastPicker component. */}
                  <div className="flex items-center gap-1.5">
                    <div className="flex-1 min-w-0">
                      <BroadcastPicker
                        value={ytSelectedBroadcastId}
                        onChange={id => { setYtSelectedBroadcastId(id); setYtManualUrl(''); setYtManualError('') }}
                        broadcasts={isPastStream ? ytVods : ytBroadcasts}
                        otherFolderLinks={broadcastLinks}
                        loading={ytBroadcastsLoading}
                        placeholder="— Select a broadcast —"
                        emptyLabel={!isPastStream ? '— No upcoming broadcasts —' : '— No VODs found —'}
                        showDateOnly={isPastStream}
                        onOpen={isPastStream ? loadAllVods : undefined}
                      />
                    </div>
                    {ytSelectedBroadcastId && (
                      <Tooltip content="Unlink from broadcast" triggerClassName="shrink-0">
                      <button
                        type="button"
                        onClick={() => { setYtSelectedBroadcastId(''); setYtVideoUnlinked(true); setYtManualUrl(''); setYtManualError('') }}
                        className="p-1.5 rounded-lg text-gray-400 hover:text-gray-300 hover:bg-white/5 transition-colors"
                      >
                        <X size={12} />
                      </button>
                      </Tooltip>
                    )}
                  </div>

                  {/* Privacy selector — only shown when a broadcast is linked.
                      Edits the live broadcast's status.privacyStatus via the
                      YouTube API. Optimistic UI update + revert-on-failure;
                      the next listStreams refresh re-syncs the row badge. */}
                  {selectedBroadcast && currentPrivacy && (
                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] text-gray-400 uppercase tracking-wider">Privacy</span>
                      <div className="flex items-center gap-1.5">
                        {([
                          { value: 'public' as const,   label: 'Public',   Icon: Globe },
                          { value: 'unlisted' as const, label: 'Unlisted', Icon: EyeOff },
                          { value: 'private' as const,  label: 'Private',  Icon: Lock },
                        ]).map(({ value, label, Icon }) => {
                          const active = currentPrivacy === value
                          return (
                            <button
                              key={value}
                              type="button"
                              onClick={() => changePrivacy(value)}
                              disabled={savingPrivacy && !active}
                              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
                                active
                                  ? 'bg-purple-600/25 border-purple-500/40 text-purple-200'
                                  : 'bg-white/5 border-white/10 text-gray-400 hover:bg-white/10 hover:text-gray-200 disabled:opacity-40 disabled:hover:bg-white/5 disabled:hover:text-gray-400'
                              }`}
                            >
                              <Icon size={11} />
                              {label}
                            </button>
                          )
                        })}
                        {savingPrivacy && <Loader2 size={11} className="animate-spin text-gray-400 ml-1" />}
                      </div>
                      {privacyError && (
                        <p className="text-xs text-red-400 flex items-center gap-1.5">
                          <AlertTriangle size={11} className="shrink-0" />
                          {privacyError}
                        </p>
                      )}
                    </div>
                  )}

                  {/* Linked-state multi-link warning — surfaced whenever the
                      currently-selected broadcast is also linked from one or
                      more other stream items. Not a blocker; the message
                      explains the implication of pushing this item's data. */}
                  {ytSelectedBroadcastId && selectedBroadcastSharedLinks.length > 0 && (
                    <div className="flex items-start gap-1.5 px-2.5 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-xs text-amber-300 leading-relaxed">
                      <AlertTriangle size={12} className="shrink-0 mt-0.5" />
                      <span>
                        {selectedBroadcastSharedLinks.length === 1 ? (
                          <>
                            Another stream item is already linked to this broadcast:{' '}
                            <strong className="text-amber-200">
                              {selectedBroadcastSharedLinks[0].folderDate}
                              {selectedBroadcastSharedLinks[0].folderTitle ? ` · ${selectedBroadcastSharedLinks[0].folderTitle}` : ''}
                            </strong>
                            . Pushing this item's data will overwrite the stream details on YouTube.
                          </>
                        ) : (
                          <>
                            <strong className="text-amber-200">{selectedBroadcastSharedLinks.length} other stream items</strong> are
                            already linked to this broadcast. Pushing this item's data will overwrite the stream details on YouTube.
                          </>
                        )}
                      </span>
                    </div>
                  )}

                  {/* Unlinked-state alternatives: paste URL + (for future-dated
                      streams) create a new broadcast. Both fall away when a
                      broadcast is selected so the linked-state UX stays clean. */}
                  {!ytSelectedBroadcastId && (
                    <>
                      <div className="flex flex-col gap-1">
                        <span className="text-[10px] text-gray-400 uppercase tracking-wider">Or paste a URL</span>
                        <input
                          value={ytManualUrl}
                          onChange={e => handleManualUrlChange(e.target.value)}
                          placeholder="https://youtube.com/watch?v=… or video ID"
                          className="w-full bg-navy-900 border border-white/10 text-gray-200 text-xs rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-500/40 placeholder-gray-600"
                        />
                        {ytManualLoading && (
                          <p className="text-xs text-gray-400 flex items-center gap-1.5">
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

                      {streamDateInFuture && (
                        <div className="flex flex-col gap-1.5">
                          <span className="text-[10px] text-gray-400 uppercase tracking-wider">Or create a new scheduled broadcast</span>
                          <div className="flex items-center gap-2 flex-wrap">
                            <div className="flex items-center gap-1.5">
                              <label className="text-xs text-gray-400 shrink-0">Time</label>
                              <input
                                type="time"
                                value={ytNewTime}
                                onChange={e => setYtNewTime(e.target.value)}
                                disabled={ytCreatingBroadcast}
                                // Asymmetric padding: native time-input chrome
                                // adds ~1px to the bottom of the rendered box
                                // that other inputs don't have. pt-[5px] pb-1
                                // shaves that off so the height lands flush
                                // with the privacy dropdown + button.
                                className="bg-navy-900 border border-white/10 text-gray-200 text-xs rounded-lg px-2 pt-[5px] pb-1 focus:outline-none focus:ring-2 focus:ring-red-500/40 disabled:opacity-50 [color-scheme:dark]"
                              />
                            </div>
                            <div className="flex items-center gap-1.5">
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
                                <ChevronDown size={11} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                              </div>
                            </div>
                            <Button
                              variant="primary"
                              size="sm"
                              loading={ytCreatingBroadcast}
                              onClick={createBroadcast}
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
                      )}
                    </>
                  )}

                  {/* Linked-state actions — mismatch banner + Open in Studio. */}
                  {(broadcastMismatch || ytSelectedBroadcastId) && (
                    <div className="flex items-center gap-2">
                      {broadcastMismatch && (
                        <Tooltip content="Replace the metadata in this modal with the title/description/tags from YouTube">
                        <button
                          type="button"
                          onClick={applyBroadcastToMeta}
                          className="flex items-center gap-1.5 text-xs text-gray-200 bg-surface-100 border border-white/10 hover:bg-surface-200 transition-colors rounded-lg px-3 py-1.5"
                        >
                          <RefreshCw size={11} className="shrink-0" />
                          Pull info from YouTube
                        </button>
                        </Tooltip>
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
              )
            })()}

            {/* Thumbnail picker — gated behind a checkbox so the common case
                (just use the stream item's existing thumbnail) is one click,
                and the full carousel-style picker only appears for users who
                want to upload a different image to YouTube. */}
            {(() => {
              const totalQualifying = ytQualifyingThumbnails.bestFit.length + ytQualifyingThumbnails.rest.length
              const shown = ytShowAllThumbs
                ? [...ytQualifyingThumbnails.bestFit, ...ytQualifyingThumbnails.rest]
                : ytQualifyingThumbnails.bestFit
              const hiddenCount = ytQualifyingThumbnails.rest.length
              const resolvedName = resolvedStreamItemThumb?.split(/[\\/]/).pop() ?? ''
              return (
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-gray-400">Thumbnail to upload</label>
                  {thumbnails.length === 0 ? (
                    <p className="text-xs text-gray-400 italic">No images found in this stream folder.</p>
                  ) : (
                    <>
                      <Checkbox
                        checked={useStreamItemThumb}
                        onChange={setUseStreamItemThumb}
                        size="sm"
                        label={
                          <div>
                            <div className="text-sm font-medium text-gray-200">Use the stream item thumbnail</div>
                            <div className="text-xs text-gray-400 font-mono truncate">{resolvedName || '(none)'}</div>
                          </div>
                        }
                      />
                      {!useStreamItemThumb && (
                        totalQualifying === 0 ? (
                          <p className="text-xs text-gray-400 italic">
                            No images meet YouTube's requirements (JPG/PNG/GIF/WebP, max 2 MB).
                          </p>
                        ) : (
                          <>
                            <div className="flex flex-wrap gap-1.5">
                              {shown.map(p => {
                                const isSelected = p === ytSelectedThumbnail
                                const name = p.split(/[\\/]/).pop() ?? ''
                                return (
                                  <Tooltip key={p} content={name}>
                                    <button
                                      type="button"
                                      onClick={() => setYtSelectedThumbnail(isSelected ? null : p)}
                                      className={`relative w-20 h-14 rounded overflow-hidden border-2 transition-all shrink-0 ${isSelected ? 'border-red-400 ring-1 ring-red-400/50' : 'border-white/10 hover:border-white/30'}`}
                                    >
                                      {/* Display the OS shell thumbnail (a few-KB PNG
                                          Windows already cached) instead of decoding
                                          the full-res source. With 40+ images, source
                                          decode could be hundreds of MB of bitmap data
                                          and stall the renderer; the shell thumb is
                                          ~256×256 and trivially fast. */}
                                      <PickerThumbImage path={p} thumbsKey={thumbsKey} alt={name} />
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
                            {/* Bidirectional toggle — only useful when there's a
                                rest bucket to expand to (or collapse back from).
                                Skips rendering entirely when bestFit covers
                                everything so the link doesn't say "Show all" when
                                nothing more would appear. */}
                            {hiddenCount > 0 && ytQualifyingThumbnails.bestFit.length > 0 && (
                              <button
                                type="button"
                                onClick={() => setYtShowAllThumbs(v => !v)}
                                className="self-start text-[11px] text-gray-400 hover:text-gray-200 underline underline-offset-2 transition-colors"
                              >
                                {ytShowAllThumbs
                                  ? 'Show best fit only'
                                  : `Show all ${totalQualifying} images`}
                              </button>
                            )}
                          </>
                        )
                      )}
                    </>
                  )}
                  <p className="text-[10px] text-gray-400">Recommended: 1280×720 or larger. Uploads alongside the YouTube push from the footer action.</p>
                </div>
              )
            })()}
          </div>
        )}
      </div>
    </Modal>
  )
}

// ─── Preset picker modal ─────────────────────────────────────────────────────

interface PresetPickerProps {
  onPick: (preset: ConversionPreset, setAsDefault: boolean) => void
  onClose: () => void
  isDumpMode: boolean
  /** Pre-select this preset on open. When provided, the modal acts as a
   *  "confirm or override" step rather than a first-time picker, so the
   *  "save as default" checkbox starts unchecked. */
  defaultPresetId?: string
  /** Number of streams about to be archived — for the modal copy. */
  selectionCount: number
}

export function PresetPickerModal({ onPick, onClose, isDumpMode, defaultPresetId, selectionCount }: PresetPickerProps) {
  const [presets, setPresets] = useState<ConversionPreset[]>([])
  const [selected, setSelected] = useState<string>('')
  // When there's an existing default the user is overriding for one run, don't
  // try to overwrite their saved default unless they explicitly opt in.
  const [setAsDefault, setSetAsDefault] = useState(!defaultPresetId)
  const [loading, setLoading] = useState(true)
  const isOverride = !!defaultPresetId

  const [loadError, setLoadError] = useState(false)
  useEffect(() => {
    Promise.all([window.api.getBuiltinPresets(), window.api.getImportedPresets()])
      .then(([builtin, imported]) => {
        const all = [...builtin, ...imported]
        setPresets(all)
        // Prefer the configured default; fall back to the first preset.
        const initial = (defaultPresetId && all.some(p => p.id === defaultPresetId))
          ? defaultPresetId
          : (all[0]?.id ?? '')
        setSelected(initial)
        setLoading(false)
      })
      // Without this, an IPC rejection left the spinner up forever with
      // no way forward but Cancel.
      .catch(() => { setLoading(false); setLoadError(true) })
  }, [defaultPresetId])

  const confirm = () => {
    const preset = presets.find(p => p.id === selected)
    if (preset) onPick(preset, setAsDefault)
  }

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={isOverride ? 'Confirm archive preset' : 'Choose Archive Preset'}
      width="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={confirm} disabled={!selected || loading}>
            Archive {selectionCount} {selectionCount === 1 ? 'stream' : 'streams'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-gray-400">
          {isOverride
            ? 'Confirm the preset to use, or pick a different one for this run.'
            : 'No default archive preset is set. Choose which converter preset to use for compression.'}
        </p>
        {isDumpMode && (
          <p className="text-xs text-gray-400 italic">
            In dump-folder mode, archived files are converted in place — they replace the originals in the same folder.
          </p>
        )}
        {loading ? (
          <div className="flex items-center gap-2 text-gray-400 text-sm"><Loader2 size={14} className="animate-spin" /> Loading presets…</div>
        ) : loadError ? (
          <p className="text-sm text-red-400">Couldn’t load the preset list. Close this dialog and try again.</p>
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
            <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          </div>
        )}
        {selected !== defaultPresetId && (
          <Checkbox checked={setAsDefault} onChange={setSetAsDefault} label="Save as default archive preset" />
        )}
        <p className="text-xs text-gray-400 italic leading-relaxed">
          Test your preset on a few video files in the Converter page first to verify the output quality before archiving in bulk.
        </p>
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
        className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-300 transition-colors focus:outline-none"
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
              className="w-full text-left px-3 py-2 text-xs text-gray-400 hover:bg-white/5 transition-colors border-b border-white/5"
              onClick={() => { onChange(''); close() }}
            >
              — Clear —
            </button>
          )}
          {items.length === 0 && (
            <p className="px-3 py-2 text-xs text-gray-400 italic">No templates</p>
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
export function SaveAsTemplateButton({
  onSave, suggestedName, existingNames,
}: {
  onSave: (name: string) => Promise<void> | void
  suggestedName?: string
  /** Existing template names. When the typed name (case-insensitive)
   *  matches one, the save action switches to an inline overwrite
   *  confirm — first click arms, second confirms. Omit to skip the
   *  duplicate check entirely (e.g. for fields without name collisions). */
  existingNames?: string[]
}) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirmOverwrite, setConfirmOverwrite] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!editing) return
    // Focus + select the suggested text so the first keystroke replaces it.
    // Done in the same effect (rather than at click time) so the value-then-
    // select order is preserved if the suggestion was empty on first render.
    inputRef.current?.focus()
    if (suggestedName) inputRef.current?.select()
  }, [editing, suggestedName])

  // Editing the name unconditionally dismisses an armed overwrite confirm
  // so the user can't end up confirming the wrong name.
  useEffect(() => { setConfirmOverwrite(false) }, [name])

  const trimmed = name.trim()
  const lowerExisting = useMemo(
    () => new Set((existingNames ?? []).map(n => n.toLowerCase())),
    [existingNames]
  )
  const isDuplicate = trimmed.length > 0 && lowerExisting.has(trimmed.toLowerCase())

  const startEditing = () => {
    setName(suggestedName ?? '')
    setEditing(true)
    setConfirmOverwrite(false)
  }
  const cancel = () => { setEditing(false); setName(''); setConfirmOverwrite(false) }
  const save = async () => {
    if (!trimmed || saving) return
    if (isDuplicate && !confirmOverwrite) { setConfirmOverwrite(true); return }
    setSaving(true)
    try { await onSave(trimmed); setEditing(false); setName(''); setConfirmOverwrite(false) }
    finally { setSaving(false) }
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={startEditing}
        className="text-xs text-gray-400 hover:text-gray-200 transition-colors"
      >
        Save as template
      </button>
    )
  }

  return (
    <div className="flex items-center gap-1">
      {isDuplicate && (
        <span className="text-[10px] text-amber-400 mr-1 whitespace-nowrap">
          {confirmOverwrite ? 'Click ✓ again to overwrite' : 'Will overwrite'}
        </span>
      )}
      <input
        ref={inputRef}
        value={name}
        onChange={e => setName(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); save() }
          else if (e.key === 'Escape') { e.preventDefault(); cancel() }
        }}
        placeholder="Template name…"
        // `size` is in avg-char widths — grows with content so long
        // names aren't truncated, with a floor that matches the
        // placeholder width.
        size={Math.max(14, name.length + 1)}
        className={`text-xs bg-navy-900 border ${isDuplicate ? 'border-amber-500/40' : 'border-white/10'} text-gray-200 rounded-lg px-1.5 py-0.5 focus:outline-none focus:ring-1 ${isDuplicate ? 'focus:ring-amber-500/40' : 'focus:ring-purple-500/40'}`}
      />
      <Tooltip content={isDuplicate ? (confirmOverwrite ? 'Click to confirm overwrite' : 'A template with this name exists — click to overwrite') : 'Save'}>
      <button
        type="button"
        onClick={save}
        disabled={!trimmed || saving}
        className={`p-0.5 transition-colors disabled:text-gray-600 disabled:cursor-default ${
          isDuplicate
            ? (confirmOverwrite ? 'text-amber-300 hover:text-amber-200' : 'text-amber-400 hover:text-amber-300')
            : 'text-green-400 hover:text-green-300'
        }`}
      >
        <Check size={12} />
      </button>
      </Tooltip>
      <Tooltip content="Cancel">
      <button
        type="button"
        onClick={cancel}
        className="p-0.5 text-gray-400 hover:text-gray-300 transition-colors"
      >
        <X size={12} />
      </button>
      </Tooltip>
    </div>
  )
}

// ─── Bulk tag modal ───────────────────────────────────────────────────────────

export function BulkTagModal({
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
  onApply: (mode: 'add' | 'remove', streamTypes: string[], games: string[], onProgress: (done: number) => void) => Promise<{ failed: number } | void> | void
  onClose: () => void
}) {
  const [mode, setMode] = useState<'add' | 'remove'>('add')
  const [streamTypes, setStreamTypes] = useState<string[]>([])
  const [games, setGames] = useState<string[]>([])
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [applyError, setApplyError] = useState<string | null>(null)

  const switchMode = (next: 'add' | 'remove') => {
    setMode(next)
    setStreamTypes([])
    setGames([])
  }

  const canApply = (streamTypes.length > 0 || games.length > 0) && !progress
  const isRemoving = mode === 'remove'

  // The parent resolves with a failure count (it keeps going past bad
  // writes). Full success closes the modal from the parent side; any
  // failure lands back here so the modal can say so and stay closable —
  // it used to hang on the progress bar forever with close as a no-op.
  const handleApply = async () => {
    setApplyError(null)
    setProgress({ done: 0, total: count })
    try {
      const res = await onApply(mode, streamTypes, games, (done) => setProgress({ done, total: count }))
      if (res && res.failed > 0) {
        setProgress(null)
        setApplyError(`${res.failed} of ${count} stream${count === 1 ? '' : 's'} couldn’t be updated (the metadata file may be locked). The rest were updated. You can retry or close.`)
      }
    } catch (e: any) {
      setProgress(null)
      setApplyError(`Tag update failed: ${e?.message ?? String(e)}. Some streams may have been updated. You can retry or close.`)
    }
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
            <Button variant="ghost" onClick={onClose}>{applyError ? 'Close' : 'Cancel'}</Button>
            <Button
              variant="primary"
              icon={<Tags size={13} />}
              onClick={handleApply}
              disabled={!canApply}
            >
              {applyError ? 'Retry' : `${isRemoving ? 'Remove from' : 'Add to'} ${count}`}
            </Button>
          </div>
        )
      }
    >
      <div className="flex flex-col gap-5">
        {applyError && (
          <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-md px-3 py-2">{applyError}</p>
        )}
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
          <p className="text-xs text-gray-400 -mt-2">
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

export function CloudDownloadModal({
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
      width="lg"
      footer={
        stage === 'confirm' ? (
          <div className="flex gap-2 justify-end w-full">
            <Button variant="ghost" onClick={onCancel}>Dismiss</Button>
            <Button variant="primary" icon={<CloudDownload size={13} />} onClick={onConfirm}>
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
          <p className="text-xs text-gray-400 font-mono break-all">{filePath}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <Loader2 size={16} className="shrink-0 text-purple-400 animate-spin" />
            <p className="text-sm text-gray-300">
              Downloading <span className="font-medium text-gray-100">{fileName}</span>…
            </p>
          </div>
          <p className="text-xs text-gray-400">
            The file will be sent automatically once the download is complete.
          </p>
          <p className="text-xs text-gray-500">
            SM can't track cloud download progress — check your cloud provider's
            software or the Windows notification for status.
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
        <p className="text-xs text-gray-400 mb-2">
          {isCombine ? 'Multiple video files found — combine all or pick one:' : 'Multiple video files found — choose one:'}
        </p>
        {files.map(f => {
          const name = f.split(/[\\/]/).pop() ?? f
          const isOffline = offlineFiles?.has(f) ?? false
          return isOffline ? (
            <Tooltip key={f} content="Not available locally — sync from cloud first" triggerClassName="block">
            <div
              className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg border border-white/5 opacity-50 cursor-not-allowed"
            >
              <Cloud size={13} className="text-gray-400 shrink-0" />
              <span className="text-sm text-gray-400 font-mono truncate">{name}</span>
              <span className="ml-auto text-[10px] text-gray-400 shrink-0">cloud only</span>
            </div>
            </Tooltip>
          ) : (
            <Tooltip key={f} content={f} maxWidth="max-w-md" triggerClassName="block">
            <button
              onClick={() => { onPick(f); onClose() }}
              className="w-full text-left px-3 py-2.5 rounded-lg text-sm text-gray-200 hover:bg-purple-600/20 hover:text-purple-200 border border-transparent hover:border-purple-600/30 transition-colors font-mono truncate"
            >
              {name}
            </button>
            </Tooltip>
          )
        })}
      </div>
    </Modal>
  )
}

// ─── Main page ───────────────────────────────────────────────────────────────

type ModalState =
  | { mode: 'none' }
  | { mode: 'new'; sourceFolder?: StreamFolder }
  | { mode: 'edit'; folder: StreamFolder }
  | { mode: 'add'; folder: StreamFolder }

/** Build a partial StreamMeta from an existing folder for the "New Episode"
 *  flow. Carries over fields that should be inherited (stream type, games,
 *  SM thumbnail flags so the streams list immediately shows the SM badge for
 *  the new folder once it's created). Date stays empty so the modal's
 *  today() fallback kicks in. YouTube/Twitch fields, comments, and series
 *  metadata (season/episode/total) are intentionally left blank — the
 *  modal's auto-detect logic derives them from `allFolders` based on the
 *  games. */
function buildNewEpisodeMeta(source: StreamFolder): StreamMeta {
  return {
    date: '',
    streamType: source.meta?.streamType ?? [],
    games: source.meta?.games?.length ? source.meta.games : source.detectedGames ?? [],
    comments: '',
    smThumbnail: source.meta?.smThumbnail,
    smThumbnailTemplate: source.meta?.smThumbnailTemplate,
  }
}

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

  // Mirrors the Comments column's `hidden xl:table-cell` rule. Used to
  // size colSpans that cross the comments slot — see ExpandedStreamPanel
  // for context.
  const isXlViewport = useMediaQuery('(min-width: 1280px)')

  const MIN_THUMB_WIDTH = 85
  const MAX_THUMB_WIDTH = 170
  const [thumbWidth, setThumbWidth] = useState(() => config.listThumbWidth ?? MIN_THUMB_WIDTH)
  const dragThumbWidthRef = useRef(thumbWidth)
  // The StoreContext loads config asynchronously, so on first mount the
  // useState initializer above sees the default config (listThumbWidth = 85)
  // before the real persisted value arrives. This effect re-syncs once the
  // store finishes loading. Subsequent updateConfig calls also flow through
  // here but as a no-op since the value matches.
  useEffect(() => {
    if (configLoading) return
    if (typeof config.listThumbWidth !== 'number') return
    if (config.listThumbWidth === thumbWidth) return
    setThumbWidth(config.listThumbWidth)
    dragThumbWidthRef.current = config.listThumbWidth
    // Intentionally not depending on thumbWidth — we only want this to fire
    // when the store's value changes (initial load + cross-tab updates).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configLoading, config.listThumbWidth])
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
      // Browsers fire `click` on the deepest common ancestor of mousedown
      // and mouseup. When the user drags past the column's min/max width
      // and releases outside the handle, that ancestor is the row — so
      // the action panel would toggle even though the handle is tagged
      // `data-no-row-toggle`. Swallow exactly one click in the capture
      // phase to neutralise the post-drag synthesis. A setTimeout fallback
      // detaches the listener even if no click fires (defensive — keeps
      // a future legitimate click from being eaten).
      let removed = false
      const detach = () => {
        if (removed) return
        removed = true
        window.removeEventListener('click', swallowClick, true)
      }
      const swallowClick = (ev: MouseEvent) => {
        ev.stopPropagation()
        detach()
      }
      window.addEventListener('click', swallowClick, true)
      setTimeout(detach, 0)
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
  // In-memory new-stream draft. Cancelling/closing the new-stream modal
  // stashes its current form fields here; reopening the new-stream modal
  // restores them. Survives modal close/reopen during a session (dies on
  // app reload — persisting to disk would be a separate enhancement).
  // Cleared on successful Create, or via the modal's "Start fresh" link.
  const [newStreamDraft, setNewStreamDraft] = useState<Partial<StreamMeta> | null>(null)
  // Bumped to force a remount of the new-stream modal (motion.div key swap)
  // when the user picks "Start fresh", so all internal field useStates
  // re-init from a now-empty draft / source.
  const [newStreamSession, setNewStreamSession] = useState(0)
  const [showManageTags, setShowManageTags] = useState(false)
  const [showTemplatesModal, setShowTemplatesModal] = useState(false)
  const [tagColors, setTagColors] = useState<Record<string, string>>({})
  const [tagTextures, setTagTextures] = useState<Record<string, string>>({})
  const [lightbox, setLightbox] = useState<{ thumbnails: string[]; localFlags?: boolean[]; index: number; folderPath: string; folderDate: string; preferredThumbnail: string | undefined } | null>(null)

  // ── YouTube live detection ─────────────────────────────────────────────────
  const [ytConnectedOuter, setYtConnectedOuter] = useState(false)
  // Twitch connection mirrored at page level so the post-stream auto-update
  // listener can gate on it without opening a modal.
  const [twConnectedOuter, setTwConnectedOuter] = useState(false)
  // Map of broadcastId → currently-live? Built from a batched poll over every
  // upcoming linked broadcast plus push updates from the relay orchestrator.
  // Lets us turn the badge green for whichever upcoming stream the user
  // actually goes live with (not just the soonest one).
  const [ytLiveMap, setYtLiveMap] = useState<Record<string, boolean>>({})
  type YtVideoStatus = { privacyStatus: string; isLivestream: boolean }
  const [ytVideoStatusMap, setYtVideoStatusMap] = useState<Record<string, YtVideoStatus>>({})

  useEffect(() => {
    window.api.youtubeGetStatus().then((s: { connected: boolean }) => setYtConnectedOuter(s.connected)).catch(() => {})
    window.api.twitchGetStatus?.().then((s: { connected: boolean }) => setTwConnectedOuter(s.connected)).catch(() => {})
  }, [])

  // Startup warning: archive preset configured but missing
  const [archivePresetWarning, setArchivePresetWarning] = useState(false)

  // Cloud-sync offload feature: only enabled when streamsDir is inside a CFAPI
  // sync root (Synology Drive Client / OneDrive / etc.). Probed once at mount.
  const [cloudSyncActive, setCloudSyncActive] = useState(false)
  useEffect(() => {
    window.api.cloudSyncIsActive().then(setCloudSyncActive).catch(() => setCloudSyncActive(false))
  }, [])
  const { enqueueOffload, enqueueHydrate } = useCloudOps()
  // Folders with an active archive group in flight. Used to disable any
  // action that would conflict with an archive-in-progress (offload, send
  // to converter, combine, delete, reschedule, re-archive). Keyed by
  // relativePath; we also probe by `date` so jobs persisted before
  // groupCompletionHook.metaKey existed still match.
  const { jobs: conversionJobs } = useConversionJobs()
  const archivingFolderKeys = useMemo(() => {
    const set = new Set<string>()
    for (const j of conversionJobs) {
      const hook = j.groupCompletionHook
      if (hook?.type !== 'archiveMarkAsArchived') continue
      if (j.status === 'done' || j.status === 'error' || j.status === 'cancelled') continue
      set.add(hook.metaKey ?? hook.date)
    }
    return set
  }, [conversionJobs])
  const isFolderArchiving = useCallback((f: StreamFolder) => (
    archivingFolderKeys.has(f.relativePath) || archivingFolderKeys.has(f.date)
  ), [archivingFolderKeys])

  // Orphan (missing folder) handling
  const [orphanConfirmOpen, setOrphanConfirmOpen] = useState(false)
  const [orphanDismissed, setOrphanDismissed] = useState(false)

  // Delete confirmation
  const [rescheduleTarget, setRescheduleTarget] = useState<StreamFolder | null>(null)
  const [rescheduleDate, setRescheduleDate] = useState('')
  const [reschedulePreview, setReschedulePreview] = useState<{
    isDump: boolean
    folderConflict: boolean
    folderRename: { from: string; to: string } | null
    filesToRename: { from: string; to: string; collision: boolean }[]
    hasCollisions: boolean
  } | null>(null)
  const [rescheduleLoading, setRescheduleLoading] = useState(false)
  const [rescheduling, setRescheduling] = useState(false)
  const [rescheduleError, setRescheduleError] = useState<string | null>(null)
  // Optional YT-broadcast-creation flow inside the reschedule modal. Surfaces
  // a checkbox + time + privacy picker only when (a) the new date is in the
  // future, (b) YouTube is connected, and (c) the stream isn't already linked
  // to an existing ytVideoId (we never silently replace a live link). Time
  // defaults to the configured default broadcast time (Settings → fallback
  // 19:00); privacy defaults to private since the user can change it from YT
  // Studio if they want it public.
  const [rescheduleTime, setRescheduleTime] = useState(config.defaultBroadcastTime || '19:00')
  const [rescheduleCreateBroadcast, setRescheduleCreateBroadcast] = useState(false)
  const [rescheduleBroadcastPrivacy, setRescheduleBroadcastPrivacy] = useState<'private' | 'unlisted' | 'public'>('private')

  useEffect(() => {
    setRescheduleError(null)
    if (!rescheduleTarget || !rescheduleDate || rescheduleDate === rescheduleTarget.date) {
      setReschedulePreview(null)
      return
    }
    setRescheduleLoading(true)
    window.api.previewReschedule(rescheduleTarget.folderPath, rescheduleTarget.date, rescheduleDate)
      .then(setReschedulePreview)
      .finally(() => setRescheduleLoading(false))
  }, [rescheduleTarget, rescheduleDate])

  // Reset the YT-broadcast sub-controls whenever the modal is reopened or the
  // target stream changes — sticky state across opens would be surprising
  // (e.g. checkbox stays on after a successful create, then accidentally
  // fires again on the next reschedule of an unrelated stream).
  useEffect(() => {
    setRescheduleCreateBroadcast(false)
    setRescheduleTime(config.defaultBroadcastTime || '19:00')
    setRescheduleBroadcastPrivacy('private')
  }, [rescheduleTarget, config.defaultBroadcastTime])

  const [deleteTarget, setDeleteTarget] = useState<StreamFolder | null>(null)
  const [deleteTree, setDeleteTree] = useState<TreeNode[]>([])
  const [deleteFileList, setDeleteFileList] = useState<string[]>([])
  // Opt-in checkbox for also deleting the linked YouTube VOD/video. Defaults
  // off because YouTube delete is irreversible (no Recycle Bin) — explicit
  // opt-in only. Reset whenever the delete target changes.
  const [alsoDeleteYtVod, setAlsoDeleteYtVod] = useState(false)
  // In-flight + partial-failure state. Set when the YT delete fails after
  // the local delete already succeeded — the modal stays open with the
  // error so the user knows the YT video wasn't removed.
  const [deletingInFlight, setDeletingInFlight] = useState(false)
  const [deleteYtError, setDeleteYtError] = useState<string | null>(null)

  useEffect(() => {
    if (!deleteTarget) { setDeleteTree([]); setDeleteFileList([]); return }
    // Fresh target → reset the opt-in + any prior error
    setAlsoDeleteYtVod(false)
    setDeleteYtError(null)
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

  // Archive — preset picker only; the actual progress UI lives in the converter
  // page now (archive jobs are submitted as a serial job-group). archiveTarget
  // captures the folders the next archive run will operate on — set by either
  // the bulk-action click or the single-item action panel button.
  const [showPresetPicker, setShowPresetPicker] = useState(false)
  const [archiveTarget, setArchiveTarget] = useState<StreamFolder[] | null>(null)
  // Holds the archive context while the "already archived" warning modal is
  // open. Resolved by the user clicking Skip / Continue / Cancel.
  const [pendingArchiveDecision, setPendingArchiveDecision] = useState<{
    preset: ConversionPreset
    selectedFolders: StreamFolder[]
    taggedFiles: string[]
    totalFiles: number
  } | null>(null)

  // Action Panel: which row currently has its expansion panel open. Only one
  // at a time — clicking another row's body closes any other open panel.
  const [expandedFolderKey, setExpandedFolderKey] = useState<string | null>(null)

  // After the open animation completes, scroll the list just enough to bring
  // the panel's bottom into view if it extends past the viewport. No-op when
  // the panel is already fully visible. Only one panel is open at a time, so
  // a generic `[data-panel-key]` selector is sufficient.
  const scrollExpandedPanelIntoView = useCallback(() => {
    const scrollEl = listScrollRef.current
    if (!scrollEl) return
    const panelEl = scrollEl.querySelector('[data-panel-key]') as HTMLElement | null
    if (!panelEl) return
    const panelRect = panelEl.getBoundingClientRect()
    const containerRect = scrollEl.getBoundingClientRect()
    const overflow = panelRect.bottom - containerRect.bottom
    if (overflow > 0) {
      scrollEl.scrollBy({ top: overflow + 8, behavior: 'smooth' })
    }
  }, [])

  // Jump to another folder from inside the expanded panel — used by the
  // Series tooltip when the user clicks another episode. Collapses the
  // current panel, expands the target, and centers it in the scroll
  // container so it's visible regardless of where it is in the list.
  // rAF gives React a tick to commit the expansion state before we read
  // the row's position.
  const handleJumpToFolder = useCallback((target: StreamFolder) => {
    const targetKey = config.streamMode === 'dump-folder' ? target.date : target.folderPath
    setExpandedFolderKey(targetKey)
    requestAnimationFrame(() => {
      const row = document.querySelector(
        `[data-row-key="${CSS.escape(target.folderPath)}"]`
      ) as HTMLElement | null
      row?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
  }, [config.streamMode])

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
    // Prefer a 'full' recording over exported child clips/shorts so sending a stream item
    // lands on the source recording by default; users can pick a clip from the Session
    // Videos panel if they actually want one.
    if (action === 'player') {
      const map = folder.meta?.videoMap
      const firstFull = localVideos.find(v => map?.[videoMapKey(folder.folderPath, v)]?.category === 'full')
      onSendToPlayer(firstFull ?? localVideos[0])
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
    if (!streamsDir) return

    // archiveTarget is set by both the bulk-action toolbar click and the
    // per-row Archive button in the action panel. Falls back to the current
    // selection for safety in case the modal opens via some other path.
    const selectedFolders = archiveTarget
      ?? folders.filter(f => selectedPaths.has(f.folderPath) || selectedPaths.has(f.date))
    setArchiveTarget(null)

    // Collect the candidate files (full recordings only) so we can probe
    // them for the archive-provenance tag before queueing. Tagged files were
    // already encoded by a prior archive run; re-encoding them would lose
    // quality with no benefit.
    const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/$/, '')
    const fullVideos = (f: StreamFolder): string[] => {
      const map = f.meta?.videoMap
      if (!map) return []
      const root = norm(f.folderPath)
      return f.videos.filter(v => {
        const n = norm(v)
        const relKey = n.startsWith(root + '/') ? n.slice(root.length + 1) : n.split('/').pop() ?? n
        return map[relKey]?.category === 'full'
      })
    }
    const allCandidateFiles = selectedFolders.flatMap(f => fullVideos(f))
    if (allCandidateFiles.length === 0) return

    const tagged = await window.api.checkAlreadyArchived(allCandidateFiles)
    if (tagged.length > 0) {
      // Hand off to the warning modal — user picks skip/continue/cancel,
      // and the modal handlers call executeArchive with the appropriate
      // skip set.
      setPendingArchiveDecision({
        preset,
        selectedFolders,
        taggedFiles: tagged,
        totalFiles: allCandidateFiles.length,
      })
      return
    }

    await executeArchive(preset, selectedFolders, new Set())
  }

  /** Build and queue the archive jobs. Called either directly from
   *  startArchive (no tagged files), or from the warning modal handlers
   *  with a skip set populated from the tagged-files list. */
  const executeArchive = async (
    preset: ConversionPreset,
    selectedFolders: StreamFolder[],
    skipFiles: Set<string>,
  ) => {
    if (!streamsDir) return
    const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/$/, '')
    const fullVideos = (f: StreamFolder): string[] => {
      const map = f.meta?.videoMap
      if (!map) return []
      const root = norm(f.folderPath)
      return f.videos.filter(v => {
        const n = norm(v)
        const relKey = n.startsWith(root + '/') ? n.slice(root.length + 1) : n.split('/').pop() ?? n
        return map[relKey]?.category === 'full'
      })
    }

    // Pre-flight: bulk-check every input file across every selected folder for
    // cloud-placeholder status, then reorder so local files queue first within
    // each folder (and folders with any local content queue ahead of all-cloud
    // ones). The cloud-aware wait happens inside the converter pipeline now;
    // this just gives users responsive starts on whatever's already on disk.
    const sessionsRaw = selectedFolders.map(f => ({
      folderPath: f.folderPath,
      date: f.date,
      relativePath: f.relativePath,
      filePaths: fullVideos(f).filter(p => !skipFiles.has(p)),
    })).filter(s => s.filePaths.length > 0)
    const allFiles = sessionsRaw.flatMap(s => s.filePaths)
    if (allFiles.length === 0) return
    const allLocal = await window.api.checkLocalFiles(allFiles)
    let cursor = 0
    const enriched = sessionsRaw.map(s => {
      const flags = allLocal.slice(cursor, cursor + s.filePaths.length)
      cursor += s.filePaths.length
      const pairs = s.filePaths.map((p, i) => ({ p, isLocal: flags[i] }))
      pairs.sort((a, b) => Number(b.isLocal) - Number(a.isLocal))
      return { ...s, filePaths: pairs.map(x => x.p), anyLocal: flags.some(Boolean) }
    })
    enriched.sort((a, b) => Number(b.anyLocal) - Number(a.anyLocal))

    // Build one ConversionJob per file. Each folder becomes a group with
    // serial in-group execution + a main-process completion hook that marks
    // the date as archived once every file in the group succeeds.
    const ext = preset.outputExtension || 'mkv'
    const allJobs: ConversionJob[] = []
    for (const e of enriched) {
      if (e.filePaths.length === 0) continue
      const groupId = uuidv4()
      const groupLabel = `Archive · ${e.date}`
      for (const inputFile of e.filePaths) {
        // Strip any path separators for the temp filename, then rebuild path.
        const sep = inputFile.includes('\\') ? '\\' : '/'
        const dirSepIdx = Math.max(inputFile.lastIndexOf('\\'), inputFile.lastIndexOf('/'))
        const dir = inputFile.slice(0, dirSepIdx)
        const fileName = inputFile.slice(dirSepIdx + 1)
        const baseName = fileName.replace(/\.[^.]+$/, '')
        const tempFile = `${dir}${sep}${baseName}__arc_tmp.${ext}`
        allJobs.push({
          id: uuidv4(),
          inputFile,
          outputFile: tempFile,
          preset,
          status: 'queued',
          progress: 0,
          groupId,
          groupLabel,
          replaceInput: true,
          groupCompletionHook: { type: 'archiveMarkAsArchived', streamsDir, date: e.date, metaKey: e.relativePath },
        })
      }
    }
    if (allJobs.length === 0) return

    // Append to the local jobs state immediately so the converter UI shows the
    // group right away, then fire the IPC. (The main process also broadcasts
    // converter:jobAdded events that the converter page subscribes to, but
    // beating that by a tick keeps the UI snappy.)
    await window.api.addQueuedGroup(allJobs)

    // Drop selection so the user isn't left looking at "still selected" rows
    // after the archive has been queued and the modal has dismissed. Only
    // applies to the bulk path (selection-mode) — single-item archive doesn't
    // touch the selection state.
    if (selectMode) {
      setSelectMode(false)
      setSelectedPaths(new Set())
    }
  }

  const clickArchive = async () => {
    if (selectedPaths.size === 0) return
    const sel = folders.filter(f => selectedPaths.has(f.folderPath) || selectedPaths.has(f.date))
    setArchiveTarget(sel)
    // Always show the picker so the user can override their saved default
    // for this run. The modal pre-selects config.archivePresetId when set,
    // so the common case is just one extra click on Confirm.
    setShowPresetPicker(true)
  }

  const handleArchiveDecision = async (decision: 'skip' | 'continue') => {
    if (!pendingArchiveDecision) return
    const { preset, selectedFolders, taggedFiles } = pendingArchiveDecision
    setPendingArchiveDecision(null)
    const skipFiles = decision === 'skip' ? new Set(taggedFiles) : new Set<string>()
    await executeArchive(preset, selectedFolders, skipFiles)
  }

  const archiveSingle = (folder: StreamFolder) => {
    setArchiveTarget([folder])
    setShowPresetPicker(true)
  }

  // Walk a single stream folder recursively and return all FILES with their
  // sizes (no directories). Covers every asset in the folder — videos,
  // thumbnails, source files, anything the user dropped in. The backend
  // protection filter silently keeps the preferredThumbnail local.
  const collectFolderFiles = async (f: StreamFolder): Promise<{ path: string; size: number }[]> => {
    try {
      const entries = await window.api.listFilesRecursive(f.folderPath, 6)
      return entries.filter(e => !e.isDirectory).map(e => ({ path: e.path, size: e.size }))
    } catch {
      // Folder gone or permission issue — fall back to known videos so the
      // operation still does something rather than silently skipping.
      return f.videos.map(v => ({ path: v, size: 0 }))
    }
  }

  const collectSelectedFolderFiles = async (): Promise<{ path: string; size: number }[]> => {
    const selectedFolders = folders.filter(f => selectedPaths.has(selectionKey(f)))
    const all: { path: string; size: number }[] = []
    for (const f of selectedFolders) all.push(...await collectFolderFiles(f))
    return all
  }

  const clickOffload = async () => {
    if (!cloudSyncActive || selectedPaths.size === 0) return
    const files = await collectSelectedFolderFiles()
    if (files.length === 0) return
    enqueueOffload(files)
    toggleSelectMode()
  }

  const clickPinLocal = async () => {
    if (!cloudSyncActive || selectedPaths.size === 0) return
    const files = await collectSelectedFolderFiles()
    if (files.length === 0) return
    enqueueHydrate(files)
    toggleSelectMode()
  }

  // Per-folder cloud actions for the Action Panel. Mirror the bulk-toolbar
  // versions but operate on a single folder and don't touch selection mode.
  const offloadFolder = async (f: StreamFolder) => {
    if (!cloudSyncActive) return
    const files = await collectFolderFiles(f)
    if (files.length === 0) return
    enqueueOffload(files)
  }

  const pinFolder = async (f: StreamFolder) => {
    if (!cloudSyncActive) return
    const files = await collectFolderFiles(f)
    if (files.length === 0) return
    enqueueHydrate(files)
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
      // Successful Create — the in-progress draft has been committed as a
      // real stream item, so nothing left to preserve.
      setNewStreamDraft(null)
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
  // Live "filter the filter" search for the topics/games dropdown — lets the
  // user narrow a long game list by typing instead of scrolling.
  const [gameFilterSearch, setGameFilterSearch] = useState('')

  const updateGameFilterMaxHeight = useCallback(() => {
    if (gameFilterAnchorRef.current) {
      const rect = gameFilterAnchorRef.current.getBoundingClientRect()
      setGameFilterMaxHeight(window.innerHeight - rect.bottom - 12)
    }
  }, [])

  const openGameFilter = useCallback(() => {
    if (openFilter === 'games') { setOpenFilter(null); return }
    setGameFilterSearch('')
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

  // allGames narrowed by the dropdown's live search box.
  const searchedGameOptions = useMemo(() => {
    const q = gameFilterSearch.trim().toLowerCase()
    if (!q) return allGames
    return allGames.filter(g => g.toLowerCase().includes(q))
  }, [allGames, gameFilterSearch])

  const nextUpcomingFolderPath = useMemo(() => {
    const todayStr = today()
    const upcoming = folders.filter(f => isPendingStream(f, todayStr))
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
    // null = fetch failed — keep the last-known statuses instead of
    // blanking every badge (the modern page adds retries on top; this
    // legacy copy just needs to not destroy state).
    window.api.youtubeGetVideoStatuses(ids).then(m => { if (m) setYtVideoStatusMap(m) }).catch(() => {})
  }, [ytConnectedOuter, linkedYtIdsKey])

  // Collect every upcoming linked broadcast as a stable joined key so the
  // polling effect doesn't tear down on incidental `folders` re-renders.
  // User might decide to stream the 2nd-scheduled session before the 1st, so
  // we can't just watch the soonest one — we watch them all.
  const upcomingLinkedBroadcastKey = useMemo(() => {
    if (!ytConnectedOuter) return ''
    const todayStr = today()
    return folders
      .filter(f => isPendingStream(f, todayStr) && !!f.meta?.ytVideoId)
      .map(f => f.meta!.ytVideoId!)
      .sort()
      .join(',')
  }, [ytConnectedOuter, folders])

  // Batched poll: one liveBroadcasts.list call covers every upcoming linked
  // broadcast (still 1 quota unit). Push updates from the relay orchestrator
  // below cover the SM-orchestrated case faster than the 60s tick.
  useEffect(() => {
    if (!upcomingLinkedBroadcastKey) { setYtLiveMap({}); return }
    const ids = upcomingLinkedBroadcastKey.split(',')
    const check = () => window.api.youtubeCheckBroadcastsAreLive(ids)
      .then(map => {
        const liveById: Record<string, boolean> = {}
        for (const id of ids) liveById[id] = !!map[id]?.isLive
        setYtLiveMap(prev => ({ ...prev, ...liveById }))
        // Hydrate privacy + isLivestream from the same response — these IDs
        // are all liveBroadcasts, so isLivestream is implicitly true.
        setYtVideoStatusMap(prev => {
          const next = { ...prev }
          for (const id of ids) {
            const p = map[id]?.privacyStatus
            if (p) next[id] = { privacyStatus: p, isLivestream: true }
          }
          return next
        })
      })
      .catch(() => {})
    check()
    const interval = setInterval(check, 60_000)
    return () => clearInterval(interval)
  }, [upcomingLinkedBroadcastKey])

  // Push-based override: when the relay orchestrator transitions a broadcast
  // to live, flip the map immediately instead of waiting up to 60s for the
  // next poll. Symmetric clear on completing/completed so a finished broadcast
  // doesn't keep the green badge until the next tick.
  useEffect(() => {
    const off = window.api.onRelayLifecycle(ev => {
      const id = ev?.broadcastId
      if (!id) return
      if (ev.stage === 'live') {
        setYtLiveMap(prev => prev[id] ? prev : { ...prev, [id]: true })
      } else if (ev.stage === 'completing' || ev.stage === 'completed') {
        setYtLiveMap(prev => (id in prev) ? { ...prev, [id]: false } : prev)
      }
    })
    return off
  }, [])

  // ── Post-stream Twitch auto-update ─────────────────────────────────────
  // When a stream completes via the SM relay AND the user has opted in via
  // the Integrations setting, push the next-soonest upcoming stream's Twitch
  // info to the channel. Uses refs so the subscription doesn't churn on
  // every folder change. Twitch isn't pushed for past streams — the
  // next-soonest filter handles that naturally.
  const foldersRef = useRef(folders)
  const twConnectedOuterRef = useRef(twConnectedOuter)
  const autoUpdateTwitchRef = useRef<'always' | 'ask' | 'never'>(config.autoUpdateTwitchAfterStream ?? 'ask')
  useEffect(() => { foldersRef.current = folders }, [folders])
  useEffect(() => { twConnectedOuterRef.current = twConnectedOuter }, [twConnectedOuter])
  useEffect(() => { autoUpdateTwitchRef.current = config.autoUpdateTwitchAfterStream ?? 'ask' }, [config.autoUpdateTwitchAfterStream])
  const { setSuggestion: setPostStreamTwitchSuggestion } = useRelayPrompt()
  useEffect(() => {
    const off = window.api.onRelayLifecycle(async ev => {
      // Clear any stale prompt as soon as the next stream session begins
      // (or errors out) — its target was last session's "next upcoming"
      // and that's no longer meaningful once the relay has moved on.
      if (ev.stage === 'binding' || ev.stage === 'going-live' || ev.stage === 'live' || ev.stage === 'no-broadcast' || ev.stage === 'error') {
        setPostStreamTwitchSuggestion(null)
        return
      }
      if (ev.stage !== 'completed') return
      if (!twConnectedOuterRef.current) return
      const justCompletedId = ev.broadcastId
      const todayStr = today()
      const candidates = foldersRef.current
        .filter(f => f.meta?.ytVideoId !== justCompletedId)
        .filter(f => isPendingStream(f, todayStr))
        .sort((a, b) => a.date.localeCompare(b.date))
      const next = candidates[0]
      if (!next?.meta) return
      const m = next.meta
      const syncTitle = m.syncTitle ?? true
      const syncGame = m.syncGame ?? true
      const title = (syncTitle ? m.ytTitle : m.twitchTitle) ?? m.ytTitle ?? m.twitchTitle ?? ''
      const game = (syncGame ? m.ytGameTitle : m.twitchGameName) ?? m.ytGameTitle ?? m.twitchGameName ?? ''
      // Only push if there's actually a title — Twitch's PATCH /channels
      // rejects an empty title. Skip silently otherwise.
      if (!title.trim()) return
      const { compat: tags } = toTwitchCompatibleTags(m.twitchTags ?? [])
      const payload = { title, game: game || undefined, tags }
      const mode = autoUpdateTwitchRef.current
      if (mode === 'always') {
        // Silent auto-push — user opted into automation in Settings or via
        // the modal's "Always" button.
        try {
          await window.api.twitchUpdateChannel(payload.title, payload.game, payload.tags)
        } catch (e) {
          console.warn('[auto-update Twitch] push failed:', e)
        }
      } else if (mode === 'ask') {
        // Surface the modal so the user can decide per-stream.
        setPostStreamTwitchSuggestion({
          folderPath: next.folderPath,
          displayTitle: title,
          payload,
        })
      }
      // mode === 'never' — skip silently.
    })
    return off
  }, [setPostStreamTwitchSuggestion])

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
          <Radio size={36} className="text-gray-400" />
        </div>
        <div className="text-center">
          <p className="text-gray-300 font-medium">No streams directory set</p>
          <p className="text-sm text-gray-400 mt-1">Choose the folder where your stream session folders live.</p>
        </div>
        <Button variant="primary" icon={<FolderOpen size={14} />} onClick={pickDir}>
          Choose Directory
        </Button>
      </div>
    )
  }

  // True iff any selected folder has an archive in flight. Used to disable
  // bulk Offload / Pin Local / Archive when the selection includes a
  // currently-archiving stream. Computed each render — selection sizes are
  // small enough that a useMemo isn't worth the dependency wrangling.
  const selectionContainsArchiving = selectedPaths.size > 0 && folders.some(
    f => selectedPaths.has(selectionKey(f)) && isFolderArchiving(f)
  )
  // True iff every selected folder is already archived. We only disable the
  // bulk Archive button in this all-archived case; partial selections still
  // proceed so users can archive the non-archived items in a mixed selection.
  const selectionAllArchived = selectedPaths.size > 0 && folders.filter(
    f => selectedPaths.has(selectionKey(f))
  ).every(f => f.meta?.archived)

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
                className="p-1 rounded text-gray-400 hover:text-gray-300 hover:bg-white/5 transition-colors"
              >
                <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
              </button>
            </Tooltip>
          </div>
          <Tooltip content={streamsDir} side="bottom" width="w-72">
            <button
              className="text-xs text-gray-400 font-mono truncate mt-0.5 hover:text-gray-300 transition-colors text-left"
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
            {cloudSyncActive && (
              <>
                <Tooltip content={selectionContainsArchiving ? 'One or more selected streams are being archived' : 'Offload selected streams to cloud (frees local disk; thumbnails stay local)'} side="bottom">
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<Cloud size={14} />}
                    onClick={clickOffload}
                    disabled={selectedPaths.size === 0 || selectionContainsArchiving}
                  >
                    <span className="hidden wide:inline">Offload {selectedPaths.size > 0 ? `(${selectedPaths.size})` : ''}</span>
                  </Button>
                </Tooltip>
                <Tooltip content={selectionContainsArchiving ? 'One or more selected streams are being archived' : 'Pin selected streams local (always keep on disk)'} side="bottom">
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<CloudDownload size={14} />}
                    onClick={clickPinLocal}
                    disabled={selectedPaths.size === 0 || selectionContainsArchiving}
                  >
                    <span className="hidden wide:inline">Pin Local {selectedPaths.size > 0 ? `(${selectedPaths.size})` : ''}</span>
                  </Button>
                </Tooltip>
              </>
            )}
            <Tooltip content={
              selectionContainsArchiving ? 'One or more selected streams are already being archived'
                : selectionAllArchived ? 'All selected streams are already archived'
                : 'Archive selected streams'
            } side="bottom">
              <Button
                variant="primary"
                size="sm"
                icon={<Archive size={14} />}
                onClick={clickArchive}
                disabled={selectedPaths.size === 0 || selectionContainsArchiving || selectionAllArchived}
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
            {/* <Tooltip content="Change streams folder" side="bottom">
              <Button variant="ghost" size="sm" icon={<FolderOpen size={14} />} onClick={pickDir}>
                <span className="hidden wide:inline">Change</span>
              </Button>
            </Tooltip> */}

            {ytConnectedOuter && (
              <Tooltip content="Open YouTube Studio's Go Live page in your browser to start an unscheduled livestream" side="bottom">
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<RadioTower size={14} />}
                  onClick={async () => {
                    try {
                      const channelId = await window.api.youtubeGetChannelId()
                      await window.api.openUrl(`https://studio.youtube.com/channel/${channelId}/livestreaming`)
                    } catch (err) {
                      console.error('[Streams] Initialize Livestream failed:', err)
                    }
                  }}
                >
                  <span className="hidden wide:inline">Initialize Livestream</span>
                </Button>
              </Tooltip>
            )}

            <Tooltip content="Manage title, description, and tag templates" side="bottom">
              <Button
                variant="ghost"
                size="sm"
                icon={<SquareDashedText size={14} />}
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
                  className={`p-1.5 transition-colors ${viewMode === 'list' ? 'bg-white/10 text-gray-200' : 'text-gray-400 hover:text-gray-400 hover:bg-white/5'}`}
                >
                  <LayoutList size={14} />
                </button>
              </Tooltip>
              <Tooltip content="Grid view" side="bottom">
                <button
                  onClick={() => { setViewMode('grid'); localStorage.setItem('streamsViewMode', 'grid') }}
                  className={`p-1.5 transition-colors ${viewMode === 'grid' ? 'bg-white/10 text-gray-200' : 'text-gray-400 hover:text-gray-400 hover:bg-white/5'}`}
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
            <div className="relative">
              <Tooltip content={newStreamDraft ? "Resume your in-progress new stream draft" : "Create a new stream entry"} side="bottom">
                <Button
                  variant="primary"
                  size="sm"
                  icon={<Plus size={14} />}
                  onClick={() => setModal({ mode: 'new' })}
                >
                  <span className="hidden wide:inline">New Stream</span>
                </Button>
              </Tooltip>
              {/* Absolute so the caption doesn't change the toolbar row height
                  when the draft state toggles. Sits just below the button,
                  centered, in a muted purple to match the "new stream"
                  primary action's color family. */}
              {newStreamDraft && (
                <span className="absolute left-0 right-0 top-full mt-0.5 text-[9px] text-purple-300/70 text-center pointer-events-none whitespace-nowrap leading-none">
                  draft in progress
                </span>
              )}
            </div>
          </>
        )}
      </div>

      {/* Summary bar */}
      {folders.length > 0 && (
        <div className="flex items-center gap-4 px-6 py-2 border-b border-white/5 bg-navy-800/50 shrink-0 text-xs text-gray-400">
          <span>
            {filteredFolders.length !== folders.length
              ? <>{filteredFolders.length} <span className="text-gray-400">/ {folders.length}</span> sessions</>
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
                  className={`flex items-center gap-1 px-2 py-1 rounded border transition-colors text-[11px] ${filterTypes.size > 0 ? 'border-purple-600/50 text-purple-400 bg-purple-900/20' : 'border-white/10 text-gray-400 hover:text-gray-300 hover:border-white/20'}`}
                >
                  <ListFilter size={11} />
                  Type{filterTypes.size > 0 && ` (${filterTypes.size})`}
                </button>
                {openFilter === 'type' && (
                  <>
                    <div className="fixed inset-0 z-20" onClick={() => setOpenFilter(null)} />
                    <div className="absolute top-full right-0 mt-1 z-30 bg-navy-700 border border-white/10 rounded-lg shadow-xl overflow-hidden min-w-[160px] overflow-y-auto" style={{ maxHeight: typeFilterMaxHeight }}>
                      {allStreamTypes.length === 0 ? (
                        <p className="px-3 py-2 text-xs text-gray-400">No types tagged yet</p>
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
                  className={`flex items-center gap-1 px-2 py-1 rounded border transition-colors text-[11px] ${filterGames.size > 0 ? 'border-blue-600/50 text-blue-400 bg-blue-900/20' : 'border-white/10 text-gray-400 hover:text-gray-300 hover:border-white/20'}`}
                >
                  <ListFilter size={11} />
                  Topic{filterGames.size > 0 && ` (${filterGames.size})`}
                </button>
                {openFilter === 'games' && (
                  <>
                    <div className="fixed inset-0 z-20" onClick={() => setOpenFilter(null)} />
                    <div className="absolute top-full right-0 mt-1 z-30 bg-navy-700 border border-white/10 rounded-lg shadow-xl overflow-hidden min-w-[160px] overflow-y-auto" style={{ maxHeight: gameFilterMaxHeight }}>
                      {allGames.length === 0 ? (
                        <p className="px-3 py-2 text-xs text-gray-400">No games tagged yet</p>
                      ) : (
                        <>
                          <input
                            autoFocus
                            value={gameFilterSearch}
                            onChange={e => setGameFilterSearch(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Escape') setOpenFilter(null) }}
                            placeholder="Filter topics…"
                            className="w-full bg-navy-900 border-b border-white/10 text-gray-200 text-xs px-3 py-2 focus:outline-none placeholder-gray-500 sticky top-0"
                          />
                          <button onClick={() => { setFilterGames(new Set()); setOpenFilter(null) }} disabled={filterGames.size === 0} className="flex items-center gap-2 w-full px-3 py-1.5 text-left text-xs border-b border-white/5 transition-colors disabled:opacity-30 disabled:cursor-default text-blue-400 hover:text-blue-300 hover:bg-white/5 disabled:hover:bg-transparent disabled:hover:text-blue-400">
                            <X size={11} className="shrink-0" /> Clear filters
                          </button>
                          {searchedGameOptions.length === 0 ? (
                            <p className="px-3 py-2 text-xs text-gray-400 italic">No matches</p>
                          ) : searchedGameOptions.map(g => {
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
          <div className="flex items-center justify-center h-32 text-gray-400 text-sm gap-2">
            <RefreshCw size={14} className="animate-spin" /> Loading…
          </div>
        ) : folders.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 gap-2 text-gray-400">
            <p className="text-sm">No stream folders found in this directory.</p>
            <Button variant="primary" size="sm" icon={<Plus size={12} />} onClick={() => setModal({ mode: 'new' })}>
              Create First Stream
            </Button>
          </div>
        ) : viewMode === 'grid' ? (
          <div className="p-4">
            {filteredFolders.length === 0 ? (
              <p className="text-center py-12 text-gray-400 text-sm">No sessions match the current filters.</p>
            ) : (
              <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
                {filteredFolders.map((folder, i) => {
                  const pending = isPendingStream(folder, today())
                  return (
                    <StreamCard
                      key={isDumpMode ? folder.date : folder.folderPath}
                      folder={folder}
                      zebra={i % 2 === 0}
                      selectMode={selectMode}
                      selected={selectedPaths.has(selectionKey(folder))}
                      isNextUpcoming={folder.folderPath === nextUpcomingFolderPath}
                      isPending={pending}
                      isLive={!!(folder.meta?.ytVideoId && ytLiveMap[folder.meta.ytVideoId])}
                      privacyStatus={folder.meta?.ytVideoId ? ytVideoStatusMap[folder.meta.ytVideoId]?.privacyStatus ?? null : null}
                      isLivestream={folder.meta?.ytVideoId ? ytVideoStatusMap[folder.meta.ytVideoId]?.isLivestream ?? null : null}
                      cloudSyncActive={cloudSyncActive}
                      isArchiving={isFolderArchiving(folder)}
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
                        totalEpisodes: seriesEpisodeCount(folders, folder),
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
              <tr className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
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
                        className={`p-0.5 rounded transition-colors ${filterTypes.size > 0 ? 'text-purple-400' : 'text-gray-400 hover:text-gray-400'}`}
                      >
                        <ListFilter size={12} />
                      </button>
                    </Tooltip>
                    {openFilter === 'type' && (
                      <>
                        <div className="fixed inset-0 z-20" onClick={() => setOpenFilter(null)} />
                        <div className="absolute top-full left-0 mt-1 z-30 bg-navy-700 border border-white/10 rounded-lg shadow-xl overflow-hidden min-w-[160px] overflow-y-auto" style={{ maxHeight: typeFilterMaxHeight }}>
                          {allStreamTypes.length === 0 ? (
                            <p className="px-3 py-2 text-xs text-gray-400">No types tagged yet</p>
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
                        className={`p-0.5 rounded transition-colors ${filterGames.size > 0 ? 'text-blue-400' : 'text-gray-400 hover:text-gray-400'}`}
                      >
                        <ListFilter size={12} />
                      </button>
                    </Tooltip>
                    {openFilter === 'games' && (
                      <>
                        <div className="fixed inset-0 z-20" onClick={() => setOpenFilter(null)} />
                        <div className="absolute top-full left-0 mt-1 z-30 bg-navy-700 border border-white/10 rounded-lg shadow-xl overflow-hidden min-w-[160px] overflow-y-auto" style={{ maxHeight: gameFilterMaxHeight }}>
                          {allGames.length === 0 ? (
                            <p className="px-3 py-2 text-xs text-gray-400">No games tagged yet</p>
                          ) : (
                            <>
                              <input
                                autoFocus
                                value={gameFilterSearch}
                                onChange={e => setGameFilterSearch(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Escape') setOpenFilter(null) }}
                                placeholder="Filter topics…"
                                className="w-full bg-navy-900 border-b border-white/10 text-gray-200 text-xs px-3 py-2 focus:outline-none placeholder-gray-500 sticky top-0 font-normal"
                              />
                              <button
                                onClick={() => { setFilterGames(new Set()); setOpenFilter(null) }}
                                disabled={filterGames.size === 0}
                                className="flex items-center gap-2 w-full px-3 py-1.5 text-left text-xs border-b border-white/5 transition-colors disabled:opacity-30 disabled:cursor-default text-blue-400 hover:text-blue-300 hover:bg-white/5 disabled:hover:bg-transparent disabled:hover:text-blue-400"
                              >
                                <X size={11} className="shrink-0" />
                                Clear filters
                              </button>
                              {searchedGameOptions.length === 0 ? (
                                <p className="px-3 py-2 text-xs text-gray-400 italic font-normal">No matches</p>
                              ) : searchedGameOptions.map(g => {
                                const viable = viableGameOptions.has(g)
                                return (
                                  <button
                                    key={g}
                                    onClick={() => viable && toggleGameFilter(g)}
                                    className={`flex items-center gap-2 w-full px-3 py-1 text-left text-xs transition-colors font-normal ${
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
                <tr><td colSpan={(selectMode ? 8 : 7) - (isXlViewport ? 0 : 1)} className="text-center py-12 text-gray-400 text-sm">No sessions match the current filters.</td></tr>
              ) : filteredFolders.map((folder, i) => {
                const pending = isPendingStream(folder, today())
                const rowKey = isDumpMode ? folder.date : folder.folderPath
                const isExpanded = expandedFolderKey === rowKey
                const hasMeta = folder.hasMeta
                const hasSMThumb = folder.thumbnails.some(t => /[_-]sm-thumbnail\./i.test(t))
                const seriesGame = folder.meta?.games?.[0] ?? folder.detectedGames?.[0]
                const totalEpisodes = seriesGame
                  ? folders.filter(f =>
                      f.meta?.games?.some(g => g.toLowerCase() === seriesGame.toLowerCase()) &&
                      (f.meta?.ytSeason ?? '1') === (folder.meta?.ytSeason ?? '1')
                    ).length
                  : 0
return (
                <React.Fragment key={rowKey}>
                <StreamRow
                  folder={folder}
                  zebra={i % 2 === 0}
                  selectMode={selectMode}
                  selected={selectedPaths.has(selectionKey(folder))}
                  isNextUpcoming={folder.folderPath === nextUpcomingFolderPath}
                  isPending={pending}
                  isLive={!!(folder.meta?.ytVideoId && ytLiveMap[folder.meta.ytVideoId])}
                  privacyStatus={folder.meta?.ytVideoId ? ytVideoStatusMap[folder.meta.ytVideoId]?.privacyStatus ?? null : null}
                  isLivestream={folder.meta?.ytVideoId ? ytVideoStatusMap[folder.meta.ytVideoId]?.isLivestream ?? null : null}
                  cloudSyncActive={cloudSyncActive}
                  isArchiving={isFolderArchiving(folder)}
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
                    totalEpisodes: seriesEpisodeCount(folders, folder),
                  })}
                  onThumbClick={folder.thumbnails.length > 0
                    ? (i) => setLightbox({ thumbnails: folder.thumbnails, localFlags: folder.thumbnailLocalFlags, index: i, folderPath: folder.folderPath, folderDate: folder.date, preferredThumbnail: folder.meta?.preferredThumbnail })
                    : undefined}
                  thumbsKey={thumbsKey}
                  sameDayIndex={sameDayIndexMap.get(folder.folderPath)}
                  thumbWidth={thumbWidth}
                  onThumbResizeStart={startThumbResize}
                  expanded={isExpanded}
                  onToggleExpand={() => setExpandedFolderKey(isExpanded ? null : rowKey)}
                />
                <AnimatePresence initial={false}>
                  {isExpanded && !folder.isMissing && (
                    <ExpandedStreamPanel
                      key={`panel-${rowKey}`}
                      folder={folder}
                      folders={folders}
                      onJumpToFolder={handleJumpToFolder}
                      isPending={pending}
                      hasMeta={hasMeta}
                      hasSMThumbnail={hasSMThumb}
                      videoCount={folder.videoCount}
                      totalEpisodes={totalEpisodes}
                      selectMode={selectMode}
                      cloudSyncActive={cloudSyncActive}
                      isArchiving={isFolderArchiving(folder)}
                      onSendToPlayer={() => sendVideo(folder, 'player')}
                      onSendToConverter={() => sendVideo(folder, 'converter')}
                      onSendToCombine={() => sendToCombine(folder)}
                      onOpenThumbnails={() => openThumbnailEditor({
                        folderPath: folder.folderPath,
                        date: folder.date,
                        title: folder.meta?.ytTitle ?? folder.meta?.games?.join(', '),
                        meta: folder.meta ?? undefined,
                        totalEpisodes: seriesEpisodeCount(folders, folder),
                      })}
                      onEdit={() => setModal({ mode: 'edit', folder })}
                      onAdd={() => setModal({ mode: 'add', folder })}
                      onOpen={() => isDumpMode && folder.videos.length > 0
                        ? window.api.openInExplorer(folder.videos[0])
                        : window.api.openInExplorer(folder.folderPath)}
                      onReschedule={() => { setRescheduleTarget(folder); setRescheduleDate(folder.date) }}
                      onArchive={() => archiveSingle(folder)}
                      onDelete={() => setDeleteTarget(folder)}
                      onNewEpisode={() => setModal({ mode: 'new', sourceFolder: folder })}
                      onOffload={() => offloadFolder(folder)}
                      onPinLocal={() => pinFolder(folder)}
                      onOpenAnimationComplete={scrollExpandedPanelIntoView}
                    />
                  )}
                </AnimatePresence>
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
          onDeleteImage={async (filePath) => {
            // Update the lightbox state FIRST so the carousel navigates to the
            // next image immediately, rather than waiting for the trash IPC to
            // return. Closes the lightbox entirely if this was the last image.
            setLightbox(prev => {
              if (!prev) return null
              const remaining = prev.thumbnails.filter(p => p !== filePath)
              if (remaining.length === 0) return null
              const remainingFlags = prev.localFlags?.filter((_, i) => prev.thumbnails[i] !== filePath)
              const nextIndex = Math.min(prev.index, remaining.length - 1)
              return { ...prev, thumbnails: remaining, localFlags: remainingFlags, index: nextIndex }
            })
            try {
              await window.api.trashFile(filePath)
            } catch (err) {
              console.error('Failed to trash image', err)
              return
            }
            await loadFolders(streamsDir)
          }}
          onEditThumbnail={() => {
            const folder = folders.find(f => f.folderPath === lightbox.folderPath && f.date === lightbox.folderDate)
            if (!folder) return
            // Close the lightbox first so the thumbnail editor takes focus.
            setLightbox(null)
            openThumbnailEditor({
              folderPath: folder.folderPath,
              date: folder.date,
              title: folder.meta?.ytTitle ?? folder.meta?.games?.join(', '),
              meta: folder.meta ?? undefined,
              totalEpisodes: seriesEpisodeCount(folders, folder),
            })
          }}
          onClose={() => setLightbox(null)}
          onNavigate={(i) => setLightbox(prev => prev ? { ...prev, index: i } : null)}
        />
      )}

      {/* Delete confirmation modal */}
      {rescheduleTarget && (() => {
        // Derived booleans for the optional YT-broadcast-creation flow. The
        // checkbox only surfaces when the new date is in the future, YT is
        // connected, and the stream isn't already linked to a broadcast
        // (replacing an existing link silently would be surprising).
        const newDateIsFuture = !!rescheduleDate && rescheduleDate > today()
        const hasExistingYtLink = !!rescheduleTarget.meta?.ytVideoId
        const canOfferCreateBroadcast = newDateIsFuture && ytConnectedOuter && !hasExistingYtLink
        return (
        <Modal
          isOpen
          onClose={() => { setRescheduleTarget(null); setReschedulePreview(null); setRescheduleError(null) }}
          title="Reschedule stream"
          width="sm"
          footer={
            <>
              <Button variant="ghost" size="sm" onClick={() => { setRescheduleTarget(null); setReschedulePreview(null); setRescheduleError(null) }}>Cancel</Button>
              <Button
                variant="primary"
                size="sm"
                loading={rescheduling}
                disabled={!reschedulePreview || reschedulePreview.folderConflict || reschedulePreview.hasCollisions || rescheduleDate === rescheduleTarget.date || rescheduling}
                onClick={async () => {
                  if (!rescheduleTarget || !rescheduleDate) return
                  setRescheduling(true)
                  setRescheduleError(null)
                  try {
                    const result = await window.api.rescheduleStream(rescheduleTarget.folderPath, rescheduleTarget.date, rescheduleDate)
                    // Optional follow-up: create a YT broadcast for the new
                    // date and link its ID into the stream's meta. Non-fatal
                    // — the rename has already committed by this point, so a
                    // YT failure leaves the modal open with a friendly
                    // message instead of rolling anything back.
                    if (rescheduleCreateBroadcast && canOfferCreateBroadcast) {
                      try {
                        const meta = rescheduleTarget.meta
                        const title = meta?.ytTitle?.trim()
                          || meta?.twitchTitle?.trim()
                          || (meta?.games?.length ? meta.games.join(' · ') : '')
                          || rescheduleTarget.folderName
                          || 'Stream'
                        const description = meta?.ytDescription ?? ''
                        // Construct the start time in the user's local TZ,
                        // then serialize as ISO UTC for the YouTube API.
                        const [hh, mm] = rescheduleTime.split(':').map(n => parseInt(n, 10))
                        const [y, m, d] = rescheduleDate.split('-').map(n => parseInt(n, 10))
                        const scheduledStartTime = new Date(y, m - 1, d, hh, mm, 0, 0).toISOString()
                        const broadcast = await window.api.youtubeCreateBroadcast({
                          title, description, scheduledStartTime,
                          privacyStatus: rescheduleBroadcastPrivacy,
                        })
                        await window.api.updateStreamMeta(
                          result.newFolderPath,
                          { ytVideoId: broadcast.id },
                          result.newMetaKey,
                        )
                      } catch (e: any) {
                        setRescheduleError(`Stream rescheduled, but couldn't create the YouTube livestream: ${e?.message ?? String(e)}. You can link a broadcast manually from the stream's metadata.`)
                        loadFolders(streamsDir)
                        return
                      }
                    }
                    setRescheduleTarget(null)
                    setReschedulePreview(null)
                    loadFolders(streamsDir)
                  } catch (err: any) {
                    const msg: string = err?.message ?? String(err)
                    // EPERM/EBUSY on Windows almost always means a cloud-sync client
                    // (Synology Drive, OneDrive, Dropbox) is holding the folder open
                    // for an in-flight upload. Friendlier prompt than the raw error.
                    if (/EPERM|EBUSY/.test(msg) && /rename/.test(msg)) {
                      setRescheduleError(
                        "Couldn't rename the stream folder — your cloud sync client (Synology Drive, OneDrive, Dropbox, etc.) is probably holding it open while uploading the renamed files. Wait for the sync to finish, or pause it briefly, then try again. Your files have been rolled back to their original names."
                      )
                    } else {
                      setRescheduleError(msg)
                    }
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
              <p className="text-xs text-gray-400 italic">Choose a different date to reschedule.</p>
            )}

            {/* Future-date notice — shown whenever the new date is after
                today, regardless of YT connection. Tells the user the row's
                "upcoming" state will return after rescheduling. */}
            {newDateIsFuture && rescheduleDate !== rescheduleTarget.date && (
              <div className="flex items-start gap-2 text-xs text-blue-300 bg-blue-500/10 border border-blue-500/30 rounded-lg px-3 py-2 leading-relaxed">
                <CalendarClock size={12} className="shrink-0 mt-0.5" />
                <span>This stream will be marked as upcoming after rescheduling.</span>
              </div>
            )}

            {/* Optional YT broadcast creation. Gated by canOfferCreateBroadcast
                so we never silently replace an existing ytVideoId or offer
                this when YT isn't connected. Time + privacy controls are
                indented under the checkbox so the relationship is clear. */}
            {canOfferCreateBroadcast && rescheduleDate !== rescheduleTarget.date && (
              <div className="flex flex-col gap-2 border border-white/5 rounded-lg px-3 py-2.5 bg-white/[0.02]">
                <Checkbox
                  size="sm"
                  checked={rescheduleCreateBroadcast}
                  onChange={setRescheduleCreateBroadcast}
                  label="Also create a scheduled YouTube livestream for this date"
                />
                {rescheduleCreateBroadcast && (
                  <div className="flex flex-col gap-2 pl-6">
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-gray-400 w-16 shrink-0">Time</label>
                      <input
                        type="time"
                        value={rescheduleTime}
                        onChange={e => setRescheduleTime(e.target.value)}
                        className="bg-navy-900 border border-white/10 text-gray-200 text-xs rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-purple-500/40 [color-scheme:dark]"
                      />
                      <span className="text-[10px] text-gray-400">your local time</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-400 w-16 shrink-0">Privacy</span>
                      <div className="flex gap-3">
                        {(['private', 'unlisted', 'public'] as const).map(p => (
                          <label key={p} className="flex items-center gap-1.5 cursor-pointer">
                            <input
                              type="radio"
                              name="rescheduleBroadcastPrivacy"
                              checked={rescheduleBroadcastPrivacy === p}
                              onChange={() => setRescheduleBroadcastPrivacy(p)}
                              className="cursor-pointer accent-purple-500"
                            />
                            <span className="text-xs text-gray-300 capitalize">{p}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {rescheduleDate !== rescheduleTarget.date && rescheduleLoading && (
              <p className="text-xs text-gray-400 flex items-center gap-1.5">
                <Loader2 size={11} className="animate-spin shrink-0" />
                Checking…
              </p>
            )}

            {reschedulePreview && rescheduleDate !== rescheduleTarget.date && !rescheduleLoading && (
              <>
                {reschedulePreview.folderConflict ? (
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
                      {reschedulePreview.folderRename && (
                        <li className="text-xs font-mono text-gray-400 bg-navy-900 rounded px-2 py-1">
                          📁 {reschedulePreview.folderRename.from}/ → {reschedulePreview.folderRename.to}/
                        </li>
                      )}
                      {reschedulePreview.filesToRename.map(f => (
                        <li
                          key={f.from}
                          className={`text-xs font-mono px-2 py-0.5 ${f.collision ? 'text-red-400' : 'text-gray-400'}`}
                        >
                          {f.collision ? (
                            <Tooltip content="Skipped: a file with that name already exists." triggerClassName="block">
                              <span className="block">
                                <AlertTriangle size={10} className="inline mr-1 mb-0.5" />
                                {f.from} → {f.to}
                              </span>
                            </Tooltip>
                          ) : (
                            <>{f.from} → {f.to}</>
                          )}
                        </li>
                      ))}
                      {reschedulePreview.filesToRename.length === 0 && (
                        <li className="text-xs text-gray-400 italic px-2 py-0.5">No files to rename inside folder.</li>
                      )}
                    </ul>
                    {reschedulePreview.hasCollisions && (
                      <p className="text-xs text-red-400 flex items-start gap-1.5">
                        <AlertTriangle size={11} className="shrink-0 mt-0.5" />
                        Some target filenames already exist. Resolve those conflicts before rescheduling.
                      </p>
                    )}
                  </div>
                )}
              </>
            )}

            {rescheduleError && (
              <div className="flex items-start gap-2 text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 leading-relaxed">
                <AlertTriangle size={12} className="shrink-0 mt-0.5" />
                <span>{rescheduleError}</span>
              </div>
            )}
          </div>
        </Modal>
        )
      })()}

      {deleteTarget && (() => {
        const linkedVideoId = deleteTarget.meta?.ytVideoId
        return (
        <Modal
          isOpen
          onClose={() => { if (!deletingInFlight) setDeleteTarget(null) }}
          title={isDumpMode ? 'Move files to Recycle Bin?' : 'Move folder to Recycle Bin?'}
          width="sm"
          footer={
            <>
              <Button variant="ghost" size="sm" disabled={deletingInFlight} onClick={() => setDeleteTarget(null)}>
                {deleteYtError ? 'Close' : 'Cancel'}
              </Button>
              {!deleteYtError && (
                <Button
                  variant="primary"
                  size="sm"
                  loading={deletingInFlight}
                  onClick={async () => {
                    const target = deleteTarget
                    const wantYtDelete = alsoDeleteYtVod && !!linkedVideoId
                    setDeletingInFlight(true)
                    setDeleteYtError(null)
                    // Local delete first (recoverable from Recycle Bin) so a
                    // YT-delete failure later still leaves the user's files
                    // safe. Doing YT first risks losing the VOD if local
                    // delete then errors.
                    try {
                      if (isDumpMode) {
                        await window.api.deleteStreamFiles(target.folderPath, target.date)
                      } else {
                        await window.api.deleteStreamFolder(target.folderPath)
                      }
                    } catch (err: any) {
                      setDeletingInFlight(false)
                      setDeleteYtError(`Local delete failed: ${err?.message ?? String(err)}`)
                      return
                    }
                    if (wantYtDelete && linkedVideoId) {
                      try {
                        await window.api.youtubeDeleteVideo(linkedVideoId)
                      } catch (err: any) {
                        // Local already gone — surface the YT error inside the
                        // modal so the user knows to clean up on YT Studio.
                        setDeletingInFlight(false)
                        setDeleteYtError(`Files moved to Recycle Bin, but deleting the YouTube video failed: ${err?.message ?? String(err)}`)
                        await loadFolders(streamsDir)
                        return
                      }
                    }
                    setDeletingInFlight(false)
                    setDeleteTarget(null)
                    await loadFolders(streamsDir)
                  }}
                >
                  {alsoDeleteYtVod && linkedVideoId
                    ? 'Move to Recycle Bin & Delete from YouTube'
                    : 'Move to Recycle Bin'}
                </Button>
              )}
            </>
          }
        >
          <p className="text-sm text-gray-300 mb-3">
            The following will be moved to the Recycle Bin:
          </p>
          <div className="bg-white/5 rounded-lg px-3 py-2.5 mb-3 font-mono text-sm text-gray-200 max-h-64 overflow-y-auto">
            {isDumpMode ? (
              deleteFileList.length === 0
                ? <span className="text-gray-400 italic text-xs">No files found for this date.</span>
                : deleteFileList.map(f => (
                    <div key={f} className="flex items-center gap-1.5 text-gray-400 py-px">
                      <span className="shrink-0 text-gray-400">·</span>
                      <span className="truncate">{f.split(/[\\/]/).pop()}</span>
                    </div>
                  ))
            ) : (
              <TreeView nodes={deleteTree} depth={0} rootName={deleteTarget.folderName} />
            )}
          </div>
          <p className="text-xs text-gray-400 mb-3">This action can be undone from the Recycle Bin.</p>

          {/* Linked-YT delete opt-in — only when there's actually a video to
              delete on YouTube. Defaults off; checking it adds the YT delete
              to the same action. Warning surfaces when checked to make the
              irreversibility explicit. */}
          {linkedVideoId && (
            <div className="border-t border-white/10 pt-3 flex flex-col gap-2">
              <Checkbox
                checked={alsoDeleteYtVod}
                onChange={setAlsoDeleteYtVod}
                disabled={deletingInFlight}
                size="sm"
                label={
                  <div>
                    <div className="text-sm font-medium text-gray-200">Also delete the linked YouTube video</div>
                    <div className="text-xs text-gray-400 font-mono break-all">{linkedVideoId}</div>
                  </div>
                }
              />
              {alsoDeleteYtVod && (
                <div className="flex items-start gap-1.5 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-300 leading-relaxed">
                  <AlertTriangle size={12} className="shrink-0 mt-0.5" />
                  <span>
                    YouTube does not have a Recycle Bin — deleting the video here
                    is <strong>permanent</strong> and cannot be undone, even from YouTube
                    Studio.
                  </span>
                </div>
              )}
            </div>
          )}

          {deleteYtError && (
            <div className="mt-3 flex items-start gap-1.5 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-300 leading-relaxed">
              <AlertTriangle size={12} className="shrink-0 mt-0.5" />
              <span>{deleteYtError}</span>
            </div>
          )}
        </Modal>
        )
      })()}

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
        <p className="text-xs text-gray-400">
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
                  <button onClick={() => navigateModal(prevSeriesFolder!, 'up')} disabled={!prevSeriesFolder} className="p-2 rounded-full bg-navy-700/60 border border-white/10 text-gray-400 hover:text-gray-300 hover:bg-navy-600/80 transition-colors shadow-md disabled:opacity-30 disabled:cursor-default disabled:hover:bg-navy-700/60 disabled:hover:text-gray-500"><ChevronsDown size={16} /></button>
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
                  <button onClick={() => navigateModal(nextSeriesFolder!, 'down')} disabled={!nextSeriesFolder} className="p-2 rounded-full bg-navy-700/60 border border-white/10 text-gray-400 hover:text-gray-300 hover:bg-navy-600/80 transition-colors shadow-md disabled:opacity-30 disabled:cursor-default disabled:hover:bg-navy-700/60 disabled:hover:text-gray-500"><ChevronsUp size={16} /></button>
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
            key={(modal.mode === 'edit' || modal.mode === 'add')
              ? modal.folder.folderPath
              // Include session counter for new mode so "Start fresh" can
              // force a full remount (resetting all internal field useStates
              // back to whatever the new initialMeta says — usually empty).
              : `new-${newStreamSession}`}
            className="fixed inset-x-0 bottom-0 top-10 z-50 flex items-center justify-center p-4"
            initial={noAnimation ? false : { opacity: 0, y: slideDirection === 'up' ? 60 : slideDirection === 'down' ? -60 : 0 }}
            animate={noAnimation ? {} : panelAnimate}
            exit={noAnimation ? {} : { opacity: 0, y: slideDirection === 'up' ? -60 : slideDirection === 'down' ? 60 : 0, transition: { duration: 0.18 * animMult, ease: 'easeIn' as const } }}
          >
            <MetaModal
              mode={modal.mode}
              initialMeta={
                modal.mode === 'edit' || modal.mode === 'add'
                  ? modal.folder.meta
                  : modal.mode === 'new'
                    // Draft wins over source-folder defaults — the user
                    // started editing those defaults, the draft holds their
                    // changes. If no draft, derive from sourceFolder (e.g.
                    // "+ New Episode") or null for a totally blank new stream.
                    ? (newStreamDraft as StreamMeta | null)
                      ?? (modal.sourceFolder ? buildNewEpisodeMeta(modal.sourceFolder) : null)
                    : null
              }
              newDraftPresent={modal.mode === 'new' && !!newStreamDraft}
              onDraftCapture={modal.mode === 'new'
                ? (meta) => setNewStreamDraft(meta)
                : undefined}
              onDraftClear={modal.mode === 'new'
                ? () => { setNewStreamDraft(null); setNewStreamSession(s => s + 1) }
                : undefined}
              folderDate={(modal.mode === 'edit' || modal.mode === 'add') ? modal.folder.date : undefined}
              sourceFolder={modal.mode === 'new' ? modal.sourceFolder : undefined}
              detectedGames={
                modal.mode === 'edit' || modal.mode === 'add'
                  ? modal.folder.detectedGames
                  : modal.mode === 'new' && modal.sourceFolder
                    ? modal.sourceFolder.detectedGames
                    : []
              }
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
              onDeleteImage={(modal.mode === 'edit' || modal.mode === 'add') ? async (filePath) => {
                try {
                  await window.api.trashFile(filePath)
                } catch (err) {
                  console.error('Failed to trash image', err)
                  return
                }
                // Optimistic snapshot update — the MetaModal renders from
                // modal.folder (a stable snapshot from when it opened), so a
                // bare loadFolders won't refresh its carousel thumbnails.
                setModal(prev => {
                  if (prev.mode !== 'edit' && prev.mode !== 'add') return prev
                  const oldThumbs = prev.folder.thumbnails
                  const idx = oldThumbs.indexOf(filePath)
                  if (idx === -1) return prev
                  const thumbnails = oldThumbs.filter((_, i) => i !== idx)
                  const thumbnailLocalFlags = prev.folder.thumbnailLocalFlags?.filter((_, i) => i !== idx)
                  return { ...prev, folder: { ...prev.folder, thumbnails, thumbnailLocalFlags } }
                })
                await loadFolders(streamsDir)
              } : undefined}
              onEditThumbnail={(modal.mode === 'edit' || modal.mode === 'add') ? () => {
                if (modal.mode !== 'edit' && modal.mode !== 'add') return
                const folder = modal.folder
                // Close the metamodal first so the thumbnail page takes focus.
                setModal({ mode: 'none' })
                setSlideDirection(null)
                openThumbnailEditor({
                  folderPath: folder.folderPath,
                  date: folder.date,
                  title: folder.meta?.ytTitle ?? folder.meta?.games?.join(', '),
                  meta: folder.meta ?? undefined,
                  totalEpisodes: seriesEpisodeCount(folders, folder),
                })
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
              defaultBroadcastTime={config.defaultBroadcastTime || '19:00'}
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

      {/* Preset picker — archive jobs are submitted to the converter queue
          on confirm, so there's no longer a separate progress modal here. */}
      {showPresetPicker && (
        <PresetPickerModal
          onPick={(preset, setAsDefault) => startArchive(preset, setAsDefault)}
          onClose={() => { setShowPresetPicker(false); setArchiveTarget(null) }}
          isDumpMode={isDumpMode}
          defaultPresetId={config.archivePresetId}
          selectionCount={archiveTarget?.length ?? selectedPaths.size}
        />
      )}

      {/* Already-archived pre-flight warning. Reads the file-level
          `encoded_by` tag (written during prior archives) so the user can't
          accidentally re-archive an already-encoded file. */}
      {pendingArchiveDecision && (
        <Modal
          isOpen
          onClose={() => setPendingArchiveDecision(null)}
          title="Some files have already been archived"
          width="lg"
          footer={
            <>
              <Button variant="ghost" onClick={() => setPendingArchiveDecision(null)}>Cancel</Button>
              <Button variant="ghost" onClick={() => handleArchiveDecision('continue')}>Archive everything anyway</Button>
              <Button variant="primary" onClick={() => handleArchiveDecision('skip')}>Skip already-archived</Button>
            </>
          }
        >
          <div className="space-y-3">
            <p className="text-sm text-gray-300">
              <span className="text-yellow-300 font-medium">{pendingArchiveDecision.taggedFiles.length}</span>
              {' '}of <span className="text-gray-200">{pendingArchiveDecision.totalFiles}</span> selected file
              {pendingArchiveDecision.totalFiles === 1 ? '' : 's'} ha
              {pendingArchiveDecision.taggedFiles.length === 1 ? 's' : 've'}
              {' '}an "Archived Stream" tag in their container metadata, meaning they were encoded by a previous archive run. Re-encoding will lose quality without benefit.
            </p>
            <div className="border border-white/10 rounded-lg overflow-hidden bg-navy-900/40">
              <div className="px-3 py-2 border-b border-white/10 text-[10px] uppercase tracking-wide text-gray-400">
                Already archived
              </div>
              <div className="max-h-[40vh] overflow-y-auto divide-y divide-white/5">
                {pendingArchiveDecision.taggedFiles.map(p => {
                  const name = p.split(/[\\/]/).pop() ?? p
                  return (
                    <Tooltip key={p} content={p} maxWidth="max-w-md" triggerClassName="block min-w-0">
                      <div className="px-3 py-1.5 text-xs text-gray-400 truncate">{name}</div>
                    </Tooltip>
                  )
                })}
              </div>
            </div>
          </div>
        </Modal>
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
          // Global rename of a stream type. Rewrites every folder whose
          // streamType array contains the old name, then re-keys the
          // color + texture maps so the chip styling moves with the
          // renamed tag. Mirrors the delete/combine bulk-write pattern.
          onRenameTag={(oldName, newName) => {
            const affected = folders.filter(f =>
              normalizeStreamTypes(f.meta?.streamType).includes(oldName)
            )
            Promise.all(
              affected.map(f =>
                window.api.writeStreamMeta(f.folderPath, {
                  ...f.meta!,
                  streamType: normalizeStreamTypes(f.meta?.streamType)
                    .map(t => t === oldName ? newName : t),
                }, f.relativePath)
              )
            ).then(() => {
              if (oldName in tagColors) {
                const updatedColors = { ...tagColors, [newName]: tagColors[oldName] }
                delete updatedColors[oldName]
                saveTagColors(updatedColors)
              }
              if (oldName in tagTextures) {
                const updatedTextures = { ...tagTextures, [newName]: tagTextures[oldName] }
                delete updatedTextures[oldName]
                saveTagTextures(updatedTextures)
              }
              loadFolders(streamsDir)
            })
          }}
          // Global rename of a topic/game tag. Touches games[] plus the
          // YouTube + Twitch sync fields and the twitchLastPushed
          // snapshot so a stream that's been pushed doesn't trip the
          // snapshot's staleness guard after the rename.
          onRenameGame={(oldName, newName) => {
            const affected = folders.filter(f => {
              const m = f.meta
              if (!m) return false
              return (m.games ?? []).includes(oldName)
                || m.ytGameTitle === oldName
                || m.twitchGameName === oldName
                || m.twitchLastPushedGame === oldName
                || m.primaryGame === oldName
            })
            Promise.all(
              affected.map(f => {
                const m = f.meta
                if (!m) return Promise.resolve()
                const next: StreamMeta = { ...m }
                if (m.games?.includes(oldName)) {
                  next.games = m.games.map(g => g === oldName ? newName : g)
                }
                if (m.ytGameTitle === oldName) next.ytGameTitle = newName
                if (m.twitchGameName === oldName) next.twitchGameName = newName
                if (m.twitchLastPushedGame === oldName) next.twitchLastPushedGame = newName
                if (m.primaryGame === oldName) next.primaryGame = newName
                return window.api.writeStreamMeta(f.folderPath, next, f.relativePath)
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
          <FolderOpen size={12} className="shrink-0 text-gray-400" />
          <span>{rootName}/</span>
        </div>
      )}
      {nodes.length === 0 && depth === 0 && (
        <div style={{ paddingLeft: 20 }} className="text-gray-400 italic text-xs">Empty folder</div>
      )}
      {nodes.map(node => (
        <div key={node.name} style={{ paddingLeft: rootName !== undefined || depth > 0 ? 20 : 0 }}>
          {node.isDirectory ? (
            <TreeView nodes={node.children ?? []} depth={depth + 1} rootName={node.name} />
          ) : (
            <div className="flex items-center gap-1.5 text-gray-400 py-px">
              <span className="shrink-0 text-gray-400">·</span>
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

export function ClampedComment({ text, maxLines = 3 }: { text: string; maxLines?: number }) {
  const spanRef = useRef<HTMLSpanElement>(null)
  const [clamped, setClamped] = useState(false)

  useEffect(() => {
    const el = spanRef.current
    if (el) setClamped(el.scrollHeight > el.clientHeight)
  }, [text, maxLines])

  // Inline -webkit-line-clamp lets each instance use a different clamp value
  // (the Tailwind line-clamp-N classes can't be parameterised). The element
  // still needs `display: -webkit-box` and the orient property for the clamp
  // to take effect.
  const span = (
    <span
      ref={spanRef}
      className="text-[10px] leading-tight text-gray-400 whitespace-pre-wrap overflow-hidden"
      style={{
        display: '-webkit-box',
        WebkitLineClamp: maxLines,
        WebkitBoxOrient: 'vertical',
      }}
    >
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

/**
 * DisplayTagChip — single non-editable tag chip with truncation-aware
 * Tooltip. Measures scrollWidth > clientWidth on the chip element after
 * layout and on resize; only wraps in a Tooltip when the chip is actually
 * clipped. Callers pass the chip's full className (including `truncate
 * max-w-full` so the chip stays a single line and clips with ellipsis).
 * For "detected from filename" games, pass `detectedTooltip` — the tip
 * always shows the detection note, and appends the full tag text when
 * the chip is truncated.
 */
export function DisplayTagChip({
  text, className, style, detectedTooltip, onClick, actionTooltip,
}: {
  text: string
  className: string
  style?: React.CSSProperties
  detectedTooltip?: string
  /** When set, the chip becomes interactive (cursor + hover) and calls this
   *  on click. Used by the streams list's tag-based multi-select. The handler
   *  is responsible for stopping propagation if the chip sits inside another
   *  click target. */
  onClick?: (e: React.MouseEvent) => void
  /** Hint shown in the chip's tooltip while it's interactive (e.g. how
   *  click / ctrl-click behave). Always rendered when present. */
  actionTooltip?: string
}) {
  const [truncated, setTruncated] = useState(false)
  // The chip element changes identity when `truncated` toggles
  // (React unmounts the bare span and remounts a new one inside the
  // Tooltip wrapper, or vice versa). useRef + useLayoutEffect with
  // [text] deps wouldn't catch that — the effect doesn't re-run, so
  // the observer would stay bound to the detached previous element.
  // A callback ref re-fires on every element attach/detach, so the
  // observer always tracks whatever span is currently in the DOM.
  const obsCleanupRef = useRef<(() => void) | null>(null)
  const setRef = useCallback((el: HTMLSpanElement | null) => {
    obsCleanupRef.current?.()
    obsCleanupRef.current = null
    if (!el) return
    const check = () => setTruncated(el.scrollWidth > el.clientWidth)
    check()
    // Defer ResizeObserver-driven re-checks to the next frame to
    // avoid the "ResizeObserver loop completed with undelivered
    // notifications" warning.
    let raf = 0
    const obs = new ResizeObserver(() => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(check)
    })
    obs.observe(el)
    obsCleanupRef.current = () => {
      cancelAnimationFrame(raf)
      obs.disconnect()
    }
  }, [])
  // Final cleanup on component unmount
  useEffect(() => () => { obsCleanupRef.current?.() }, [])

  const chip = (
    <span
      ref={setRef}
      className={`${className}${onClick ? ' cursor-pointer hover:brightness-125' : ''}`}
      style={style}
      onClick={onClick ? (e) => { e.stopPropagation(); onClick(e) } : undefined}
    >{text}</span>
  )

  // Tooltip's default trigger wrapper is `inline-flex` which shrinks to
  // fit the chip's content. The chip's `max-w-full` then resolves to
  // the wrapper's width (= chip natural), so no clamp happens and the
  // truncation reading oscillates each render.
  //
  // Fix: make the wrapper an inline-block (regular flow box, not a flex
  // container itself) with `max-w-full` + `min-w-0`. As a flex item in
  // the original flex-wrap parent, the wrapper's `min-width: auto`
  // would otherwise resolve to its content's min-content (= chip
  // natural width with `white-space: nowrap`), defeating the `max-w-full`
  // cap. `min-w-0` overrides that so the cascade actually reaches the
  // chip and truncation stays stable.
  const triggerCls = 'inline-block max-w-full min-w-0'

  // Action hint (interactive chips) takes priority and always shows; it
  // appends the full tag when the chip is also clipped. Detected-from-filename
  // note is next, then a plain truncation tooltip.
  const tip = actionTooltip
    ? (truncated ? `${actionTooltip} · ${text}` : actionTooltip)
    : detectedTooltip
      ? (truncated ? `${detectedTooltip} · ${text}` : detectedTooltip)
      : truncated ? text : null
  return tip != null
    ? <Tooltip content={tip} side="top" triggerClassName={triggerCls}>{chip}</Tooltip>
    : chip
}

// ─── Stream card (grid view) ─────────────────────────────────────────────────

function StreamCard({ folder, selectMode, selected, isNextUpcoming, isPending, isLive, privacyStatus, isLivestream, cloudSyncActive, isArchiving, tagColors, tagTextures, onToggleSelect, onEdit, onAdd, onOpen, onReschedule, onDelete, onSendToPlayer, onSendToConverter, onSendToCombine, onOpenThumbnails, onThumbClick, thumbsKey, sameDayIndex }: StreamRowProps) {
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
          <p className="text-[10px] text-red-300 mt-0.5">Folder not found on disk</p>
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
            <ImageOff size={18} className="text-gray-400" />
            <span className="text-[9px] text-gray-400">no thumbnail</span>
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
                        <span className="inline-flex items-center p-1 rounded bg-green-900/30 text-green-400 border border-green-400/40">
                        <Archive size={11} />
                        </span>
                    </Tooltip>
                )}
                {isPending && (
                  meta?.ytVideoId ? (
                    <Tooltip content={isLive ? 'Live now' : (privacyLabel ? `Open in YouTube Studio · ${privacyLabel}` : 'Open in YouTube Studio')}>
                      <button
                        onClick={e => { e.stopPropagation(); window.api.openUrl(`https://studio.youtube.com/video/${meta.ytVideoId}/livestreaming`) }}
                        className={`inline-flex items-center gap-0.5 p-1 rounded border transition-colors shrink-0 ${
                          isLive
                            ? 'bg-green-900/30 text-green-400 border-green-400/40 hover:bg-green-900/50 hover:text-green-300'
                            : 'bg-teal-900/30 text-teal-400 border-teal-400/40 hover:bg-teal-900/50 hover:text-teal-300'
                        }`}
                      >
                        <Radio size={11} />
                        {PrivacyIcon && <PrivacyIcon size={11} />}
                      </button>
                    </Tooltip>
                  ) : (
                    <Tooltip content={isNextUpcoming ? "Upcoming — stream hasn't happened yet" : 'Scheduled upcoming stream'}>
                      <span className="inline-flex items-center p-1 rounded bg-teal-900/30 text-teal-400 border border-teal-400/40 shrink-0">
                        <Radio size={11} />
                      </span>
                    </Tooltip>
                  )
                )}
                {/* YT link for past streams. Icon distinguishes livestream
                    VODs (Radio) from regular video uploads (Clapperboard);
                    falls back to Clapperboard while the bulk fetch is in
                    flight (isLivestream === null). */}
                {!isPending && meta?.ytVideoId && (() => {
                  const KindIcon = isLivestream ? Radio : Clapperboard
                  const kindLabel = isLivestream ? 'Livestream' : 'Video'
                  const tooltipText = privacyLabel ? `${kindLabel} · ${privacyLabel}` : kindLabel
                  return (
                    <Tooltip content={tooltipText}>
                      <button
                        onClick={e => { e.stopPropagation(); window.api.openUrl(`https://studio.youtube.com/video/${meta.ytVideoId}`) }}
                        className="inline-flex items-center gap-0.5 p-1 rounded bg-red-900/30 text-red-400 border border-red-400/40 hover:bg-red-900/50 transition-colors shrink-0"
                      >
                        <KindIcon size={11} />
                        {PrivacyIcon && <PrivacyIcon size={11} />}
                      </button>
                    </Tooltip>
                  )
                })()}
                {/* "Not linked" indicator — surfaces alongside the scheduled
                    badge for pending streams, and in the YT slot for past
                    streams. Non-interactive; tooltip explains the state. */}
                {!meta?.ytVideoId && (
                  <Tooltip content={isPending ? 'Not linked to a YouTube broadcast' : 'Not linked to a YouTube video'}>
                    <span className="inline-flex items-center p-1 rounded bg-gray-700/30 text-gray-400 border border-gray-400/30 shrink-0">
                      <Unlink2 size={11} />
                    </span>
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
                <DisplayTagChip
                  key={t}
                  text={t}
                  className={`inline-block text-xs leading-tight px-2 py-0.5 rounded-full border truncate max-w-full ${color.chip}`}
                  style={getTagTextureStyle(tagTextures[t])}
                />
              )
            })}
          </div>
        )}

        {/* Games */}
        {displayGames.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {displayGames.map(g =>
              meta?.games?.includes(g) ? (
                <DisplayTagChip
                  key={g}
                  text={g}
                  className="inline-block text-[10px] leading-tight px-1.5 py-0.5 rounded-full bg-purple-900/20 text-purple-300 border border-purple-300/30 truncate max-w-full"
                />
              ) : (
                <DisplayTagChip
                  key={g}
                  text={g}
                  className="inline-block text-[10px] leading-tight px-1.5 py-0.5 rounded-full bg-white/5 text-gray-400 border border-gray-500/30 italic truncate max-w-full"
                  detectedTooltip="Detected from filename"
                />
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
          <VideoCountTooltip videos={videos} videoMap={meta?.videoMap ?? undefined} folderPath={folder.folderPath} cloudSyncActive={cloudSyncActive}>
            {(() => {
              const vm = meta?.videoMap
              const fullCount = vm ? Object.values(vm).filter(e => e.category === 'full').length : videoCount
              const shortClipCount = vm ? Object.values(vm).filter(e => e.category === 'short' || e.category === 'clip').length : 0
              return (
                <div className="flex items-center gap-2 cursor-default">
                  <div className={`flex items-center gap-1 text-xs font-mono ${fullCount > 0 ? 'text-gray-400' : 'text-gray-400'}`}>
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
              <button onClick={e => { e.stopPropagation(); onSendToPlayer() }} className="p-1 rounded text-gray-400 hover:text-gray-300 hover:bg-white/5 transition-colors">
                <Film size={12} />
              </button>
            </Tooltip>
          )}
          {videoCount > 0 && (
            <Tooltip content={isArchiving ? 'Already in the converter — archive in progress' : 'Send to Converter'}>
              <button onClick={e => { e.stopPropagation(); onSendToConverter() }} disabled={isArchiving} className="p-1 rounded text-gray-400 hover:text-gray-300 hover:bg-white/5 transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-gray-600">
                <Zap size={12} />
              </button>
            </Tooltip>
          )}
          {videoCount > 1 && (
            <Tooltip content={isArchiving ? 'Combine disabled — archive in progress' : 'Combine videos'}>
              <button onClick={e => { e.stopPropagation(); onSendToCombine() }} disabled={isArchiving} className="p-1 rounded text-gray-400 hover:text-gray-300 hover:bg-white/5 transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-gray-600">
                <Combine size={12} />
              </button>
            </Tooltip>
          )}
          <Tooltip content={hasSMThumbnail ? 'Edit thumbnail' : 'Create thumbnail'}>
            <button onClick={e => { e.stopPropagation(); onOpenThumbnails() }} className="p-1 rounded text-gray-400 hover:text-gray-300 hover:bg-white/5 transition-colors">
              <ImageIcon size={12} />
            </button>
          </Tooltip>
          <Tooltip content={hasMeta ? 'Edit metadata' : 'Add metadata'}>
            <button onClick={e => { e.stopPropagation(); hasMeta ? onEdit() : onAdd() }} className="p-1 rounded text-gray-400 hover:text-gray-300 hover:bg-white/5 transition-colors">
              <PencilLine size={12} />
            </button>
          </Tooltip>
          <Tooltip content="Open folder">
            <button onClick={e => { e.stopPropagation(); onOpen() }} className="p-1 rounded text-gray-400 hover:text-gray-300 hover:bg-white/5 transition-colors">
              <FolderOpen size={12} />
            </button>
          </Tooltip>
          {isPending && (
            <Tooltip content={isArchiving ? 'Reschedule disabled — archive in progress' : 'Reschedule'}>
              <button onClick={e => { e.stopPropagation(); onReschedule() }} disabled={isArchiving} className="p-1 rounded text-gray-400 hover:text-gray-300 hover:bg-white/5 transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-gray-600">
                <CalendarClock size={12} />
              </button>
            </Tooltip>
          )}
          <Tooltip content={isArchiving ? 'Delete disabled — archive in progress' : 'Delete'}>
            <button onClick={e => { e.stopPropagation(); onDelete() }} disabled={isArchiving} className="p-1 rounded text-gray-400 hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-gray-700">
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
  /** True iff the linked YouTube video is (or was) a livestream — drives
   *  the past-stream badge icon (Radio for livestream VOD, Clapperboard for
   *  regular upload). null while the bulk fetch hasn't returned yet. */
  isLivestream?: boolean | null
  /** True when streamsDir is inside a cloud sync root. Threaded through to
   *  the VideoCountTooltip so the per-file cloud column only renders icons
   *  when cloud sync is actually in play. */
  cloudSyncActive: boolean
  /** True while at least one archive job for this folder is still in flight.
   *  Disables actions that would conflict with the archive: re-archive,
   *  send-to-converter (files are already in the queue), combine, delete,
   *  reschedule, offload, pin local. Player / thumbnail / metadata stay
   *  enabled. */
  isArchiving: boolean
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
  /** Action panel is open for this row. Suppresses hover-revealed action
   *  buttons in the column (they'd duplicate the panel buttons). Optional —
   *  StreamCard (cards view) doesn't use the panel pattern yet. */
  expanded?: boolean
  /** Click on the row body (excluding interactive descendants) toggles the
   *  action panel. Selection mode short-circuits this. */
  onToggleExpand?: () => void
}

function StreamRow({ folder, zebra, selectMode, selected, isNextUpcoming, isPending, isLive, privacyStatus, isLivestream, cloudSyncActive, isArchiving, tagColors, tagTextures, onToggleSelect, onDragStart, onDragEnter, onEdit, onAdd, onOpen, onReschedule, onDelete, onSendToPlayer, onSendToConverter, onSendToCombine, onOpenThumbnails, onThumbClick, thumbsKey, sameDayIndex, thumbWidth = 85, onThumbResizeStart, expanded, onToggleExpand }: StreamRowProps) {
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
            <span className="text-[11px] px-1.5 py-0.5 rounded-full border border-red-300/40 bg-red-500/10 text-red-300">Folder not found on disk</span>
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

  // Click anywhere on the row body to toggle the action panel — but NOT when
  // the click originated inside an interactive descendant (existing tag
  // chips, action buttons, the thumbnail expand overlay, etc.). Selection
  // mode short-circuits panel toggling entirely.
  const handleRowClick = (e: React.MouseEvent<HTMLTableRowElement>) => {
    if (selectMode) { onToggleSelect(e.shiftKey); return }
    if (!onToggleExpand) return
    const target = e.target as HTMLElement
    if (target.closest('button, a, input, textarea, select, [role="button"], [data-no-row-toggle]')) return
    onToggleExpand()
  }

  return (
    <tr
      data-row-key={folder.folderPath}
      className={`border-b group transition-colors ${
        isPending
          ? `border-teal-900/30 hover:bg-teal-900/30 ${zebra ? 'bg-teal-900/20' : 'bg-teal-900/15'}`
          : `border-white/5 hover:bg-white/[0.03] ${zebra ? 'bg-white/[0.02]' : ''}`
      } ${selected ? 'bg-purple-900/10' : ''} ${expanded ? '!border-b-0' : ''}`}
      onClick={handleRowClick}
      onMouseDown={selectMode ? (e) => { e.preventDefault(); onDragStart() } : undefined}
      onMouseEnter={selectMode ? onDragEnter : undefined}
      style={{ cursor: 'pointer', userSelect: selectMode ? 'none' : undefined }}
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
          onClick={e => { e.stopPropagation(); onThumbClick?.(0) }}
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
              <ImageOff size={14} className="text-gray-400" />
              <span className="text-[9px] text-gray-400 leading-none">none</span>
            </div>
          )}
        </div>
        {/* Resize handle. The `data-no-row-toggle` marker keeps the
            synthetic `click` event that fires when mouseup lands back
            on the handle (i.e. a short drag) from bubbling up to
            handleRowClick and toggling the action panel. */}
        <div
          className="group/resize absolute top-0 right-0 w-2 h-full cursor-ew-resize z-10"
          data-no-row-toggle
          onMouseDown={onThumbResizeStart}
        >
          <div className="absolute top-0 right-0 w-px h-full bg-purple-500 opacity-0 group-hover/resize:opacity-100 transition-opacity" />
        </div>
      </td>

      {/* Video count */}
      <td className="px-2 py-2 align-middle w-[44px]">
        <VideoCountTooltip videos={videos} videoMap={meta?.videoMap ?? undefined} folderPath={folder.folderPath} cloudSyncActive={cloudSyncActive}>
          {(() => {
            const vm = meta?.videoMap
            const fullCount = vm ? Object.values(vm).filter(e => e.category === 'full').length : videoCount
            const shortClipCount = vm ? Object.values(vm).filter(e => e.category === 'short' || e.category === 'clip').length : 0
            return (
              <div className="flex flex-col items-center gap-0.5 cursor-default">
                <div className={`flex items-center gap-1 text-xs font-mono ${fullCount > 0 ? 'text-gray-400' : 'text-gray-400'}`}>
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
                  <span className="inline-flex items-center p-0.5 rounded bg-green-900/30 text-green-400 border border-green-400/40 shrink-0">
                    <Archive size={12} />
                  </span>
                </Tooltip>
              )}
              {isPending && (
                meta?.ytVideoId ? (() => {
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
                            ? 'bg-green-900/30 text-green-400 border-green-400/40 hover:bg-green-900/50 hover:text-green-300'
                            : 'bg-teal-900/30 text-teal-400 border-teal-400/40 hover:bg-teal-900/50 hover:text-teal-300'
                        }`}
                      >
                        <Radio size={12} />
                        {PrivacyIcon && <PrivacyIcon size={12} />}
                      </button>
                    </Tooltip>
                  )
                })() : (
                  <Tooltip content={isNextUpcoming ? 'Upcoming — stream hasn\'t happened yet' : 'Scheduled upcoming stream'}>
                    <span className="inline-flex items-center p-0.5 rounded bg-teal-900/30 text-teal-400 border border-teal-400/40 shrink-0">
                      <Radio size={12} />
                    </span>
                  </Tooltip>
                )
              )}
            {!isPending && meta?.ytVideoId && (() => {
                const privacyLabel = privacyStatus === 'public' ? 'Public' : privacyStatus === 'unlisted' ? 'Unlisted' : privacyStatus === 'private' ? 'Private' : null
                const PrivacyIcon = privacyStatus === 'unlisted' ? EyeOff : privacyStatus === 'private' ? Lock : privacyStatus === 'public' ? Globe : null
                const KindIcon = isLivestream ? Radio : Clapperboard
                const kindLabel = isLivestream ? 'Livestream' : 'Video'
                const tooltipText = privacyLabel ? `Edit on YouTube · ${kindLabel} · ${privacyLabel}` : `Edit on YouTube · ${kindLabel}`
                return (
                <Tooltip content={tooltipText}>
                    <button
                    onClick={e => { e.stopPropagation(); window.api.openUrl(`https://studio.youtube.com/video/${meta.ytVideoId}`) }}
                    className="inline-flex items-center gap-0.5 p-0.5 rounded bg-red-900/30 text-red-400 border border-red-400/40 hover:bg-red-900/50 hover:text-red-300 transition-colors shrink-0"
                    >
                    <KindIcon size={12} />
                    {PrivacyIcon && <PrivacyIcon size={12} />}
                    </button>
                </Tooltip>
                )
            })()}
            {!meta?.ytVideoId && (
              <Tooltip content={isPending ? 'Not linked to a YouTube broadcast' : 'Not linked to a YouTube video'}>
                <span className="inline-flex items-center p-0.5 rounded bg-gray-700/30 text-gray-400 border border-gray-400/30 shrink-0">
                  <Unlink2 size={12} />
                </span>
              </Tooltip>
            )}
          </div>
        </div>
        {(meta?.ytTitle || meta?.twitchTitle) && (() => {
          // Wrap to as many lines as fit in the thumbnail's height. text-[10px]
          // with leading-normal (1.5) is ~15px per line; row's vertical real
          // estate is roughly the thumb height (thumbWidth * 9/16). Account
          // for the date row above (~20px).
          const titleLines = Math.max(1, Math.floor(((thumbWidth * 9 / 16) - 20) / 15))
          return (
            <Tooltip content={meta.ytTitle || meta.twitchTitle} side="bottom" triggerClassName="block">
              <div
                className="text-[10px] leading-normal text-gray-400 max-w-[204px] overflow-hidden"
                style={{
                  display: '-webkit-box',
                  WebkitLineClamp: titleLines,
                  WebkitBoxOrient: 'vertical',
                }}
              >
                {meta.ytTitle || meta.twitchTitle}
              </div>
            </Tooltip>
          )
        })()}
      </td>

      {/* Type */}
      <td className="px-2 py-2 align-middle">
        {meta ? (
          <div className="flex flex-wrap gap-1">
            {normalizeStreamTypes(meta.streamType).map(t => {
              const color = getTagColor(tagColors[t])
              return (
                <DisplayTagChip
                  key={t}
                  text={t}
                  className={`inline-block text-xs leading-tight px-2 py-0.5 rounded-full border truncate max-w-full ${color.chip}`}
                  style={getTagTextureStyle(tagTextures[t])}
                />
              )
            })}
          </div>
        ) : (
          <span className="text-xs text-gray-400">—</span>
        )}
      </td>

      {/* Games */}
      <td className="px-2 py-2 align-middle max-w-[240px]">
        {displayGames.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {displayGames.map(g =>
              meta?.games?.includes(g) ? (
                <DisplayTagChip
                  key={g}
                  text={g}
                  className="inline-block text-[10px] leading-tight px-1.5 py-0.5 rounded-full bg-purple-900/20 text-purple-300 border border-purple-300/30 truncate max-w-full"
                />
              ) : (
                <DisplayTagChip
                  key={g}
                  text={g}
                  className="inline-block text-[10px] leading-tight px-1.5 py-0.5 rounded-full bg-white/5 text-gray-400 border border-gray-500/30 italic truncate max-w-full"
                  detectedTooltip="Detected from filename"
                />
              )
            )}
          </div>
        ) : (
          <span className="text-xs text-gray-400">—</span>
        )}
      </td>

      {/* Comments — clamp scales with thumbnail height (mirrors the title
          column). text-[10px] + leading-tight is ~12.5px per line. */}
      <td className="px-2 py-2 align-middle hidden xl:table-cell">
        {meta?.comments ? (
          <ClampedComment
            text={meta.comments}
            maxLines={Math.max(2, Math.floor((thumbWidth * 9 / 16) / 12.5))}
          />
        ) : (
          <span className="text-xs text-gray-400">—</span>
        )}
      </td>

      {/* Actions — trimmed to high-frequency buttons. Combine, Open, Delete,
          New Episode, and Archive(single) live in the action panel revealed
          on row click. When that panel is open, suppress the hover-reveal so
          the column buttons don't duplicate the panel's right side. */}
      <td className="px-2 py-2 align-middle">
        <div className={`flex items-center justify-end transition-opacity ${expanded ? 'opacity-0 pointer-events-none' : 'opacity-0 group-hover:opacity-100'}`}>
          {!hasMeta && (
            <span className="flex items-center gap-1 text-xs text-yellow-600 mr-1 shrink-0">
              <AlertTriangle size={11} />
              No meta
            </span>
          )}
          {videoCount > 0 && <Tooltip content="Send to Player"><Button variant="ghost" size="icon-sm" icon={<Film size={12} />} onClick={onSendToPlayer} /></Tooltip>}
          {videoCount > 0 && (
            <Tooltip content={isArchiving ? 'Already in the converter — archive in progress' : 'Send to Converter'}>
              <Button variant="ghost" size="icon-sm" icon={<Zap size={12} />} onClick={onSendToConverter} disabled={isArchiving} />
            </Tooltip>
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
          {isPending && (
            <Tooltip content={isArchiving ? 'Reschedule disabled — archive in progress' : 'Reschedule'}>
              <Button variant="ghost" size="icon-sm" icon={<CalendarClock size={12} />} onClick={onReschedule} disabled={isArchiving} />
            </Tooltip>
          )}
        </div>
      </td>
    </tr>
  )
}

// Shared style for the panel's bordered/colored hover buttons (Archive, Delete,
// New Episode). Non-hovered state matches Button ghost (text-gray-400). Hover
// tint differs per action so the user can tell them apart at a glance.
const PANEL_ACTION_BUTTON_BASE = 'p-2 rounded-lg text-gray-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-gray-400'
const PANEL_ACTION_BUTTON_GREEN = `${PANEL_ACTION_BUTTON_BASE} hover:text-green-400 hover:bg-green-500/10`
const PANEL_ACTION_BUTTON_BLUE = `${PANEL_ACTION_BUTTON_BASE} hover:text-blue-400 hover:bg-blue-500/10`
const PANEL_ACTION_BUTTON_RED = `${PANEL_ACTION_BUTTON_BASE} hover:text-red-400 hover:bg-red-500/10`
const PANEL_ACTION_BUTTON_YELLOW = `${PANEL_ACTION_BUTTON_BASE} hover:text-yellow-400 hover:bg-yellow-500/10`
const PANEL_ACTION_BUTTON_CYAN = `${PANEL_ACTION_BUTTON_BASE} hover:text-cyan-400 hover:bg-cyan-500/10`
const PANEL_ACTION_BUTTON_PINK = `${PANEL_ACTION_BUTTON_BASE} hover:text-pink-400 hover:bg-pink-500/10`

interface ExpandedPanelProps {
  folder: StreamFolder
  /** All folders in scope — used by the Series tooltip to list every episode
   *  in the same series+season. Computed inside the panel (not the parent
   *  loop) so the filter only runs when a panel is actually open. */
  folders: StreamFolder[]
  /** Collapse the current panel, expand the target folder's row, and scroll
   *  it into view. Wired up by the parent. */
  onJumpToFolder: (target: StreamFolder) => void
  isPending: boolean
  hasMeta: boolean
  hasSMThumbnail: boolean
  videoCount: number
  totalEpisodes: number
  selectMode: boolean
  /** When true, shows the per-folder Offload + Pin Local buttons. False
   *  when streamsDir is not inside a CFAPI sync root. */
  cloudSyncActive: boolean
  /** True while this folder has an archive in flight — see StreamRowProps
   *  for the full list of buttons this gates. */
  isArchiving: boolean
  /** Fired after the open animation completes — used by the parent to
   *  scroll the panel into view when it expands near the bottom of the
   *  list. Not fired on close. */
  onOpenAnimationComplete?: () => void
  onSendToPlayer: () => void
  onSendToConverter: () => void
  onSendToCombine: () => void
  onOpenThumbnails: () => void
  onEdit: () => void
  onAdd: () => void
  onOpen: () => void
  onReschedule: () => void
  onArchive: () => void
  onDelete: () => void
  onNewEpisode: () => void
  onOffload: () => void
  onPinLocal: () => void
}

/**
 * Action panel revealed underneath a stream row when the user clicks its
 * body. Hosts the full action button set (mirrored + extended from the
 * action column) on the right and supplementary metadata on the left.
 *
 * Buttons that don't apply to the row (Send-to-Combine without 2+ videos,
 * Reschedule on past streams) are omitted rather than disabled — the panel
 * is meant to be tight, not exhaustive.
 */
function ExpandedStreamPanel({
  folder, folders, onJumpToFolder, isPending, hasMeta, hasSMThumbnail, videoCount, totalEpisodes, selectMode, cloudSyncActive, isArchiving,
  onOpenAnimationComplete,
  onSendToPlayer, onSendToConverter, onSendToCombine, onOpenThumbnails,
  onEdit, onAdd, onOpen, onReschedule, onArchive, onDelete, onNewEpisode,
  onOffload, onPinLocal,
}: ExpandedPanelProps) {
  const meta = folder.meta
  // The Comments column is hidden below Tailwind's xl breakpoint (1280px).
  // table-fixed still reserves width for its hidden <th>, so a static
  // colSpan that crosses the comments slot ends up wider than the visible
  // row. Shrink the colSpan by one when comments are hidden.
  const isXl = useMediaQuery('(min-width: 1280px)')
  const visibleColCount = (selectMode ? 8 : 7) - (isXl ? 0 : 1)
  const series = meta?.ytSeason || meta?.ytEpisode
    ? `S${meta?.ytSeason || '1'} · E${meta?.ytEpisode || '?'}${totalEpisodes > 0 ? ` of ${totalEpisodes}` : ''}`
    : null
  // Episodes in the same series+season, sorted reverse-chronological (newest
  // first) to match every other episode-listing in the app. Same matching
  // rules as the MetaModal's previous/next-in-series — case-insensitive game
  // match against either meta.games or detectedGames, plus same season ('1'
  // default).
  const seriesFolders = useMemo(() => {
    const primaryGame = folder.meta?.games?.[0] ?? folder.detectedGames?.[0]
    if (!primaryGame) return []
    const season = folder.meta?.ytSeason ?? '1'
    const lowerGame = primaryGame.toLowerCase()
    return folders
      .filter(f =>
        !f.isMissing &&
        ((f.meta?.games?.some(g => g.toLowerCase() === lowerGame)) ||
         (f.detectedGames?.some(g => g.toLowerCase() === lowerGame))) &&
        (f.meta?.ytSeason ?? '1') === season
      )
      .sort((a, b) => b.date.localeCompare(a.date))
  }, [folders, folder])
  const showTwitchTitle = meta?.twitchTitle && !meta?.syncTitle && meta.twitchTitle !== meta.ytTitle
  const showTwitchGame = meta?.twitchGameName && meta.twitchGameName !== meta.ytGameTitle

  return (
    <motion.tr
      key={`panel-${folder.folderPath}`}
      data-panel-key={folder.folderPath}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
    >
      <td colSpan={visibleColCount} className="p-0 border-b border-white/5 bg-white/[0.015]">
        <motion.div
          initial={{ height: 0 }}
          animate={{ height: 'auto' }}
          exit={{ height: 0 }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
          style={{ overflow: 'hidden' }}
          onAnimationComplete={def => {
            // Only fire on enter — `def` is the latest animation target, so
            // 'auto' = open, 0 = close. We skip close so the panel doesn't
            // re-scroll the list as it collapses.
            if (typeof def === 'object' && (def as { height?: unknown }).height === 'auto') {
              onOpenAnimationComplete?.()
            }
          }}
        >
          <div className="flex items-center justify-between gap-6 px-3 py-3">
            {/* Left: supplementary metadata. Hidden fields (no value) are
                skipped entirely so the panel stays compact for sparse rows. */}
            <div className="flex flex-col gap-1.5 text-xs min-w-0 flex-1">
              {series && (
                <div className="flex items-baseline gap-2">
                  <span className="text-[10px] uppercase tracking-wide text-gray-400 shrink-0 w-24">Series</span>
                  <SeriesEpisodesTooltip
                    episodes={seriesFolders}
                    currentFolderPath={folder.folderPath}
                    onJump={onJumpToFolder}
                  >
                    <span className="text-gray-200 tabular-nums cursor-default inline-flex items-baseline gap-1.5">
                      {series}
                      {seriesFolders.length > 1 && <List size={13} className="text-gray-400 self-center relative bottom-[1px]" />}
                    </span>
                  </SeriesEpisodesTooltip>
                </div>
              )}
              {meta?.ytTitle && (
                <div className="flex items-baseline gap-2">
                  <span className="text-[10px] uppercase tracking-wide text-gray-400 shrink-0 w-24">YouTube title</span>
                  <span className="text-gray-200">{meta.ytTitle}</span>
                </div>
              )}
              {meta?.ytGameTitle && (
                <div className="flex items-baseline gap-2">
                  <span className="text-[10px] uppercase tracking-wide text-gray-400 shrink-0 w-24">YouTube game</span>
                  <span className="text-gray-300">{meta.ytGameTitle}</span>
                </div>
              )}
              {meta?.ytDescription && (() => {
                // Show only the first line in the panel, content-width so the
                // tooltip anchors over the actual text rather than empty
                // trailing space. Append an explicit '…' when there's more
                // content beyond the first line; long single lines get the
                // ellipsis automatically via `truncate` at max-w-md.
                const desc = meta.ytDescription
                const firstLine = desc.split('\n')[0]
                const hasMore = desc.length > firstLine.length
                return (
                  <div className="flex items-baseline gap-2">
                    <span className="text-[10px] uppercase tracking-wide text-gray-400 shrink-0 w-24">Description</span>
                    <Tooltip
                      content={<span className="whitespace-pre-wrap text-gray-300">{desc}</span>}
                      maxWidth="max-w-md"
                      triggerClassName="inline-block min-w-0 max-w-md"
                    >
                      <span className="text-gray-400 text-[11px] leading-snug truncate block">
                        {firstLine}{hasMore && '…'}
                      </span>
                    </Tooltip>
                  </div>
                )
              })()}
              {showTwitchTitle && (
                <div className="flex items-baseline gap-2">
                  <span className="text-[10px] uppercase tracking-wide text-gray-400 shrink-0 w-24">Twitch title</span>
                  <span className="text-gray-200">{meta!.twitchTitle}</span>
                </div>
              )}
              {showTwitchGame && (
                <div className="flex items-baseline gap-2">
                  <span className="text-[10px] uppercase tracking-wide text-gray-400 shrink-0 w-24">Twitch game</span>
                  <span className="text-gray-300">{meta!.twitchGameName}</span>
                </div>
              )}
              {meta?.ytTags && meta.ytTags.length > 0 && (
                <div className="flex items-baseline gap-2">
                  <span className="text-[10px] uppercase tracking-wide text-gray-400 shrink-0 w-24">Tags</span>
                  <div className="flex flex-wrap gap-1">
                    {meta.ytTags.map((t, i) => (
                      <span key={i} className="text-[10px] text-gray-400 bg-white/5 border border-white/10 rounded px-1.5 py-0.5">{t}</span>
                    ))}
                  </div>
                </div>
              )}
              {!series && !meta?.ytTitle && !meta?.ytGameTitle && !meta?.ytDescription && !showTwitchTitle && !showTwitchGame && (!meta?.ytTags || meta.ytTags.length === 0) && (
                <span className="text-[11px] text-gray-400 italic">No additional metadata.</span>
              )}
            </div>

            {/* Right: action buttons. Mirrors the column buttons + adds
                Open / Combine / Reschedule (where applicable), then a divider,
                New Episode, divider, Archive (single-item bypasses selection
                mode), Delete. */}
            <div className="flex items-center gap-0.5 shrink-0">
              {/* Buttons that mutate the folder's files (or queue work that
                  touches them) are disabled while an archive is in flight
                  for this folder. Player / thumbnail / metadata / open
                  folder / new episode stay live since they're read-only or
                  produce a separate folder. */}
              <Tooltip content={isArchiving ? 'Reschedule disabled — archive in progress' : 'Reschedule'}>
                <Button variant="ghost" size="icon-sm" icon={<CalendarClock size={12} />} onClick={onReschedule} disabled={isArchiving} />
              </Tooltip>
              {videoCount > 0 && <Tooltip content="Send to Player"><Button variant="ghost" size="icon-sm" icon={<Film size={12} />} onClick={onSendToPlayer} /></Tooltip>}
              {videoCount > 0 && (
                <Tooltip content={isArchiving ? "Already in the converter — archive in progress" : 'Send to Converter'}>
                  <Button variant="ghost" size="icon-sm" icon={<Zap size={12} />} onClick={onSendToConverter} disabled={isArchiving} />
                </Tooltip>
              )}
              {videoCount > 1 && (
                <Tooltip content={isArchiving ? 'Combine disabled — archive in progress' : 'Send to Combine'}>
                  <Button variant="ghost" size="icon-sm" icon={<Combine size={12} />} onClick={onSendToCombine} disabled={isArchiving} />
                </Tooltip>
              )}
              <Tooltip content={hasSMThumbnail ? 'Edit Stream Manager Thumbnail' : 'Create Stream Manager Thumbnail'}>
                <Button variant="ghost" size="icon-sm" icon={<ImageIcon size={12} />} onClick={onOpenThumbnails} />
              </Tooltip>
              <Tooltip content={hasMeta ? 'Edit metadata' : 'Add metadata'}>
                <Button variant="ghost" size="icon-sm" icon={<PencilLine size={12} />} onClick={hasMeta ? onEdit : onAdd} />
              </Tooltip>
              <div className="w-px h-3.5 bg-white/10 mx-1" />
              <Tooltip content="New episode based on this stream">
                <button onClick={onNewEpisode} className={PANEL_ACTION_BUTTON_BLUE}>
                  <CopyPlus size={12} />
                </button>
              </Tooltip>
              {cloudSyncActive && videoCount > 0 && (
                <>
                  <Tooltip content={isArchiving ? 'Offload disabled — archive in progress' : "Offload this stream's files to cloud (frees local disk; thumbnail stays local)"}>
                    <button onClick={onOffload} disabled={isArchiving} className={PANEL_ACTION_BUTTON_PINK}>
                      <Cloud size={12} />
                    </button>
                  </Tooltip>
                  <Tooltip content={isArchiving ? 'Pin Local disabled — archive in progress' : "Pin this stream's files local (always keep on disk)"}>
                    <button onClick={onPinLocal} disabled={isArchiving} className={PANEL_ACTION_BUTTON_CYAN}>
                      <CloudDownload size={12} />
                    </button>
                  </Tooltip>
                </>
              )}
              <Tooltip content="Open folder">
                <button onClick={onOpen} className={PANEL_ACTION_BUTTON_YELLOW}>
                  <FolderOpen size={12} />
                </button>
              </Tooltip>
              <div className="w-px h-3.5 bg-white/10 mx-1" />
              {videoCount > 0 && (
                <Tooltip content={
                  meta?.archived ? 'Already archived — remove archive status in metadata to re-archive'
                    : isArchiving ? 'Archive in progress'
                    : 'Archive this stream'
                }>
                  <button
                    onClick={onArchive}
                    disabled={isArchiving || !!meta?.archived}
                    className={PANEL_ACTION_BUTTON_GREEN}
                  >
                    <Archive size={12} />
                  </button>
                </Tooltip>
              )}
              <Tooltip content={isArchiving ? 'Delete disabled — archive in progress' : 'Delete this stream and all its contents'}>
                <button onClick={onDelete} disabled={isArchiving} className={PANEL_ACTION_BUTTON_RED}>
                  <Trash2 size={12} />
                </button>
              </Tooltip>
            </div>
          </div>
        </motion.div>
      </td>
    </motion.tr>
  )
}
