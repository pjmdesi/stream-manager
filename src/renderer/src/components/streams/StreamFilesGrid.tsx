import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { Zap, Play, Trash2, Bookmark, FileImage, Image as ImageIcon, Film, Scissors, Cloud, CloudCheck, CloudDownload, Loader2, Maximize2, Archive, Check, CheckCheck, Square, ListChecks, X, Combine, ChevronDown, ChevronRight } from 'lucide-react'
import { VideoThumb, CHECKER, releaseThumbDecodes } from '../ui/VideoThumb'
import { ThumbImage } from './ThumbImage'
import { Tooltip } from '../ui/Tooltip'
import { TruncatedText } from '../ui/TruncatedText'
import { useCloudOps } from '../../context/CloudOpsContext'
import { useInUse } from '../../hooks/useInUse'
import { useAnimationConfig } from '../../hooks/useAnimationConfig'
import { getCachedHydration, rememberHydration, rememberHydrationOne, stalePaths, subscribeHydration } from '../../lib/hydrationCache'
import { videoMapKey } from '../../lib/videoMapKey'
import type { ClipDraft, StreamFolder, VideoEntry, VideoInfo } from '../../types'

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

const CARD = 'group/file relative flex gap-3 p-2 rounded-lg bg-white/[0.03] border border-white/5 hover:bg-white/5 transition-colors'
const ACTION_ROW = 'mt-auto flex items-center justify-end gap-0.5 opacity-0 group-hover/file:opacity-100 transition-opacity'
const TYPE_ICON = 'shrink-0 relative -top-0.5'
const META_LINE = 'text-[11px] text-gray-400 mt-0.5 flex items-center gap-1 min-w-0'
const META_SECONDARY = 'text-[11px] text-gray-500 truncate'
// A tag "wraps" its thumbnail: a colored ring around the frame plus a label
// tray that pops out of the bottom edge. (Class strings are full literals so
// Tailwind's JIT picks them up — don't build them dynamically.)
// File-class tag palette: the VIDEO class is the warm family — red
// (Recording), pink (Clip), violet (Short) — while IMAGES are cool: teal
// (selected thumbnail) + neutral gray (alternates). Blue is deliberately
// unassigned (reserved for a future marker). Shorts use Tailwind's real
// `violet-*`, NOT the app's `purple-*` tokens — those are remapped to the
// slate accent and would collide with selection rings.
type TagColor = 'red' | 'pink' | 'violet' | 'teal' | 'blue' | 'neutral'
// 1px border in the tag color: top + sides on the thumbnail, sides + bottom on
// the tray, so together they form one outline around the grouped pair.
const TAG_BORDER_STATIC: Record<TagColor, string> = {
  red: 'border-red-400/70',
  pink: 'border-pink-400/70',
  violet: 'border-violet-400/70',
  teal: 'border-teal-400/70',
  blue: 'border-blue-400/70',
  neutral: 'border-white/40',
}
const TAG_BORDER_HOVER: Record<TagColor, string> = {
  red: 'border-transparent group-hover/file:border-red-400/70',
  pink: 'border-transparent group-hover/file:border-pink-400/70',
  violet: 'border-transparent group-hover/file:border-violet-400/70',
  teal: 'border-transparent group-hover/file:border-teal-400/70',
  blue: 'border-transparent group-hover/file:border-blue-400/70',
  neutral: 'border-transparent group-hover/file:border-white/40',
}
const TAG_TRAY_BG: Record<TagColor, string> = {
  red: 'bg-red-500/20 text-red-100',
  pink: 'bg-pink-500/20 text-pink-100',
  violet: 'bg-violet-500/20 text-violet-100',
  teal: 'bg-teal-500/20 text-teal-100',
  blue: 'bg-blue-500/20 text-blue-100',
  neutral: 'bg-navy-800 text-gray-200',
}
const TRAY_CLS = 'flex w-full items-center justify-center gap-1 px-1.5 rounded-b-md border border-t-0 text-[9px] uppercase tracking-wide leading-[15px] whitespace-nowrap'

