import React, { useRef, useCallback, useEffect, useState, useMemo } from 'react'
import { Play, Pause, FolderOpen, Info, Layers, CheckSquare, Square, RotateCcw, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Camera, X, Loader2 } from 'lucide-react'
import { useVideoPlayer } from '../../hooks/useVideoPlayer'
import { useThumbnailStrip } from '../../hooks/useThumbnailStrip'
import { useWaveform } from '../../hooks/useWaveform'
import { FileDropZone } from '../ui/FileDropZone'
import { Slider } from '../ui/Slider'
import { Button } from '../ui/Button'

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
    // H:MM:SS or MM:SS:FF (ambiguous — treat as H:MM:SS)
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

const TRACK_LABELS = ['Game', 'Mic', 'Discord', 'Music', 'SFX']

interface PendingFile { path: string; token: number }

export function PlayerPage({ initialFile }: { initialFile?: PendingFile | null }) {
  const { videoRef, state, loadFile, extractTracks, cancelExtraction, resetExtraction, clearError, closeVideo, seek, togglePlay } = useVideoPlayer()
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set())
  const [editingTimecode, setEditingTimecode] = useState(false)
  const [timecodeInput, setTimecodeInput] = useState('')
  const timecodeInputRef = useRef<HTMLInputElement>(null)

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
    seek(Math.max(0, Math.min(duration, currentTime + dir / fps)))
  }, [videoRef, videoInfo, duration, currentTime, seek])

  const skip = useCallback((seconds: number) => {
    seek(Math.max(0, Math.min(duration, currentTime + seconds)))
  }, [duration, currentTime, seek])

  // Thumbnail strip
  const [filmstripEl, setFilmstripEl] = useState<HTMLDivElement | null>(null)
  const [stripWidth, setStripWidth] = useState(0)
  const [hoverRatio, setHoverRatio] = useState<number | null>(null)

  useEffect(() => {
    if (!filmstripEl) return
    setStripWidth(filmstripEl.getBoundingClientRect().width)
    const ro = new ResizeObserver(entries => setStripWidth(entries[0].contentRect.width))
    ro.observe(filmstripEl)
    return () => ro.disconnect()
  }, [filmstripEl])

  const waveformSources = useMemo(() => {
    if (!state.filePath) return []
    if (tracksExtracted) {
      const paths = state.tracks.map(t => t.tempPath).filter((p): p is string => !!p)
      return paths.length > 0 ? paths : [state.filePath]
    }
    return [state.filePath]
  }, [state.filePath, tracksExtracted, state.tracks])

  const { svgPath: waveformPath, peakCount, loading: waveformLoading } = useWaveform(waveformSources)

  const { thumbnails, generating } = useThumbnailStrip(
    state.filePath ?? null,
    videoUrl ?? null,
    duration,
    videoInfo?.width ?? 0,
    videoInfo?.height ?? 0,
    stripWidth
  )

  const [screenshotFlash, setScreenshotFlash] = useState(false)

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
              <video
                ref={videoRef}
                src={videoUrl}
                className="w-full h-full object-contain cursor-pointer"
                preload="auto"
                onClick={togglePlay}
              />

              {/* Screenshot flash */}
              {screenshotFlash && (
                <div className="absolute inset-0 bg-white/30 pointer-events-none" />
              )}

              {/* Screenshot button — visible on hover */}
              <button
                onClick={captureScreenshot}
                title="Save screenshot (PNG)"
                className="absolute bottom-3 right-3 p-2 rounded-lg bg-black/60 text-white/70 hover:text-white hover:bg-black/80 opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <Camera size={16} />
              </button>

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
                                  className="h-full bg-purple-500 rounded-full transition-all"
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
              {/* Thumbnail strip */}
              <div
                ref={setFilmstripEl}
                className="relative h-8 w-full cursor-pointer select-none"
                onClick={e => {
                  const rect = e.currentTarget.getBoundingClientRect()
                  seek(((e.clientX - rect.left) / rect.width) * duration)
                }}
                onMouseMove={e => {
                  const rect = e.currentTarget.getBoundingClientRect()
                  setHoverRatio((e.clientX - rect.left) / rect.width)
                }}
                onMouseLeave={() => setHoverRatio(null)}
              >
                {/* Clipped background */}
                <div className="absolute inset-0 rounded bg-black/40 overflow-hidden pointer-events-none" />

                {/* Thumbnails — only shown once generation is complete */}
                {!generating && (
                  <div className="absolute inset-0 flex">
                    {thumbnails.map((thumb, i) => {
                      const isHovered = hoverRatio !== null &&
                        Math.min(Math.floor(hoverRatio * thumbnails.length), thumbnails.length - 1) === i
                      return (
                        <div
                          key={i}
                          className={`relative h-full flex-1 ${isHovered ? 'z-10' : ''}`}
                          style={{ minWidth: 0 }}
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
                )}

                {generating && (
                  <div className="absolute inset-0 flex items-center justify-center gap-1.5 text-[10px] text-gray-600 pointer-events-none">
                    <Loader2 size={10} className="animate-spin" />
                    Generating thumbnails…
                  </div>
                )}

                {/* Playhead */}
                {duration > 0 && (
                  <div
                    className="absolute top-0 bottom-0 w-0.5 bg-purple-400/90 pointer-events-none z-20"
                    style={{ left: `${(currentTime / duration) * 100}%`, transform: 'translateX(-50%)' }}
                  />
                )}

                {/* Hover marker + timecode (above the strip) */}
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
                        {formatTime(hoverRatio * duration, videoInfo?.fps)}
                      </div>
                    </div>
                  </>
                )}
              </div>

              {/* Waveform strip */}
              <div
                className="relative h-10 w-full cursor-pointer"
                onClick={e => {
                  const rect = e.currentTarget.getBoundingClientRect()
                  seek(((e.clientX - rect.left) / rect.width) * duration)
                }}
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
                {/* Playhead */}
                {duration > 0 && (
                  <div
                    className="absolute top-0 bottom-0 w-0.5 bg-purple-400/80 pointer-events-none"
                    style={{ left: `${(currentTime / duration) * 100}%`, transform: 'translateX(-50%)' }}
                  />
                )}
              </div>

              {/* Seek bar */}
              <Slider
                value={duration > 0 ? currentTime / duration : 0}
                min={0}
                max={1}
                step={0.001}
                onChange={(v) => seek(v * duration)}
                color="purple"
              />
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
                        if (t !== null) seek(Math.max(0, Math.min(t, duration)))
                        setEditingTimecode(false)
                      }
                      if (e.key === 'Escape') setEditingTimecode(false)
                      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                        e.preventDefault()
                        const fps = videoInfo?.fps
                        const cursorPos = timecodeInputRef.current?.selectionStart ?? 0
                        const parts = timecodeInput.split(':')
                        const { index: segIdx } = segmentAtCursor(timecodeInput, cursorPos)
                        const fromRight = parts.length - 1 - segIdx
                        const step = segmentStep(fromRight, fps)
                        const current = parseTimecode(timecodeInput, fps) ?? 0
                        const newTime = Math.max(0, Math.min(current + (e.key === 'ArrowUp' ? step : -step), duration))
                        const newValue = formatTime(newTime, fps)
                        setTimecodeInput(newValue)
                        seek(newTime)
                        // Restore cursor to same segment in new string
                        setTimeout(() => {
                          const input = timecodeInputRef.current
                          if (!input) return
                          const newParts = newValue.split(':')
                          const clampedIdx = Math.min(segIdx, newParts.length - 1)
                          let newStart = 0
                          for (let i = 0; i < clampedIdx; i++) newStart += newParts[i].length + 1
                          input.setSelectionRange(newStart, newStart + newParts[clampedIdx].length)
                        }, 0)
                      }
                    }}
                    onBlur={() => {
                      const t = parseTimecode(timecodeInput, videoInfo?.fps)
                      if (t !== null) seek(Math.max(0, Math.min(t, duration)))
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
                      setTimecodeInput(formatTime(currentTime, videoInfo?.fps))
                      setEditingTimecode(true)
                      setTimeout(() => timecodeInputRef.current?.select(), 0)
                    }}
                  >
                    {formatTime(currentTime, videoInfo?.fps)}
                  </span>
                )}
                <div className="flex-1 flex items-center justify-center gap-1">
                {/* Skip to start */}
                <button onClick={() => seek(0)} title="Skip to start" className="p-1.5 rounded text-gray-500 hover:text-gray-100 hover:bg-white/10 transition-colors">
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
                <button onClick={togglePlay} title={isPlaying ? 'Pause' : 'Play'} className="p-2 mx-1 rounded-full bg-purple-600 hover:bg-purple-500 text-white transition-colors">
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
                <button onClick={() => seek(duration)} title="Skip to end" className="p-1.5 rounded text-gray-500 hover:text-gray-100 hover:bg-white/10 transition-colors">
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
                      className="ml-1 p-0.5 text-gray-600 hover:text-red-400 transition-colors shrink-0"
                      title="Close video"
                    >
                      <X size={12} />
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
          <span className="flex-1">{error}</span>
          <button onClick={clearError} className="shrink-0 hover:text-red-200 transition-colors">
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  )
}
