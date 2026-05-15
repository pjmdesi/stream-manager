import React, { useRef, useCallback, useEffect, useState, useMemo } from 'react'
import { Play, Pause, FolderOpen, Info, Layers, Check, RotateCcw, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, ChevronDown, Camera, X, Loader2, Scissors, Crop, AudioWaveform, VolumeX, Upload, ZoomIn, Tv2, Lock, Unlock, Repeat, PlusSquare, PencilLine, Trash2, GitMerge, Film } from 'lucide-react'
import { v4 as uuidv4 } from 'uuid'
import { useConversionJobs } from '../../context/ConversionContext'
import { useStore } from '../../hooks/useStore'
import type { BleepRegion, ClipRegion, ClipState, CropAspect, TimelineViewport } from '../../types'
import { useVideoPlayer } from '../../hooks/useVideoPlayer'
import { useThumbnailStrip } from '../../hooks/useThumbnailStrip'
import { useWaveform } from '../../hooks/useWaveform'
import { FileDropZone } from '../ui/FileDropZone'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'
import { Tooltip } from '../ui/Tooltip'
import { Checkbox } from '../ui/Checkbox'

/** Given an absolute file path and the streams root, find the file's stream
 *  folder and the canonical key used in _meta.json:
 *  - In folder-per-stream mode (any depth): walks up from the file's parent
 *    to the first date-named ancestor; key = relative path from streamsRoot.
 *  - In dump mode (no date-named ancestor): key = the date in the filename.
 *  Falls back to bare basename if everything else fails. */
function resolveStreamContext(filePath: string, streamsRoot: string | undefined): {
  dir: string         // stream folder path (or file's parent in dump mode)
  metaKey: string     // canonical _meta.json key
  streamsDir: string  // normalized streams root
  isDump: boolean     // true when dir is the streams root (no date-named ancestor)
  date: string | null // date in dump mode, used to scope sibling listing
} {
  const DATE_FOLDER_RE = /^\d{4}-\d{2}-\d{2}(-\d+)?$/
  const streamsDir = (streamsRoot || '').replace(/[\\/]+$/, '')
  const fpNorm = filePath.replace(/\\/g, '/')
  const rootNorm = streamsDir.replace(/\\/g, '/')
  let dirNorm = fpNorm.slice(0, fpNorm.lastIndexOf('/'))
  // Walk up looking for a date-named ancestor (folder-per-stream layouts).
  while (
    rootNorm &&
    dirNorm.length > rootNorm.length &&
    !DATE_FOLDER_RE.test(dirNorm.slice(dirNorm.lastIndexOf('/') + 1))
  ) {
    dirNorm = dirNorm.slice(0, dirNorm.lastIndexOf('/'))
  }
  const ancestorName = dirNorm.slice(dirNorm.lastIndexOf('/') + 1)
  if (DATE_FOLDER_RE.test(ancestorName) && rootNorm && dirNorm.startsWith(rootNorm + '/')) {
    return {
      dir: dirNorm.replace(/\//g, '\\'),
      metaKey: dirNorm.slice(rootNorm.length + 1),
      streamsDir,
      isDump: false,
      date: null,
    }
  }
  // Dump mode (or no date-named ancestor) — derive the key from the filename.
  const fileName = fpNorm.slice(fpNorm.lastIndexOf('/') + 1)
  const m = fileName.match(/(\d{4}-\d{2}-\d{2})/)
  const dateKey = m ? m[1] : fileName.split('.')[0]
  // dir for dump mode = the file's actual parent (the dump dir itself).
  const parentDir = filePath.slice(0, Math.max(filePath.lastIndexOf('\\'), filePath.lastIndexOf('/')))
  return {
    dir: parentDir,
    metaKey: dateKey,
    streamsDir,
    isDump: true,
    date: m ? m[1] : null,
  }
}

function formatTime(seconds: number, fps?: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  const frameStr = fps != null ? ':' + String(Math.floor((seconds % 1) * fps)).padStart(2, '0') : ''
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}${frameStr}`
  return `${m}:${String(s).padStart(2, '0')}${frameStr}`
}

function segmentStep(segIndexFromRight: number, fps?: number): number {
  if (fps) {
    switch (segIndexFromRight) {
      case 0: return 1 / fps  // frames
      case 1: return 1        // seconds
      case 2: return 60       // minutes
      default: return 3600    // hours
    }
  }
  switch (segIndexFromRight) {
    case 0: return 1    // seconds
    case 1: return 60   // minutes
    default: return 3600 // hours
  }
}

function segmentAtCursor(value: string, cursorPos: number): { index: number; start: number; end: number } {
  const parts = value.split(':')
  let pos = 0
  for (let i = 0; i < parts.length; i++) {
    const end = pos + parts[i].length
    if (cursorPos <= end) return { index: i, start: pos, end }
    pos = end + 1
  }
  const last = parts.length - 1
  return { index: last, start: pos - parts[last].length - 1, end: pos - 1 }
}

function parseTimecode(input: string, fps?: number): number | null {
  const parts = input.trim().split(':').map(Number)
  if (parts.some(isNaN)) return null
  if (parts.length === 4) {
    // H:MM:SS:FF
    const [h, m, s, f] = parts
    return h * 3600 + m * 60 + s + (fps ? f / fps : 0)
  }
  if (parts.length === 3) {
    if (fps != null) {
      // With fps, 3-part format is MM:SS:FF (formatTime never emits H:MM:SS when fps is known)
      const [m, s, f] = parts
      return m * 60 + s + f / fps
    }
    // Without fps, 3-part format is H:MM:SS
    const [h, m, s] = parts
    return h * 3600 + m * 60 + s
  }
  if (parts.length === 2) {
    // MM:SS
    const [m, s] = parts
    return m * 60 + s
  }
  if (parts.length === 1) {
    // raw seconds
    return parts[0]
  }
  return null
}

// Like formatTime but always zero-pads every segment so segment widths stay constant.
// Used for viewport range inputs where cursor-position-based stepping must be stable.
function formatViewTime(seconds: number, fps?: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  const frameStr = fps != null ? ':' + String(Math.floor((seconds % 1) * fps)).padStart(2, '0') : ''
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}${frameStr}`
}

/**
 * Handles ArrowUp/ArrowDown in any timecode input.
 * - Reads the current cursor position to determine which segment to step.
 * - Uses fromRight (semantic unit) to restore the cursor even when the format
 *   changes part-count across the 1-hour boundary (e.g. H:MM:SS:FF ↔ MM:SS:FF).
 * - Returns { newValue, newTime } if an arrow key was handled, null otherwise.
 */
function applyTimecodeArrow(
  e: React.KeyboardEvent,
  inputValue: string,
  inputRef: React.RefObject<HTMLInputElement>,
  fps: number | undefined,
  minTime: number,
  maxTime: number,
): { newValue: string; newTime: number } | null {
  if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return null
  e.preventDefault()
  const cursorPos = inputRef.current?.selectionStart ?? 0
  const parts = inputValue.split(':')
  const { index: segIdx } = segmentAtCursor(inputValue, cursorPos)
  const fromRight = parts.length - 1 - segIdx
  const step = segmentStep(fromRight, fps)
  const current = parseTimecode(inputValue, fps) ?? 0
  const newTime = Math.max(minTime, Math.min(current + (e.key === 'ArrowUp' ? step : -step), maxTime))
  const newValue = formatViewTime(newTime, fps)
  // Restore cursor to the same semantic segment (by fromRight) in the new string.
  // This keeps the cursor on "minutes" even if the format changes part-count.
  setTimeout(() => {
    const el = inputRef.current
    if (!el) return
    const newParts = newValue.split(':')
    const newSegIdx = Math.max(0, Math.min(newParts.length - 1 - fromRight, newParts.length - 1))
    let pos = 0
    for (let i = 0; i < newSegIdx; i++) pos += newParts[i].length + 1
    el.setSelectionRange(pos, pos + newParts[newSegIdx].length)
  }, 0)
  return { newValue, newTime }
}

/**
 * Returns the free interval [lo, hi] around `anchor` — the gap between the
 * nearest clip regions on each side (or the video boundary). Used to find where
 * a new segment or a dragged segment can be placed without overlap.
 * `excludeId` lets a segment ignore itself during its own drag.
 */
function getSegmentFreeInterval(
  regions: ClipRegion[],
  anchor: number,
  totalDuration: number,
  excludeId?: string,
): { lo: number; hi: number } {
  let lo = 0, hi = totalDuration
  for (const r of regions) {
    if (r.id === excludeId) continue
    if (r.outPoint <= anchor) lo = Math.max(lo, r.outPoint)
    if (r.inPoint > anchor)  hi = Math.min(hi, r.inPoint)
  }
  return { lo, hi }
}

/**
 * Returns the largest free interval [lo, hi] that contains `anchor` and does not
 * overlap any bleep region in `regions` (excluding the one with `excludeId`).
 */
function getBleepFreeInterval(
  regions: BleepRegion[],
  anchor: number,
  totalDuration: number,
  excludeId?: string,
): { lo: number; hi: number } {
  let lo = 0, hi = totalDuration
  for (const r of regions) {
    if (r.id === excludeId) continue
    if (r.end <= anchor) lo = Math.max(lo, r.end)
    if (r.start > anchor) hi = Math.min(hi, r.start)
  }
  return { lo, hi }
}

/** Compute the pixel geometry for the 9:16 crop overlay over an object-contain video. */
/** Convert a CropAspect to a numeric width/height ratio. Returns the video's native ratio for 'original'. */
function aspectRatio(aspect: import('../../types').CropAspect, videoW: number, videoH: number): number {
  if (aspect === '16:9') return 16 / 9
  if (aspect === '9:16') return 9 / 16
  if (aspect === '1:1')  return 1
  return videoW / videoH // 'original' / 'off' — the native ratio
}

function getCropGeometry(
  vcW: number, vcH: number,
  videoW: number, videoH: number,
  cropX: number, cropY: number = 0.5, cropScale: number = 1,
  cropAspectRatio?: number  // width/height; defaults to 9/16 for back-compat with callers that pre-date per-aspect support
) {
  const videoAspect = videoW / videoH
  const containerAspect = vcW / vcH
  let contentW: number, contentH: number, contentLeft: number, contentTop: number
  if (videoAspect > containerAspect) {
    contentW = vcW; contentH = vcW / videoAspect; contentLeft = 0; contentTop = (vcH - contentH) / 2
  } else {
    contentH = vcH; contentW = vcH * videoAspect; contentLeft = (vcW - contentW) / 2; contentTop = 0
  }
  const ar = cropAspectRatio ?? (9 / 16)
  // At scale=1 the crop fits snugly within the content box. Whichever dim is the limit
  // depends on whether the target aspect is wider or taller than the video.
  let maxCropW: number, maxCropH: number
  if (ar > videoAspect) {
    maxCropW = contentW; maxCropH = contentW / ar
  } else {
    maxCropH = contentH; maxCropW = contentH * ar
  }
  const cropW = maxCropW * cropScale
  const cropH = maxCropH * cropScale
  const availableRangeX = Math.max(0, contentW - cropW)
  const availableRangeY = Math.max(0, contentH - cropH)
  const cropLeft = contentLeft + cropX * availableRangeX
  const cropTop  = contentTop  + cropY * availableRangeY
  return { contentLeft, contentTop, contentW, contentH, cropW, cropH, cropLeft, cropTop, availableRangeX, availableRangeY }
}

/** Clamp video pan.
 *  When zoom <= 1 the video is centered in the container.
 *  When zoom > 1 no edge of the video can travel past the center of the container. */
function clampVideoPan(x: number, y: number, zoom: number, w: number, h: number): { x: number; y: number } {
  if (zoom <= 1) return { x: w * (1 - zoom) / 2, y: h * (1 - zoom) / 2 }
  return {
    x: Math.max(w / 2 - w * zoom, Math.min(w / 2, x)),
    y: Math.max(h / 2 - h * zoom, Math.min(h / 2, y)),
  }
}

const TRACK_LABELS = ['Game', 'Mic', 'Discord', 'Music', 'SFX']

// ── Export Clip Dialog ────────────────────────────────────────────────────────

interface ExportClipDialogProps {
  defaultPresetId: string
  defaultSuffix?: string
  filePath: string
  hasBleepsOutsideRegions: boolean
  onConfirm: (opts: ExportClipOptions) => void
  onClose: () => void
}

export interface ExportClipOptions {
  presetId: string
  saveNextToSource: boolean
  outputDir: string
  suffix: string
}

function ExportClipDialog({ defaultPresetId, defaultSuffix, filePath, hasBleepsOutsideRegions, onConfirm, onClose }: ExportClipDialogProps) {
  const [presets, setPresets] = useState<{ id: string; name: string }[]>([])
  const [presetId, setPresetId] = useState(defaultPresetId)
  const [saveNextToSource, setSaveNextToSource] = useState(true)
  const [outputDir, setOutputDir] = useState('')
  const [suffix, setSuffix] = useState(defaultSuffix || '_clip')

  useEffect(() => {
    Promise.all([window.api.getBuiltinPresets(), window.api.getImportedPresets()])
      .then(([b, i]) => setPresets([...b, ...i]))
  }, [])

  const pickDir = async () => {
    const picked = await window.api.openDirectoryDialog()
    if (picked) setOutputDir(picked)
  }

  const sourceDir = filePath.replace(/[\\/][^\\/]+$/, '')

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Export Clip"
      width="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            onClick={() => onConfirm({ presetId, saveNextToSource, outputDir: saveNextToSource ? sourceDir : outputDir, suffix })}
            disabled={!saveNextToSource && !outputDir}
          >
            Export
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {/* Preset */}
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-gray-300">Encoding Preset</label>
          <select
            value={presetId}
            onChange={e => setPresetId(e.target.value)}
            className="w-full appearance-none bg-navy-900 border border-white/10 text-gray-200 text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500/50"
          >
            <option value="">— Copy stream (no re-encode) —</option>
            {presets.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>

        {/* Save location */}
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium text-gray-300">Save Location</label>
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={saveNextToSource}
              onChange={e => setSaveNextToSource(e.target.checked)}
              className="w-4 h-4 rounded accent-purple-500"
            />
            <span className="text-sm text-gray-300">Save next to source</span>
          </label>
          {!saveNextToSource && (
            <>
              <div className="flex gap-2">
                <input
                  className="flex-1 bg-navy-900 border border-white/10 text-gray-200 text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                  value={outputDir}
                  readOnly
                  placeholder="Select output folder…"
                />
                <Button variant="secondary" size="sm" icon={<FolderOpen size={14} />} onClick={pickDir}>
                  Browse
                </Button>
              </div>
              <div className="flex items-start gap-2 bg-yellow-950/40 border border-yellow-600/30 rounded-lg px-3 py-2">
                <span className="text-yellow-400 text-xs mt-0.5">⚠</span>
                <p className="text-xs text-yellow-300/80">
                  Saving outside the source folder means the app won't detect the export as a session video. The draft will stay in the Session Videos panel as a draft instead of being replaced by the exported clip.
                </p>
              </div>
            </>
          )}
          {saveNextToSource && (
            <p className="text-xs text-gray-500 break-all">{sourceDir}</p>
          )}
        </div>

        {/* Suffix */}
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-gray-300">Filename Suffix</label>
          <input
            className="w-full bg-navy-900 border border-white/10 text-gray-200 text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500/50"
            value={suffix}
            onChange={e => setSuffix(e.target.value)}
            placeholder="_clip"
            spellCheck={false}
          />
          <p className="text-xs text-gray-500">Added to the end of the filename before the extension.</p>
        </div>

        {/* Warning: bleeps outside all clip regions */}
        {hasBleepsOutsideRegions && (
          <div className="flex items-start gap-2 bg-yellow-950/40 border border-yellow-600/30 rounded-lg px-3 py-2">
            <span className="text-yellow-400 text-xs mt-0.5">⚠</span>
            <p className="text-xs text-yellow-300/80">Some bleep markers are outside all clip segments and will be ignored during export.</p>
          </div>
        )}
      </div>
    </Modal>
  )
}

// Inject b=AS and b=TIAS bandwidth lines into every m=video section of an SDP.
// This bypasses Chrome's congestion controller, which otherwise starts at
// ~300 kbps and ramps up slowly even on a loopback connection.
function injectSdpBandwidth(sdp: string, bitsPerSec: number): string {
  if (!isFinite(bitsPerSec) || bitsPerSec <= 0) return sdp
  const kbps = Math.floor(bitsPerSec / 1000)
  return sdp.replace(
    /(m=video[^\r\n]*\r?\n)/g,
    `$1b=AS:${kbps}\r\nb=TIAS:${bitsPerSec}\r\n`,
  )
}

function waitForIceComplete(pc: RTCPeerConnection): Promise<void> {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') { resolve(); return }
    const onStateChange = () => {
      if (pc.iceGatheringState === 'complete') {
        pc.removeEventListener('icegatheringstatechange', onStateChange)
        resolve()
      }
    }
    pc.addEventListener('icegatheringstatechange', onStateChange)
    // Safety timeout: 2 s max wait; local connections gather in < 100 ms
    setTimeout(() => { pc.removeEventListener('icegatheringstatechange', onStateChange); resolve() }, 2000)
  })
}

interface PendingFile { path: string; token: number }

// ── Session Videos panel ─────────────────────────────────────────────────────

const SESSION_CATEGORY_LABEL: Record<string, string> = { full: 'vid', short: 'short', clip: 'clip' }
const SESSION_CATEGORY_STYLES: Record<string, string> = {
  full:  'text-purple-400 border-purple-400/50',
  short: 'text-blue-400 border-blue-400/50',
  clip:  'text-gray-400 border-gray-600',
}

const SESSION_VIDEO_EXTS = new Set([
  '.mkv', '.mp4', '.mov', '.avi', '.ts', '.flv', '.webm',
  '.wmv', '.m4v', '.mpg', '.mpeg', '.m2ts', '.mts',
])

interface SiblingFile {
  path: string
  name: string
  isLocal: boolean
  category?: 'full' | 'short' | 'clip'
  fps?: number              // frames per second (from videoMap) — used for timecode display
  clipOf?: string           // source filename if this was produced by the clip exporter
  clipState?: ClipState     // saved clip state for reopening in the editor
}

function SiblingVideoItem({
  item,
  isActive,
  onClick,
  onReopenAsClip,
  indented = false,
}: {
  item: SiblingFile
  isActive: boolean
  onClick: () => void
  onReopenAsClip?: () => void
  indented?: boolean
}) {
  const [thumbnail, setThumbnail] = useState<string | null>(null)
  const [duration, setDuration] = useState<number | null>(null)
  const [aspectRatio, setAspectRatio] = useState<number>(16 / 9)

  useEffect(() => {
    if (!item.isLocal) return
    const videoUrl = `file://${item.path.replace(/\\/g, '/')}`
    const vid = document.createElement('video')
    vid.src = videoUrl
    vid.muted = true
    vid.preload = 'metadata'
    let sought = false

    const cleanup = () => {
      vid.removeEventListener('loadedmetadata', onMeta)
      vid.removeEventListener('seeked', onSeeked)
      vid.removeEventListener('error', onErr)
      vid.src = ''
    }

    const onMeta = () => {
      const dur = vid.duration
      if (isFinite(dur) && dur > 0) {
        setDuration(dur)
        if (vid.videoWidth > 0 && vid.videoHeight > 0) {
          setAspectRatio(vid.videoWidth / vid.videoHeight)
        }
        if (!sought) { sought = true; vid.currentTime = dur * 0.5 }
      } else { cleanup() }
    }

    const onSeeked = () => {
      const vw = vid.videoWidth || 80
      const vh = vid.videoHeight || 45
      const canvas = document.createElement('canvas')
      canvas.height = 45
      canvas.width = Math.round(45 * (vw / vh))
      const ctx = canvas.getContext('2d')
      if (ctx) {
        try {
          ctx.drawImage(vid, 0, 0, canvas.width, canvas.height)
          setThumbnail(canvas.toDataURL('image/jpeg', 0.7))
        } catch { /* decode error */ }
      }
      cleanup()
    }

    const onErr = () => cleanup()

    vid.addEventListener('loadedmetadata', onMeta)
    vid.addEventListener('seeked', onSeeked)
    vid.addEventListener('error', onErr)

    return cleanup
  }, [item.path, item.isLocal])

  const thumbWidth = Math.round(32 * aspectRatio)

  return (
    <div
      onClick={onClick}
      title={item.name}
      className={`group/item w-full text-left flex items-center gap-2 ${indented ? 'pl-6 pr-2' : 'px-2'} py-1.5 rounded-lg transition-colors cursor-pointer ${
        isActive
          ? 'bg-purple-600/20'
          : 'hover:bg-white/5'
      }`}
    >
      {/* Thumbnail */}
      <div className="relative shrink-0 h-8 rounded overflow-hidden bg-white/5" style={{ width: thumbWidth }}>
        {thumbnail ? (
          <img
            src={thumbnail}
            className="w-full h-full object-cover transition-transform duration-200 group-hover/item:scale-110"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-700">
            {item.isLocal
              ? <Film size={11} />
              : <span className="text-[9px] leading-tight text-center px-1 text-gray-600">Cloud</span>
            }
          </div>
        )}
      </div>

      {/* Info */}
      <div className="min-w-0 flex-1">
        <div className={`text-[11px] font-medium truncate leading-tight ${isActive ? 'text-purple-200' : 'text-gray-300'}`}>
          {item.name}
        </div>
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className="text-[10px] text-gray-500 tabular-nums">
            {duration !== null
              ? formatTime(duration)
              : item.isLocal ? '…' : 'Cloud sync'
            }
          </span>
          {item.category && (
            <span className={`inline-block text-[9px] font-mono border rounded px-1 leading-tight ${SESSION_CATEGORY_STYLES[item.category] ?? ''}`}>
              {SESSION_CATEGORY_LABEL[item.category] ?? item.category}
            </span>
          )}
        </div>
      </div>
      {onReopenAsClip && item.clipOf && (
        <Tooltip content="Start new clipping draft based on this clip" side="left" triggerClassName="shrink-0 opacity-0 group-hover/item:opacity-100 transition-opacity">
          <button
            onClick={e => { e.stopPropagation(); onReopenAsClip() }}
            className="p-1 text-blue-400/60 hover:text-blue-300 transition-colors"
          >
            <Scissors size={12} />
          </button>
        </Tooltip>
      )}
    </div>
  )
}