// Files-grid collapse chevron — the ROW-HEIGHT ANCHOR. Exact FilterToggle
// box recipe (py-1 + 1px border + text-[11px] line metrics via the ZWSP
// child below) so the header row keeps the same height whether the filter
// buttons render or not, expanded or collapsed — nothing below ever shifts.
const COLLAPSE_BTN = 'inline-flex items-center px-1.5 py-1 rounded-md border border-transparent text-[11px] text-gray-400 hover:text-gray-200 hover:bg-white/10 transition-colors'
// Zero-width space: gives the icon-only button a real text line box, so its
// content height matches the text-bearing FilterToggles exactly.
const ZWSP = <span className="w-0 overflow-hidden select-none">&#8203;</span>

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
function CloudAction({ isLocal, active, busy, onOffload, onPin, offloadBlockReason }: { isLocal: boolean | undefined; active: boolean; busy: boolean; onOffload: () => void; onPin: () => void; offloadBlockReason?: string | null }) {
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
    ? offloadBlockReason
      ? (
        <Tooltip content={`Can't offload: ${offloadBlockReason}`} side="top">
          <button disabled className={`${ACTION_BASE} opacity-60 cursor-not-allowed`}><Cloud size={12} /></button>
        </Tooltip>
      )
      : (
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
function TaggedThumb({ thumb, tag, suppressHover }: { thumb: React.ReactNode; tag: TagSpec | null; suppressHover?: boolean }) {
  if (!tag) return <>{thumb}</>
  // A hover-only tag always reserves its border + tray in layout and reveals
  // them on hover. `suppressHover` (select mode) keeps that reserved layout but
  // never reveals them, so cards don't resize when toggling select mode.
  const reveal = tag.hoverOnly && !suppressHover
  const bc = !tag.hoverOnly
    ? TAG_BORDER_STATIC[tag.color]
    : reveal ? TAG_BORDER_HOVER[tag.color] : 'border-transparent'
  const vis = tag.hoverOnly ? (reveal ? 'opacity-0 group-hover/file:opacity-100 transition-opacity' : 'opacity-0') : ''
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

/** Selection checkbox overlay — top-left of a card. Only rendered while select
 *  mode is on; shows the file's selected state. Shift-click extends a range. */
function SelectBox({ checked, onToggle }: { checked: boolean; onToggle: (shiftKey: boolean) => void }) {
  return (
    <Tooltip content="Select (Shift-click for a range)" triggerClassName="absolute bottom-1 right-1 z-10">
    <button
      type="button"
      onMouseDown={e => e.stopPropagation()}
      onClick={e => { e.stopPropagation(); onToggle(e.shiftKey) }}
      className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${
        checked ? 'bg-purple-700 border-purple-700' : 'bg-navy-900/70 border-gray-500 hover:border-gray-300'
      }`}
    >
      {checked && <Check size={10} className="text-white" strokeWidth={3} />}
    </button>
    </Tooltip>
  )
}

/** Full-card target for select mode — sits above the card's own interactions
 *  (lightbox / action buttons) so the whole card acts as a select target, like
 *  the stream rows: mousedown starts a drag-select, mouseenter extends it, a
 *  plain click toggles (range with Shift). */
function SelectOverlay({ onDragStart, onDragEnter, onClick }: {
  onDragStart: () => void
  onDragEnter: () => void
  onClick: (shiftKey: boolean) => void
}) {
  return (
    <div
      className="absolute inset-0 z-[5] cursor-pointer select-none"
      // Left button only — arming the drag machinery on right/middle
      // clicks left isDragging latched through context menus, and later
      // mouseenters silently rewrote the selection as phantom ranges.
      onMouseDown={e => { if (e.button !== 0) return; e.preventDefault(); onDragStart() }}
      onMouseEnter={onDragEnter}
      onClick={e => onClick(e.shiftKey)}
    />
  )
}

/** Draft display name: user-chosen, else "Clip N" derived from the stable
 *  "{sourceFilename}-clip-{N}" id (same default the player's panel shows). */
function draftLabel(d: ClipDraft): string {
  if (d.name?.trim()) return d.name.trim()
  const m = d.id.match(/-clip-(\d+)$/)
  return m ? `Clip ${m[1]}` : 'Clip'
}

function timeAgo(ms: number): string {
  const s = Math.max(0, Date.now() - ms) / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

function VideoCard({ path, entry, probed, isLocal, cloudSyncActive, busy, archived, selectMode, selected, highlighted, onSelectToggle, onDragStart, onDragEnter, onSendToPlayer, onSendToConverter, onOffload, onPin, onDeleted, blockReason, drafts, onModifierSelect }: {
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
  selectMode: boolean
  selected: boolean
  /** Transient focus ring (streams-list tooltip row click). */
  highlighted?: boolean
  onSelectToggle: (shiftKey: boolean) => void
  onDragStart: () => void
  onDragEnter: () => void
  onSendToPlayer: (path: string) => void
  onSendToConverter: (path: string) => void
  onOffload: (path: string) => void
  onPin: (path: string) => void
  /** Called after this file was successfully trashed, so the parent can drop
   *  it from folder state in place (no reload). */
  onDeleted: () => void
  /** Why this file can't be deleted right now (converter / open elsewhere), or
   *  null when it's deletable. */
  blockReason: string | null
  /** Unexported clip drafts whose source is this video (newest first). */
  drafts?: ClipDraft[]
  /** Shift/Ctrl-click outside select mode: enter select mode with this file. */
  onModifierSelect: () => void
}) {
  const name = path.split(/[\\/]/).pop() ?? path
  const isShort = entry?.category === 'short'
  const isClip = !isShort && (entry?.category === 'clip' || !!entry?.clipOf)
  // 'full' is what the stream row's video counter counts — the keystone
  // recording file(s) of the stream item.
  const isRecording = !isShort && !isClip && entry?.category === 'full'
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
    <div
      data-fp={path}
      className={`${CARD} ${selectMode && selected ? 'ring-1 ring-purple-500/60 bg-purple-500/5' : ''} ${highlighted ? 'ring-2 ring-purple-400/80' : ''}`}
      onClick={selectMode ? undefined : (e) => {
        // Shift/Ctrl-click = quick entry into select mode with this file.
        // Buttons keep their own actions (their clicks bubble here).
        if (!(e.shiftKey || e.ctrlKey || e.metaKey)) return
        if ((e.target as HTMLElement).closest('button')) return
        onModifierSelect()
      }}
    >
      {selectMode && (<><SelectOverlay onDragStart={onDragStart} onDragEnter={onDragEnter} onClick={onSelectToggle} /><SelectBox checked={selected} onToggle={onSelectToggle} /></>)}
      <div className="shrink-0">
        <TaggedThumb
          thumb={<VideoThumb path={path} width={104} height={58} checker rounded={isShort || isClip || isRecording ? 'rounded-t-md' : 'rounded-md'} />}
          tag={isShort ? { color: 'violet', label: 'Short' }
            : isClip ? { color: 'pink', label: 'Clip' }
            : isRecording ? {
                color: 'red',
                label: 'Recording',
                // Archived marker lives in the tray (same layout as the
                // thumbnail tag's bookmark), not next to the filename.
                icon: archived ? <Archive size={9} className="text-emerald-400" /> : undefined,
                tooltip: archived ? 'Archived by Stream Manager' : undefined,
              }
            : null}
        />
      </div>
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="flex items-center gap-1.5 min-w-0">
          <TruncatedText text={name} className="text-xs text-gray-200 truncate" />
          {/* Archived marker for NON-recording videos (e.g. an archived file
              whose category shifted) — recordings carry it in their tag tray. */}
          {archived && !isRecording && (
            <Tooltip content="Archived by Stream Manager" side="top">
              <Archive size={11} className="shrink-0 text-emerald-400" />
            </Tooltip>
          )}
        </div>
        <div className={META_LINE}>
          {isShort || isClip ? <Scissors size={11} className={TYPE_ICON} /> : <Film size={11} className={TYPE_ICON} />}
          <span className="flex-1 truncate min-w-0">{primary || '—'}</span>
          {drafts && drafts.length > 0 && (
            <Tooltip
              side="top"
              content={
                <div className="flex flex-col gap-0.5">
                  <span className="font-medium text-gray-200">
                    Unexported clip draft{drafts.length !== 1 ? 's' : ''} — click to open in player
                  </span>
                  {drafts.map(d => (
                    <span key={d.id} className="text-gray-300">{draftLabel(d)} · {timeAgo(d.updatedAt)}</span>
                  ))}
                </div>
              }
            >
              <button
                onClick={() => onSendToPlayer(path)}
                className="shrink-0 inline-flex items-center gap-0.5 px-1 py-px rounded text-[10px] text-pink-300 border border-pink-300/40 hover:bg-pink-500/10 transition-colors"
              >
                <Scissors size={9} /> {drafts.length}
              </button>
            </Tooltip>
          )}
          <CloudStatus isLocal={isLocal} active={cloudSyncActive} busy={busy} />
        </div>
        {secondary && <p className={META_SECONDARY}>{secondary}</p>}
        <div className={`${ACTION_ROW}${selectMode ? ' invisible' : ''}`}>
          <Tooltip content="Send to player" side="top">
            <button onClick={() => onSendToPlayer(path)} className={ACTION_PURPLE}><Play size={12} /> Player</button>
          </Tooltip>
          <Tooltip content="Send to converter" side="top">
            <button onClick={() => onSendToConverter(path)} className={ACTION_GREEN}><Zap size={12} /> Convert</button>
          </Tooltip>
          <CloudAction isLocal={isLocal} active={cloudSyncActive} busy={busy} onOffload={() => onOffload(path)} onPin={() => onPin(path)} />
          <Tooltip content={blockReason ? `Can't delete: ${blockReason}` : 'Move to recycle bin'} side="top">
            <button
              disabled={!!blockReason}
              onClick={async () => {
                // Authoritative backstop in case the reactive disable lags a job
                // that just started: never trash a file the converter still holds.
                if (await window.api.isPathInUseByConverter(path).catch(() => false)) return
                // Release any in-flight offscreen thumbnail decode of this
                // file — its <video> handle blocks the recycle-bin move.
                releaseThumbDecodes([path])
                // Only report success — a failed trash must keep the card.
                try { await window.api.trashFile(path) } catch { return }
                onDeleted()
              }}
              className={`${ACTION_RED} disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent`}
            ><Trash2 size={12} /></button>
          </Tooltip>
        </div>
      </div>
    </div>
  )
}

function ImageCard({ path, thumbIndex, isLocal, cloudIsLocal, cloudSyncActive, busy, thumbsKey, isPreferred, size, selectMode, selected, onSelectToggle, onDragStart, onDragEnter, onSetThumbnail, onDeleteThumbnail, onEditThumbnail, onOpenLightbox, onOffload, onPin, blockReason, onModifierSelect }: {
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
  selectMode: boolean
  selected: boolean
  onSelectToggle: (shiftKey: boolean) => void
  onDragStart: () => void
  onDragEnter: () => void
  onSetThumbnail: (path: string) => void
  onDeleteThumbnail: (path: string) => void
  onEditThumbnail: (variantOrdinal?: number) => void
  onOpenLightbox: (index: number) => void
  onOffload: (path: string) => void
  onPin: (path: string) => void
  /** Why this image can't be deleted (open in the thumbnail editor, etc.), or
   *  null when it's deletable. */
  blockReason: string | null
  /** Shift/Ctrl-click outside select mode: enter select mode with this file. */
  onModifierSelect: () => void
}) {
  const name = path.split(/[\\/]/).pop() ?? path
  const [dims, setDims] = useState<{ width: number; height: number } | null>(null)
  const ordinal = parseSmThumbnailOrdinal(path)
  const isSm = ordinal != null
  const secondary = [size != null ? formatBytes(size) : null, extOf(name) || null].filter(Boolean).join('  ·  ')

  return (
    <div
      className={`${CARD} ${selectMode && selected ? 'ring-1 ring-purple-500/60 bg-purple-500/5' : ''}`}
      onClick={selectMode ? undefined : (e) => {
        // Shift/Ctrl-click = quick entry into select mode with this file.
        if (!(e.shiftKey || e.ctrlKey || e.metaKey)) return
        if ((e.target as HTMLElement).closest('button')) return
        onModifierSelect()
      }}
    >
      {selectMode && (<><SelectOverlay onDragStart={onDragStart} onDragEnter={onDragEnter} onClick={onSelectToggle} /><SelectBox checked={selected} onToggle={onSelectToggle} /></>)}
      <div className="shrink-0">
        <TaggedThumb
          thumb={
            <div
              className={`group/thumb relative w-[104px] h-[58px] overflow-hidden cursor-pointer ${isPreferred || isSm ? 'rounded-t-md' : 'rounded-md group-hover/file:rounded-b-none'}`}
              style={CHECKER}
              // Modifier-clicks bubble to the card's select-mode entry
              // instead of opening the lightbox.
              onClick={(e) => { if (e.shiftKey || e.ctrlKey || e.metaKey) return; onOpenLightbox(thumbIndex) }}
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
            ? { color: 'teal', label: 'Thumbnail', icon: <Bookmark size={9} className="text-amber-300" fill="currentColor" />, tooltip: 'Stream item thumbnail' }
            // SM-made alternates keep their tag ALWAYS visible so they read
            // as app files, not stray images; non-SM images keep the
            // hover-only set-as-thumbnail affordance.
            : { color: 'neutral', label: 'Thumbnail', icon: <Bookmark size={9} />, hoverOnly: !isSm, tooltip: 'Set as stream item thumbnail', onClick: () => onSetThumbnail(path) }
          }
          suppressHover={selectMode}
        />
      </div>
      <div className="flex-1 min-w-0 flex flex-col">
        <TruncatedText text={name} className="text-xs text-gray-200 truncate" />
        <div className={META_LINE}>
          {isSm ? <FileImage size={11} className={TYPE_ICON} /> : <ImageIcon size={11} className={TYPE_ICON} />}
          <span className="flex-1 truncate min-w-0">{dims ? `${dims.width}×${dims.height}` : 'Image'}</span>
          <CloudStatus isLocal={cloudIsLocal} active={cloudSyncActive} busy={busy} />
        </div>
        {secondary && <p className={META_SECONDARY}>{secondary}</p>}
        <div className={`${ACTION_ROW}${selectMode ? ' invisible' : ''}`}>
          {isSm && (
            <Tooltip content="Open in thumbnail editor" side="top" shortcut="Ctrl+Shift+T">
              <button onClick={() => onEditThumbnail(ordinal!)} className={ACTION_GRAY}><FileImage size={12} /> Edit</button>
            </Tooltip>
          )}
          <CloudAction
            isLocal={cloudIsLocal}
            active={cloudSyncActive}
            busy={busy}
            onOffload={() => onOffload(path)}
            onPin={() => onPin(path)}
            // Mirrors main-side getProtectedPaths: the displayed thumbnail is
            // excluded from offloading, so the button would silently no-op.
            offloadBlockReason={isPreferred ? 'the stream item thumbnail is kept pinned on this device' : null}
          />
          <Tooltip content={blockReason ? `Can't delete: ${blockReason}` : 'Move to recycle bin'} side="top">
            <button
              disabled={!!blockReason}
              onClick={() => onDeleteThumbnail(path)}
              className={`${ACTION_RED} disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent`}
            ><Trash2 size={12} /></button>
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
  /** Bulk send the selected videos to the converter (one batch). */
  onSendFilesToConverter: (paths: string[]) => void
  /** Bulk send the selected videos to the combine page — lets the user pick
   *  specific files instead of sending the whole stream and pruning there. */
  onSendFilesToCombine: (paths: string[]) => void
  onSetThumbnail: (path: string) => void
  onDeleteThumbnail: (path: string) => void
  onEditThumbnail: (variantOrdinal?: number) => void
  onOpenLightbox: (index: number) => void
  /** Files were trashed by the grid (single or bulk). The parent removes them
   *  from folder state in place — deliberately no full reload/flash. */
  onFilesDeleted: (paths: string[]) => void
  /** File to flash with a focus ring (streams-list tooltip row click). The
   *  token re-triggers for repeat clicks on the same file. */
  highlightFile?: { path: string; token: number } | null
}

/**
 * StreamFilesGrid — a file-explorer-style grid of the stream's media (videos +
 * thumbnail images) with per-file actions: open in player / converter, set as
 * thumbnail / edit / lightbox, offload-or-pin (cloud), and trash. Hydration
 * status is detected per file and refreshes as cloud ops complete. Type-filter
 * toggles show/hide each kind. Wraps to 3 columns at the sidebar's max content
 * width (1280px), fewer as it narrows; capped to ~3 rows then scrolls.
 */
export interface FilesGridHandle {
  /** Toggle select mode (exits + clears the selection when turning off). */
  toggleSelectMode: () => void
  /** Ctrl+A: select all visible files, or clear if all are already selected. */
  selectAllOrClear: () => void
  isSelectMode: () => boolean
}

export const StreamFilesGrid = forwardRef<FilesGridHandle, Props>(function StreamFilesGrid({
  folder, thumbsKey, preferredThumbnail, cloudSyncActive,
  onSendToPlayer, onSendToConverter, onSendFilesToConverter, onSendFilesToCombine, onSetThumbnail, onDeleteThumbnail, onEditThumbnail, onOpenLightbox, onFilesDeleted,
  highlightFile,
}, ref) {
  const videoMap = folder.meta?.videoMap ?? {}
  const hasVideos = folder.videos.length > 0
  const hasImages = folder.thumbnails.length > 0

  // Transient focus ring on a file card, driven by clicks in the streams
  // list's video-count tooltip. Naturally clears on the next mousedown
  // anywhere — the ring is a pointer, not a selection.
  const [ringPath, setRingPath] = useState<string | null>(null)
  useEffect(() => {
    if (!highlightFile) return
    setRingPath(highlightFile.path)
    const raf = requestAnimationFrame(() => {
      try {
        document.querySelector(`[data-fp="${CSS.escape(highlightFile.path)}"]`)
          ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      } catch { /* selector failure — the ring still renders */ }
    })
    const clear = () => setRingPath(null)
    window.addEventListener('mousedown', clear, { once: true })
    return () => { cancelAnimationFrame(raf); window.removeEventListener('mousedown', clear) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightFile?.token])

  const { enqueueOffload, enqueueHydrate, offloadItems, hydrateItems } = useCloudOps()

  // A file can't be deleted while it's in use: held by a converter job, or open
  // in the player / thumbnail editor. fileReason returns the reason (or null
  // when deletable) so the disabled control can explain itself. The click
  // handler re-checks the authoritative main-process converter state for the
  // rare just-started-job race.
  const { fileReason } = useInUse()

  const [showVideo, setShowVideo] = useState(true)
  const [showImage, setShowImage] = useState(true)

  // Shared by the on-open IPC effects below to defer their work past the
  // sidebar slide (0 when animations are off — a no-op delay then).
  const anim = useAnimationConfig()

  // Image file sizes (videos already carry theirs in videoMap). Deferred past
  // the slide — non-essential metadata whose IPC reply would otherwise
  // re-render the grid mid-animation.
  const [imageSizes, setImageSizes] = useState<Record<string, number>>({})
  const thumbsJoined = folder.thumbnails.join('|')
  useEffect(() => {
    if (folder.thumbnails.length === 0) { setImageSizes({}); return }
    let cancelled = false
    const timer = setTimeout(() => {
      window.api.getFileSizes(folder.thumbnails).then(sizes => {
        if (cancelled) return
        const map: Record<string, number> = {}
        folder.thumbnails.forEach((p, i) => { const s = sizes[i]; if (s != null) map[p] = s })
        setImageSizes(map)
      }).catch(() => {})
    }, anim.duration(230))
    return () => { cancelled = true; clearTimeout(timer) }
  }, [thumbsJoined]) // eslint-disable-line react-hooks/exhaustive-deps

  // Per-file hydration status (local vs offloaded), seeded synchronously from
  // the shared cross-surface cache so a reopen paints the last-known cloud
  // icons on the FIRST frame — no spinner, no work during the slide. A file is
  // only shown as a spinner when it's genuinely unknown (never checked).
  const [localStatus, setLocalStatus] = useState<Record<string, boolean>>(
    () => getCachedHydration([...folder.videos, ...folder.thumbnails]),
  )
  const allJoined = [...folder.videos, ...folder.thumbnails].join('|')
  useEffect(() => {
    const all = [...folder.videos, ...folder.thumbnails]
    if (all.length === 0) return
    // Paint cached status immediately (covers switching streams without
    // closing — the mount-time seed above only fires once).
    const cached = getCachedHydration(all)
    if (Object.keys(cached).length) setLocalStatus(prev => ({ ...prev, ...cached }))
    // Then refresh in the background, DEFERRED past the sidebar slide:
    // checkLocalFiles' reply lands at a variable (OS-attribute-read) latency,
    // and the resulting whole-grid re-render stutters the open animation if it
    // hits mid-slide. Wait until the panel has settled, then check ONLY the
    // paths whose cached status is missing or older than the shared TTL —
    // another surface (the video-counter tooltip, a previous open) may have
    // just verified them, and re-verifying fresh entries is wasted IPC. The
    // result is written back to the shared cache. duration() is 0 when
    // animations are off, so this is a no-op delay in that case.
    let cancelled = false
    const timer = setTimeout(() => {
      const toCheck = stalePaths(all)
      if (toCheck.length === 0) return
      window.api.checkLocalFiles(toCheck).then(flags => {
        if (cancelled) return
        const updates: Record<string, boolean> = {}
        toCheck.forEach((p, i) => { updates[p] = !!flags[i] })
        rememberHydration(updates)
        setLocalStatus(prev => ({ ...prev, ...updates }))
      }).catch(() => {})
    }, anim.duration(230))
    return () => { cancelled = true; clearTimeout(timer) }
  }, [allJoined]) // eslint-disable-line react-hooks/exhaustive-deps

  // Mirror shared-cache status CHANGES into this grid's state while mounted —
  // a hydration completed anywhere (send-to-player, the player page, another
  // surface's check) flips the icons live instead of waiting for a reopen.
  useEffect(() => {
    const mine = new Set([...folder.videos, ...folder.thumbnails])
    return subscribeHydration((path, isLocal) => {
      if (!mine.has(path)) return
      setLocalStatus(prev => prev[path] === isLocal ? prev : { ...prev, [path]: isLocal })
    })
  }, [allJoined]) // eslint-disable-line react-hooks/exhaustive-deps

  // …then flipped as cloud ops for our files reach a terminal state, so the
  // button/icon update without a folder rescan.
  useEffect(() => {
    // Cache writes OUTSIDE the state updater: rememberHydrationOne
    // notifies subscribers synchronously (VideoCountTooltip setStates in
    // its listener), and React can run updaters during another
    // component's render — doing the write inside the updater produced
    // "Cannot update VideoCountTooltip while rendering StreamFilesGrid".
    // Unconditional per completed item; the cache is global truth by
    // path, so re-remembering an already-known status is a no-op.
    for (const it of offloadItems) {
      if (it.status === 'done' || it.status === 'already-offline') rememberHydrationOne(it.path, false)
    }
    for (const it of hydrateItems) {
      if (it.status === 'done' || it.status === 'already-local') rememberHydrationOne(it.path, true)
    }
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
    // Deferred past the slide too — the archived badge isn't needed during the
    // open animation, and its reply would otherwise re-render the grid mid-slide.
    const timer = setTimeout(() => {
      window.api.checkAlreadyArchived(folder.videos)
        .then(paths => { if (!cancelled) setArchivedSet(new Set(paths)) })
        .catch(() => {})
    }, anim.duration(230))
    return () => { cancelled = true; clearTimeout(timer) }
  }, [folder.videos.join('|')]) // eslint-disable-line react-hooks/exhaustive-deps

  const sizeOf = (path: string): number => {
    return videoMap[videoMapKey(folder.folderPath, path)]?.size ?? imageSizes[path] ?? 0
  }
  // Per-file actions surface via the widget/icons only — don't pop the modal.
  const offloadFile = (path: string) => enqueueOffload([{ path, size: sizeOf(path) }], false)
  const pinFile = (path: string) => enqueueHydrate([{ path, size: sizeOf(path) }], false)

  // ── Multi-select ──────────────────────────────────────────────────────────
  // Collapsed = just the header line with a file-count summary. One GLOBAL
  // mode (not per-stream), persisted: the point is stable field positions
  // while rapid-navigating items — the grid's variable height pushed the
  // fields below up and down. localStorage per the UI-pref pattern.
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('filesGridCollapsed') === 'true')
  const setCollapsedPersist = (next: boolean) => {
    setCollapsed(next)
    localStorage.setItem('filesGridCollapsed', String(next))
  }
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const lastClickedRef = useRef<string | null>(null)
  // Visible files in display order (videos then images, honoring the filters) —
  // the order a shift-click range walks.
  const visiblePaths = useMemo(
    () => [...(showVideo ? folder.videos : []), ...(showImage ? folder.thumbnails : [])],
    [showVideo, showImage, folder.videos, folder.thumbnails],
  )
  useEffect(() => { setSelectMode(false); setSelected(new Set()); lastClickedRef.current = null }, [folder.folderPath])
  const toggleSelect = (path: string, shiftKey: boolean) => {
    // Capture the anchor BEFORE queueing the update and BEFORE moving the
    // ref. React only runs setState updaters eagerly when the queue is
    // clean — when it defers them, a ref read inside the updater sees the
    // reassignment below (anchor === path) and the range collapses to a
    // plain toggle. That's exactly the "range works once, then never
    // again" flakiness.
    const anchor = lastClickedRef.current
    lastClickedRef.current = path
    setSelected(prev => {
      const next = new Set(prev)
      if (shiftKey && anchor && anchor !== path) {
        const a = visiblePaths.indexOf(anchor)
        const b = visiblePaths.indexOf(path)
        if (a !== -1 && b !== -1) {
          const [lo, hi] = a < b ? [a, b] : [b, a]
          for (let i = lo; i <= hi; i++) next.add(visiblePaths[i])
        } else if (next.has(path)) { next.delete(path) } else { next.add(path) }
      } else if (next.has(path)) { next.delete(path) } else { next.add(path) }
      return next
    })
  }
  const clearSelection = () => { setSelected(new Set()); lastClickedRef.current = null }
  const exitSelectMode = () => { setSelectMode(false); clearSelection() }
  // Shift/Ctrl-click on a card outside select mode: quick entry — enter
  // select mode with that file selected and anchored for shift-ranges.
  const enterSelectWith = (path: string) => {
    setSelectMode(true)
    setSelected(new Set([path]))
    lastClickedRef.current = path
  }

  // Drag-select (mirrors the stream rows): mousedown seeds the anchor + a
  // snapshot of the selection and whether we're adding or removing; mouseenter
  // on other cards extends the range; a global mouseup ends it. dragMoved makes
  // the click handler ignore the synthetic click fired at the end of a drag.
  const isDragging = useRef(false)
  const dragStartIndex = useRef<number | null>(null)
  const dragStartPath = useRef<string | null>(null)
  const dragAction = useRef<'add' | 'remove'>('add')
  const preDragRef = useRef<Set<string>>(new Set())
  const dragMoved = useRef(false)
  const startDrag = (path: string) => {
    const index = visiblePaths.indexOf(path)
    if (index === -1) return
    isDragging.current = true
    dragStartIndex.current = index
    dragStartPath.current = path
    dragAction.current = selected.has(path) ? 'remove' : 'add'
    preDragRef.current = new Set(selected)
    dragMoved.current = false
    // Deliberately NOT touching lastClickedRef here: mousedown fires
    // before the click that needs the PREVIOUS anchor, so seeding it
    // with the current card made every shift-click range collapse into
    // a plain toggle. The anchor moves in toggleSelect (plain clicks)
    // and at drag end (global mouseup below) instead.
  }
  const updateDrag = (path: string) => {
    if (!isDragging.current || dragStartIndex.current === null) return
    const index = visiblePaths.indexOf(path)
    if (index === -1) return
    dragMoved.current = true
    const lo = Math.min(dragStartIndex.current, index)
    const hi = Math.max(dragStartIndex.current, index)
    setSelected(() => {
      const next = new Set(preDragRef.current)
      for (let i = lo; i <= hi; i++) {
        if (dragAction.current === 'add') next.add(visiblePaths[i]); else next.delete(visiblePaths[i])
      }
      return next
    })
  }
  const handleCardClick = (path: string, shiftKey: boolean) => {
    if (dragMoved.current) { dragMoved.current = false; return }
    toggleSelect(path, shiftKey)
  }
  useEffect(() => {
    const onUp = () => {
      if (isDragging.current && dragMoved.current) {
        // A completed drag re-anchors future shift-ranges at its start card.
        lastClickedRef.current = dragStartPath.current
      }
      isDragging.current = false
      // Clear the click-swallow latch even when the drag ended off-card
      // (grid gap, outside the grid) and no click ever fired — a latched
      // dragMoved silently ate the NEXT legitimate card click, which is
      // exactly the "sometimes shift-select just doesn't work" flakiness.
      // The synthetic click after an on-card drag dispatches before this
      // timeout, so the normal swallow still works.
      if (dragMoved.current) setTimeout(() => { dragMoved.current = false }, 0)
    }
    document.addEventListener('mouseup', onUp)
    return () => document.removeEventListener('mouseup', onUp)
  }, [])

  // Imperative handle so the streams-page keyboard shortcuts can drive the
  // files-grid selection when the detail sidebar is open: Ctrl+Shift+A toggles
  // mode, Ctrl+A selects-all / clears.
  useImperativeHandle(ref, () => ({
    toggleSelectMode: () => {
      // Ctrl+Shift+A on a collapsed grid: expand INTO select mode rather
      // than toggling selection on a grid the user can't see.
      if (collapsed) { setCollapsedPersist(false); setSelectMode(true); return }
      if (selectMode) exitSelectMode()
      else setSelectMode(true)
    },
    selectAllOrClear: () => setSelected(prev => {
      const allSelected = visiblePaths.length > 0 && visiblePaths.every(p => prev.has(p))
      return allSelected ? new Set() : new Set(visiblePaths)
    }),
    isSelectMode: () => selectMode,
  }), [selectMode, visiblePaths, collapsed]) // eslint-disable-line react-hooks/exhaustive-deps

  const selectedPaths = useMemo(() => visiblePaths.filter(p => selected.has(p)), [visiblePaths, selected])
  // Ctrl+A toggles (select all ↔ clear when complete) via selectAllOrClear
  // above — the chip sits on whichever button the key would trigger, same
  // as the stream-row toolbar. Must mirror selectAllOrClear's predicate.
  const allVisibleSelected = visiblePaths.length > 0 && selectedPaths.length === visiblePaths.length
  const selectedVideos = useMemo(() => selectedPaths.filter(p => folder.videos.includes(p)), [selectedPaths, folder.videos])
  // Unexported clip drafts grouped by their source video's filename, newest
  // first — drives the per-card scissors badge. Data is already in meta;
  // drafts whose source file is gone simply have no card to badge.
  const draftsByVideo = useMemo(() => {
    const map = new Map<string, ClipDraft[]>()
    for (const d of Object.values(folder.meta?.clipDrafts ?? {})) {
      const list = map.get(d.sourceName) ?? []
      list.push(d)
      map.set(d.sourceName, list)
    }
    for (const list of map.values()) list.sort((a, b) => b.updatedAt - a.updatedAt)
    return map
  }, [folder.meta?.clipDrafts])
  const bulkConvert = () => { if (selectedVideos.length) { onSendFilesToConverter(selectedVideos); clearSelection() } }
  const bulkCombine = () => { if (selectedVideos.length) { onSendFilesToCombine(selectedVideos); clearSelection() } }
  const bulkOffload = () => { enqueueOffload(selectedPaths.map(p => ({ path: p, size: sizeOf(p) })), false); clearSelection() }
  const bulkPin = () => { enqueueHydrate(selectedPaths.map(p => ({ path: p, size: sizeOf(p) })), false); clearSelection() }
  const selectedHasBlocked = useMemo(() => selectedPaths.some(p => fileReason(p)), [selectedPaths, fileReason])
  const bulkTrash = async () => {
    const deleted: string[] = []
    // Release in-flight thumbnail decodes only for the files that will
    // actually be trashed — cancelling one for a kept (in-use) file would
    // leave its card thumbless until remount.
    releaseThumbDecodes(selectedPaths.filter(p => !fileReason(p)))
    for (const p of selectedPaths) {
      // Skip anything that's in use — open in the player/thumbnail editor, or
      // (authoritative re-check) still held by the converter; the rest of the
      // selection is deleted normally.
      if (fileReason(p)) continue
      if (await window.api.isPathInUseByConverter(p).catch(() => false)) continue
      // Only successfully-trashed files leave the grid.
      try { await window.api.trashFile(p); deleted.push(p) } catch { /* keep */ }
    }
    clearSelection()
    if (deleted.length) onFilesDeleted(deleted)
  }

  if (!hasVideos && !hasImages) return null

  // Collapsed: a single constant-height line — chevron + file-count summary —
  // so the fields below sit in the same place on every stream item. Counts
  // mirror the tag-border classes: recordings ('full'), clips, shorts, SM
  // thumbnails vs other images, plus unexported clip drafts.
  const plural = (n: number, word: string) => `${n} ${word}${n !== 1 ? 's' : ''}`
  const draftCount = Object.keys(folder.meta?.clipDrafts ?? {}).length
  let recordings = 0, clips = 0, shorts = 0, unknownVideos = 0
  for (const p of folder.videos) {
    const entry = videoMap[videoMapKey(folder.folderPath, p)]
    if (entry?.category === 'short') shorts++
    else if (entry?.category === 'clip' || entry?.clipOf) clips++
    else if (entry?.category === 'full') recordings++
    else unknownVideos++
  }
  const smThumbs = folder.thumbnails.filter(p => parseSmThumbnailOrdinal(p) != null).length
  const otherImages = folder.thumbnails.length - smThumbs
  const collapsedSummary = [
    recordings > 0 ? plural(recordings, 'recording') : null,
    clips > 0 ? plural(clips, 'clip') : null,
    shorts > 0 ? plural(shorts, 'short') : null,
    unknownVideos > 0 ? plural(unknownVideos, 'video') : null,
    smThumbs > 0 ? plural(smThumbs, 'thumbnail') : null,
    otherImages > 0 ? plural(otherImages, 'image') : null,
    draftCount > 0 ? plural(draftCount, 'clip draft') : null,
  ].filter(Boolean).join(' · ')

  if (collapsed) {
    return (
      <div className="flex items-center gap-1.5">
        <Tooltip content="Expand the files grid" side="top">
          <button onClick={() => setCollapsedPersist(false)} className={COLLAPSE_BTN}>
            <ChevronRight size={14} />{ZWSP}
          </button>
        </Tooltip>
        <span className="text-[11px] text-gray-400">{collapsedSummary}</span>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5 flex-wrap">
        <Tooltip content="Collapse the files grid" side="top">
          <button
            onClick={() => { if (selectMode) exitSelectMode(); setCollapsedPersist(true) }}
            className={COLLAPSE_BTN}
          >
            <ChevronDown size={14} />{ZWSP}
          </button>
        </Tooltip>
        {hasVideos && hasImages && (
          <>
            <Tooltip content={showVideo ? 'Hide video files' : 'Show video files'} side="top">
              <FilterToggle active={showVideo} onClick={() => setShowVideo(v => !v)} icon={<Film size={12} />} label={`Video ${folder.videos.length}`} />
            </Tooltip>
            <Tooltip content={showImage ? 'Hide image files' : 'Show image files'} side="top">
              <FilterToggle active={showImage} onClick={() => setShowImage(v => !v)} icon={<ImageIcon size={12} />} label={`Images ${folder.thumbnails.length}`} />
            </Tooltip>
          </>
        )}
        <div className="ml-auto flex items-center gap-0.5 flex-wrap">
          {!selectMode ? (
            <Tooltip content="Select multiple files for bulk actions" side="top" shortcut="Ctrl+Shift+A">
              <button onClick={() => setSelectMode(true)} className={ACTION_GRAY}><ListChecks size={12} /> Select</button>
            </Tooltip>
          ) : (
            <>
              <span className="text-[11px] text-gray-400 mr-1">{selectedPaths.length} selected</span>
              {selectedVideos.length > 0 && (
                <>
                  <Tooltip content="Send selected to converter" side="top">
                    <button onClick={bulkConvert} className={ACTION_GREEN}><Zap size={12} /> Convert</button>
                  </Tooltip>
                  <Tooltip content="Send selected to combine" side="top">
                    <button onClick={bulkCombine} className={ACTION_PURPLE}><Combine size={12} /> Combine</button>
                  </Tooltip>
                </>
              )}
              {cloudSyncActive && selectedPaths.length > 0 && (
                <>
                  <Tooltip content="Offload selected to cloud" side="top">
                    <button onClick={bulkOffload} className={ACTION_PINK}><Cloud size={12} /></button>
                  </Tooltip>
                  <Tooltip content="Pin selected on this device" side="top">
                    <button onClick={bulkPin} className={ACTION_CYAN}><CloudDownload size={12} /></button>
                  </Tooltip>
                </>
              )}
              {selectedPaths.length > 0 && (
                <Tooltip content={selectedHasBlocked ? 'Move selected to recycle bin (skips files in use)' : 'Move selected to recycle bin'} side="top">
                  <button onClick={bulkTrash} className={ACTION_RED}><Trash2 size={12} /></button>
                </Tooltip>
              )}
              {/* Selection management + exit — grouped with dividers so they
                  wrap together, mirroring the stream-row toolbar. */}
              <div className="flex items-center gap-0.5">
                <div className="w-px h-5 bg-white/10 mx-1 self-center" />
                <Tooltip content="Select all visible files" side="top" shortcut={allVisibleSelected ? undefined : 'Ctrl+A'}>
                  <button
                    onClick={() => setSelected(new Set(visiblePaths))}
                    disabled={selectedPaths.length === visiblePaths.length}
                    className={`${ACTION_GRAY} disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-gray-400`}
                  >
                    <CheckCheck size={12} /> Select all
                  </button>
                </Tooltip>
                <Tooltip content="Clear current selection" side="top" shortcut={allVisibleSelected ? 'Ctrl+A' : undefined}>
                  <button
                    onClick={clearSelection}
                    disabled={selectedPaths.length === 0}
                    className={`${ACTION_GRAY} disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-gray-400`}
                  >
                    <Square size={12} /> Clear
                  </button>
                </Tooltip>
                <div className="w-px h-5 bg-white/10 mx-1 self-center" />
                <Tooltip content="Exit selection mode" side="top" shortcut="Ctrl+Shift+A">
                  <button onClick={exitSelectMode} className={ACTION_GRAY}><X size={12} /> Stop</button>
                </Tooltip>
              </div>
            </>
          )}
        </div>
      </div>
      <div className="grid gap-3 max-h-[318px] overflow-y-auto p-1" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 340px), 1fr))' }}>
        {showVideo && folder.videos.map(path => {
          const entry = videoMap[videoMapKey(folder.folderPath, path)]
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
              selectMode={selectMode}
              selected={selected.has(path)}
              highlighted={ringPath === path}
              onSelectToggle={(shiftKey) => handleCardClick(path, shiftKey)}
              onDragStart={() => startDrag(path)}
              onDragEnter={() => updateDrag(path)}
              onSendToPlayer={onSendToPlayer}
              onSendToConverter={onSendToConverter}
              onOffload={offloadFile}
              onPin={pinFile}
              onDeleted={() => onFilesDeleted([path])}
              blockReason={fileReason(path)}
              drafts={draftsByVideo.get(path.split(/[\\/]/).pop() ?? '')}
              onModifierSelect={() => enterSelectWith(path)}
            />
          )
        })}
        {showImage && folder.thumbnails.map((path, i) => {
          const name = path.split(/[\\/]/).pop() ?? ''
          // Match main-side pickDisplayed: a preferredThumbnail that no longer
          // names an existing file falls back to the first thumbnail, which is
          // what actually gets displayed and protected from offloading.
          const prefExists = !!preferredThumbnail &&
            folder.thumbnails.some(p => (p.split(/[\\/]/).pop() ?? '') === preferredThumbnail)
          const isPreferred = prefExists ? name === preferredThumbnail : i === 0
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
              selectMode={selectMode}
              selected={selected.has(path)}
              onSelectToggle={(shiftKey) => handleCardClick(path, shiftKey)}
              onDragStart={() => startDrag(path)}
              onDragEnter={() => updateDrag(path)}
              onSetThumbnail={onSetThumbnail}
              onDeleteThumbnail={onDeleteThumbnail}
              onEditThumbnail={onEditThumbnail}
              onOpenLightbox={onOpenLightbox}
              onOffload={offloadFile}
              onPin={pinFile}
              blockReason={fileReason(path)}
              onModifierSelect={() => enterSelectWith(path)}
            />
          )
        })}
      </div>
    </div>
  )
})

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
