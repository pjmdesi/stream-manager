import React, { useRef, useCallback, useEffect, useState, useMemo } from 'react'
import { Play, Pause, FolderOpen, Info, Layers, CheckSquare, Square, RotateCcw, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Camera, X, Loader2, Scissors, Crop, AudioWaveform, VolumeX, Upload, ZoomIn, Tv2, Lock, Unlock, Repeat, PlusSquare, Trash2, GitMerge } from 'lucide-react'
import { v4 as uuidv4 } from 'uuid'
import { useConversionJobs } from '../../context/ConversionContext'
import { useStore } from '../../hooks/useStore'
import type { BleepRegion, ClipRegion, ClipState, CropMode, TimelineViewport } from '../../types'
import { useVideoPlayer } from '../../hooks/useVideoPlayer'
import { useThumbnailStrip } from '../../hooks/useThumbnailStrip'
import { useWaveform } from '../../hooks/useWaveform'
import { FileDropZone } from '../ui/FileDropZone'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'

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
function getCropGeometry(vcW: number, vcH: number, videoW: number, videoH: number, cropX: number) {
  const videoAspect = videoW / videoH
  const containerAspect = vcW / vcH
  let contentW: number, contentH: number, contentLeft: number, contentTop: number
  if (videoAspect > containerAspect) {
    contentW = vcW; contentH = vcW / videoAspect; contentLeft = 0; contentTop = (vcH - contentH) / 2
  } else {
    contentH = vcH; contentW = vcH * videoAspect; contentLeft = (vcW - contentW) / 2; contentTop = 0
  }
  const cropW = contentH * (9 / 16)
  const availableRange = Math.max(0, contentW - cropW)
  const cropLeft = contentLeft + cropX * availableRange
  return { contentLeft, contentTop, contentW, contentH, cropW, cropLeft, availableRange }
}

const TRACK_LABELS = ['Game', 'Mic', 'Discord', 'Music', 'SFX']

// ── Export Clip Dialog ────────────────────────────────────────────────────────

