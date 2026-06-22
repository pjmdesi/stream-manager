import React, { useState, useEffect, useRef } from 'react'
import { useConversionJobs } from '../../context/ConversionContext'
import { XCircle, Zap, CheckCircle, AlertCircle, Clock, RefreshCw, Trash2, Archive, Ban, Pause, Play, Cloud, SlidersHorizontal, ChevronDown, RotateCcw } from 'lucide-react'
import { v4 as uuidv4 } from 'uuid'
import type { ConversionPreset, ConversionJob, AudioTrackInfo } from '../../types'
import { Button } from '../ui/Button'
import { FileDropZone } from '../ui/FileDropZone'
import { Modal } from '../ui/Modal'
import { Tooltip } from '../ui/Tooltip'
import { useStore } from '../../hooks/useStore'
import { PresetsModal } from '../preset-editor/PresetsModal'
import { CollapsibleLabel } from '../ui/CollapsibleLabel'
import { VideoThumb } from '../ui/VideoThumb'

// Row action buttons — neutral at rest, colored only on hover, with a label
// that collapses to icon-only as the row narrows. Mirrors the stream detail
// sidebar's footer buttons (PANEL_ACTION_BUTTON_*).
const ROW_ACTION_BASE = 'inline-flex shrink-0 min-w-max items-center gap-1.5 px-2 py-1.5 rounded-md text-[11px] text-gray-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-gray-400'
const ROW_ACTION_GREEN = `${ROW_ACTION_BASE} hover:text-green-400 hover:bg-green-500/10`
const ROW_ACTION_RED = `${ROW_ACTION_BASE} hover:text-red-400 hover:bg-red-500/10`
const ROW_ACTION_YELLOW = `${ROW_ACTION_BASE} hover:text-yellow-400 hover:bg-yellow-500/10`
const ROW_ACTION_BLUE = `${ROW_ACTION_BASE} hover:text-blue-400 hover:bg-blue-500/10`

