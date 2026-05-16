import React, { useRef, useCallback, useEffect, useState, useMemo } from 'react'
import ReactDOM from 'react-dom'
import { Play, Pause, FolderOpen, Info, Layers, Check, RotateCcw, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, ChevronUp, ChevronDown, Camera, X, Loader2, Scissors, Crop, AudioWaveform, AudioLines, VolumeX, Upload, ZoomIn, Tv2, Lock, Unlock, Repeat, PlusSquare, PencilLine, Trash2, GitMerge, Film, Cloud, List, SkipBack, SkipForward } from 'lucide-react'
import { TAG_COLORS, TAG_COLOR_MAP, DEFAULT_TRACK_COLORS, getWaveformFillClass } from '../../constants/tagColors'
import { v4 as uuidv4 } from 'uuid'
import { useConversionJobs } from '../../context/ConversionContext'
import { useStore } from '../../hooks/useStore'
import type { AudioTrackSetting, BleepRegion, ClipRegion, ClipState, CropAspect, StreamMeta, TimelineViewport } from '../../types'
import { useVideoPlayer } from '../../hooks/useVideoPlayer'
import { useThumbnailStrip } from '../../hooks/useThumbnailStrip'
import { useWaveform } from '../../hooks/useWaveform'
import { FileDropZone } from '../ui/FileDropZone'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'
import { Tooltip } from '../ui/Tooltip'
import { Checkbox } from '../ui/Checkbox'
import { isClipExportCompatible } from '../../lib/clipExport'

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

// ── Per-track waveform strip (used inside the multi-track rows).
// Receives a precomputed SVG path so the parent can call useWaveform
// once with every extracted track and have all of them share a single
// `gmax`. That way a quiet mic track renders shorter peaks than a loud
// game track instead of each one being normalised to its own peak.
function TrackWaveformStrip({
  path, peakCount, loading, dimmed, volume, fillClass, onSeek, onHover, onHoverLeave, onMiddleDown,
}: {
  /** Pre-built SVG path. Empty string while the source's raw samples load. */
  path: string
  peakCount: number
  loading: boolean
  /** When true, the waveform fill is desaturated (e.g. muted or solo'd out). */
  dimmed: boolean
  /** 0–1 — scales the waveform's vertical amplitude so the visible peaks
   *  shrink as the user drags the volume slider down. The path itself is
   *  normalised; we apply scaleY via CSS rather than rebuilding the path
   *  so dragging stays cheap (no recompute on every input event). */
  volume: number
  /** Tailwind `fill-…/70` class derived from the track's chosen color
   *  (or the index-based default). Ignored when `dimmed` is true. */
  fillClass: string
  onSeek: (clientX: number, rect: DOMRect) => void
  onHover: (clientX: number, rect: DOMRect) => void
  onHoverLeave: () => void
  onMiddleDown: (e: React.MouseEvent) => void
}) {
  return (
    <div
      className="relative h-8 w-full cursor-pointer bg-black/60"
      onClick={e => onSeek(e.clientX, e.currentTarget.getBoundingClientRect())}
      onMouseDown={onMiddleDown}
      onMouseMove={e => onHover(e.clientX, e.currentTarget.getBoundingClientRect())}
      onMouseLeave={onHoverLeave}
    >
      {loading && !path && (
        <div className="absolute inset-0 flex items-center justify-center gap-1.5 text-[10px] text-gray-600 pointer-events-none">
          <Loader2 size={10} className="animate-spin" />
          Generating waveform…
        </div>
      )}
      {path && (
        <svg
          viewBox={`0 0 ${peakCount} 100`}
          preserveAspectRatio="none"
          className="w-full h-full"
          style={{ transform: `scaleY(${volume})`, transformOrigin: 'center' }}
        >
          <path
            d={path}
            className={dimmed ? 'fill-gray-500/30' : fillClass}
          />
        </svg>
      )}
    </div>
  )
}

// ── Per-track color picker portal. Anchored to a snapshotted rect (the
// dot's bounding rect at click time) so the picker stays put if the row
// re-renders. Click outside or on a swatch closes it.
function TrackColorPicker({
  rect, currentKey, onPick, onClose,
}: {
  rect: DOMRect
  currentKey: string | undefined
  onPick: (colorKey: string) => void
  onClose: () => void
}) {
  const pickerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])
  return ReactDOM.createPortal(
    <div
      ref={pickerRef}
      style={{ position: 'fixed', top: rect.bottom + 6, left: rect.left, zIndex: 10000 }}
      className="bg-navy-700 border border-white/10 rounded-xl shadow-2xl p-2"
    >
      <div className="grid grid-cols-4 gap-1.5">
        {TAG_COLORS.map(c => (
          <button
            key={c.key}
            type="button"
            title={c.label}
            onMouseDown={e => { e.preventDefault(); onPick(c.key) }}
            className={`w-6 h-6 rounded-full ${c.swatch} transition-transform hover:scale-110 flex items-center justify-center`}
          >
            {c.key === currentKey && <Check size={11} className="text-white drop-shadow" />}
          </button>
        ))}
      </div>
    </div>,
    document.body
  )
}

// ── Export Clip Dialog ────────────────────────────────────────────────────────

interface ExportClipDialogProps {
  defaultPresetId: string
  defaultSuffix?: string
  filePath: string
  hasBleepsOutsideRegions: boolean
  /** Audio tracks on the source video (from probe). Drives the per-track
   *  selection list. */
  audioTracks: { title?: string; codec?: string; channels?: number; language?: string }[]
  /** Current TrackState from useVideoPlayer — used to pick sensible
   *  defaults: tracks the user has played (status='extracted') and not
   *  muted start checked; the rest start unchecked, except in pristine
   *  mode where every track is checked. Volume is shown as a sanity-
   *  check label and forwarded to the converter so the exported clip
   *  matches what the user was hearing. */
  tracksState: { index: number; status: 'unextracted' | 'extracting' | 'extracted'; muted: boolean; volume: number }[]
  /** True iff the user has enabled multi-track for this file in this
   *  session. When false AND no track has been touched, we treat the
   *  state as "pristine" and default to all tracks selected. */
  multiTrackEnabled: boolean
  onConfirm: (opts: ExportClipOptions) => void
  onClose: () => void
}

export interface ExportClipOptions {
  presetId: string
  saveNextToSource: boolean
  outputDir: string
  suffix: string
  /** Source audio track indices to include in the exported clip's mix.
   *  Empty array is treated as "include all" by the main process for
   *  safety (so a buggy/legacy caller never ends up with a silent clip). */
  audioTrackIndices: number[]
  /** Per-track volume (0–1, where 1 = unity gain) applied during the
   *  export mix. Tracks not in this map use volume 1. Mirrors what the
   *  user set in the audio-controls row so the exported clip matches
   *  what they were hearing during editing. */
  audioTrackVolumes: Record<number, number>
}