interface ExportClipDialogProps {
  defaultPresetId: string
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

function ExportClipDialog({ defaultPresetId, filePath, hasBleepsOutsideRegions, onConfirm, onClose }: ExportClipDialogProps) {
  const [presets, setPresets] = useState<{ id: string; name: string }[]>([])
  const [presetId, setPresetId] = useState(defaultPresetId)
  const [saveNextToSource, setSaveNextToSource] = useState(true)
  const [outputDir, setOutputDir] = useState('')
  const [suffix, setSuffix] = useState('_clip')

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

export function PlayerPage({ initialFile, onNavigateToConverter }: {
  initialFile?: PendingFile | null
  onNavigateToConverter?: () => void
}) {
  const { config } = useStore()
  const { videoRef, state, loadFile, extractTracks, cancelExtraction, resetExtraction, clearError, closeVideo, seek, fastSeek, togglePlay, audioElements } = useVideoPlayer()
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set())
  const [editingTimecode, setEditingTimecode] = useState(false)
  const [timecodeInput, setTimecodeInput] = useState('')
  const timecodeInputRef = useRef<HTMLInputElement>(null)

  // Clip mode
  const [isClipMode, setIsClipMode] = useState(false)
  const [clipState, setClipState] = useState<ClipState>({
    clipRegions: [],
    cropMode: 'none' as CropMode,
    cropX: 0.5,
    bleepRegions: [],
    bleepVolume: config.defaultBleepVolume ?? 0.25,
  })

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

  // Confirm exit clip mode
  const [showExitClipConfirm, setShowExitClipConfirm] = useState(false)
  // Confirm close video while clip work is in progress
  const [showCloseVideoConfirm, setShowCloseVideoConfirm] = useState(false)
  // Right panel collapsed state
  const [panelCollapsed, setPanelCollapsed] = useState(false)

  // Multi-track warning modal before entering clip mode
  const [clipModeModal, setClipModeModal] = useState<'warn' | 'merge' | null>(null)
  const pendingClipAfterMerge = useRef(false)

  const [clipFocus, setClipFocus] = useState(false)
  const clipFocusRef = useRef(false)
  // Per-region duration lock: dragging one handle moves the other to preserve duration
  const [lockedRegionIds, setLockedRegionIds] = useState<Set<string>>(new Set())
  const lockedRegionIdsRef = useRef<Set<string>>(new Set())
  useEffect(() => { lockedRegionIdsRef.current = lockedRegionIds }, [lockedRegionIds])
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null)
  const [hoveredRegionId, setHoveredRegionId] = useState<string | null>(null)
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
    setIsClipMode(false)
    setActiveBleepId(null)
    setClipState({ clipRegions: [], cropMode: 'none', cropX: 0.5, bleepRegions: [], bleepVolume: 0.25 })
    setViewport({ viewStart: 0, viewEnd: durationRef.current })
    setHandlePopup(null)
    setEditingDurationId(null)
    setClipFocus(false)
    setAddSegmentError(null)
  }, [])

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
  }, [])

  // Drag the 9:16 crop region horizontally
  const handleCropDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startCropX = clipStateRef.current.cropX
    const onMove = (me: MouseEvent) => {
      const { w: vcW, h: vcH } = vcSizeRef.current
      const vi = videoInfoRef.current
      if (!vi || vcW === 0) return
      const { availableRange } = getCropGeometry(vcW, vcH, vi.width, vi.height, 0)
      if (availableRange <= 0) return
      const newCropX = Math.max(0, Math.min(1, startCropX + (me.clientX - startX) / availableRange))
      setClipState(s => ({ ...s, cropX: newCropX }))
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

  const { thumbnails, generating } = useThumbnailStrip(
    state.filePath ?? null,
    videoUrl ?? null,
    duration,
    videoInfo?.width ?? 0,
    videoInfo?.height ?? 0,
    stripWidth,
    vStart,
    vEnd
  )

  const { setJobs } = useConversionJobs()

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

    await window.api.addClipToQueue({
      job,
      clipRegions:  clipState.clipRegions,
      cropMode:     clipState.cropMode,
      cropX:        clipState.cropX,
      videoWidth:   videoInfo.width,
      videoHeight:  videoInfo.height,
      bleepRegions: clipState.bleepRegions,
      bleepVolume:  clipState.bleepVolume,
    })

    onNavigateToConverter?.()
  }, [state.filePath, videoInfo, clipState, setJobs, onNavigateToConverter])

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

    // Open popup window, passing the offer SDP so the popup can answer immediately
    window.api.openVideoPopup(
      offerSdp,
      videoInfo.width, videoInfo.height,
      clipState.cropMode === '9:16' ? '9:16' : undefined,
      clipState.cropMode === '9:16' ? clipState.cropX : undefined,
    )
  }, [videoInfo, clipState.cropMode, clipState.cropX])

  // Push live crop changes to popup when mode or position changes while it's open.
  // isPopupOpen is intentionally excluded — crop is already sent during popup:open,
  // and including it here would trigger a resize that overrides the saved window size.
  useEffect(() => {
    if (!isPopupOpen || !videoInfo) return
    window.api.setCropPopup?.(videoInfo.width, videoInfo.height, clipState.cropMode, clipState.cropX)
  }, [clipState.cropMode, clipState.cropX, videoInfo]) // eslint-disable-line react-hooks/exhaustive-deps

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

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {!videoUrl ? (
        /* Empty state */
        <div className="flex-1 flex items-center justify-center p-8">
          <FileDropZone
            onFiles={handleFiles}
            accept={['mkv', 'mp4', 'mov', 'avi', 'ts', 'flv', 'webm']}
            label="Drop a video file here or click to browse"
            className="w-full max-w-lg"
          />
        </div>
      ) : (
        <div className="flex flex-1 overflow-hidden">
          {/* Video + controls column */}
          <div className="flex flex-col flex-1 overflow-hidden">
            {/* Video */}
            <FileDropZone onFiles={handleFiles} className="flex-1 relative bg-black min-h-0 group">
              {/* Container observed for crop overlay geometry */}
              <div ref={setVideoContainerEl} className="absolute inset-0">
                <video
                  ref={videoRef}
                  src={videoUrl ?? undefined}
                  className="w-full h-full object-contain cursor-pointer"
                  preload="auto"
                  onClick={effectiveTogglePlay}
                />
                {/* 9:16 crop overlay */}
                {isClipMode && clipState.cropMode === '9:16' && videoInfo && vcSize.w > 0 && (() => {
                  const { contentLeft, contentTop, contentH, cropW, cropLeft } = getCropGeometry(
                    vcSize.w, vcSize.h, videoInfo.width, videoInfo.height, clipState.cropX
                  )
                  const rightShadingLeft = cropLeft + cropW
                  const rightShadingWidth = contentLeft + (vcSize.w - contentLeft * 2) - rightShadingLeft
                  return (
                    <>
                      {/* Left darkened region */}
                      <div className="absolute bg-black/60 pointer-events-none"
                        style={{ left: contentLeft, top: contentTop, width: Math.max(0, cropLeft - contentLeft), height: contentH }} />
                      {/* Right darkened region */}
                      <div className="absolute bg-black/60 pointer-events-none"
                        style={{ left: rightShadingLeft, top: contentTop, width: Math.max(0, rightShadingWidth), height: contentH }} />
                      {/* Crop frame — draggable */}
                      <div
                        className="absolute border-2 border-white/80 cursor-ew-resize"
                        style={{ left: cropLeft, top: contentTop, width: cropW, height: contentH }}
                        onMouseDown={handleCropDrag}
                      />
                    </>
                  )
                })()}
              </div>

              {/* Screenshot flash */}
              {screenshotFlash && (
                <div className="absolute inset-0 bg-white/30 pointer-events-none" />
              )}

              {/* Screenshot + popup buttons — visible on hover */}
              <div className="absolute bottom-3 right-3 flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={captureScreenshot}
                  title="Save screenshot (PNG)"
                  className="p-2 rounded-lg bg-black/60 text-white/70 hover:text-white hover:bg-black/80"
                >
                  <Camera size={16} />
                </button>
                {videoUrl && (
                  <button
                    onClick={isPopupOpen ? () => window.api.closeVideoPopup() : openVideoPopup}
                    title={isPopupOpen ? 'Return video to player' : 'Pop out video (for OBS capture)'}
                    className={`p-2 rounded-lg bg-black/60 hover:bg-black/80 transition-colors ${isPopupOpen ? 'text-purple-400 hover:text-purple-300' : 'text-white/70 hover:text-white'}`}
                  >
                    <Tv2 size={16} />
                  </button>
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
                    <Scissors size={12} className="text-blue-400 shrink-0" />
                    <span className="text-[11px] font-semibold text-blue-400 tracking-wide shrink-0">Clip Mode</span>
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
                            <button
                              title="Split segment at playhead"
                              onClick={splitSegment}
                              disabled={!canSplit}
                              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] text-purple-400 border border-purple-500/30 hover:bg-purple-950/60 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              <Scissors size={11} /> Split Segment
                            </button>
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
                            title="Add a clip segment at the playhead"
                            onClick={addSegment}
                            disabled={noRoom}
                            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] text-blue-400 border border-blue-500/30 hover:bg-blue-950/60 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            <PlusSquare size={11} /> Add Segment
                          </button>
                          {(noRoom || addSegmentError) && (
                            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 text-[10px] text-yellow-200 bg-yellow-950 border border-yellow-600/40 rounded whitespace-nowrap pointer-events-none z-50 opacity-0 group-hover:opacity-100 transition-opacity">
                              {addSegmentError ?? 'No room at playhead'}
                            </div>
                          )}
                        </div>
                      )
                    })()}
                    <button
                      title={clipFocus ? 'Clip Focus on — playback skips gaps between segments' : 'Clip Focus — skip gaps between segments during playback'}
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

                    <div className="w-px h-3 bg-white/10 mx-1 shrink-0" />

                    <button
                      title="Toggle 9:16 crop"
                      onClick={() => setClipState(s => ({ ...s, cropMode: s.cropMode === '9:16' ? 'none' : '9:16', cropX: 0.5 }))}
                      className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] border transition-colors ${
                        clipState.cropMode === '9:16'
                          ? 'text-blue-300 border-blue-400/60 bg-blue-950/60'
                          : 'text-gray-400 border-white/20 hover:text-blue-300 hover:border-blue-400/40'
                      }`}
                    >
                      <Crop size={11} /> Crop
                    </button>
                    <button
                      title="Add a bleep at the current playhead position"
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
                      <AudioWaveform size={11} /> Add Bleep
                    </button>

                    <div className="flex-1" />

                    {/* Visible range timecodes */}
                    <div className="flex items-center gap-1 shrink-0">
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
                        <span
                          className="text-[11px] text-blue-400/70 tabular-nums cursor-text hover:text-blue-300 transition-colors"
                          title="Click to set view start"
                          onClick={() => { setVStartInput(formatViewTime(vStart, videoInfo?.fps)); setEditingVStart(true); setTimeout(() => vStartInputRef.current?.select(), 0) }}
                        >
                          {formatViewTime(vStart, videoInfo?.fps)}
                        </span>
                      )}
                      <span className="text-[11px] text-blue-400/30 select-none">—</span>
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
                        <span
                          className="text-[11px] text-blue-400/70 tabular-nums cursor-text hover:text-blue-300 transition-colors"
                          title="Click to set view end"
                          onClick={() => { setVEndInput(formatViewTime(vEnd, videoInfo?.fps)); setEditingVEnd(true); setTimeout(() => vEndInputRef.current?.select(), 0) }}
                        >
                          {formatViewTime(vEnd, videoInfo?.fps)}
                        </span>
                      )}
                    </div>

                    <div className="w-px h-3 bg-white/10 mx-1 shrink-0" />

                    {/* Zoom level + reset */}
                    {isZoomed && (
                      <>
                        <span className="text-[10px] text-blue-400/60 tabular-nums">{zoomLevel.toFixed(1)}×</span>
                        <button
                          onClick={() => setViewport({ viewStart: 0, viewEnd: duration })}
                          title="Reset zoom"
                          className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] text-blue-400/70 border border-blue-500/20 hover:bg-blue-950/60 transition-colors"
                        >
                          <ZoomIn size={10} /> 1×
                        </button>
                        <div className="w-px h-3 bg-white/10 mx-0.5 shrink-0" />
                      </>
                    )}

                    <div className="w-px h-3 bg-white/10 mx-0.5 shrink-0" />

                    <button
                      title={clipState.clipRegions.length > 0 ? 'Export clip' : 'Add at least one segment first'}
                      onClick={() => setShowExportDialog(true)}
                      disabled={clipState.clipRegions.length === 0}
                      className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] border transition-colors disabled:opacity-40 disabled:cursor-not-allowed text-purple-300 border-purple-600/30 bg-purple-600/20 hover:bg-purple-600/35 disabled:hover:bg-transparent"
                    >
                      <Upload size={11} /> Export Clip
                    </button>
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
                        if (!thumb) return null
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
                className="relative h-10 w-full cursor-pointer"
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
                      className={tracksExtracted ? 'fill-purple-500/50' : 'fill-gray-500/35'}
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
                        className="absolute top-8 bottom-0 bg-black overflow-hidden cursor-grab active:cursor-grabbing z-[4]"
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
                              title={lockedRegionIds.has(seg.id) ? 'Unlock duration' : 'Lock duration'}
                              className={`flex items-center justify-center transition-colors shrink-0 ${lockedRegionIds.has(seg.id) ? 'text-orange-400 hover:text-orange-300' : 'text-blue-400/50 hover:text-blue-300'}`}
                            >
                              {lockedRegionIds.has(seg.id) ? <Lock size={9} /> : <Unlock size={9} />}
                            </button>
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
                            <button
                              onMouseDown={e => e.preventDefault()}
                              onClick={e => {
                                e.stopPropagation()
                                setClipState(s => ({ ...s, clipRegions: s.clipRegions.filter(c => c.id !== seg.id) }))
                                if (editingDurationId === seg.id) setEditingDurationId(null)
                                setLockedRegionIds(prev => { const next = new Set(prev); next.delete(seg.id); return next })
                              }}
                              className="flex items-center justify-center text-red-500/60 hover:text-red-400 transition-colors ml-0.5"
                              title="Delete segment"
                            >
                              <Trash2 size={9} />
                            </button>
                          </div>
                        </div>
                        {/* Merge button — shown when this seg is exactly touching the next */}
                        {showMerge && nextSeg.inPoint >= vStart && nextSeg.inPoint <= vEnd && (
                          <div
                            className="absolute z-50 -translate-x-1/2 -translate-y-1/2"
                            style={{ left: `${Math.max(2, Math.min(98, ((seg.outPoint - vStart) / vSpan) * 100))}%`, top: '50%' }}
                          >
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
                              title="Merge adjacent segments"
                            >
                              <GitMerge size={9} /> Merge
                            </button>
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
                  <span
                    className="text-xs text-gray-500 tabular-nums w-24 shrink-0 cursor-text hover:text-gray-300 transition-colors"
                    title="Click to enter timecode"
                    onClick={() => {
                      if (!duration) return
                      setTimecodeInput(formatViewTime(currentTime, videoInfo?.fps))
                      setEditingTimecode(true)
                      setTimeout(() => timecodeInputRef.current?.select(), 0)
                    }}
                  >
                    {formatTime(currentTime, videoInfo?.fps)}
                  </span>
                )}
                <div className="flex-1 flex items-center justify-center gap-1">
                {/* Skip to start */}
                <button onClick={() => seekRef.current(0)} title="Skip to start" className="p-1.5 rounded text-gray-500 hover:text-gray-100 hover:bg-white/10 transition-colors">
                  <ChevronsLeft size={15} />
                </button>

                <div className="w-px h-4 bg-white/10 mx-0.5" />

                {/* Skip back */}
                {[-10, -5, -1].map(s => (
                  <button key={s} onClick={() => skip(s)} title={`${Math.abs(s)}s back`} className="px-1.5 py-1 rounded text-xs text-gray-500 hover:text-gray-100 hover:bg-white/10 transition-colors tabular-nums">
                    {s}
                  </button>
                ))}

                <div className="w-px h-4 bg-white/10 mx-0.5" />

                {/* Prev frame */}
                <button onClick={() => stepFrame(-1)} title="Previous frame" className="p-1.5 rounded text-gray-400 hover:text-gray-100 hover:bg-white/10 transition-colors">
                  <ChevronLeft size={16} />
                </button>

                {/* Play / Pause */}
                <button
                  onClick={effectiveTogglePlay}
                  title={isPlaying ? 'Pause' : 'Play'}
                  className="p-2 mx-1 rounded-full bg-purple-600 hover:bg-purple-500 text-white transition-colors"
                >
                  {isPlaying ? <Pause size={16} /> : <Play size={16} />}
                </button>

                {/* Next frame */}
                <button onClick={() => stepFrame(1)} title="Next frame" className="p-1.5 rounded text-gray-400 hover:text-gray-100 hover:bg-white/10 transition-colors">
                  <ChevronRight size={16} />
                </button>

                <div className="w-px h-4 bg-white/10 mx-0.5" />

                {/* Skip forward */}
                {[1, 5, 10].map(s => (
                  <button key={s} onClick={() => skip(s)} title={`${s}s forward`} className="px-1.5 py-1 rounded text-xs text-gray-500 hover:text-gray-100 hover:bg-white/10 transition-colors tabular-nums">
                    +{s}
                  </button>
                ))}

                <div className="w-px h-4 bg-white/10 mx-0.5" />

                {/* Skip to end */}
                <button onClick={() => seekRef.current(duration)} title="Skip to end" className="p-1.5 rounded text-gray-500 hover:text-gray-100 hover:bg-white/10 transition-colors">
                  <ChevronsRight size={15} />
                </button>

                </div>
                <span className="text-xs text-gray-500 tabular-nums w-24 shrink-0 text-right">{formatTime(duration, videoInfo?.fps)}</span>
              </div>

              {/* Secondary controls row */}
              <div className="flex items-center gap-3 min-w-0">
                <Button variant="ghost" size="sm" icon={<FolderOpen size={14} />} onClick={handleBrowse} className="shrink-0">
                  Open video file
                </Button>
                {videoUrl && (
                  <button
                    onClick={() => {
                      if (!isClipMode) {
                        // Warn if multi-track and not yet merged
                        if (multiTrack && !tracksExtracted) { setClipModeModal('warn'); return }
                        setIsClipMode(true)
                        return
                      }
                      if (clipState.clipRegions.length > 0) {
                        setShowExitClipConfirm(true)
                      } else {
                        exitClipMode()
                      }
                    }}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs border transition-colors shrink-0 ${
                      isClipMode
                        ? 'bg-red-900/30 border-red-600/40 text-red-400 hover:bg-red-900/50'
                        : 'bg-blue-950/40 border-blue-500/30 text-blue-400 hover:bg-blue-950/60'
                    }`}
                  >
                    <Scissors size={12} />
                    {isClipMode ? 'Stop Clipping' : 'Start Clipping'}
                  </button>
                )}
                {videoInfo && (
                  <div className="ml-auto flex items-center gap-1 text-xs text-gray-500 min-w-0">
                    <Info size={12} className="shrink-0" />
                    <span className="shrink-0">{videoInfo.width}×{videoInfo.height}</span>
                    {videoInfo.fps && <span className="shrink-0">· {videoInfo.fps.toFixed(2)} fps</span>}
                    <span className="shrink-0">· {videoInfo.videoCodec}</span>
                    {state.filePath && (
                      <button
                        className="truncate hover:text-gray-300 transition-colors cursor-pointer"
                        title={`Show in Explorer: ${state.filePath}`}
                        onClick={() => window.api.openInExplorer(state.filePath!)}
                      >
                        · {state.filePath.split(/[\\/]/).pop()}
                      </button>
                    )}
                    <button
                      onClick={() => {
                        const hasClipWork = isClipMode && (
                          clipState.clipRegions.length > 0 || clipState.bleepRegions.length > 0
                        )
                        if (hasClipWork) {
                          setShowCloseVideoConfirm(true)
                        } else {
                          closeVideo()
                        }
                      }}
                      className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs border ml-1 p-0.5 text-red-400 border-red-600/40 bg-red-900/30 hover:bg-red-900/50 transition-colors shrink-0"
                      title="Close video"
                    >
                      <X size={12} />
                      Close Video
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Audio tracks panel */}
          <div className={`relative bg-navy-800 border-l border-white/5 flex flex-col shrink-0 transition-all duration-200 ${panelCollapsed ? 'w-6 overflow-hidden' : 'w-56 overflow-y-auto'}`}>
            {/* Collapse toggle — always visible on the left edge */}
            <button
              onClick={() => setPanelCollapsed(v => !v)}
              title={panelCollapsed ? 'Expand panel' : 'Collapse panel'}
              className="absolute left-0 top-1/2 -translate-y-1/2 z-10 flex items-center justify-center w-4 h-8 bg-white/5 hover:bg-white/10 border border-white/[0.04] rounded-r text-gray-600 hover:text-gray-400 transition-colors"
            >
              {panelCollapsed ? <ChevronLeft size={10} /> : <ChevronRight size={10} />}
            </button>
            {!panelCollapsed && (<>
            <div className="px-4 py-3 border-b border-white/5">
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Audio Tracks</h3>
            </div>

            {/* Pre-merge: track selector */}
            {multiTrack && !tracksExtracted && !isExtracting && (
              <div className="px-4 py-4 flex flex-col gap-3">
                <div className="flex items-start gap-2 text-xs text-gray-400 leading-relaxed">
                  <Layers size={13} className="text-purple-400 mt-0.5 shrink-0" />
                  <span>
                    {videoInfo!.audioTracks.length} tracks detected. Only Track 1 is audible until merged. Select which tracks to include.
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
                        className={`w-full text-left px-3 py-2 rounded-lg border transition-colors ${
                          checked
                            ? 'bg-purple-600/20 border-purple-600/40 text-purple-200'
                            : 'bg-white/[0.03] border-white/5 text-gray-400 hover:bg-white/[0.06] hover:text-gray-200'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          {checked
                            ? <CheckSquare size={13} className="text-purple-400 shrink-0" />
                            : <Square size={13} className="text-gray-600 shrink-0" />
                          }
                          <span className="text-xs font-medium">{label}</span>
                        </div>
                        <div className="text-[10px] text-gray-600 mt-0.5 pl-5">
                          {t.codec} · {t.channels}ch{t.language ? ` · ${t.language}` : ''}
                        </div>
                      </button>
                    )
                  })}
                </div>

                <button
                  onClick={() => extractTracks(Array.from(selectedIndices).sort())}
                  disabled={selectedIndices.size < 1}
                  className="w-full text-xs font-medium py-2 px-3 rounded-lg bg-purple-600/20 hover:bg-purple-600/35 text-purple-300 border border-purple-600/30 transition-colors text-left disabled:opacity-40 disabled:pointer-events-none"
                >
                  Merge audio tracks
                  <div className="text-[10px] text-purple-500 font-normal mt-0.5">Takes a moment to process</div>
                </button>
              </div>
            )}

            {/* During merge: progress bars */}
            {multiTrack && isExtracting && (
              <div className="px-4 py-4 flex flex-col gap-3">
                <div className="flex items-center gap-2 text-xs text-purple-300 font-medium">
                  <Loader2 size={12} className="animate-spin shrink-0" />
                  Merging audio tracks…
                </div>
                <div className="flex flex-col gap-3">
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
                <div className="px-4 py-4 flex flex-col gap-3">
                  {/* Merged */}
                  <div className="flex flex-col gap-1.5">
                    <p className="text-[10px] text-gray-600 uppercase tracking-wider font-semibold">Merged tracks</p>
                    {merged.map((track) => {
                      const info = videoInfo?.audioTracks[track.index]
                      const label = info?.title || TRACK_LABELS[track.index] || `Track ${track.index + 1}`
                      return (
                        <div key={track.index} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-purple-600/10 border border-purple-600/20">
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
                          <div key={track.index} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/[0.03] border border-white/5">
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
              <div className="px-4 py-6 text-center text-xs text-gray-600">No audio tracks found</div>
            )}
            </>)}
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
              <Button variant="ghost" size="sm" onClick={() => { setClipModeModal(null); setIsClipMode(true) }}>
                Continue anyway
              </Button>
              <Button variant="primary" size="sm" onClick={() => setClipModeModal('merge')}>
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
                            ? 'bg-purple-600/20 border-purple-600/40 text-purple-200'
                            : 'bg-white/[0.03] border-white/5 text-gray-400 hover:bg-white/[0.06] hover:text-gray-200'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          {checked
                            ? <CheckSquare size={13} className="text-purple-400 shrink-0" />
                            : <Square size={13} className="text-gray-600 shrink-0" />
                          }
                          <span className="text-xs font-medium">{label}</span>
                        </div>
                        <div className="text-[10px] text-gray-600 mt-0.5 pl-5">
                          {t.codec} · {t.channels}ch{t.language ? ` · ${t.language}` : ''}
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

      <Modal
        isOpen={showExitClipConfirm}
        onClose={() => setShowExitClipConfirm(false)}
        title="Discard clip points?"
        width="sm"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setShowExitClipConfirm(false)}>
              Keep editing
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() => { setShowExitClipConfirm(false); exitClipMode() }}
            >
              Discard &amp; exit
            </Button>
          </>
        }
      >
        <p className="text-sm text-gray-300 leading-relaxed">
          You've set in and out points for this clip. Exiting clip mode will discard them.
        </p>
      </Modal>

      <Modal
        isOpen={showCloseVideoConfirm}
        onClose={() => setShowCloseVideoConfirm(false)}
        title="Close video?"
        width="sm"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setShowCloseVideoConfirm(false)}>
              Keep editing
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() => { setShowCloseVideoConfirm(false); closeVideo() }}
            >
              Discard &amp; close
            </Button>
          </>
        }
      >
        <p className="text-sm text-gray-300 leading-relaxed">
          You have unsaved clip work — {[
            clipState.clipRegions.length > 0 && `${clipState.clipRegions.length} clip segment${clipState.clipRegions.length !== 1 ? 's' : ''}`,
            clipState.bleepRegions.length > 0 && `${clipState.bleepRegions.length} bleep marker${clipState.bleepRegions.length !== 1 ? 's' : ''}`,
          ].filter(Boolean).join(' and ')}. Closing the video will discard them.
        </p>
      </Modal>

      {showExportDialog && state.filePath && (
        <ExportClipDialog
          defaultPresetId={config.clipPresetId ?? ''}
          filePath={state.filePath}
          hasBleepsOutsideRegions={clipState.bleepRegions.some(b =>
            !clipState.clipRegions.some(r => b.start >= r.inPoint && b.end <= r.outPoint)
          )}
          onConfirm={runExport}
          onClose={() => setShowExportDialog(false)}
        />
      )}
    </div>
  )
}