function DraftSessionItem({
  draft,
  displayName,
  sourceFps,
  isActive,
  isExporting,
  onClick,
  onDelete,
  onRename,
}: {
  draft: import('../../types').ClipDraft
  displayName: string
  sourceFps?: number
  isActive: boolean
  isExporting?: boolean
  onClick: () => void
  onDelete: () => void
  onRename: (newName: string) => Promise<boolean>
}) {
  const [editing, setEditing] = useState(false)
  const [draftName, setDraftName] = useState(displayName)
  const [error, setError] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { if (editing) { inputRef.current?.focus(); inputRef.current?.select() } }, [editing])
  useEffect(() => { if (!editing) setDraftName(displayName) }, [displayName, editing])

  const segmentCount = draft.state.clipRegions.length
  const totalDuration = draft.state.clipRegions.reduce((acc, r) => acc + (r.outPoint - r.inPoint), 0)

  const commit = async () => {
    const trimmed = draftName.trim()
    if (!trimmed || trimmed === displayName) { setEditing(false); setError(false); setDraftName(displayName); return }
    const ok = await onRename(trimmed)
    if (!ok) { setError(true); return }
    setError(false)
    setEditing(false)
  }
  const cancel = () => { setDraftName(displayName); setError(false); setEditing(false) }

  return (
    <div
      className={`group/item w-full text-left flex items-center gap-2 pl-6 pr-2 py-1.5 rounded-lg transition-colors ${editing ? '' : isExporting ? 'cursor-not-allowed' : 'cursor-pointer'} ${
        isActive ? 'bg-purple-600/20' : isExporting ? 'opacity-60' : 'hover:bg-white/5'
      }`}
      onClick={editing || isExporting ? undefined : onClick}
      title={editing ? undefined : isExporting ? 'This clip is currently exporting. Wait for the conversion to finish (or cancel it) before editing.' : `Open clip draft for ${draft.sourceName}`}
    >
      <div className="shrink-0 w-8 h-8 rounded flex items-center justify-center bg-blue-950/40 border border-blue-500/20 text-blue-400">
        <Scissors size={14} />
      </div>
      <div className="min-w-0 flex-1" onClick={editing ? e => e.stopPropagation() : undefined}>
        {editing ? (
          <input
            ref={inputRef}
            value={draftName}
            onChange={e => { setDraftName(e.target.value); if (error) setError(false) }}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); commit() }
              else if (e.key === 'Escape') { e.preventDefault(); cancel() }
            }}
            onBlur={commit}
            onClick={e => e.stopPropagation()}
            className={`w-full text-[11px] font-medium bg-navy-900 border rounded px-1.5 py-0.5 text-gray-200 focus:outline-none focus:ring-1 ${
              error ? 'border-red-500/60 focus:ring-red-500/40' : 'border-white/15 focus:ring-purple-500/40'
            }`}
            title={error ? 'Name already in use by another clip draft' : undefined}
            spellCheck={false}
          />
        ) : (
          <div className="flex items-center gap-1 min-w-0">
            <div className={`text-[11px] font-medium truncate leading-tight ${isActive ? 'text-purple-200' : 'text-gray-300'}`}>
              {displayName}
            </div>
            <Tooltip content="Rename draft" side="top" triggerClassName="ml-auto shrink-0 opacity-0 group-hover/item:opacity-100 transition-opacity">
              <button
                onClick={e => { e.stopPropagation(); setEditing(true) }}
                className="p-0.5 text-gray-600 hover:text-gray-300 transition-colors"
              >
                <PencilLine size={11} />
              </button>
            </Tooltip>
          </div>
        )}
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className={`inline-block text-[9px] font-mono border rounded px-1 leading-tight ${isExporting ? 'text-blue-300 border-blue-400/50' : 'text-amber-400 border-amber-400/50'}`}>
            {isExporting ? 'exporting…' : 'draft'}
          </span>
          <span className="text-[10px] text-gray-500 tabular-nums">
            {segmentCount} seg{segmentCount === 1 ? '' : 's'}
            {totalDuration > 0 && ` · ${formatTime(totalDuration, sourceFps)}`}
          </span>
        </div>
      </div>
      {!editing && (
        <Tooltip content="Delete draft" side="left" triggerClassName="shrink-0 opacity-0 group-hover/item:opacity-100 transition-opacity">
          <button
            onClick={e => { e.stopPropagation(); onDelete() }}
            className="p-1 text-gray-600 hover:text-red-400 transition-colors"
          >
            <Trash2 size={12} />
          </button>
        </Tooltip>
      )}
    </div>
  )
}