function ExportClipDialog({ defaultPresetId, defaultSuffix, filePath, hasBleepsOutsideRegions, audioTracks, tracksState, multiTrackEnabled, onConfirm, onClose }: ExportClipDialogProps) {
  const [presets, setPresets] = useState<{ id: string; name: string; ffmpegArgs: string }[]>([])
  const [presetId, setPresetId] = useState(defaultPresetId)
  const [saveNextToSource, setSaveNextToSource] = useState(true)
  const [outputDir, setOutputDir] = useState('')
  const [suffix, setSuffix] = useState(defaultSuffix || '_clip')
  // Per-track export selection. Initial value follows the rule the user
  // wrote up: pristine state = include every track; otherwise honour the
  // current audio settings — extracted-and-not-muted tracks start
  // checked, unextracted tracks start unchecked (the user can still add
  // any of those by ticking the box — main process pulls them straight
  // from the source on export). Solo is deliberately ignored here; it
  // only affects monitoring, not what ends up in the file.
  const [selectedTrackIndices, setSelectedTrackIndices] = useState<Set<number>>(() => {
    const initial = new Set<number>()
    const pristine = !multiTrackEnabled && tracksState.every(t => t.index === 0 || (t.status === 'unextracted' && !t.muted))
    for (let i = 0; i < audioTracks.length; i++) {
      const st = tracksState.find(t => t.index === i)
      let include: boolean
      if (pristine) include = true
      else if (st?.status === 'extracted') include = !st.muted
      else include = false
      if (include) initial.add(i)
    }
    return initial
  })
  const toggleTrack = (i: number) => {
    setSelectedTrackIndices(prev => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }

  useEffect(() => {
    Promise.all([window.api.getBuiltinPresets(), window.api.getImportedPresets()])
      .then(([b, i]) => setPresets(
        [...b, ...i]
          .filter(p => isClipExportCompatible(p.ffmpegArgs))
          .map(p => ({ id: p.id, name: p.name, ffmpegArgs: p.ffmpegArgs }))
      ))
  }, [])

  // If the saved default preset is filtered out (stream-copy / audio-only),
  // fall back to "" so the dialog opens on the default-encoding option
  // rather than appearing to have a selection that won't actually work.
  useEffect(() => {
    if (presetId && presets.length > 0 && !presets.some(p => p.id === presetId)) {
      setPresetId('')
    }
  }, [presets, presetId])

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
            onClick={() => {
              // Pack a volume map only for the tracks the user actually
              // chose to include. Each entry mirrors what they were
              // hearing in the audio-controls row (or 1.0 if the track
              // hasn't been extracted in this session).
              const audioTrackVolumes: Record<number, number> = {}
              for (const i of selectedTrackIndices) {
                const st = tracksState.find(t => t.index === i)
                audioTrackVolumes[i] = st?.volume ?? 1
              }
              onConfirm({
                presetId,
                saveNextToSource,
                outputDir: saveNextToSource ? sourceDir : outputDir,
                suffix,
                audioTrackIndices: Array.from(selectedTrackIndices).sort((a, b) => a - b),
                audioTrackVolumes,
              })
            }}
            disabled={(!saveNextToSource && !outputDir) || selectedTrackIndices.size === 0}
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
            <option value="">— Default (H.264 CRF 18 + AAC 192k) —</option>
            {presets.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <p className="text-xs text-gray-500 leading-relaxed">
            Clip exports always re-encode (trim/crop/bleep filters require decoded frames), so stream-copy presets aren't shown.
          </p>
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

        {/* Audio tracks to include. Shown only for multi-track sources;
            single-track files have nothing to choose. Checked tracks are
            mixed into the exported clip's audio; un-checked tracks are
            dropped. Track 0 always comes from the video file directly,
            tracks 1+ can be added even if they haven't been played
            during this session — main process reads them straight from
            the source on export. */}
        {audioTracks.length > 1 && (
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-gray-300">Audio Tracks to Include</label>
            <div className="flex flex-col gap-1">
              {audioTracks.map((t, i) => {
                const checked = selectedTrackIndices.has(i)
                const st = tracksState.find(s => s.index === i)
                const label = t.title || TRACK_LABELS[i] || `Track ${i + 1}`
                const detail = `${t.codec ?? 'audio'}${t.channels ? ` · ${t.channels}ch` : ''}${t.language ? ` · ${t.language}` : ''}`
                const isUnextracted = st?.status === 'unextracted'
                // Volume shown to the user as a sanity check. Tracks the
                // user never touched default to 100% (they'd be exported
                // at unity gain anyway).
                const volPct = Math.round((st?.volume ?? 1) * 100)
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => toggleTrack(i)}
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
                      <div className="flex flex-col min-w-0 flex-1">
                        <span className={`text-xs font-medium leading-tight ${checked ? 'text-purple-200' : 'text-gray-300'}`}>
                          {label}
                          <span className="text-gray-500 font-normal"> · Track {i + 1}</span>
                        </span>
                        <span className="text-[11px] text-gray-500 leading-tight mt-0.5">{detail}</span>
                      </div>
                      {isUnextracted && (
                        <span className="text-[10px] text-gray-500 shrink-0 italic">not playing</span>
                      )}
                      <span
                        className={`text-[11px] tabular-nums shrink-0 ${checked ? 'text-purple-200' : 'text-gray-500'}`}
                        title="Volume from the audio controls row — adjust there to change it for the export."
                      >
                        {volPct}%
                      </span>
                    </div>
                  </button>
                )
              })}
            </div>
            {selectedTrackIndices.size === 0 && (
              <p className="text-[11px] text-yellow-400/90">Pick at least one track — the exporter needs an audio source.</p>
            )}
          </div>
        )}

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
  indented = false,
  compact = false,
}: {
  item: SiblingFile
  isActive: boolean
  onClick: () => void
  /** When true, render as an icon-strip-friendly tiny row (used by the
   *  collapsed sidebar). Smaller thumbnail, no inline metadata, full
   *  info shown in a hover tooltip instead. */
  compact?: boolean
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

  // Compact rendering uses a fixed 20px thumbnail height to fit the
  // collapsed sidebar's narrow content area; expanded keeps the previous
  // 32px height. Width is derived from the captured aspect ratio so
  // unusual ratios stay correctly shaped.
  const thumbHeight = compact ? 20 : 32
  const thumbWidth = Math.round(thumbHeight * aspectRatio)

  // Combined info string surfaced via tooltip in compact mode so the user
  // can still see name + duration + category without the inline metadata.
  const durationStr = duration !== null ? formatTime(duration) : item.isLocal ? '…' : 'Cloud sync'
  const categoryStr = item.category ? ` · ${SESSION_CATEGORY_LABEL[item.category] ?? item.category}` : ''
  const tooltipContent = `${item.name} · ${durationStr}${categoryStr}`

  const body = (
    <div
      onClick={onClick}
      className={`group/item w-full text-left flex items-center gap-2 ${indented ? (compact ? 'pl-3 pr-1' : 'pl-6 pr-2') : (compact ? 'px-1' : 'px-2')} py-1.5 rounded-lg transition-colors cursor-pointer ${
        isActive
          ? 'bg-purple-600/20'
          : 'hover:bg-white/5'
      }`}
    >
      {/* Thumbnail */}
      <div
        className="relative shrink-0 rounded overflow-hidden bg-white/5"
        style={{ width: thumbWidth, height: thumbHeight }}
      >
        {thumbnail ? (
          <img
            src={thumbnail}
            className="w-full h-full object-cover transition-transform duration-200 group-hover/item:scale-110"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-700">
            {item.isLocal
              ? <Film size={compact ? 9 : 11} />
              : <span className={`leading-tight text-center px-1 text-gray-600 ${compact ? 'text-[7px]' : 'text-[9px]'}`}>Cloud</span>
            }
          </div>
        )}
      </div>

      {/* Inline info — hidden in compact mode (surfaced via tooltip). */}
      {!compact && (
        <div className="min-w-0 flex-1">
          <div className={`text-[11px] font-medium truncate leading-tight ${isActive ? 'text-purple-200' : 'text-gray-300'}`}>
            {item.name}
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="text-[10px] text-gray-500 tabular-nums">{durationStr}</span>
            {item.category && (
              <span className={`inline-block text-[9px] font-mono border rounded px-1 leading-tight ${SESSION_CATEGORY_STYLES[item.category] ?? ''}`}>
                {SESSION_CATEGORY_LABEL[item.category] ?? item.category}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )

  // Both compact and expanded modes wrap in a Tooltip so the user can
  // read the full filename when the inline label is truncated. Compact
  // sits in the popup-out (left of the sidebar) so the tooltip flows
  // right; expanded sits inside the right-edge sidebar so it flows
  // left. side= is the *preferred* side — Tooltip falls back if it
  // doesn't fit.
  return (
    <Tooltip
      content={tooltipContent}
      side={compact ? 'right' : 'left'}
      triggerClassName="block"
    >
      {body}
    </Tooltip>
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
  compact = false,
}: {
  draft: import('../../types').ClipDraft
  displayName: string
  sourceFps?: number
  isActive: boolean
  isExporting?: boolean
  onClick: () => void
  onDelete: () => void
  onRename: (newName: string) => Promise<boolean>
  /** When true, render as an icon-strip-friendly tiny row (collapsed
   *  sidebar). Renaming, deletion, and inline metadata move to the
   *  hover tooltip; the user can still expand the sidebar for those. */
  compact?: boolean
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

  // Compact mode condenses the row to icon + tooltip only — rename and
  // delete are out of reach until the user expands the sidebar.
  const tooltipContent = `${displayName} · ${isExporting ? 'exporting…' : 'draft'} · ${segmentCount} seg${segmentCount === 1 ? '' : 's'}${totalDuration > 0 ? ` · ${formatTime(totalDuration, sourceFps)}` : ''}`

  const body = (
    <div
      className={`group/item w-full text-left flex items-center gap-2 ${compact ? 'pl-3 pr-1' : 'pl-6 pr-2'} py-1.5 rounded-lg transition-colors ${editing ? '' : isExporting ? 'cursor-not-allowed' : 'cursor-pointer'} ${
        isActive ? 'bg-purple-600/20' : isExporting ? 'opacity-60' : 'hover:bg-white/5'
      }`}
      onClick={editing || isExporting ? undefined : onClick}
      title={compact || editing ? undefined : isExporting ? 'This clip is currently exporting. Wait for the conversion to finish (or cancel it) before editing.' : `Open clip draft for ${draft.sourceName}`}
    >
      <div
        className={`shrink-0 rounded flex items-center justify-center bg-blue-950/40 border border-blue-500/20 text-blue-400 ${compact ? 'w-5 h-5' : 'w-8 h-8'}`}
      >
        <Scissors size={compact ? 10 : 14} />
      </div>
      {!compact && (
        <>
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
        </>
      )}
    </div>
  )

  return compact
    ? <Tooltip content={tooltipContent} side="right" triggerClassName="block">{body}</Tooltip>
    : body
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
  const {
    videoRef, state, loadFile,
    enableMultiTrack, disableMultiTrack, playTrack, cancelExtraction,
    setTrackMuted, setTrackSolo, setTrackVolume, setTrackColor, recomputeAudibility,
    clearError, closeVideo, seek, fastSeek, togglePlay,
  } = useVideoPlayer()
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
  // Full list of stream folders in the streams root, sorted by date.
  // Powers the Selected Stream sidebar section: lookup of the stream
  // the currently-loaded video belongs to, plus prev/next navigation
  // between sibling stream items.
  const [allStreamFolders, setAllStreamFolders] = useState<import('../../types').StreamFolder[]>([])
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

      // Apply saved per-track audio settings (mute / solo / volume) for the
      // currently-loaded file. Skips indices that don't exist in the source.
      const savedSettings: Record<number, AudioTrackSetting> | undefined =
        (folderMeta as StreamMeta).audioSettings?.[currentName] ??
        (folderMeta as StreamMeta).audioSettings?.[currentRelKey]
      if (savedSettings) {
        for (const [idxStr, s] of Object.entries(savedSettings)) {
          const i = Number(idxStr)
          if (Number.isNaN(i)) continue
          if (s.muted !== undefined) setTrackMuted(i, !!s.muted)
          if (s.solo !== undefined) setTrackSolo(i, !!s.solo)
          if (s.volume !== undefined) setTrackVolume(i, s.volume)
          if (s.color !== undefined) setTrackColor(i, s.color)
        }
      }
    } catch { /* swallow */ }
  }, [config.streamsDir, setTrackMuted, setTrackSolo, setTrackVolume, setTrackColor])

  useEffect(() => {
    reloadSessionPanel(state.filePath)
  }, [state.filePath, reloadSessionPanel])

  // Populate the full stream-folder list used by the Selected Stream
  // sidebar section. Re-runs when the streams root or mode changes and
  // also when the active video changes (so newly-added folders or
  // freshly-written meta surface without a full app reload).
  useEffect(() => {
    if (!config.streamsDir) { setAllStreamFolders([]); return }
    let cancelled = false
    ;(async () => {
      try {
        const folders = await window.api.listStreams(
          config.streamsDir,
          (config.streamMode || 'folder-per-stream') as 'folder-per-stream' | 'dump-folder',
        )
        if (!cancelled) setAllStreamFolders(folders)
      } catch { /* swallow */ }
    })()
    return () => { cancelled = true }
  }, [config.streamsDir, config.streamMode, state.filePath])

  // Sorted list (by date, oldest → newest) so prev/next is chronological.
  // Filtering on a stable date string also avoids in-place mutation surprises.
  const sortedStreamFolders = useMemo(
    () => [...allStreamFolders].sort((a, b) => a.date.localeCompare(b.date) || a.relativePath.localeCompare(b.relativePath)),
    [allStreamFolders],
  )

  // The stream folder the currently-loaded video belongs to, or null if
  // the user opened a video that isn't part of any stream item (e.g.
  // dropped a one-off file from outside the streams root).
  const currentStreamFolder = useMemo(() => {
    if (!state.filePath || !config.streamsDir) return null
    const { metaKey } = resolveStreamContext(state.filePath, config.streamsDir)
    return (
      sortedStreamFolders.find(f => f.relativePath === metaKey) ??
      (folderPath ? sortedStreamFolders.find(f => f.folderPath === folderPath) : null) ??
      null
    )
  }, [state.filePath, config.streamsDir, sortedStreamFolders, folderPath])

  // Prev/next stream items in chronological order. Streams with zero
  // playable video files are skipped over (navigating to an empty
  // folder would just dead-end the player). When no qualifying stream
  // exists in a direction the corresponding button stays disabled.
  const currentStreamIndex = useMemo(() => {
    if (!currentStreamFolder) return -1
    return sortedStreamFolders.findIndex(
      f => f.folderPath === currentStreamFolder.folderPath && f.relativePath === currentStreamFolder.relativePath,
    )
  }, [sortedStreamFolders, currentStreamFolder])
  const prevStreamFolder = useMemo(() => {
    if (currentStreamIndex < 0) return null
    for (let i = currentStreamIndex - 1; i >= 0; i--) {
      if (sortedStreamFolders[i].videos.length > 0) return sortedStreamFolders[i]
    }
    return null
  }, [sortedStreamFolders, currentStreamIndex])
  const nextStreamFolder = useMemo(() => {
    if (currentStreamIndex < 0) return null
    for (let i = currentStreamIndex + 1; i < sortedStreamFolders.length; i++) {
      if (sortedStreamFolders[i].videos.length > 0) return sortedStreamFolders[i]
    }
    return null
  }, [sortedStreamFolders, currentStreamIndex])

  // Jump to the prev/next stream and auto-load its first audible video.
  // Prefer a 'full' recording over exported child clips/shorts (same rule
  // as Streams page → "Send to Player") so jumping streams lands on the
  // source recording by default. Within that preference, the first
  // *hydrated* video wins; if everything is a cloud placeholder we fall
  // back to the preferred[0] and let loadFile's cloud download kick in.
  const navigateToStream = useCallback(async (target: import('../../types').StreamFolder | null) => {
    if (!target || target.videos.length === 0) return
    const videoMap = target.meta?.videoMap
    const folderNorm = target.folderPath.replace(/\\/g, '/').replace(/\/$/, '')
    const relKey = (absPath: string): string => {
      const p = absPath.replace(/\\/g, '/')
      return p.startsWith(folderNorm + '/') ? p.slice(folderNorm.length + 1) : p.split('/').pop() ?? p
    }
    const fullVideos = target.videos.filter(v => videoMap?.[relKey(v)]?.category === 'full')
    const preferred = fullVideos.length > 0 ? fullVideos : target.videos
    let videoPath = preferred[0]
    try {
      const localFlags = await window.api.checkLocalFiles(preferred)
      const firstLocal = localFlags.findIndex(b => b)
      if (firstLocal >= 0) videoPath = preferred[firstLocal]
    } catch { /* fall back to preferred[0] */ }
    loadFile(videoPath)
  }, [loadFile])

  // Session Videos hover popup (collapsed-sidebar only). Replaces the
  // squeezed inline list with a single icon trigger that pops out the
  // full panel to the left on hover. The close timer gives the user a
  // 200 ms grace window to transition the cursor from trigger to popup
  // without losing the open state.
  const [sessionVideosPopupOpen, setSessionVideosPopupOpen] = useState(false)
  const sessionVideosTriggerRef = useRef<HTMLButtonElement>(null)
  const sessionVideosCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const openSessionVideosPopup = useCallback(() => {
    if (sessionVideosCloseTimer.current) {
      clearTimeout(sessionVideosCloseTimer.current)
      sessionVideosCloseTimer.current = null
    }
    setSessionVideosPopupOpen(true)
  }, [])
  const scheduleCloseSessionVideosPopup = useCallback(() => {
    if (sessionVideosCloseTimer.current) clearTimeout(sessionVideosCloseTimer.current)
    sessionVideosCloseTimer.current = setTimeout(() => setSessionVideosPopupOpen(false), 200)
  }, [])
  // Force-close the popup whenever the user expands the sidebar — the
  // inline section takes over and the popup would be redundant/stale.
  useEffect(() => {
    if (!panelCollapsed) setSessionVideosPopupOpen(false)
  }, [panelCollapsed])

  // Quick stream-jump dropdown — open this from the list-icon button in
  // the Selected Stream header instead of clicking prev/next many times.
  // Same anchor + dynamic max-height pattern as the Streams page filter
  // dropdowns so it stays inside the viewport on small windows.
  const [streamPickerOpen, setStreamPickerOpen] = useState(false)
  // Ref is HTMLElement (not HTMLDivElement) because the anchor switches
  // between a <div> wrapper (expanded sidebar) and a <button> (collapsed
  // sidebar) depending on layout. We only call getBoundingClientRect on
  // it, which is defined on HTMLElement.
  const streamPickerAnchorRef = useRef<HTMLElement>(null)
  const [streamPickerMaxHeight, setStreamPickerMaxHeight] = useState(600)
  const updateStreamPickerMaxHeight = useCallback(() => {
    if (streamPickerAnchorRef.current) {
      const rect = streamPickerAnchorRef.current.getBoundingClientRect()
      // Expanded mode pops the dropdown BELOW the button group, so cap
      // by the remaining viewport height under it. Collapsed mode pops
      // it to the LEFT of the icon button with its TOP aligned to the
      // anchor's top — so the budget is viewport-height minus rect.top
      // (and a small bottom margin) to keep the last row in-window.
      setStreamPickerMaxHeight(
        panelCollapsed
          ? Math.max(160, window.innerHeight - rect.top - 12)
          : window.innerHeight - rect.bottom - 12,
      )
    }
  }, [panelCollapsed])
  const openStreamPicker = useCallback(() => {
    if (streamPickerOpen) { setStreamPickerOpen(false); return }
    updateStreamPickerMaxHeight()
    setStreamPickerOpen(true)
  }, [streamPickerOpen, updateStreamPickerMaxHeight])
  useEffect(() => {
    if (!streamPickerOpen) return
    window.addEventListener('resize', updateStreamPickerMaxHeight)
    return () => window.removeEventListener('resize', updateStreamPickerMaxHeight)
  }, [streamPickerOpen, updateStreamPickerMaxHeight])

  // Debounced save of per-track audio settings back into _meta.json. Only
  // non-default values are persisted; if every track is at defaults the
  // entry is dropped entirely to keep meta clean. Save fires for any
  // mute/solo/volume change once the user has interacted with multi-track,
  // not while the file is loading — `state.multiTrackEnabled` gates that.
  useEffect(() => {
    if (!state.filePath || !folderPath || !state.multiTrackEnabled) return
    const filePath = state.filePath
    const metaKey = folderMetaKeyRef.current
    if (!metaKey) return
    const timer = setTimeout(async () => {
      try {
        const { streamsDir } = resolveStreamContext(filePath, config.streamsDir)
        const raw = await window.api.readFile(`${streamsDir}/_meta.json`).then(r => JSON.parse(r)).catch(() => null)
        const existing: StreamMeta = raw?.[metaKey] ?? { date: '', streamType: [], games: [], comments: '' }
        const filename = filePath.replace(/.*[\\/]/, '')
        const entry: Record<number, AudioTrackSetting> = {}
        for (const t of state.tracks) {
          const settings: AudioTrackSetting = {}
          if (t.muted) settings.muted = true
          if (t.solo) settings.solo = true
          if (t.volume !== 1) settings.volume = t.volume
          if (t.color !== undefined) settings.color = t.color
          if (Object.keys(settings).length > 0) entry[t.index] = settings
        }
        const allAudioSettings = { ...(existing.audioSettings ?? {}) }
        if (Object.keys(entry).length === 0) delete allAudioSettings[filename]
        else allAudioSettings[filename] = entry
        const updated: StreamMeta = { ...existing, audioSettings: allAudioSettings }
        await window.api.writeStreamMeta(folderPath, updated, metaKey)
      } catch { /* swallow */ }
    }, 500)
    return () => clearTimeout(timer)
  }, [state.tracks, state.filePath, folderPath, state.multiTrackEnabled, config.streamsDir])

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

  // Multi-track warning modal before entering clip mode. Only the 'warn'
  // variant is used now — the legacy 'merge' selection step was removed
  // when extraction became lazy/per-track. State type kept loose so old
  // saved sessions aren't a problem.
  const [clipModeModal, setClipModeModal] = useState<'warn' | 'merge' | null>(null)
  // Tracks the "don't show this again" checkbox inside the warn modal —
  // persisted to config when the user confirms via either footer action.
  const [warnDontShowAgain, setWarnDontShowAgain] = useState(false)
  // Per-track color picker state. Snapshotted rect (not a live element)
  // so the picker stays anchored even if the row re-renders or the dot
  // unmounts due to a status flip.
  const [colorPicker, setColorPicker] = useState<{ trackIndex: number; rect: DOMRect } | null>(null)
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


  const { videoInfo, tracks, multiTrackEnabled, isPlaying, currentTime, duration, videoUrl, error } = state
  const isExtracting = tracks.some(t => t.status === 'extracting')
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

  // Start/stop the 1 kHz bleep tone and mute/unmute the video simultaneously.
  // During a bleep, force every audio source silent (video element + any
  // extracted-track audio elements). When the bleep ends, defer to the
  // hook's recomputeAudibility so the user's M/S/solo choices come back —
  // we can't just clear `.muted` because that would override mute state.
  const startBleep = useCallback(() => {
    if (isBleepingRef.current) return
    isBleepingRef.current = true
    if (videoRef.current) videoRef.current.muted = true
    for (const t of tracks) {
      if (t.audioEl) t.audioEl.muted = true
    }

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
  }, [videoRef, tracks])

  const stopBleep = useCallback(() => {
    if (!isBleepingRef.current) return
    isBleepingRef.current = false
    // Restore audibility from the current M/S/solo state.
    recomputeAudibility()

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
  }, [recomputeAudibility])

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

  // Jump to the closest clip-region in/out marker in the given direction.
  // Shared by the [ / ] keyboard shortcuts and the clip-mode prev/next
  // buttons in the playback controls row. Returns the target time if a
  // marker was found, or null if there's nothing in that direction —
  // useful for disabling the buttons.
  const jumpToMarker = useCallback((direction: 'prev' | 'next'): number | null => {
    const markers: number[] = []
    for (const r of clipStateRef.current.clipRegions) { markers.push(r.inPoint, r.outPoint) }
    if (markers.length === 0) return null
    markers.sort((a, b) => a - b)
    const t = currentTimeRef.current
    const eps = 0.001
    let target: number | undefined
    if (direction === 'next') target = markers.find(m => m > t + eps)
    else { for (let i = markers.length - 1; i >= 0; i--) { if (markers[i] < t - eps) { target = markers[i]; break } } }
    if (target === undefined) return null
    seekRef.current(target)
    return target
  }, [])

  // Thumbnail strip
  const [filmstripEl, setFilmstripEl] = useState<HTMLDivElement | null>(null)
  const [stripWidth, setStripWidth] = useState(0)
  const [hoverRatio, setHoverRatio] = useState<number | null>(null)
  const isPlayheadDraggingRef = useRef(false)

  // Track the scrollbar's pixel width so the playhead position can be
  // pixel-snapped — a fractional left would render the 1px playhead
  // across two pixels at half intensity and look invisible.
  const [scrollbarWidth, setScrollbarWidth] = useState(0)
  useEffect(() => {
    const el = scrollbarRef.current
    if (!el) return
    setScrollbarWidth(el.getBoundingClientRect().width)
    const ro = new ResizeObserver(entries => setScrollbarWidth(entries[0].contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [duration]) // re-attach when scrollbar appears (gated on duration > 0)

  // Per-track volume-input draft. Key = track index, value = the
  // in-progress string while the user is typing. The entry exists only
  // while the input is focused/being edited; it's cleared on commit
  // (Enter/blur) so the field falls back to the live volume rendered as
  // an integer percentage. A draft is necessary because typing "1"→"0"→"0"
  // for 100 would otherwise be impossible — parseInt on each keystroke
  // would round-trip a partial value back into the field.
  const [volumeInputs, setVolumeInputs] = useState<Record<number, string>>({})

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

  // Waveform sources. In single-track mode this is just the video file
  // (so the legacy single waveform strip renders it). In multi-track mode
  // it's every extracted track, in track-index order — the hook returns
  // a parallel `svgPaths` array where each entry is normalised to the
  // shared peak across all tracks, so quiet tracks look quiet relative
  // to loud ones rather than each filling its row.
  const waveformSources = useMemo(() => {
    if (!state.filePath) return []
    if (multiTrackEnabled) {
      return state.tracks
        .filter(t => t.status === 'extracted')
        .map(t => t.index === 0 ? state.filePath! : t.cachedPath!) as string[]
    }
    return [state.filePath]
  }, [state.filePath, multiTrackEnabled, state.tracks])

  const { svgPath: waveformPath, svgPaths: trackWaveformPaths, peakCount, loading: waveformLoading } = useWaveform(waveformSources, vStart, vEnd, duration)
  // Map track.index → its individually-normalised path, in the order the
  // hook produced them. Lookups stay O(1) and the map is stable as long
  // as the underlying svgPaths array reference is.
  const trackPathByIndex = useMemo(() => {
    const m = new Map<number, string>()
    if (!state.multiTrackEnabled) return m
    let i = 0
    for (const t of state.tracks) {
      if (t.status === 'extracted') {
        m.set(t.index, trackWaveformPaths[i] ?? '')
        i++
      }
    }
    return m
  }, [state.multiTrackEnabled, state.tracks, trackWaveformPaths])

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
      audioTrackIndices: opts.audioTrackIndices,
      audioTrackVolumes: opts.audioTrackVolumes,
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
          else if (multiTrack && !multiTrackEnabled && !isExtracting && !config.skipClipMergeWarning) {
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
          jumpToMarker(k === ']' ? 'next' : 'prev')
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
    effectiveTogglePlay, skip, stepFrame, multiTrack, multiTrackEnabled, isExtracting,
    config.skipClipMergeWarning, exitClipMode,
    setClipFocus, isPopupOpen, openVideoPopup, handleBrowse, captureScreenshot,
    closeVideo, state.filePath, addSegment, splitSegment, jumpToMarker,
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
                  <Tooltip content={isPopupOpen ? 'Return video to player' : 'Pop out video (for stream capture)'}>
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
            <div className="bg-navy-800 border-t border-white/5 py-2 px-3 flex flex-col gap-2 shrink-0">

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

              </div>

              {/* Audio area — when multi-track is OFF, this is the legacy single
                  waveform strip plus an "Enable Multi-track Audio" chip on
                  multi-track sources. When multi-track is ON, the strip is
                  replaced by one row per audio track (controls + waveform),
                  with a small "Disable Multi-track audio" affordance at the
                  bottom. */}
              {!multiTrackEnabled ? (
                <>
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
                          className="fill-gray-300/60"
                        />
                      </svg>
                    )}
                  </div>
                </>
              ) : (
                <>
                  {/* Per-track rows. anySolo is computed once so every row
                      can flag its waveform as dimmed when solo'd out. */}
                  {/* Multi-track audio area wraps in a relative+z-30 container
                      so the playhead (z-20 inside the strips wrapper) renders
                      BEHIND each track row rather than over it. Control rows
                      have a low-opacity background so the playhead bleeds
                      faintly through. */}
                  <div className="relative z-30">
                  {(() => {
                    const anySolo = tracks.some(t => t.solo)
                    const onTrackSeek = (clientX: number, rect: DOMRect) => {
                      setSelectedRegionId(null)
                      const ratio = (clientX - rect.left) / rect.width
                      seekRef.current(Math.max(0, Math.min(duration, vStart + ratio * vSpan)))
                    }
                    const onTrackHover = (clientX: number, rect: DOMRect) => {
                      if (isPlayheadDraggingRef.current) return
                      setHoverRatio((clientX - rect.left) / rect.width)
                    }
                    const onTrackHoverLeave = () => { if (!isPlayheadDraggingRef.current) setHoverRatio(null) }
                    // Fixed pre-name column width. Lines up the name across
                    // extracted (dot/M/S/volume on the left) and unextracted
                    // (dot + "Add track to playback" button) rows so it
                    // never jitters as tracks become available. Sized to
                    // fit the longest variant — the unextracted button.
                    const CTRL_COL = '220px'
                    return tracks.map(track => {
                      const label = track.title || TRACK_LABELS[track.index] || `Track ${track.index + 1}`
                      const effectivelyMuted = anySolo ? !track.solo : track.muted
                      const wfPath = trackPathByIndex.get(track.index) ?? ''
                      // Color resolution: explicit user choice wins; else
                      // fall back to the per-index default rotation so
                      // every track has a distinct look out of the box.
                      const effectiveColorKey = track.color ?? DEFAULT_TRACK_COLORS[track.index % DEFAULT_TRACK_COLORS.length]
                      const swatchClass = TAG_COLOR_MAP[effectiveColorKey]?.swatch ?? 'bg-purple-500'
                      const fillClass = getWaveformFillClass(effectiveColorKey)
                      const colorDot = (
                        <button
                          onClick={e => setColorPicker({ trackIndex: track.index, rect: e.currentTarget.getBoundingClientRect() })}
                          className={`w-3 h-3 rounded-full shrink-0 transition-transform hover:scale-110 ${swatchClass}`}
                          title="Change track color"
                        />
                      )
                      return (
                        <div key={track.index} className="border-t border-navy-700/70">
                          {/* Controls row. Bg matches the waveform strip so
                              the playhead is uniformly visible/hidden across
                              the two; a subtle 1px bottom border separates
                              the control area from its own waveform. The
                              outer track-pair divider above is the heavier
                              one (border-white/15) — it groups each
                              control+waveform pair into a single visual
                              block. Unextracted rows are slightly lighter
                              so the call-to-action stands out. */}
                          <div
                            className={`grid items-center gap-2 px-2 py-1 text-[11px] min-h-[24px] border-b border-white/5 ${
                              track.status === 'unextracted' ? 'bg-navy-800/70' : 'bg-black/60'
                            }`}
                            style={{ gridTemplateColumns: `${CTRL_COL} 1fr` }}
                          >
                            {track.status === 'extracting' ? (
                              <div className="col-span-2 flex items-center gap-2">
                                {colorDot}
                                <Loader2 size={12} className="animate-spin shrink-0 text-purple-400" />
                                <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
                                  <div
                                    className="h-full bg-purple-500 rounded-full transition-all"
                                    style={{ width: `${track.extractProgress}%` }}
                                  />
                                </div>
                                <span className="text-[10px] tabular-nums text-gray-500 shrink-0 w-8 text-right">{track.extractProgress}%</span>
                                <span className="text-[10px] text-gray-500 truncate ml-1" title={label}>{label}</span>
                              </div>
                            ) : track.status === 'extracted' ? (
                              <>
                                <div className="flex items-center gap-1.5">
                                  {colorDot}
                                  <button
                                    onClick={() => setTrackMuted(track.index, !track.muted)}
                                    className={`w-5 h-4 rounded text-[9px] font-semibold transition-colors ${
                                      track.muted
                                        ? 'bg-red-600/40 text-red-100 border border-red-500/60'
                                        : 'bg-white/5 text-gray-400 border border-white/10 hover:bg-white/10 hover:text-gray-200'
                                    }`}
                                    title={track.muted ? 'Unmute' : 'Mute this track'}
                                  >
                                    M
                                  </button>
                                  <button
                                    onClick={() => setTrackSolo(track.index, !track.solo)}
                                    className={`w-5 h-4 rounded text-[9px] font-semibold transition-colors ${
                                      track.solo
                                        ? 'bg-yellow-500/35 text-yellow-100 border border-yellow-400/60'
                                        : 'bg-white/5 text-gray-400 border border-white/10 hover:bg-white/10 hover:text-gray-200'
                                    }`}
                                    title={track.solo ? 'Unsolo' : 'Solo this track (silences others)'}
                                  >
                                    S
                                  </button>
                                  {(() => {
                                    const pct = Math.round(track.volume * 100)
                                    // Track gradient lives on the input
                                    // itself (not ::-webkit-slider-runnable-track)
                                    // because appearance:none lets Chromium
                                    // use the input's background as the track,
                                    // and Tailwind's arbitrary-value parser
                                    // chokes on linear-gradient() commas
                                    // when nested in a pseudo-element
                                    // selector. Fill color is the project's
                                    // purple-500 (#c9d5e3) — slate light-grey
                                    // per tailwind.config.js, not real purple.
                                    const draft = volumeInputs[track.index]
                                    const displayed = draft ?? String(pct)
                                    const commit = (raw: string) => {
                                      const n = parseInt(raw, 10)
                                      if (!isNaN(n)) setTrackVolume(track.index, Math.max(0, Math.min(100, n)) / 100)
                                      setVolumeInputs(prev => {
                                        if (!(track.index in prev)) return prev
                                        const next = { ...prev }
                                        delete next[track.index]
                                        return next
                                      })
                                    }
                                    return (
                                      <>
                                        <input
                                          type="range"
                                          min={0}
                                          max={100}
                                          step={1}
                                          value={pct}
                                          onChange={e => setTrackVolume(track.index, parseInt(e.target.value, 10) / 100)}
                                          style={{
                                            background: `linear-gradient(to right, #c9d5e3 ${pct}%, rgba(255,255,255,0.1) ${pct}%)`,
                                          }}
                                          className="volume-slider-mt w-[100px] h-1 rounded-full cursor-pointer appearance-none"
                                          title={`Volume — ${pct}%`}
                                        />
                                        {/* Editable percentage — minimal styling
                                            matches the timecode inputs (transparent
                                            bg, tabular-nums, no focus ring).
                                            ArrowUp/Down step ±1% and commit
                                            immediately; Enter/blur commit any
                                            typed value; Escape reverts. */}
                                        <input
                                          type="text"
                                          inputMode="numeric"
                                          value={displayed}
                                          onChange={e => setVolumeInputs(prev => ({ ...prev, [track.index]: e.target.value.replace(/[^0-9]/g, '') }))}
                                          onKeyDown={e => {
                                            if (e.key === 'Enter') { (e.currentTarget as HTMLInputElement).blur(); return }
                                            if (e.key === 'Escape') {
                                              setVolumeInputs(prev => {
                                                if (!(track.index in prev)) return prev
                                                const next = { ...prev }
                                                delete next[track.index]
                                                return next
                                              })
                                              ;(e.currentTarget as HTMLInputElement).blur()
                                              return
                                            }
                                            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                                              e.preventDefault()
                                              const base = parseInt(displayed, 10)
                                              if (isNaN(base)) return
                                              const next = Math.max(0, Math.min(100, base + (e.key === 'ArrowUp' ? 1 : -1)))
                                              setVolumeInputs(prev => ({ ...prev, [track.index]: String(next) }))
                                              setTrackVolume(track.index, next / 100)
                                            }
                                          }}
                                          onBlur={e => commit(e.currentTarget.value)}
                                          className="w-7 text-[11px] text-gray-300 tabular-nums bg-transparent focus:outline-none text-right"
                                          title={`Volume — ${pct}%`}
                                        />
                                        <span className="text-[10px] text-gray-500 select-none -ml-0.5">%</span>
                                      </>
                                    )
                                  })()}
                                </div>
                                <span className="truncate text-gray-300" title={label}>{label}</span>
                              </>
                            ) : (
                              <>
                                <div className="flex items-center gap-1.5">
                                  {colorDot}
                                  <button
                                    onClick={() => playTrack(track.index)}
                                    className="flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] bg-white/5 border border-white/10 hover:bg-purple-600/15 hover:border-purple-500/30 text-purple-200 transition-colors"
                                    title={`Decode and play ${label}`}
                                  >
                                    <AudioLines size={11} className="text-purple-400 shrink-0" />
                                    Add track to playback
                                  </button>
                                </div>
                                <span className="truncate text-gray-400" title={label}>{label}</span>
                              </>
                            )}
                          </div>
                          {/* Waveform — only when extracted. Track 0's source
                              is the video file (its built-in first audio
                              track), tracks 1+ come from their cached .opus. */}
                          {track.status === 'extracted' && (
                            <TrackWaveformStrip
                              path={wfPath}
                              peakCount={peakCount}
                              loading={waveformLoading}
                              dimmed={effectivelyMuted}
                              volume={track.volume}
                              fillClass={fillClass}
                              onSeek={onTrackSeek}
                              onHover={onTrackHover}
                              onHoverLeave={onTrackHoverLeave}
                              onMiddleDown={e => startMiddleClickPan(e, e.currentTarget.getBoundingClientRect().width)}
                            />
                          )}
                        </div>
                      )
                    })
                  })()}
                  </div>
                </>
              )}

              {/* Playhead — single element spanning both strips; frozen during handle drag.
                  Pixel-snapped via stripWidth so the 1px line lands on an integer pixel —
                  without snapping, translateX(-50%) on a 1px element shifts by 0.5px and
                  subpixel-blurs the line into invisibility. Hit area keeps the
                  translateX(-50%) since it's 12px wide and pixel-aligns cleanly at -6px. */}
              {duration > 0 && (handleDragDisplayTime ?? currentTime) >= vStart && (handleDragDisplayTime ?? currentTime) <= vEnd && (() => {
                const t = handleDragDisplayTime ?? currentTime
                const ratio = (t - vStart) / vSpan
                // floor (not round) so the playhead lands on the pixel
                // directly under the cursor while dragging — round would
                // jump 1px right whenever the cursor is in a pixel's
                // right half. Cap to stripWidth-1 so the right edge
                // case (ratio === 1) still paints a visible pixel.
                const px = Math.min(stripWidth - 1, Math.max(0, Math.floor(ratio * stripWidth)))
                return (
                  <>
                    <div
                      className="playhead-line absolute top-0 bottom-0 w-px pointer-events-none z-20"
                      style={{ left: `${px}px` }}
                    />
                    {/* Draggable hit area — z-10 beats region drag (no z-index), yields to handles (z-20) */}
                    <div
                      className="absolute inset-y-0 z-10 -translate-x-1/2 cursor-ew-resize"
                      style={{ left: `${px}px`, width: '12px' }}
                      onMouseDown={startPlayheadDrag}
                    />
                  </>
                )
              })()}

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
                      return <div key={idx} className="absolute inset-y-0 bg-black/45 pointer-events-none z-[40]" style={{ left: `${l}%`, right: `${r}%` }} />
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
                        className="absolute top-8 bottom-0 bg-black overflow-hidden cursor-grab active:cursor-grabbing z-[40] border border-white/20"
                        style={{ left: `${l}%`, right: `${r}%` }}
                        onMouseDown={e => {
                          if (e.button !== 0) return
                          e.stopPropagation()
                          startBleepMove(e, region.id, (waveformStripRef.current ?? stripsWrapperRef.current)!.getBoundingClientRect())
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
                            <div className="absolute left-0 top-0 bottom-0 w-1 cursor-ew-resize hover:bg-white/30 transition-colors" onMouseDown={e => { e.stopPropagation(); if (e.button === 0) startBleepResize(e, region.id, 'start', (waveformStripRef.current ?? stripsWrapperRef.current)!.getBoundingClientRect()) }} />
                            <div className="absolute right-0 top-0 bottom-0 w-1 cursor-ew-resize hover:bg-white/30 transition-colors" onMouseDown={e => { e.stopPropagation(); if (e.button === 0) startBleepResize(e, region.id, 'end', (waveformStripRef.current ?? stripsWrapperRef.current)!.getBoundingClientRect()) }} />
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
              {/* Hover marker + timecode tooltip — lifted out of the
                  thumbnail strip so the line spans every track (thumbnails,
                  single waveform, or all multi-track rows) and the tooltip
                  sits in the gap below the wrapper instead of overlapping
                  the scaled-up thumbnail. z-[45] beats the clip-region
                  shading (z-[40]); the tooltip's z-[70] beats the
                  selected region's timecode (z-50) and the duration
                  labels (z-40/60 selected) so it covers them per spec. */}
              {hoverRatio !== null && duration > 0 && (
                <>
                  <div
                    className="absolute top-0 bottom-0 w-px bg-white/40 pointer-events-none z-[45]"
                    style={{ left: `${hoverRatio * 100}%`, transform: 'translateX(-50%)' }}
                  />
                  <div
                    className="absolute pointer-events-none z-[70] tabular-nums"
                    style={{
                      top: '100%',
                      left: `${Math.min(Math.max(hoverRatio * 100, 2), 98)}%`,
                      transform: 'translateX(-50%)',
                    }}
                  >
                    <div className="text-[10px] text-white bg-black px-1 py-0.5 rounded shadow-lg">
                      {formatTime(vStart + hoverRatio * vSpan, videoInfo?.fps)}
                    </div>
                  </div>
                </>
              )}
              </div>{/* end stripsWrapperRef */}

              {/* Multi-track entry/exit affordances. Rendered OUTSIDE the
                  strips wrapper on purpose so the clip-region shading and
                  the playhead indicator (both absolute-positioned within
                  the wrapper) can't extend over the button and block its
                  click area. */}
              {!multiTrackEnabled && multiTrack && (
                <div className={`flex justify-center ${isClipMode ? 'pt-5' : ''}`}>
                  <button
                    onClick={enableMultiTrack}
                    className="flex items-center gap-1.5 px-3 py-1 rounded text-[11px] bg-purple-600/15 border border-purple-500/30 text-purple-200 hover:bg-purple-600/25 transition-colors"
                  >
                    <Layers size={11} />
                    Enable Multi-track Audio · {videoInfo?.audioTracks.length} tracks
                  </button>
                </div>
              )}
              {multiTrackEnabled && (
                <div className={`flex justify-start ${isClipMode ? 'pt-5' : ''}`}>
                  <button
                    onClick={disableMultiTrack}
                    className="flex items-center gap-1 text-[10px] text-gray-500 hover:text-gray-300 transition-colors"
                  >
                    <X size={10} />
                    Disable Multi-track audio
                  </button>
                </div>
              )}

              {/* Viewport scrollbar — below waveform, above playback controls */}
              {duration > 0 && (
                <div
                  ref={scrollbarRef}
                  className="relative h-3 w-full select-none mt-1"
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
                  {/* Thumb — purple to distinguish from clip markers.
                      Rectangular (not rounded) because the boundary
                      markers now flank the thumb and provide the pill
                      caps. The thumb's left/right edges sit exactly at
                      the zoom region's vStart/vEnd — i.e. the flat
                      inner sides of the markers indicate the true
                      timeline boundaries, with the rounded outer half
                      of each marker hanging off into the panel's
                      px-3 padding area (which gives ~2px of slack
                      before line 3161's overflow-hidden would clip). */}
                  <div
                    className="absolute inset-y-0 bg-purple-500/30 hover:bg-purple-500/40 cursor-grab active:cursor-grabbing flex items-center"
                    style={{
                      left: `${(vStart / duration) * 100}%`,
                      width: `${(vSpan / duration) * 100}%`,
                      minWidth: 4,
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
                    {/* Left resize handle — flat side flush against the
                        thumb's left edge at vStart; rounded side
                        protrudes 10px to the left into the scrollbar's
                        margin. */}
                    <div
                      className="absolute right-full top-0 bottom-0 w-2.5 rounded-l-full cursor-ew-resize bg-purple-400/60 hover:bg-purple-400/90 transition-colors z-10"
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
                    {/* Right resize handle — flat side flush against
                        the thumb's right edge at vEnd; rounded side
                        protrudes 10px to the right. */}
                    <div
                      className="absolute left-full top-0 bottom-0 w-2.5 rounded-r-full cursor-ew-resize bg-purple-400/60 hover:bg-purple-400/90 transition-colors z-10"
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
                  {/* Playhead position needle — draggable scrubber for
                      the full timeline. Hit area is 12px wide (matches
                      the resize handles' feel) so it's easy to grab,
                      and stretches 2px above/below the scrollbar so
                      the line is visible even when crossing a region
                      boundary marker. z-30 puts it above the resize
                      handles (z-10) so grabbing the playhead always
                      takes precedence over starting a resize. Rendered
                      AFTER the thumb so it paints on top regardless of
                      z-index quirks; visible line is centered inside
                      the wider hit area and inherits pointer-events
                      from the wrapper via group hover. */}
                  {(() => {
                    // Pixel-snap the playhead's X to a whole pixel — see comment on
                    // the timeline playhead for why. Hit area's translateX(-50%) is
                    // fine because it's 12px wide (-6px is a whole pixel).
                    // floor (not round) + cap to scrollbarWidth-1 for the same reasons
                    // as the timeline playhead above.
                    const px = Math.min(scrollbarWidth - 1, Math.max(0, Math.floor(((handleDragDisplayTime ?? currentTime) / duration) * scrollbarWidth)))
                    return (
                      <div
                        className="absolute -top-0.5 -bottom-0.5 w-3 -translate-x-1/2 cursor-ew-resize z-30 group"
                        style={{ left: `${px}px` }}
                        onMouseDown={e => {
                          if (e.button !== 0) return
                          e.preventDefault()
                          e.stopPropagation()
                          ;(document.activeElement as HTMLElement)?.blur()
                          const rect = scrollbarRef.current!.getBoundingClientRect()
                          const getTime = (clientX: number) => {
                            const dur = durationRef.current
                            return Math.max(0, Math.min(dur, ((clientX - rect.left) / rect.width) * dur))
                          }
                          fastSeekRef.current(getTime(e.clientX))
                          const onMove = (me: MouseEvent) => fastSeekRef.current(getTime(me.clientX))
                          const onUp = () => {
                            window.removeEventListener('mousemove', onMove)
                            window.removeEventListener('mouseup', onUp)
                          }
                          window.addEventListener('mousemove', onMove)
                          window.addEventListener('mouseup', onUp)
                        }}
                      >
                        {/* Visible 1px line — left edge at +6px from the wrapper's left
                            (the wrapper is 12px wide and translated -6px, so +6 puts
                            the line exactly at the snapped pixel position). */}
                        <div className="playhead-line absolute top-0 bottom-0 w-px pointer-events-none" style={{ left: '6px' }} />
                      </div>
                    )
                  })()}
                </div>
              )}

              {/* Spacer — reserves room for handle/duration popups below the strips; divider separates timeline from controls */}
              {/* <div className={`shrink-0 ${duration > 0 ? 'h-[8px]' : 'h-px bg-white/15 mt-1'}`} /> */}

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
                      className="text-xs text-gray-400 tabular-nums w-20 shrink-0 cursor-text hover:text-gray-200 transition-colors"
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
                <div className="flex-1 flex items-center justify-center gap-0.5">
                {/* Skip label/tooltip helpers — keeps the buttons themselves tight.
                    Magnitudes < 60s display as integer seconds (e.g. "-10", "+5");
                    60s and 300s display as minutes ("-1m", "+5m"). */}
                {(() => {
                  const skipLabel = (s: number) => {
                    const abs = Math.abs(s)
                    // n-dash (U+2013) for negatives so width matches '+' visually
                    const sign = s < 0 ? '–' : '+'
                    return abs >= 60 ? `${sign}${abs / 60}m` : `${sign}${abs}`
                  }
                  const skipTip = (s: number) => {
                    const abs = Math.abs(s)
                    const unit = abs >= 60 ? `${abs / 60}m` : `${abs}s`
                    return `${unit} ${s < 0 ? 'back' : 'forward'}`
                  }
                  // Prev/next clip-region marker — disabled state is computed
                  // by peeking at clipState.clipRegions vs. currentTime. eps
                  // matches jumpToMarker so the buttons enable/disable in lockstep.
                  const eps = 0.001
                  const hasPrevMarker = isClipMode && clipState.clipRegions.some(r =>
                    r.inPoint < currentTime - eps || r.outPoint < currentTime - eps,
                  )
                  const hasNextMarker = isClipMode && clipState.clipRegions.some(r =>
                    r.inPoint > currentTime + eps || r.outPoint > currentTime + eps,
                  )
                  return (
                    <>
                      {/* Skip to start */}
                      <Tooltip content="Skip to start">
                        <button onClick={() => seekRef.current(0)} className="px-1 py-1.5 rounded text-gray-400 hover:text-gray-100 hover:bg-white/10 transition-colors">
                          <ChevronsLeft size={15} />
                        </button>
                      </Tooltip>

                      {/* Prev clip-region marker — clip mode only.
                          Disabled (and dimmed) when there's no marker before
                          the playhead, matching the [ keyboard shortcut. */}
                      {isClipMode && (
                        <Tooltip content="Previous clip marker">
                          <button
                            onClick={() => jumpToMarker('prev')}
                            disabled={!hasPrevMarker}
                            className="px-1 py-1.5 rounded text-gray-400 hover:text-gray-100 hover:bg-white/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-gray-400"
                          >
                            <SkipBack size={14} />
                          </button>
                        </Tooltip>
                      )}

                      {/* Skip back: -5m, -1m, -10s, -5s, -1s */}
                      {[-300, -60, -10, -5, -1].map(s => (
                        <Tooltip key={s} content={skipTip(s)}>
                          <button onClick={() => skip(s)} className="px-1 py-1 rounded text-xs text-gray-400 hover:text-gray-100 hover:bg-white/10 transition-colors tabular-nums">
                            {skipLabel(s)}
                          </button>
                        </Tooltip>
                      ))}

                      {/* Prev frame */}
                      <Tooltip content="Previous frame">
                        <button onClick={() => stepFrame(-1)} className="px-1 py-1.5 rounded text-gray-400 hover:text-gray-100 hover:bg-white/10 transition-colors">
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
                        <button onClick={() => stepFrame(1)} className="px-1 py-1.5 rounded text-gray-400 hover:text-gray-100 hover:bg-white/10 transition-colors">
                          <ChevronRight size={16} />
                        </button>
                      </Tooltip>

                      {/* Skip forward: +1s, +5s, +10s, +1m, +5m */}
                      {[1, 5, 10, 60, 300].map(s => (
                        <Tooltip key={s} content={skipTip(s)}>
                          <button onClick={() => skip(s)} className="px-1 py-1 rounded text-xs text-gray-400 hover:text-gray-100 hover:bg-white/10 transition-colors tabular-nums">
                            {skipLabel(s)}
                          </button>
                        </Tooltip>
                      ))}

                      {/* Next clip-region marker — clip mode only */}
                      {isClipMode && (
                        <Tooltip content="Next clip marker">
                          <button
                            onClick={() => jumpToMarker('next')}
                            disabled={!hasNextMarker}
                            className="px-1 py-1.5 rounded text-gray-400 hover:text-gray-100 hover:bg-white/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-gray-400"
                          >
                            <SkipForward size={14} />
                          </button>
                        </Tooltip>
                      )}

                      {/* Skip to end */}
                      <Tooltip content="Skip to end">
                        <button onClick={() => seekRef.current(duration)} className="px-1 py-1.5 rounded text-gray-400 hover:text-gray-100 hover:bg-white/10 transition-colors">
                          <ChevronsRight size={15} />
                        </button>
                      </Tooltip>
                    </>
                  )
                })()}
                </div>
                <span className="text-xs text-gray-400 tabular-nums w-20 shrink-0 text-right">{formatTime(duration, videoInfo?.fps)}</span>
              </div>

              {/* Note: the contextual action buttons (Start Clipping,
                  Open Video File, Close Session, Video Info) that used
                  to live here have moved into the sidebar — see the
                  "Player Actions" block. This frees up vertical space
                  for the video itself. */}
            </div>
          </div>

          {/* Player sidebar — host for the contextual action buttons, the
              Selected Stream section, and Session Videos. Collapsed mode
              shrinks to an icon strip; expanded shows icons + labels. */}
          <div className={`relative bg-navy-800 flex flex-col shrink-0 transition-all duration-200 ${panelCollapsed ? 'w-12 overflow-hidden' : 'w-64 overflow-hidden'}`}>
            {/* Left edge — collapse/expand handle */}
            <Tooltip content={panelCollapsed ? 'Expand panel' : 'Collapse panel'} side="left" triggerClassName="group/edge absolute left-0 inset-y-0 w-2 z-20">
              <button
                onClick={() => setPanelCollapsed(v => !v)}
                className="absolute inset-0 cursor-col-resize"
                aria-label={panelCollapsed ? 'Expand panel' : 'Collapse panel'}
              />
              <div className="pointer-events-none absolute inset-y-0 left-0 w-px bg-white/5 group-hover/edge:w-0.5 group-hover/edge:bg-purple-500 transition-all duration-150" />
            </Tooltip>
            <div className="flex flex-col flex-1 min-h-0 overflow-hidden">

              {/* Session-level actions — Close + Open. Pinned at the very
                  top of the sidebar so opening/closing a video is always
                  one click away regardless of what else is in the sidebar.
                  Was previously bundled into the Player Actions stack
                  below the Selected Stream section. Tooltips always
                  show so users can learn the keyboard shortcuts. */}
              {videoUrl && (() => {
                const topBtnBase = panelCollapsed
                  ? 'flex items-center justify-center h-8 w-8 rounded transition-colors shrink-0'
                  : 'flex items-center gap-2 px-2 py-1.5 rounded text-xs transition-colors w-full text-left'
                const topStackCls = panelCollapsed
                  ? 'flex flex-col items-center gap-1 py-2 shrink-0'
                  : 'flex flex-col gap-1 p-2 shrink-0'
                return (
                  <div className={`${topStackCls} border-b border-white/5`}>
                    {videoInfo && (
                      <Tooltip content="Close session (Esc)" side="left">
                        <button
                          onClick={() => closeVideo()}
                          className={`${topBtnBase} text-red-400 border border-red-600/40 bg-red-900/30 hover:bg-red-900/50`}
                        >
                          <X size={14} className="shrink-0" />
                          {!panelCollapsed && <span className="truncate">Close Session</span>}
                        </button>
                      </Tooltip>
                    )}
                    <Tooltip content="Open a video file (Ctrl+O)" side="left">
                      <button
                        onClick={handleBrowse}
                        className={`${topBtnBase} text-gray-300 hover:bg-white/10 ${panelCollapsed ? '' : 'border border-white/10'}`}
                      >
                        <FolderOpen size={14} className="shrink-0" />
                        {!panelCollapsed && <span className="truncate">Open Video File</span>}
                      </button>
                    </Tooltip>
                  </div>
                )
              })()}

              {/* Selected Stream — context about the stream item the active
                  video belongs to (thumbnail, date, title) plus prev/next
                  navigation through sibling stream items. Hidden when the
                  user has loaded a video that isn't part of any stream
                  (e.g. dropped a one-off file from outside the streams
                  root). */}
              {currentStreamFolder && (() => {
                const meta = currentStreamFolder.meta
                const title = meta?.ytTitle?.trim()
                  || meta?.twitchTitle?.trim()
                  || (meta?.games && meta.games.length > 0 ? meta.games.join(' · ') : '')
                  || currentStreamFolder.folderName
                // Resolve the thumbnail (preferredThumbnail filename if set,
                // else first slot). Cloud placeholders render as a Cloud
                // icon — no file:// fetch — to keep us from hanging on a
                // broken sync state.
                const thumbs = currentStreamFolder.thumbnails
                const localFlags = currentStreamFolder.thumbnailLocalFlags ?? []
                let thumbIdx = 0
                if (meta?.preferredThumbnail) {
                  const found = thumbs.findIndex(t => (t.split(/[\\/]/).pop() ?? '') === meta.preferredThumbnail)
                  if (found >= 0) thumbIdx = found
                }
                const thumbPath = thumbs[thumbIdx]
                const thumbLocal = localFlags[thumbIdx] ?? true
                const thumbNode = thumbPath && thumbLocal
                  ? <img src={'file:///' + thumbPath.replace(/\\/g, '/')} className="w-full h-full object-cover" draggable={false} />
                  : thumbPath
                    ? <div className="w-full h-full flex items-center justify-center bg-navy-700"><Cloud size={panelCollapsed ? 12 : 16} className="text-gray-600" /></div>
                    : <div className="w-full h-full flex items-center justify-center bg-navy-700"><Film size={panelCollapsed ? 12 : 16} className="text-gray-600" /></div>
                // Chevron convention: ▲ = next (chronologically newer),
                // ▼ = previous (older). Expanded lays them out side-by-side
                // with ▼ on the left and ▲ on the right; collapsed stacks
                // them vertically with ▲ on top and ▼ on the bottom so the
                // arrow direction matches its spatial position too.
                // Shared stream-jump dropdown portal — same JSX for both
                // collapsed and expanded modes; positioning differs since
                // the anchor differs (right-edge icon vs. inline header
                // button group). Mounted via document.body so the
                // sidebar's overflow-hidden can't clip it.
                const streamPickerDropdown = streamPickerOpen && streamPickerAnchorRef.current && ReactDOM.createPortal(
                  (() => {
                    const r = streamPickerAnchorRef.current.getBoundingClientRect()
                    const positionStyle: React.CSSProperties = panelCollapsed
                      ? {
                          position: 'fixed',
                          top: Math.max(8, r.top),
                          right: Math.max(8, window.innerWidth - r.left + 8),
                          zIndex: 61,
                          maxHeight: streamPickerMaxHeight,
                        }
                      : {
                          position: 'fixed',
                          top: r.bottom + 4,
                          right: Math.max(8, window.innerWidth - r.right),
                          zIndex: 61,
                          maxHeight: streamPickerMaxHeight,
                        }
                    return (
                      <>
                        <div className="fixed inset-0 z-[60]" onClick={() => setStreamPickerOpen(false)} />
                        <div
                          style={positionStyle}
                          className="bg-navy-700 border border-white/10 rounded-lg shadow-xl min-w-[220px] max-w-[280px] overflow-y-auto"
                        >
                          {sortedStreamFolders.length === 0 ? (
                            <p className="px-3 py-2 text-xs text-gray-600">No streams</p>
                          ) : sortedStreamFolders.slice().reverse().map(folder => {
                            const fMeta = folder.meta
                            const fTitle = fMeta?.ytTitle?.trim()
                              || fMeta?.twitchTitle?.trim()
                              || (fMeta?.games && fMeta.games.length > 0 ? fMeta.games.join(' · ') : '')
                              || folder.folderName
                            const isCurrent = !!currentStreamFolder
                              && folder.folderPath === currentStreamFolder.folderPath
                              && folder.relativePath === currentStreamFolder.relativePath
                            const empty = folder.videos.length === 0
                            return (
                              <button
                                key={folder.relativePath || folder.folderPath}
                                onClick={() => {
                                  if (empty || isCurrent) return
                                  navigateToStream(folder)
                                  setStreamPickerOpen(false)
                                }}
                                disabled={empty || isCurrent}
                                className={`flex flex-col items-start w-full px-3 py-1.5 text-left transition-colors ${
                                  isCurrent
                                    ? 'bg-purple-600/20 text-purple-200 cursor-default'
                                    : empty
                                      ? 'text-gray-600 cursor-default'
                                      : 'text-gray-300 hover:bg-white/5'
                                }`}
                                title={fTitle}
                              >
                                <span className="text-[11px] tabular-nums leading-tight">
                                  {folder.date}
                                  {empty && <span className="ml-1 text-gray-700 italic">(no videos)</span>}
                                  {isCurrent && <span className="ml-1 text-purple-400 italic">(current)</span>}
                                </span>
                                <span className="text-xs truncate w-full leading-tight">{fTitle}</span>
                              </button>
                            )
                          })}
                        </div>
                      </>
                    )
                  })(),
                  document.body,
                )
                if (panelCollapsed) {
                  return (
                    <>
                      <div className="flex flex-col items-center gap-1 py-2 border-b border-white/5">
                        <Tooltip content="Jump to stream…" side="right">
                          <button
                            ref={streamPickerAnchorRef as React.RefObject<HTMLButtonElement>}
                            onClick={openStreamPicker}
                            className={`flex items-center justify-center h-6 w-8 rounded transition-colors ${streamPickerOpen ? 'bg-white/10 text-gray-200' : 'text-gray-400 hover:bg-white/10 hover:text-gray-200'}`}
                            aria-label="Jump to stream"
                          >
                            <List size={12} />
                          </button>
                        </Tooltip>
                        <Tooltip content={nextStreamFolder ? `Next: ${nextStreamFolder.date}` : 'No next stream'} side="right">
                          <button
                            onClick={() => navigateToStream(nextStreamFolder)}
                            disabled={!nextStreamFolder}
                            className="flex items-center justify-center h-6 w-8 rounded text-gray-400 hover:bg-white/10 hover:text-gray-200 transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                          >
                            <ChevronUp size={12} />
                          </button>
                        </Tooltip>
                        <Tooltip content={`${currentStreamFolder.date} — ${title}`} side="right">
                          <div className="w-9 h-5 rounded overflow-hidden bg-navy-900 border border-white/10 shrink-0">
                            {thumbNode}
                          </div>
                        </Tooltip>
                        <Tooltip content={prevStreamFolder ? `Previous: ${prevStreamFolder.date}` : 'No previous stream'} side="right">
                          <button
                            onClick={() => navigateToStream(prevStreamFolder)}
                            disabled={!prevStreamFolder}
                            className="flex items-center justify-center h-6 w-8 rounded text-gray-400 hover:bg-white/10 hover:text-gray-200 transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                          >
                            <ChevronDown size={12} />
                          </button>
                        </Tooltip>
                      </div>
                      {streamPickerDropdown}
                    </>
                  )
                }
                return (
                  <div className="flex flex-col gap-1.5 p-2 border-b border-white/5">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Selected Stream</h3>
                      <div ref={streamPickerAnchorRef as React.RefObject<HTMLDivElement>} className="relative flex items-center gap-0.5">
                        <Tooltip content="Jump to stream…" side="bottom">
                          <button
                            onClick={openStreamPicker}
                            className={`flex items-center justify-center h-5 w-5 rounded transition-colors ${streamPickerOpen ? 'bg-white/10 text-gray-200' : 'text-gray-400 hover:bg-white/10 hover:text-gray-200'}`}
                          >
                            <List size={12} />
                          </button>
                        </Tooltip>
                        <Tooltip content={prevStreamFolder ? `Previous: ${prevStreamFolder.date}` : 'No previous stream'} side="bottom">
                          <button
                            onClick={() => navigateToStream(prevStreamFolder)}
                            disabled={!prevStreamFolder}
                            className="flex items-center justify-center h-5 w-5 rounded text-gray-400 hover:bg-white/10 hover:text-gray-200 transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                          >
                            <ChevronDown size={12} />
                          </button>
                        </Tooltip>
                        <Tooltip content={nextStreamFolder ? `Next: ${nextStreamFolder.date}` : 'No next stream'} side="bottom">
                          <button
                            onClick={() => navigateToStream(nextStreamFolder)}
                            disabled={!nextStreamFolder}
                            className="flex items-center justify-center h-5 w-5 rounded text-gray-400 hover:bg-white/10 hover:text-gray-200 transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                          >
                            <ChevronUp size={12} />
                          </button>
                        </Tooltip>
                        {streamPickerDropdown}
                      </div>
                    </div>
                    <div className="flex items-start gap-2">
                      <div className="w-16 h-9 rounded overflow-hidden bg-navy-900 border border-white/10 shrink-0">
                        {thumbNode}
                      </div>
                      <div className="flex flex-col min-w-0 flex-1 leading-tight">
                        <span className="text-[11px] text-gray-400 tabular-nums">{currentStreamFolder.date}</span>
                        <Tooltip content={title} side="bottom" triggerClassName="block min-w-0">
                          <span className="text-xs text-gray-200 truncate block">{title}</span>
                        </Tooltip>
                        {meta?.games && meta.games.length > 0 && meta.ytTitle && (
                          <span className="text-[10px] text-gray-500 truncate" title={meta.games.join(' · ')}>
                            {meta.games.join(' · ')}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })()}

              {/* Player Actions. Same buttons that used to live in the bottom
                  controls row of the main player area, lifted here so the
                  video gets more vertical real estate. Each renders as
                  icon-only in collapsed mode (with the label as tooltip)
                  and icon + label in expanded mode. */}
              {videoUrl && (() => {
                const isClipFile = !!currentVideoClip
                const sourceMissing = isClipFile && !currentVideoClip!.sourceExists
                const currentName = state.filePath?.replace(/.*[\\/]/, '') ?? ''
                const hasExistingClips = !isClipFile && (
                  folderDrafts.some(d => d.sourceName === currentName) ||
                  siblingFiles.some(f => f.clipOf === currentName)
                )
                const clipLabel = isClipFile
                  ? 'New clip from current'
                  : hasExistingClips ? 'Start New Clip' : 'Start Clipping'
                const clipTooltip = sourceMissing
                  ? `Source video "${currentVideoClip!.clipOf}" is missing from this folder`
                  : `${clipLabel} (C)`
                const onClipClick = () => {
                  if (isClipFile) {
                    reopenClipOutput(currentVideoClip!.clipOf, currentVideoClip!.clipState)
                    return
                  }
                  if (multiTrack && !multiTrackEnabled && !isExtracting && !config.skipClipMergeWarning) {
                    setClipModeModal('warn')
                    return
                  }
                  setIsClipMode(true)
                }
                // Shared button class strings. Collapsed = centered icon-
                // only h-8; expanded = full-width row with icon + label.
                const btnBase = panelCollapsed
                  ? 'flex items-center justify-center h-8 w-8 rounded transition-colors shrink-0'
                  : 'flex items-center gap-2 px-2 py-1.5 rounded text-xs transition-colors w-full text-left'
                // Outer container class for both top and bottom button
                // stacks. Identical so the two halves visually pair up.
                // No horizontal padding in collapsed mode so the centered
                // icons sit symmetrically inside the sidebar width.
                const stackCls = panelCollapsed
                  ? 'flex flex-col items-center gap-1 py-2 shrink-0'
                  : 'flex flex-col gap-1 p-2 shrink-0'
                return (
                  <>
                    {/* Session Videos — always visible. Expanded: full
                        inline section taking flex-1. Collapsed: single
                        Film-icon trigger that pops a full panel out to
                        the LEFT of the sidebar on hover (portal below).
                        Same renderSessionVideos helper feeds both
                        surfaces so they stay in sync. */}
                    {(() => {
                      const renderSessionVideos = () => (
                        <>
                          <div className="sticky top-0 z-10 bg-navy-800 px-4 py-2.5 border-b border-white/5 flex items-center gap-2">
                            <Film size={12} className="text-gray-600 shrink-0" />
                            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Session Videos</h3>
                          </div>
                          {isExtracting ? (
                            <div className="px-3 py-4 text-xs text-gray-600 text-center leading-relaxed">Available once merge is complete or cancelled</div>
                          ) : siblingFiles.length === 0 && folderDrafts.length === 0 ? (
                            <div className="px-3 py-4 text-xs text-gray-600 text-center leading-relaxed">
                              {state.filePath ? 'No other videos in this folder' : 'Open a video to see siblings here'}
                            </div>
                          ) : (() => {
                            const draftsBySource = folderDrafts.reduce<Record<string, import('../../types').ClipDraft[]>>((acc, d) => {
                              (acc[d.sourceName] ||= []).push(d)
                              return acc
                            }, {})
                            const seenNames = new Set(siblingFiles.map(v => v.name))
                            const clipChildren: Record<string, SiblingFile[]> = {}
                            const topLevelSiblings: SiblingFile[] = []
                            for (const s of siblingFiles) {
                              if (s.clipOf && seenNames.has(s.clipOf)) {
                                (clipChildren[s.clipOf] ||= []).push(s)
                              } else {
                                topLevelSiblings.push(s)
                              }
                            }
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
                        </>
                      )

                      if (panelCollapsed) {
                        return (
                          <>
                            <div className="flex flex-col items-center py-2 shrink-0">
                              <button
                                ref={sessionVideosTriggerRef}
                                onMouseEnter={openSessionVideosPopup}
                                onMouseLeave={scheduleCloseSessionVideosPopup}
                                className={`flex items-center justify-center h-8 w-8 rounded transition-colors ${sessionVideosPopupOpen ? 'bg-white/10 text-gray-200' : 'text-gray-400 hover:bg-white/10 hover:text-gray-200'}`}
                                aria-label="Session Videos"
                              >
                                <Film size={14} />
                              </button>
                            </div>
                            {/* Spacer keeps the bottom stack pinned to the
                                bottom of the sidebar in collapsed mode now
                                that the SV section is no longer flex-1. */}
                            <div className="flex-1 min-h-0" />
                            {sessionVideosPopupOpen && sessionVideosTriggerRef.current && ReactDOM.createPortal(
                              (() => {
                                const r = sessionVideosTriggerRef.current.getBoundingClientRect()
                                // Pop out to the LEFT of the sidebar with a
                                // small gap. Width matches the expanded
                                // sidebar so the panel feels familiar.
                                const top = Math.max(8, r.top)
                                return (
                                  <div
                                    onMouseEnter={openSessionVideosPopup}
                                    onMouseLeave={scheduleCloseSessionVideosPopup}
                                    style={{
                                      position: 'fixed',
                                      top,
                                      right: Math.max(8, window.innerWidth - r.left + 8),
                                      maxHeight: Math.max(120, window.innerHeight - top - 12),
                                      width: 256,
                                      zIndex: 50,
                                    }}
                                    className="bg-navy-700 border border-white/10 rounded-lg shadow-2xl overflow-y-auto"
                                  >
                                    {renderSessionVideos()}
                                  </div>
                                )
                              })(),
                              document.body,
                            )}
                          </>
                        )
                      }

                      return (
                        <div className="flex-1 min-h-0 overflow-y-auto pr-2">
                          {renderSessionVideos()}
                        </div>
                      )
                    })()}

                    {/* Bottom stack: current-video context (info + start
                        clipping). The visual separator above this group
                        is a border-t matching the same `border-white/5`
                        style as the other section dividers in the
                        sidebar — no inner divider needed. */}
                    <div className={`${stackCls} border-t border-white/5`}>
                      {videoInfo && (
                        <Tooltip
                          content={
                            panelCollapsed
                              ? `${videoInfo.width}×${videoInfo.height}${videoInfo.fps ? ` · ${videoInfo.fps.toFixed(2)} fps` : ''} · ${videoInfo.videoCodec}${state.filePath ? `\n${state.filePath.split(/[\\/]/).pop()}` : ''}`
                              : (state.filePath ? `Show in Explorer: ${state.filePath}` : '')
                          }
                          side="right"
                        >
                          <button
                            onClick={() => state.filePath && window.api.openInExplorer(state.filePath)}
                            className={`${btnBase} text-gray-400 hover:text-gray-200 hover:bg-white/5 min-w-0`}
                          >
                            <Info size={14} className="shrink-0" />
                            {!panelCollapsed && (
                              <div className="flex flex-col items-start min-w-0 flex-1 leading-tight">
                                <span className="truncate w-full text-[11px]">
                                  {videoInfo.width}×{videoInfo.height}{videoInfo.fps && ` · ${videoInfo.fps.toFixed(2)}fps`}
                                </span>
                                <span className="truncate w-full text-[10px] text-gray-500">
                                  {videoInfo.videoCodec}{state.filePath && ` · ${state.filePath.split(/[\\/]/).pop()}`}
                                </span>
                              </div>
                            )}
                          </button>
                        </Tooltip>
                      )}
                      {!isClipMode && (
                        <Tooltip content={clipTooltip} side="left">
                          <button
                            disabled={sourceMissing}
                            onClick={onClipClick}
                            className={`${btnBase} bg-blue-950/40 border border-blue-500/30 text-blue-400 hover:bg-blue-950/60 disabled:opacity-40 disabled:cursor-not-allowed`}
                          >
                            <Scissors size={14} className="shrink-0" />
                            {!panelCollapsed && <span className="truncate">{clipLabel}</span>}
                          </button>
                        </Tooltip>
                      )}
                    </div>
                  </>
                )
              })()}

            </div>
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

      {/* ── Per-track color picker. Rendered at PlayerPage level so it can
          portal over the whole UI without being trapped inside the
          relative-positioned multi-track stack. */}
      {colorPicker && (
        <TrackColorPicker
          rect={colorPicker.rect}
          currentKey={tracks.find(t => t.index === colorPicker.trackIndex)?.color}
          onPick={key => { setTrackColor(colorPicker.trackIndex, key); setColorPicker(null) }}
          onClose={() => setColorPicker(null)}
        />
      )}

      {/* ── Multi-track warning before entering clip mode ─────────────────────
          New simplified flow: the user either continues with single-track
          audio (only Track 1 audible) or enables multi-track for this
          session. Track extraction itself is now lazy / per-track from the
          timeline, so this modal no longer needs a selection step. */}
      <Modal
        isOpen={clipModeModal === 'warn'}
        onClose={() => setClipModeModal(null)}
        title="Multiple audio tracks detected"
        width="sm"
        footer={
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                commitWarnDontShowAgain()
                setClipModeModal(null)
                setIsClipMode(true)
              }}
            >
              Continue with single track
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                commitWarnDontShowAgain()
                enableMultiTrack()
                setClipModeModal(null)
                setIsClipMode(true)
              }}
            >
              Enable Multi-track Audio
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <div className="flex items-start gap-2.5 text-sm text-gray-300 leading-relaxed">
            <Layers size={15} className="text-purple-400 mt-0.5 shrink-0" />
            <span>
              This video has <strong className="text-white">{videoInfo?.audioTracks.length} audio tracks</strong>.
              You'll only hear <strong className="text-white">Track 1</strong> unless you enable multi-track playback.
            </span>
          </div>
          <p className="text-xs text-gray-500 leading-relaxed pl-[23px]">
            Multi-track playback splits each track into its own timeline row with mute, solo, and volume controls. Individual tracks are decoded on demand when you click "Play this track". Exported clips always include every source audio track regardless.
          </p>
          <div className="pl-[23px] pt-1">
            <Checkbox
              checked={warnDontShowAgain}
              onChange={setWarnDontShowAgain}
              label="Don't show this again"
            />
          </div>
        </div>
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
            audioTracks={videoInfo?.audioTracks ?? []}
            tracksState={tracks.map(t => ({ index: t.index, status: t.status, muted: t.muted, volume: t.volume }))}
            multiTrackEnabled={multiTrackEnabled}
            onConfirm={runExport}
            onClose={() => setShowExportDialog(false)}
          />
        )
      })()}
    </div>
  )
}
