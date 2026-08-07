import React, { useState, useEffect, useCallback, useRef } from 'react'
import {
  GripVertical, Film, FolderOpen, Wand2, Combine,
  CheckCircle2, AlertCircle, AlertTriangle, Loader2, Trash2,
  RefreshCw, Pause, Play, Ban, X
} from 'lucide-react'
import { Button } from '../ui/Button'
import { Checkbox } from '../ui/Checkbox'
import { Tooltip } from '../ui/Tooltip'
import { VideoThumb } from '../ui/VideoThumb'
import { FileDropZone } from '../ui/FileDropZone'
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
   *  row's title link and the group's orphan warning. Tagged PER FILE (not
   *  on the group) so cross-group moves keep their provenance. */
  stream?: { folderPath: string; label: string; date?: string }
  /** True once "delete source files" trashed THIS file after a successful
   *  combine — the row stays visible, grayed with a struck filename.
   *  Per-file (not per-run) so a partial trash failure shows honestly. */
  deleted?: boolean
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

/** One combine JOB: its own file set, output, options, and lifecycle.
 *  Stream sends group by stream item; external drops make their own group.
 *  Only one group RUNS at a time (the combine IPC is single-run), tracked
 *  page-level in `runState`. */
interface CombineGroup {
  id: number
  /** Generating stream item; undefined for external-drop groups. The
   *  "same as source" output default keeps resolving against THIS even
   *  when foreign files join the group (spec rule). */
  stream?: { folderPath: string; label: string; date?: string }
  /** Header label for external groups (the drop's common folder name). */
  label: string
  files: CombineFile[]
  outputPath: string
  deleteAfter: boolean
  /** The finished run's output — while set, the group's body shows the
   *  converter-style done row instead of file rows + options. */
  completed: { path: string; elapsedMs: number } | null
  error: string | null
  cancelledNotice: boolean
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

function nameOf(p: string): string {
  return p.split(/[\\/]/).pop() ?? p
}

function dirOf(p: string): string {
  return p.replace(/[\\/][^\\/]+$/, '')
}

/** Default output for a group: "same as source". Stream groups resolve
 *  against the GENERATING stream's folder (even when foreign files have
 *  joined — spec rule); external groups against the first file's folder. */
function defaultGroupOutput(stream: CombineGroup['stream'], files: CombineFile[]): string {
  const dir = stream ? stream.folderPath.replace(/\\/g, '/') : (files.length > 0 ? dirOf(files[0].path) : '')
  if (!dir) return ''
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
 *  Stream sends pass folder.videos verbatim, which includes prior combined
 *  files — feeding one back in duplicates its content in the new output. */
function isCombinedOutput(name: string): boolean {
  return /\bcombined(_\d+)?\.[^.]+$/i.test(name)
}

/** Drag payload type for row reordering — a dedicated MIME so the handlers
 *  never react to other drags (OS file drops, palette swatches, …). */
const ROW_REORDER_MIME = 'application/x-sm-combine-row'

/** Same container set the converter accepts. FileDropZone's browse dialog
 *  filters by these; dropped paths are re-filtered in the intake handlers
 *  (drops bypass the dialog). */
const VIDEO_EXTS = ['mkv', 'mp4', 'mov', 'avi', 'ts', 'flv', 'webm']

// Row action buttons — neutral at rest, colored only on hover. Mirrors the
// converter's ROW_ACTION_* scheme so the in-progress controls match.
const ROW_ACTION_BASE = 'inline-flex shrink-0 min-w-max items-center gap-1.5 px-2 py-1.5 rounded-md text-[11px] text-gray-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-gray-400'
const ROW_ACTION_RED = `${ROW_ACTION_BASE} hover:text-red-400 hover:bg-red-500/10`
const ROW_ACTION_YELLOW = `${ROW_ACTION_BASE} hover:text-yellow-400 hover:bg-yellow-500/10`
const ROW_ACTION_BLUE = `${ROW_ACTION_BASE} hover:text-blue-400 hover:bg-blue-500/10`

function makeCombineFile(p: string, stream?: CombineFile['stream']): CombineFile {
  const name = nameOf(p)
  return {
    path: p,
    name,
    duration: null,
    timestamp: parseTimestamp(name),
    size: null,
    stream,
    codec: null, width: null, height: null, fps: null, audioTracks: null,
  }
}

// ── Compatibility gate ────────────────────────────────────────────────────────
// A -c copy concat adapts NOTHING — mismatched video codec, resolution, or
// audio layout produces a structurally broken file (undecodable second half,
// scrambled track mapping), so those BLOCK the run. Frame-rate drift alone
// stays an amber advisory: the output is just variable-framerate and
// generally plays. Computed per GROUP: compatibility only matters within
// one combine set.

const audioSig = (f: CombineFile) =>
  (f.audioTracks ?? []).map(t => `${t.codec} ${t.channels}ch${t.sampleRate ? ' @' + t.sampleRate + 'Hz' : ''}`).join(' + ') || 'no audio'
const fpsVal = (f: CombineFile) => f.fps == null ? 'unknown' : `${Math.round(f.fps * 100) / 100} fps`

/** Hard-blocking properties as DATA (label + per-file value), shared by the
 *  gate's comparison table and the rows' red mismatch highlighting. */
const HARD_PROPS: { label: string; val: (f: CombineFile) => string }[] = [
  { label: 'Video codec', val: f => f.codec ?? 'unknown' },
  { label: 'Resolution', val: f => `${f.width ?? '?'}×${f.height ?? '?'}` },
  { label: 'Audio', val: audioSig },
]

function computeCompat(files: CombineFile[]) {
  const probed = files.filter(f => f.codec !== null)
  const mismatchedProps = probed.length >= 2
    ? HARD_PROPS.filter(p => new Set(probed.map(p.val)).size > 1)
    : []
  return {
    probed,
    mismatchedProps,
    codecMismatch: mismatchedProps.some(p => p.label === 'Video codec'),
    resMismatch: mismatchedProps.some(p => p.label === 'Resolution'),
    audioMismatch: mismatchedProps.some(p => p.label === 'Audio'),
    fpsMismatch: probed.length >= 2 && new Set(probed.map(fpsVal)).size > 1,
  }
}

// ─── Completed row ────────────────────────────────────────────────────────────

/** The finished output as ONE done row where the group's source rows were —
 *  the converter's done-job anatomy (thumb / check + name + metadata /
 *  stream link / progress bar / stats line / divider / actions); only the
 *  content differs: a single output name instead of source → output, and
 *  the output's real metadata where the converter shows its preset. */
function CompletedRow({ path, elapsedMs, stream, onNavigateToStream }: {
  path: string
  elapsedMs: number
  stream?: { folderPath: string; label: string; date?: string }
  onNavigateToStream?: (folderPath: string) => void
}) {
  const [outInfo, setOutInfo] = useState<{
    duration?: number | null; codec?: string | null; width?: number | null
    height?: number | null; fps?: number | null; size?: number | null
  } | null>(null)
  useEffect(() => {
    let cancelled = false
    void window.api.probeFile(path).then(info => {
      if (cancelled) return
      setOutInfo(prev => ({
        ...(prev ?? {}),
        duration: info.duration,
        codec: info.videoCodec ?? null,
        width: info.width ?? null,
        height: info.height ?? null,
        fps: info.fps ?? null,
      }))
    }).catch(() => {})
    void window.api.getFileSizes([path]).then(([s]) => {
      if (!cancelled) setOutInfo(prev => ({ ...(prev ?? {}), size: s ?? null }))
    }).catch(() => {})
    return () => { cancelled = true }
  }, [path])

  const outDir = dirOf(path)
  const chips = [
    outInfo?.codec ?? undefined,
    outInfo?.width != null && outInfo?.height != null ? `${outInfo.width}×${outInfo.height}` : undefined,
    outInfo?.fps != null ? `${Math.round(outInfo.fps * 100) / 100} fps` : undefined,
    outInfo?.duration != null ? formatDur(outInfo.duration) : undefined,
    outInfo?.size != null ? formatBytes(outInfo.size) : undefined,
  ].filter(Boolean).join(' · ')

  return (
    <div className="flex items-stretch gap-3 px-4 py-3">
      {/* Thumbnail — pulled toward the left/top/bottom edges, keeps the
          gap to the right content (converter row treatment). */}
      <div className="self-center shrink-0 -my-1 -ms-2">
        <VideoThumb path={path} />
      </div>
      {/* Left: all content */}
      <div className="flex-1 min-w-0 flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <CheckCircle2 size={14} className="text-green-400 shrink-0" />
          <Tooltip content={path} maxWidth="max-w-md" triggerClassName="flex-1 min-w-0">
            <span className="block text-xs text-gray-200 truncate">{nameOf(path)}</span>
          </Tooltip>
          {/* Output metadata where the converter shows its preset. */}
          <span className="text-xs text-gray-400 shrink-0 tabular-nums">
            {chips || <Loader2 size={11} className="animate-spin inline" />}
          </span>
        </div>
        {stream && (
          <Tooltip content={`Open “${stream.label}” on the streams page`} side="top" triggerClassName="block w-fit max-w-full min-w-0">
            <button
              type="button"
              onClick={() => onNavigateToStream?.(stream.folderPath)}
              className="block max-w-full truncate text-[11px] text-purple-300/90 hover:text-purple-200 hover:underline transition-colors"
            >
              {stream.label}
            </button>
          </Tooltip>
        )}
        <div className="h-1 w-full bg-white/10 rounded-full overflow-hidden">
          <div className="h-full rounded-full bg-green-500 w-full" />
        </div>
        <div className="flex items-center gap-3 text-xs text-gray-400 tabular-nums">
          <span>100%</span>
          <span>Elapsed: {formatDur(elapsedMs / 1000)}</span>
          <Tooltip content="Open output folder" side="top">
            <button
              onClick={() => window.api.openInExplorer(outDir)}
              className="ml-auto min-w-0 text-gray-400 hover:text-gray-300 transition-colors truncate"
            >
              {outDir}
            </button>
          </Tooltip>
        </div>
      </div>
      {/* No per-row actions: there's exactly one output per job, so the
          job header's Clear job covers it. */}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function CombinePage({ initialFiles, onNavigateToStream }: {
  initialFiles?: PendingFiles | null
  /** Open a stream's detail sidebar on the streams page — the rows' stream
   *  title links (same wiring as the converter's "from stream" link). */
  onNavigateToStream?: (folderPath: string) => void
}) {
  const [groups, setGroups] = useState<CombineGroup[]>([])
  const groupIdRef = useRef(1)
  // The single active run (the combine IPC is single-run: one progress
  // channel, one pause, one cancel) — other groups' Combine buttons wait
  // their turn. Progress lives in ITS OWN state: it ticks ~2×/second, and
  // keeping it out of runState stops those ticks from resetting the
  // elapsed timer's effect below.
  const [runState, setRunState] = useState<{ groupId: number; paused: boolean } | null>(null)
  const [runProgress, setRunProgress] = useState(0)
  const [cancelling, setCancelling] = useState(false)
  // Elapsed CONVERSION time — accumulates only while not paused (matches
  // the converter's clock). The ref mirrors the state so the completion
  // handler can read the final value without a stale closure.
  const [elapsedMs, setElapsedMs] = useState(0)
  const elapsedRef = useRef(0)
  useEffect(() => {
    if (!runState || runState.paused) return
    const t = setInterval(() => {
      elapsedRef.current += 1000
      setElapsedMs(elapsedRef.current)
    }, 1000)
    return () => clearInterval(t)
  }, [runState?.groupId, runState?.paused]) // eslint-disable-line react-hooks/exhaustive-deps
  const { setOpen } = useOpenItems()

  // Publish "combine has content" to the nav rail's activity indicator —
  // same presence semantics as the player (has video) and thumbnails
  // (has canvas). Completed groups count: they're content waiting on the
  // page.
  const { setCombineHasFiles } = usePageActivity()
  useEffect(() => {
    setCombineHasFiles(groups.length > 0)
    return () => setCombineHasFiles(false)
  }, [groups.length, setCombineHasFiles])

  // Drag-reorder state, group-aware. `drop` is the INSERTION index within
  // ONE group (0..files.length); null = no valid/actionable target.
  // Cross-group moves are a later pass — a drag only offers markers inside
  // its own group for now.
  const dragRef = useRef<{ groupId: number; index: number } | null>(null)
  const [drop, setDrop] = useState<{ groupId: number; at: number } | null>(null)

  // Fill in sizes + stream properties for a set of paths, patching rows BY
  // PATH as results land (lists can be reordered / added-to while lookups
  // are in flight). Shared by every intake.
  const probeAndMeasure = useCallback((paths: string[]) => {
    const patchFiles = (patch: (f: CombineFile) => CombineFile) =>
      setGroups(prev => prev.map(g => ({ ...g, files: g.files.map(patch) })))
    void window.api.getFileSizes(paths).then(sizes => {
      const byPath = new Map(paths.map((p, i) => [p, sizes[i]]))
      patchFiles(f => byPath.has(f.path) ? { ...f, size: byPath.get(f.path) ?? null } : f)
    }).catch(() => {})
    paths.forEach(async p => {
      try {
        const info = await window.api.probeFile(p)
        patchFiles(f => f.path === p ? {
          ...f,
          duration: info.duration,
          codec: info.videoCodec ?? null,
          width: info.width ?? null,
          height: info.height ?? null,
          fps: info.fps ?? null,
          audioTracks: (info.audioTracks ?? []).map(t => ({ codec: t.codec, channels: t.channels, sampleRate: t.sampleRate })),
        } : f)
      } catch (_) { /* unreadable file: row keeps its loaders */ }
    })
  }, [])

  /** Set a group's output to its default, then swap in the uniquified
   *  variant (…_2.mkv) if the default already exists on disk. */
  const applyDefaultOutput = useCallback((groupId: number, stream: CombineGroup['stream'], files: CombineFile[]) => {
    const def = defaultGroupOutput(stream, files)
    setGroups(prev => prev.map(g => g.id === groupId ? { ...g, outputPath: def } : g))
    void uniquifyPath(def).then(unique => {
      if (unique === def) return
      setGroups(prev => prev.map(g => (g.id === groupId && g.outputPath === def) ? { ...g, outputPath: unique } : g))
    })
  }, [])

  /** Create a group from files (stream groups from sends, external groups
   *  from drops — labeled by the files' common folder name). */
  const createGroup = useCallback((files: CombineFile[], stream?: CombineGroup['stream']) => {
    const id = groupIdRef.current++
    const label = stream?.label ?? (files.length > 0 ? (dirOf(files[0].path).split(/[\\/]/).pop() ?? 'External files') : 'External files')
    setGroups(prev => [...prev, {
      id, stream, label, files,
      outputPath: defaultGroupOutput(stream, files),
      deleteAfter: false,
      completed: null, error: null, cancelledNotice: false,
    }])
    void uniquifyPath(defaultGroupOutput(stream, files)).then(unique => {
      const def = defaultGroupOutput(stream, files)
      if (unique === def) return
      setGroups(prev => prev.map(g => (g.id === id && g.outputPath === def) ? { ...g, outputPath: unique } : g))
    })
    probeAndMeasure(files.map(f => f.path))
    return id
  }, [probeAndMeasure])

  // Intake from the Streams page. Same stream item → merge into its
  // existing group (dedup by path); otherwise a new group.
  useEffect(() => {
    if (!initialFiles || initialFiles.paths.length === 0) return

    // Drop prior combined outputs from the incoming list — stream sends
    // pass folder.videos verbatim, so after a previous combine the old
    // output rides along as an input and would duplicate its content in
    // the new file. Only filters the bulk intake by name pattern; main
    // separately hard-errors if any input equals the chosen output path.
    const incoming = initialFiles.paths.filter(p => !isCombinedOutput(nameOf(p)))
    if (incoming.length === 0) return

    const stream = initialFiles.stream
    const sorted = incoming.map(p => makeCombineFile(p, stream)).sort((a, b) => {
      if (a.timestamp && b.timestamp) return a.timestamp.getTime() - b.timestamp.getTime()
      return a.name.localeCompare(b.name)
    })

    const existing = stream ? groupsRef.current.find(g => g.stream?.folderPath === stream.folderPath) : undefined
    if (existing) {
      // A COMPLETED job that receives files starts over: its rows were a
      // finished (possibly trashed) set — mixing new files in would make
      // a list that never combines together.
      const base = existing.completed ? [] : existing.files
      const have = new Set(base.map(f => f.path))
      const fresh = sorted.filter(f => !have.has(f.path))
      setGroups(prev => prev.map(g => g.id === existing.id
        ? {
            ...g,
            files: [...base, ...fresh],
            // A finished output / notice describes the PREVIOUS content.
            completed: null, error: null, cancelledNotice: false,
          }
        : g))
      // Refresh the default output unless the user typed their own (a
      // reset job always re-defaults — its old output now exists on disk,
      // so uniquify steps to the _2 variant).
      if (existing.completed || !existing.outputPath || existing.outputPath === defaultGroupOutput(existing.stream, base)) {
        applyDefaultOutput(existing.id, existing.stream, [...base, ...fresh])
      }
      probeAndMeasure(fresh.map(f => f.path))
    } else {
      createGroup(sorted, stream)
    }
  }, [initialFiles?.token]) // eslint-disable-line react-hooks/exhaustive-deps

  // The intake effect reads current groups without depending on them (it
  // must run only on token bumps).
  const groupsRef = useRef(groups)
  groupsRef.current = groups

  // ── Per-group mutations ────────────────────────────────────────────────────

  const patchGroup = useCallback((groupId: number, patch: (g: CombineGroup) => CombineGroup) => {
    setGroups(prev => prev.map(g => g.id === groupId ? patch(g) : g))
  }, [])

  /** Drop/browse intake for EXTERNAL files into an existing group. Appends
   *  (never re-sorts — the user may have hand-ordered the list); dedups by
   *  path; no stream tag. Prior combined outputs are NOT filtered here:
   *  an explicit drop is intentional. */
  const addFilesToGroup = useCallback((groupId: number, paths: string[]) => {
    const group = groupsRef.current.find(g => g.id === groupId)
    if (!group) return
    // Completed job → start over (see the stream-intake note).
    const base = group.completed ? [] : group.files
    const have = new Set(base.map(f => f.path))
    const fresh = paths.filter(p =>
      VIDEO_EXTS.includes((p.split('.').pop() ?? '').toLowerCase()) && !have.has(p))
    if (fresh.length === 0) return
    const added = fresh.map(p => makeCombineFile(p))
    patchGroup(groupId, g => ({
      ...g,
      files: [...base, ...added],
      completed: null, error: null, cancelledNotice: false,
    }))
    if (group.completed || !group.outputPath || group.outputPath === defaultGroupOutput(group.stream, base)) {
      applyDefaultOutput(groupId, group.stream, [...base, ...added])
    }
    probeAndMeasure(fresh)
  }, [patchGroup, applyDefaultOutput, probeAndMeasure])

  /** Page-level intake: every drop starts its own NEW group (a drop is one
   *  intended combine set — files can be dragged between groups after). */
  const addFilesAsNewGroup = useCallback((paths: string[]) => {
    const vids = paths.filter(p => VIDEO_EXTS.includes((p.split('.').pop() ?? '').toLowerCase()))
    if (vids.length === 0) return
    createGroup(vids.map(p => makeCombineFile(p)))
  }, [createGroup])

  const removeFile = useCallback((groupId: number, idx: number) => {
    const group = groupsRef.current.find(g => g.id === groupId)
    if (!group) return
    const next = group.files.filter((_, i) => i !== idx)
    patchGroup(groupId, g => ({ ...g, files: next }))
    if (group.outputPath === defaultGroupOutput(group.stream, group.files)) {
      applyDefaultOutput(groupId, group.stream, next)
    }
  }, [patchGroup, applyDefaultOutput])

  const removeGroup = useCallback((groupId: number) => {
    setGroups(prev => prev.filter(g => g.id !== groupId))
  }, [])

  const autoSortGroup = useCallback((groupId: number) => {
    patchGroup(groupId, g => ({
      ...g,
      files: [...g.files].sort((a, b) => {
        if (a.timestamp && b.timestamp) return a.timestamp.getTime() - b.timestamp.getTime()
        return a.name.localeCompare(b.name)
      }),
    }))
  }, [patchGroup])

  const browseOutput = useCallback(async (groupId: number) => {
    const group = groupsRef.current.find(g => g.id === groupId)
    const result = await window.api.openFileDialog({
      defaultPath: group?.outputPath || undefined,
      filters: [{ name: 'Video', extensions: ['mkv', 'mp4', 'mov'] }],
      properties: ['showHiddenFiles'] as any
    })
    if (result && result[0]) patchGroup(groupId, g => ({ ...g, outputPath: result[0] }))
  }, [patchGroup])

  // ── Drag to reorder / move between jobs ────────────────────────────────────
  // Same rules as the thumbnail palette's swatch reorder: an insertion
  // marker line anchored INSIDE the row it precedes, no marker where
  // releasing wouldn't move anything, and each job's list container
  // accepts drops in the gaps between rows. A drag is welcome in ANY
  // droppable job — dropping in another job MOVES the file there (its
  // stream provenance travels with it, which is what drives the orphan
  // warning when a stream job's own files all leave).

  /** A job accepts dropped rows unless it's a finished record or the one
   *  currently combining. */
  const groupDroppable = (groupId: number) => {
    const g = groupsRef.current.find(x => x.id === groupId)
    return !!g && !g.completed && runState?.groupId !== groupId
  }

  const onRowDragStart = (e: React.DragEvent, groupId: number, i: number) => {
    dragRef.current = { groupId, index: i }
    e.dataTransfer.setData(ROW_REORDER_MIME, '')
    e.dataTransfer.effectAllowed = 'move'
  }
  const onRowDragOver = (e: React.DragEvent, groupId: number, i: number) => {
    if (!e.dataTransfer.types.includes(ROW_REORDER_MIME)) return
    const from = dragRef.current
    if (!from || !groupDroppable(groupId)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const r = e.currentTarget.getBoundingClientRect()
    const at = e.clientY < r.top + r.height / 2 ? i : i + 1
    // Within the SAME job, dropping a row back onto its own position (or
    // the slot right after itself) is a no-op — offer no marker there.
    // Every position in another job is a real move.
    const noop = from.groupId === groupId && (at === from.index || at === from.index + 1)
    setDrop(noop ? null : { groupId, at })
  }
  /** Commit a drop at `at` in `targetGroupId` — a reorder when the drag
   *  started in the same job, a move otherwise. */
  const commitDrop = (targetGroupId: number, at: number) => {
    const from = dragRef.current
    dragRef.current = null
    setDrop(null)
    if (!from) return
    if (from.groupId === targetGroupId) {
      patchGroup(targetGroupId, g => {
        const next = [...g.files]
        const [moved] = next.splice(from.index, 1)
        next.splice(at - (from.index < at ? 1 : 0), 0, moved)
        return { ...g, files: next }
      })
      return
    }
    const source = groupsRef.current.find(g => g.id === from.groupId)
    const target = groupsRef.current.find(g => g.id === targetGroupId)
    const moved = source?.files[from.index]
    if (!source || !target || !moved) return
    // The same path can sit in two jobs (a stream send + an external
    // drop) — moving onto its duplicate would create a double entry.
    if (target.files.some(f => f.path === moved.path)) return
    const sourceNext = source.files.filter((_, i) => i !== from.index)
    const targetNext = [...target.files]
    targetNext.splice(at, 0, moved)
    setGroups(prev => prev.map(g => {
      if (g.id === source.id) return { ...g, files: sourceNext }
      if (g.id === target.id) return { ...g, files: targetNext }
      return g
    }))
    // Both sides' default outputs may derive from their file lists
    // (external jobs key off their first file) — refresh where the user
    // hasn't typed a custom path.
    if (source.outputPath === defaultGroupOutput(source.stream, source.files)) {
      applyDefaultOutput(source.id, source.stream, sourceNext)
    }
    if (!target.outputPath || target.outputPath === defaultGroupOutput(target.stream, target.files)) {
      applyDefaultOutput(target.id, target.stream, targetNext)
    }
  }
  const onRowDrop = (e: React.DragEvent, groupId: number) => {
    if (!e.dataTransfer.types.includes(ROW_REORDER_MIME)) return
    e.preventDefault()
    if (drop && drop.groupId === groupId) commitDrop(groupId, drop.at)
    else { dragRef.current = null; setDrop(null) }
  }
  const onDragEnd = () => { dragRef.current = null; setDrop(null) }

  // ── Combine ────────────────────────────────────────────────────────────────

  const combineGroup = useCallback(async (groupId: number) => {
    const group = groupsRef.current.find(g => g.id === groupId)
    if (!group || group.files.length < 2 || !group.outputPath) return
    if (runState !== null) return
    // Belt to the disabled button's suspenders — a copy-concat of
    // incompatible streams writes a broken file, never run one.
    if (computeCompat(group.files).mismatchedProps.length > 0) return
    setRunState({ groupId, paused: false })
    setRunProgress(0)
    elapsedRef.current = 0
    setElapsedMs(0)
    patchGroup(groupId, g => ({ ...g, completed: null, error: null, cancelledNotice: false }))
    setCancelling(false)

    const unsub = window.api.onCombineProgress(({ percent }) => setRunProgress(percent))
    const totalDur = group.files.reduce((s, f) => s + (f.duration ?? 0), 0)
    const sourcePaths = group.files.map(f => f.path)
    const outputPath = group.outputPath
    // Claim the sources for the run: the streams page's delete guards
    // consult open-items, so files being concatenated can't be trashed
    // out from under ffmpeg.
    setOpen('combine', sourcePaths)

    try {
      await window.api.combineFiles(sourcePaths, outputPath, totalDur)
      let deleteError: string | null = null
      let deletedPaths: string[] = []
      if (group.deleteAfter) {
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
          deleteError = `Combined, but the source files were NOT deleted: ${verifyProblem}. Check the output before removing them manually.`
        } else {
          const results = await Promise.allSettled(sourcePaths.map(p => window.api.trashFile(p)))
          deletedPaths = sourcePaths.filter((_, i) => results[i].status === 'fulfilled')
          const failed = sourcePaths.length - deletedPaths.length
          if (failed > 0) {
            deleteError = `Output verified, but ${failed} of ${sourcePaths.length} source files could not be moved to the recycle bin (probably in use). They are still in the folder.`
          }
        }
      }
      // The source rows STAY visible (read-only; trashed ones grayed with
      // struck names) and the done row replaces the job's options footer.
      // Any deleteAfter problem rides along as the error line under it.
      patchGroup(groupId, g => ({
        ...g,
        files: g.files.map(f => deletedPaths.includes(f.path) ? { ...f, deleted: true } : f),
        completed: { path: outputPath, elapsedMs: elapsedRef.current },
        error: deleteError,
      }))
    } catch (e: any) {
      if (e?.message?.includes('cancelled')) {
        patchGroup(groupId, g => ({ ...g, cancelledNotice: true })) // partial output already removed by main
      } else {
        patchGroup(groupId, g => ({ ...g, error: e.message }))
      }
    } finally {
      unsub()
      setRunState(null)
      setCancelling(false)
      setOpen('combine', [])
    }
  }, [runState, patchGroup, setOpen])

  // ── Empty state ────────────────────────────────────────────────────────────

  if (groups.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 px-8">
        <FileDropZone
          onFiles={addFilesAsNewGroup}
          accept={VIDEO_EXTS}
          label="Drop video files here to combine"
          className="w-full max-w-xl min-h-[140px]"
        />
        <p className="text-sm text-gray-400 text-center">
          You can also send a stream's videos here with the <Film size={12} className="inline mb-0.5" /> button on a stream row with multiple videos.
        </p>
      </div>
    )
  }

  const totalFiles = groups.reduce((s, g) => s + g.files.length, 0)

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header — page chrome; each job carries its own controls. */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-white/5 shrink-0">
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-semibold">Combine</h1>
          <p className="text-xs text-gray-400 mt-0.5">
            {groups.length} job{groups.length === 1 ? '' : 's'}{totalFiles > 0 ? ` · ${totalFiles} file${totalFiles === 1 ? '' : 's'}` : ''}
          </p>
        </div>
      </div>

      <div className="flex-1 overflow-hidden pr-2"><div className="h-full overflow-y-auto px-6 py-4 flex flex-col gap-4">
        {groups.map(g => {
          const compat = computeCompat(g.files)
          const isRunning = runState?.groupId === g.id
          const paused = isRunning && runState!.paused
          const anyRunning = runState !== null
          const totalDur = g.files.reduce((s, f) => s + (f.duration ?? 0), 0)
          // Spec rule: a stream group whose remaining files ALL came from
          // elsewhere has lost its identity — warn and refuse to combine.
          const orphaned = !!g.stream && g.files.length > 0 &&
            !g.files.some(f => f.stream?.folderPath === g.stream!.folderPath)
          const isEmpty = g.files.length === 0 && !g.completed

          return (
            <div key={g.id} className="bg-navy-800 border border-white/5 rounded-lg overflow-hidden shrink-0">
              {/* Job header: identity + count + per-job actions. */}
              <div className="flex items-center gap-2 px-4 py-2 border-b border-white/5">
                {g.stream ? (
                  <Tooltip content={`Open “${g.stream.label}” on the streams page`} side="top" triggerClassName="min-w-0">
                    <button
                      type="button"
                      onClick={() => onNavigateToStream?.(g.stream!.folderPath)}
                      className="block max-w-full truncate text-xs font-medium text-purple-300/90 hover:text-purple-200 hover:underline transition-colors"
                    >
                      {g.stream.label}
                    </button>
                  </Tooltip>
                ) : (
                  <span className="text-xs font-medium text-gray-200 truncate">{g.label}</span>
                )}
                {g.stream?.date && <span className="text-[11px] text-gray-400 shrink-0">· {g.stream.date}</span>}
                <span className="text-[11px] text-gray-400 shrink-0 tabular-nums">
                  {`· ${g.files.length} file${g.files.length === 1 ? '' : 's'}${totalDur > 0 ? ` · ${formatDur(totalDur)}` : ''}`}{g.completed ? ' · done' : ''}
                </span>
                <div className="ml-auto flex items-center gap-1 shrink-0">
                  {!g.completed && (
                    <Tooltip content="Reorder by recording start time (parsed from the filenames), oldest first — files without a timestamp sort by name">
                      <button
                        onClick={() => autoSortGroup(g.id)}
                        disabled={isRunning || g.files.length < 2}
                        className="inline-flex shrink-0 items-center gap-1.5 px-2 py-1 rounded-md text-[11px] text-gray-400 transition-colors hover:text-gray-200 hover:bg-white/5 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-gray-400"
                      >
                        <Wand2 size={12} />
                        Auto-sort
                      </button>
                    </Tooltip>
                  )}
                  <Tooltip content={g.completed
                    ? 'Clear this finished job from the list — files on disk are untouched'
                    : 'Remove this job and all its files from the list — the files themselves are untouched'}
                  >
                    <button
                      onClick={() => removeGroup(g.id)}
                      disabled={isRunning}
                      className="inline-flex shrink-0 items-center gap-1.5 px-2 py-1 rounded-md text-[11px] text-gray-400 transition-colors hover:text-red-400 hover:bg-red-500/10 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-gray-400"
                    >
                      <Trash2 size={12} />
                      {g.completed ? 'Clear job' : 'Remove job'}
                    </button>
                  </Tooltip>
                </div>
              </div>

              {isEmpty ? (
                // Spec rule: an empty group disables everything except its
                // remove button (kept in the header above). It IS a drop
                // target though — rows dragged from other jobs (and OS
                // file drops via the zone below) refill it.
                <div
                  className={`px-4 py-4 transition-colors ${drop?.groupId === g.id ? 'bg-purple-900/20' : ''}`}
                  onDragEnter={e => {
                    if (e.dataTransfer.types.includes(ROW_REORDER_MIME)) e.preventDefault()
                  }}
                  onDragOver={e => {
                    if (!e.dataTransfer.types.includes(ROW_REORDER_MIME)) return
                    if (!dragRef.current) return
                    e.preventDefault()
                    e.dataTransfer.dropEffect = 'move'
                    setDrop({ groupId: g.id, at: 0 })
                  }}
                  onDragLeave={e => {
                    const related = e.relatedTarget as Node | null
                    if (related && e.currentTarget.contains(related)) return
                    setDrop(prev => (prev?.groupId === g.id ? null : prev))
                  }}
                  onDrop={e => {
                    if (!e.dataTransfer.types.includes(ROW_REORDER_MIME)) return
                    e.preventDefault()
                    commitDrop(g.id, 0)
                  }}
                >
                  <p className="text-[11px] text-gray-500 italic mb-2">
                    No files in this job. Drop files here to fill it, or remove it.
                  </p>
                  <FileDropZone
                    compact
                    onFiles={paths => addFilesToGroup(g.id, paths)}
                    accept={VIDEO_EXTS}
                    label="Drop or click to add files to this job"
                  />
                </div>
              ) : (
                <>
                  {/* File rows */}
                  <div
                    className="flex flex-col gap-1.5 px-4 py-3"
                    // The gaps BETWEEN rows belong to this container — without
                    // these handlers the browser shows the no-drop cursor
                    // exactly where the insertion marker is drawn. Rows
                    // preventDefault first and bubble up, so defaultPrevented
                    // distinguishes "over a row" from "over a gap". dragENTER
                    // must be canceled too or the cursor flashes no-drop at
                    // every element boundary.
                    onDragEnter={e => {
                      if (e.dataTransfer.types.includes(ROW_REORDER_MIME)) e.preventDefault()
                    }}
                    onDragOver={e => {
                      if (e.defaultPrevented) return
                      if (!e.dataTransfer.types.includes(ROW_REORDER_MIME)) return
                      if (!groupDroppable(g.id)) return
                      e.preventDefault()
                      e.dataTransfer.dropEffect = 'move'
                    }}
                    onDrop={e => {
                      if (e.defaultPrevented) return
                      if (!e.dataTransfer.types.includes(ROW_REORDER_MIME)) return
                      e.preventDefault()
                      if (drop && drop.groupId === g.id) commitDrop(g.id, drop.at)
                    }}
                  >
                    {g.files.map((f, i) => (
                      <div
                        key={f.path}
                        draggable={!isRunning && !g.completed}
                        onDragStart={e => onRowDragStart(e, g.id, i)}
                        onDragOver={e => onRowDragOver(e, g.id, i)}
                        onDrop={e => onRowDrop(e, g.id)}
                        onDragEnd={onDragEnd}
                        // Completed jobs keep their rows as a read-only
                        // record (links/tooltips still live); a file the
                        // run trashed is grayed with a struck name.
                        className={`relative flex items-center gap-3 px-3 py-2 rounded-lg border border-white/5 bg-white/[0.03] hover:bg-white/[0.06] transition-all select-none ${
                          isRunning ? 'opacity-50 pointer-events-none' : g.completed ? '' : 'cursor-grab active:cursor-grabbing'
                        } ${f.deleted ? 'opacity-50' : ''}`}
                      >
                        {/* Insertion marker — anchored INSIDE the row it
                            precedes, centered in the 6px flex gap (offsets
                            measured from the padding box, 1px inside the row
                            border — hence 5px). */}
                        {drop && drop.groupId === g.id && drop.at === i && (
                          <span className="pointer-events-none absolute -top-[5px] left-0 right-0 h-0.5 rounded bg-purple-500" />
                        )}
                        {drop && drop.groupId === g.id && drop.at === g.files.length && i === g.files.length - 1 && (
                          <span className="pointer-events-none absolute -bottom-[5px] left-0 right-0 h-0.5 rounded bg-purple-500" />
                        )}
                        {/* Drag handle — pointless on a finished job's
                            record rows, so it disappears with the run. */}
                        {!g.completed && <GripVertical size={14} className="text-gray-400 shrink-0" />}

                        {/* Order number */}
                        <span className="text-xs text-gray-400 font-mono w-5 text-right shrink-0">{i + 1}</span>

                        {/* Thumbnail — converter-row treatment. */}
                        <div className="self-center shrink-0">
                          <VideoThumb path={f.path} height={44} />
                        </div>

                        {/* Info column: filename, stream link, detail chips */}
                        <div className="flex-1 min-w-0 flex flex-col justify-center gap-0.5">
                          <Tooltip content={f.deleted ? `${f.path} (moved to the recycle bin)` : f.path} maxWidth="max-w-md" triggerClassName="block w-fit max-w-full min-w-0">
                            <span className={`block text-sm text-gray-200 truncate font-mono ${f.deleted ? 'line-through' : ''}`}>
                              {f.name}
                            </span>
                          </Tooltip>
                          {/* Owning stream item (only for files sent from a
                              stream). Opens its detail sidebar. */}
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
                          {/* Encoding + file details; segments appear as their
                              probe/size lookups land. Segments whose property
                              DIFFERS within the group turn red (amber for
                              frame rate, which is only advisory) — the
                              row-level view of the compatibility gate. */}
                          {(() => {
                            if (f.codec === null && f.size === null) {
                              return <span className="text-[11px] text-gray-400"><Loader2 size={10} className="animate-spin inline" /></span>
                            }
                            const segs: { text: string; cls?: string }[] = []
                            if (f.codec) segs.push({ text: f.codec, cls: compat.codecMismatch ? 'text-red-400' : undefined })
                            if (f.width != null && f.height != null) segs.push({ text: `${f.width}×${f.height}`, cls: compat.resMismatch ? 'text-red-400' : undefined })
                            if (f.fps != null) segs.push({ text: `${Math.round(f.fps * 100) / 100} fps`, cls: compat.fpsMismatch ? 'text-amber-300' : undefined })
                            if (f.audioTracks !== null) segs.push({ text: audioSig(f), cls: compat.audioMismatch ? 'text-red-400' : undefined })
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

                        {/* Labeled time columns — an unlabeled clock next to
                            an unlabeled duration read as two mystery numbers. */}
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

                        {/* Remove (not on a completed job's record rows).
                            Trash2, not X — X is strictly close/dismiss
                            (style guide: X closes, trash removes/deletes). */}
                        {!g.completed && (
                          <Tooltip content="Remove from this job — the file itself is untouched">
                            <button
                              onClick={() => removeFile(g.id, i)}
                              className="text-gray-400 hover:text-red-400 transition-colors shrink-0"
                            >
                              <Trash2 size={13} />
                            </button>
                          </Tooltip>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Slim add-more zone for THIS job; hidden during its run
                      and on the finished record. */}
                  {!isRunning && !g.completed && (
                    <div className="px-4 pb-3">
                      <FileDropZone
                        compact
                        onFiles={paths => addFilesToGroup(g.id, paths)}
                        accept={VIDEO_EXTS}
                        label="Drop or click to add files to this job"
                      />
                    </div>
                  )}

                  {/* Completed: the done row takes the options footer's
                      place — the sources above stay as the run's record. */}
                  {g.completed ? (
                    <div className="border-t border-white/5 bg-navy-900/30">
                      <CompletedRow
                        path={g.completed.path}
                        elapsedMs={g.completed.elapsedMs}
                        stream={g.stream}
                        onNavigateToStream={onNavigateToStream}
                      />
                      {g.error && (
                        <div className="flex items-center gap-2 px-4 pb-3 text-sm text-red-400">
                          <AlertCircle size={14} />
                          {g.error}
                        </div>
                      )}
                    </div>
                  ) : isRunning ? (
                    /* In progress: the output file EXISTS from ffmpeg's
                       first write, so it already shows as a file row in
                       the footer slot (which becomes the done row on
                       completion). Converter active-row anatomy: status
                       icon + name, progress bar, %/elapsed/ETA/output-dir
                       line, divider, pause + cancel actions. No thumbnail
                       attempt while the file is mid-write — a partial
                       decode would cache a bogus frame; the real one
                       arrives with the done row. */
                    <div className="border-t border-white/5 bg-navy-900/30">
                      <div className="flex items-stretch gap-3 px-4 py-3">
                        <div className="self-center shrink-0 -my-1 -ms-2">
                          <div className="w-[100px] h-14 rounded-md bg-navy-800 border border-white/5 flex items-center justify-center">
                            <Film size={13} className="text-gray-500" />
                          </div>
                        </div>
                        <div className="flex-1 min-w-0 flex flex-col gap-1.5">
                          <div className="flex items-center gap-2">
                            {paused
                              ? <Pause size={14} className="text-yellow-400 shrink-0" />
                              : <RefreshCw size={14} className="text-purple-400 animate-spin shrink-0" />}
                            <Tooltip content={g.outputPath} maxWidth="max-w-md" triggerClassName="flex-1 min-w-0">
                              <span className="block text-xs text-gray-200 truncate">{nameOf(g.outputPath)}</span>
                            </Tooltip>
                            <span className="text-xs text-gray-400 shrink-0">
                              Combining {g.files.length} files
                            </span>
                          </div>
                          {g.stream && (
                            <Tooltip content={`Open “${g.stream.label}” on the streams page`} side="top" triggerClassName="block w-fit max-w-full min-w-0">
                              <button
                                type="button"
                                onClick={() => onNavigateToStream?.(g.stream!.folderPath)}
                                className="block max-w-full truncate text-[11px] text-purple-300/90 hover:text-purple-200 hover:underline transition-colors"
                              >
                                {g.stream.label}
                              </button>
                            </Tooltip>
                          )}
                          <div className="h-1 w-full bg-white/10 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all ${paused ? 'bg-yellow-400' : runProgress === 0 ? 'bg-purple-500 animate-pulse' : 'bg-purple-500'}`}
                              style={{ width: runProgress === 0 && !paused ? '100%' : `${runProgress}%` }}
                            />
                          </div>
                          <div className="flex items-center gap-3 text-xs text-gray-400 tabular-nums">
                            <span>{runProgress}%</span>
                            {elapsedMs > 0 && <span>Elapsed: {formatDur(elapsedMs / 1000)}</span>}
                            <span>
                              {paused
                                ? 'Paused'
                                : runProgress === 0
                                  ? 'Starting…'
                                  : `ETA: ${elapsedMs > 0 ? formatDur((elapsedMs * (100 - runProgress) / runProgress) / 1000) : 'Estimating…'}`}
                            </span>
                            <Tooltip content="Open output folder" side="top">
                              <button
                                onClick={() => window.api.openInExplorer(dirOf(g.outputPath))}
                                className="ml-auto min-w-0 text-gray-400 hover:text-gray-300 transition-colors truncate"
                              >
                                {dirOf(g.outputPath)}
                              </button>
                            </Tooltip>
                          </div>
                        </div>
                        {/* Separator */}
                        <div className="w-px self-stretch bg-white/10 shrink-0" />
                        {/* Actions — converter scheme: pause/resume, then
                            cancel with Ban (X is strictly close/dismiss). */}
                        <div className="self-center flex flex-row items-center justify-center gap-1 shrink-0">
                          <Tooltip content={paused ? 'Resume the combine' : 'Pause the combine — ffmpeg is suspended until you resume'}>
                            <button
                              onClick={() => {
                                if (paused) { void window.api.resumeCombine(); setRunState(prev => prev ? { ...prev, paused: false } : prev) }
                                else { void window.api.pauseCombine(); setRunState(prev => prev ? { ...prev, paused: true } : prev) }
                              }}
                              className={paused ? ROW_ACTION_BLUE : ROW_ACTION_YELLOW}
                            >
                              {paused ? <Play size={13} /> : <Pause size={13} />}
                              {paused ? 'Resume' : 'Pause'}
                            </button>
                          </Tooltip>
                          <Tooltip content="Cancel — removes the partial output; sources are untouched">
                            <button
                              onClick={() => { setCancelling(true); void window.api.cancelCombine() }}
                              disabled={cancelling}
                              className={ROW_ACTION_RED}
                            >
                              <Ban size={13} />
                              {cancelling ? 'Cancelling…' : 'Cancel'}
                            </button>
                          </Tooltip>
                        </div>
                      </div>
                    </div>
                  ) : (
                  /* Job options — the old page footer, per job now. */
                  <div className="px-4 py-3 border-t border-white/5 bg-navy-900/30 flex flex-col gap-3">
                    {/* Output path */}
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-gray-400 shrink-0">Output</label>
                      <input
                        value={g.outputPath}
                        onChange={e => patchGroup(g.id, gg => ({ ...gg, outputPath: e.target.value }))}
                        className="flex-1 bg-navy-900 border border-white/10 text-gray-200 text-xs font-mono rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                      />
                      <Button variant="ghost" size="sm" icon={<FolderOpen size={13} />} onClick={() => void browseOutput(g.id)} />
                    </div>

                    {g.cancelledNotice && (
                      <div className="flex items-center gap-2 text-sm text-gray-400">
                        <X size={14} />
                        Combine cancelled — the partial output file was removed; the source files are untouched.
                      </div>
                    )}

                    {/* Compatibility gate — red blocks the run (the output
                        would be a broken file), amber warns but allows (VFR
                        output plays fine). */}
                    {compat.mismatchedProps.length > 0 && (
                      <div className="flex items-start gap-2 text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
                        <AlertCircle size={13} className="shrink-0 mt-0.5" />
                        <div className="flex flex-col gap-1.5 min-w-0 flex-1">
                          <span className="font-medium">These files can't be combined without re-encoding: combining copies the streams as-is, and these differences would produce a broken output.</span>
                          {/* One row per file, one column per DIFFERING
                              property — far easier to scan than prose. */}
                          <div className="overflow-x-auto">
                            <table className="text-[11px] w-full border-collapse">
                              <thead>
                                <tr className="text-left text-red-200/70">
                                  <th className="pr-4 py-0.5 font-medium">File</th>
                                  {compat.mismatchedProps.map(p => (
                                    <th key={p.label} className="pr-4 py-0.5 font-medium whitespace-nowrap">{p.label}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody className="font-mono text-red-200/90">
                                {compat.probed.map(f => (
                                  <tr key={f.path} className="border-t border-red-500/20">
                                    <td className="pr-4 py-0.5">
                                      <Tooltip content={f.name} maxWidth="max-w-md" triggerClassName="block max-w-[260px] min-w-0">
                                        <span className="block truncate">{f.name}</span>
                                      </Tooltip>
                                    </td>
                                    {compat.mismatchedProps.map(p => (
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
                    {compat.mismatchedProps.length === 0 && compat.fpsMismatch && (
                      <div className="flex items-start gap-2 text-xs text-amber-200 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
                        <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                        <span>
                          The files have different frame rates ({[...new Set(compat.probed.map(fpsVal))].join(', ')}). The combined file will simply switch frame rate at the joins (variable frame rate); most players handle this fine, but some editors dislike VFR input. Convert to a matching frame rate first if that matters.
                        </span>
                      </div>
                    )}

                    {/* Spec rule: stream group with no files from its own
                        stream left — warn, and Combine below disables. */}
                    {orphaned && (
                      <div className="flex items-start gap-2 text-xs text-amber-200 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
                        <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                        <span>
                          No files in this combine job belong to its stream item ({g.stream!.label}). Move one of its files back in, or remove the job and start a new one for these files.
                        </span>
                      </div>
                    )}

                    {g.error && (
                      <div className="flex items-center gap-2 text-sm text-red-400">
                        <AlertCircle size={14} />
                        {g.error}
                      </div>
                    )}

                    {/* Delete option + combine button */}
                    <div className="flex items-center justify-between">
                      <Checkbox
                        checked={g.deleteAfter}
                        onChange={v => patchGroup(g.id, gg => ({ ...gg, deleteAfter: v }))}
                        color="red"
                        size="sm"
                        label={<span className={g.deleteAfter ? 'text-red-400' : 'text-gray-400'}>Delete source files after combining</span>}
                      />
                      {/* Armed only when ANOTHER job's run is the blocker —
                          otherwise the disabled state explains itself. */}
                      <Tooltip content="Another combine is already running; one runs at a time" open={anyRunning ? undefined : false}>
                        <Button
                          variant="primary"
                          icon={<Combine size={14} />}
                          onClick={() => void combineGroup(g.id)}
                          disabled={g.files.length < 2 || !g.outputPath || anyRunning || compat.mismatchedProps.length > 0 || orphaned}
                        >
                          {`Combine ${g.files.length} files`}
                        </Button>
                      </Tooltip>
                    </div>
                  </div>
                  )}
                </>
              )}
            </div>
          )
        })}

        {/* Page-level intake: a drop here starts its own NEW job. */}
        <FileDropZone
          compact
          onFiles={addFilesAsNewGroup}
          accept={VIDEO_EXTS}
          label="Drop or click to start a new combine job"
          className="shrink-0"
        />
      </div></div>
    </div>
  )
}