// Crop aspect dropdown: Off + Original (when video doesn't match a preset) + 16:9 / 1:1 / 9:16
function CropAspectSelector({ value, onChange, videoW, videoH }: {
  value: import('../../types').CropAspect
  onChange: (v: import('../../types').CropAspect) => void
  videoW?: number
  videoH?: number
}) {
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Hide 'Original' if the video's aspect ratio matches one of the presets (within 1%)
  const nativeRatio = videoW && videoH ? videoW / videoH : undefined
  const matchesPreset = nativeRatio !== undefined && (
    Math.abs(nativeRatio - 16/9) < 0.01 ||
    Math.abs(nativeRatio - 1) < 0.01 ||
    Math.abs(nativeRatio - 9/16) < 0.01
  )
  const options: Array<{ value: import('../../types').CropAspect; label: string }> = [
    { value: 'off', label: 'Off' },
    ...(!matchesPreset ? [{ value: 'original' as const, label: 'Original' }] : []),
    { value: '16:9', label: '16:9 Widescreen' },
    { value: '1:1', label: '1:1 Square' },
    { value: '9:16', label: '9:16 Portrait' },
  ]
  const current = options.find(o => o.value === value) ?? options[0]
  const isOn = value !== 'off'

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node
      // Keep open if the click is inside the anchor OR the dropdown itself
      if (anchorRef.current?.contains(target) || dropdownRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  return (
    <div className="relative">
      {/* Tooltip only wraps the button so it doesn't obscure the dropdown when open */}
      {open ? (
        <button
          ref={anchorRef}
          onClick={() => setOpen(false)}
          className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] border transition-colors ${
            isOn
              ? 'text-blue-300 border-blue-400/60 bg-blue-950/60'
              : 'text-gray-400 border-white/20 hover:text-blue-300 hover:border-blue-400/40'
          }`}
        >
          <Crop size={11} /> {isOn ? current.label.replace(/ .*$/, '') : 'Crop'}
          <ChevronDown size={9} className="rotate-180 transition-transform" />
        </button>
      ) : (
        <Tooltip content="Crop aspect ratio">
          <button
            ref={anchorRef}
            onClick={() => setOpen(true)}
            className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] border transition-colors ${
              isOn
                ? 'text-blue-300 border-blue-400/60 bg-blue-950/60'
                : 'text-gray-400 border-white/20 hover:text-blue-300 hover:border-blue-400/40'
            }`}
          >
            <Crop size={11} /> {isOn ? current.label.replace(/ .*$/, '') : 'Crop'}
            <ChevronDown size={9} className="transition-transform" />
          </button>
        </Tooltip>
      )}
      {open && (
        <div ref={dropdownRef} className="absolute bottom-full mb-1 left-0 z-50 bg-navy-800 border border-white/10 rounded-lg shadow-xl overflow-hidden min-w-[150px]">
          {options.map(o => (
            <button
              key={o.value}
              onClick={() => { onChange(o.value); setOpen(false) }}
              className={`w-full text-left px-3 py-1.5 text-[11px] transition-colors ${
                o.value === value ? 'text-blue-300 bg-blue-950/40' : 'text-gray-300 hover:bg-white/5'
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function PlayerPage({ initialFile, onNavigateToConverter }: {
  initialFile?: PendingFile | null
  onNavigateToConverter?: () => void
}) {
  const { config, updateConfig } = useStore()
  const { videoRef, state, loadFile, extractTracks, cancelExtraction, resetExtraction, clearError, closeVideo, seek, fastSeek, togglePlay, audioElements } = useVideoPlayer()
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set())
  const [editingTimecode, setEditingTimecode] = useState(false)
  const [timecodeInput, setTimecodeInput] = useState('')
  const timecodeInputRef = useRef<HTMLInputElement>(null)

  // Clip mode
  const [isClipMode, setIsClipMode] = useState(false)
  const [clipState, setClipState] = useState<ClipState>({
    clipRegions: [],
    cropAspect: 'off' as CropAspect,
    cropX: 0.5,
    bleepRegions: [],
    bleepVolume: config.defaultBleepVolume ?? 0.25,
  })
  // Draft id this clipState is bound to. Null = clip mode entered but no content yet (no draft saved).
  // The draft is created lazily on the first meaningful edit (first clip region / bleep / crop change)
  // and updated on every subsequent change until clip mode is exited or the video is closed.
  const [activeDraftId, setActiveDraftId] = useState<string | null>(null)
  const activeDraftIdRef = useRef<string | null>(null)
  useEffect(() => { activeDraftIdRef.current = activeDraftId }, [activeDraftId])

  // Viewport for zoom/pan — always kept in sync; only applied in clip mode
  const [viewport, setViewport] = useState<TimelineViewport>({ viewStart: 0, viewEnd: 0 })
  const viewportRef = useRef(viewport)
  useEffect(() => { viewportRef.current = viewport }, [viewport])
  const isClipModeRef = useRef(isClipMode)
  useEffect(() => { isClipModeRef.current = isClipMode }, [isClipMode])
  const durationRef = useRef(0)

  // Waveform element ref for non-passive wheel listener
  const waveformStripRef = useRef<HTMLDivElement>(null)

  // Scrollbar element ref for handle drag calculations
  const scrollbarRef = useRef<HTMLDivElement>(null)

  // Viewport range timecode editing
  const [editingVStart, setEditingVStart] = useState(false)
  const [vStartInput, setVStartInput] = useState('')
  const vStartInputRef = useRef<HTMLInputElement>(null)
  const [editingVEnd, setEditingVEnd] = useState(false)
  const [vEndInput, setVEndInput] = useState('')
  const vEndInputRef = useRef<HTMLInputElement>(null)

  // Active handle popup: { regionId, which: 'in'|'out', value }
  const [handlePopup, setHandlePopup] = useState<{ regionId: string; which: 'in' | 'out'; value: string } | null>(null)
  const handlePopupInputRef = useRef<HTMLInputElement>(null)
  // While dragging an in/out handle, the playhead indicator freezes at the pre-drag position
  // so the user can see the frame at the handle without losing track of where they were.
  const [handleDragDisplayTime, setHandleDragDisplayTime] = useState<number | null>(null)
  const handleDragSavedTimeRef = useRef<number>(0)
  const isDraggingHandleRef = useRef<boolean>(false)
  // Duration label editing per region
  const [editingDurationId, setEditingDurationId] = useState<string | null>(null)
  const [durationInput, setDurationInput] = useState('')
  const durationInputRef = useRef<HTMLInputElement>(null)
  // Add-segment error tooltip
  const [addSegmentError, setAddSegmentError] = useState<string | null>(null)
  const stripsWrapperRef = useRef<HTMLDivElement>(null)

  // Video container size — tracked to compute crop overlay geometry
  const [videoContainerEl, setVideoContainerEl] = useState<HTMLDivElement | null>(null)
  const videoContainerRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => { videoContainerRef.current = videoContainerEl }, [videoContainerEl])
  const [vcSize, setVcSize] = useState({ w: 0, h: 0 })
  const vcSizeRef = useRef({ w: 0, h: 0 })
  useEffect(() => {
    if (!videoContainerEl) return
    const update = (w: number, h: number) => { setVcSize({ w, h }); vcSizeRef.current = { w, h } }
    update(videoContainerEl.offsetWidth, videoContainerEl.offsetHeight)
    const ro = new ResizeObserver(e => update(e[0].contentRect.width, e[0].contentRect.height))
    ro.observe(videoContainerEl)
    return () => ro.disconnect()
  }, [videoContainerEl])

  // Video zoom / pan
  const [videoZoom, setVideoZoom] = useState(1)
  const [videoPan, setVideoPan] = useState({ x: 0, y: 0 })
  const videoZoomRef = useRef(1)
  const videoPanRef = useRef({ x: 0, y: 0 })
  const [isVideoPanning, setIsVideoPanning] = useState(false)
  const lastMiddleClickRef = useRef(0)

  // Wheel-to-zoom on the video area
  useEffect(() => {
    const el = videoContainerEl
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      if (e.deltaY === 0) return
      const rect = el.getBoundingClientRect()
      const cx = e.clientX - rect.left
      const cy = e.clientY - rect.top
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15
      const newZoom = Math.max(0.25, Math.min(6, videoZoomRef.current * factor))
      const r = newZoom / videoZoomRef.current
      const { x, y } = videoPanRef.current
      const clamped = clampVideoPan(cx - (cx - x) * r, cy - (cy - y) * r, newZoom, rect.width, rect.height)
      videoZoomRef.current = newZoom
      videoPanRef.current = clamped
      setVideoZoom(newZoom)
      setVideoPan(clamped)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [videoContainerEl])

  // Right panel collapsed state
  const [panelCollapsed, setPanelCollapsed] = useState(false)

  // Session Videos: sibling video files + clip drafts in the same folder
  const [siblingFiles, setSiblingFiles] = useState<SiblingFile[]>([])
  const [folderDrafts, setFolderDrafts] = useState<import('../../types').ClipDraft[]>([])
  const [folderPath, setFolderPath] = useState<string | null>(null)
  // If the currently-loaded video is a known clip output, this holds the info needed for the
  // "New clip from current" action. Null otherwise.
  const [currentVideoClip, setCurrentVideoClip] = useState<{ clipOf: string; clipState: ClipState; sourceExists: boolean } | null>(null)
  const folderPathRef = useRef<string | null>(null)
  useEffect(() => { folderPathRef.current = folderPath }, [folderPath])
  // Canonical _meta.json key for the current stream — needed to disambiguate
  // dump-mode entries where folderPath is the same dump dir for every stream.
  const folderMetaKeyRef = useRef<string | null>(null)
  const folderDraftsRef = useRef<import('../../types').ClipDraft[]>([])
  useEffect(() => { folderDraftsRef.current = folderDrafts }, [folderDrafts])

  const reloadSessionPanel = useCallback(async (fp: string | null) => {
    if (!fp) { setSiblingFiles([]); setFolderDrafts([]); setFolderPath(null); setCurrentVideoClip(null); folderMetaKeyRef.current = null; return }
    // Find the stream folder (date-named ancestor or, in dump mode, derive
    // from filename) and compute the canonical _meta.json key for it.
    const { dir, metaKey, streamsDir, isDump, date } = resolveStreamContext(fp, config.streamsDir)
    const currentName = fp.replace(/.*[\\/]/, '')
    setFolderPath(dir)
    folderMetaKeyRef.current = metaKey
    try {
      // Recursive listing: pull files from sub-folders (clips/, recordings/,
      // exports/, …) so the flat Session Videos panel includes all session
      // content regardless of the user's sub-org layout. In dump mode the dir
      // IS the dump root, so we'd otherwise pull every dated file from every
      // session — filter by the current file's date below.
      const [files, meta] = await Promise.all([
        window.api.listFilesRecursive(dir),
        window.api.readFile(`${streamsDir}/_meta.json`).then(raw => JSON.parse(raw)).catch(() => null),
      ])
      const folderMeta = meta?.[metaKey] ?? {}
      const videoMap: Record<string, { category?: string; fps?: number; clipOf?: string; clipState?: ClipState }> = folderMeta.videoMap ?? {}
      const drafts: Record<string, import('../../types').ClipDraft> = folderMeta.clipDrafts ?? {}
      setFolderDrafts(Object.values(drafts))
      const videoFiles = files
        .filter(f => !f.isDirectory && SESSION_VIDEO_EXTS.has(f.extension.toLowerCase()))
        .filter(f => !isDump || !date || f.name.includes(date))
        .sort((a, b) => a.name.localeCompare(b.name))
      // videoMap keys are forward-slash paths relative to the stream folder.
      // For top-level files this equals the basename; for nested files (e.g.
      // clips/highlight.mp4) it includes the sub-folder. Compute that key
      // for each file so lookups match.
      const dirNormForKey = dir.replace(/\\/g, '/').replace(/\/$/, '')
      const relKey = (absPath: string): string => {
        const p = absPath.replace(/\\/g, '/')
        return p.startsWith(dirNormForKey + '/') ? p.slice(dirNormForKey.length + 1) : p.split('/').pop() ?? p
      }
      const currentRelKey = relKey(fp)
      // Detect whether the currently-loaded file is a known clip output
      const currentEntry = videoMap[currentRelKey] ?? videoMap[currentName]
      if (currentEntry?.clipOf && currentEntry?.clipState) {
        const sourceExists = videoFiles.some(f => f.name === currentEntry.clipOf)
        setCurrentVideoClip({ clipOf: currentEntry.clipOf, clipState: currentEntry.clipState, sourceExists })
      } else {
        setCurrentVideoClip(null)
      }
      const localFlags = await window.api.checkLocalFiles(videoFiles.map(f => f.path))
      setSiblingFiles(videoFiles.map((f, i) => {
        const k = relKey(f.path)
        const entry = videoMap[k] ?? videoMap[f.name]
        return {
          path: f.path,
          name: f.name,
          isLocal: localFlags[i],
          category: entry?.category as SiblingFile['category'] | undefined,
          fps: entry?.fps,
          clipOf: entry?.clipOf,
          clipState: entry?.clipState,
        }
      }))
    } catch { /* swallow */ }
  }, [config.streamsDir])

  useEffect(() => {
    reloadSessionPanel(state.filePath)
  }, [state.filePath, reloadSessionPanel])

  // Any time the source video changes, drop the draft binding so a fresh clip session starts fresh.
  useEffect(() => { setActiveDraftId(null) }, [state.filePath])

  // Pending "open in clip editor" — applied once the requested source video finishes loading.
  // draftId=null means start a fresh draft on the first edit (e.g. reopening a clip output).
  const [pendingClipOpen, setPendingClipOpen] = useState<{ sourceName: string; state: ClipState; draftId: string | null } | null>(null)
  const loadDraft = useCallback((draft: import('../../types').ClipDraft) => {
    const dir = folderPathRef.current
    if (!dir) return
    const sep = dir.includes('\\') ? '\\' : '/'
    const sourcePath = `${dir}${sep}${draft.sourceName}`
    if (state.filePath === sourcePath) {
      setActiveDraftId(draft.id)
      setClipState(draft.state)
      setIsClipMode(true)
    } else {
      setPendingClipOpen({ sourceName: draft.sourceName, state: draft.state, draftId: draft.id })
      loadFile(sourcePath)
    }
  }, [state.filePath, loadFile])

  // Reopen an already-exported clip in the editor using its saved state. Does NOT bind to the
  // exported file's entry — a brand-new draft is created on the first edit (if any).
  const reopenClipOutput = useCallback((sourceName: string, savedState: ClipState) => {
    const dir = folderPathRef.current
    if (!dir) return
    const sep = dir.includes('\\') ? '\\' : '/'
    const sourcePath = `${dir}${sep}${sourceName}`
    if (state.filePath === sourcePath) {
      setActiveDraftId(null)
      setClipState(savedState)
      setIsClipMode(true)
    } else {
      setPendingClipOpen({ sourceName, state: savedState, draftId: null })
      loadFile(sourcePath)
    }
  }, [state.filePath, loadFile])

  useEffect(() => {
    if (!pendingClipOpen) return
    if (!state.filePath) return
    if (!state.filePath.endsWith(pendingClipOpen.sourceName)) return
    setActiveDraftId(pendingClipOpen.draftId)
    setClipState(pendingClipOpen.state)
    setIsClipMode(true)
    setPendingClipOpen(null)
  }, [pendingClipOpen, state.filePath])

  // exitClipMode is declared later in the file; use a ref so deleteDraft can call it
  // without hitting a TDZ reference and without listing it as a dep.
  const exitClipModeRef = useRef<() => void>(() => {})

  // Draft pending deletion — when set, a confirmation modal is shown.
  const [draftPendingDelete, setDraftPendingDelete] = useState<import('../../types').ClipDraft | null>(null)

  const requestDeleteDraft = useCallback((draft: import('../../types').ClipDraft) => {
    setDraftPendingDelete(draft)
  }, [])

  const confirmDeleteDraft = useCallback(async () => {
    const draft = draftPendingDelete
    if (!draft) return
    setDraftPendingDelete(null)
    const dir = folderPathRef.current
    if (!dir) return
    const wasActive = activeDraftIdRef.current === draft.id
    if (wasActive && draftSaveTimerRef.current) {
      clearTimeout(draftSaveTimerRef.current)
      draftSaveTimerRef.current = null
    }
    await window.api.deleteClipDraft(dir, draft.id, folderMetaKeyRef.current ?? undefined).catch(() => {})
    // Sync the ref immediately so any flushDraftSave triggered by exitClipMode sees the
    // post-delete list and doesn't resurrect the draft.
    folderDraftsRef.current = folderDraftsRef.current.filter(d => d.id !== draft.id)
    setFolderDrafts(prev => prev.filter(d => d.id !== draft.id))
    if (wasActive) {
      // The user deleted the draft they're currently editing — exit clip mode so they
      // "bounce back" to plain playback on the source video.
      exitClipModeRef.current()
    }
  }, [draftPendingDelete])

  // Derive a draft's display name: explicit user-set name, or "Clip N" from the id.
  const draftDisplayName = useCallback((draft: import('../../types').ClipDraft): string => {
    if (draft.name && draft.name.trim()) return draft.name.trim()
    const clipNum = Number(draft.id.match(/-clip-(\d+)$/)?.[1] ?? 0)
    return `Clip ${clipNum}`
  }, [])

  // Rename a draft. Rejects empties or names that would collide with another draft in the folder.
  const renameDraft = useCallback(async (draftId: string, newName: string): Promise<boolean> => {
    const dir = folderPathRef.current
    if (!dir) return false
    const trimmed = newName.trim()
    if (!trimmed) return false
    const existing = folderDraftsRef.current
    const target = existing.find(d => d.id === draftId)
    if (!target) return false
    // Reject if another draft already uses this effective display name
    const collision = existing.some(d => d.id !== draftId && draftDisplayName(d).toLowerCase() === trimmed.toLowerCase())
    if (collision) return false
    const updated: import('../../types').ClipDraft = { ...target, name: trimmed, updatedAt: Date.now() }
    await window.api.saveClipDraft(dir, updated, folderMetaKeyRef.current ?? undefined).catch(() => {})
    setFolderDrafts(prev => prev.map(d => d.id === draftId ? updated : d))
    return true
  }, [draftDisplayName])

  const { jobs: conversionJobs, setJobs } = useConversionJobs()

  // Pending clip exports keyed by job id — populated in exportClips, consumed in onJobComplete.
  const pendingExportsRef = useRef<Map<string, {
    sourceName: string
    clipStateSnapshot: ClipState
    draftId: string | null
    outputFilename: string
    outputFolder: string
  }>>(new Map())

  // Draft ids whose export is currently in flight (queued/running/paused). Used to lock the
  // draft item in the Session Videos panel so the user can't spawn a duplicate job for the
  // same draft while one is already going.
  const [exportingDraftIds, setExportingDraftIds] = useState<Set<string>>(new Set())
  const clearExportingDraftId = useCallback((draftId: string | null) => {
    if (!draftId) return
    setExportingDraftIds(prev => {
      if (!prev.has(draftId)) return prev
      const next = new Set(prev); next.delete(draftId); return next
    })
  }, [])

  useEffect(() => {
    const unsub = window.api.onJobComplete(async ({ jobId }: { jobId: string }) => {
      const pending = pendingExportsRef.current.get(jobId)
      if (!pending) return
      pendingExportsRef.current.delete(jobId)
      clearExportingDraftId(pending.draftId)
      await window.api.clipTagExport(
        pending.outputFolder,
        pending.outputFilename,
        pending.sourceName,
        pending.clipStateSnapshot,
        pending.draftId,
        // Reuse the canonical key — outputFolder may equal the dump dir in
        // dump mode, where derivation can't disambiguate streams.
        resolveStreamContext(`${pending.outputFolder}\\${pending.outputFilename}`, config.streamsDir).metaKey,
      ).catch(() => {})
      // If the exported draft is still bound to the active clip session, clear the binding so
      // future edits create a new draft instead of re-saving the now-deleted one.
      if (pending.draftId && activeDraftIdRef.current === pending.draftId) {
        setActiveDraftId(null)
        activeDraftIdRef.current = null
      }
      // If the tagged folder is the one currently displayed, refresh the Session Videos panel
      // so the new file appears with its "reopen in clip editor" button and the draft disappears.
      const normalize = (p: string | null) => p ? p.replace(/\\/g, '/').replace(/\/$/, '') : ''
      if (normalize(pending.outputFolder) === normalize(folderPathRef.current)) {
        reloadSessionPanel(state.filePath)
      }
    })
    return unsub
  }, [reloadSessionPanel, state.filePath, clearExportingDraftId])

  // Cover error/cancel paths: if the job failed or was cancelled, release the draft lock so the
  // user can retry. (onJobError is broadcast; cancels surface via the jobs context state.)
  useEffect(() => {
    const unsub = window.api.onJobError(({ jobId }: { jobId: string }) => {
      const pending = pendingExportsRef.current.get(jobId)
      if (!pending) return
      pendingExportsRef.current.delete(jobId)
      clearExportingDraftId(pending.draftId)
    })
    return unsub
  }, [clearExportingDraftId])

  // Watch the converter jobs list for cancels (no IPC broadcast for cancels — only local state).
  useEffect(() => {
    for (const job of conversionJobs) {
      if (job.status !== 'cancelled') continue
      const pending = pendingExportsRef.current.get(job.id)
      if (!pending) continue
      pendingExportsRef.current.delete(job.id)
      clearExportingDraftId(pending.draftId)
    }
  }, [conversionJobs, clearExportingDraftId])

  // ── Clip draft autosave ────────────────────────────────────────────────────
  // Drafts are created lazily the first time the user adds meaningful content while in clip mode
  // (a region, bleep, or a non-default crop setting). They are saved to the folder's _meta.json
  // and re-opened via the Session Videos panel. Removing all content deletes the draft.
  const clipStateHasContent = useCallback((s: ClipState) => (
    s.clipRegions.length > 0 ||
    s.bleepRegions.length > 0 ||
    s.cropAspect !== 'off'
  ), [])

  const nextDraftIdFor = useCallback((sourceName: string, existing: import('../../types').ClipDraft[]) => {
    const prefix = `${sourceName}-clip-`
    let n = 1
    const taken = new Set(existing.filter(d => d.id.startsWith(prefix)).map(d => d.id))
    while (taken.has(`${prefix}${n}`)) n++
    return `${prefix}${n}`
  }, [])

  const draftSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const persistDraftState = useCallback(async (stateToSave: ClipState, sourceFilePath: string | null, dir: string | null) => {
    if (!sourceFilePath || !dir) return
    const sourceName = sourceFilePath.replace(/.*[\\/]/, '')
    const hasContent = clipStateHasContent(stateToSave)
    const currentId = activeDraftIdRef.current
    if (hasContent) {
      const now = Date.now()
      let id = currentId
      const existing = id ? folderDraftsRef.current.find(d => d.id === id) : null
      // Guard against resurrection: if we have an id bound but the draft is no longer in the
      // folder (e.g. user just deleted it or it was cleared after export), don't recreate it.
      if (id && !existing) return
      if (!id) {
        id = nextDraftIdFor(sourceName, folderDraftsRef.current)
        setActiveDraftId(id)
        activeDraftIdRef.current = id // sync so immediate reads (e.g. in exportClips flush) see the new id
      }
      // Preserve user-set fields (name, thumbnailDataUrl) and original createdAt across autosaves.
      const draft: import('../../types').ClipDraft = {
        ...(existing ?? {}),
        id,
        sourceName,
        state: stateToSave,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      }
      await window.api.saveClipDraft(dir, draft, folderMetaKeyRef.current ?? undefined).catch(() => {})
      setFolderDrafts(prev => {
        const idx = prev.findIndex(d => d.id === id)
        if (idx >= 0) { const copy = [...prev]; copy[idx] = draft; return copy }
        return [...prev, draft]
      })
    } else if (currentId) {
      await window.api.deleteClipDraft(dir, currentId, folderMetaKeyRef.current ?? undefined).catch(() => {})
      setFolderDrafts(prev => prev.filter(d => d.id !== currentId))
      setActiveDraftId(null)
    }
  }, [clipStateHasContent, nextDraftIdFor])

  // Debounced autosave while in clip mode
  useEffect(() => {
    if (!isClipMode) return
    if (!state.filePath || !folderPathRef.current) return
    if (draftSaveTimerRef.current) clearTimeout(draftSaveTimerRef.current)
    draftSaveTimerRef.current = setTimeout(() => {
      persistDraftState(clipState, state.filePath, folderPathRef.current)
    }, 500)
    return () => {
      if (draftSaveTimerRef.current) { clearTimeout(draftSaveTimerRef.current); draftSaveTimerRef.current = null }
    }
  }, [clipState, isClipMode, state.filePath, persistDraftState])

  // Flush any pending draft save. Await to ensure the draft is persisted and `activeDraftIdRef`
  // is up to date before proceeding (e.g. before capturing the draft id in a pending export).
  const flushDraftSave = useCallback(async () => {
    if (draftSaveTimerRef.current) { clearTimeout(draftSaveTimerRef.current); draftSaveTimerRef.current = null }
    if (!isClipModeRef.current) return
    const fp = state.filePath
    const dir = folderPathRef.current
    if (!fp || !dir) return
    await persistDraftState(clipState, fp, dir)
  }, [clipState, state.filePath, persistDraftState])

  // Multi-track warning modal before entering clip mode
  const [clipModeModal, setClipModeModal] = useState<'warn' | 'merge' | null>(null)
  const pendingClipAfterMerge = useRef(false)
  // Tracks the "don't show this again" checkbox inside the warn modal —
  // persisted to config when the user confirms via either footer action.
  const [warnDontShowAgain, setWarnDontShowAgain] = useState(false)
  // Reset the checkbox each time the modal closes so a previous session's
  // toggle doesn't carry over into the next open.
  useEffect(() => {
    if (clipModeModal === null) setWarnDontShowAgain(false)
  }, [clipModeModal])
  const commitWarnDontShowAgain = useCallback(() => {
    if (warnDontShowAgain) updateConfig({ skipClipMergeWarning: true })
  }, [warnDontShowAgain, updateConfig])

  const [clipFocus, setClipFocus] = useState(false)
  const clipFocusRef = useRef(false)
  // Per-region duration lock: dragging one handle moves the other to preserve duration
  const [lockedRegionIds, setLockedRegionIds] = useState<Set<string>>(new Set())
  const lockedRegionIdsRef = useRef<Set<string>>(new Set())
  useEffect(() => { lockedRegionIdsRef.current = lockedRegionIds }, [lockedRegionIds])
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null)
  const [hoveredRegionId, setHoveredRegionId] = useState<string | null>(null)
  const selectedRegionIdRef = useRef<string | null>(null)
  useEffect(() => { selectedRegionIdRef.current = selectedRegionId }, [selectedRegionId])

  // Immutable helper: update crop fields on a specific region within clipState.
  const updateRegionCrop = useCallback((regionId: string, patch: { cropX?: number; cropY?: number; cropScale?: number }) => {
    setClipState(s => ({
      ...s,
      clipRegions: s.clipRegions.map(r => r.id === regionId ? { ...r, ...patch } : r),
    }))
  }, [])
  const isPlayingRef = useRef(false)

  // Bleep markers
  const [activeBleepId, setActiveBleepId] = useState<string | null>(null)
  const [bleepLengthInput, setBleepLengthInput] = useState('')
  const bleepLengthInputRef = useRef<HTMLInputElement>(null)
  const bleepPopupRef       = useRef<HTMLDivElement>(null)

  // Web Audio for bleep playback
  const audioCtxRef  = useRef<AudioContext | null>(null)
  const bleepOscRef  = useRef<OscillatorNode | null>(null)
  const bleepGainRef = useRef<GainNode | null>(null)
  const isBleepingRef = useRef(false)

  // Stable refs for values needed in memoised callbacks
  const currentTimeRef  = useRef(0)
  const videoInfoRef    = useRef(state.videoInfo)
  const clipStateRef    = useRef(clipState)
  const isPopupOpenRef  = useRef(false)
  // All playhead-drag, waveform-click, and slider handlers use these refs
  // so they don't need to be recreated when seek changes.
  const seekRef     = useRef((t: number) => seek(t))
  const fastSeekRef = useRef((t: number) => fastSeek(t))
  // WebRTC peer connection for popup streaming
  const popupPCRef          = useRef<RTCPeerConnection | null>(null)
  const popupRtcCleanupRef  = useRef<(() => void) | null>(null)

  const exitClipMode = useCallback(() => {
    flushDraftSave()
    setIsClipMode(false)
    setActiveBleepId(null)
    setActiveDraftId(null)
    setClipState({ clipRegions: [], cropAspect: 'off', cropX: 0.5, bleepRegions: [], bleepVolume: 0.25 })
    setViewport({ viewStart: 0, viewEnd: durationRef.current })
    setHandlePopup(null)
    setEditingDurationId(null)
    setClipFocus(false)
    setAddSegmentError(null)
  }, [flushDraftSave])
  // Keep the forward ref from deleteDraft in sync
  exitClipModeRef.current = exitClipMode

  // Shared zoom/pan handler — uses refs to avoid stale closures in non-passive listeners.
  // Horizontal scroll (|deltaX| dominant) pans the timeline; vertical scroll zooms.
  const handleZoom = useCallback((e: WheelEvent, rect: DOMRect) => {
    if (durationRef.current <= 0) return
    e.preventDefault()
    const { viewStart, viewEnd } = viewportRef.current
    const span = viewEnd - viewStart
    const dur = durationRef.current
    const isPan = e.deltaX !== 0 || e.shiftKey
    if (isPan) {
      // Pan: horizontal scroll or Shift+scroll; deltaX takes priority over shifted deltaY
      const rawDelta = e.deltaX !== 0 ? e.deltaX : e.deltaY
      const dtSec = (rawDelta / rect.width) * span
      let ns = viewStart + dtSec
      let ne = viewEnd + dtSec
      if (ns < 0) { ns = 0; ne = Math.min(dur, span) }
      if (ne > dur) { ne = dur; ns = Math.max(0, dur - span) }
      setViewport({ viewStart: ns, viewEnd: ne })
    } else {
      // Zoom: vertical scroll, centred on cursor position
      const cursorRatio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
      const cursorTime = viewStart + cursorRatio * span
      const factor = e.deltaY < 0 ? 0.7 : 1 / 0.7
      const newSpan = Math.max(dur / 500, Math.min(dur, span * factor))
      let newStart = cursorTime - cursorRatio * newSpan
      let newEnd = newStart + newSpan
      if (newStart < 0) { newStart = 0; newEnd = Math.min(dur, newSpan) }
      if (newEnd > dur) { newEnd = dur; newStart = Math.max(0, dur - newSpan) }
      setViewport({ viewStart: newStart, viewEnd: newEnd })
    }
  }, [])

  useEffect(() => {
    if (initialFile) loadFile(initialFile.path)
  }, [initialFile?.token]) // eslint-disable-line react-hooks/exhaustive-deps

  // Select all tracks by default when a new file loads
  useEffect(() => {
    if (state.videoInfo) {
      setSelectedIndices(new Set(state.videoInfo.audioTracks.map((_, i) => i)))
    }
  }, [state.videoUrl]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggleIndex = useCallback((i: number) => {
    setSelectedIndices(prev => {
      const next = new Set(prev)
      next.has(i) ? next.delete(i) : next.add(i)
      return next
    })
  }, [])

  const { videoInfo, tracks, isExtracting, extractProgress, tracksExtracted, isPlaying, currentTime, duration, videoUrl, error } = state
  const multiTrack = (videoInfo?.audioTracks.length ?? 0) > 1

  // Default crop values used when a region has no override yet, or when no region is active.
  const DEFAULT_CROP_X = 0.5
  const DEFAULT_CROP_Y = 0.5
  const DEFAULT_CROP_SCALE = 1
  const MIN_CROP_SCALE = 0.2

  // The region whose crop is currently shown/edited: whichever region the playhead is inside.
  // Selection is intentionally ignored so the crop preview tracks playback naturally.
  const activeCropRegion = useMemo(() => {
    return clipState.clipRegions.find(r => currentTime >= r.inPoint && currentTime < r.outPoint) ?? null
  }, [clipState.clipRegions, currentTime])
  const activeCropRegionRef = useRef(activeCropRegion)
  useEffect(() => { activeCropRegionRef.current = activeCropRegion }, [activeCropRegion])

  // Reset zoom when a new file loads
  useEffect(() => {
    setVideoZoom(1); setVideoPan({ x: 0, y: 0 })
    videoZoomRef.current = 1; videoPanRef.current = { x: 0, y: 0 }
  }, [videoUrl])

  // Keep stable refs current
  useEffect(() => { durationRef.current    = duration   }, [duration])
  useEffect(() => { currentTimeRef.current = currentTime }, [currentTime])
  useEffect(() => { videoInfoRef.current   = videoInfo  }, [videoInfo])
  useEffect(() => { clipStateRef.current   = clipState  }, [clipState])
  useEffect(() => { clipFocusRef.current = clipFocus }, [clipFocus])

  // Clear the handle-drag playhead freeze once the video's currentTime has caught up to the
  // saved position after a drag release seek (prevents a flash to the handle's frame position).
  // Gated by isDraggingHandleRef so it doesn't fire prematurely while the drag is still active.
  useEffect(() => {
    if (handleDragDisplayTime === null) return
    if (isDraggingHandleRef.current) return
    if (Math.abs(currentTime - handleDragDisplayTime) < 0.05) setHandleDragDisplayTime(null)
  }, [currentTime, handleDragDisplayTime])

  // Auto-enable clip focus when the first segment is added
  const segmentCount = clipState.clipRegions.length
  useEffect(() => {
    if (segmentCount > 0) setClipFocus(true)
  }, [segmentCount > 0]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { seekRef.current     = (t) => seek(t)     }, [seek])
  useEffect(() => { fastSeekRef.current = (t) => fastSeek(t) }, [fastSeek])
  useEffect(() => {
    if (duration > 0) setViewport({ viewStart: 0, viewEnd: duration })
    // Close popup and tear down WebRTC whenever the loaded file changes or is cleared
    window.api.closeVideoPopup().catch(() => {})
    setIsPopupOpen(false)
    popupRtcCleanupRef.current?.()
    popupRtcCleanupRef.current = null
    popupPCRef.current?.close()
    popupPCRef.current = null
  }, [state.videoUrl]) // eslint-disable-line react-hooks/exhaustive-deps

  // After a merge triggered from the clip-mode modal completes, enter clip mode automatically
  useEffect(() => {
    if (tracksExtracted && pendingClipAfterMerge.current) {
      pendingClipAfterMerge.current = false
      setClipModeModal(null)
      setIsClipMode(true)
    }
  }, [tracksExtracted])


  // Snap viewport to keep playhead visible
  useEffect(() => {
    if (!isClipMode || duration <= 0) return
    const { viewStart, viewEnd } = viewportRef.current
    const span = viewEnd - viewStart
    if (currentTime < viewStart) {
      const ns = Math.max(0, currentTime)
      setViewport({ viewStart: ns, viewEnd: Math.min(duration, ns + span) })
    } else if (currentTime > viewEnd) {
      const ne = Math.min(duration, currentTime)
      setViewport({ viewStart: Math.max(0, ne - span), viewEnd: ne })
    }
  }, [currentTime, isClipMode, duration]) // eslint-disable-line react-hooks/exhaustive-deps

  // Middle-click drag to pan the zoomed video.
  const startVideoPanDrag = useCallback((e: React.MouseEvent) => {
    if (e.button !== 1) return
    e.preventDefault()
    e.stopPropagation()

    // Double-middle-click: reset zoom to fit
    const now = Date.now()
    const isDouble = now - lastMiddleClickRef.current < 300
    lastMiddleClickRef.current = now
    if (isDouble) {
      setVideoZoom(1); setVideoPan({ x: 0, y: 0 })
      videoZoomRef.current = 1; videoPanRef.current = { x: 0, y: 0 }
      return
    }

    if (videoZoomRef.current <= 1) return
    setIsVideoPanning(true)
    const startX = e.clientX
    const startY = e.clientY
    const startPan = { ...videoPanRef.current }
    const el = videoContainerEl
    const onMove = (me: MouseEvent) => {
      if (!el) return
      const rect = el.getBoundingClientRect()
      const clamped = clampVideoPan(
        startPan.x + (me.clientX - startX),
        startPan.y + (me.clientY - startY),
        videoZoomRef.current, rect.width, rect.height
      )
      videoPanRef.current = clamped
      setVideoPan(clamped)
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      setIsVideoPanning(false)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [videoContainerEl])

  // Middle-click pan: captures drag start and applies delta against initial viewport.
  // Accepts native or React mouse events — only needs button, preventDefault, clientX.
  const startMiddleClickPan = useCallback((e: { button: number; preventDefault: () => void; clientX: number }, containerWidthPx: number) => {
    if (e.button !== 1) return
    e.preventDefault()
    const startX = e.clientX
    const { viewStart: svs, viewEnd: sve } = viewportRef.current
    const span = sve - svs
    const onMove = (me: MouseEvent) => {
      const dur = durationRef.current
      if (dur <= 0) return
      const dtSec = -((me.clientX - startX) / containerWidthPx) * span
      let ns = svs + dtSec
      let ne = sve + dtSec
      if (ns < 0) { ns = 0; ne = span }
      if (ne > dur) { ne = dur; ns = dur - span }
      setViewport({ viewStart: ns, viewEnd: ne })
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [])

  // Capture-phase middle-click intercept: fires before any child's onMouseDown, so middle-click
  // always pans the timeline regardless of which interactive element is under the cursor.
  useEffect(() => {
    const el = stripsWrapperRef.current
    if (!el) return
    const onCapture = (e: MouseEvent) => {
      if (e.button !== 1) return
      e.stopPropagation()
      startMiddleClickPan(e, el.getBoundingClientRect().width)
    }
    el.addEventListener('mousedown', onCapture, true)
    return () => el.removeEventListener('mousedown', onCapture, true)
  }, [startMiddleClickPan, isClipMode])

  // Drag an In or Out handle of a specific segment. Collision-aware.
  const startSegmentHandleDrag = useCallback((e: React.MouseEvent, regionId: string, which: 'in' | 'out') => {
    if (e.button !== 0) return // capture-phase handler above takes middle-click; ignore right-click
    e.preventDefault()
    e.stopPropagation()
    const wrapperEl = stripsWrapperRef.current
    if (!wrapperEl) return
    const rect = wrapperEl.getBoundingClientRect()
    const startX = e.clientX
    let hasMoved = false

    // Show the popup immediately with the current handle value
    const fps = videoInfoRef.current?.fps
    const region = clipStateRef.current.clipRegions.find(r => r.id === regionId)
    if (!region) return
    const initVal = formatViewTime(which === 'in' ? region.inPoint : region.outPoint, fps)
    setHandlePopup({ regionId, which, value: initVal })

    // Bug 4: freeze playhead at current position; preview handle frame in video
    const handleTime = which === 'in' ? region.inPoint : region.outPoint
    handleDragSavedTimeRef.current = currentTimeRef.current
    isDraggingHandleRef.current = true
    setHandleDragDisplayTime(currentTimeRef.current)
    seekRef.current(handleTime)

    const onMove = (me: MouseEvent) => {
      if (!hasMoved && Math.abs(me.clientX - startX) > 2) hasMoved = true
      const ratio = Math.max(0, Math.min(1, (me.clientX - rect.left) / rect.width))
      const { viewStart, viewEnd } = viewportRef.current
      const t = viewStart + ratio * (viewEnd - viewStart)
      const dur = durationRef.current
      const moveFps = videoInfoRef.current?.fps
      const frameTime = 1 / (moveFps ?? 30)
      const locked = lockedRegionIdsRef.current.has(regionId)
      setClipState(s => {
        const r = s.clipRegions.find(c => c.id === regionId)
        if (!r) return s
        const segDur = r.outPoint - r.inPoint
        // Compute left/right walls from direct neighbour lookup — avoids the anchor-inside-neighbour
        // bug that getSegmentFreeInterval has when the handle has already been clamped to the edge.
        const others = s.clipRegions.filter(c => c.id !== regionId)
        const leftWall  = others.reduce<number>((b, c) => c.outPoint < r.outPoint ? Math.max(b, c.outPoint) : b, -Infinity)
        const rightWall = others.reduce<number>((b, c) => c.inPoint  > r.inPoint  ? Math.min(b, c.inPoint)  : b, Infinity)
        // Stop 1 frame from a neighbour so the merge button can appear; use full extent at video boundary.
        const lo = leftWall  === -Infinity ? 0   : leftWall  + frameTime
        const hi = rightWall === Infinity  ? dur : rightWall - frameTime
        if (which === 'in') {
          const clamped = Math.max(lo, Math.min(t, r.outPoint - frameTime))
          setHandlePopup(p => p ? { ...p, value: formatViewTime(clamped, moveFps) } : p)
          seekRef.current(clamped) // preview handle frame while dragging
          if (locked) {
            const newOut = Math.min(hi, clamped + segDur)
            return { ...s, clipRegions: s.clipRegions.map(c => c.id === regionId ? { ...c, inPoint: clamped, outPoint: newOut } : c) }
          }
          return { ...s, clipRegions: s.clipRegions.map(c => c.id === regionId ? { ...c, inPoint: clamped } : c) }
        } else {
          const clamped = Math.min(hi, Math.max(t, r.inPoint + frameTime))
          setHandlePopup(p => p ? { ...p, value: formatViewTime(clamped, moveFps) } : p)
          seekRef.current(clamped) // preview handle frame while dragging
          if (locked) {
            const newIn = Math.max(lo, clamped - segDur)
            return { ...s, clipRegions: s.clipRegions.map(c => c.id === regionId ? { ...c, inPoint: newIn, outPoint: clamped } : c) }
          }
          return { ...s, clipRegions: s.clipRegions.map(c => c.id === regionId ? { ...c, outPoint: clamped } : c) }
        }
      })
    }
    const onUp = () => {
      isDraggingHandleRef.current = false
      ;(document.activeElement as HTMLElement)?.blur()
      if (!hasMoved) {
        // Click (no drag): leave video at handle position, jump playhead there too
        setHandleDragDisplayTime(null)
        setTimeout(() => handlePopupInputRef.current?.select(), 0)
      } else {
        // Drag release: restore video to saved position. Keep handleDragDisplayTime frozen at
        // that position so the playhead doesn't flash to the handle's frame while the seek
        // resolves. The useEffect below clears it once currentTime catches up.
        seekRef.current(handleDragSavedTimeRef.current)
        setHandleDragDisplayTime(handleDragSavedTimeRef.current)
        setHandlePopup(null)
      }
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, []) // all mutable values accessed via refs

  // Drag an entire clip segment (both handles together). Collision-aware.
  const startSegmentDrag = useCallback((e: React.MouseEvent, regionId: string) => {
    if (e.button !== 0) return // capture-phase handler takes middle-click; ignore right-click
    e.preventDefault()
    e.stopPropagation()
    setSelectedRegionId(regionId)
    const wrapperEl = stripsWrapperRef.current
    if (!wrapperEl) return
    const rect = wrapperEl.getBoundingClientRect()
    const startX = e.clientX
    const region = clipStateRef.current.clipRegions.find(r => r.id === regionId)
    if (!region) return
    const startIn  = region.inPoint
    const startOut = region.outPoint
    const segDur   = startOut - startIn
    let hasMoved = false
    const onMove = (me: MouseEvent) => {
      if (!hasMoved && Math.abs(me.clientX - startX) > 2) hasMoved = true
      if (!hasMoved) return
      const { viewStart, viewEnd } = viewportRef.current
      const span = viewEnd - viewStart
      const dur = durationRef.current
      const frameTime = 1 / (videoInfoRef.current?.fps ?? 30)
      const dtSec = ((me.clientX - startX) / rect.width) * span
      const snapThresholdSec = (span / rect.width) * 2 // 2px snap zone
      setClipState(s => {
        const r = s.clipRegions.find(c => c.id === regionId)
        if (!r) return s
        // Find bounds from neighbouring regions
        const others = s.clipRegions.filter(c => c.id !== regionId)
        const lo = others.reduce((acc, c) => c.outPoint <= startIn + dtSec ? Math.max(acc, c.outPoint) : acc, 0)
        const hi = others.reduce((acc, c) => c.inPoint >= startIn + dtSec + segDur ? Math.min(acc, c.inPoint) : acc, dur)
        let newIn  = startIn  + dtSec
        let newOut = startOut + dtSec
        // Clamp to neighbours and video bounds
        if (newIn < lo)          { newIn = lo;         newOut = lo + segDur }
        if (newOut > hi)         { newOut = hi;         newIn  = hi - segDur }
        if (newIn < 0)           { newIn = 0;           newOut = segDur }
        if (newOut > dur)        { newOut = dur;         newIn  = dur - segDur }
        // Snap outPoint → next segment's inPoint, or inPoint → prev segment's outPoint
        for (const c of others) {
          if (Math.abs(newOut - c.inPoint) <= snapThresholdSec) {
            newOut = c.inPoint; newIn = newOut - segDur
            break
          }
          if (Math.abs(newIn - c.outPoint) <= snapThresholdSec) {
            newIn = c.outPoint; newOut = newIn + segDur
            break
          }
        }
        // If clamped segment overlaps a neighbour (can happen with tight gaps), prevent the move
        const wouldOverlap = others.some(c => newIn < c.outPoint - frameTime && newOut > c.inPoint + frameTime)
        if (wouldOverlap) return s
        const updated = s.clipRegions.map(c => c.id === regionId ? { ...c, inPoint: newIn, outPoint: newOut } : c)
        return { ...s, clipRegions: updated.sort((a, b) => a.inPoint - b.inPoint) }
      })
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [setSelectedRegionId]) // setSelectedRegionId is stable

  // Scrub by dragging the playhead
  const startPlayheadDrag = useCallback((e: React.MouseEvent) => {
    // Middle-click on the playhead always starts a pan, never a scrub. The
    // capture-phase intercept on stripsWrapperRef is supposed to catch this
    // first, but in some browser/Electron cases the bubble-phase React
    // handler still wins on the playhead's hit-area; handling it directly
    // here makes the behavior reliable regardless.
    if (e.button === 1) {
      const wrapperEl = stripsWrapperRef.current
      if (!wrapperEl) return
      e.preventDefault()
      e.stopPropagation()
      startMiddleClickPan(e.nativeEvent, wrapperEl.getBoundingClientRect().width)
      return
    }
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const wrapperEl = stripsWrapperRef.current
    if (!wrapperEl) return
    const rect = wrapperEl.getBoundingClientRect()
    const getTime = (clientX: number) => {
      const { viewStart, viewEnd } = viewportRef.current
      return viewStart + Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * (viewEnd - viewStart)
    }
    isPlayheadDraggingRef.current = true
    fastSeekRef.current(getTime(e.clientX))
    setHoverRatio(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)))
    const onMove = (me: MouseEvent) => {
      fastSeekRef.current(getTime(me.clientX))
      setHoverRatio(Math.max(0, Math.min(1, (me.clientX - rect.left) / rect.width)))
    }
    const onUp = (me: MouseEvent) => {
      isPlayheadDraggingRef.current = false
      setHoverRatio(null)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      seekRef.current(getTime(me.clientX))
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [startMiddleClickPan])

  // Corner resize: scales the crop rect around the opposite corner (which stays pinned).
  const handleCropCornerResize = useCallback((e: React.MouseEvent, corner: 'tl' | 'tr' | 'bl' | 'br') => {
    e.preventDefault()
    e.stopPropagation()
    const region = activeCropRegionRef.current
    if (!region) return
    const { w: vcW, h: vcH } = vcSizeRef.current
    const vi = videoInfoRef.current
    const containerEl = videoContainerRef.current
    const aspect = clipStateRef.current.cropAspect
    if (!vi || vcW === 0 || !containerEl || aspect === 'off') return
    const ar = aspectRatio(aspect, vi.width, vi.height)

    const cropX = region.cropX ?? 0.5
    const cropY = region.cropY ?? 0.5
    const startScale = region.cropScale ?? 1
    const { contentLeft, contentTop, contentH, cropLeft, cropTop, cropW, cropH } = getCropGeometry(vcW, vcH, vi.width, vi.height, cropX, cropY, startScale, ar)
    // maxCropH at scale=1 (for scale derivation below)
    const { cropH: maxCropH } = getCropGeometry(vcW, vcH, vi.width, vi.height, 0, 0, 1, ar)
    // Opposite corner stays anchored
    const anchorX = corner === 'tl' || corner === 'bl' ? cropLeft + cropW : cropLeft
    const anchorY = corner === 'tl' || corner === 'tr' ? cropTop + cropH : cropTop
    const containerRect = containerEl.getBoundingClientRect()

    const onMove = (me: MouseEvent) => {
      const mx = me.clientX - containerRect.left
      const my = me.clientY - containerRect.top
      const dx = Math.abs(mx - anchorX)
      const dy = Math.abs(my - anchorY)
      // Aspect constraint: cropH/cropW = 1/ar. Use whichever dimension limits the rect.
      const newCropH = Math.min(dy, dx / ar)
      let newScale = newCropH / maxCropH
      newScale = Math.max(MIN_CROP_SCALE, Math.min(1, newScale))
      const { availableRangeX, availableRangeY, cropW: newCropW, cropH: resolvedCropH } = getCropGeometry(vcW, vcH, vi.width, vi.height, 0, 0, newScale, ar)
      // New rect position so the anchor stays fixed
      const newCropLeft = (corner === 'tl' || corner === 'bl') ? anchorX - newCropW : anchorX
      const newCropTop  = (corner === 'tl' || corner === 'tr') ? anchorY - resolvedCropH : anchorY
      const newCropX = availableRangeX > 0 ? Math.max(0, Math.min(1, (newCropLeft - contentLeft) / availableRangeX)) : 0.5
      const newCropY = availableRangeY > 0 ? Math.max(0, Math.min(1, (newCropTop  - contentTop)  / availableRangeY)) : 0.5
      updateRegionCrop(region.id, { cropX: newCropX, cropY: newCropY, cropScale: newScale })
    }
    const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [updateRegionCrop])

  // Drag the crop rect to pan (horizontal/vertical as the active aspect allows) within the active region.
  const handleCropDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const region = activeCropRegionRef.current
    if (!region) return
    const aspect = clipStateRef.current.cropAspect
    if (aspect === 'off') return
    const startX = e.clientX
    const startY = e.clientY
    const startCropX = region.cropX ?? 0.5
    const startCropY = region.cropY ?? 0.5
    const startScale = region.cropScale ?? 1
    const onMove = (me: MouseEvent) => {
      const { w: vcW, h: vcH } = vcSizeRef.current
      const vi = videoInfoRef.current
      if (!vi || vcW === 0) return
      const ar = aspectRatio(aspect, vi.width, vi.height)
      const { availableRangeX, availableRangeY } = getCropGeometry(vcW, vcH, vi.width, vi.height, 0, 0, startScale, ar)
      const newCropX = availableRangeX > 0
        ? Math.max(0, Math.min(1, startCropX + (me.clientX - startX) / availableRangeX))
        : startCropX
      const newCropY = availableRangeY > 0
        ? Math.max(0, Math.min(1, startCropY + (me.clientY - startY) / availableRangeY))
        : startCropY
      setClipState(s => ({
        ...s,
        clipRegions: s.clipRegions.map(r => r.id === region.id ? { ...r, cropX: newCropX, cropY: newCropY } : r),
      }))
    }
    const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [])

  // Start/stop the 1 kHz bleep tone and mute/unmute the video simultaneously
  const startBleep = useCallback(() => {
    if (isBleepingRef.current) return
    isBleepingRef.current = true
    if (videoRef.current && audioElements.current.length === 0) videoRef.current.muted = true
    audioElements.current.forEach(a => { if (a) a.muted = true })

    if (!audioCtxRef.current) audioCtxRef.current = new AudioContext()
    const ctx = audioCtxRef.current
    if (ctx.state === 'suspended') ctx.resume()

    const osc  = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = 1000
    // Fade in over 5 ms to avoid a click on entry
    gain.gain.setValueAtTime(0, ctx.currentTime)
    gain.gain.setTargetAtTime(clipStateRef.current.bleepVolume, ctx.currentTime, 0.005)
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start()
    bleepOscRef.current  = osc
    bleepGainRef.current = gain
  }, [videoRef, audioElements])

  const stopBleep = useCallback(() => {
    if (!isBleepingRef.current) return
    isBleepingRef.current = false
    // Only unmute the video element if it's the active audio source (no extracted tracks)
    if (videoRef.current && audioElements.current.length === 0) videoRef.current.muted = false
    audioElements.current.forEach(a => { if (a) a.muted = false })

    const ctx  = audioCtxRef.current
    const osc  = bleepOscRef.current
    const gain = bleepGainRef.current
    if (ctx && osc && gain) {
      // Fade out over ~20 ms to avoid a click on exit, then stop
      gain.gain.setTargetAtTime(0, ctx.currentTime, 0.01)
      osc.stop(ctx.currentTime + 0.08)
    }
    bleepOscRef.current  = null
    bleepGainRef.current = null
  }, [videoRef, audioElements])

  // rAF loop — check every frame whether playback is inside a bleep region
  useEffect(() => {
    if (!isPlaying) { stopBleep(); return }
    let rafId: number
    const tick = () => {
      const vid = videoRef.current
      if (vid) {
        const t = vid.currentTime
        const inBleep = clipStateRef.current.bleepRegions.some(r => t >= r.start && t <= r.end)
        if (inBleep) startBleep(); else stopBleep()
      }
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(rafId); stopBleep() }
  }, [isPlaying, startBleep, stopBleep, videoRef])

  // Clip focus — skip gaps between segments, loop back to first when done.
  // The initial snap is intentionally omitted here: calling seek() at the same
  // time as play() aborts the play() promise. The RAF tick handles it instead,
  // and vid.seeking prevents seek-thrashing while a seek is in progress.
  useEffect(() => {
    if (!clipFocus || !isPlaying) return
    if (clipStateRef.current.clipRegions.length === 0) return
    let rafId: number
    const tick = () => {
      const vid = videoRef.current
      if (vid && clipFocusRef.current && !vid.seeking) {
        const rs = clipStateRef.current.clipRegions
        if (rs.length > 0) {
          const t = vid.currentTime
          const inRegion = rs.some(r => t >= r.inPoint && t < r.outPoint)
          if (!inRegion) {
            // Between/before/after regions — jump to the next region, or loop to first
            const next = rs.find(r => r.inPoint > t)
            vid.currentTime = next ? next.inPoint : rs[0].inPoint
          }
        }
      }
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [clipFocus, isPlaying, videoRef]) // eslint-disable-line react-hooks/exhaustive-deps

  // Close AudioContext when the component unmounts
  useEffect(() => () => { audioCtxRef.current?.close() }, [])

  // Dismiss bleep popup when clicking outside it
  useEffect(() => {
    if (!activeBleepId) return
    const handler = (e: MouseEvent) => {
      if (bleepPopupRef.current && !bleepPopupRef.current.contains(e.target as Node)) {
        setActiveBleepId(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [activeBleepId])

  // Move an existing bleep region by dragging its centre area
  const startBleepMove = useCallback((e: React.MouseEvent, bleepId: string, wrapperRect: DOMRect) => {
    e.preventDefault()
    e.stopPropagation()
    setActiveBleepId(null)
    const { viewStart, viewEnd } = viewportRef.current
    const span = Math.max(0.001, viewEnd - viewStart)
    const dur = durationRef.current
    const startX = e.clientX
    const region = clipStateRef.current.bleepRegions.find(r => r.id === bleepId)
    if (!region) return
    const startR = { ...region }
    const clipLen = startR.end - startR.start
    let hasMoved = false

    const onMove = (me: MouseEvent) => {
      if (!hasMoved && Math.abs(me.clientX - startX) > 2) hasMoved = true
      if (!hasMoved) return
      const dtSec = ((me.clientX - startX) / wrapperRect.width) * span
      let newStart = startR.start + dtSec
      let newEnd   = startR.end   + dtSec
      if (newStart < 0) { newStart = 0; newEnd = clipLen }
      if (newEnd > dur) { newEnd = dur; newStart = dur - clipLen }
      const { lo, hi } = getBleepFreeInterval(clipStateRef.current.bleepRegions, newStart + clipLen / 2, dur, bleepId)
      if (newStart < lo) { newStart = lo; newEnd = lo + clipLen }
      if (newEnd > hi)   { newEnd = hi;  newStart = hi - clipLen }
      newStart = Math.max(0, newStart)
      newEnd   = Math.min(dur, newEnd)
      setClipState(s => ({ ...s, bleepRegions: s.bleepRegions.map(r => r.id === bleepId ? { ...r, start: newStart, end: newEnd } : r) }))
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      if (!hasMoved) {
        const r = clipStateRef.current.bleepRegions.find(b => b.id === bleepId)
        if (r) { setBleepLengthInput((r.end - r.start).toFixed(2)); setActiveBleepId(bleepId) }
      }
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [])

  // Resize a bleep region by dragging its start or end edge handle
  const startBleepResize = useCallback((e: React.MouseEvent, bleepId: string, which: 'start' | 'end', wrapperRect: DOMRect) => {
    e.preventDefault()
    e.stopPropagation()
    setActiveBleepId(null)
    const dur = durationRef.current

    const onMove = (me: MouseEvent) => {
      const { viewStart, viewEnd } = viewportRef.current
      const span = Math.max(0.001, viewEnd - viewStart)
      const ratio = Math.max(0, Math.min(1, (me.clientX - wrapperRect.left) / wrapperRect.width))
      const t = viewStart + ratio * span
      setClipState(s => {
        const r = s.bleepRegions.find(b => b.id === bleepId)
        if (!r) return s
        if (which === 'start') {
          const lo = s.bleepRegions.filter(b => b.id !== bleepId && b.end <= r.end - 0.001).reduce((acc, b) => Math.max(acc, b.end), 0)
          const newStart = Math.max(lo, Math.max(0, Math.min(t, r.end - 0.25)))
          return { ...s, bleepRegions: s.bleepRegions.map(b => b.id === bleepId ? { ...b, start: newStart } : b) }
        } else {
          const hi = s.bleepRegions.filter(b => b.id !== bleepId && b.start >= r.start + 0.001).reduce((acc, b) => Math.min(acc, b.start), dur)
          const newEnd = Math.min(hi, Math.min(dur, Math.max(t, r.start + 0.25)))
          return { ...s, bleepRegions: s.bleepRegions.map(b => b.id === bleepId ? { ...b, end: newEnd } : b) }
        }
      })
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      const r = clipStateRef.current.bleepRegions.find(b => b.id === bleepId)
      if (r) { setBleepLengthInput((r.end - r.start).toFixed(2)); setActiveBleepId(bleepId) }
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [])

  // Drag the volume line on a bleep marker up/down to adjust shared bleep volume
  const startBleepVolumeDrag = useCallback((e: React.MouseEvent, markerRect: DOMRect) => {
    e.preventDefault()
    e.stopPropagation()
    const startY = e.clientY
    const startVol = clipStateRef.current.bleepVolume
    const onMove = (me: MouseEvent) => {
      const dy = me.clientY - startY
      // Dragging up → higher volume; full marker height maps 0–2
      const newVol = Math.max(0, Math.min(1.5, startVol - (dy / markerRect.height) * 1.5))
      setClipState(s => ({ ...s, bleepVolume: newVol }))
      // Update live gain if currently bleeping
      if (bleepGainRef.current && audioCtxRef.current) {
        bleepGainRef.current.gain.setTargetAtTime(newVol, audioCtxRef.current.currentTime, 0.01)
      }
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [])


  // Viewport-derived values — when not in clip mode, the full video is always visible
  const vStart = duration > 0 ? viewport.viewStart : 0
  const vEnd   = duration > 0 ? viewport.viewEnd   : duration
  const vSpan  = Math.max(0.001, vEnd - vStart)
  const zoomLevel = duration > 0 ? duration / vSpan : 1
  const isZoomed  = isClipMode && zoomLevel > 1.01


  const handleFiles = useCallback((paths: string[]) => {
    if (paths[0]) loadFile(paths[0])
  }, [loadFile])

  const handleBrowse = useCallback(async () => {
    const paths = await window.api.openFileDialog({
      filters: [{ name: 'Video Files', extensions: ['mkv', 'mp4', 'mov', 'avi', 'ts', 'flv', 'webm'] }]
    })
    if (paths && paths[0]) loadFile(paths[0])
  }, [loadFile])

  const stepFrame = useCallback((dir: 1 | -1) => {
    const vid = videoRef.current
    if (!vid) return
    if (!vid.paused) vid.pause()
    const fps = videoInfo?.fps ?? 30
    const regions = clipStateRef.current.clipRegions
    const lo = clipFocusRef.current && regions.length > 0 ? regions[0].inPoint : 0
    const hi = clipFocusRef.current && regions.length > 0 ? regions[regions.length - 1].outPoint : duration
    seekRef.current(Math.max(lo, Math.min(hi, currentTimeRef.current + dir / fps)))
  }, [videoRef, videoInfo, duration])

  const skip = useCallback((seconds: number) => {
    const regions = clipStateRef.current.clipRegions
    const lo = clipFocusRef.current && regions.length > 0 ? regions[0].inPoint : 0
    const hi = clipFocusRef.current && regions.length > 0 ? regions[regions.length - 1].outPoint : duration
    seekRef.current(Math.max(lo, Math.min(hi, currentTimeRef.current + seconds)))
  }, [duration])

  // Thumbnail strip
  const [filmstripEl, setFilmstripEl] = useState<HTMLDivElement | null>(null)
  const [stripWidth, setStripWidth] = useState(0)
  const [hoverRatio, setHoverRatio] = useState<number | null>(null)
  const isPlayheadDraggingRef = useRef(false)

  useEffect(() => {
    if (!filmstripEl) return
    setStripWidth(filmstripEl.getBoundingClientRect().width)
    const ro = new ResizeObserver(entries => setStripWidth(entries[0].contentRect.width))
    ro.observe(filmstripEl)
    return () => ro.disconnect()
  }, [filmstripEl])

  // Non-passive wheel listener for zoom — attached to the wrapper so the region drag
  // overlay (which sits above the individual strips) doesn't block scroll-to-zoom.
  // filmstripEl is a state-based callback ref, so including it triggers re-registration
  // once the strips are actually mounted inside the conditional videoUrl render.
  useEffect(() => {
    const el = stripsWrapperRef.current
    if (!el) return
    const handler = (e: WheelEvent) => handleZoom(e, el.getBoundingClientRect())
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [handleZoom, filmstripEl])

  const waveformSources = useMemo(() => {
    if (!state.filePath) return []
    if (tracksExtracted) {
      const paths = state.tracks.map(t => t.tempPath).filter((p): p is string => !!p)
      return paths.length > 0 ? paths : [state.filePath]
    }
    return [state.filePath]
  }, [state.filePath, tracksExtracted, state.tracks])

  const { svgPath: waveformPath, peakCount, loading: waveformLoading } = useWaveform(waveformSources, vStart, vEnd, duration)

  const { thumbnails, generating, zoomGenerating } = useThumbnailStrip(
    state.filePath ?? null,
    videoUrl ?? null,
    duration,
    videoInfo?.width ?? 0,
    videoInfo?.height ?? 0,
    stripWidth,
    vStart,
    vEnd
  )

  const [showExportDialog, setShowExportDialog] = useState(false)

  // Add a new segment centered on the playhead, sized to ~10% of the visible span.
  const addSegment = useCallback(() => {
    const fps = videoInfoRef.current?.fps ?? 30
    const frameTime = 1 / fps
    const t = currentTimeRef.current
    const dur = durationRef.current
    const { lo, hi } = getSegmentFreeInterval(clipStateRef.current.clipRegions, t, dur)
    const available = hi - lo
    if (available < 2 * frameTime) {
      setAddSegmentError('No room at playhead')
      setTimeout(() => setAddSegmentError(null), 2500)
      return
    }
    const { viewStart, viewEnd } = viewportRef.current
    const desired = Math.max(2 * frameTime, (viewEnd - viewStart) * 0.10)
    const segDur   = Math.min(desired, available)
    let segIn  = t - segDur / 2
    let segOut = t + segDur / 2
    if (segIn  < lo) { segIn = lo; segOut = lo + segDur }
    if (segOut > hi) { segOut = hi; segIn = hi - segDur }
    const newRegion: ClipRegion = { id: `seg-${uuidv4()}`, inPoint: segIn, outPoint: segOut }
    setClipState(s => ({
      ...s,
      clipRegions: [...s.clipRegions, newRegion].sort((a, b) => a.inPoint - b.inPoint),
    }))
  }, [])

  // Split the clip region that contains the playhead into two regions at the playhead.
  const splitSegment = useCallback(() => {
    const fps = videoInfoRef.current?.fps ?? 30
    const frameTime = 1 / fps
    const t = currentTimeRef.current
    setClipState(s => {
      const seg = s.clipRegions.find(r => t > r.inPoint + frameTime && t < r.outPoint - frameTime)
      if (!seg) return s
      const left: ClipRegion  = { id: `seg-${uuidv4()}`, inPoint: seg.inPoint, outPoint: t }
      const right: ClipRegion = { id: `seg-${uuidv4()}`, inPoint: t, outPoint: seg.outPoint }
      return {
        ...s,
        clipRegions: s.clipRegions
          .filter(r => r.id !== seg.id)
          .concat(left, right)
          .sort((a, b) => a.inPoint - b.inPoint),
      }
    })
  }, [])

  const runExport = useCallback(async (opts: ExportClipOptions) => {
    if (!state.filePath || !videoInfo || clipState.clipRegions.length === 0) return
    setShowExportDialog(false)

    // Flush the debounced draft save so activeDraftIdRef is current when we capture the pending export.
    // Without this, a user who exports within 500ms of their last edit would capture draftId=null,
    // and the post-export tag wouldn't know which draft to clear.
    await flushDraftSave()

    let clipPreset: { id: string; name: string; ffmpegArgs: string; outputExtension: string; isBuiltin: boolean } | null = null
    if (opts.presetId) {
      const [builtin, imported] = await Promise.all([window.api.getBuiltinPresets(), window.api.getImportedPresets()])
      clipPreset = [...builtin, ...imported].find(p => p.id === opts.presetId) ?? null
    }

    const ext = clipPreset?.outputExtension || (state.filePath.split(/[\\/]/).pop()!.split('.').pop() ?? 'mkv')
    const base = state.filePath.replace(/[\\/]/g, '/').split('/').pop()!.replace(/\.[^.]+$/, '')
    const outDir = opts.outputDir.replace(/\\/g, '/')
    const outPath = `${outDir}/${base}${opts.suffix}.${ext}`

    const syntheticPreset = clipPreset ?? {
      id: 'clip-export',
      name: 'Clip Export',
      ffmpegArgs: '',
      outputExtension: ext,
      isBuiltin: false,
    }
    const job = {
      id: uuidv4(),
      inputFile: state.filePath,
      outputFile: outPath,
      preset: syntheticPreset,
      status: 'queued' as const,
      progress: 0,
    }
    setJobs(prev => [...prev, job])

    // Register the pending export so onJobComplete can tag the output file with clipOf + clipState
    // (enabling the "reopen in clip editor" button) and drop the corresponding draft.
    const sourceName = state.filePath.replace(/.*[\\/]/, '')
    const outputFilename = outPath.replace(/.*\//, '')
    const outputFolder = outPath.substring(0, outPath.lastIndexOf('/'))
    pendingExportsRef.current.set(job.id, {
      sourceName,
      clipStateSnapshot: clipState,
      draftId: activeDraftIdRef.current,
      outputFilename,
      outputFolder,
    })
    // Mark the draft as exporting so the panel can lock it until the job finishes.
    if (activeDraftIdRef.current) {
      const lockedId = activeDraftIdRef.current
      setExportingDraftIds(prev => new Set(prev).add(lockedId))
    }

    await window.api.addClipToQueue({
      job,
      clipRegions:  clipState.clipRegions.map(r => ({
        id: r.id,
        inPoint: r.inPoint,
        outPoint: r.outPoint,
        cropX: r.cropX ?? clipState.cropX,
        cropY: r.cropY ?? 0.5,
        cropScale: r.cropScale ?? 1,
      })),
      cropAspect:   clipState.cropAspect,
      cropX:        clipState.cropX,
      videoWidth:   videoInfo.width,
      videoHeight:  videoInfo.height,
      bleepRegions: clipState.bleepRegions,
      bleepVolume:  clipState.bleepVolume,
    })

    // The clip is now in the converter's hands; close the editor so returning to the player
    // later doesn't resurrect the draft as a fresh editing session.
    exitClipModeRef.current()
    onNavigateToConverter?.()
  }, [state.filePath, videoInfo, clipState, setJobs, onNavigateToConverter, flushDraftSave])

  const [screenshotFlash, setScreenshotFlash] = useState(false)
  const [isPopupOpen, setIsPopupOpen] = useState(false)
  isPopupOpenRef.current      = isPopupOpen
  isPlayingRef.current = isPlaying

  // When popup closes: tear down WebRTC connection
  useEffect(() => {
    return window.api.onVideoPopupClosed(() => {
      setIsPopupOpen(false)
      popupRtcCleanupRef.current?.()
      popupRtcCleanupRef.current = null
      popupPCRef.current?.close()
      popupPCRef.current = null
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const openVideoPopup = useCallback(async () => {
    if (!videoInfo) return
    const videoEl = videoRef.current
    if (!videoEl) return

    // Tear down any previous connection before creating a new one
    popupRtcCleanupRef.current?.()
    popupRtcCleanupRef.current = null
    popupPCRef.current?.close()
    popupPCRef.current = null

    // Capture video-only stream from the main window's <video> element.
    // captureStream() delivers already-decoded frames — the popup never
    // touches the file or decoder directly, so there is no cold-start lag.
    const rawStream = (videoEl as HTMLVideoElement & { captureStream(): MediaStream }).captureStream()
    const [videoTrack] = rawStream.getVideoTracks()
    if (!videoTrack) return

    // For a local (in-memory) connection there is no real bandwidth limit.
    // Target 2× the source bitrate so re-encoding never becomes the bottleneck,
    // with a floor of 50 Mbps and a ceiling of 200 Mbps.
    const sourceBps   = (videoInfo.videoBitrate && isFinite(videoInfo.videoBitrate)) ? videoInfo.videoBitrate : 0
    const targetBps   = Math.min(200_000_000, Math.max(50_000_000, sourceBps * 2))

    const pc = new RTCPeerConnection({ iceServers: [] })
    popupPCRef.current = pc

    // addTransceiver gives us direct access to codec preferences and encoding params
    const transceiver = pc.addTransceiver(videoTrack, {
      direction: 'sendonly',
      sendEncodings: [{
        maxBitrate: targetBps,
        degradationPreference: 'maintain-resolution',
      } as RTCRtpEncodingParameters],
    })

    // H264 is rejected by setCodecPreferences in this Electron build regardless
    // of how it's listed — exclude it and prefer AV1 → VP9.
    // Keep RTX/RED/FEC entries in the list (removing them causes validation errors).
    const allCodecs = RTCRtpSender.getCapabilities('video')?.codecs ?? []
    const codecPriority = (c: { mimeType: string }) => {
      if (/av1/i.test(c.mimeType)) return 0
      if (/vp9/i.test(c.mimeType)) return 1
      return 2  // VP8, RTX, RED, ULPFEC, etc.
    }
    const sorted = [...allCodecs]
      .filter(c => !/h264/i.test(c.mimeType))
      .sort((a, b) => codecPriority(a) - codecPriority(b))
    if (sorted.length > 0) {
      try { transceiver.setCodecPreferences(sorted) } catch { /* fall back to browser default */ }
    }

    // Create offer and wait for ICE gathering to finish before sending.
    // "Vanilla ICE": all candidates are embedded in the SDP so there's no
    // trickle-ICE race condition between the two renderer processes.
    const offer = await pc.createOffer()
    await pc.setLocalDescription({ type: 'offer', sdp: injectSdpBandwidth(offer.sdp!, targetBps) })
    await waitForIceComplete(pc)
    const offerSdp = pc.localDescription!.sdp

    // Listen for the answer SDP from the popup (one-shot)
    popupRtcCleanupRef.current = window.api.onPopupRtcSignal(async (data) => {
      const msg = data as { type: string; sdp?: string }
      if (!popupPCRef.current || msg.type !== 'answer' || !msg.sdp) return
      await popupPCRef.current.setRemoteDescription(
        new RTCSessionDescription({ type: 'answer', sdp: msg.sdp })
      )
      // Reinforce the bitrate cap after negotiation — Chrome's congestion
      // control can override encoding params; setting them again post-answer
      // ensures the high cap is applied for the life of the connection.
      const sender = popupPCRef.current.getSenders().find(s => s.track?.kind === 'video')
      if (sender) {
        const params = sender.getParameters()
        if (params.encodings.length === 0) params.encodings = [{}]
        params.encodings[0].maxBitrate = targetBps
        ;(params.encodings[0] as any).degradationPreference = 'maintain-resolution'
        sender.setParameters(params).catch(() => {})
      }
      setIsPopupOpen(true)
    })

    // Open popup window, passing the offer SDP so the popup can answer immediately.
    // cropX source: active region's cropX if present, else the session default.
    // Popup currently only honors '9:16' crops; other aspects are ignored visually.
    const popupCropX = activeCropRegion?.cropX ?? clipState.cropX
    window.api.openVideoPopup(
      offerSdp,
      videoInfo.width, videoInfo.height,
      clipState.cropAspect === '9:16' ? '9:16' : undefined,
      clipState.cropAspect === '9:16' ? popupCropX : undefined,
    )
  }, [videoInfo, clipState.cropAspect, clipState.cropX, activeCropRegion])

  // Push live crop changes to popup when the active region's crop changes.
  useEffect(() => {
    if (!isPopupOpen || !videoInfo) return
    const popupCropX = activeCropRegion?.cropX ?? clipState.cropX
    window.api.setCropPopup?.(videoInfo.width, videoInfo.height, clipState.cropAspect, popupCropX)
  }, [clipState.cropAspect, clipState.cropX, activeCropRegion, videoInfo]) // eslint-disable-line react-hooks/exhaustive-deps

  const effectiveTogglePlay = useCallback(() => {
    togglePlay()
  }, [togglePlay])

  const captureScreenshot = useCallback(async () => {
    const vid = videoRef.current
    if (!vid || !state.filePath) return
    const canvas = document.createElement('canvas')
    canvas.width = vid.videoWidth
    canvas.height = vid.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(vid, 0, 0)
    const fps = videoInfo?.fps ?? 30
    const t = currentTime
    const hh = Math.floor(t / 3600)
    const mm = Math.floor((t % 3600) / 60)
    const ss = Math.floor(t % 60)
    const ff = Math.floor((t % 1) * fps)
    const timecode = `${String(hh).padStart(2,'0')}h${String(mm).padStart(2,'0')}m${String(ss).padStart(2,'0')}s${String(ff).padStart(2,'0')}f`
    const base64 = canvas.toDataURL('image/png').split(',')[1]
    const videoDir = state.filePath.replace(/[\\/][^\\/]+$/, '')
    const videoBase = state.filePath.replace(/[\\/]/g, '/').split('/').pop()!.replace(/\.[^.]+$/, '')
    const destPath = `${videoDir}/${videoBase}_${timecode}.png`
    await window.api.saveScreenshot(destPath, base64)
    setScreenshotFlash(true)
    setTimeout(() => setScreenshotFlash(false), 150)
  }, [videoRef, state.filePath, videoInfo, currentTime])

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────
  // Build a flat session-videos list (matching display order in the panel) for
  // Ctrl+Alt+Up/Down navigation.
  const flatSessionItems = React.useMemo(() => {
    const seenNames = new Set(siblingFiles.map(v => v.name))
    const draftsBySource = folderDrafts.reduce<Record<string, import('../../types').ClipDraft[]>>((acc, d) => {
      (acc[d.sourceName] ||= []).push(d); return acc
    }, {})
    const clipChildren: Record<string, SiblingFile[]> = {}
    const topLevelSiblings: SiblingFile[] = []
    for (const s of siblingFiles) {
      if (s.clipOf && seenNames.has(s.clipOf)) (clipChildren[s.clipOf] ||= []).push(s)
      else topLevelSiblings.push(s)
    }
    const out: Array<{ kind: 'video' | 'draft'; video?: SiblingFile; draft?: import('../../types').ClipDraft }> = []
    for (const item of topLevelSiblings) {
      out.push({ kind: 'video', video: item })
      for (const d of draftsBySource[item.name] ?? []) out.push({ kind: 'draft', draft: d })
      for (const c of clipChildren[item.name] ?? []) out.push({ kind: 'video', video: c })
    }
    for (const [name, list] of Object.entries(draftsBySource)) {
      if (!seenNames.has(name)) for (const d of list) out.push({ kind: 'draft', draft: d })
    }
    return out
  }, [siblingFiles, folderDrafts])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't fire while user is typing
      const target = e.target as HTMLElement | null
      const tag = target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) return
      // Don't fire while a player modal is open
      if (clipModeModal || draftPendingDelete || showExportDialog) return

      const ctrl = e.ctrlKey || e.metaKey
      const shift = e.shiftKey
      const alt = e.altKey
      const k = e.key

      // Space — Play/Pause
      if (e.code === 'Space' && !ctrl && !alt && !shift) {
        e.preventDefault(); effectiveTogglePlay(); return
      }

      // Arrow keys — frame step / skip
      if (k === 'ArrowLeft' || k === 'ArrowRight') {
        if (ctrl && alt) return // reserve Ctrl+Alt for other future combos
        const dir = k === 'ArrowRight' ? 1 : -1
        e.preventDefault()
        if (ctrl && shift) skip(dir * 10)
        else if (ctrl) skip(dir * 5)
        else if (shift) skip(dir * 1)
        else stepFrame(dir as 1 | -1)
        return
      }

      // Home / End
      if (k === 'Home' && !ctrl && !alt && !shift) { e.preventDefault(); seekRef.current(0); return }
      if (k === 'End'  && !ctrl && !alt && !shift) { e.preventDefault(); seekRef.current(durationRef.current); return }

      // Ctrl+Alt+Up/Down — navigate session videos
      if (ctrl && alt && !shift && (k === 'ArrowUp' || k === 'ArrowDown')) {
        e.preventDefault()
        if (flatSessionItems.length === 0) return
        const currentIdx = flatSessionItems.findIndex(it =>
          (it.kind === 'video' && it.video!.path === state.filePath && !activeDraftId) ||
          (it.kind === 'draft' && it.draft!.id === activeDraftId)
        )
        const nextIdx = currentIdx < 0
          ? (k === 'ArrowDown' ? 0 : flatSessionItems.length - 1)
          : Math.max(0, Math.min(flatSessionItems.length - 1, currentIdx + (k === 'ArrowDown' ? 1 : -1)))
        const target = flatSessionItems[nextIdx]
        if (target.kind === 'video' && target.video) {
          // If we're leaving a clip draft for a plain video, exit clip mode first so the
          // autosave effect doesn't carry the previous draft's state onto the new file.
          if (isClipModeRef.current && target.video.path !== state.filePath) exitClipMode()
          loadFile(target.video.path)
        } else if (target.kind === 'draft' && target.draft) {
          loadDraft(target.draft)
        }
        return
      }

      // Ctrl+O — open file dialog
      if (ctrl && !alt && !shift && (k === 'o' || k === 'O')) {
        e.preventDefault(); handleBrowse(); return
      }

      // Ctrl+Shift+S — screenshot
      if (ctrl && shift && !alt && (k === 's' || k === 'S')) {
        e.preventDefault(); captureScreenshot(); return
      }

      // 0 — reset zoom
      if (!ctrl && !alt && !shift && k === '0') {
        e.preventDefault()
        setViewport({ viewStart: 0, viewEnd: durationRef.current })
        return
      }

      // Numpad +/- — zoom timeline anchored on playhead
      if (!ctrl && !alt && !shift && (e.code === 'NumpadAdd' || e.code === 'NumpadSubtract')) {
        e.preventDefault()
        const { viewStart, viewEnd } = viewportRef.current
        const span = viewEnd - viewStart
        if (span <= 0) return
        const factor = e.code === 'NumpadAdd' ? 0.7 : 1.4
        const newSpan = Math.max(0.05, Math.min(durationRef.current, span * factor))
        const t = currentTimeRef.current
        // Anchor on playhead — keep its relative position within the viewport
        const ratio = (t - viewStart) / span
        let ns = t - ratio * newSpan
        let ne = ns + newSpan
        if (ns < 0) { ns = 0; ne = newSpan }
        if (ne > durationRef.current) { ne = durationRef.current; ns = ne - newSpan }
        setViewport({ viewStart: Math.max(0, ns), viewEnd: Math.min(durationRef.current, ne) })
        return
      }

      // No-modifier letter shortcuts
      if (!ctrl && !alt && !shift) {
        // YouTube JKL — J/L = ±10s, K = play/pause
        if (k === 'j' || k === 'J') { e.preventDefault(); skip(-10); return }
        if (k === 'k' || k === 'K') { e.preventDefault(); effectiveTogglePlay(); return }
        if (k === 'l' || k === 'L') { e.preventDefault(); skip(10);  return }

        // C — toggle clip mode (mirror the toolbar button's logic). Show
        // the merge-warning modal only when a merge is genuinely needed
        // and not already running, and the user hasn't opted out.
        if (k === 'c' || k === 'C') {
          e.preventDefault()
          if (isClipModeRef.current) exitClipMode()
          else if (multiTrack && !tracksExtracted && !isExtracting && !config.skipClipMergeWarning) {
            setClipModeModal('warn')
          }
          else setIsClipMode(true)
          return
        }
        // F — toggle clip focus
        if (k === 'f' || k === 'F') { e.preventDefault(); setClipFocus(v => !v); return }
        // P — toggle pop-out video
        if (k === 'p' || k === 'P') {
          e.preventDefault()
          if (isPopupOpen) window.api.closeVideoPopup()
          else openVideoPopup()
          return
        }
        // T — focus playhead timecode input
        if (k === 't' || k === 'T') {
          if (!durationRef.current) return
          e.preventDefault()
          setTimecodeInput(formatViewTime(currentTimeRef.current, videoInfoRef.current?.fps))
          setEditingTimecode(true)
          setTimeout(() => timecodeInputRef.current?.select(), 0)
          return
        }
        // Esc — close session
        if (k === 'Escape') {
          if (state.filePath) { e.preventDefault(); closeVideo() }
          return
        }
      }

      // ── Clip mode only ──────────────────────────────────────────────────
      if (!isClipModeRef.current) return

      if (!ctrl && !alt && !shift) {
        // A — add segment at playhead
        if (k === 'a' || k === 'A') { e.preventDefault(); addSegment(); return }
        // S — split segment at playhead
        if (k === 's' || k === 'S') { e.preventDefault(); splitSegment(); return }
        // B — add bleep at playhead (mirrors the existing button)
        if (k === 'b' || k === 'B') {
          e.preventDefault()
          const t = currentTimeRef.current
          const dur = durationRef.current
          const { lo, hi } = getBleepFreeInterval(clipStateRef.current.bleepRegions, t, dur)
          let s = t - 0.25, end = t + 0.25
          if (s < lo) { s = lo; end = s + 0.5 }
          if (end > hi) { end = hi; s = end - 0.5 }
          s = Math.max(lo, Math.max(0, s))
          end = Math.min(hi, Math.min(dur, end))
          if (end - s < 0.25) return
          const newId = `bleep-${Date.now()}`
          setClipState(cs => ({ ...cs, bleepRegions: [...cs.bleepRegions, { id: newId, start: s, end }] }))
          setActiveBleepId(newId)
          setBleepLengthInput((end - s).toFixed(2))
          return
        }
        // Delete/Backspace — delete selected segment or active bleep
        if (k === 'Delete' || k === 'Backspace') {
          if (activeBleepId) {
            e.preventDefault()
            const idToDelete = activeBleepId
            setClipState(cs => ({ ...cs, bleepRegions: cs.bleepRegions.filter(b => b.id !== idToDelete) }))
            setActiveBleepId(null)
          } else if (selectedRegionIdRef.current) {
            e.preventDefault()
            const idToDelete = selectedRegionIdRef.current
            setClipState(cs => ({ ...cs, clipRegions: cs.clipRegions.filter(r => r.id !== idToDelete) }))
            setSelectedRegionId(null)
          }
          return
        }
        // [ / ] — jump to prev/next clip region marker (in/out points, chronological)
        if (k === '[' || k === ']') {
          e.preventDefault()
          const markers: number[] = []
          for (const r of clipStateRef.current.clipRegions) { markers.push(r.inPoint, r.outPoint) }
          if (markers.length === 0) return
          markers.sort((a, b) => a - b)
          const t = currentTimeRef.current
          const eps = 0.001
          let target: number | undefined
          if (k === ']') target = markers.find(m => m > t + eps)
          else { for (let i = markers.length - 1; i >= 0; i--) { if (markers[i] < t - eps) { target = markers[i]; break } } }
          if (target !== undefined) seekRef.current(target)
          return
        }
      }

      // Ctrl+E — open Export Clip dialog (clip mode only)
      if (ctrl && !alt && !shift && (k === 'e' || k === 'E')) {
        e.preventDefault()
        if (clipStateRef.current.clipRegions.length > 0) setShowExportDialog(true)
        return
      }
    }

    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [
    clipModeModal, draftPendingDelete, showExportDialog,
    effectiveTogglePlay, skip, stepFrame, multiTrack, tracksExtracted, isExtracting,
    config.skipClipMergeWarning, exitClipMode,
    setClipFocus, isPopupOpen, openVideoPopup, handleBrowse, captureScreenshot,
    closeVideo, state.filePath, addSegment, splitSegment,
    activeBleepId, flatSessionItems, loadFile, loadDraft, activeDraftId,
  ])

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {!videoUrl ? (
        /* Empty state */
        <div className="flex-1 flex flex-col items-center justify-center gap-3 p-8">
          <FileDropZone
            onFiles={handleFiles}
            accept={['mkv', 'mp4', 'mov', 'avi', 'ts', 'flv', 'webm']}
            label="Drop a video file here or click to browse"
            className="w-full max-w-lg"
          />
          <p className="text-xs text-gray-600">You can also send a video here from the Streams page using the action buttons on each row.</p>
        </div>
      ) : (
        <div className="flex flex-1 overflow-hidden">
          {/* Video + controls column */}
          <div className="flex flex-col flex-1 overflow-hidden">
            {/* Video */}
            <FileDropZone onFiles={handleFiles} className="flex-1 relative bg-black min-h-0 group">
              {/* Container observed for crop overlay geometry */}
              <div ref={setVideoContainerEl} className="absolute inset-0 overflow-hidden">
                {/* Zoom / pan wrapper */}
                <div
                  onMouseDown={startVideoPanDrag}
                  style={{
                    width: '100%', height: '100%',
                    transformOrigin: '0 0',
                    transform: `translate(${videoPan.x}px, ${videoPan.y}px) scale(${videoZoom})`,
                    cursor: isVideoPanning ? 'grabbing' : undefined,
                  }}
                >
                  <video
                    ref={videoRef}
                    src={videoUrl ?? undefined}
                    className="w-full h-full object-contain cursor-pointer"
                    preload="auto"
                    onClick={effectiveTogglePlay}
                  />
                  {/* Crop overlay — values come from the active clip region + selected aspect */}
                  {isClipMode && clipState.cropAspect !== 'off' && videoInfo && vcSize.w > 0 && (() => {
                    const rCropX = activeCropRegion?.cropX ?? DEFAULT_CROP_X
                    const rCropY = activeCropRegion?.cropY ?? DEFAULT_CROP_Y
                    const rCropScale = activeCropRegion?.cropScale ?? DEFAULT_CROP_SCALE
                    const ar = aspectRatio(clipState.cropAspect, videoInfo.width, videoInfo.height)
                    const { contentLeft, contentTop, contentW, contentH, cropW, cropH, cropLeft, cropTop, availableRangeX, availableRangeY } = getCropGeometry(
                      vcSize.w, vcSize.h, videoInfo.width, videoInfo.height, rCropX, rCropY, rCropScale, ar
                    )
                    const canX = availableRangeX > 0.5
                    const canY = availableRangeY > 0.5
                    const dragCursor = canX && canY ? 'move' : canX ? 'ew-resize' : canY ? 'ns-resize' : 'default'
                    const handleClass = 'absolute w-3 h-3 border-2 border-white/90 bg-black/50 rounded-sm'
                    const inactive = !activeCropRegion
                    return (
                      <>
                        {/* Top darkened region */}
                        <div className="absolute bg-black/60 pointer-events-none"
                          style={{ left: contentLeft, top: contentTop, width: contentW, height: Math.max(0, cropTop - contentTop) }} />
                        {/* Bottom darkened region */}
                        <div className="absolute bg-black/60 pointer-events-none"
                          style={{ left: contentLeft, top: cropTop + cropH, width: contentW, height: Math.max(0, contentTop + contentH - (cropTop + cropH)) }} />
                        {/* Left darkened region (between top and bottom) */}
                        <div className="absolute bg-black/60 pointer-events-none"
                          style={{ left: contentLeft, top: cropTop, width: Math.max(0, cropLeft - contentLeft), height: cropH }} />
                        {/* Right darkened region */}
                        <div className="absolute bg-black/60 pointer-events-none"
                          style={{ left: cropLeft + cropW, top: cropTop, width: Math.max(0, contentLeft + contentW - (cropLeft + cropW)), height: cropH }} />
                        {/* Crop frame — draggable (disabled when no active region) */}
                        <div
                          className={`absolute border-2 ${inactive ? 'border-white/30' : 'border-white/80'}`}
                          style={{ left: cropLeft, top: cropTop, width: cropW, height: cropH, cursor: inactive ? 'default' : dragCursor }}
                          onMouseDown={inactive ? undefined : handleCropDrag}
                        />
                        {/* Corner resize handles — only when there's an active region */}
                        {!inactive && (
                          <>
                            <div className={`${handleClass} cursor-nwse-resize`}
                              style={{ left: cropLeft - 6, top: cropTop - 6 }}
                              onMouseDown={e => handleCropCornerResize(e, 'tl')} />
                            <div className={`${handleClass} cursor-nesw-resize`}
                              style={{ left: cropLeft + cropW - 6, top: cropTop - 6 }}
                              onMouseDown={e => handleCropCornerResize(e, 'tr')} />
                            <div className={`${handleClass} cursor-nesw-resize`}
                              style={{ left: cropLeft - 6, top: cropTop + cropH - 6 }}
                              onMouseDown={e => handleCropCornerResize(e, 'bl')} />
                            <div className={`${handleClass} cursor-nwse-resize`}
                              style={{ left: cropLeft + cropW - 6, top: cropTop + cropH - 6 }}
                              onMouseDown={e => handleCropCornerResize(e, 'br')} />
                          </>
                        )}
                      </>
                    )
                  })()}
                </div>
              </div>

              {/* Zoom level indicator — click to reset */}
              {videoZoom !== 1 && (
                <Tooltip content="Click to reset zoom (scroll wheel to zoom, middle-click drag to pan)">
                  <button
                    onClick={() => {
                      setVideoZoom(1); setVideoPan({ x: 0, y: 0 })
                      videoZoomRef.current = 1; videoPanRef.current = { x: 0, y: 0 }
                    }}
                    className="absolute top-3 left-3 z-10 text-xs font-mono bg-black/70 text-white/80 hover:text-white hover:bg-black/90 px-2 py-1 rounded transition-colors"
                  >
                    {Math.round(videoZoom * 100)}%
                  </button>
                </Tooltip>
              )}

              {/* Screenshot flash */}
              {screenshotFlash && (
                <div className="absolute inset-0 bg-white/30 pointer-events-none" />
              )}

              {/* Screenshot + popup buttons — visible on hover */}
              <div className="absolute bottom-3 right-3 flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <Tooltip content="Save screenshot (PNG)">
                  <button
                    onClick={captureScreenshot}
                    className="p-2 rounded-lg bg-black/60 text-white/70 hover:text-white hover:bg-black/80"
                  >
                    <Camera size={16} />
                  </button>
                </Tooltip>
                {videoUrl && (
                  <Tooltip content={isPopupOpen ? 'Return video to player' : 'Pop out video (for OBS capture)'}>
                    <button
                      onClick={isPopupOpen ? () => window.api.closeVideoPopup() : openVideoPopup}
                      className={`p-2 rounded-lg bg-black/60 hover:bg-black/80 transition-colors ${isPopupOpen ? 'text-purple-400 hover:text-purple-300' : 'text-white/70 hover:text-white'}`}
                    >
                      <Tv2 size={16} />
                    </button>
                  </Tooltip>
                )}
              </div>

              {/* Popup placeholder — shown when video is open in the popup window */}
              {isPopupOpen && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/80 pointer-events-none">
                  <Tv2 size={28} className="text-purple-400 opacity-60" />
                  <p className="text-sm text-gray-400">Video opened in separate window</p>
                  <p className="text-xs text-gray-600">Controls still work from here</p>
                </div>
              )}

            </FileDropZone>

            {/* Playback controls */}
            <div className="bg-navy-800 border-t border-white/5 px-4 py-3 flex flex-col gap-2 shrink-0">

              {/* Clip mode toolbar */}
              {isClipMode && (
                <div className="flex flex-col gap-0 -mx-1">
                  <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-t-lg bg-blue-950/40 border border-blue-500/20">
                    <button
                      onClick={exitClipMode}
                      className="flex items-center gap-1 shrink-0 px-1.5 py-0.5 rounded text-[11px] font-medium text-gray-300 border border-white/15 bg-white/5 hover:bg-white/10 transition-colors"
                    >
                      <X size={12} />
                      Stop<span className="hidden 2xl:inline"> Clipping</span>
                    </button>
                    <div className="w-px h-3 bg-white/10 mx-1 shrink-0" />

                    {/* Add Segment / Split Segment button */}
                    {(() => {
                      const fps = videoInfo?.fps ?? 30
                      const frameTime = 1 / fps
                      // Use frozen playhead position during handle drag so the button
                      // doesn't flicker as the handle sweeps through the region
                      const playheadTime = handleDragDisplayTime ?? currentTime
                      const insideSeg = clipState.clipRegions.find(r => playheadTime >= r.inPoint && playheadTime <= r.outPoint)
                      if (insideSeg) {
                        const canSplit = playheadTime > insideSeg.inPoint + frameTime && playheadTime < insideSeg.outPoint - frameTime
                        return (
                          <div className="relative group">
                            <Tooltip content="Split the current segment into 2 at the playhead" side="top">
                              <button
                                onClick={splitSegment}
                                disabled={!canSplit}
                                className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] text-purple-400 border border-purple-500/30 hover:bg-purple-950/60 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                              >
                                <Scissors size={11} /> Split<span className="hidden 2xl:inline"> Segment</span>
                              </button>
                            </Tooltip>
                            {!canSplit && (
                              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 text-[10px] text-yellow-200 bg-yellow-950 border border-yellow-600/40 rounded whitespace-nowrap pointer-events-none z-50 opacity-0 group-hover:opacity-100 transition-opacity">
                                Too close to segment edge
                              </div>
                            )}
                          </div>
                        )
                      }
                      const { lo, hi } = getSegmentFreeInterval(clipState.clipRegions, playheadTime, duration)
                      const noRoom = (hi - lo) < 2 * frameTime
                      return (
                        <div className="relative group">
                          <button
                            onClick={addSegment}
                            disabled={noRoom}
                            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] text-blue-400 border border-blue-500/30 hover:bg-blue-950/60 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            <PlusSquare size={11} /> Add<span className="hidden 2xl:inline"> Segment</span>
                          </button>
                          {(noRoom || addSegmentError) && (
                            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 text-[10px] text-yellow-200 bg-yellow-950 border border-yellow-600/40 rounded whitespace-nowrap pointer-events-none z-50 opacity-0 group-hover:opacity-100 transition-opacity">
                              {addSegmentError ?? 'No room at playhead'}
                            </div>
                          )}
                        </div>
                      )
                    })()}
                    <Tooltip content={clipFocus ? 'Clip Focus on — playback skips gaps between segments' : 'Clip Focus — skip gaps between segments during playback'}>
                      <button
                        onClick={() => setClipFocus(v => !v)}
                        disabled={clipState.clipRegions.length === 0}
                        className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                          clipFocus
                            ? 'text-blue-200 border-blue-400/50 bg-blue-500/25 hover:bg-blue-500/35'
                            : 'text-blue-400/70 border-blue-500/20 hover:bg-blue-950/60'
                        }`}
                      >
                        <Repeat size={11} /> Focus
                      </button>
                    </Tooltip>

                    <div className="w-px h-3 bg-white/10 mx-1 shrink-0" />

                    <Tooltip content="Add a bleep at the current playhead position">
                      <button
                        onClick={() => {
                        const t = currentTime
                        const dur = duration
                        const { lo, hi } = getBleepFreeInterval(clipState.bleepRegions, t, dur)
                        let s = t - 0.25, end = t + 0.25
                        if (s < lo) { s = lo; end = s + 0.5 }
                        if (end > hi) { end = hi; s = end - 0.5 }
                        s   = Math.max(lo, Math.max(0, s))
                        end = Math.min(hi, Math.min(dur, end))
                        if (end - s < 0.25) return
                        const newId = `bleep-${Date.now()}`
                        setClipState(cs => ({ ...cs, bleepRegions: [...cs.bleepRegions, { id: newId, start: s, end }] }))
                        setActiveBleepId(newId)
                        setBleepLengthInput((end - s).toFixed(2))
                      }}
                        className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] text-gray-400 border border-white/20 hover:text-blue-300 hover:border-blue-400/40 transition-colors"
                      >
                        <AudioWaveform size={11} /> <span className="hidden 2xl:inline">Add </span>Bleep
                      </button>
                    </Tooltip>

                    <div className="w-px h-3 bg-white/10 mx-1 shrink-0" />

                    <CropAspectSelector
                      value={clipState.cropAspect}
                      onChange={a => setClipState(s => ({ ...s, cropAspect: a }))}
                      videoW={videoInfo?.width}
                      videoH={videoInfo?.height}
                    />
                    {clipState.cropAspect !== 'off' && videoInfo && (() => {
                      const ar = aspectRatio(clipState.cropAspect, videoInfo.width, videoInfo.height)
                      const videoAspect = videoInfo.width / videoInfo.height
                      const maxW = ar > videoAspect ? videoInfo.width : videoInfo.height * ar
                      const maxH = ar > videoAspect ? videoInfo.width / ar : videoInfo.height
                      const cx = activeCropRegion?.cropX ?? DEFAULT_CROP_X
                      const cy = activeCropRegion?.cropY ?? DEFAULT_CROP_Y
                      const cs = activeCropRegion?.cropScale ?? DEFAULT_CROP_SCALE
                      const cropW = maxW * cs
                      const cropH = maxH * cs
                      const offsetX = Math.round((cx - 0.5) * (videoInfo.width - cropW))
                      const offsetY = Math.round((cy - 0.5) * (videoInfo.height - cropH))
                      const dispW = Math.round(cropW)
                      const dispH = Math.round(cropH)
                      const disabled = !activeCropRegion
                      const apply = (patch: { cropX?: number; cropY?: number; cropScale?: number }) => {
                        if (!activeCropRegion) return
                        updateRegionCrop(activeCropRegion.id, patch)
                      }
                      const setOffsetX = (px: number) => {
                        const range = videoInfo.width - cropW
                        if (range <= 0) return
                        const clamped = Math.max(-range / 2, Math.min(range / 2, px))
                        apply({ cropX: clamped / range + 0.5 })
                      }
                      const setOffsetY = (px: number) => {
                        const range = videoInfo.height - cropH
                        if (range <= 0) return
                        const clamped = Math.max(-range / 2, Math.min(range / 2, px))
                        apply({ cropY: clamped / range + 0.5 })
                      }
                      const setWidth = (px: number) => {
                        const newScale = Math.max(MIN_CROP_SCALE, Math.min(1, px / maxW))
                        // Re-clamp position to keep crop inside the frame at the new size
                        const newCropW = maxW * newScale
                        const newCropH = maxH * newScale
                        const rangeX = videoInfo.width - newCropW
                        const rangeY = videoInfo.height - newCropH
                        const newCx = rangeX > 0 ? Math.max(0, Math.min(1, (offsetX + rangeX / 2) / rangeX)) : 0.5
                        const newCy = rangeY > 0 ? Math.max(0, Math.min(1, (offsetY + rangeY / 2) / rangeY)) : 0.5
                        apply({ cropScale: newScale, cropX: newCx, cropY: newCy })
                      }
                      const setHeight = (px: number) => setWidth((px / maxH) * maxW)
                      const reset = () => apply({ cropX: DEFAULT_CROP_X, cropY: DEFAULT_CROP_Y, cropScale: DEFAULT_CROP_SCALE })
                      // Tighter padding + hidden native spinner arrows. The
                      // native up/down arrows render at OS-default size and
                      // look out of place in this dense toolbar; users can
                      // still scroll-to-adjust or type directly.
                      const inputCls = 'w-10 px-0.5 py-0 text-[10px] tabular-nums text-right bg-navy-800 border border-white/10 rounded text-gray-200 focus:outline-none focus:border-blue-400/40 disabled:opacity-40 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none'
                      const labelCls = 'text-[10px] text-gray-500 select-none w-2'
                      return (
                        <Tooltip content={disabled ? 'Move the playhead inside a clip region to edit its crop' : 'Crop position (offset from center) and dimensions, in source pixels'}>
                          <div className={`flex items-center gap-1 ${disabled ? 'opacity-50' : ''}`}>
                            {/* 2×2 grid: x/y on top, w/h below — frees up
                                horizontal space the toolbar needs at narrow
                                window widths. */}
                            <div className="flex flex-col gap-0.5">
                              <div className="flex items-center gap-1">
                                <span className={labelCls}>x</span>
                                <input type="number" disabled={disabled} className={inputCls} value={offsetX}
                                  onChange={e => { const v = parseInt(e.target.value, 10); if (!isNaN(v)) setOffsetX(v) }} />
                                <span className={labelCls}>y</span>
                                <input type="number" disabled={disabled} className={inputCls} value={offsetY}
                                  onChange={e => { const v = parseInt(e.target.value, 10); if (!isNaN(v)) setOffsetY(v) }} />
                              </div>
                              <div className="flex items-center gap-1">
                                <span className={labelCls}>w</span>
                                <input type="number" disabled={disabled} className={inputCls} value={dispW}
                                  onChange={e => { const v = parseInt(e.target.value, 10); if (!isNaN(v) && v > 0) setWidth(v) }} />
                                <span className={labelCls}>h</span>
                                <input type="number" disabled={disabled} className={inputCls} value={dispH}
                                  onChange={e => { const v = parseInt(e.target.value, 10); if (!isNaN(v) && v > 0) setHeight(v) }} />
                              </div>
                            </div>
                            <button
                              type="button"
                              disabled={disabled}
                              onClick={reset}
                              className="flex items-center px-1 py-0.5 rounded text-[11px] text-gray-400 border border-white/20 hover:text-blue-300 hover:border-blue-400/40 transition-colors disabled:opacity-40 disabled:cursor-not-allowed self-center"
                            >
                              <RotateCcw size={11} />
                            </button>
                          </div>
                        </Tooltip>
                      )
                    })()}

                    <div className="flex-1" />

                    {/* Visible range timecodes — stacks vertically below 2xl
                        to free horizontal space. The em-dash separator is
                        only meaningful in the row layout, so it hides too. */}
                    <div className="flex flex-col 2xl:flex-row items-end 2xl:items-center gap-x-1 gap-y-0 shrink-0">
                      {editingVStart ? (
                        <input
                          ref={vStartInputRef}
                          value={vStartInput}
                          onChange={e => setVStartInput(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter' || e.key === 'Tab') {
                              const t = parseTimecode(vStartInput, videoInfo?.fps)
                              if (t !== null) {
                                const clamped = Math.max(0, Math.min(t, vEnd - 0.001))
                                setViewport(v => ({ ...v, viewStart: clamped }))
                              }
                              setEditingVStart(false)
                              if (e.key === 'Tab') { e.preventDefault(); setVEndInput(formatViewTime(vEnd, videoInfo?.fps)); setEditingVEnd(true); setTimeout(() => vEndInputRef.current?.select(), 0) }
                            }
                            if (e.key === 'Escape') setEditingVStart(false)
                            const arrow = applyTimecodeArrow(e, vStartInput, vStartInputRef, videoInfo?.fps, 0, viewportRef.current.viewEnd - 0.001)
                            if (arrow) { setVStartInput(arrow.newValue); setViewport(v => ({ ...v, viewStart: arrow.newTime })) }
                          }}
                          onBlur={() => {
                            const t = parseTimecode(vStartInput, videoInfo?.fps)
                            if (t !== null) setViewport(v => ({ ...v, viewStart: Math.max(0, Math.min(t, viewportRef.current.viewEnd - 0.001)) }))
                            setEditingVStart(false)
                          }}
                          className="w-16 text-[11px] text-blue-300 tabular-nums bg-transparent border-b border-blue-500/60 focus:outline-none text-right"
                        />
                      ) : (
                        <Tooltip content="Click to set view start">
                          <span
                            className="text-[11px] text-blue-400/70 tabular-nums cursor-text hover:text-blue-300 transition-colors"
                            onClick={() => { setVStartInput(formatViewTime(vStart, videoInfo?.fps)); setEditingVStart(true); setTimeout(() => vStartInputRef.current?.select(), 0) }}
                          >
                            {formatViewTime(vStart, videoInfo?.fps)}
                          </span>
                        </Tooltip>
                      )}
                      <span className="hidden 2xl:inline text-[11px] text-blue-400/30 select-none">—</span>
                      {editingVEnd ? (
                        <input
                          ref={vEndInputRef}
                          value={vEndInput}
                          onChange={e => setVEndInput(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') {
                              const t = parseTimecode(vEndInput, videoInfo?.fps)
                              if (t !== null) {
                                const clamped = Math.min(duration, Math.max(t, vStart + 0.001))
                                setViewport(v => ({ ...v, viewEnd: clamped }))
                              }
                              setEditingVEnd(false)
                            }
                            if (e.key === 'Escape') setEditingVEnd(false)
                            const arrow = applyTimecodeArrow(e, vEndInput, vEndInputRef, videoInfo?.fps, viewportRef.current.viewStart + 0.001, duration)
                            if (arrow) { setVEndInput(arrow.newValue); setViewport(v => ({ ...v, viewEnd: arrow.newTime })) }
                          }}
                          onBlur={() => {
                            const t = parseTimecode(vEndInput, videoInfo?.fps)
                            if (t !== null) setViewport(v => ({ ...v, viewEnd: Math.min(duration, Math.max(t, viewportRef.current.viewStart + 0.001)) }))
                            setEditingVEnd(false)
                          }}
                          className="w-16 text-[11px] text-blue-300 tabular-nums bg-transparent border-b border-blue-500/60 focus:outline-none"
                        />
                      ) : (
                        <Tooltip content="Click to set view end">
                          <span
                            className="text-[11px] text-blue-400/70 tabular-nums cursor-text hover:text-blue-300 transition-colors"
                            onClick={() => { setVEndInput(formatViewTime(vEnd, videoInfo?.fps)); setEditingVEnd(true); setTimeout(() => vEndInputRef.current?.select(), 0) }}
                          >
                            {formatViewTime(vEnd, videoInfo?.fps)}
                          </span>
                        </Tooltip>
                      )}
                    </div>

                    <div className="w-px h-3 bg-white/10 mx-1 shrink-0" />

                    {/* Zoom level + reset (when zoomed). One divider trails
                        the zoom controls to separate them from Export. The
                        always-on extra divider that used to sit before
                        Export was removed — we already have one above
                        (after the timecodes) and don't need a duplicate. */}
                    {isZoomed && (
                      <>
                        <span className="text-[10px] text-blue-400/60 tabular-nums">{zoomLevel.toFixed(1)}×</span>
                        <Tooltip content="Reset zoom">
                          <button
                            onClick={() => setViewport({ viewStart: 0, viewEnd: duration })}
                            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] text-blue-400/70 border border-blue-500/20 hover:bg-blue-950/60 transition-colors"
                          >
                            <ZoomIn size={10} /> 1×
                          </button>
                        </Tooltip>
                        <div className="w-px h-3 bg-white/10 mx-0.5 shrink-0" />
                      </>
                    )}

                    <Tooltip content={clipState.clipRegions.length > 0 ? 'Export clip' : 'Add at least one segment first'}>
                      <button
                        onClick={() => setShowExportDialog(true)}
                        disabled={clipState.clipRegions.length === 0}
                        className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] border transition-colors disabled:opacity-40 disabled:cursor-not-allowed text-purple-300 border-purple-600/30 bg-purple-600/20 hover:bg-purple-600/35 disabled:hover:bg-transparent"
                      >
                        <Upload size={11} /> Export<span className="hidden 2xl:inline"> Clip</span>
                      </button>
                    </Tooltip>
                  </div>
                </div>
              )}

              {/* Thumbnail strip + waveform strip — wrapped so handles can span both */}
              <div ref={stripsWrapperRef} className="relative">

              {/* Thumbnail strip */}
              <div
                ref={setFilmstripEl}
                className="relative h-8 w-full cursor-pointer select-none"
                onClick={e => {
                  const rect = e.currentTarget.getBoundingClientRect()
                  const ratio = (e.clientX - rect.left) / rect.width
                  seekRef.current(Math.max(0, Math.min(duration, vStart + ratio * vSpan)))
                }}
                onMouseDown={e => startMiddleClickPan(e, e.currentTarget.getBoundingClientRect().width)}
                onMouseMove={e => {
                  if (isPlayheadDraggingRef.current) return
                  const rect = e.currentTarget.getBoundingClientRect()
                  setHoverRatio((e.clientX - rect.left) / rect.width)
                }}
                onMouseLeave={() => { if (!isPlayheadDraggingRef.current) setHoverRatio(null) }}
              >
                {/* Clipped background */}
                <div className="absolute inset-0 rounded bg-black/40 overflow-hidden pointer-events-none" />

                {/* Thumbnails — each slot is pre-mapped to the nearest cached frame for the
                    current viewport; null slots (no close-enough frame) render as gaps. */}
                {!generating && thumbnails.length > 0 && (() => {
                  const naturalW = stripWidth / thumbnails.length
                  return (
                    <div className={`absolute inset-0 ${isClipMode ? 'overflow-hidden' : 'overflow-visible'}`}>
                      {thumbnails.map((thumb, i) => {
                        if (!thumb) return zoomGenerating ? (
                          <div
                            key={i}
                            className="absolute h-full flex items-center justify-center pointer-events-none"
                            style={{ left: `${i * naturalW}px`, width: `${naturalW}px` }}
                          >
                            <Loader2 size={8} className="animate-spin text-gray-700" />
                          </div>
                        ) : null
                        const isHovered = !isClipMode && hoverRatio !== null &&
                          Math.min(Math.floor(hoverRatio * thumbnails.length), thumbnails.length - 1) === i
                        return (
                          <div
                            key={i}
                            className={`absolute h-full ${isHovered ? 'z-10' : ''}`}
                            style={{ left: `${i * naturalW}px`, width: `${naturalW}px` }}
                          >
                            <img
                              src={thumb.dataUrl}
                              className={`absolute inset-0 w-full h-full object-cover transition-transform duration-150 ease-out origin-bottom ${isHovered ? 'scale-[2.25]' : ''}`}
                              draggable={false}
                            />
                          </div>
                        )
                      })}
                    </div>
                  )
                })()}

                {generating && (
                  <div className="absolute inset-0 flex items-center justify-center gap-1.5 text-[10px] text-gray-600 pointer-events-none">
                    <Loader2 size={10} className="animate-spin" />
                    Generating thumbnails…
                  </div>
                )}

                {/* Hover marker + timecode */}
                {hoverRatio !== null && duration > 0 && (
                  <>
                    <div
                      className="absolute top-0 bottom-0 w-px bg-white/40 pointer-events-none z-20"
                      style={{ left: `${hoverRatio * 100}%`, transform: 'translateX(-50%)' }}
                    />
                    <div
                      className="absolute pointer-events-none z-20 tabular-nums"
                      style={{
                        bottom: '100%',
                        marginBottom: 3,
                        left: `${Math.min(Math.max(hoverRatio * 100, 2), 98)}%`,
                        transform: 'translateX(-50%)'
                      }}
                    >
                      <div className="text-[10px] text-white bg-black/70 px-1 py-0.5 rounded">
                        {formatTime(vStart + hoverRatio * vSpan, videoInfo?.fps)}
                      </div>
                    </div>
                  </>
                )}
              </div>

              {/* Waveform strip */}
              <div
                ref={waveformStripRef}
                className="relative h-10 w-full cursor-pointer bg-black/30"
                onClick={e => {
                  setSelectedRegionId(null)
                  const rect = e.currentTarget.getBoundingClientRect()
                  const ratio = (e.clientX - rect.left) / rect.width
                  seekRef.current(Math.max(0, Math.min(duration, vStart + ratio * vSpan)))
                }}
                onMouseDown={e => startMiddleClickPan(e, e.currentTarget.getBoundingClientRect().width)}
                onMouseMove={e => {
                  if (isPlayheadDraggingRef.current) return
                  const rect = e.currentTarget.getBoundingClientRect()
                  setHoverRatio((e.clientX - rect.left) / rect.width)
                }}
                onMouseLeave={() => { if (!isPlayheadDraggingRef.current) setHoverRatio(null) }}
              >
                {waveformLoading && (
                  <div className="absolute inset-0 flex items-center justify-center gap-1.5 text-[10px] text-gray-600 pointer-events-none">
                    <Loader2 size={10} className="animate-spin" />
                    Generating waveform…
                  </div>
                )}
                {waveformPath && (
                  <svg
                    viewBox={`0 0 ${peakCount} 100`}
                    preserveAspectRatio="none"
                    className="w-full h-full"
                  >
                    <path
                      d={waveformPath}
                      className={tracksExtracted ? 'fill-purple-500/50' : 'fill-gray-300/60'}
                    />
                  </svg>
                )}
              </div>

              {/* Playhead — single element spanning both strips; frozen during handle drag */}
              {duration > 0 && (handleDragDisplayTime ?? currentTime) >= vStart && (handleDragDisplayTime ?? currentTime) <= vEnd && (
                <>
                  <div
                    className="absolute top-0 bottom-0 w-0.5 bg-purple-400/90 pointer-events-none z-20"
                    style={{ left: `${(((handleDragDisplayTime ?? currentTime) - vStart) / vSpan) * 100}%`, transform: 'translateX(-50%)' }}
                  />
                  {/* Draggable hit area — z-10 beats region drag (no z-index), yields to handles (z-20) */}
                  <div
                    className="absolute inset-y-0 z-10 -translate-x-1/2 cursor-ew-resize"
                    style={{ left: `${(((handleDragDisplayTime ?? currentTime) - vStart) / vSpan) * 100}%`, width: '12px' }}
                    onMouseDown={startPlayheadDrag}
                  />
                </>
              )}

              {/* Clip region shading + bleep markers + per-region handles — spans both strips */}
              {isClipMode && (
                <>
                  {/* Shade everything outside clip regions */}
                  {clipState.clipRegions.length > 0 && (() => {
                    // Build shaded intervals: gaps before first, between, and after last region
                    const regions = clipState.clipRegions
                    const intervals: { s: number; e: number }[] = []
                    if (regions[0].inPoint > 0) intervals.push({ s: 0, e: regions[0].inPoint })
                    for (let i = 0; i < regions.length - 1; i++) intervals.push({ s: regions[i].outPoint, e: regions[i + 1].inPoint })
                    if (regions[regions.length - 1].outPoint < duration) intervals.push({ s: regions[regions.length - 1].outPoint, e: duration })
                    return intervals.map((iv, idx) => {
                      const l = Math.max(0, Math.min(100, ((iv.s - vStart) / vSpan) * 100))
                      const r = Math.max(0, Math.min(100, ((vEnd - iv.e) / vSpan) * 100))
                      if (l + r >= 100) return null
                      return <div key={idx} className="absolute inset-y-0 bg-black/45 pointer-events-none z-[5]" style={{ left: `${l}%`, right: `${r}%` }} />
                    })
                  })()}
                  {/* Bleep markers — positioned at waveform strip height only (top-8 = thumbnail h-8) */}
                  {clipState.bleepRegions.map(region => {
                    if (region.end < vStart || region.start > vEnd) return null
                    const l = Math.max(0, ((region.start - vStart) / vSpan) * 100)
                    const r = Math.max(0, ((vEnd - region.end) / vSpan) * 100)
                    const wPx = Math.max(0, (100 - l - r) / 100) * stripWidth
                    const showHandles = wPx >= 16
                    return (
                      <div
                        key={region.id}
                        className="absolute top-8 bottom-0 bg-black overflow-hidden cursor-grab active:cursor-grabbing z-[4] border border-white/20"
                        style={{ left: `${l}%`, right: `${r}%` }}
                        onMouseDown={e => {
                          if (e.button !== 0) return
                          e.stopPropagation()
                          startBleepMove(e, region.id, waveformStripRef.current!.getBoundingClientRect())
                        }}
                      >
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-35">
                          {clipState.bleepVolume < 0.01
                            ? <VolumeX size={14} className="text-white" />
                            : <AudioWaveform size={14} className="text-white" />
                          }
                        </div>
                        <div
                          className="absolute left-0 right-0 h-3 -translate-y-1/2 cursor-ns-resize group z-10"
                          style={{ top: `${(1 - clipState.bleepVolume / 1.5) * 100}%` }}
                          onMouseDown={e => {
                            if (e.button !== 0) return
                            e.stopPropagation()
                            startBleepVolumeDrag(e, e.currentTarget.parentElement!.getBoundingClientRect())
                          }}
                        >
                          <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-px bg-white/70 group-hover:bg-white transition-colors" />
                        </div>
                        {showHandles && (
                          <>
                            <div className="absolute left-0 top-0 bottom-0 w-1 cursor-ew-resize hover:bg-white/30 transition-colors" onMouseDown={e => { e.stopPropagation(); if (e.button === 0) startBleepResize(e, region.id, 'start', waveformStripRef.current!.getBoundingClientRect()) }} />
                            <div className="absolute right-0 top-0 bottom-0 w-1 cursor-ew-resize hover:bg-white/30 transition-colors" onMouseDown={e => { e.stopPropagation(); if (e.button === 0) startBleepResize(e, region.id, 'end', waveformStripRef.current!.getBoundingClientRect()) }} />
                          </>
                        )}
                      </div>
                    )
                  })}
                  {/* Per-segment: drag area, border, handles, duration label, delete, merge button */}
                  {clipState.clipRegions.map((seg, segIdx) => {
                    if (seg.outPoint < vStart || seg.inPoint > vEnd) return null
                    const lPct  = Math.max(0, Math.min(100, ((seg.inPoint  - vStart) / vSpan) * 100))
                    const rPct  = Math.max(0, Math.min(100, ((vEnd - seg.outPoint) / vSpan) * 100))
                    const segDur = seg.outPoint - seg.inPoint
                    const centerPct = Math.max(2, Math.min(98, (((seg.inPoint + seg.outPoint) / 2 - vStart) / vSpan) * 100))
                    const durStr = formatViewTime(segDur, videoInfo?.fps)

                    // Merge button: show when this segment's outPoint is within ~10px of the next segment's inPoint.
                    // Use a pixel-based threshold so it works at any zoom level.
                    const fps = videoInfo?.fps ?? 30
                    const frameTime = 1 / fps
                    const stripWidth = stripsWrapperRef.current?.offsetWidth ?? 1000
                    const mergeThresholdSec = Math.max(frameTime, (vSpan / stripWidth) * 2)
                    const nextSeg = clipState.clipRegions.find(r => r.inPoint > seg.outPoint - frameTime)
                    const showMerge = nextSeg && nextSeg.id !== seg.id && (nextSeg.inPoint - seg.outPoint) <= mergeThresholdSec

                    return (
                      <React.Fragment key={seg.id}>
                        {/* Transparent drag hit area — z-[2] so bleeps (z-[4]) take priority */}
                        <div
                          className="absolute inset-y-0 z-[2] cursor-grab active:cursor-grabbing"
                          style={{ left: `${lPct}%`, right: `${rPct}%` }}
                          onMouseDown={e => startSegmentDrag(e, seg.id)}
                          onMouseEnter={() => setHoveredRegionId(seg.id)}
                          onMouseLeave={() => setHoveredRegionId(null)}
                        />
                        {/* Visual border — brightens on hover, solid when selected */}
                        <div
                          className={`absolute inset-y-0 border-y pointer-events-none z-[9] transition-colors ${selectedRegionId === seg.id ? 'border-blue-300 bg-blue-400/10' : hoveredRegionId === seg.id ? 'border-blue-400/80 bg-blue-400/5' : 'border-blue-400/50'}`}
                          style={{ left: `${lPct}%`, right: `${rPct}%` }}
                        />
                        {/* In-point handle */}
                        {seg.inPoint >= vStart - 0.001 && seg.inPoint <= vEnd + 0.001 && (
                          <div
                            className="absolute inset-y-0 z-20 cursor-ew-resize"
                            style={{ left: `${lPct}%`, transform: 'translateX(-50%)', width: '12px' }}
                            onMouseDown={e => startSegmentHandleDrag(e, seg.id, 'in')}
                          >
                            <div className={`absolute inset-y-0 left-1/2 -translate-x-1/2 w-[3px] rounded-sm transition-colors ${selectedRegionId === seg.id ? 'bg-blue-200' : 'bg-blue-400'}`} />
                          </div>
                        )}
                        {/* Out-point handle */}
                        {seg.outPoint >= vStart - 0.001 && seg.outPoint <= vEnd + 0.001 && (
                          <div
                            className="absolute inset-y-0 z-20 cursor-ew-resize"
                            style={{ left: `${100 - rPct}%`, transform: 'translateX(-50%)', width: '12px' }}
                            onMouseDown={e => startSegmentHandleDrag(e, seg.id, 'out')}
                          >
                            <div className={`absolute inset-y-0 left-1/2 -translate-x-1/2 w-[3px] rounded-sm transition-colors ${selectedRegionId === seg.id ? 'bg-blue-200' : 'bg-blue-400'}`} />
                          </div>
                        )}
                        {/* Timecode label — shown above region when selected */}
                        {selectedRegionId === seg.id && (
                          <div className="absolute flex -translate-x-1/2 z-50 pointer-events-none" style={{ left: `${centerPct}%`, bottom: '100%', marginBottom: '4px' }}>
                            <div className="bg-blue-950 border border-blue-300 rounded px-1.5 py-0.5 text-[11px] text-blue-100 tabular-nums whitespace-nowrap shadow-xl">
                              {formatTime(seg.inPoint, videoInfo?.fps)} → {formatTime(seg.outPoint, videoInfo?.fps)}
                            </div>
                          </div>
                        )}
                        {/* Duration label + delete button — centered below the region */}
                        <div className="absolute flex -translate-x-1/2" style={{ left: `${centerPct}%`, top: '100%', zIndex: selectedRegionId === seg.id ? 60 : 40 }}>
                          <div className="bg-blue-950 border border-blue-400 rounded-b px-1 pt-0.5 pb-0 flex items-center gap-1 shadow-xl">
                            <Tooltip content={lockedRegionIds.has(seg.id) ? 'Unlock duration' : 'Lock duration'}>
                              <button
                                onMouseDown={e => e.preventDefault()}
                                onClick={e => {
                                  e.stopPropagation()
                                  setLockedRegionIds(prev => {
                                    const next = new Set(prev)
                                    next.has(seg.id) ? next.delete(seg.id) : next.add(seg.id)
                                    return next
                                  })
                                }}
                                className={`flex items-center justify-center transition-colors shrink-0 ${lockedRegionIds.has(seg.id) ? 'text-orange-400 hover:text-orange-300' : 'text-blue-400/50 hover:text-blue-300'}`}
                              >
                                {lockedRegionIds.has(seg.id) ? <Lock size={9} /> : <Unlock size={9} />}
                              </button>
                            </Tooltip>
                            {editingDurationId === seg.id ? (
                              <input
                                ref={durationInputRef}
                                value={durationInput}
                                onChange={e => setDurationInput(e.target.value)}
                                onKeyDown={e => {
                                  const arrow = applyTimecodeArrow(e, durationInput, durationInputRef, videoInfo?.fps, frameTime, duration - seg.inPoint)
                                  if (arrow) {
                                    setDurationInput(arrow.newValue)
                                    const newOut = Math.min(duration, seg.inPoint + arrow.newTime)
                                    setClipState(s => ({ ...s, clipRegions: s.clipRegions.map(c => c.id === seg.id ? { ...c, outPoint: newOut } : c) }))
                                    seek(newOut)
                                  }
                                  if (e.key === 'Enter' || e.key === 'Escape') {
                                    if (e.key === 'Enter') {
                                      const t = parseTimecode(durationInput, videoInfo?.fps)
                                      if (t !== null && t >= frameTime) {
                                        const newOut = Math.min(duration, seg.inPoint + t)
                                        setClipState(s => ({ ...s, clipRegions: s.clipRegions.map(c => c.id === seg.id ? { ...c, outPoint: newOut } : c) }))
                                        seek(newOut)
                                      }
                                    }
                                    setEditingDurationId(null)
                                  }
                                }}
                                onBlur={() => {
                                  const t = parseTimecode(durationInput, videoInfo?.fps)
                                  if (t !== null && t >= frameTime) {
                                    const newOut = Math.min(duration, seg.inPoint + t)
                                    setClipState(s => ({ ...s, clipRegions: s.clipRegions.map(c => c.id === seg.id ? { ...c, outPoint: newOut } : c) }))
                                    seek(newOut)
                                  }
                                  setEditingDurationId(null)
                                }}
                                className="text-[11px] text-blue-200 tabular-nums bg-transparent focus:outline-none min-w-0 text-center"
                                style={{ width: `${durationInput.length}ch` }}
                              />
                            ) : (
                              <span
                                className="text-[11px] text-blue-200 tabular-nums cursor-text select-none"
                                onClick={() => { setDurationInput(durStr); setEditingDurationId(seg.id); setTimeout(() => durationInputRef.current?.select(), 0) }}
                              >
                                {durStr}
                              </span>
                            )}
                            <Tooltip content="Delete segment">
                              <button
                                onMouseDown={e => e.preventDefault()}
                                onClick={e => {
                                  e.stopPropagation()
                                  setClipState(s => ({ ...s, clipRegions: s.clipRegions.filter(c => c.id !== seg.id) }))
                                  if (editingDurationId === seg.id) setEditingDurationId(null)
                                  setLockedRegionIds(prev => { const next = new Set(prev); next.delete(seg.id); return next })
                                }}
                                className="flex items-center justify-center text-red-500/60 hover:text-red-400 transition-colors ml-0.5"
                              >
                                <Trash2 size={9} />
                              </button>
                            </Tooltip>
                          </div>
                        </div>
                        {/* Merge button — shown when this seg is exactly touching the next */}
                        {showMerge && nextSeg.inPoint >= vStart && nextSeg.inPoint <= vEnd && (
                          <div
                            className="absolute z-50 -translate-x-1/2 -translate-y-1/2"
                            style={{ left: `${Math.max(2, Math.min(98, ((seg.outPoint - vStart) / vSpan) * 100))}%`, top: '50%' }}
                          >
                            <Tooltip content="Merge adjacent segments">
                              <button
                                onMouseDown={e => e.stopPropagation()}
                                onClick={e => {
                                  e.stopPropagation()
                                  setClipState(s => {
                                    const a = s.clipRegions.find(c => c.id === seg.id)
                                    const b = s.clipRegions.find(c => c.id === nextSeg.id)
                                    if (!a || !b) return s
                                    const merged: ClipRegion = { id: `seg-${uuidv4()}`, inPoint: a.inPoint, outPoint: b.outPoint }
                                    return { ...s, clipRegions: s.clipRegions.filter(c => c.id !== seg.id && c.id !== nextSeg.id).concat(merged).sort((x, y) => x.inPoint - y.inPoint) }
                                  })
                                }}
                                className="flex items-center gap-0.5 px-1 py-0.5 text-[10px] text-teal-300 bg-teal-950 border border-teal-500/50 rounded hover:bg-teal-900 transition-colors shadow-lg"
                              >
                                <GitMerge size={9} /> Merge
                              </button>
                            </Tooltip>
                          </div>
                        )}
                      </React.Fragment>
                    )
                  })}
                  {/* Handle popup — timecode input shown when a handle is clicked/dragged */}
                  {handlePopup && (() => {
                    const seg = clipState.clipRegions.find(r => r.id === handlePopup.regionId)
                    if (!seg) return null
                    const point = handlePopup.which === 'in' ? seg.inPoint : seg.outPoint
                    const leftPct = Math.max(2, Math.min(98, ((point - vStart) / vSpan) * 100))
                    const fps = videoInfo?.fps
                    const frameTime = 1 / (fps ?? 30)
                    const popupOthers = clipState.clipRegions.filter(c => c.id !== handlePopup.regionId)
                    const popupLeftWall  = popupOthers.reduce<number>((b, c) => c.outPoint < seg.outPoint ? Math.max(b, c.outPoint) : b, -Infinity)
                    const popupRightWall = popupOthers.reduce<number>((b, c) => c.inPoint  > seg.inPoint  ? Math.min(b, c.inPoint)  : b, Infinity)
                    const minT = handlePopup.which === 'in'
                      ? (popupLeftWall  === -Infinity ? 0        : popupLeftWall  + frameTime)
                      : seg.inPoint + frameTime
                    const maxT = handlePopup.which === 'in'
                      ? seg.outPoint - frameTime
                      : (popupRightWall === Infinity  ? duration : popupRightWall - frameTime)
                    return (
                      <div className="absolute flex -translate-x-1/2 z-50" style={{ left: `${leftPct}%`, bottom: '100%', marginBottom: 3 }}>
                        <div className="bg-blue-950 border border-blue-400 rounded px-1 pt-0.5 pb-0 flex items-center shadow-xl">
                          <input
                            ref={handlePopupInputRef}
                            value={handlePopup.value}
                            onChange={e => setHandlePopup(p => p ? { ...p, value: e.target.value } : p)}
                            onKeyDown={e => {
                              const arrow = applyTimecodeArrow(e, handlePopup.value, handlePopupInputRef, fps, minT, maxT)
                              if (arrow) {
                                setHandlePopup(p => p ? { ...p, value: arrow.newValue } : p)
                                setClipState(s => ({ ...s, clipRegions: s.clipRegions.map(c => c.id === handlePopup.regionId ? { ...c, [handlePopup.which === 'in' ? 'inPoint' : 'outPoint']: arrow.newTime } : c) }))
                                seek(arrow.newTime)
                              }
                              if (e.key === 'Enter') {
                                const t = parseTimecode(handlePopup.value, fps)
                                if (t !== null) {
                                  const ct = Math.max(minT, Math.min(t, maxT))
                                  setClipState(s => ({ ...s, clipRegions: s.clipRegions.map(c => c.id === handlePopup.regionId ? { ...c, [handlePopup.which === 'in' ? 'inPoint' : 'outPoint']: ct } : c) }))
                                  seek(ct)
                                }
                                setHandlePopup(null)
                              }
                              if (e.key === 'Escape') setHandlePopup(null)
                            }}
                            onBlur={() => {
                              const t = parseTimecode(handlePopup.value, fps)
                              if (t !== null) {
                                const ct = Math.max(minT, Math.min(t, maxT))
                                setClipState(s => ({ ...s, clipRegions: s.clipRegions.map(c => c.id === handlePopup.regionId ? { ...c, [handlePopup.which === 'in' ? 'inPoint' : 'outPoint']: ct } : c) }))
                                seek(ct)
                              }
                              setHandlePopup(null)
                            }}
                            className="text-[11px] text-blue-200 tabular-nums bg-transparent focus:outline-none min-w-0 text-center"
                            style={{ width: `${Math.max(8, handlePopup.value.length)}ch` }}
                          />
                        </div>
                      </div>
                    )
                  })()}
                  {/* Bleep length popup — appears below the strips when a bleep is active */}
                  {activeBleepId && (() => {
                    const region = clipState.bleepRegions.find(r => r.id === activeBleepId)
                    if (!region) return null
                    const centerPct = Math.max(2, Math.min(98, (((region.start + region.end) / 2 - vStart) / vSpan) * 100))
                    return (
                      <div
                        ref={bleepPopupRef}
                        className="absolute flex -translate-x-1/2 z-50"
                        style={{ left: `${centerPct}%`, top: '100%' }}
                      >
                        <div className="bg-blue-950 border border-blue-400 rounded px-1 pt-0.5 pb-0 flex items-center gap-0.5 shadow-xl">
                          <input
                            ref={bleepLengthInputRef}
                            value={bleepLengthInput}
                            onChange={e => setBleepLengthInput(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') {
                                const v = parseFloat(bleepLengthInput)
                                if (!isNaN(v) && v >= 0.25) {
                                  setClipState(s => {
                                    const r = s.bleepRegions.find(b => b.id === activeBleepId)
                                    if (!r) return s
                                    const newEnd = Math.min(durationRef.current, r.start + Math.min(v, 10))
                                    return { ...s, bleepRegions: s.bleepRegions.map(b => b.id === activeBleepId ? { ...b, end: newEnd } : b) }
                                  })
                                }
                                setActiveBleepId(null)
                              }
                              if (e.key === 'Escape') setActiveBleepId(null)
                              if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                                e.preventDefault()
                                const current = parseFloat(bleepLengthInput)
                                if (isNaN(current)) return
                                const delta = e.key === 'ArrowUp' ? 0.01 : -0.01
                                const next = Math.max(0.25, Math.min(10, Math.round((current + delta) * 100) / 100))
                                setBleepLengthInput(next.toFixed(2))
                                setClipState(s => {
                                  const r = s.bleepRegions.find(b => b.id === activeBleepId)
                                  if (!r) return s
                                  const newEnd = Math.min(durationRef.current, r.start + next)
                                  return { ...s, bleepRegions: s.bleepRegions.map(b => b.id === activeBleepId ? { ...b, end: newEnd } : b) }
                                })
                              }
                            }}
                            onBlur={() => {
                              const v = parseFloat(bleepLengthInput)
                              if (!isNaN(v) && v >= 0.25) {
                                setClipState(s => {
                                  const r = s.bleepRegions.find(b => b.id === activeBleepId)
                                  if (!r) return s
                                  const newEnd = Math.min(durationRef.current, r.start + Math.min(v, 10))
                                  return { ...s, bleepRegions: s.bleepRegions.map(b => b.id === activeBleepId ? { ...b, end: newEnd } : b) }
                                })
                              }
                              // Don't dismiss here — click-outside handler does it
                            }}
                            className="text-[11px] text-blue-200 tabular-nums bg-transparent focus:outline-none min-w-0 text-center"
                            style={{ width: `${Math.max(4, bleepLengthInput.length)}ch` }}
                          />
                          <span className="text-[11px] text-blue-400/60 select-none">s</span>
                          <button
                            className="ml-0.5 text-red-400/70 hover:text-red-400 transition-colors"
                            onMouseDown={e => {
                              e.preventDefault() // keep input focused so blur doesn't fire first
                              const idToDelete = activeBleepId
                              setClipState(s => ({ ...s, bleepRegions: s.bleepRegions.filter(b => b.id !== idToDelete) }))
                              setActiveBleepId(null)
                            }}
                          >
                            <X size={10} />
                          </button>
                        </div>
                      </div>
                    )
                  })()}
                </>
              )}
              </div>{/* end stripsWrapperRef */}

              {/* Viewport scrollbar — below waveform, above playback controls */}
              {duration > 0 && (
                <div
                  ref={scrollbarRef}
                  className="relative h-3 w-full select-none mt-4"
                >
                  {/* Track */}
                  <div className="absolute inset-y-1 inset-x-0 bg-white/5 rounded-full" />
                  {/* Clip region bars — blue to match clipping feature theme */}
                  {clipState.clipRegions.map(r => (
                    <div
                      key={r.id}
                      className="absolute inset-y-1 bg-blue-500/40 pointer-events-none z-[1]"
                      style={{
                        left: `${(r.inPoint / duration) * 100}%`,
                        width: `${((r.outPoint - r.inPoint) / duration) * 100}%`,
                      }}
                    />
                  ))}
                  {/* Playhead position needle */}
                  <div
                    className="absolute top-0 bottom-0 w-0.5 bg-purple-400/70 pointer-events-none z-[2] -translate-x-1/2"
                    style={{ left: `${((handleDragDisplayTime ?? currentTime) / duration) * 100}%` }}
                  />
                  {/* Thumb — purple to distinguish from clip markers */}
                  <div
                    className="absolute inset-y-0 rounded-full bg-purple-500/30 hover:bg-purple-500/40 cursor-grab active:cursor-grabbing flex items-center"
                    style={{
                      left: `${(vStart / duration) * 100}%`,
                      width: `${Math.max((vSpan / duration) * 100, 2)}%`,
                    }}
                    onMouseDown={e => {
                      if (e.button !== 0) return
                      e.preventDefault()
                      ;(document.activeElement as HTMLElement)?.blur()
                      const rect = scrollbarRef.current!.getBoundingClientRect()
                      const startX = e.clientX
                      const { viewStart: svs, viewEnd: sve } = viewportRef.current
                      const span = sve - svs
                      const onMove = (me: MouseEvent) => {
                        const dur = durationRef.current
                        const dtSec = ((me.clientX - startX) / rect.width) * dur
                        let ns = svs + dtSec
                        let ne = sve + dtSec
                        if (ns < 0) { ns = 0; ne = span }
                        if (ne > dur) { ne = dur; ns = dur - span }
                        setViewport({ viewStart: ns, viewEnd: ne })
                      }
                      const onUp = () => {
                        window.removeEventListener('mousemove', onMove)
                        window.removeEventListener('mouseup', onUp)
                      }
                      window.addEventListener('mousemove', onMove)
                      window.addEventListener('mouseup', onUp)
                    }}
                  >
                    {/* Left resize handle */}
                    <div
                      className="absolute left-0 top-0 bottom-0 w-2.5 rounded-l-full cursor-ew-resize bg-purple-400/60 hover:bg-purple-400/90 transition-colors z-10"
                      onMouseDown={e => {
                        e.preventDefault(); e.stopPropagation()
                        ;(document.activeElement as HTMLElement)?.blur()
                        const rect = scrollbarRef.current!.getBoundingClientRect()
                        const startX = e.clientX
                        const startVStart = viewportRef.current.viewStart
                        const startVEnd = viewportRef.current.viewEnd
                        const onMove = (me: MouseEvent) => {
                          const dur = durationRef.current
                          const dtSec = ((me.clientX - startX) / rect.width) * dur
                          const newVStart = Math.max(0, Math.min(startVStart + dtSec, startVEnd - dur / 500))
                          setViewport({ viewStart: newVStart, viewEnd: startVEnd })
                        }
                        const onUp = () => {
                          window.removeEventListener('mousemove', onMove)
                          window.removeEventListener('mouseup', onUp)
                        }
                        window.addEventListener('mousemove', onMove)
                        window.addEventListener('mouseup', onUp)
                      }}
                    />
                    {/* Right resize handle */}
                    <div
                      className="absolute right-0 top-0 bottom-0 w-2.5 rounded-r-full cursor-ew-resize bg-purple-400/60 hover:bg-purple-400/90 transition-colors z-10"
                      onMouseDown={e => {
                        e.preventDefault(); e.stopPropagation()
                        ;(document.activeElement as HTMLElement)?.blur()
                        const rect = scrollbarRef.current!.getBoundingClientRect()
                        const startX = e.clientX
                        const startVStart = viewportRef.current.viewStart
                        const startVEnd = viewportRef.current.viewEnd
                        const onMove = (me: MouseEvent) => {
                          const dur = durationRef.current
                          const dtSec = ((me.clientX - startX) / rect.width) * dur
                          const newVEnd = Math.min(dur, Math.max(startVEnd + dtSec, startVStart + dur / 500))
                          setViewport({ viewStart: startVStart, viewEnd: newVEnd })
                        }
                        const onUp = () => {
                          window.removeEventListener('mousemove', onMove)
                          window.removeEventListener('mouseup', onUp)
                        }
                        window.addEventListener('mousemove', onMove)
                        window.addEventListener('mouseup', onUp)
                      }}
                    />
                  </div>
                </div>
              )}

              {/* Spacer — reserves room for handle/duration popups below the strips; divider separates timeline from controls */}
              <div className={`shrink-0 ${duration > 0 ? 'h-[8px]' : 'h-px bg-white/15 mt-1'}`} />

              {/* Timecodes + playback controls on one row */}
              <div className="flex items-center">
                {editingTimecode ? (
                  <input
                    ref={timecodeInputRef}
                    value={timecodeInput}
                    onChange={e => setTimecodeInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        const t = parseTimecode(timecodeInput, videoInfo?.fps)
                        if (t !== null) seekRef.current(Math.max(0, Math.min(t, duration)))
                        setEditingTimecode(false)
                      }
                      if (e.key === 'Escape') setEditingTimecode(false)
                      const arrow = applyTimecodeArrow(e, timecodeInput, timecodeInputRef, videoInfo?.fps, 0, duration)
                      if (arrow) { setTimecodeInput(arrow.newValue); seekRef.current(arrow.newTime) }
                    }}
                    onBlur={() => {
                      const t = parseTimecode(timecodeInput, videoInfo?.fps)
                      if (t !== null) seekRef.current(Math.max(0, Math.min(t, duration)))
                      setEditingTimecode(false)
                    }}
                    className="w-24 shrink-0 text-xs text-purple-300 tabular-nums bg-transparent border-b border-purple-500 focus:outline-none"
                  />
                ) : (
                  <Tooltip content="Click to enter timecode">
                    <span
                      className="text-xs text-gray-500 tabular-nums w-24 shrink-0 cursor-text hover:text-gray-300 transition-colors"
                      onClick={() => {
                        if (!duration) return
                        setTimecodeInput(formatViewTime(currentTime, videoInfo?.fps))
                        setEditingTimecode(true)
                        setTimeout(() => timecodeInputRef.current?.select(), 0)
                      }}
                    >
                      {formatTime(currentTime, videoInfo?.fps)}
                    </span>
                  </Tooltip>
                )}
                <div className="flex-1 flex items-center justify-center gap-1">
                {/* Skip to start */}
                <Tooltip content="Skip to start">
                  <button onClick={() => seekRef.current(0)} className="p-1.5 rounded text-gray-500 hover:text-gray-100 hover:bg-white/10 transition-colors">
                    <ChevronsLeft size={15} />
                  </button>
                </Tooltip>

                <div className="w-px h-4 bg-white/10 mx-0.5" />

                {/* Skip back */}
                {[-10, -5, -1].map(s => (
                  <Tooltip key={s} content={`${Math.abs(s)}s back`}>
                    <button onClick={() => skip(s)} className="px-1.5 py-1 rounded text-xs text-gray-500 hover:text-gray-100 hover:bg-white/10 transition-colors tabular-nums">
                      {s}
                    </button>
                  </Tooltip>
                ))}

                <div className="w-px h-4 bg-white/10 mx-0.5" />

                {/* Prev frame */}
                <Tooltip content="Previous frame">
                  <button onClick={() => stepFrame(-1)} className="p-1.5 rounded text-gray-400 hover:text-gray-100 hover:bg-white/10 transition-colors">
                    <ChevronLeft size={16} />
                  </button>
                </Tooltip>

                {/* Play / Pause */}
                <Tooltip content={isPlaying ? 'Pause' : 'Play'}>
                  <button
                    onClick={effectiveTogglePlay}
                    className="p-2 mx-1 rounded-full bg-purple-800 hover:bg-purple-700 text-white transition-colors"
                  >
                    {isPlaying ? <Pause size={16} /> : <Play size={16} />}
                  </button>
                </Tooltip>

                {/* Next frame */}
                <Tooltip content="Next frame">
                  <button onClick={() => stepFrame(1)} className="p-1.5 rounded text-gray-400 hover:text-gray-100 hover:bg-white/10 transition-colors">
                    <ChevronRight size={16} />
                  </button>
                </Tooltip>

                <div className="w-px h-4 bg-white/10 mx-0.5" />

                {/* Skip forward */}
                {[1, 5, 10].map(s => (
                  <Tooltip key={s} content={`${s}s forward`}>
                    <button onClick={() => skip(s)} className="px-1.5 py-1 rounded text-xs text-gray-500 hover:text-gray-100 hover:bg-white/10 transition-colors tabular-nums">
                      +{s}
                    </button>
                  </Tooltip>
                ))}

                <div className="w-px h-4 bg-white/10 mx-0.5" />

                {/* Skip to end */}
                <Tooltip content="Skip to end">
                  <button onClick={() => seekRef.current(duration)} className="p-1.5 rounded text-gray-500 hover:text-gray-100 hover:bg-white/10 transition-colors">
                    <ChevronsRight size={15} />
                  </button>
                </Tooltip>

                </div>
                <span className="text-xs text-gray-500 tabular-nums w-24 shrink-0 text-right">{formatTime(duration, videoInfo?.fps)}</span>
              </div>

              {/* Secondary controls row */}
              <div className="flex items-center gap-3 min-w-0">
                {videoUrl && !isClipMode && (() => {
                  const isClipFile = !!currentVideoClip
                  const sourceMissing = isClipFile && !currentVideoClip.sourceExists
                  const tooltip = sourceMissing
                    ? `Source video "${currentVideoClip.clipOf}" is missing from this folder`
                    : ''
                  const currentName = state.filePath?.replace(/.*[\\/]/, '') ?? ''
                  // A source already has clips if there's a draft or an exported clip output for it
                  const hasExistingClips = !isClipFile && (
                    folderDrafts.some(d => d.sourceName === currentName) ||
                    siblingFiles.some(f => f.clipOf === currentName)
                  )
                  return (
                    <button
                      disabled={sourceMissing}
                      title={tooltip}
                      onClick={() => {
                        if (isClipFile) {
                          // Exported clips are immutable; branch a new clip from the saved state.
                          reopenClipOutput(currentVideoClip.clipOf, currentVideoClip.clipState)
                          return
                        }
                        if (multiTrack && !tracksExtracted && !isExtracting && !config.skipClipMergeWarning) {
                          setClipModeModal('warn')
                          return
                        }
                        setIsClipMode(true)
                      }}
                      className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs border transition-colors shrink-0 disabled:opacity-40 disabled:cursor-not-allowed bg-blue-950/40 border-blue-500/30 text-blue-400 hover:bg-blue-950/60"
                    >
                      <Scissors size={12} />
                      {isClipFile
                        ? 'New clip from current'
                        : hasExistingClips ? 'Start New Clip' : 'Start Clipping'}
                    </button>
                  )
                })()}
                {videoInfo && (
                  <div className="flex items-center gap-1 text-xs text-gray-500 min-w-0 overflow-hidden">
                    <Info size={12} className="shrink-0" />
                    <Tooltip
                      content={state.filePath ? `Show in Explorer: ${state.filePath}` : ''}
                      triggerClassName="min-w-0 overflow-hidden inline-flex"
                    >
                      <button
                        className="truncate hover:text-gray-300 transition-colors cursor-pointer min-w-0 max-w-full"
                        onClick={() => state.filePath && window.api.openInExplorer(state.filePath)}
                      >
                        {videoInfo.width}×{videoInfo.height}
                        {videoInfo.fps && ` · ${videoInfo.fps.toFixed(2)} fps`}
                        {` · ${videoInfo.videoCodec}`}
                        {state.filePath && ` · ${state.filePath.split(/[\\/]/).pop()}`}
                      </button>
                    </Tooltip>
                  </div>
                )}
                <Button variant="ghost" size="sm" icon={<FolderOpen size={14} />} onClick={handleBrowse} className="ml-auto shrink-0">
                  Open Video File
                </Button>
                {videoInfo && (
                  <button
                    onClick={() => closeVideo()}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs border text-red-400 border-red-600/40 bg-red-900/30 hover:bg-red-900/50 transition-colors shrink-0"
                  >
                    <X size={12} />
                    Close Session
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Audio tracks panel */}
          <div className={`relative bg-navy-800 flex flex-col shrink-0 transition-all duration-200 ${panelCollapsed ? 'w-2 overflow-hidden' : 'w-64 overflow-hidden'}`}>
            {/* Left edge — collapse/expand handle */}
            <Tooltip content={panelCollapsed ? 'Expand panel' : 'Collapse panel'} side="left" triggerClassName="group/edge absolute left-0 inset-y-0 w-2 z-20">
              <button
                onClick={() => setPanelCollapsed(v => !v)}
                className="absolute inset-0 cursor-col-resize"
                aria-label={panelCollapsed ? 'Expand panel' : 'Collapse panel'}
              />
              <div className="pointer-events-none absolute inset-y-0 left-0 w-px bg-white/5 group-hover/edge:w-0.5 group-hover/edge:bg-purple-500 transition-all duration-150" />
            </Tooltip>
            {!panelCollapsed && (
            <div className="flex flex-col flex-1 min-h-0 overflow-hidden">

              {/* Audio Tracks section — absorbs variable height so Session Videos stays pinned to the bottom */}
              <div className="flex-1 min-h-0 overflow-y-auto">
                <div className="px-4 py-2.5 border-b border-white/5">
                  <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Audio Tracks</h3>
                </div>

                {/* Pre-merge: track selector */}
                {multiTrack && !tracksExtracted && !isExtracting && (
                  <div className="px-4 py-2.5 flex flex-col gap-2">
                    <div className="flex items-start gap-2 text-[11px] text-gray-400 leading-relaxed">
                      <Layers size={12} className="text-purple-400 mt-0.5 shrink-0" />
                      <span>
                        {videoInfo!.audioTracks.length} tracks detected. Only <span className="text-gray-300">{videoInfo!.audioTracks[0]?.title || TRACK_LABELS[0] || 'Track 1'}</span> will be audible. Select tracks to merge.
                      </span>
                    </div>

                    <div className="flex flex-col gap-1">
                      {videoInfo!.audioTracks.map((t, i) => {
                        const label = t.title || TRACK_LABELS[i] || `Track ${i + 1}`
                        const checked = selectedIndices.has(i)
                        return (
                          <button
                            key={i}
                            onClick={() => toggleIndex(i)}
                            className={`w-full text-left px-3 py-1.5 rounded-lg border transition-colors ${
                              checked
                                ? 'bg-purple-600/20 border-purple-600/40'
                                : 'bg-white/[0.03] border-white/5 hover:bg-white/[0.06]'
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              <div className={`w-3.5 h-3.5 rounded border-2 flex items-center justify-center transition-colors shrink-0 ${
                                checked ? 'bg-purple-700 border-purple-700' : 'border-gray-600'
                              }`}>
                                {checked && <Check size={10} className="text-white" strokeWidth={3} />}
                              </div>
                              <div className="flex flex-col min-w-0">
                                <span className={`text-xs font-medium leading-tight ${checked ? 'text-purple-200' : 'text-gray-300'}`}>{label}</span>
                                <span className="text-[11px] text-gray-400 leading-tight mt-0.5">
                                  {t.codec} · {t.channels}ch{t.language ? ` · ${t.language}` : ''}
                                </span>
                              </div>
                            </div>
                          </button>
                        )
                      })}
                    </div>

                    <button
                      onClick={() => extractTracks(Array.from(selectedIndices).sort())}
                      disabled={selectedIndices.size < 1}
                      className="w-full flex items-center justify-center gap-1.5 text-xs font-semibold py-2 px-3 rounded-lg bg-purple-800 hover:bg-purple-700 active:bg-purple-900 text-white transition-colors disabled:opacity-40 disabled:pointer-events-none"
                    >
                      <GitMerge size={12} />
                      Merge audio tracks
                    </button>
                  </div>
                )}

                {/* During merge: progress bars */}
                {multiTrack && isExtracting && (
                  <div className="px-4 py-2.5 flex flex-col gap-2.5">
                    <div className="flex items-center gap-2 text-xs text-purple-300 font-medium">
                      <Loader2 size={12} className="animate-spin shrink-0" />
                      Merging audio tracks…
                    </div>
                    <div className="flex flex-col gap-2.5">
                      {videoInfo!.audioTracks.map((t, i) => {
                        const label = t.title || TRACK_LABELS[i] || `Track ${i + 1}`
                        const selected = selectedIndices.has(i)
                        const progress = extractProgress[i] ?? 0
                        return (
                          <div key={i} className={`flex flex-col gap-1 ${selected ? '' : 'opacity-35'}`}>
                            <div className="flex items-center justify-between">
                              <span className={`text-[11px] text-gray-400 truncate ${selected ? '' : 'line-through'}`}>
                                {label}
                              </span>
                              {selected && (
                                <span className="text-[11px] tabular-nums text-gray-500 shrink-0 ml-2">
                                  {progress >= 100 ? <span className="text-green-400">✓</span> : `${progress}%`}
                                </span>
                              )}
                            </div>
                            <div className="h-1 bg-white/10 rounded-full overflow-hidden">
                              {selected
                                ? <div
                                    className={`h-full rounded-full transition-all duration-300 ${progress >= 100 ? 'bg-green-500' : 'bg-purple-500'}`}
                                    style={{ width: `${progress}%` }}
                                  />
                                : null
                              }
                            </div>
                          </div>
                        )
                      })}
                    </div>
                    <button
                      onClick={cancelExtraction}
                      className="text-xs text-gray-600 hover:text-gray-400 transition-colors text-left"
                    >
                      Cancel
                    </button>
                  </div>
                )}

                {/* Post-merge: merged + skipped tracks, undo button */}
                {tracksExtracted && (() => {
                  const merged = tracks.filter(t => t.audioEl !== null)
                  const skipped = tracks.filter(t => t.audioEl === null)
                  return (
                    <div className="px-4 py-2.5 flex flex-col gap-2.5">
                      {/* Merged */}
                      <div className="flex flex-col gap-1.5">
                        <p className="text-[10px] text-gray-600 uppercase tracking-wider font-semibold">Merged tracks</p>
                        {merged.map((track) => {
                          const info = videoInfo?.audioTracks[track.index]
                          const label = info?.title || TRACK_LABELS[track.index] || `Track ${track.index + 1}`
                          return (
                            <div key={track.index} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-purple-600/10 border border-purple-600/20">
                              <div className="w-1.5 h-1.5 rounded-full bg-purple-400 shrink-0" />
                              <div className="min-w-0">
                                <div className="text-xs font-medium text-purple-200">
                                  {label} <span className="text-purple-600 font-normal">(Track {track.index + 1})</span>
                                </div>
                                {info && (
                                  <div className="text-[10px] text-gray-600">
                                    {info.codec} · {info.channels}ch{info.language ? ` · ${info.language}` : ''}
                                  </div>
                                )}
                              </div>
                            </div>
                          )
                        })}
                      </div>

                      {/* Skipped */}
                      {skipped.length > 0 && (
                        <div className="flex flex-col gap-1.5">
                          <p className="text-[10px] text-gray-600 uppercase tracking-wider font-semibold">Tracks not merged</p>
                          {skipped.map((track) => {
                            const info = videoInfo?.audioTracks[track.index]
                            const label = info?.title || TRACK_LABELS[track.index] || `Track ${track.index + 1}`
                            return (
                              <div key={track.index} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/[0.03] border border-white/5">
                                <div className="w-1.5 h-1.5 rounded-full bg-gray-700 shrink-0" />
                                <div className="min-w-0">
                                  <div className="text-xs font-medium text-gray-500 line-through">
                                    {label} <span className="text-gray-700 font-normal">(Track {track.index + 1})</span>
                                  </div>
                                  {info && (
                                    <div className="text-[10px] text-gray-700">
                                      {info.codec} · {info.channels}ch{info.language ? ` · ${info.language}` : ''}
                                    </div>
                                  )}
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      )}

                      {/* Undo */}
                      <button
                        onClick={() => {
                          resetExtraction()
                          if (videoInfo) setSelectedIndices(new Set(videoInfo.audioTracks.map((_, i) => i)))
                        }}
                        className="flex items-center gap-2 text-xs text-gray-500 hover:text-gray-300 transition-colors mt-1"
                      >
                        <RotateCcw size={11} />
                        Undo merge
                      </button>
                    </div>
                  )
                })()}

                {!multiTrack && !tracksExtracted && !isExtracting && (
                  <div className="px-4 py-4 text-center text-xs text-gray-600 leading-relaxed">
                    {(videoInfo?.audioTracks.length ?? 0) === 0
                      ? 'No audio tracks found.'
                      : 'Only 1 audio track — audio merge not available.'
                    }
                  </div>
                )}
              </div>

              {/* Session Videos panel — hide when there's only one video and nothing derived from it.
                  Pinned to the bottom of the sidebar with a 50% cap so it never dominates and doesn't
                  shift around as the Audio Tracks section grows/shrinks. */}
              {(siblingFiles.length > 1 || folderDrafts.length > 0) && (
                <div className="shrink-0 max-h-[50%] overflow-hidden pr-2 border-t border-white/5">
                  <div className="max-h-full overflow-y-auto">
                    <div className="sticky top-0 z-10 bg-navy-800 px-4 py-2.5 border-b border-white/5 flex items-center gap-2">
                      <Film size={12} className="text-gray-600 shrink-0" />
                      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Session Videos</h3>
                    </div>
                    {isExtracting ? (
                      <div className="px-3 py-4 text-xs text-gray-600 text-center leading-relaxed">Available once merge is complete or cancelled</div>
                    ) : (() => {
                      // Group drafts by source filename so each source video shows its drafts underneath.
                      const draftsBySource = folderDrafts.reduce<Record<string, import('../../types').ClipDraft[]>>((acc, d) => {
                        (acc[d.sourceName] ||= []).push(d)
                        return acc
                      }, {})
                      const seenNames = new Set(siblingFiles.map(v => v.name))
                      // Group clip-output siblings under their source video so they nest like drafts do.
                      // If a clip's source isn't in the folder, it falls through to the top level as an orphan.
                      const clipChildren: Record<string, SiblingFile[]> = {}
                      const topLevelSiblings: SiblingFile[] = []
                      for (const s of siblingFiles) {
                        if (s.clipOf && seenNames.has(s.clipOf)) {
                          (clipChildren[s.clipOf] ||= []).push(s)
                        } else {
                          topLevelSiblings.push(s)
                        }
                      }
                      // Any drafts whose source isn't in the folder (e.g., renamed/deleted) appear at the bottom.
                      const orphanDrafts = Object.entries(draftsBySource)
                        .filter(([name]) => !seenNames.has(name))
                        .flatMap(([, list]) => list)
                      return (
                        <div className="px-1 py-1.5 flex flex-col gap-0.5">
                          {topLevelSiblings.map(item => (
                            <React.Fragment key={item.path}>
                              <SiblingVideoItem
                                item={item}
                                isActive={item.path === state.filePath}
                                onClick={() => loadFile(item.path)}
                                onReopenAsClip={item.clipOf && item.clipState
                                  ? () => reopenClipOutput(item.clipOf!, item.clipState!)
                                  : undefined}
                              />
                              {(draftsBySource[item.name] ?? []).map(draft => (
                                <DraftSessionItem
                                  key={draft.id}
                                  draft={draft}
                                  displayName={draftDisplayName(draft)}
                                  sourceFps={item.fps}
                                  isActive={activeDraftId === draft.id}
                                  isExporting={exportingDraftIds.has(draft.id)}
                                  onClick={() => loadDraft(draft)}
                                  onDelete={() => requestDeleteDraft(draft)}
                                  onRename={name => renameDraft(draft.id, name)}
                                />
                              ))}
                              {(clipChildren[item.name] ?? []).map(child => (
                                <SiblingVideoItem
                                  key={child.path}
                                  item={child}
                                  isActive={child.path === state.filePath}
                                  indented
                                  onClick={() => loadFile(child.path)}
                                  onReopenAsClip={child.clipOf && child.clipState
                                    ? () => reopenClipOutput(child.clipOf!, child.clipState!)
                                    : undefined}
                                />
                              ))}
                            </React.Fragment>
                          ))}
                          {orphanDrafts.map(draft => (
                            <DraftSessionItem
                              key={draft.id}
                              draft={draft}
                              displayName={draftDisplayName(draft)}
                              sourceFps={siblingFiles.find(f => f.name === draft.sourceName)?.fps}
                              isActive={activeDraftId === draft.id}
                              onClick={() => loadDraft(draft)}
                              onDelete={() => requestDeleteDraft(draft)}
                              onRename={name => renameDraft(draft.id, name)}
                            />
                          ))}
                        </div>
                      )
                    })()}
                  </div>
                </div>
              )}

            </div>
            )}
          </div>
        </div>
      )}

      {error && (
        <div className="px-4 py-2 bg-red-900/30 border-t border-red-800/50 text-red-400 text-sm flex items-center gap-2">
          <span className="flex-1 select-text cursor-text">{error}</span>
          <button onClick={clearError} className="shrink-0 hover:text-red-200 transition-colors">
            <X size={14} />
          </button>
        </div>
      )}

      {/* ── Confirm delete clip draft ─────────────────────────────────────────── */}
      <Modal
        isOpen={draftPendingDelete !== null}
        onClose={() => setDraftPendingDelete(null)}
        title="Delete clip draft?"
        width="sm"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setDraftPendingDelete(null)}>
              Cancel
            </Button>
            <Button variant="danger" size="sm" onClick={confirmDeleteDraft}>
              Delete
            </Button>
          </>
        }
      >
        {draftPendingDelete && (
          <p className="text-sm text-gray-300 leading-relaxed">
            Delete <span className="text-gray-100 font-medium">{draftDisplayName(draftPendingDelete)}</span>? This can't be undone.
          </p>
        )}
      </Modal>

      {/* ── Multi-track warning / merge modal before entering clip mode ────── */}
      <Modal
        isOpen={clipModeModal !== null}
        onClose={() => setClipModeModal(null)}
        title={clipModeModal === 'merge' ? 'Select tracks to merge' : 'Multiple audio tracks detected'}
        width="sm"
        dismissible={!isExtracting}
        footer={
          clipModeModal === 'warn' ? (
            <>
              <Button variant="ghost" size="sm" onClick={() => { commitWarnDontShowAgain(); setClipModeModal(null); setIsClipMode(true) }}>
                Continue anyway
              </Button>
              <Button variant="primary" size="sm" onClick={() => { commitWarnDontShowAgain(); setClipModeModal('merge') }}>
                Merge audio now
              </Button>
            </>
          ) : isExtracting ? null : (
            <>
              <Button variant="ghost" size="sm" onClick={() => setClipModeModal(null)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                disabled={selectedIndices.size < 1}
                onClick={() => {
                  pendingClipAfterMerge.current = true
                  extractTracks(Array.from(selectedIndices).sort())
                }}
              >
                Merge audio tracks
              </Button>
            </>
          )
        }
      >
        {clipModeModal === 'warn' && (
          <div className="flex flex-col gap-3">
            <div className="flex items-start gap-2.5 text-sm text-gray-300 leading-relaxed">
              <Layers size={15} className="text-purple-400 mt-0.5 shrink-0" />
              <span>
                This video has <strong className="text-white">{videoInfo?.audioTracks.length} audio tracks</strong>.
                You will only hear <strong className="text-white">Track 1</strong>.
              </span>
            </div>
            <p className="text-xs text-gray-500 leading-relaxed pl-[23px]">
              Merging combines all tracks so you hear everything while clipping. Exporting always includes all audio tracks. Merging takes time to process.
            </p>
            <div className="pl-[23px] pt-1">
              <Checkbox
                checked={warnDontShowAgain}
                onChange={setWarnDontShowAgain}
                label="Don't show this again"
              />
            </div>
          </div>
        )}

        {clipModeModal === 'merge' && (
          <div className="flex flex-col gap-3">
            {isExtracting ? (
              /* Progress view */
              <div className="flex flex-col items-center gap-4 py-2">
                <div className="text-purple-300 font-medium text-sm">Merging audio tracks…</div>
                <div className="flex flex-col gap-2.5 w-full">
                  {videoInfo?.audioTracks.map((t, i) => {
                    const label = t.title || TRACK_LABELS[i] || `Track ${i + 1}`
                    const selected = selectedIndices.has(i)
                    return (
                      <div key={i} className="flex items-center gap-3">
                        <span className={`text-xs text-white whitespace-nowrap min-w-[80px] ${selected ? '' : 'line-through opacity-50'}`}>
                          {label} <span className="text-white/50">(Track {i + 1})</span>
                        </span>
                        {selected ? (
                          <>
                            <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all ${(extractProgress[i] ?? 0) >= 100 ? 'bg-green-500' : 'bg-purple-500'}`}
                                style={{ width: `${extractProgress[i] ?? 0}%` }}
                              />
                            </div>
                            <span className="text-xs text-white/50 w-8 text-right tabular-nums">{extractProgress[i] ?? 0}%</span>
                          </>
                        ) : (
                          <div className="flex-1 h-1.5 bg-white/5 rounded-full" />
                        )}
                      </div>
                    )
                  })}
                </div>
                <button
                  onClick={() => { cancelExtraction(); pendingClipAfterMerge.current = false; setClipModeModal(null) }}
                  className="text-xs text-white/50 hover:text-white transition-colors"
                >
                  Cancel
                </button>
              </div>
            ) : (
              /* Track selector */
              <>
                <div className="flex items-start gap-2 text-xs text-gray-400 leading-relaxed">
                  <Layers size={13} className="text-purple-400 mt-0.5 shrink-0" />
                  <span>Select which tracks to include in the merge.</span>
                </div>
                <div className="flex flex-col gap-1">
                  {videoInfo!.audioTracks.map((t, i) => {
                    const label = t.title || TRACK_LABELS[i] || `Track ${i + 1}`
                    const checked = selectedIndices.has(i)
                    return (
                      <button
                        key={i}
                        onClick={() => toggleIndex(i)}
                        className={`w-full text-left px-3 py-2 rounded-lg border transition-colors ${
                          checked
                            ? 'bg-purple-600/20 border-purple-600/40'
                            : 'bg-white/[0.03] border-white/5 hover:bg-white/[0.06]'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <div className={`w-3.5 h-3.5 rounded border-2 flex items-center justify-center transition-colors shrink-0 ${
                            checked ? 'bg-purple-700 border-purple-700' : 'border-gray-600'
                          }`}>
                            {checked && <Check size={10} className="text-white" strokeWidth={3} />}
                          </div>
                          <div className="flex flex-col min-w-0">
                            <span className={`text-xs font-medium leading-tight ${checked ? 'text-purple-200' : 'text-gray-300'}`}>{label}</span>
                            <span className="text-[11px] text-gray-500 leading-tight mt-0.5">
                              {t.codec} · {t.channels}ch{t.language ? ` · ${t.language}` : ''}
                            </span>
                          </div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </>
            )}
          </div>
        )}
      </Modal>


      {showExportDialog && state.filePath && (() => {
        const activeDraft = activeDraftId ? folderDrafts.find(d => d.id === activeDraftId) : null
        const suffix = activeDraft ? `-${draftDisplayName(activeDraft)}` : undefined
        return (
          <ExportClipDialog
            defaultPresetId={config.clipPresetId ?? ''}
            defaultSuffix={suffix}
            filePath={state.filePath}
            hasBleepsOutsideRegions={clipState.bleepRegions.some(b =>
              !clipState.clipRegions.some(r => b.start >= r.inPoint && b.end <= r.outPoint)
            )}
            onConfirm={runExport}
            onClose={() => setShowExportDialog(false)}
          />
        )
      })()}
    </div>
  )
}
