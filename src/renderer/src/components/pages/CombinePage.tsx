import React, { useState, useEffect, useCallback, useRef } from 'react'
import {
  GripVertical, Film, FolderOpen, Wand2, Combine,
  CheckCircle2, AlertCircle, AlertTriangle, Loader2, X, FolderSearch
} from 'lucide-react'
import { Button } from '../ui/Button'
import { Checkbox } from '../ui/Checkbox'
import { Tooltip } from '../ui/Tooltip'
import { VideoThumb } from '../ui/VideoThumb'
import { useOpenItems } from '../../context/OpenItemsContext'
import { usePageActivity } from '../../context/PageActivityContext'

// ─── Types ────────────────────────────────────────────────────────────────────

interface CombineFile {
  path: string
  name: string
  duration: number | null   // seconds, null = not yet probed
  timestamp: Date | null    // parsed from filename
  /** File size in bytes (batched files:getFileSizes). null = still loading. */
  size: number | null
  /** Owning stream item when the file was sent from a stream — powers the
   *  row's title link + date. Tagged PER FILE (not on the list) so future
   *  multi-stream queues (todo: combine groups) inherit it for free. */
  stream?: { folderPath: string; label: string; date?: string }
  // Stream properties from the same probe — drive the compatibility gate
  // (-c copy concat needs matching streams; mismatches glitch at the joins).
  codec: string | null
  width: number | null
  height: number | null
  fps: number | null
  /** Audio layout (codec/channels/sampleRate per track). null = not yet
   *  probed. Layout drift between OBS sessions (track count, AAC↔Opus) is
   *  just as fatal to a copy-concat as a codec change — and used to pass
   *  the old advisory silently, which only compared video streams. */
  audioTracks: { codec: string; channels: number; sampleRate?: number }[] | null
}

interface PendingFiles {
  paths: string[]
  token: number
  stream?: { folderPath: string; label: string; date?: string }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDur(sec: number): string {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

function parseTimestamp(filename: string): Date | null {
  const m = filename.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2})-(\d{2})-(\d{2})/)
  if (!m) return null
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])
}

function defaultOutputPath(files: CombineFile[]): string {
  if (files.length === 0) return ''
  const dir = files[0].path.replace(/[\\/][^\\/]+$/, '')
  const folderName = dir.split(/[\\/]/).pop() ?? 'combined'
  return `${dir}/${folderName} combined.mkv`.replace(/\\/g, '/')
}

/** First non-existing variant of `p`: the path itself, else `…_2.ext`, `…_3.ext`, …
 *  Keeps a re-combined folder's default name from colliding with the previous
 *  output (main refuses to overwrite, so a colliding default would just error). */
async function uniquifyPath(p: string): Promise<string> {
  if (!p) return p
  const exists = (c: string) => window.api.fileExists(c).catch(() => false)
  if (!(await exists(p))) return p
  const m = p.match(/^(.*?)(\.[^.\\/]+)$/)
  const base = m ? m[1] : p
  const ext = m ? m[2] : ''
  for (let n = 2; n < 100; n++) {
    const candidate = `${base}_${n}${ext}`
    if (!(await exists(candidate))) return candidate
  }
  return p
}

/** An output of a previous combine run (by this page's own naming scheme).
 *  Combine All sends folder.videos verbatim, which includes prior combined
 *  files — feeding one back in duplicates its content in the new output. */
function isCombinedOutput(name: string): boolean {
  return /\bcombined(_\d+)?\.[^.]+$/i.test(name)
}

/** Drag payload type for row reordering — a dedicated MIME so the handlers
 *  never react to other drags (OS file drops, palette swatches, …). */
const ROW_REORDER_MIME = 'application/x-sm-combine-row'

// ─── Page ─────────────────────────────────────────────────────────────────────

