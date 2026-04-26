import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useConversionJobs } from '../../context/ConversionContext'
import { X, XCircle, FolderOpen, Zap, CheckCircle, AlertCircle, Clock, RefreshCw, Upload, Trash2, Pencil, Archive, Ban, Pause, Play, Star, Cloud } from 'lucide-react'
import { v4 as uuidv4 } from 'uuid'
import type { ConversionPreset, ConversionJob } from '../../types'
import { Button } from '../ui/Button'
import { FileDropZone } from '../ui/FileDropZone'
import { Modal } from '../ui/Modal'
import { Tooltip } from '../ui/Tooltip'

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`
  return `${m}:${String(sec).padStart(2,'0')}`
}

function StatusIcon({ status }: { status: ConversionJob['status'] }) {
  if (status === 'done')        return <CheckCircle size={14} className="text-green-400 shrink-0" />
  if (status === 'error')       return <AlertCircle size={14} className="text-red-400 shrink-0" />
  if (status === 'downloading') return <Cloud size={14} className="text-blue-400 animate-pulse shrink-0" />
  if (status === 'running')     return <RefreshCw size={14} className="text-purple-400 animate-spin shrink-0" />
  if (status === 'replacing')   return <RefreshCw size={14} className="text-purple-300 animate-spin shrink-0" />
  if (status === 'paused')      return <Pause size={14} className="text-yellow-400 shrink-0" />
  if (status === 'cancelled')   return <XCircle size={14} className="text-gray-500 shrink-0" />
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

function getOutputPath(inputFile: string, preset: ConversionPreset, outputDir: string): string {
  const inputDir = inputFile.replace(/[\\/][^\\/]+$/, '')
  const base = inputFile.replace(/[\\/]/g, '/').split('/').pop()!.replace(/\.[^.]+$/, '')
  const dir = outputDir || inputDir
  // Builtins have clean ids; imported presets use a slug of the name
  const suffix = preset.isBuiltin
    ? preset.id
    : preset.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return `${dir}/${base}_${suffix}.${preset.outputExtension}`
}

interface PendingFile { path: string; token: number }

export function ConverterPage({ initialFile }: { initialFile?: PendingFile | null }) {
  const [builtinPresets, setBuiltinPresets] = useState<ConversionPreset[]>([])
  const [importedPresets, setImportedPresets] = useState<ConversionPreset[]>([])
  const [selectedPreset, setSelectedPreset] = useState<ConversionPreset | null>(null)
  const [archivePresetId, setArchivePresetId] = useState<string>('')
  const [recommendedArchiveId, setRecommendedArchiveId] = useState<string | null>(null)
  const [outputDir, setOutputDir] = useState('')
  const { jobs, setJobs } = useConversionJobs()
  const [queuedFiles, setQueuedFiles] = useState<string[]>([])
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState('')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [autoDeletePartial, setAutoDeletePartial] = useState(false)
  const [deleteDialog, setDeleteDialog] = useState<{ jobId: string; outputFile: string } | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const renameInputRef = useRef<HTMLInputElement>(null)
  const [, setTick] = useState(0)
  const jobStartTimes = useRef<Map<string, number>>(new Map())
  const jobEtas = useRef<Map<string, number | null>>(new Map())
  const jobElapsed = useRef<Map<string, number>>(new Map())
  const jobFinalElapsed = useRef<Map<string, number>>(new Map())
  const ETA_ALPHA = 0.25
  const jobsRef = useRef(jobs)

  useEffect(() => {
    if (initialFile) setQueuedFiles(prev => prev.includes(initialFile.path) ? prev : [...prev, initialFile.path])
  }, [initialFile?.token]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    Promise.all([
      window.api.getBuiltinPresets(),
      window.api.getImportedPresets(),
      window.api.getConfig(),
      Promise.all([
        window.api.checkEncoderAvailable('libsvtav1'),
        window.api.checkEncoderAvailable('av1_nvenc'),
        window.api.checkEncoderAvailable('av1_amf'),
        window.api.checkEncoderAvailable('av1_qsv'),
      ]),
    ]).then(([builtin, imported, config, [hasSvt, hasNvenc, hasAmf, hasQsv]]) => {
      setBuiltinPresets(builtin)
      setImportedPresets(imported)
      setArchivePresetId(config.archivePresetId ?? '')
      setAutoDeletePartial(!!config.autoDeletePartialOnCancel)
      setSelectedPreset(prev => prev ?? builtin[0] ?? null)
      const hasAnyAv1 = hasSvt || hasNvenc || hasAmf || hasQsv
      setRecommendedArchiveId(hasAnyAv1 ? 'archive-av1' : 'archive-h265')
    })
  }, [])

  useEffect(() => {
    const unsubProgress = window.api.onJobProgress(({ jobId, percent }: { jobId: string; percent: number }) => {
      if (!jobStartTimes.current.has(jobId)) jobStartTimes.current.set(jobId, Date.now())
      setJobs(prev => prev.map(j => {
        if (j.id !== jobId) return j
        // Don't override transient sub-states ('downloading', 'replacing',
        // 'paused') just because a progress tick arrived. Only nudge
        // queued → running.
        const next = (j.status === 'queued') ? 'running' : j.status
        return { ...j, progress: percent, status: next }
      }))
    })
    // Explicit status transitions from the main process (downloading start/end,
    // replacing, etc.). Higher priority than the progress event.
    const unsubStatus = window.api.onJobStatus(({ jobId, status }) => {
      setJobs(prev => prev.map(j => j.id === jobId ? { ...j, status } : j))
    })
    const unsubComplete = window.api.onJobComplete(({ jobId }: { jobId: string }) => {
      const startedAt = jobStartTimes.current.get(jobId)
      if (startedAt) jobFinalElapsed.current.set(jobId, Date.now() - startedAt)
      setJobs(prev => prev.map(j => j.id === jobId ? { ...j, status: 'done', progress: 100 } : j))
    })
    const unsubError = window.api.onJobError(({ jobId, error }: { jobId: string; error: string }) => {
      setJobs(prev => prev.map(j => j.id === jobId ? { ...j, status: 'error', error } : j))
    })
    // Jobs added by auto-rules (background) — append if not already in local state.
    const unsubAdded = window.api.onJobAdded((job: ConversionJob) => {
      setJobs(prev => prev.some(j => j.id === job.id) ? prev : [...prev, job])
    })
    return () => { unsubProgress(); unsubStatus(); unsubComplete(); unsubError(); unsubAdded() }
  }, [])

  useEffect(() => { jobsRef.current = jobs }, [jobs])

  // Tick every second — update ETA once per second using current jobs ref
  useEffect(() => {
    const id = setInterval(() => {
      if (!jobsRef.current.some(j => j.status === 'running')) return
      jobsRef.current.forEach(j => {
        if (j.status !== 'running') return
        const startedAt = jobStartTimes.current.get(j.id)
        const elapsed = startedAt ? Date.now() - startedAt : 0
        jobElapsed.current.set(j.id, elapsed)
        if (j.progress > 0) {
          const raw = elapsed / (j.progress / 100) - elapsed
          const prev = jobEtas.current.get(j.id)
          jobEtas.current.set(j.id, prev != null ? ETA_ALPHA * raw + (1 - ETA_ALPHA) * prev : raw)
        } else {
          jobEtas.current.set(j.id, null)
        }
      })
      setTick(t => t + 1)
    }, 1000)
    return () => clearInterval(id)
  }, [])

  const importPreset = async () => {
    setImportError('')
    const paths = await window.api.openFileDialog({ filters: [{ name: 'JSON Preset', extensions: ['json'] }] })
    if (!paths?.length) return
    setImporting(true)
    try {
      const preset = await window.api.importPreset(paths[0])
      setImportedPresets(prev => [...prev, preset])
      setSelectedPreset(preset)
    } catch (err: any) {
      setImportError(err.message ?? 'Failed to import preset')
    }
    setImporting(false)
  }

  const deleteImported = async (id: string) => {
    await window.api.deleteImportedPreset(id)
    setImportedPresets(prev => prev.filter(p => p.id !== id))
    if (selectedPreset?.id === id) setSelectedPreset(builtinPresets[0] ?? null)
  }

  const startRename = (p: ConversionPreset) => {
    setRenamingId(p.id)
    setRenameValue(p.name)
    // Focus the input on the next render
    setTimeout(() => renameInputRef.current?.select(), 0)
  }

  const commitRename = async () => {
    if (!renamingId) return
    const trimmed = renameValue.trim()
    if (trimmed) {
      await window.api.renameImportedPreset(renamingId, trimmed)
      setImportedPresets(prev => prev.map(p => p.id === renamingId ? { ...p, name: trimmed } : p))
      if (selectedPreset?.id === renamingId) setSelectedPreset(prev => prev ? { ...prev, name: trimmed } : prev)
    }
    setRenamingId(null)
  }

  const cancelRename = () => setRenamingId(null)

  const pickOutputDir = async () => {
    const dir = await window.api.openDirectoryDialog()
    if (dir) setOutputDir(dir)
  }

  const removeFile = (p: string) => setQueuedFiles(prev => prev.filter(f => f !== p))
  const addFiles = (paths: string[]) => setQueuedFiles(prev => [...new Set([...prev, ...paths])])

  const startAll = async () => {
    if (!selectedPreset || queuedFiles.length === 0) return

    for (const inputFile of queuedFiles) {
      const outputFile = getOutputPath(inputFile, selectedPreset, outputDir)
      const job: ConversionJob = {
        id: uuidv4(),
        inputFile,
        outputFile,
        preset: selectedPreset,
        status: 'queued',
        progress: 0
      }
      setJobs(prev => [...prev, job])
      await window.api.addToQueue(job)
    }
    setQueuedFiles([])
  }

  const removeJob = (id: string) => {
    setJobs(prev => prev.filter(j => j.id !== id))
    jobEtas.current.delete(id)
    jobElapsed.current.delete(id)
    jobFinalElapsed.current.delete(id)
    jobStartTimes.current.delete(id)
  }

  const cancelJob = async (id: string) => {
    const job = jobs.find(j => j.id === id)
    await window.api.cancelJob(id)
    setJobs(prev => prev.map(j => j.id === id ? { ...j, status: 'cancelled' } : j))
    jobEtas.current.delete(id)
    jobElapsed.current.delete(id)
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
    setJobs(prev => prev.filter(j => j.status === 'running' || j.status === 'paused' || j.status === 'queued'))
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
    const elapsed = jobElapsed.current.get(job.id) ?? 0
    const finalElapsed = jobFinalElapsed.current.get(job.id) ?? 0
    const eta = jobEtas.current.get(job.id) ?? null
    const outputDir = job.outputFile.replace(/[\\/][^\\/]+$/, '')
    const outputName = job.outputFile.split(/[\\/]/).pop()

    return (
      <div key={job.id} className={`px-4 py-3 border-b border-white/5 last:border-0 flex items-stretch gap-3 ${indented ? 'pl-7' : ''}`}>
        {/* Left: all content */}
        <div className="flex-1 min-w-0 flex flex-col gap-1.5">
          {/* Filenames row */}
          <div className="flex items-center gap-2">
            <StatusIcon status={job.status} />
            <span className="text-xs text-gray-500 truncate shrink-0 max-w-[30%]" title={job.inputFile}>
              {job.inputFile.split(/[\\/]/).pop()}
            </span>
            <span className="text-xs text-gray-600 shrink-0">→</span>
            <span className="flex-1 text-xs text-gray-200 truncate" title={job.outputFile}>
              {/* Hide the temp-file name for replaceInput jobs — they're
                  invisible to the user; show the input file's name instead so
                  the row reads as "input → input (replaced in place)". */}
              {job.replaceInput ? job.inputFile.split(/[\\/]/).pop() : outputName}
            </span>
            <span className="text-xs text-gray-600 shrink-0">{job.preset.name}</span>
          </div>

          <ProgressBar percent={job.progress} status={job.status} />

          {isDownloading && (
            <div className="flex items-center gap-3 text-xs text-blue-300 tabular-nums">
              <span>Downloading from cloud…</span>
              {elapsed > 0 && <span className="text-gray-500">Elapsed: {formatDuration(elapsed)}</span>}
            </div>
          )}

          {isReplacing && (
            <div className="flex items-center gap-3 text-xs text-purple-200 tabular-nums">
              <span>Replacing original…</span>
              {elapsed > 0 && <span className="text-gray-500">Elapsed: {formatDuration(elapsed)}</span>}
            </div>
          )}

          {isActive && (
            <div className="flex items-center gap-3 text-xs text-gray-500 tabular-nums">
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
                    className="ml-auto text-gray-600 hover:text-gray-300 transition-colors truncate max-w-[200px]"
                  >
                    {outputDir}
                  </button>
                </Tooltip>
              )}
            </div>
          )}

          {isDone && (
            <div className="flex items-center gap-3 text-xs text-gray-500 tabular-nums">
              <span>100%</span>
              {finalElapsed > 0 && <span>Elapsed: {formatDuration(finalElapsed)}</span>}
              {!job.replaceInput && (
                <Tooltip content="Open output folder" side="top">
                  <button
                    onClick={() => window.api.openInExplorer(outputDir)}
                    className="ml-auto text-gray-600 hover:text-gray-300 transition-colors truncate max-w-[200px]"
                  >
                    {outputDir}
                  </button>
                </Tooltip>
              )}
            </div>
          )}

          {isCancelled && (
            <div className="flex items-center gap-3 text-xs text-gray-500 tabular-nums">
              <span>{job.progress.toFixed(1)}%</span>
              <span>Conversion cancelled</span>
            </div>
          )}

          {isError && (
            <div className="flex items-center gap-3 text-xs tabular-nums">
              <span className="text-gray-500">{job.progress.toFixed(1)}%</span>
              <span className="text-red-400 whitespace-pre-wrap">{job.error}</span>
            </div>
          )}
        </div>

        {/* Right: action buttons column */}
        <div className="flex flex-row items-center justify-center gap-1 shrink-0">
          {job.status === 'queued' && (
            <Tooltip content="Start conversion">
              <button
                onClick={() => window.api.startQueuedJob(job.id)}
                className="p-1.5 text-gray-600 hover:text-green-400 transition-colors"
              >
                <Play size={14} />
              </button>
            </Tooltip>
          )}
          {isActive && (
            <Tooltip content={job.status === 'paused' ? 'Resume' : 'Pause'}>
              <button
                onClick={() => job.status === 'paused' ? resumeJob(job.id) : pauseJob(job.id)}
                className={`p-1.5 text-gray-600 transition-colors ${job.status === 'paused' ? 'hover:text-blue-400' : 'hover:text-yellow-400'}`}
              >
                {job.status === 'paused' ? <Play size={14} /> : <Pause size={14} />}
              </button>
            </Tooltip>
          )}
          {isWorking && (
            <Tooltip content="Cancel">
              <button
                onClick={() => cancelJob(job.id)}
                className="p-1.5 text-gray-600 hover:text-red-400 transition-colors"
              >
                <Ban size={14} />
              </button>
            </Tooltip>
          )}
          {(isDone || isCancelled || isError || job.status === 'queued') && (
            <Tooltip content="Remove">
              <button
                onClick={() => removeJob(job.id)}
                className="p-1.5 text-gray-600 hover:text-red-400 transition-colors"
              >
                <Trash2 size={14} />
              </button>
            </Tooltip>
          )}
        </div>
      </div>
    )
  }

  const PresetItem = ({ p, deletable }: { p: ConversionPreset; deletable?: boolean }) => {
    const isRenaming = renamingId === p.id
    const isArchiveDefault = archivePresetId === p.id
    const isRecommended = recommendedArchiveId === p.id
    return (
      <div
        className={`group flex items-start border-b border-white/5 transition-colors ${
          selectedPreset?.id === p.id
            ? 'bg-purple-600/20 border-l-2 border-l-purple-500'
            : 'hover:bg-white/5'
        } ${!isRenaming ? 'cursor-pointer' : ''}`}
        onClick={!isRenaming ? () => setSelectedPreset(p) : undefined}
      >
        <div className="flex-1 min-w-0 px-4 py-3">
          {isRenaming ? (
            <input
              ref={renameInputRef}
              value={renameValue}
              onChange={e => setRenameValue(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') commitRename()
                if (e.key === 'Escape') cancelRename()
              }}
              onBlur={commitRename}
              onClick={e => e.stopPropagation()}
              className="w-full bg-navy-900 border border-purple-500/50 text-gray-200 text-sm rounded px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-purple-500/50"
              autoFocus
            />
          ) : (
            <div className="flex items-center gap-1.5">
              <div className="text-sm font-medium text-gray-200 truncate">{p.name}</div>
              {isArchiveDefault && (
                <Tooltip content="Default archive preset">
                  <span><Archive size={11} className="text-purple-400 shrink-0" /></span>
                </Tooltip>
              )}
              {isRecommended && (
                <Tooltip content="Recommended for your system">
                  <span><Star size={11} className="text-amber-400 shrink-0 fill-amber-400" /></span>
                </Tooltip>
              )}
            </div>
          )}
          {!isRenaming && p.description && (
            <Tooltip content={p.description} side="right" width="w-64" triggerClassName="block w-full">
              <div className="text-xs text-gray-500 mt-0.5 truncate">{p.description}</div>
            </Tooltip>
          )}
        </div>
        {deletable && !isRenaming && (
          <div className="flex opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-2 mr-1">
            <Tooltip content="Rename preset">
              <button
                onClick={e => { e.stopPropagation(); startRename(p) }}
                className="p-1.5 text-gray-600 hover:text-blue-400 transition-colors"
              >
                <Pencil size={11} />
              </button>
            </Tooltip>
            <Tooltip content="Remove preset">
              <button
                onClick={e => { e.stopPropagation(); deleteImported(p.id) }}
                className="p-1.5 text-gray-600 hover:text-red-400 transition-colors"
              >
                <Trash2 size={11} />
              </button>
            </Tooltip>
          </div>
        )}
      </div>
    )
  }

  return (
    <>
    <div className="flex h-full overflow-hidden">
      {/* Left: presets sidebar */}
      <div className="w-64 bg-navy-800 border-r border-white/5 flex flex-col shrink-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-white/5">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Presets</h3>
        </div>

        <div className="flex-1 overflow-hidden pr-2"><div className="h-full overflow-y-auto">
          {builtinPresets.map(p => <PresetItem key={p.id} p={p} />)}

          {importedPresets.length > 0 && (
            <>
              <div className="px-4 pt-3 pb-1">
                <span className="text-[10px] font-semibold text-gray-600 uppercase tracking-wider">Imported</span>
              </div>
              {importedPresets.map(p => <PresetItem key={p.id} p={p} deletable />)}
            </>
          )}
        </div>

        </div>
        {/* Import button */}
        <div className="p-3 border-t border-white/5 flex flex-col gap-2">
          {importError && (
            <p className="text-xs text-red-400 leading-tight">{importError}</p>
          )}
          <Button
            variant="secondary"
            size="sm"
            className="w-full"
            icon={importing ? <RefreshCw size={12} className="animate-spin" /> : <Upload size={12} />}
            onClick={importPreset}
            disabled={importing}
          >
            Import JSON Preset
          </Button>
        </div>
      </div>

      {/* Right: file drop + queue */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="px-6 py-4 border-b border-white/5 flex items-center gap-3 shrink-0">
          <h1 className="text-lg font-semibold flex-1">Converter</h1>
        </div>

        <div className="flex-1 overflow-hidden pr-2"><div className="h-full overflow-y-auto p-4 flex flex-col gap-4">
          {queuedFiles.length > 0 && (
            <div className="bg-navy-800 border border-white/5 rounded-lg overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2 border-b border-white/5 flex-wrap gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xs font-medium text-gray-400 shrink-0">{queuedFiles.length} file(s) ready</span>
                  {selectedPreset && (
                    <Tooltip content="Preset that will apply to these files when started">
                      <span className="text-xs px-2 py-0.5 rounded-full border text-purple-300 bg-purple-900/30 border-purple-300/40 truncate">
                        {selectedPreset.name}
                      </span>
                    </Tooltip>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-gray-500">
                      Output: {outputDir ? outputDir : 'Next to original'}
                    </span>
                    {outputDir && (
                      <button
                        onClick={() => setOutputDir('')}
                        className="text-xs text-gray-600 hover:text-gray-300 transition-colors"
                      >
                        Clear
                      </button>
                    )}
                    <Button variant="ghost" size="sm" icon={<FolderOpen size={12} />} onClick={pickOutputDir}>
                      Change
                    </Button>
                  </div>
                  <Button
                    variant="primary"
                    size="sm"
                    icon={<Zap size={12} />}
                    onClick={startAll}
                    disabled={!selectedPreset}
                  >
                    Start
                  </Button>
                </div>
              </div>
              {queuedFiles.map(f => (
                <div key={f} className="flex items-center gap-2 px-4 py-2 border-b border-white/5 last:border-0">
                  <span className="flex-1 text-xs text-gray-400 truncate" title={f}>
                    {f.split(/[\\/]/).pop()}
                  </span>
                  {selectedPreset && (
                    <span className="text-xs text-gray-600 shrink-0">
                      → {getOutputPath(f, selectedPreset, outputDir).split(/[\\/]/).pop()}
                    </span>
                  )}
                  <button onClick={() => removeFile(f)} className="p-1 text-gray-600 hover:text-red-400 transition-colors shrink-0">
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="bg-navy-800 border border-white/5 rounded-lg overflow-hidden">
              <div className="flex items-center justify-between gap-2 px-4 py-2 border-b border-white/5">
                <span className="text-xs font-medium text-gray-400">Queue {jobs.length > 0 ? `(${jobs.length})` : ''}</span>
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
              {jobs.length === 0 && (
                <div className="px-4 py-6 text-center text-xs text-gray-600">Nothing in the queue</div>
              )}
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
                          <span className="text-[11px] text-gray-500 shrink-0 tabular-nums">· {groupSummary}</span>
                          <div className="flex-1 mx-2">
                            <ProgressBar percent={aggregatePct} status={groupActive ? 'running' : (errN > 0 ? 'error' : 'done')} />
                          </div>
                          {groupActive && (
                            <Tooltip content="Cancel all jobs in this group">
                              <button
                                onClick={() => window.api.cancelJobGroup(job.groupId!)}
                                className="p-1 text-gray-600 hover:text-red-400 transition-colors shrink-0"
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

          <FileDropZone
            onFiles={addFiles}
            accept={['mkv', 'mp4', 'mov', 'avi', 'ts', 'flv', 'webm']}
            label="Drop video files here to convert"
            className="min-h-[100px]"
          />
          <p className="text-xs text-gray-600 px-1">You can also send videos here from the Streams page using the action buttons on each row.</p>
        </div></div>
      </div>
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
          <p className="text-xs text-gray-500 font-mono break-all bg-navy-900 border border-white/5 rounded-lg px-3 py-2">
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
    </>
  )
}
