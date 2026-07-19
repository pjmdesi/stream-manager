import React, { useEffect, useState } from 'react'
import { CloudCheck, Cloud, Loader2 } from 'lucide-react'
import { VideoThumb } from './VideoThumb'
import { Tooltip } from './Tooltip'
import type { VideoEntry, VideoInfo } from '../../types'

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

// Module-level probe memo: the video-count tooltip remounts its rows on every
// hover, and each remount re-spawned ffprobe for entries with no duration.
// One probe per path per session — failures cached too, since a file that
// can't be probed now won't probe better on the next hover.
const probeCache = new Map<string, VideoInfo | null>()
const probeInFlight = new Map<string, Promise<VideoInfo | null>>()
function probeOnce(path: string): Promise<VideoInfo | null> {
  if (probeCache.has(path)) return Promise.resolve(probeCache.get(path) ?? null)
  let p = probeInFlight.get(path)
  if (!p) {
    p = window.api.probeFile(path).catch(() => null).then(info => {
      probeCache.set(path, info)
      probeInFlight.delete(path)
      return info
    })
    probeInFlight.set(path, p)
  }
  return p
}

const CAT_LABEL: Record<string, string> = { full: 'VID', short: 'SHORT', clip: 'CLIP' }
const CAT_STYLE: Record<string, string> = {
  full: 'text-gray-300 border-gray-500/40',
  short: 'text-blue-300 border-blue-400/40',
  clip: 'text-pink-300 border-pink-400/40',
}

export interface VideoRowProps {
  path: string
  /** Display label override (e.g. a nested relKey path); defaults to the basename. */
  displayName?: string
  /** Metadata from _meta.json videoMap, when known (may be partial). */
  entry?: Partial<VideoEntry>
  /** Hydration: true = local, false = offloaded, undefined = still checking (spinner). */
  isLocal?: boolean
  cloudSyncActive: boolean
  /** Highlighted as the active/current item (player). */
  active?: boolean
  /** Nested under a parent (player clip nesting). */
  indented?: boolean
  /** Tiny icon-only row for the collapsed sidebar — full info moves to the tooltip. */
  compact?: boolean
  /** Player session panel: this file's cloud download is in progress —
   *  the hydration icon becomes a spinner and the tooltip says so. */
  hydrating?: boolean
  /** Player session panel: the download just finished — pulsing-ring
   *  callout (same signifier as the Settings save button) until opened. */
  justHydrated?: boolean
  /** Clicking an offloaded row starts its download (player session panel) —
   *  switches the offloaded tooltip line to an actionable hint. */
  clickDownloads?: boolean
  onClick?: () => void
}

/**
 * VideoRow — one stream-video list row, shared by the streams video-counter
 * tooltip and the player's Session Videos sidebar. Shows a cached thumbnail
 * (VideoThumb), the filename, an encoding/timecode/size metadata line, the
 * category, and hydration status. Pass `onClick` for row interaction (open in
 * explorer from the tooltip; load into the player from the sidebar).
 */
export function VideoRow({
  path, displayName, entry, isLocal, cloudSyncActive,
  active = false, indented = false, compact = false,
  hydrating = false, justHydrated = false, clickDownloads = false, onClick,
}: VideoRowProps) {
  const name = displayName ?? (path.split(/[\\/]/).pop() ?? path)

  // Lazy-probe to fill duration/dims/codec when the videoMap entry lacks them.
  // Only for confirmed-local files (probing a placeholder would hydrate it) and
  // only when something's actually missing — a no-op for already-scanned files.
  const [probed, setProbed] = useState<VideoInfo | null>(null)
  const needsProbe = isLocal === true && entry?.duration == null
  useEffect(() => {
    if (!needsProbe) { setProbed(null); return }
    let cancelled = false
    void probeOnce(path).then(info => { if (!cancelled && info) setProbed(info) })
    return () => { cancelled = true }
  }, [path, needsProbe])

  const duration = entry?.duration ?? probed?.duration
  const width = entry?.width ?? probed?.width
  const height = entry?.height ?? probed?.height
  const fps = entry?.fps ?? probed?.fps
  const codec = entry?.codec ?? probed?.videoCodec
  const size = entry?.size
  const category = entry?.category
  const isClipKind = category === 'short' || category === 'clip'

  const metaParts: string[] = []
  if (duration != null) metaParts.push(formatTimecode(duration))
  if (width && height) metaParts.push(`${width}×${height}`)
  const enc = [codec?.toUpperCase(), fps ? `${Math.round(fps)}fps` : null].filter(Boolean).join(' ')
  if (enc) metaParts.push(enc)
  if (size != null) metaParts.push(formatBytes(size))
  const metaLine = metaParts.join('  ·  ') || (isLocal === false ? 'Offloaded' : '…')

  const cloudIcon = !cloudSyncActive ? null
    : hydrating ? <Loader2 size={12} className="shrink-0 text-cyan-300 animate-spin" />
    : isLocal === undefined ? <Loader2 size={12} className="shrink-0 text-gray-400 animate-spin" />
    : isLocal ? <CloudCheck size={12} className="shrink-0 text-gray-400" />
    : <Cloud size={12} className="shrink-0 text-gray-500" />

  const indent = indented ? (compact ? 'pl-3 pr-1' : 'pl-6 pr-2') : (compact ? 'px-1' : 'px-2')
  const row = (
    <div
      onClick={onClick}
      className={`group/vrow flex items-center gap-2.5 ${indent} py-1.5 rounded-lg transition-colors ${onClick ? 'cursor-pointer' : ''} ${
        active ? 'bg-purple-600/20' : 'hover:bg-white/5'
      }${justHydrated ? ' save-attention' : ''}`}
    >
      <VideoThumb path={path} height={compact ? 22 : 34} checker={isClipKind} rounded="rounded" />
      {!compact && (
        <>
          <div className="min-w-0 flex-1">
            <div className={`text-[11px] font-medium truncate leading-tight ${active ? 'text-purple-200' : 'text-gray-200'}`}>{name}</div>
            <div className="flex items-center gap-1.5 mt-0.5 min-w-0">
              {category && (
                <span className={`shrink-0 inline-block text-[9px] font-mono border rounded px-1 leading-tight ${CAT_STYLE[category] ?? ''}`}>
                  {CAT_LABEL[category] ?? category}
                </span>
              )}
              <span className="text-[10px] text-gray-400 tabular-nums truncate">{metaLine}</span>
            </div>
          </div>
          {cloudIcon}
        </>
      )}
    </div>
  )

  // Tooltip carries the FULL metadata set (name, category, duration, dims,
  // codec/fps, size, cloud status) — the inline line truncates in a narrow
  // panel, so hover must be the complete surface, matching what the streams
  // page files grid shows for the same file.
  const cloudText = !cloudSyncActive ? null
    : hydrating ? 'Downloading from cloud…'
    : isLocal === undefined ? null
    : isLocal ? (justHydrated ? 'Downloaded — click to open' : 'Available on this device')
    : clickDownloads ? 'Click to download this file' : 'Offloaded to the cloud'
  const tipMeta = [
    category ? (CAT_LABEL[category] ?? category) : null,
    metaLine,
    cloudText,
  ].filter(Boolean).join('  ·  ')
  const tip = (
    <span className="block">
      <span className="block font-medium break-all">{name}</span>
      {tipMeta && <span className="block text-gray-400 tabular-nums mt-0.5">{tipMeta}</span>}
    </span>
  )
  return (
    <Tooltip content={tip} side={compact ? 'right' : 'left'} triggerClassName="block">
      {row}
    </Tooltip>
  )
}