export function CombinePage({ initialFiles, onNavigateToStream }: {
  initialFiles?: PendingFiles | null
  /** Open a stream's detail sidebar on the streams page — the rows' stream
   *  title links (same wiring as the converter's "from stream" link). */
  onNavigateToStream?: (folderPath: string) => void
}) {
  const [files, setFiles] = useState<CombineFile[]>([])
  const [outputPath, setOutputPath] = useState('')
  const [progress, setProgress] = useState<number | null>(null)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deleteAfter, setDeleteAfter] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [cancelledNotice, setCancelledNotice] = useState(false)
  const { setOpen } = useOpenItems()

  // Publish "combine is running" to the nav rail's activity indicator —
  // same treatment the player / converter / thumbnails items get. Keyed on
  // an actual run, not on files merely being listed.
  const { setCombineRunning } = usePageActivity()
  useEffect(() => {
    setCombineRunning(progress !== null)
    return () => setCombineRunning(false)
  }, [progress, setCombineRunning])

  // Drag-reorder state. `dropIndex` is the INSERTION index (0..files.length)
  // shown by the marker line; null = no valid/actionable target.
  const dragIndex = useRef<number | null>(null)
  const [dropIndex, setDropIndex] = useState<number | null>(null)

  // Load files when sent from Streams page
  useEffect(() => {
    if (!initialFiles || initialFiles.paths.length === 0) return

    // Drop prior combined outputs from the incoming list — Combine All sends
    // folder.videos verbatim, so after a previous combine the old output
    // rides along as an input and would duplicate its content in the new
    // file. Only filters the bulk intake by name pattern; the main process
    // separately hard-errors if any input equals the chosen output path.
    const incoming = initialFiles.paths.filter(p => !isCombinedOutput(p.split(/[\\/]/).pop() ?? ''))
    if (incoming.length === 0) return

    const initial: CombineFile[] = incoming.map(p => ({
      path: p,
      name: p.split(/[\\/]/).pop() ?? p,
      duration: null,
      timestamp: parseTimestamp(p.split(/[\\/]/).pop() ?? ''),
      size: null,
      stream: initialFiles.stream,
      codec: null, width: null, height: null, fps: null, audioTracks: null,
    }))

    // Auto-sort by timestamp on initial load
    const sorted = [...initial].sort((a, b) => {
      if (a.timestamp && b.timestamp) return a.timestamp.getTime() - b.timestamp.getTime()
      return a.name.localeCompare(b.name)
    })

    setFiles(sorted)
    // Immediate default so the field is never blank, then swap in the
    // uniquified variant (…_2.mkv) if the default already exists on disk.
    const def = defaultOutputPath(sorted)
    setOutputPath(def)
    void uniquifyPath(def).then(unique => {
      if (unique !== def) setOutputPath(prev => (prev === def ? unique : prev))
    })
    setProgress(null)
    setDone(false)
    setError(null)

    // Sizes in one batched call (keyed by path — the list may have been
    // reordered by the time results land).
    void window.api.getFileSizes(sorted.map(f => f.path)).then(sizes => {
      const byPath = new Map(sorted.map((f, i) => [f.path, sizes[i]]))
      setFiles(prev => prev.map(f => byPath.has(f.path) ? { ...f, size: byPath.get(f.path) ?? null } : f))
    }).catch(() => {})

    // Probe durations + stream properties. Matched by PATH, not index —
    // the user can reorder rows while probes are still in flight.
    sorted.forEach(async f => {
      try {
        const info = await window.api.probeFile(f.path)
        setFiles(prev => prev.map(x => x.path === f.path ? {
          ...x,
          duration: info.duration,
          codec: info.videoCodec ?? null,
          width: info.width ?? null,
          height: info.height ?? null,
          fps: info.fps ?? null,
          audioTracks: (info.audioTracks ?? []).map(t => ({ codec: t.codec, channels: t.channels, sampleRate: t.sampleRate })),
        } : x))
      } catch (_) {}
    })
  }, [initialFiles?.token]) // eslint-disable-line react-hooks/exhaustive-deps

  const autoSort = () => {
    setFiles(prev => [...prev].sort((a, b) => {
      if (a.timestamp && b.timestamp) return a.timestamp.getTime() - b.timestamp.getTime()
      return a.name.localeCompare(b.name)
    }))
  }

  const removeFile = (i: number) => {
    setFiles(prev => {
      const next = prev.filter((_, xi) => xi !== i)
      if (outputPath === defaultOutputPath(prev)) setOutputPath(defaultOutputPath(next))
      return next
    })
  }

  // ── Drag to reorder ────────────────────────────────────────────────────────
  // Same rules as the thumbnail palette's swatch reorder: an insertion
  // marker line anchored INSIDE the row it precedes (so it can't drift from
  // its row), no marker where releasing wouldn't move anything (on/adjacent
  // to the dragged row), and the list container accepts drops in the gaps
  // between rows so the marker's own position is always droppable.

  const onRowDragStart = (e: React.DragEvent, i: number) => {
    dragIndex.current = i
    e.dataTransfer.setData(ROW_REORDER_MIME, '')
    e.dataTransfer.effectAllowed = 'move'
  }
  const onRowDragOver = (e: React.DragEvent, i: number) => {
    if (!e.dataTransfer.types.includes(ROW_REORDER_MIME)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const r = e.currentTarget.getBoundingClientRect()
    const at = e.clientY < r.top + r.height / 2 ? i : i + 1
    const from = dragIndex.current
    // Dropping a row back onto its own position (or the slot right after
    // itself) is a no-op — offer no marker there.
    setDropIndex(from !== null && (at === from || at === from + 1) ? null : at)
  }
  const commitReorder = (at: number) => {
    const from = dragIndex.current
    dragIndex.current = null
    setDropIndex(null)
    if (from === null) return
    setFiles(prev => {
      const next = [...prev]
      const [moved] = next.splice(from, 1)
      next.splice(at - (from < at ? 1 : 0), 0, moved)
      return next
    })
  }
  const onRowDrop = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes(ROW_REORDER_MIME)) return
    e.preventDefault()
    if (dropIndex !== null) commitReorder(dropIndex)
    else { dragIndex.current = null; setDropIndex(null) }
  }
  const onDragEnd = () => { dragIndex.current = null; setDropIndex(null) }

  // ── Combine ────────────────────────────────────────────────────────────────

  const browseOutput = async () => {
    const result = await window.api.openFileDialog({
      defaultPath: outputPath || undefined,
      filters: [{ name: 'Video', extensions: ['mkv', 'mp4', 'mov'] }],
      properties: ['showHiddenFiles'] as any
    })
    if (result && result[0]) setOutputPath(result[0])
  }

  // Compatibility gate. A -c copy concat adapts NOTHING — mismatched video
  // codec, resolution, or audio layout produces a structurally broken file
  // (undecodable second half, scrambled track mapping), so those BLOCK the
  // run with a red explanation. Frame-rate drift alone stays an amber
  // advisory: the output is just variable-framerate and generally plays.
  const probed = files.filter(f => f.codec !== null)
  const audioSig = (f: CombineFile) =>
    (f.audioTracks ?? []).map(t => `${t.codec} ${t.channels}ch${t.sampleRate ? ' @' + t.sampleRate + 'Hz' : ''}`).join(' + ') || 'no audio'
  const fpsVal = (f: CombineFile) => f.fps == null ? 'unknown' : `${Math.round(f.fps * 100) / 100} fps`
  // Hard-blocking properties as DATA (label + per-file value), shared by the
  // gate's comparison table and the rows' red mismatch highlighting.
  const HARD_PROPS: { label: string; val: (f: CombineFile) => string }[] = [
    { label: 'Video codec', val: f => f.codec ?? 'unknown' },
    { label: 'Resolution', val: f => `${f.width ?? '?'}×${f.height ?? '?'}` },
    { label: 'Audio', val: audioSig },
  ]
  const mismatchedProps = probed.length >= 2
    ? HARD_PROPS.filter(p => new Set(probed.map(p.val)).size > 1)
    : []
  const codecMismatch = mismatchedProps.some(p => p.label === 'Video codec')
  const resMismatch = mismatchedProps.some(p => p.label === 'Resolution')
  const audioMismatch = mismatchedProps.some(p => p.label === 'Audio')
  // Frame-rate drift alone stays advisory (VFR output, plays fine).
  const fpsMismatch = probed.length >= 2 && new Set(probed.map(fpsVal)).size > 1

  const combine = useCallback(async () => {
    if (files.length < 2 || !outputPath) return
    // Belt to the disabled button's suspenders — a copy-concat of
    // incompatible streams writes a broken file, never run one.
    if (mismatchedProps.length > 0) return
    setProgress(0)
    setDone(false)
    setError(null)
    setCancelling(false)
    setCancelledNotice(false)

    const unsub = window.api.onCombineProgress(({ percent }) => setProgress(percent))
    const totalDur = files.reduce((s, f) => s + (f.duration ?? 0), 0)
    const sourcePaths = files.map(f => f.path)
    // Claim the sources for the run: the streams page's delete guards
    // consult open-items, so files being concatenated can't be trashed
    // out from under ffmpeg.
    setOpen('combine', sourcePaths)

    try {
      await window.api.combineFiles(sourcePaths, outputPath, totalDur)
      if (deleteAfter) {
        // Sources are only removed once the output PROVES itself: readable,
        // and duration within tolerance of the summed inputs. A -c copy
        // concat can exit 0 with a broken file when streams mismatch, and
        // exit 0 used to permanently unlink every source anyway. Removal is
        // recycle-bin (trash), not permanent — the duration check can't
        // catch every subtle glitch at the joins, so keep an undo path.
        let verifyProblem = ''
        if (totalDur <= 0) {
          verifyProblem = 'the input durations were still loading, so the output could not be verified'
        } else {
          try {
            const outInfo = await window.api.probeFile(outputPath)
            const outDur = outInfo.duration ?? 0
            const tolerance = Math.max(5, totalDur * 0.02)
            if (Math.abs(outDur - totalDur) > tolerance) {
              verifyProblem = `its duration is ${formatDur(outDur)} but the inputs total ${formatDur(totalDur)}`
            }
          } catch {
            verifyProblem = 'the combined file could not be read back'
          }
        }
        if (verifyProblem) {
          setError(`Combined, but the source files were NOT deleted: ${verifyProblem}. Check the output before removing them manually.`)
        } else {
          const results = await Promise.allSettled(sourcePaths.map(p => window.api.trashFile(p)))
          const failed = results.filter(r => r.status === 'rejected').length
          if (failed > 0) {
            setError(`Output verified, but ${failed} of ${sourcePaths.length} source files could not be moved to the recycle bin (probably in use). They are still in the folder.`)
          } else {
            setFiles([])
          }
        }
      }
      setDone(true)
    } catch (e: any) {
      if (e?.message?.includes('cancelled')) {
        setCancelledNotice(true) // partial output already removed by main
      } else {
        setError(e.message)
      }
    } finally {
      unsub()
      setProgress(null)
      setCancelling(false)
      setOpen('combine', [])
    }
  }, [files, outputPath, deleteAfter, setOpen, mismatchedProps])

  // ── Empty state ────────────────────────────────────────────────────────────

  if (files.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
        <div className="p-4 rounded-full bg-white/5">
          <Combine size={36} className="text-gray-400" />
        </div>
        <div>
          <p className="text-gray-300 font-medium">No files loaded</p>
          <p className="text-sm text-gray-400 mt-1">
            Use the <Film size={12} className="inline mb-0.5" /> button on a stream row with multiple videos.
          </p>
        </div>
      </div>
    )
  }

  const totalDur = files.reduce((s, f) => s + (f.duration ?? 0), 0)
  const running = progress !== null

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-white/5 shrink-0">
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-semibold">Combine</h1>
          <p className="text-xs text-gray-400 mt-0.5">
            {files.length} files · {totalDur > 0 ? formatDur(totalDur) + ' total' : 'probing…'}
          </p>
        </div>
        <Tooltip content="Reorder by recording start time (parsed from the filenames), oldest first — files without a timestamp sort by name">
          <Button variant="ghost" size="sm" icon={<Wand2 size={14} />} onClick={autoSort} disabled={running}>
            Auto-sort
          </Button>
        </Tooltip>
      </div>

      {/* File list */}
      <div className="flex-1 overflow-hidden pr-2"><div className="h-full overflow-y-auto px-6 py-4">
        <div
          className="flex flex-col gap-1.5"
          // The gaps BETWEEN rows belong to this container — without these
          // handlers the browser shows the no-drop cursor exactly where the
          // insertion marker is drawn. Rows preventDefault first and bubble
          // up, so defaultPrevented distinguishes "over a row" from "over a
          // gap". dragENTER must be canceled too or the cursor flashes
          // no-drop at every element boundary.
          onDragEnter={e => {
            if (e.dataTransfer.types.includes(ROW_REORDER_MIME)) e.preventDefault()
          }}
          onDragOver={e => {
            if (e.defaultPrevented) return
            if (!e.dataTransfer.types.includes(ROW_REORDER_MIME)) return
            e.preventDefault()
            e.dataTransfer.dropEffect = 'move'
          }}
          onDrop={e => {
            if (e.defaultPrevented) return
            if (!e.dataTransfer.types.includes(ROW_REORDER_MIME)) return
            e.preventDefault()
            if (dropIndex !== null) commitReorder(dropIndex)
          }}
        >
          {files.map((f, i) => (
            <div
              key={f.path}
              draggable={!running}
              onDragStart={e => onRowDragStart(e, i)}
              onDragOver={e => onRowDragOver(e, i)}
              onDrop={onRowDrop}
              onDragEnd={onDragEnd}
              className={`relative flex items-center gap-3 px-3 py-2 rounded-lg border border-white/5 bg-white/[0.03] hover:bg-white/[0.06] transition-all select-none ${
                running ? 'opacity-50 pointer-events-none' : 'cursor-grab active:cursor-grabbing'
              }`}
            >
              {/* Insertion marker — anchored INSIDE the row it precedes,
                  centered in the 6px flex gap (offsets measured from the
                  padding box, 1px inside the row border — hence 5px). */}
              {dropIndex === i && (
                <span className="pointer-events-none absolute -top-[5px] left-0 right-0 h-0.5 rounded bg-purple-500" />
              )}
              {dropIndex === files.length && i === files.length - 1 && (
                <span className="pointer-events-none absolute -bottom-[5px] left-0 right-0 h-0.5 rounded bg-purple-500" />
              )}
              <GripVertical size={14} className="text-gray-400 shrink-0" />

              {/* Order number */}
              <span className="text-xs text-gray-400 font-mono w-5 text-right shrink-0">{i + 1}</span>

              {/* Thumbnail — converter-row treatment (the design reference
                  for this page): frame preview at the row's left edge. */}
              <div className="self-center shrink-0">
                <VideoThumb path={f.path} height={44} />
              </div>

              {/* Info column: filename, stream link, encoding/file chips */}
              <div className="flex-1 min-w-0 flex flex-col justify-center gap-0.5">
                <Tooltip content={f.path} maxWidth="max-w-md" triggerClassName="block w-fit max-w-full min-w-0">
                  <span className="block text-sm text-gray-200 truncate font-mono">
                    {f.name}
                  </span>
                </Tooltip>
                {/* Owning stream item (only for files sent from a stream).
                    Opens its detail sidebar on the streams page. */}
                {f.stream && (
                  <Tooltip content={`Open “${f.stream.label}” on the streams page`} side="top" triggerClassName="block w-fit max-w-full min-w-0">
                    <button
                      type="button"
                      onClick={() => onNavigateToStream?.(f.stream!.folderPath)}
                      className="block max-w-full truncate text-[11px] text-purple-300/90 hover:text-purple-200 hover:underline transition-colors"
                    >
                      {f.stream.label}{f.stream.date ? ` · ${f.stream.date}` : ''}
                    </button>
                  </Tooltip>
                )}
                {/* Encoding + file details; individual segments appear as
                    their probe/size lookups land. Segments whose property
                    DIFFERS across the list turn red (amber for frame rate,
                    which is only advisory) — the row-level view of what the
                    compatibility gate is complaining about. */}
                {(() => {
                  if (f.codec === null && f.size === null) {
                    return <span className="text-[11px] text-gray-400"><Loader2 size={10} className="animate-spin inline" /></span>
                  }
                  const segs: { text: string; cls?: string }[] = []
                  if (f.codec) segs.push({ text: f.codec, cls: codecMismatch ? 'text-red-400' : undefined })
                  if (f.width != null && f.height != null) segs.push({ text: `${f.width}×${f.height}`, cls: resMismatch ? 'text-red-400' : undefined })
                  if (f.fps != null) segs.push({ text: `${Math.round(f.fps * 100) / 100} fps`, cls: fpsMismatch ? 'text-amber-300' : undefined })
                  if (f.audioTracks !== null) segs.push({ text: audioSig(f), cls: audioMismatch ? 'text-red-400' : undefined })
                  if (f.size != null) segs.push({ text: formatBytes(f.size) })
                  const full = segs.map(s => s.text).join(' · ')
                  return (
                    <Tooltip content={full} maxWidth="max-w-md" triggerClassName="block w-fit max-w-full min-w-0">
                      <span className="block text-[11px] text-gray-400 truncate tabular-nums">
                        {segs.map((s, k) => (
                          <React.Fragment key={k}>
                            {k > 0 && ' · '}
                            <span className={s.cls}>{s.text}</span>
                          </React.Fragment>
                        ))}
                      </span>
                    </Tooltip>
                  )
                })()}
              </div>

              {/* Labeled time columns — an unlabeled clock next to an
                  unlabeled duration read as two mystery numbers. */}
              {f.timestamp && (
                <Tooltip content="Recording start time, parsed from the filename — this is the order Auto-sort uses" side="top" triggerClassName="shrink-0">
                  <div className="flex flex-col items-end">
                    <span className="text-[9px] uppercase tracking-wider text-gray-400">Started</span>
                    <span className="text-xs text-gray-400 tabular-nums">
                      {f.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </span>
                  </div>
                </Tooltip>
              )}
              <div className="flex flex-col items-end w-16 shrink-0">
                <span className="text-[9px] uppercase tracking-wider text-gray-400">Duration</span>
                <span className="text-xs text-gray-400 font-mono">
                  {f.duration !== null ? formatDur(f.duration) : <Loader2 size={11} className="animate-spin inline" />}
                </span>
              </div>

              {/* Remove */}
              <button
                onClick={() => removeFile(i)}
                className="text-gray-400 hover:text-red-400 transition-colors shrink-0"
              >
                <X size={13} />
              </button>
            </div>
          ))}
        </div>
      </div></div>

      {/* Footer */}
      <div className="px-6 py-4 border-t border-white/5 flex flex-col gap-3 shrink-0 bg-navy-800/50">
        {/* Output path */}
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-400 shrink-0">Output</label>
          <input
            value={outputPath}
            onChange={e => setOutputPath(e.target.value)}
            disabled={running}
            className="flex-1 bg-navy-900 border border-white/10 text-gray-200 text-xs font-mono rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500/50 disabled:opacity-50"
          />
          <Button variant="ghost" size="sm" icon={<FolderOpen size={13} />} onClick={browseOutput} disabled={running} />
        </div>

        {/* Progress bar */}
        {running && (
          <div className="flex items-center gap-3">
            <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
              <div
                className="h-full bg-purple-500 rounded-full transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
            <span className="text-xs text-gray-400 font-mono w-10 text-right">{progress}%</span>
            <Tooltip content="Cancel — removes the partial output; sources are untouched">
              <Button
                variant="danger"
                size="sm"
                icon={<X size={12} />}
                disabled={cancelling}
                onClick={() => { setCancelling(true); void window.api.cancelCombine() }}
              >
                {cancelling ? 'Cancelling…' : 'Cancel'}
              </Button>
            </Tooltip>
          </div>
        )}

        {cancelledNotice && (
          <div className="flex items-center gap-2 text-sm text-gray-400">
            <X size={14} />
            Combine cancelled — the partial output file was removed; the source files are untouched.
          </div>
        )}

        {/* Compatibility gate — red blocks the run (the output would be a
            broken file), amber warns but allows (VFR output plays fine). */}
        {mismatchedProps.length > 0 && !running && (
          <div className="flex items-start gap-2 text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
            <AlertCircle size={13} className="shrink-0 mt-0.5" />
            <div className="flex flex-col gap-1.5 min-w-0 flex-1">
              <span className="font-medium">These files can't be combined without re-encoding: combining copies the streams as-is, and these differences would produce a broken output.</span>
              {/* One row per file, one column per DIFFERING property — far
                  easier to scan than prose grouping. */}
              <div className="overflow-x-auto">
                <table className="text-[11px] w-full border-collapse">
                  <thead>
                    <tr className="text-left text-red-200/70">
                      <th className="pr-4 py-0.5 font-medium">File</th>
                      {mismatchedProps.map(p => (
                        <th key={p.label} className="pr-4 py-0.5 font-medium whitespace-nowrap">{p.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="font-mono text-red-200/90">
                    {probed.map(f => (
                      <tr key={f.path} className="border-t border-red-500/20">
                        <td className="pr-4 py-0.5">
                          <Tooltip content={f.name} maxWidth="max-w-md" triggerClassName="block max-w-[260px] min-w-0">
                            <span className="block truncate">{f.name}</span>
                          </Tooltip>
                        </td>
                        {mismatchedProps.map(p => (
                          <td key={p.label} className="pr-4 py-0.5 whitespace-nowrap">{p.val(f)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <span className="text-red-200/80">Convert the odd files out with the Converter first (same preset for all), then combine the results.</span>
            </div>
          </div>
        )}
        {mismatchedProps.length === 0 && fpsMismatch && !running && !done && (
          <div className="flex items-start gap-2 text-xs text-amber-200 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
            <AlertTriangle size={13} className="shrink-0 mt-0.5" />
            <span>
              The files have different frame rates ({[...new Set(probed.map(fpsVal))].join(', ')}). The combined file will simply switch frame rate at the joins (variable frame rate); most players handle this fine, but some editors dislike VFR input. Convert to a matching frame rate first if that matters.
            </span>
          </div>
        )}

        {/* Status messages */}
        {done && (
          <div className="flex items-center gap-2 text-sm text-green-400">
            <CheckCircle2 size={14} />
            <span className="flex-1 truncate">
              Combined successfully — <span className="font-mono text-xs">{outputPath}</span>
            </span>
            <Tooltip content="Open folder">
              <button
                onClick={() => window.api.openInExplorer(outputPath)}
                className="shrink-0 p-1 rounded hover:bg-white/10 text-green-400 hover:text-green-300 transition-colors"
              >
                <FolderSearch size={14} />
              </button>
            </Tooltip>
          </div>
        )}
        {error && (
          <div className="flex items-center gap-2 text-sm text-red-400">
            <AlertCircle size={14} />
            {error}
          </div>
        )}

        {/* Delete source files option + combine button */}
        <div className="flex items-center justify-between">
          <Checkbox
            checked={deleteAfter}
            onChange={setDeleteAfter}
            disabled={running}
            color="red"
            size="sm"
            label={<span className={deleteAfter ? 'text-red-400' : 'text-gray-400'}>Delete source files after combining</span>}
          />
          <Button
            variant="primary"
            icon={running ? <Loader2 size={14} className="animate-spin" /> : <Combine size={14} />}
            onClick={combine}
            disabled={files.length < 2 || !outputPath || running || mismatchedProps.length > 0}
          >
            {running ? 'Combining…' : `Combine ${files.length} files`}
          </Button>
        </div>
      </div>
    </div>
  )
}