function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(0)} MB`
  if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(0)} KB`
  return `${bytes} B`
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`
  return `${m}:${String(sec).padStart(2,'0')}`
}

/** Shorten an output directory for the per-file dropdown so the drive letter
 *  and the final directory stay visible (native selects clip the END, hiding
 *  exactly what matters), e.g. `D:\…older\subfolder`. */
function shortenDir(dir: string): string {
  const norm = dir.replace(/[\\/]+$/, '')
  const m = norm.match(/^([a-zA-Z]:)[\\/]?(.*)$/)
  if (!m) return norm
  const [, drive, rest] = m
  const MAX = 20
  if (rest.length <= MAX) return norm
  return `${drive}\\…${rest.slice(rest.length - MAX)}`
}

/** A single-line text span that shows a Tooltip (above) with the full text
 *  only when the text is actually truncated. Re-measures on resize. */
function TruncText({ text, className = '' }: { text: string; className?: string }) {
  const [truncated, setTruncated] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const check = () => setTruncated(el.scrollWidth > el.clientWidth + 1)
    check()
    const obs = new ResizeObserver(check)
    obs.observe(el)
    return () => obs.disconnect()
  }, [text])
  // Always render the same structure — the Tooltip wrapper stays mounted and we
  // just arm/disarm it via `open`. Wrapping/unwrapping on the truncation toggle
  // would remount the measured span and make detection order-dependent.
  return (
    <Tooltip content={text} side="top" open={truncated ? undefined : false} triggerClassName="block min-w-0 truncate">
      <span ref={ref} className={`block truncate min-w-0 ${className}`}>{text}</span>
    </Tooltip>
  )
}

/** Output extensions that mean "audio-only" — the presets that get a per-file
 *  audio-track picker in the queue. */
const AUDIO_OUTPUT_EXTS = new Set(['mp3', 'm4a', 'aac', 'wav', 'flac', 'ogg', 'opus', 'wma'])
function isAudioPreset(preset: ConversionPreset | null | undefined): boolean {
  return !!preset && AUDIO_OUTPUT_EXTS.has(preset.outputExtension.toLowerCase())
}
/** Compact label for an audio track in the picker, e.g. "Track 1 — English · aac · 2ch". */
function audioTrackLabel(t: AudioTrackInfo): string {
  const desc = t.title || t.language
  const meta = [t.codec, t.channels ? `${t.channels}ch` : ''].filter(Boolean).join(' · ')
  return `Track ${t.index + 1}${desc ? ` — ${desc}` : ''}${meta ? ` · ${meta}` : ''}`
}

function StatusIcon({ status }: { status: ConversionJob['status'] }) {
  if (status === 'done')        return <CheckCircle size={14} className="text-green-400 shrink-0" />
  if (status === 'error')       return <AlertCircle size={14} className="text-red-400 shrink-0" />
  if (status === 'downloading') return <Cloud size={14} className="text-blue-400 animate-pulse shrink-0" />
  if (status === 'running')     return <RefreshCw size={14} className="text-purple-400 animate-spin shrink-0" />
  if (status === 'replacing')   return <RefreshCw size={14} className="text-purple-300 animate-spin shrink-0" />
  if (status === 'paused')      return <Pause size={14} className="text-yellow-400 shrink-0" />
  if (status === 'cancelled')   return <XCircle size={14} className="text-gray-400 shrink-0" />
  return <Clock size={14} className="text-yellow-500 shrink-0" />
}

function ProgressBar({ percent, status }: { percent: number; status: ConversionJob['status'] }) {
  const colorClass =
    status === 'done'        ? 'bg-green-500' :
    status === 'error'       ? 'bg-red-500' :
    status === 'cancelled'   ? 'bg-gray-600' :
    status === 'paused'      ? 'bg-yellow-400' :
    status === 'downloading' ? 'bg-blue-500 animate-pulse' :
    status === 'replacing'   ? 'bg-purple-300 animate-pulse' :
    status === 'running' && percent === 0 ? 'bg-purple-500 animate-pulse' :
    'bg-purple-500'

  const isIndeterminate =
    status === 'downloading' ||
    status === 'replacing' ||
    (status === 'running' && percent === 0)
  return (
    <div className="h-1 w-full bg-white/10 rounded-full overflow-hidden">
      <div
        className={`h-full rounded-full transition-all ${colorClass}`}
        style={{ width: isIndeterminate ? '100%' : `${percent}%` }}
      />
    </div>
  )
}

function getOutputPath(inputFile: string, preset: ConversionPreset, outputDir: string, trackSuffix = ''): string {
  const inputDir = inputFile.replace(/[\\/][^\\/]+$/, '')
  const base = inputFile.replace(/[\\/]/g, '/').split('/').pop()!.replace(/\.[^.]+$/, '')
  const dir = outputDir || inputDir
  // Builtins have clean ids; imported presets use a slug of the name
  const suffix = preset.isBuiltin
    ? preset.id
    : preset.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return `${dir}/${base}_${suffix}${trackSuffix}.${preset.outputExtension}`
}

/** " - Track N - Name" output-filename suffix for an audio-extraction job —
 *  empty unless it's an audio preset on a multi-track file. Mirrors exactly when
 *  ConversionJob.audioTrackIndex gets set, so the filename matches the extracted
 *  track (and distinct tracks from one source don't collide). */
function audioTrackOutputSuffix(
  preset: ConversionPreset | null | undefined,
  tracks: AudioTrackInfo[] | undefined,
  audioTrackIndex: number | undefined,
): string {
  if (!isAudioPreset(preset) || (tracks?.length ?? 0) <= 1) return ''
  const idx = audioTrackIndex ?? 0
  const t = tracks!.find(x => x.index === idx) ?? tracks![0]
  const name = (t.title || t.language || '').replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim()
  return name ? ` - Track ${t.index + 1} - ${name}` : ` - Track ${t.index + 1}`
}

interface PendingConverter { paths: string[]; token: number; stream?: { folderPath: string; label: string } }

export function ConverterPage({ pending, onNavigateToStream }: { pending?: PendingConverter | null; onNavigateToStream?: (folderPath: string) => void }) {
  const { config, updateConfig } = useStore()
  const [builtinPresets, setBuiltinPresets] = useState<ConversionPreset[]>([])
  const [importedPresets, setImportedPresets] = useState<ConversionPreset[]>([])
  const [recommendedArchiveId, setRecommendedArchiveId] = useState<string | null>(null)
  const { jobs, setJobs, jobEtas, jobElapsed, jobFinalElapsed } = useConversionJobs()
  // outputDir: '' = next to the original; otherwise an explicit directory.
  // pickedDir: the last directory the user chose via the picker — kept so the
  // option stays in the dropdown even after switching back to "Next to original".
  const [queuedFiles, setQueuedFiles] = useState<Array<{ path: string; presetId: string; outputDir: string; pickedDir: string; audioTrackIndex?: number; stream?: { folderPath: string; label: string } }>>([])
  // Probed audio-track lists keyed by file path — drives the per-file audio-track
  // picker for audio-extraction presets. Probed lazily as files are queued.
  const [audioTracksByPath, setAudioTracksByPath] = useState<Record<string, AudioTrackInfo[]>>({})
  // Source-stream origin keyed by file path, kept separately from queuedFiles
  // so the "from stream" link survives the file moving into an active job.
  const [streamOrigins, setStreamOrigins] = useState<Record<string, { folderPath: string; label: string }>>({})
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState('')
  const [presetsModalOpen, setPresetsModalOpen] = useState(false)
  const [deleteDialog, setDeleteDialog] = useState<{ jobId: string; outputFile: string } | null>(null)

  const autoDeletePartial = !!config.autoDeletePartialOnCancel

  // The default preset (★ in the Presets modal; falls back to the first
  // built-in) is assigned to each file as it's added — so changing the default
  // later only affects newly-added files. Each row can override it via its
  // dropdown.
  const allPresets = [...builtinPresets, ...importedPresets]
  const defaultPreset =
    allPresets.find(p => p.id === config.defaultConversionPresetId) ?? builtinPresets[0] ?? null
  // Resolve a queued file's chosen preset, falling back to the current default
  // if its id is missing (assigned before presets loaded, or preset deleted).
  const presetForId = (id: string) => allPresets.find(p => p.id === id) ?? defaultPreset

  useEffect(() => {
    if (!pending) return
    const { paths, stream } = pending
    if (stream) setStreamOrigins(prev => {
      const next = { ...prev }
      for (const p of paths) next[p] = stream
      return next
    })
    setQueuedFiles(prev => {
      const existing = new Set(prev.map(f => f.path))
      const additions = paths
        .filter(p => !existing.has(p))
        .map(path => ({ path, presetId: defaultPreset?.id ?? '', outputDir: '', pickedDir: '', stream }))
      return additions.length ? [...prev, ...additions] : prev
    })
  }, [pending?.token]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    Promise.all([
      window.api.getBuiltinPresets(),
      window.api.getImportedPresets(),
      Promise.all([
        window.api.checkEncoderAvailable('libsvtav1'),
        window.api.checkEncoderAvailable('av1_nvenc'),
        window.api.checkEncoderAvailable('av1_amf'),
        window.api.checkEncoderAvailable('av1_qsv'),
      ]),
    ]).then(([builtin, imported, [hasSvt, hasNvenc, hasAmf, hasQsv]]) => {
      setBuiltinPresets(builtin)
      setImportedPresets(imported)
      const hasAnyAv1 = hasSvt || hasNvenc || hasAmf || hasQsv
      setRecommendedArchiveId(hasAnyAv1 ? 'archive-av1' : 'archive-h265')
    })
  }, [])

  // Probe newly-queued files for their audio tracks so audio-extraction presets
  // can offer a per-file track picker. Reuses the same probe the player uses;
  // failures fall back to an empty list (no picker, default first-track behavior).
  useEffect(() => {
    const missing = queuedFiles.map(f => f.path).filter(p => !(p in audioTracksByPath))
    if (missing.length === 0) return
    let cancelled = false
    ;(async () => {
      const probed = await Promise.all(missing.map(async p => {
        try { const info = await window.api.probeFile(p); return [p, info.audioTracks ?? []] as const }
        catch { return [p, [] as AudioTrackInfo[]] as const }
      }))
      if (cancelled) return
      setAudioTracksByPath(prev => {
        const next = { ...prev }
        for (const [p, tracks] of probed) next[p] = tracks
        return next
      })
    })()
    return () => { cancelled = true }
  }, [queuedFiles, audioTracksByPath])

  // Note: IPC job listeners and the 1Hz ETA tick now live in
  // ConversionContext so the sidebar widget keeps getting fresh data
  // regardless of which page is mounted.

  const importPreset = async () => {
    setImportError('')
    const paths = await window.api.openFileDialog({ filters: [{ name: 'JSON Preset', extensions: ['json'] }] })
    if (!paths?.length) return
    setImporting(true)
    try {
      const preset = await window.api.importPreset(paths[0])
      setImportedPresets(prev => [...prev, preset])
    } catch (err: any) {
      setImportError(err.message ?? 'Failed to import preset')
    }
    setImporting(false)
  }

  const savePreset = async (preset: ConversionPreset) => {
    await window.api.saveCustomPreset(preset)
    setImportedPresets(prev => {
      const idx = prev.findIndex(p => p.id === preset.id)
      return idx >= 0 ? prev.map((p, i) => i === idx ? preset : p) : [...prev, preset]
    })
  }

  const deleteImported = async (id: string) => {
    await window.api.deleteImportedPreset(id)
    setImportedPresets(prev => prev.filter(p => p.id !== id))
    // Clear the default / archive-default pointers if they referenced it so
    // they fall back gracefully instead of dangling.
    if (config.defaultConversionPresetId === id) updateConfig({ defaultConversionPresetId: '' })
    if (config.archivePresetId === id) updateConfig({ archivePresetId: '' })
  }

  const removeFile = (p: string) => setQueuedFiles(prev => prev.filter(f => f.path !== p))
  const addFiles = (paths: string[]) => setQueuedFiles(prev => {
    const existing = new Set(prev.map(f => f.path))
    const assignId = defaultPreset?.id ?? ''
    const additions = paths.filter(p => !existing.has(p)).map(path => ({ path, presetId: assignId, outputDir: '', pickedDir: '' }))
    return additions.length ? [...prev, ...additions] : prev
  })
  const setFilePreset = (p: string, presetId: string) =>
    setQueuedFiles(prev => prev.map(f => f.path === p ? { ...f, presetId } : f))
  const setFileOutputDir = (p: string, outputDir: string) =>
    setQueuedFiles(prev => prev.map(f => f.path === p ? { ...f, outputDir } : f))
  const setFileAudioTrack = (p: string, audioTrackIndex: number) =>
    setQueuedFiles(prev => prev.map(f => f.path === p ? { ...f, audioTrackIndex } : f))

  /** Queue one ready file as a conversion job, then drop it from the ready list. */
  const startOne = async (file: { path: string; presetId: string; outputDir: string; audioTrackIndex?: number }) => {
    const preset = presetForId(file.presetId)
    if (!preset) return
    const job: ConversionJob = {
      id: uuidv4(),
      inputFile: file.path,
      outputFile: getOutputPath(file.path, preset, file.outputDir, audioTrackOutputSuffix(preset, audioTracksByPath[file.path], file.audioTrackIndex)),
      preset,
      status: 'queued',
      progress: 0,
      // Explicit track only when the picker is shown (audio preset + >1 track),
      // so the chosen track is mapped exactly; single-track keeps the default.
      audioTrackIndex: isAudioPreset(preset) && (audioTracksByPath[file.path]?.length ?? 0) > 1
        ? (file.audioTrackIndex ?? 0)
        : undefined,
    }
    // Update the UI synchronously — add to Converting and drop from the ready
    // list in the same tick — before awaiting the IPC, so the row never shows
    // in both panels during the round-trip.
    setJobs(prev => [...prev, job])
    removeFile(file.path)
    await window.api.addToQueue(job)
  }

  const startAll = async () => {
    if (queuedFiles.length === 0) return

    // Build every job up front so the UI can update in one tick — add them all
    // to Converting and clear the started files from the ready list — before
    // firing the IPC calls, so nothing lingers in both panels during the loop.
    const jobs: ConversionJob[] = []
    const startedPaths = new Set<string>()
    for (const file of queuedFiles) {
      const preset = presetForId(file.presetId)
      if (!preset) continue
      jobs.push({
        id: uuidv4(),
        inputFile: file.path,
        outputFile: getOutputPath(file.path, preset, file.outputDir, audioTrackOutputSuffix(preset, audioTracksByPath[file.path], file.audioTrackIndex)),
        preset,
        status: 'queued',
        progress: 0,
        audioTrackIndex: isAudioPreset(preset) && (audioTracksByPath[file.path]?.length ?? 0) > 1
          ? (file.audioTrackIndex ?? 0)
          : undefined,
      })
      startedPaths.add(file.path)
    }
    if (jobs.length === 0) return

    setJobs(prev => [...prev, ...jobs])
    setQueuedFiles(prev => prev.filter(f => !startedPaths.has(f.path)))
    for (const job of jobs) await window.api.addToQueue(job)
  }

  const removeJob = (id: string) => {
    setJobs(prev => prev.filter(j => j.id !== id))
    jobEtas.delete(id)
    jobElapsed.delete(id)
    jobFinalElapsed.delete(id)
    // Also drop it from the main process's job map / persisted queue, or it
    // reappears on the next renderer reload (getJobs re-hydrates from there).
    window.api.removeJob(id).catch(() => {})
  }

  /** Move a cancelled job back to the ready list so its preset / output can be
   *  tweaked and the conversion run again. Reconstructs the output choice from
   *  the job's paths ('' when it was next-to-original) and keeps the stream
   *  origin so the "from stream" link survives. */
  const requeueJob = (job: ConversionJob) => {
    const inputDir = job.inputFile.replace(/[\\/][^\\/]+$/, '')
    const outDir = job.outputFile.replace(/[\\/][^\\/]+$/, '')
    const outputDir = outDir === inputDir ? '' : outDir
    const presetId = allPresets.some(p => p.id === job.preset.id) ? job.preset.id : (defaultPreset?.id ?? '')
    setQueuedFiles(prev => prev.some(f => f.path === job.inputFile)
      ? prev
      : [...prev, { path: job.inputFile, presetId, outputDir, pickedDir: outputDir, audioTrackIndex: job.audioTrackIndex, stream: streamOrigins[job.inputFile] }])
    removeJob(job.id)
  }

  const cancelJob = async (id: string) => {
    const job = jobs.find(j => j.id === id)
    await window.api.cancelJob(id)
    setJobs(prev => prev.map(j => j.id === id ? { ...j, status: 'cancelled' } : j))
    jobEtas.delete(id)
    jobElapsed.delete(id)
    if (job?.outputFile) {
      if (autoDeletePartial) {
        window.api.deleteFile(job.outputFile).catch(() => {})
      } else {
        setDeleteDialog({ jobId: id, outputFile: job.outputFile })
      }
    }
  }

  const pauseJob = async (id: string) => {
    await window.api.pauseJob(id)
    setJobs(prev => prev.map(j => j.id === id ? { ...j, status: 'paused' } : j))
  }

  const resumeJob = async (id: string) => {
    await window.api.resumeJob(id)
    setJobs(prev => prev.map(j => j.id === id ? { ...j, status: 'running' } : j))
  }

  const clearDone = () => {
    // Explicitly drop only terminal states. Earlier this kept an allow-list
    // (running / paused / queued) and cleared everything else — which
    // wrongly included transient states like 'downloading' (cloud hydrate
    // wait) and 'replacing' (atomic swap), causing in-flight cloud archives
    // to disappear from the queue mid-wait.
    const cleared = jobs.filter(j =>
      j.status === 'done' || j.status === 'error' || j.status === 'cancelled')
    setJobs(prev => prev.filter(j =>
      j.status !== 'done' && j.status !== 'error' && j.status !== 'cancelled'
    ))
    // Evict from the main process too, or getJobs re-hydrates them on reload.
    cleared.forEach(j => {
      jobEtas.delete(j.id)
      jobElapsed.delete(j.id)
      jobFinalElapsed.delete(j.id)
      window.api.removeJob(j.id).catch(() => {})
    })
  }

  /** Render a single job row — extracted so both the ungrouped queue and
   *  group-block bodies use the same markup. `indented=true` adds a left
   *  inset so grouped rows visually attach to the group header above. */
  const renderJobRow = (job: ConversionJob, indented: boolean) => {
    const isActive = job.status === 'running' || job.status === 'paused'
    const isDone = job.status === 'done'
    const isCancelled = job.status === 'cancelled'
    const isError = job.status === 'error'
    const isDownloading = job.status === 'downloading'
    const isReplacing = job.status === 'replacing'
    const isWorking = isActive || isDownloading || isReplacing
    const elapsed = jobElapsed.get(job.id) ?? 0
    const finalElapsed = jobFinalElapsed.get(job.id) ?? 0
    const eta = jobEtas.get(job.id) ?? null
    const outputDir = job.outputFile.replace(/[\\/][^\\/]+$/, '')
    const outputName = job.outputFile.split(/[\\/]/).pop()
    const streamOrigin = streamOrigins[job.inputFile]

    return (
      <div key={job.id} className={`@container px-4 py-3 border-b border-white/5 last:border-0 flex items-stretch gap-3 ${indented ? 'pl-7' : ''}`}>
        {/* Thumbnail — pulled toward the left/top/bottom edges, keeps the
            gap to the right content. */}
        <div className="self-center shrink-0 -my-1 -ms-2">
          <VideoThumb path={job.inputFile} />
        </div>
        {/* Left: all content */}
        <div className="flex-1 min-w-0 flex flex-col gap-1.5">
          {/* Filenames row */}
          <div className="flex items-center gap-2">
            <StatusIcon status={job.status} />
            <div className="shrink-0 max-w-[30%] min-w-0">
              <TruncText text={job.inputFile.split(/[\\/]/).pop() ?? job.inputFile} className="text-xs text-gray-400" />
            </div>
            <span className="text-xs text-gray-400 shrink-0">→</span>
            {/* Hide the temp-file name for replaceInput jobs — they're invisible
                to the user; show the input file's name instead so the row reads
                as "input → input (replaced in place)". */}
            <div className="flex-1 min-w-0">
              <TruncText text={(job.replaceInput ? job.inputFile.split(/[\\/]/).pop() : outputName) ?? ''} className="text-xs text-gray-200" />
            </div>
            <span className="text-xs text-gray-400 shrink-0">
              {job.preset.name}
              {typeof job.inputSize === 'number' && (
                <span className="ml-1.5 text-gray-400 tabular-nums">· {formatBytes(job.inputSize)}</span>
              )}
            </span>
          </div>

          {/* Link back to the source stream (only for files sent from one). */}
          {streamOrigin && (
            <Tooltip content={`Open “${streamOrigin.label}” on the streams page`} side="top" triggerClassName="block w-fit max-w-full min-w-0">
              <button
                type="button"
                onClick={() => onNavigateToStream?.(streamOrigin.folderPath)}
                className="block max-w-full truncate text-[11px] text-purple-300/90 hover:text-purple-200 hover:underline transition-colors"
              >
                {streamOrigin.label}
              </button>
            </Tooltip>
          )}

          <ProgressBar percent={job.progress} status={job.status} />

          {isDownloading && (
            <div className="flex items-center gap-3 text-xs text-blue-300 tabular-nums">
              <span>Downloading from cloud…</span>
              {elapsed > 0 && <span className="text-gray-400">Elapsed: {formatDuration(elapsed)}</span>}
            </div>
          )}

          {isReplacing && (
            <div className="flex items-center gap-3 text-xs text-purple-200 tabular-nums">
              <span>Replacing original…</span>
              {elapsed > 0 && <span className="text-gray-400">Elapsed: {formatDuration(elapsed)}</span>}
            </div>
          )}

          {isActive && (
            <div className="flex items-center gap-3 text-xs text-gray-400 tabular-nums">
              <span>{job.progress.toFixed(1)}%</span>
              {elapsed > 0 && <span>Elapsed: {formatDuration(elapsed)}</span>}
              <span>
                {job.progress === 0
                  ? 'Starting…'
                  : `ETA: ${eta !== null && eta > 0 ? formatDuration(eta) : 'Estimating…'}`}
              </span>
              {!job.replaceInput && (
                <Tooltip content="Open output folder" side="top">
                  <button
                    onClick={() => window.api.openInExplorer(outputDir)}
                    className="ml-auto text-gray-400 hover:text-gray-300 transition-colors truncate max-w-[200px]"
                  >
                    {outputDir}
                  </button>
                </Tooltip>
              )}
            </div>
          )}

          {isDone && (
            <div className="flex items-center gap-3 text-xs text-gray-400 tabular-nums">
              <span>100%</span>
              {finalElapsed > 0 && <span>Elapsed: {formatDuration(finalElapsed)}</span>}
              {!job.replaceInput && (
                <Tooltip content="Open output folder" side="top">
                  <button
                    onClick={() => window.api.openInExplorer(outputDir)}
                    className="ml-auto text-gray-400 hover:text-gray-300 transition-colors truncate max-w-[200px]"
                  >
                    {outputDir}
                  </button>
                </Tooltip>
              )}
            </div>
          )}

          {isCancelled && (
            <div className="flex items-center gap-3 text-xs text-gray-400 tabular-nums">
              <span>{job.progress.toFixed(1)}%</span>
              <span>Conversion cancelled</span>
            </div>
          )}

          {isError && (
            <div className="flex items-center gap-3 text-xs tabular-nums">
              <span className="text-gray-400">{job.progress.toFixed(1)}%</span>
              <span className="text-red-400 whitespace-pre-wrap">{job.error}</span>
            </div>
          )}
        </div>

        {/* Separator */}
        <div className="w-px self-stretch bg-white/10 shrink-0" />
        {/* Right: action buttons — same scheme as the ready-files rows (neutral
            at rest, color on hover, label collapses to icon-only as it narrows). */}
        <div className="self-center flex flex-row items-center justify-center gap-1 shrink-0">
          {job.status === 'queued' && (
            <button onClick={() => window.api.startQueuedJob(job.id)} className={ROW_ACTION_GREEN}>
              <Play size={13} />
              <CollapsibleLabel expandClass="@2xl:grid-cols-[1fr] @2xl:ms-0" collapsedMarginStart="-ms-1.5">Start</CollapsibleLabel>
            </button>
          )}
          {isActive && (
            <button
              onClick={() => job.status === 'paused' ? resumeJob(job.id) : pauseJob(job.id)}
              className={job.status === 'paused' ? ROW_ACTION_BLUE : ROW_ACTION_YELLOW}
            >
              {job.status === 'paused' ? <Play size={13} /> : <Pause size={13} />}
              <CollapsibleLabel expandClass="@2xl:grid-cols-[1fr] @2xl:ms-0" collapsedMarginStart="-ms-1.5">{job.status === 'paused' ? 'Resume' : 'Pause'}</CollapsibleLabel>
            </button>
          )}
          {isWorking && (
            <button onClick={() => cancelJob(job.id)} className={ROW_ACTION_RED}>
              <Ban size={13} />
              <CollapsibleLabel expandClass="@2xl:grid-cols-[1fr] @2xl:ms-0" collapsedMarginStart="-ms-1.5">Cancel</CollapsibleLabel>
            </button>
          )}
          {isCancelled && (
            <button onClick={() => requeueJob(job)} className={ROW_ACTION_BLUE}>
              <RotateCcw size={13} />
              <CollapsibleLabel expandClass="@2xl:grid-cols-[1fr] @2xl:ms-0" collapsedMarginStart="-ms-1.5">Requeue</CollapsibleLabel>
            </button>
          )}
          {(isDone || isCancelled || isError || job.status === 'queued') && (
            <button onClick={() => removeJob(job.id)} className={ROW_ACTION_RED}>
              <Trash2 size={13} />
              <CollapsibleLabel expandClass="@2xl:grid-cols-[1fr] @2xl:ms-0" collapsedMarginStart="-ms-1.5">Remove</CollapsibleLabel>
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <>
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-white/5 flex items-center gap-3 shrink-0">
        <h1 className="text-lg font-semibold flex-1">Converter</h1>
        <Button variant="secondary" size="sm" icon={<SlidersHorizontal size={14} />} onClick={() => setPresetsModalOpen(true)}>
          Manage presets
        </Button>
      </div>

        <div className="flex-1 overflow-hidden pr-2"><div className="h-full overflow-y-auto p-4 flex flex-col gap-4">
          <div className="bg-navy-800 border border-white/5 rounded-lg overflow-hidden shrink-0">
              <div className="flex items-center justify-between px-4 py-2 border-b border-white/5 gap-2">
                <span className="text-xs font-medium text-gray-400">{queuedFiles.length} file(s) ready</span>
                <Button
                  variant="success"
                  size="sm"
                  icon={<Zap size={12} />}
                  onClick={startAll}
                  disabled={!defaultPreset || queuedFiles.length === 0}
                >
                  Start all
                </Button>
              </div>
              {queuedFiles.length === 0 && jobs.length === 0 && (
                <div className="px-4 py-6 text-center text-xs text-gray-400">No files queued</div>
              )}
              {queuedFiles.map(file => {
                const { path, outputDir, pickedDir, stream } = file
                const preset = presetForId(file.presetId)
                const sourceName = path.split(/[\\/]/).pop() ?? path
                const destName = preset ? getOutputPath(path, preset, outputDir, audioTrackOutputSuffix(preset, audioTracksByPath[path], file.audioTrackIndex)).split(/[\\/]/).pop() ?? '' : ''
                return (
                  <div key={path} className="@container flex items-stretch gap-3 px-4 py-2.5 border-b border-white/5 last:border-0">
                    {/* Thumbnail — pulled toward the left/top/bottom edges
                        (negative margins), but keeps the gap-3 to the right. */}
                    <div className="self-center shrink-0 -my-1 -ms-2">
                      <VideoThumb path={path} />
                    </div>
                    {/* Info column: filenames on top, controls below */}
                    <div className="flex-1 min-w-0 flex flex-col justify-center gap-1.5">
                      <div className="flex items-center gap-1.5 text-xs min-w-0">
                        <TruncText text={sourceName} className="text-gray-400" />
                        {preset && (
                          <>
                            <span className="shrink-0 text-gray-400">→</span>
                            <TruncText text={destName} className="text-gray-300" />
                          </>
                        )}
                      </div>
                      {/* Link back to the source stream (only for files sent
                          from a stream). Opens its detail sidebar on the
                          streams page. */}
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
                      <div className="flex items-center gap-2 min-w-0">
                        {/* Encode preset */}
                        <div className="relative shrink-0">
                          <select
                            value={preset?.id ?? ''}
                            onChange={e => setFilePreset(path, e.target.value)}
                            className="appearance-none max-w-[180px] bg-navy-900 border border-white/10 text-gray-200 text-xs rounded-lg pl-2 pr-6 py-1 focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                          >
                            <optgroup label="Built-in">
                              {builtinPresets.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                            </optgroup>
                            {importedPresets.length > 0 && (
                              <optgroup label="Custom &amp; imported">
                                {importedPresets.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                              </optgroup>
                            )}
                          </select>
                          <ChevronDown size={12} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                        </div>
                        {/* Output directory — keeps the last picked path as an
                            option even after switching back to "Next to original". */}
                        <div className="relative shrink-0">
                          <select
                            value={outputDir || ''}
                            onChange={async e => {
                              const v = e.target.value
                              if (v === '__choose__') {
                                const dir = await window.api.openDirectoryDialog()
                                if (dir) setQueuedFiles(prev => prev.map(f => f.path === path ? { ...f, outputDir: dir, pickedDir: dir } : f))
                                else setFileOutputDir(path, outputDir) // cancel → reset the controlled value
                              } else {
                                setFileOutputDir(path, v)
                              }
                            }}
                            className="appearance-none max-w-[220px] bg-navy-900 border border-white/10 text-gray-200 text-xs rounded-lg pl-2 pr-6 py-1 focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                          >
                            <option value="">Next to original</option>
                            {pickedDir && <option value={pickedDir}>{shortenDir(pickedDir)}</option>}
                            <option value="__choose__">Choose location…</option>
                          </select>
                          <ChevronDown size={12} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                        </div>
                        {/* Audio-track picker — only for audio-extraction presets
                            on files with more than one audio track. */}
                        {isAudioPreset(preset) && (audioTracksByPath[path]?.length ?? 0) > 1 && (
                          <div className="relative shrink-0">
                            <select
                              value={String(file.audioTrackIndex ?? 0)}
                              onChange={e => setFileAudioTrack(path, Number(e.target.value))}
                              className="appearance-none max-w-[200px] bg-navy-900 border border-white/10 text-gray-200 text-xs rounded-lg pl-2 pr-6 py-1 focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                            >
                              {audioTracksByPath[path].map(t => (
                                <option key={t.index} value={String(t.index)}>{audioTrackLabel(t)}</option>
                              ))}
                            </select>
                            <ChevronDown size={12} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                          </div>
                        )}
                      </div>
                    </div>
                    {/* Separator */}
                    <div className="w-px self-stretch bg-white/10 shrink-0" />
                    {/* Buttons column — match the sidebar-footer buttons: ghost
                        Button with a label that smoothly collapses to icon-only
                        as the row narrows. */}
                    <div className="shrink-0 self-center flex items-center gap-1">
                      <button onClick={() => startOne(file)} disabled={!preset} className={ROW_ACTION_GREEN}>
                        <Zap size={13} />
                        <CollapsibleLabel expandClass="@2xl:grid-cols-[1fr] @2xl:ms-0" collapsedMarginStart="-ms-1.5">Start</CollapsibleLabel>
                      </button>
                      <button onClick={() => removeFile(path)} className={ROW_ACTION_RED}>
                        <Trash2 size={13} />
                        <CollapsibleLabel expandClass="@2xl:grid-cols-[1fr] @2xl:ms-0" collapsedMarginStart="-ms-1.5">Remove</CollapsibleLabel>
                      </button>
                    </div>
                  </div>
                )
              })}
              {/* When something's converting, hide the big drop zone below and
                  offer a slim "add more" zone as the last queue item instead. */}
              {jobs.length > 0 && (
                <FileDropZone
                  compact
                  onFiles={addFiles}
                  accept={['mkv', 'mp4', 'mov', 'avi', 'ts', 'flv', 'webm']}
                  label="Drop or click to add files"
                  className="m-2"
                />
              )}
          </div>

          {jobs.length > 0 && (
            <div className="bg-navy-800 border border-white/5 rounded-lg overflow-hidden shrink-0">
              <div className="flex items-center justify-between gap-2 px-4 py-2 border-b border-white/5">
                <span className="text-xs font-medium text-gray-400">Converting ({jobs.length})</span>
                <div className="flex items-center gap-1">
                  {(() => {
                    const anyRunning = jobs.some(j => j.status === 'running' || j.status === 'downloading')
                    const anyPaused = jobs.some(j => j.status === 'paused')
                    if (!anyRunning && !anyPaused) return null
                    // If anything is running, the action is "Pause all"; otherwise
                    // (only paused jobs left) the action is "Resume all".
                    const action = anyRunning ? 'pause' : 'resume'
                    const label = action === 'pause' ? 'Pause all' : 'Resume all'
                    const Icon = action === 'pause' ? Pause : Play
                    return (
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={<Icon size={13} />}
                        onClick={async () => {
                          if (action === 'pause') {
                            const targets = jobs.filter(j => j.status === 'running' || j.status === 'downloading')
                            await Promise.all(targets.map(j => window.api.pauseJob(j.id).catch(() => {})))
                          } else {
                            const targets = jobs.filter(j => j.status === 'paused')
                            await Promise.all(targets.map(j => window.api.resumeJob(j.id).catch(() => {})))
                          }
                        }}
                      >
                        {label}
                      </Button>
                    )
                  })()}
                  <Button variant="ghost" size="sm" onClick={clearDone} disabled={!jobs.some(j => j.status === 'done' || j.status === 'cancelled' || j.status === 'error')}>Clear done</Button>
                </div>
              </div>
              {/* Build a render list: group rows are emitted at the position of
                  their first member; subsequent members are skipped (the group
                  block renders all members itself). Ungrouped jobs render as
                  before. */}
              {(() => {
                const seenGroups = new Set<string>()
                const items: React.ReactNode[] = []
                for (const job of jobs) {
                  if (job.groupId) {
                    if (seenGroups.has(job.groupId)) continue
                    seenGroups.add(job.groupId)
                    const groupJobs = jobs.filter(j => j.groupId === job.groupId)
                    const total = groupJobs.length
                    const doneN = groupJobs.filter(j => j.status === 'done').length
                    const errN = groupJobs.filter(j => j.status === 'error').length
                    const cancelledN = groupJobs.filter(j => j.status === 'cancelled').length
                    const finishedN = doneN + errN + cancelledN
                    const aggregatePct = (groupJobs.reduce((sum, j) =>
                      sum + (j.status === 'done' ? 100 : (j.status === 'cancelled' || j.status === 'error') ? 0 : (j.progress ?? 0)), 0) / total)
                    const groupActive = groupJobs.some(j =>
                      j.status === 'queued' || j.status === 'downloading' || j.status === 'running' ||
                      j.status === 'replacing' || j.status === 'paused')
                    const groupSummary =
                      finishedN === total
                        ? `${doneN}/${total} complete${errN > 0 ? `, ${errN} failed` : ''}${cancelledN > 0 ? `, ${cancelledN} cancelled` : ''}`
                        : `${finishedN}/${total} done`
                    items.push(
                      <div key={`g:${job.groupId}`} className="border-b border-white/5 last:border-0">
                        <div className="flex items-center gap-2 px-4 py-2 bg-green-500/5 border-l-2 border-green-500/40">
                          <Archive size={13} className="text-green-400 shrink-0" />
                          <span className="text-xs font-semibold text-gray-200 shrink-0">{job.groupLabel ?? 'Group'}</span>
                          <span className="text-[11px] text-gray-400 shrink-0 tabular-nums">· {groupSummary}</span>
                          <div className="flex-1 mx-2">
                            <ProgressBar percent={aggregatePct} status={groupActive ? 'running' : (errN > 0 ? 'error' : 'done')} />
                          </div>
                          {groupActive && (
                            <Tooltip content="Cancel all jobs in this group">
                              <button
                                onClick={() => window.api.cancelJobGroup(job.groupId!)}
                                className="p-1 text-gray-400 hover:text-red-400 transition-colors shrink-0"
                              >
                                <Ban size={13} />
                              </button>
                            </Tooltip>
                          )}
                        </div>
                        <div className="border-l-2 border-green-500/20">
                          {groupJobs.map(gj => renderJobRow(gj, true))}
                        </div>
                      </div>
                    )
                  } else {
                    items.push(renderJobRow(job, false))
                  }
                }
                return items
              })()}
            </div>
          )}

          {jobs.length === 0 && (
            <>
              <FileDropZone
                onFiles={addFiles}
                accept={['mkv', 'mp4', 'mov', 'avi', 'ts', 'flv', 'webm']}
                label="Drop video files here to convert"
                className="min-h-[100px] shrink-0"
              />
              <p className="text-xs text-gray-400 px-1">You can also send videos here from the Streams page using the action buttons on each row.</p>
            </>
          )}
        </div></div>
    </div>

    <Modal
      isOpen={!!deleteDialog}
      onClose={() => setDeleteDialog(null)}
      title="Delete partial file?"
      width="sm"
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-gray-300">
          The conversion was cancelled. Do you want to delete the partial output file?
        </p>
        {deleteDialog && (
          <p className="text-xs text-gray-400 font-mono break-all bg-navy-900 border border-white/5 rounded-lg px-3 py-2">
            {deleteDialog.outputFile.replace(/.*[\\/]/, '')}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={() => setDeleteDialog(null)}>
            Keep file
          </Button>
          <Button
            variant="danger"
            size="sm"
            icon={<Trash2 size={13} />}
            onClick={() => {
              if (deleteDialog) window.api.deleteFile(deleteDialog.outputFile).catch(() => {})
              setDeleteDialog(null)
            }}
          >
            Delete file
          </Button>
        </div>
      </div>
    </Modal>

    {/* Presets management — list + inline create/edit form + import + the
        default / archive-default / recommended markers. Replaces the old
        left sidebar. */}
    <PresetsModal
      isOpen={presetsModalOpen}
      onClose={() => setPresetsModalOpen(false)}
      builtinPresets={builtinPresets}
      importedPresets={importedPresets}
      recommendedId={recommendedArchiveId}
      onSavePreset={savePreset}
      onDeletePreset={deleteImported}
      onImport={importPreset}
      importing={importing}
      importError={importError}
    />
    </>
  )
}
