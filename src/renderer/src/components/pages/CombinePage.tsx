import React, { useState, useEffect, useCallback, useRef } from 'react'
import {
  GripVertical, Film, FolderOpen, Wand2, Combine,
  CheckCircle2, AlertCircle, AlertTriangle, Loader2, X, FolderSearch
} from 'lucide-react'
import { Button } from '../ui/Button'
import { Checkbox } from '../ui/Checkbox'
import { Tooltip } from '../ui/Tooltip'

// ─── Types ────────────────────────────────────────────────────────────────────

interface CombineFile {
  path: string
  name: string
  duration: number | null   // seconds, null = not yet probed
  timestamp: Date | null    // parsed from filename
  // Stream properties from the same probe — drive the compatibility warning
  // (-c copy concat needs matching streams; mismatches glitch at the joins).
  codec: string | null
  width: number | null
  height: number | null
  fps: number | null
}

interface PendingFiles { paths: string[]; token: number }

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDur(sec: number): string {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
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

// ─── Page ─────────────────────────────────────────────────────────────────────

export function CombinePage({ initialFiles }: { initialFiles?: PendingFiles | null }) {
  const [files, setFiles] = useState<CombineFile[]>([])
  const [outputPath, setOutputPath] = useState('')
  const [progress, setProgress] = useState<number | null>(null)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deleteAfter, setDeleteAfter] = useState(false)

  // Drag state
  const dragIndex = useRef<number | null>(null)
  const [dragOver, setDragOver] = useState<number | null>(null)

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
      codec: null, width: null, height: null, fps: null,
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

    // Probe durations + stream properties
    sorted.forEach(async (f, i) => {
      try {
        const info = await window.api.probeFile(f.path)
        setFiles(prev => prev.map((x, xi) => xi === i ? {
          ...x,
          duration: info.duration,
          codec: info.videoCodec ?? null,
          width: info.width ?? null,
          height: info.height ?? null,
          fps: info.fps ?? null,
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

  const onDragStart = (i: number) => { dragIndex.current = i }
  const onDragOver = (e: React.DragEvent, i: number) => { e.preventDefault(); setDragOver(i) }
  const onDrop = (i: number) => {
    const from = dragIndex.current
    if (from === null || from === i) { setDragOver(null); return }
    setFiles(prev => {
      const next = [...prev]
      const [moved] = next.splice(from, 1)
      next.splice(i, 0, moved)
      return next
    })
    dragIndex.current = null
    setDragOver(null)
  }
  const onDragEnd = () => { dragIndex.current = null; setDragOver(null) }

  // ── Combine ────────────────────────────────────────────────────────────────

  const browseOutput = async () => {
    const result = await window.api.openFileDialog({
      defaultPath: outputPath || undefined,
      filters: [{ name: 'Video', extensions: ['mkv', 'mp4', 'mov'] }],
      properties: ['showHiddenFiles'] as any
    })
    if (result && result[0]) setOutputPath(result[0])
  }

  const combine = useCallback(async () => {
    if (files.length < 2 || !outputPath) return
    setProgress(0)
    setDone(false)
    setError(null)

    const unsub = window.api.onCombineProgress(({ percent }) => setProgress(percent))
    const totalDur = files.reduce((s, f) => s + (f.duration ?? 0), 0)
    const sourcePaths = files.map(f => f.path)

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
      setError(e.message)
    } finally {
      unsub()
      setProgress(null)
    }
  }, [files, outputPath, deleteAfter])

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

  // Advisory only — some mismatches survive a stream copy, and the
  // delete-sources path is separately gated on output verification.
  const streamKey = (f: CombineFile) =>
    `${f.codec ?? ''}|${f.width ?? ''}x${f.height ?? ''}|${f.fps == null ? '' : Math.round(f.fps * 100) / 100}`
  const probed = files.filter(f => f.codec !== null)
  const streamsMismatch = probed.length >= 2 && probed.some(f => streamKey(f) !== streamKey(probed[0]))

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
        <Button variant="ghost" size="sm" icon={<Wand2 size={14} />} onClick={autoSort} disabled={running}>
          Auto-sort
        </Button>
      </div>

      {/* File list */}
      <div className="flex-1 overflow-hidden pr-2"><div className="h-full overflow-y-auto px-6 py-4">
        <div className="flex flex-col gap-1.5">
          {files.map((f, i) => (
            <div
              key={f.path}
              draggable
              onDragStart={() => onDragStart(i)}
              onDragOver={e => onDragOver(e, i)}
              onDrop={() => onDrop(i)}
              onDragEnd={onDragEnd}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-all select-none ${
                dragOver === i
                  ? 'border-purple-500/60 bg-purple-900/20'
                  : 'border-white/5 bg-white/[0.03] hover:bg-white/[0.06]'
              } ${running ? 'opacity-50 pointer-events-none' : 'cursor-grab active:cursor-grabbing'}`}
            >
              <GripVertical size={14} className="text-gray-400 shrink-0" />

              {/* Order number */}
              <span className="text-xs text-gray-400 font-mono w-5 text-right shrink-0">{i + 1}</span>

              {/* Filename */}
              <Tooltip content={f.path} maxWidth="max-w-md" triggerClassName="flex-1 min-w-0">
                <span className="block text-sm text-gray-200 truncate font-mono">
                  {f.name}
                </span>
              </Tooltip>

              {/* Timestamp */}
              {f.timestamp && (
                <span className="text-xs text-gray-400 shrink-0 tabular-nums">
                  {f.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
              )}

              {/* Duration */}
              <span className="text-xs text-gray-400 font-mono w-16 text-right shrink-0">
                {f.duration !== null ? formatDur(f.duration) : <Loader2 size={11} className="animate-spin inline" />}
              </span>

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
          </div>
        )}

        {/* Stream-compatibility advisory */}
        {streamsMismatch && !running && !done && (
          <div className="flex items-start gap-2 text-xs text-amber-200 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
            <AlertTriangle size={13} className="shrink-0 mt-0.5" />
            <span>
              These files have different video streams (codec, resolution, or frame rate). Combining copies the streams without re-encoding, so the output may glitch or freeze at the joins. For a reliable result, convert the files to a matching format first.
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
            disabled={files.length < 2 || !outputPath || running}
          >
            {running ? 'Combining…' : `Combine ${files.length} files`}
          </Button>
        </div>
      </div>
    </div>
  )
}
