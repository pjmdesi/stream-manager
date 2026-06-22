import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Zap, Play, Trash2, Bookmark, FileImage, Image as ImageIcon, Film, Scissors, Cloud, CloudCheck, CloudDownload, Loader2, Maximize2, Archive } from 'lucide-react'
import { VideoThumb, CHECKER } from '../ui/VideoThumb'
import { ThumbImage } from './ThumbImage'
import { Tooltip } from '../ui/Tooltip'
import { useCloudOps } from '../../context/CloudOpsContext'
import type { StreamFolder, VideoEntry, VideoInfo } from '../../types'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let val = bytes / 1024
  let i = 0
  while (val >= 1024 && i < units.length - 1) { val /= 1024; i++ }
  return `${val.toFixed(val >= 10 ? 0 : 1)} ${units[i]}`
}

function formatTimecode(seconds: number): string {
  if (!isFinite(seconds) || seconds <= 0) return '0:00'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`
}

function extOf(name: string): string {
  const e = name.includes('.') ? name.split('.').pop() ?? '' : ''
  return e.toUpperCase()
}

/** Variant ordinal from an SM-created thumbnail name (…_sm-thumbnail.png → 1,
 *  …_sm-thumbnail-3.png → 3); null if it isn't an SM thumbnail (not editable). */
function parseSmThumbnailOrdinal(path: string): number | null {
  const m = path.match(/[_-]sm-thumbnail(?:-(\d+))?\.[a-z0-9]+$/i)
  if (!m) return null
  return m[1] ? parseInt(m[1], 10) : 1
}

// Per-file action buttons — same scheme as the converter rows: neutral at rest,
// color only on hover. The row is right-aligned.
const ACTION_BASE = 'inline-flex shrink-0 items-center gap-1 px-1.5 py-1 rounded-md text-[11px] text-gray-400 transition-colors'
const ACTION_PURPLE = `${ACTION_BASE} hover:text-purple-300 hover:bg-purple-500/10`
const ACTION_GREEN = `${ACTION_BASE} hover:text-green-400 hover:bg-green-500/10`
const ACTION_GRAY = `${ACTION_BASE} hover:text-gray-200 hover:bg-white/10`
const ACTION_PINK = `${ACTION_BASE} hover:text-pink-400 hover:bg-pink-500/10`
const ACTION_CYAN = `${ACTION_BASE} hover:text-cyan-400 hover:bg-cyan-500/10`
const ACTION_RED = `${ACTION_BASE} hover:text-red-400 hover:bg-red-500/10`

const CARD = 'group/file flex gap-3 p-2 rounded-lg bg-white/[0.03] border border-white/5 hover:bg-white/5 transition-colors'
const ACTION_ROW = 'mt-auto flex items-center justify-end gap-0.5 opacity-0 group-hover/file:opacity-100 transition-opacity'
const TYPE_ICON = 'shrink-0 relative -top-0.5'
const META_LINE = 'text-[11px] text-gray-400 mt-0.5 flex items-center gap-1 min-w-0'
const META_SECONDARY = 'text-[11px] text-gray-500 truncate'
// A tag "wraps" its thumbnail: a colored ring around the frame plus a label
// tray that pops out of the bottom edge. (Class strings are full literals so
// Tailwind's JIT picks them up — don't build them dynamically.)
type TagColor = 'pink' | 'blue' | 'neutral'
// 1px border in the tag color: top + sides on the thumbnail, sides + bottom on
// the tray, so together they form one outline around the grouped pair.
const TAG_BORDER_STATIC: Record<TagColor, string> = {
  pink: 'border-pink-400/70',
  blue: 'border-blue-400/70',
  neutral: 'border-white/40',
}
const TAG_BORDER_HOVER: Record<TagColor, string> = {
  pink: 'border-transparent group-hover/file:border-pink-400/70',
  blue: 'border-transparent group-hover/file:border-blue-400/70',
  neutral: 'border-transparent group-hover/file:border-white/40',
}
const TAG_TRAY_BG: Record<TagColor, string> = {
  pink: 'bg-pink-500/20 text-pink-100',
  blue: 'bg-blue-500/20 text-blue-100',
  neutral: 'bg-navy-800 text-gray-200',
}
const TRAY_CLS = 'flex w-full items-center justify-center gap-1 px-1.5 rounded-b-md border border-t-0 text-[9px] uppercase tracking-wide leading-[15px] whitespace-nowrap'

/** Hydration indicator at the end of the metadata line (only when cloud sync is
 *  active). Mirrors the video-counter tooltip: CloudCheck = on disk, Cloud =
 *  offloaded. */
function CloudStatus({ isLocal, active, busy }: { isLocal: boolean | undefined; active: boolean; busy: boolean }) {
  if (!active) return null
  if (busy || isLocal === undefined) {
    return (
      <Tooltip content={busy ? 'Syncing…' : 'Checking…'} side="top">
        <Loader2 size={11} className="shrink-0 text-gray-400 animate-spin" />
      </Tooltip>
    )
  }
  return (
    <Tooltip content={isLocal ? 'Available on this device' : 'Offloaded to the cloud'} side="top">
      {isLocal
        ? <CloudCheck size={11} className="shrink-0 text-gray-400" />
        : <Cloud size={11} className="shrink-0 text-gray-500" />}
    </Tooltip>
  )
}

/** Dynamic offload / pin-local action — mirrors the sidebar-footer buttons but
 *  toggles by the file's current hydration state. Icon-only; tooltip names the
 *  action. Hidden when cloud sync isn't active. */
function CloudAction({ isLocal, active, busy, onOffload, onPin }: { isLocal: boolean | undefined; active: boolean; busy: boolean; onOffload: () => void; onPin: () => void }) {
  if (!active) return null
  if (busy || isLocal === undefined) {
    return (
      <Tooltip content={busy ? 'Syncing…' : 'Checking…'} side="top">
        <button disabled className={`${ACTION_BASE} opacity-60 cursor-not-allowed`}>
          <Loader2 size={12} className="animate-spin" />
        </button>
      </Tooltip>
    )
  }
  return isLocal
    ? (
      <Tooltip content="Offload to cloud" side="top">
        <button onClick={onOffload} className={ACTION_PINK}><Cloud size={12} /></button>
      </Tooltip>
    )
    : (
      <Tooltip content="Pin local" side="top">
        <button onClick={onPin} className={ACTION_CYAN}><CloudDownload size={12} /></button>
      </Tooltip>
    )
}

interface TagSpec {
  color: TagColor
  label: string
  icon?: React.ReactNode
  /** Ring + tray only appear on card hover (used by the "set thumbnail" affordance). */
  hoverOnly?: boolean
  tooltip?: string
  /** Makes the tray a button (e.g. set-as-thumbnail). */
  onClick?: () => void
}

/** Wraps a thumbnail with a colored border that continues into a label tray
 *  below it, grouping the two. `tag === null` renders the thumbnail bare. The
 *  thumbnail itself must be square along its bottom edge where the tray joins
 *  (the caller passes the appropriate rounding). */
function TaggedThumb({ thumb, tag }: { thumb: React.ReactNode; tag: TagSpec | null }) {
  if (!tag) return <>{thumb}</>
  const bc = tag.hoverOnly ? TAG_BORDER_HOVER[tag.color] : TAG_BORDER_STATIC[tag.color]
  const vis = tag.hoverOnly ? 'opacity-0 group-hover/file:opacity-100 transition-opacity' : ''
  const inner = <>{tag.icon}{tag.label}</>
  const trayCls = `${TRAY_CLS} ${bc} ${TAG_TRAY_BG[tag.color]} ${vis}`
  const trayEl = tag.onClick
    ? <button type="button" onClick={tag.onClick} className={trayCls}>{inner}</button>
    : <div className={trayCls}>{inner}</div>
  const tray = tag.tooltip
    ? <Tooltip content={tag.tooltip} side="bottom" triggerClassName="block">{trayEl}</Tooltip>
    : trayEl
  return (
    <div className="w-fit">
      <div className={`rounded-t-md border border-b-0 ${bc}`}>{thumb}</div>
      {tray}
    </div>
  )
}

function VideoCard({ path, entry, probed, isLocal, cloudSyncActive, busy, archived, onSendToPlayer, onSendToConverter, onOffload, onPin, onReload }: {
  path: string
  entry: VideoEntry | undefined
  /** Fresh ffprobe result after a hydration — fills what the placeholder lacked. */
  probed: VideoInfo | undefined
  /** undefined = hydration status not yet determined (shows a spinner). */
  isLocal: boolean | undefined
  cloudSyncActive: boolean
  busy: boolean
  /** SM stamped the archived (encoded_by) tag on the file. */
  archived: boolean
  onSendToPlayer: (path: string) => void
  onSendToConverter: (path: string) => void
  onOffload: (path: string) => void
  onPin: (path: string) => void
  onReload: () => void
}) {
  const name = path.split(/[\\/]/).pop() ?? path
  const isShort = entry?.category === 'short'
  const isClip = !isShort && (entry?.category === 'clip' || !!entry?.clipOf)
  // Prefer the scanned entry, fall back to a fresh probe (offloaded files had
  // no duration/resolution/codec until they were hydrated).
  const width = entry?.width ?? probed?.width
  const height = entry?.height ?? probed?.height
  const duration = entry?.duration ?? probed?.duration
  const fps = entry?.fps ?? probed?.fps
  const codec = entry?.codec ?? probed?.videoCodec
  const res = width && height ? `${width}×${height}` : null
  const timecode = duration != null ? formatTimecode(duration) : null
  const primary = [res, timecode].filter(Boolean).join('  ·  ')
  const encoding = [codec?.toUpperCase(), fps ? `${Math.round(fps)}fps` : null].filter(Boolean).join(' ')
  const secondary = [entry?.size != null ? formatBytes(entry.size) : null, encoding || null, extOf(name) || null].filter(Boolean).join('  ·  ')

  return (
    <div className={CARD}>
      <div className="shrink-0">
        <TaggedThumb
          thumb={<VideoThumb path={path} width={104} height={58} checker rounded={isShort || isClip ? 'rounded-t-md' : 'rounded-md'} />}
          tag={isShort ? { color: 'blue', label: 'Short' } : isClip ? { color: 'pink', label: 'Clip' } : null}
        />
      </div>
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="flex items-center gap-1.5 min-w-0">
          <p className="text-xs text-gray-200 truncate" title={name}>{name}</p>
          {archived && (
            <Tooltip content="Archived by Stream Manager" side="top">
              <Archive size={11} className="shrink-0 text-emerald-400" />
            </Tooltip>
          )}
        </div>
        <div className={META_LINE}>
          {isShort || isClip ? <Scissors size={11} className={TYPE_ICON} /> : <Film size={11} className={TYPE_ICON} />}
          <span className="flex-1 truncate min-w-0">{primary || '—'}</span>
          <CloudStatus isLocal={isLocal} active={cloudSyncActive} busy={busy} />
        </div>
        {secondary && <p className={META_SECONDARY}>{secondary}</p>}
        <div className={ACTION_ROW}>
          <Tooltip content="Send to player" side="top">
            <button onClick={() => onSendToPlayer(path)} className={ACTION_PURPLE}><Play size={12} /> Player</button>
          </Tooltip>
          <Tooltip content="Send to converter" side="top">
            <button onClick={() => onSendToConverter(path)} className={ACTION_GREEN}><Zap size={12} /> Convert</button>
          </Tooltip>
          <CloudAction isLocal={isLocal} active={cloudSyncActive} busy={busy} onOffload={() => onOffload(path)} onPin={() => onPin(path)} />
          <Tooltip content="Move to recycle bin" side="top">
            <button onClick={async () => { await window.api.trashFile(path).catch(() => {}); onReload() }} className={ACTION_RED}><Trash2 size={12} /></button>
          </Tooltip>
        </div>
      </div>
    </div>
  )
}

function ImageCard({ path, thumbIndex, isLocal, cloudIsLocal, cloudSyncActive, busy, thumbsKey, isPreferred, size, onSetThumbnail, onDeleteThumbnail, onEditThumbnail, onOpenLightbox, onOffload, onPin }: {
  path: string
  thumbIndex: number
  /** Scan-flag-based local hint for rendering the image (immediate). */
  isLocal: boolean
  /** Authoritative status for the cloud icons; undefined = still checking. */
  cloudIsLocal: boolean | undefined
  cloudSyncActive: boolean
  busy: boolean
  thumbsKey: number
  isPreferred: boolean
  size?: number
  onSetThumbnail: (path: string) => void
  onDeleteThumbnail: (path: string) => void
  onEditThumbnail: (variantOrdinal?: number) => void
  onOpenLightbox: (index: number) => void
  onOffload: (path: string) => void
  onPin: (path: string) => void
}) {
  const name = path.split(/[\\/]/).pop() ?? path
  const [dims, setDims] = useState<{ width: number; height: number } | null>(null)
  const ordinal = parseSmThumbnailOrdinal(path)
  const isSm = ordinal != null
  const secondary = [size != null ? formatBytes(size) : null, extOf(name) || null].filter(Boolean).join('  ·  ')

  return (
    <div className={CARD}>
      <div className="shrink-0">
        <TaggedThumb
          thumb={
            <div
              className={`group/thumb relative w-[104px] h-[58px] overflow-hidden cursor-pointer ${isPreferred ? 'rounded-t-md' : 'rounded-md group-hover/file:rounded-b-none'}`}
              style={CHECKER}
              onClick={() => onOpenLightbox(thumbIndex)}
            >
              <ThumbImage
                path={path}
                thumbsKey={thumbsKey}
                isLocal={isLocal}
                hydrate={false}
                className="w-full h-full object-contain"
                placeholderClassName="w-full h-full"
                iconSize={16}
                onLoad={d => d && setDims(d)}
              />
              {/* Hover affordance — clicking opens the full-screen carousel. */}
              <div className="absolute inset-0 flex items-center justify-center bg-black/35 opacity-0 group-hover/thumb:opacity-100 transition-opacity pointer-events-none">
                <Maximize2 size={16} className="text-white/90" />
              </div>
            </div>
          }
          tag={isPreferred
            ? { color: 'blue', label: 'Thumbnail', icon: <Bookmark size={9} className="text-amber-300" fill="currentColor" />, tooltip: 'Stream item thumbnail' }
            : { color: 'neutral', label: 'Thumbnail', icon: <Bookmark size={9} />, hoverOnly: true, tooltip: 'Set as stream item thumbnail', onClick: () => onSetThumbnail(path) }
          }
        />
      </div>
      <div className="flex-1 min-w-0 flex flex-col">
        <p className="text-xs text-gray-200 truncate" title={name}>{name}</p>
        <div className={META_LINE}>
          {isSm ? <FileImage size={11} className={TYPE_ICON} /> : <ImageIcon size={11} className={TYPE_ICON} />}
          <span className="flex-1 truncate min-w-0">{dims ? `${dims.width}×${dims.height}` : 'Image'}</span>
          <CloudStatus isLocal={cloudIsLocal} active={cloudSyncActive} busy={busy} />
        </div>
        {secondary && <p className={META_SECONDARY}>{secondary}</p>}
        <div className={ACTION_ROW}>
          {isSm && (
            <Tooltip content="Open in thumbnail editor" side="top" shortcut="Ctrl+Shift+T">
              <button onClick={() => onEditThumbnail(ordinal!)} className={ACTION_GRAY}><FileImage size={12} /> Edit</button>
            </Tooltip>
          )}
          <CloudAction isLocal={cloudIsLocal} active={cloudSyncActive} busy={busy} onOffload={() => onOffload(path)} onPin={() => onPin(path)} />
          <Tooltip content="Move to recycle bin" side="top">
            <button onClick={() => onDeleteThumbnail(path)} className={ACTION_RED}><Trash2 size={12} /></button>
          </Tooltip>
        </div>
      </div>
    </div>
  )
}

interface Props {
  folder: StreamFolder
  thumbsKey: number
  preferredThumbnail?: string
  cloudSyncActive: boolean
  onSendToPlayer: (path: string) => void
  onSendToConverter: (path: string) => void
  onSetThumbnail: (path: string) => void
  onDeleteThumbnail: (path: string) => void
  onEditThumbnail: (variantOrdinal?: number) => void
  onOpenLightbox: (index: number) => void
  onReload: () => void
}

/**
 * StreamFilesGrid — a file-explorer-style grid of the stream's media (videos +
 * thumbnail images) with per-file actions: open in player / converter, set as
 * thumbnail / edit / lightbox, offload-or-pin (cloud), and trash. Hydration
 * status is detected per file and refreshes as cloud ops complete. Type-filter
 * toggles show/hide each kind. Wraps to 3 columns at the sidebar's max content
 * width (1280px), fewer as it narrows; capped to ~3 rows then scrolls.
 */
export function StreamFilesGrid({
  folder, thumbsKey, preferredThumbnail, cloudSyncActive,
  onSendToPlayer, onSendToConverter, onSetThumbnail, onDeleteThumbnail, onEditThumbnail, onOpenLightbox, onReload,
}: Props) {
  const videoMap = folder.meta?.videoMap ?? {}
  const hasVideos = folder.videos.length > 0
  const hasImages = folder.thumbnails.length > 0

  const { enqueueOffload, enqueueHydrate, offloadItems, hydrateItems } = useCloudOps()

  const [showVideo, setShowVideo] = useState(true)
  const [showImage, setShowImage] = useState(true)

  // Image file sizes (videos already carry theirs in videoMap).
  const [imageSizes, setImageSizes] = useState<Record<string, number>>({})
  const thumbsJoined = folder.thumbnails.join('|')
  useEffect(() => {
    if (folder.thumbnails.length === 0) { setImageSizes({}); return }
    let cancelled = false
    window.api.getFileSizes(folder.thumbnails).then(sizes => {
      if (cancelled) return
      const map: Record<string, number> = {}
      folder.thumbnails.forEach((p, i) => { const s = sizes[i]; if (s != null) map[p] = s })
      setImageSizes(map)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [thumbsJoined]) // eslint-disable-line react-hooks/exhaustive-deps

  // Per-file hydration status (local vs offloaded). Seeded by checkLocalFiles…
  const [localStatus, setLocalStatus] = useState<Record<string, boolean>>({})
  const allJoined = [...folder.videos, ...folder.thumbnails].join('|')
  useEffect(() => {
    const all = [...folder.videos, ...folder.thumbnails]
    if (all.length === 0) return
    // A file's status stays unknown (absent from the map) until the
    // authoritative check resolves — the cloud icon/button show a spinner
    // meanwhile rather than wrongly claiming the file is hydrated. Results are
    // merged (not replaced) so revisiting a folder shows its cached status
    // immediately instead of re-spinning.
    let cancelled = false
    window.api.checkLocalFiles(all).then(flags => {
      if (cancelled) return
      setLocalStatus(prev => {
        const next = { ...prev }
        all.forEach((p, i) => { next[p] = !!flags[i] })
        return next
      })
    }).catch(() => {})
    return () => { cancelled = true }
  }, [allJoined]) // eslint-disable-line react-hooks/exhaustive-deps

  // …then flipped as cloud ops for our files reach a terminal state, so the
  // button/icon update without a folder rescan.
  useEffect(() => {
    setLocalStatus(prev => {
      let changed = false
      const next = { ...prev }
      for (const it of offloadItems) {
        if (it.path in next && (it.status === 'done' || it.status === 'already-offline') && next[it.path] !== false) { next[it.path] = false; changed = true }
      }
      for (const it of hydrateItems) {
        if (it.path in next && (it.status === 'done' || it.status === 'already-local') && next[it.path] !== true) { next[it.path] = true; changed = true }
      }
      return changed ? next : prev
    })
  }, [offloadItems, hydrateItems])

  // Files with an in-flight cloud op (pending/running) — drives the spinner.
  const busyPaths = useMemo(() => {
    const s = new Set<string>()
    for (const it of offloadItems) if (it.status === 'pending' || it.status === 'running') s.add(it.path)
    for (const it of hydrateItems) if (it.status === 'pending' || it.status === 'running') s.add(it.path)
    return s
  }, [offloadItems, hydrateItems])

  const [archivedSet, setArchivedSet] = useState<Set<string>>(new Set())

  // After a video finishes hydrating, read the metadata its placeholder lacked:
  // a fresh ffprobe for duration/resolution/codec and a thumbnail remount.
  // (Images self-heal — the isLocal flip re-loads ThumbImage.)
  const [probedMeta, setProbedMeta] = useState<Record<string, VideoInfo>>({})
  const [thumbVersion, setThumbVersion] = useState<Record<string, number>>({})
  const reReadRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    for (const it of hydrateItems) {
      if (it.status !== 'done' && it.status !== 'already-local') continue
      if (!folder.videos.includes(it.path) || reReadRef.current.has(it.path)) continue
      reReadRef.current.add(it.path)
      setThumbVersion(prev => ({ ...prev, [it.path]: (prev[it.path] ?? 0) + 1 }))
      window.api.probeFile(it.path)
        .then(info => setProbedMeta(prev => ({ ...prev, [it.path]: info })))
        .catch(() => {})
      window.api.checkAlreadyArchived([it.path])
        .then(paths => { if (paths.length > 0) setArchivedSet(prev => { const next = new Set(prev); next.add(it.path); return next }) })
        .catch(() => {})
    }
  }, [hydrateItems, folder.videos])

  // Archived = SM stamped the encoded_by tag. checkAlreadyArchived does its own
  // local-file gating in main, so probe immediately rather than waiting on the
  // renderer's hydration check first (re-checked per file as it hydrates above).
  useEffect(() => {
    if (folder.videos.length === 0) { setArchivedSet(new Set()); return }
    let cancelled = false
    window.api.checkAlreadyArchived(folder.videos)
      .then(paths => { if (!cancelled) setArchivedSet(new Set(paths)) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [folder.videos.join('|')]) // eslint-disable-line react-hooks/exhaustive-deps

  const sizeOf = (path: string): number => {
    const name = path.split(/[\\/]/).pop() ?? ''
    return videoMap[name]?.size ?? imageSizes[path] ?? 0
  }
  // Per-file actions surface via the widget/icons only — don't pop the modal.
  const offloadFile = (path: string) => enqueueOffload([{ path, size: sizeOf(path) }], false)
  const pinFile = (path: string) => enqueueHydrate([{ path, size: sizeOf(path) }], false)

  if (!hasVideos && !hasImages) return null

  return (
    <div className="flex flex-col gap-2">
      {hasVideos && hasImages && (
        <div className="flex items-center gap-1.5">
          <FilterToggle active={showVideo} onClick={() => setShowVideo(v => !v)} icon={<Film size={12} />} label={`Video ${folder.videos.length}`} />
          <FilterToggle active={showImage} onClick={() => setShowImage(v => !v)} icon={<ImageIcon size={12} />} label={`Images ${folder.thumbnails.length}`} />
        </div>
      )}
      <div className="grid gap-3 max-h-[318px] overflow-y-auto pr-1" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 340px), 1fr))' }}>
        {showVideo && folder.videos.map(path => {
          const entry = videoMap[path.split(/[\\/]/).pop() ?? '']
          return (
            <VideoCard
              key={`${path}:${thumbVersion[path] ?? 0}`}
              path={path}
              entry={entry}
              probed={probedMeta[path]}
              isLocal={localStatus[path]}
              cloudSyncActive={cloudSyncActive}
              busy={busyPaths.has(path)}
              archived={archivedSet.has(path)}
              onSendToPlayer={onSendToPlayer}
              onSendToConverter={onSendToConverter}
              onOffload={offloadFile}
              onPin={pinFile}
              onReload={onReload}
            />
          )
        })}
        {showImage && folder.thumbnails.map((path, i) => {
          const name = path.split(/[\\/]/).pop() ?? ''
          const isPreferred = preferredThumbnail ? name === preferredThumbnail : i === 0
          return (
            <ImageCard
              key={path}
              path={path}
              thumbIndex={i}
              isLocal={localStatus[path] ?? folder.thumbnailLocalFlags?.[i] ?? true}
              cloudIsLocal={localStatus[path]}
              cloudSyncActive={cloudSyncActive}
              busy={busyPaths.has(path)}
              thumbsKey={thumbsKey}
              isPreferred={isPreferred}
              size={imageSizes[path]}
              onSetThumbnail={onSetThumbnail}
              onDeleteThumbnail={onDeleteThumbnail}
              onEditThumbnail={onEditThumbnail}
              onOpenLightbox={onOpenLightbox}
              onOffload={offloadFile}
              onPin={pinFile}
            />
          )
        })}
      </div>
    </div>
  )
}

function FilterToggle({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] border transition-colors ${
        active
          ? 'text-purple-200 border-purple-500/40 bg-purple-500/15'
          : 'text-gray-500 border-white/10 hover:text-gray-300'
      }`}
    >
      {icon} {label}
    </button>
  )
}
