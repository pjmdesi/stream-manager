import React, { useRef, useCallback, useEffect, useState, useMemo } from 'react'
import { Play, Pause, FolderOpen, Info, Layers, CheckSquare, Square, RotateCcw, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Camera, X, Loader2, Scissors, LogIn, LogOut, Crop, AudioWaveform, VolumeX, Upload, ZoomIn, Tv2 } from 'lucide-react'
import { v4 as uuidv4 } from 'uuid'
import { useConversionJobs } from '../../context/ConversionContext'
import type { BleepRegion, ClipState, CropMode, TimelineViewport } from '../../types'
import { useVideoPlayer } from '../../hooks/useVideoPlayer'
import { useThumbnailStrip } from '../../hooks/useThumbnailStrip'
import { useWaveform } from '../../hooks/useWaveform'
import { FileDropZone } from '../ui/FileDropZone'
import { Slider } from '../ui/Slider'
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

interface PendingFile { path: string; token: number }

export function PlayerPage({ initialFile, onNavigateToConverter }: {
  initialFile?: PendingFile | null
  onNavigateToConverter?: () => void
}) {
  const { videoRef, state, loadFile, extractTracks, cancelExtraction, resetExtraction, clearError, closeVideo, seek, fastSeek, togglePlay, audioElements } = useVideoPlayer()
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set())
  const [editingTimecode, setEditingTimecode] = useState(false)
  const [timecodeInput, setTimecodeInput] = useState('')
  const timecodeInputRef = useRef<HTMLInputElement>(null)

  // Clip mode
  const [isClipMode, setIsClipMode] = useState(false)
  const [clipState, setClipState] = useState<ClipState>({
    inPoint: null,
    outPoint: null,
    cropMode: 'none' as CropMode,
    cropX: 0.5,
    bleepRegions: [],
    bleepVolume: 0.25,
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

  // In/Out handle popups
  const [showInPopup, setShowInPopup]   = useState(false)
  const [showOutPopup, setShowOutPopup] = useState(false)
  const [inPointInput,  setInPointInput]  = useState('')
  const [outPointInput, setOutPointInput] = useState('')
  const inPointInputRef  = useRef<HTMLInputElement>(null)
  const outPointInputRef = useRef<HTMLInputElement>(null)
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

  // Multi-track warning modal before entering clip mode
  const [clipModeModal, setClipModeModal] = useState<'warn' | 'merge' | null>(null)
  const pendingClipAfterMerge = useRef(false)

  // Clip duration display / edit
  const [editingDuration, setEditingDuration] = useState(false)
  const [durationInput, setDurationInput] = useState('')
  const durationInputRef = useRef<HTMLInputElement>(null)

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
  // Declared early so seekRef/fastSeekRef can close over them; synced via useEffect below.
  const isPopupOpenRef          = useRef(false)
  const setPopupCurrentTimeRef  = useRef<(t: number) => void>(() => {})
  const effectiveCurrentTimeRef = useRef(0)
  // Popup-aware: relay to popup when open, else seek local video.
  // All playhead-drag, waveform-click, and slider handlers use these refs
  // so they don't need to know about popup state themselves.
  const seekRef     = useRef((t: number) => seek(t))
  const fastSeekRef = useRef((t: number) => fastSeek(t))

  const exitClipMode = useCallback(() => {
    setIsClipMode(false)
    setActiveBleepId(null)
    setClipState({ inPoint: null, outPoint: null, cropMode: 'none', cropX: 0.5, bleepRegions: [], bleepVolume: 0.25 })
    setViewport({ viewStart: 0, viewEnd: durationRef.current })
    setShowInPopup(false)
    setShowOutPopup(false)
  }, [])

  // Shared zoom handler — uses refs to avoid stale closures in non-passive listeners
  const handleZoom = useCallback((e: WheelEvent, rect: DOMRect) => {
    if (!isClipModeRef.current || durationRef.current <= 0) return
    e.preventDefault()
    const { viewStart, viewEnd } = viewportRef.current
    const span = viewEnd - viewStart
    const cursorRatio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    const cursorTime = viewStart + cursorRatio * span
    const factor = e.deltaY < 0 ? 0.7 : 1 / 0.7   // scroll up = zoom in
    const dur = durationRef.current
    const newSpan = Math.max(dur / 500, Math.min(dur, span * factor))
    let newStart = cursorTime - cursorRatio * newSpan
    let newEnd = newStart + newSpan
    if (newStart < 0) { newStart = 0; newEnd = Math.min(dur, newSpan) }
    if (newEnd > dur) { newEnd = dur; newStart = Math.max(0, dur - newSpan) }
    setViewport({ viewStart: newStart, viewEnd: newEnd })
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
  useEffect(() => { seekRef.current     = (t) => { if (isPopupOpenRef.current) { window.api.controlVideoPopup('seek', t); setPopupCurrentTimeRef.current(t) } else seek(t) }     }, [seek])
  useEffect(() => { fastSeekRef.current = (t) => { if (isPopupOpenRef.current) { window.api.controlVideoPopup('seek', t); setPopupCurrentTimeRef.current(t) } else fastSeek(t) } }, [fastSeek])
  useEffect(() => {
    if (duration > 0) setViewport({ viewStart: 0, viewEnd: duration })
    // Close popup whenever the loaded file changes or is cleared
    window.api.closeVideoPopup().catch(() => {})
    setIsPopupOpen(false)
  }, [state.videoUrl]) // eslint-disable-line react-hooks/exhaustive-deps

  // After a merge triggered from the clip-mode modal completes, enter clip mode automatically
  useEffect(() => {
    if (tracksExtracted && pendingClipAfterMerge.current) {
      pendingClipAfterMerge.current = false
      setClipModeModal(null)
      setIsClipMode(true)
    }
  }, [tracksExtracted])


  // Snap viewport to keep playhead visible whenever currentTime changes
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

  // Middle-click pan: captures drag start and applies delta against initial viewport
  const startMiddleClickPan = useCallback((e: React.MouseEvent, containerWidthPx: number) => {
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

  // Drag an In or Out handle. Uses refs for all mutable values so the callback is stable.
  // Shows the popup immediately on mousedown; input updates live during drag.
  const startHandleDrag = useCallback((e: React.MouseEvent, which: 'in' | 'out') => {
    e.preventDefault()
    e.stopPropagation()
    const wrapperEl = stripsWrapperRef.current
    if (!wrapperEl) return
    const rect = wrapperEl.getBoundingClientRect()
    const startX = e.clientX
    let hasMoved = false

    // Show popup immediately and sync current value to input
    const fps = videoInfoRef.current?.fps
    if (which === 'in') {
      const ip = clipStateRef.current.inPoint
      if (ip !== null) setInPointInput(formatViewTime(ip, fps))
      setShowInPopup(true)
      setShowOutPopup(false)
    } else {
      const op = clipStateRef.current.outPoint
      if (op !== null) setOutPointInput(formatViewTime(op, fps))
      setShowOutPopup(true)
      setShowInPopup(false)
    }

    const onMove = (me: MouseEvent) => {
      if (!hasMoved && Math.abs(me.clientX - startX) > 2) hasMoved = true
      const ratio = Math.max(0, Math.min(1, (me.clientX - rect.left) / rect.width))
      const { viewStart, viewEnd } = viewportRef.current
      const t = viewStart + ratio * (viewEnd - viewStart)
      const dur = durationRef.current
      const moveFps = videoInfoRef.current?.fps
      if (which === 'in') {
        const clamped = Math.max(0, Math.min(t, clipStateRef.current.outPoint !== null ? clipStateRef.current.outPoint - 0.001 : dur))
        setInPointInput(formatViewTime(clamped, moveFps))
        setClipState(s => ({ ...s, inPoint: clamped }))
        seekRef.current(clamped)
      } else {
        const clamped = Math.min(dur, Math.max(t, clipStateRef.current.inPoint !== null ? clipStateRef.current.inPoint + 0.001 : 0))
        setOutPointInput(formatViewTime(clamped, moveFps))
        setClipState(s => ({ ...s, outPoint: clamped }))
        seekRef.current(clamped)
      }
    }
    const onUp = () => {
      if (!hasMoved) {
        // Clean click: keep popup open and focus the input so the user can type immediately
        setTimeout(() => {
          if (which === 'in') inPointInputRef.current?.select()
          else outPointInputRef.current?.select()
        }, 0)
      } else {
        // Drag ended: close the popup
        if (which === 'in') setShowInPopup(false)
        else setShowOutPopup(false)
      }
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, []) // all mutable values accessed via refs

  // Drag the entire clip region (both handles together). Preserves clip duration.
  const startRegionDrag = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) {
      // Middle-click should pan the timeline, not move the region
      if (e.button === 1) startMiddleClickPan(e, stripsWrapperRef.current?.getBoundingClientRect().width ?? 0)
      return
    }
    e.preventDefault()
    e.stopPropagation()
    const wrapperEl = stripsWrapperRef.current
    if (!wrapperEl) return
    const rect = wrapperEl.getBoundingClientRect()
    const startX = e.clientX
    const startIn  = clipStateRef.current.inPoint!
    const startOut = clipStateRef.current.outPoint!
    const clipDur  = startOut - startIn
    let hasMoved = false
    const onMove = (me: MouseEvent) => {
      if (!hasMoved && Math.abs(me.clientX - startX) > 2) hasMoved = true
      if (!hasMoved) return
      const { viewStart, viewEnd } = viewportRef.current
      const span = viewEnd - viewStart
      const dur = durationRef.current
      const dtSec = ((me.clientX - startX) / rect.width) * span
      let newIn  = startIn  + dtSec
      let newOut = startOut + dtSec
      if (newIn  < 0)   { newIn = 0;            newOut = clipDur }
      if (newOut > dur) { newOut = dur;          newIn  = dur - clipDur }
      setClipState(s => ({ ...s, inPoint: newIn, outPoint: newOut }))
    }
    const onUp = (ue: MouseEvent) => {
      if (!hasMoved) {
        // Clean click: seek to the cursor position
        const ratio = Math.max(0, Math.min(1, (ue.clientX - rect.left) / rect.width))
        const { viewStart, viewEnd } = viewportRef.current
        seekRef.current(viewStart + ratio * (viewEnd - viewStart))
      }
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [startMiddleClickPan]) // startMiddleClickPan is stable ([] deps)

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
    fastSeekRef.current(getTime(e.clientX))
    const onMove = (me: MouseEvent) => fastSeekRef.current(getTime(me.clientX))
    const onUp = (me: MouseEvent) => {
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

  // I / O keyboard shortcuts — set in/out point at current playhead
  useEffect(() => {
    if (!isClipMode) return
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return
      if (e.key === 'i' || e.key === 'I') {
        e.preventDefault()
        setClipState(s => ({ ...s, inPoint: currentTimeRef.current }))
      }
      if (e.key === 'o' || e.key === 'O') {
        e.preventDefault()
        setClipState(s => ({ ...s, outPoint: currentTimeRef.current }))
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isClipMode])

  // Viewport-derived values — when not in clip mode, the full video is always visible
  const vStart = isClipMode && duration > 0 ? viewport.viewStart : 0
  const vEnd   = isClipMode && duration > 0 ? viewport.viewEnd   : duration
  const vSpan  = Math.max(0.001, vEnd - vStart)
  const zoomLevel = duration > 0 ? duration / vSpan : 1
  const isZoomed  = isClipMode && zoomLevel > 1.01

  // Snap playhead to nearest boundary when the user adjusts the viewport range
  useEffect(() => {
    if (!isClipMode || duration <= 0) return
    if (currentTime < vStart) seek(vStart)
    else if (currentTime > vEnd) seek(vEnd)
  }, [vStart, vEnd]) // eslint-disable-line react-hooks/exhaustive-deps

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
    if (!isPopupOpenRef.current && !vid.paused) vid.pause()
    const fps = videoInfo?.fps ?? 30
    seekRef.current(Math.max(0, Math.min(duration, effectiveCurrentTimeRef.current + dir / fps)))
  }, [videoRef, videoInfo, duration])

  const skip = useCallback((seconds: number) => {
    seekRef.current(Math.max(0, Math.min(duration, effectiveCurrentTimeRef.current + seconds)))
  }, [duration])

  // Thumbnail strip
  const [filmstripEl, setFilmstripEl] = useState<HTMLDivElement | null>(null)
  const [stripWidth, setStripWidth] = useState(0)
  const [hoverRatio, setHoverRatio] = useState<number | null>(null)
  const [sliderHoverRatio, setSliderHoverRatio] = useState<number | null>(null)

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

  const exportClip = useCallback(async () => {
    if (!state.filePath || !videoInfo || clipState.inPoint === null || clipState.outPoint === null) return
    const ext = state.filePath.split(/[\\/]/).pop()!.split('.').pop() ?? 'mkv'
    const base = state.filePath.replace(/[\\/]/g, '/').split('/').pop()!.replace(/\.[^.]+$/, '')
    const dir  = state.filePath.replace(/[\\/][^\\/]+$/, '').replace(/\\/g, '/')
    const defaultPath = `${dir}/${base}_clip.${ext}`

    const outPath = await window.api.saveFileDialog({
      title: 'Export Clip',
      defaultPath,
      filters: [{ name: 'Video', extensions: [ext] }],
    })
    if (!outPath) return

    const syntheticPreset = {
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
    // Add the job to the shared context so it appears in the Converter page immediately
    setJobs(prev => [...prev, job])

    await window.api.addClipToQueue({
      job,
      inPoint:      clipState.inPoint,
      outPoint:     clipState.outPoint,
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
  // Popup has its own play/time state so the main window's video can be fully suspended
  const [popupPlaying, setPopupPlaying]         = useState(false)
  const [popupCurrentTime, setPopupCurrentTime] = useState(0)
  const effectivePlaying     = isPopupOpen ? popupPlaying     : isPlaying
  const effectiveCurrentTime = isPopupOpen ? popupCurrentTime : currentTime
  // Stable setters — assign inline every render so early-declared refs stay current.
  setPopupCurrentTimeRef.current  = setPopupCurrentTime
  effectiveCurrentTimeRef.current = effectiveCurrentTime
  const wasPlayingAtPopup = useRef(false)
  const lastPopupTime     = useRef(0)

  // Track popup time updates (popup sends ~4 times/sec)
  useEffect(() => {
    return window.api.onVideoPopupTimeUpdate(t => {
      lastPopupTime.current = t
      setPopupCurrentTime(t)
    })
  }, [])

  // When popup closes: restore main video to popup's last position
  useEffect(() => {
    return window.api.onVideoPopupClosed(() => {
      setIsPopupOpen(false)
      setPopupPlaying(false)
      const v = videoRef.current
      if (!v || !state.videoUrl) return
      v.currentTime = lastPopupTime.current
      if (wasPlayingAtPopup.current) v.play().catch(() => {})
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.videoUrl])

  const openVideoPopup = useCallback(async () => {
    if (!state.filePath || !videoInfo) return
    // Pause (and remember state) before opening so only one decoder runs at a time
    wasPlayingAtPopup.current = isPlaying
    videoRef.current?.pause()
    audioElements.current.forEach(a => a?.pause())
    lastPopupTime.current = currentTime
    setPopupCurrentTime(currentTime)
    await window.api.openVideoPopup(state.filePath, currentTime, videoInfo.width, videoInfo.height)
    setIsPopupOpen(true)
    setPopupPlaying(true)   // popup auto-plays on open
  }, [state.filePath, videoInfo, currentTime, isPlaying, audioElements])

  // Keep isPopupOpenRef in sync so seekRef/fastSeekRef can read it at call time.
  useEffect(() => { isPopupOpenRef.current = isPopupOpen }, [isPopupOpen])

  const effectiveTogglePlay = useCallback(() => {
    if (isPopupOpenRef.current) {
      setPopupPlaying(prev => {
        const next = !prev
        window.api.controlVideoPopup(next ? 'play' : 'pause')
        return next
      })
    } else {
      togglePlay()
    }
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
                  src={videoUrl}
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

              {/* Extracting overlay */}
              {isExtracting && (
                <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center gap-4">
                  <div className="text-purple-300 font-medium text-sm">Merging audio tracks…</div>
                  <div className="flex flex-col gap-2.5">
                    {videoInfo?.audioTracks.map((t, i) => {
                      const label = t.title || TRACK_LABELS[i] || `Track ${i + 1}`
                      const selected = selectedIndices.has(i)
                      return (
                        <div key={i} className="flex items-center gap-3">
                          <span className={`text-xs text-white whitespace-nowrap ${selected ? '' : 'line-through opacity-50'}`}>
                            {label} <span className="text-white/50">(Track {i + 1})</span>
                          </span>
                          {selected ? (
                            <>
                              <div className="w-32 h-1.5 bg-white/10 rounded-full overflow-hidden">
                                <div
                                  className={`h-full rounded-full transition-all ${(extractProgress[i] ?? 0) >= 100 ? 'bg-green-500' : 'bg-purple-500'}`}
                                  style={{ width: `${extractProgress[i] ?? 0}%` }}
                                />
                              </div>
                              <span className="text-xs text-white/50 w-8 text-right tabular-nums">{extractProgress[i] ?? 0}%</span>
                            </>
                          ) : (
                            <div className="w-32 h-1.5 bg-white/5 rounded-full" />
                          )}
                        </div>
                      )
                    })}
                  </div>
                  <button
                    onClick={cancelExtraction}
                    className="mt-1 text-xs text-white/50 hover:text-white transition-colors"
                  >
                    Cancel
                  </button>
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

                    <button
                      title="Set In Point (I)"
                      onClick={() => setClipState(s => ({ ...s, inPoint: currentTime }))}
                      className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] text-blue-400 border border-blue-500/30 hover:bg-blue-950/60 transition-colors"
                    >
                      <LogIn size={11} /> In
                    </button>
                    <button
                      title="Set Out Point (O)"
                      onClick={() => setClipState(s => ({ ...s, outPoint: currentTime }))}
                      className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] text-blue-400 border border-blue-500/30 hover:bg-blue-950/60 transition-colors"
                    >
                      <LogOut size={11} /> Out
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

                    <button
                      title={clipState.inPoint !== null && clipState.outPoint !== null ? 'Export clip' : 'Set in and out points first'}
                      onClick={exportClip}
                      disabled={clipState.inPoint === null || clipState.outPoint === null}
                      className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] border transition-colors disabled:opacity-40 disabled:cursor-not-allowed text-purple-300 border-purple-600/30 bg-purple-600/20 hover:bg-purple-600/35 disabled:hover:bg-transparent"
                    >
                      <Upload size={11} /> Export Clip
                    </button>
                  </div>
                </div>
              )}

              {/* Viewport scrollbar — directly under clip toolbar */}
              {isClipMode && duration > 0 && (
                <div
                  ref={scrollbarRef}
                  className="relative h-3 w-full select-none"
                >
                  {/* Track */}
                  <div className="absolute inset-y-1 inset-x-0 bg-white/5 rounded-full" />
                  {/* Thumb — drag to pan */}
                  <div
                    className="absolute inset-y-0 rounded-full bg-blue-500/30 hover:bg-blue-500/40 cursor-grab active:cursor-grabbing flex items-center"
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
                      className="absolute left-0 top-0 bottom-0 w-2.5 rounded-l-full cursor-ew-resize bg-blue-400/60 hover:bg-blue-400/90 transition-colors z-10"
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
                      className="absolute right-0 top-0 bottom-0 w-2.5 rounded-r-full cursor-ew-resize bg-blue-400/60 hover:bg-blue-400/90 transition-colors z-10"
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

              {/* Thumbnail strip + waveform strip — wrapped so handles can span both */}
              <div ref={stripsWrapperRef} className="relative">

              {/* Thumbnail strip */}
              <div
                ref={setFilmstripEl}
                className="relative h-8 w-full cursor-pointer select-none"
                onClick={e => {
                  const rect = e.currentTarget.getBoundingClientRect()
                  const ratio = (e.clientX - rect.left) / rect.width
                  seek(Math.max(0, Math.min(duration, vStart + ratio * vSpan)))
                }}
                onMouseDown={e => startMiddleClickPan(e, e.currentTarget.getBoundingClientRect().width)}
                onMouseMove={e => {
                  const rect = e.currentTarget.getBoundingClientRect()
                  setHoverRatio((e.clientX - rect.left) / rect.width)
                }}
                onMouseLeave={() => setHoverRatio(null)}
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

                {/* Playhead — hidden when scrolled out of view */}
                {duration > 0 && effectiveCurrentTime >= vStart && effectiveCurrentTime <= vEnd && (
                  <div
                    className="absolute top-0 bottom-0 w-0.5 bg-purple-400/90 pointer-events-none z-20"
                    style={{ left: `${((effectiveCurrentTime - vStart) / vSpan) * 100}%`, transform: 'translateX(-50%)' }}
                  />
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
                  const rect = e.currentTarget.getBoundingClientRect()
                  const ratio = (e.clientX - rect.left) / rect.width
                  seek(Math.max(0, Math.min(duration, vStart + ratio * vSpan)))
                }}
                onMouseDown={e => startMiddleClickPan(e, e.currentTarget.getBoundingClientRect().width)}
                onMouseMove={e => {
                  const rect = e.currentTarget.getBoundingClientRect()
                  setHoverRatio((e.clientX - rect.left) / rect.width)
                }}
                onMouseLeave={() => setHoverRatio(null)}
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
                {/* Playhead — hidden when scrolled out of view */}
                {duration > 0 && effectiveCurrentTime >= vStart && effectiveCurrentTime <= vEnd && (
                  <div
                    className="absolute top-0 bottom-0 w-0.5 bg-purple-400/80 pointer-events-none z-[8]"
                    style={{ left: `${((effectiveCurrentTime - vStart) / vSpan) * 100}%`, transform: 'translateX(-50%)' }}
                  />
                )}
              </div>

              {/* Draggable playhead — z-10 beats region drag (no z-index), yields to handles (z-20) */}
              {duration > 0 && effectiveCurrentTime >= vStart && effectiveCurrentTime <= vEnd && (
                <div
                  className="absolute inset-y-0 z-10 -translate-x-1/2 cursor-ew-resize"
                  style={{ left: `${((effectiveCurrentTime - vStart) / vSpan) * 100}%`, width: '12px' }}
                  onMouseDown={startPlayheadDrag}
                />
              )}

              {/* Clip region shading + bleep markers + draggable In/Out handles — spans both strips */}
              {isClipMode && (
                <>
                  {/* Left shading: before in-point — z-[5] so it dims bleeps that stray outside clip window */}
                  {clipState.inPoint !== null && (
                    <div
                      className="absolute inset-y-0 bg-black/45 pointer-events-none z-[5]"
                      style={{ left: 0, width: `${Math.max(0, Math.min(100, ((clipState.inPoint - vStart) / vSpan) * 100))}%` }}
                    />
                  )}
                  {/* Right shading: after out-point */}
                  {clipState.outPoint !== null && (
                    <div
                      className="absolute inset-y-0 bg-black/45 pointer-events-none z-[5]"
                      style={{ right: 0, width: `${Math.max(0, Math.min(100, ((vEnd - clipState.outPoint) / vSpan) * 100))}%` }}
                    />
                  )}
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
                        {/* Icon centered in the marker — VolumeX when muted, AudioWaveform otherwise */}
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-35">
                          {clipState.bleepVolume < 0.01
                            ? <VolumeX size={14} className="text-white" />
                            : <AudioWaveform size={14} className="text-white" />
                          }
                        </div>
                        {/* Volume line — draggable horizontal bar; top position = 1 - volume */}
                        <div
                          className="absolute left-0 right-0 h-3 -translate-y-1/2 cursor-ns-resize group z-10"
                          style={{ top: `${(1 - clipState.bleepVolume / 1.5) * 100}%` }}
                          onMouseDown={e => {
                            if (e.button !== 0) return
                            e.stopPropagation()
                            startBleepVolumeDrag(e, e.currentTarget.parentElement!.getBoundingClientRect())
                          }}
                        >
                          {/* Visible line — thicker hit area above for easier grabbing */}
                          <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-px bg-white/70 group-hover:bg-white transition-colors" />
                        </div>
                        {/* Resize handles — only shown when the marker is wide enough */}
                        {showHandles && (
                          <>
                            <div
                              className="absolute left-0 top-0 bottom-0 w-1 cursor-ew-resize hover:bg-white/30 transition-colors"
                              onMouseDown={e => { e.stopPropagation(); if (e.button === 0) startBleepResize(e, region.id, 'start', waveformStripRef.current!.getBoundingClientRect()) }}
                            />
                            <div
                              className="absolute right-0 top-0 bottom-0 w-1 cursor-ew-resize hover:bg-white/30 transition-colors"
                              onMouseDown={e => { e.stopPropagation(); if (e.button === 0) startBleepResize(e, region.id, 'end', waveformStripRef.current!.getBoundingClientRect()) }}
                            />
                          </>
                        )}
                      </div>
                    )
                  })}
                  {/* Clip region drag hit area (no border — interaction only) + visual border (pointer-events-none on top) */}
                  {clipState.inPoint !== null && clipState.outPoint !== null && (() => {
                    const l = Math.max(0, ((clipState.inPoint  - vStart) / vSpan) * 100)
                    const r = Math.max(0, ((vEnd - clipState.outPoint) / vSpan) * 100)
                    return (
                      <>
                        {/* Transparent drag hit area — z-[2] so bleeps (z-[4]) take priority */}
                        <div
                          className="absolute inset-y-0 z-[2] cursor-grab active:cursor-grabbing"
                          style={{ left: `${l}%`, right: `${r}%` }}
                          onMouseDown={startRegionDrag}
                        />
                        {/* Visual border — z-[9] so it renders above bleeps and playhead line */}
                        <div
                          className="absolute inset-y-0 border-y border-blue-400/50 pointer-events-none z-[9]"
                          style={{ left: `${l}%`, right: `${r}%` }}
                        />
                      </>
                    )
                  })()}
                  {/* In-point handle */}
                  {clipState.inPoint !== null && clipState.inPoint >= vStart - 0.001 && clipState.inPoint <= vEnd + 0.001 && (
                    <div
                      className="absolute inset-y-0 z-20 cursor-ew-resize"
                      style={{
                        left: `${Math.max(0, Math.min(100, ((clipState.inPoint - vStart) / vSpan) * 100))}%`,
                        transform: 'translateX(-50%)',
                        width: '12px',
                      }}
                      onMouseDown={e => startHandleDrag(e, 'in')}
                    >
                      {/* Visible bar */}
                      <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-[3px] bg-blue-400 rounded-sm" />
                    </div>
                  )}
                  {/* Out-point handle */}
                  {clipState.outPoint !== null && clipState.outPoint >= vStart - 0.001 && clipState.outPoint <= vEnd + 0.001 && (
                    <div
                      className="absolute inset-y-0 z-20 cursor-ew-resize"
                      style={{
                        left: `${Math.max(0, Math.min(100, ((clipState.outPoint - vStart) / vSpan) * 100))}%`,
                        transform: 'translateX(-50%)',
                        width: '12px',
                      }}
                      onMouseDown={e => startHandleDrag(e, 'out')}
                    >
                      {/* Visible bar */}
                      <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-[3px] bg-blue-400 rounded-sm" />
                    </div>
                  )}
                  {/* In/Out popups — absolute inside wrapper so bottom:100% lands flush on the handle top */}
                  {[
                    { which: 'in'  as const, point: clipState.inPoint,  show: showInPopup,  input: inPointInput,  setInput: setInPointInput,  inputRef: inPointInputRef,  setShow: setShowInPopup  },
                    { which: 'out' as const, point: clipState.outPoint, show: showOutPopup, input: outPointInput, setInput: setOutPointInput, inputRef: outPointInputRef, setShow: setShowOutPopup },
                  ].map(({ which, point, show, input, setInput, inputRef, setShow }) => {
                    if (!show || point === null) return null
                    const leftPct = Math.max(2, Math.min(98, ((point - vStart) / vSpan) * 100))
                    const minT = which === 'in' ? 0 : (clipState.inPoint ?? 0) + 0.001
                    const maxT = which === 'in' ? (clipState.outPoint ?? duration) - 0.001 : duration
                    return (
                      <div
                        key={which}
                        className="absolute flex -translate-x-1/2 z-50"
                        style={{ left: `${leftPct}%`, top: '100%' }}
                      >
                        <div className="bg-blue-950 border border-blue-400 rounded px-1 pt-0.5 pb-0 flex items-center shadow-xl">
                          <input
                            ref={inputRef}
                            value={input}
                            onChange={e => setInput(e.target.value)}
                            onKeyDown={e => {
                              const arrow = applyTimecodeArrow(e, input, inputRef, videoInfo?.fps, minT, maxT)
                              if (arrow) { setInput(arrow.newValue); setClipState(s => ({ ...s, [which === 'in' ? 'inPoint' : 'outPoint']: arrow.newTime })); seek(arrow.newTime) }
                              if (e.key === 'Enter') {
                                const t = parseTimecode(input, videoInfo?.fps)
                                if (t !== null) { const ct = Math.max(minT, Math.min(t, maxT)); setClipState(s => ({ ...s, [which === 'in' ? 'inPoint' : 'outPoint']: ct })); seek(ct) }
                                setShow(false)
                              }
                              if (e.key === 'Escape') setShow(false)
                            }}
                            onBlur={() => {
                              const t = parseTimecode(input, videoInfo?.fps)
                              if (t !== null) { const ct = Math.max(minT, Math.min(t, maxT)); setClipState(s => ({ ...s, [which === 'in' ? 'inPoint' : 'outPoint']: ct })); seek(ct) }
                              setShow(false)
                            }}
                            className="text-[11px] text-blue-200 tabular-nums bg-transparent focus:outline-none min-w-0 text-center"
                            style={{ width: `${input.length}ch` }}
                          />
                        </div>
                      </div>
                    )
                  })}
                  {/* Clip duration — centered on the region, permanently visible when both points set */}
                  {clipState.inPoint !== null && clipState.outPoint !== null && (() => {
                    const clipDur = clipState.outPoint - clipState.inPoint
                    const centerPct = Math.max(2, Math.min(98, (((clipState.inPoint + clipState.outPoint) / 2 - vStart) / vSpan) * 100))
                    const durStr = formatViewTime(clipDur, videoInfo?.fps)
                    return (
                      <div
                        className="absolute flex -translate-x-1/2 z-40"
                        style={{ left: `${centerPct}%`, top: '100%' }}
                      >
                        <div className="bg-blue-950 border border-blue-400 rounded-b px-1 pt-0.5 pb-0 flex items-center shadow-xl">
                          {editingDuration ? (
                            <input
                              ref={durationInputRef}
                              value={durationInput}
                              onChange={e => setDurationInput(e.target.value)}
                              onKeyDown={e => {
                                const arrow = applyTimecodeArrow(e, durationInput, durationInputRef, videoInfo?.fps, 0.001, duration - (clipState.inPoint ?? 0))
                                if (arrow) {
                                  setDurationInput(arrow.newValue)
                                  const newOut = Math.min(duration, (clipState.inPoint ?? 0) + arrow.newTime)
                                  setClipState(s => ({ ...s, outPoint: newOut }))
                                  seek(newOut)
                                }
                                if (e.key === 'Enter' || e.key === 'Escape') {
                                  if (e.key === 'Enter') {
                                    const t = parseTimecode(durationInput, videoInfo?.fps)
                                    if (t !== null && t > 0) { const newOut = Math.min(duration, (clipState.inPoint ?? 0) + t); setClipState(s => ({ ...s, outPoint: newOut })); seek(newOut) }
                                  }
                                  setEditingDuration(false)
                                }
                              }}
                              onBlur={() => {
                                const t = parseTimecode(durationInput, videoInfo?.fps)
                                if (t !== null && t > 0) { const newOut = Math.min(duration, (clipState.inPoint ?? 0) + t); setClipState(s => ({ ...s, outPoint: newOut })); seek(newOut) }
                                setEditingDuration(false)
                              }}
                              className="text-[11px] text-blue-200 tabular-nums bg-transparent focus:outline-none min-w-0 text-center"
                              style={{ width: `${durationInput.length}ch` }}
                            />
                          ) : (
                            <span
                              className="text-[11px] text-blue-200 tabular-nums cursor-text select-none"
                              onClick={() => { setDurationInput(durStr); setEditingDuration(true); setTimeout(() => durationInputRef.current?.select(), 0) }}
                            >
                              {durStr}
                            </span>
                          )}
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

              {/* Spacer — reserves room for the handle/duration popups below the strips */}
              {isClipMode && <div className="h-[12px] shrink-0" />}

              {/* Seek bar */}
              <div className="relative">
                {sliderHoverRatio !== null && duration > 0 && (
                  <div
                    className="absolute pointer-events-none z-20 tabular-nums"
                    style={{
                      bottom: '100%',
                      marginBottom: 3,
                      left: `${Math.min(Math.max(sliderHoverRatio * 100, 2), 98)}%`,
                      transform: 'translateX(-50%)'
                    }}
                  >
                    <div className="text-[10px] text-white bg-black/70 px-1 py-0.5 rounded">
                      {formatTime(sliderHoverRatio * duration, videoInfo?.fps)}
                    </div>
                  </div>
                )}
                <Slider
                  value={duration > 0 ? effectiveCurrentTime / duration : 0}
                  min={0}
                  max={1}
                  step={0.001}
                  onChange={(v) => seekRef.current(v * duration)}
                  onDrag={(v) => fastSeekRef.current(v * duration)}
                  onCommit={(v) => seekRef.current(v * duration)}
                  onHover={setSliderHoverRatio}
                  color="purple"
                />
              </div>
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
                      setTimecodeInput(formatViewTime(effectiveCurrentTime, videoInfo?.fps))
                      setEditingTimecode(true)
                      setTimeout(() => timecodeInputRef.current?.select(), 0)
                    }}
                  >
                    {formatTime(effectiveCurrentTime, videoInfo?.fps)}
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
                  title={effectivePlaying ? 'Pause' : 'Play'}
                  className="p-2 mx-1 rounded-full bg-purple-600 hover:bg-purple-500 text-white transition-colors"
                >
                  {effectivePlaying ? <Pause size={16} /> : <Play size={16} />}
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
                      if (clipState.inPoint !== null && clipState.outPoint !== null) {
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
                      <span className="truncate" title={state.filePath}>
                        · {state.filePath.split(/[\\/]/).pop()}
                      </span>
                    )}
                    <button
                      onClick={closeVideo}
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
          <div className="w-56 bg-navy-800 border-l border-white/5 flex flex-col overflow-y-auto shrink-0">
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
    </div>
  )
}
