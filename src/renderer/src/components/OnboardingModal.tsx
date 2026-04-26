import React, { useState, useEffect } from 'react'
import { FolderOpen, CheckCircle, MoveRight, HelpCircle, AlertTriangle, Info } from 'lucide-react'
import { v4 as uuidv4 } from 'uuid'
import { Modal } from './ui/Modal'
import { Button } from './ui/Button'
import { Tooltip } from './ui/Tooltip'
import { DumpConvertExplainer } from './DumpConvertExplainer'
import type { StreamMode, WatchRule, DetectedStructure } from '../types'
import imgFolderPerStream from '../assets/onboarding/per-stream-folders.png'
import imgDumpFolder from '../assets/onboarding/stream-dump-folder.png'

interface Props {
  isOpen: boolean
  onComplete: () => void
}

// ── Mode cards (shared) ───────────────────────────────────────────────────────

interface ModeCardProps {
  selected: boolean
  suggested: boolean
  onSelect: () => void
  title: string
  flavor: string
  image: string
}

function ModeCard({ selected, suggested, onSelect, title, flavor, image }: ModeCardProps) {
  return (
    <button
      onClick={onSelect}
      className={`relative flex-1 flex flex-col items-center gap-3 p-5 rounded-xl border-2 transition-all text-left ${
        selected
          ? 'border-purple-500 bg-purple-600/15'
          : 'border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/8'
      }`}
    >
      {suggested && (
        <span className="absolute top-2 right-2 text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-400/30">
          Detected
        </span>
      )}
      <img src={image} alt={title} className="w-full aspect-video rounded-lg object-cover" />
      <div className="flex flex-col gap-1 w-full">
        <div className="flex items-center justify-between gap-2">
          <span className={`text-sm font-semibold ${selected ? 'text-purple-200' : 'text-gray-200'}`}>{title}</span>
          <div className={`w-4 h-4 rounded-full border-2 shrink-0 transition-all ${
            selected ? 'border-purple-400 bg-purple-400' : 'border-white/20'
          }`} />
        </div>
        <span className="text-xs text-gray-400 leading-relaxed">{flavor}</span>
      </div>
    </button>
  )
}

// ── Step 1: Combined picker + auto-detect ─────────────────────────────────────

interface StepSetupProps {
  streamsDir: string
  selectedMode: StreamMode
  detection: DetectedStructure | null
  scanning: boolean
  onPickDir: () => void
  onModeChange: (mode: StreamMode) => void
}

type DetectionTone = 'ok' | 'info' | 'warn'

function describeDetection(d: DetectedStructure): { tone: DetectionTone; headline: string; detail: string } {
  if (d.layoutKind === 'flat') {
    return {
      tone: 'ok',
      headline: `${d.sessionCount} stream${d.sessionCount === 1 ? '' : 's'} detected — folder per stream (flat)`,
      detail: 'Each stream is its own date-named folder directly inside the chosen directory.',
    }
  }
  if (d.layoutKind === 'nested') {
    const sample = d.groupingHints[0]
    const example = sample ? ` (e.g. ${sample}/)` : ''
    return {
      tone: 'info',
      headline: `${d.sessionCount} stream${d.sessionCount === 1 ? '' : 's'} detected — folder per stream (nested ${d.nestingDepth} level${d.nestingDepth === 1 ? '' : 's'} deep)`,
      detail: `Stream folders are grouped under intermediate directories${example}.`,
    }
  }
  if (d.layoutKind === 'dump') {
    return {
      tone: 'info',
      headline: `${d.sessionCount} stream${d.sessionCount === 1 ? '' : 's'} detected — dump folder`,
      detail: 'Files for multiple streams share a single folder, distinguished by the date in the filename.',
    }
  }
  if (d.isEmpty) {
    return {
      tone: 'ok',
      headline: 'Empty folder — setting you up with the default layout',
      detail: 'Stream Manager will create one date-named folder per stream here, exactly the way the app is designed to work.',
    }
  }
  return {
    tone: 'warn',
    headline: 'Nothing recognisable in this folder',
    detail: 'Stream Manager looks for date-named folders (YYYY-MM-DD) or files whose names include a date. This is usually a sign that the wrong folder was selected — try picking the folder where your streams actually live. If you have an unusual layout, you can choose a mode manually below.',
  }
}

function DetectionBanner({ detection }: { detection: DetectedStructure }) {
  const { tone, headline, detail } = describeDetection(detection)
  const colorClasses =
    tone === 'ok'   ? 'border-emerald-400/20 bg-emerald-400/5 text-emerald-200' :
    tone === 'warn' ? 'border-yellow-500/20 bg-yellow-500/5 text-yellow-200' :
                      'border-white/10 bg-white/5 text-gray-200'
  const Icon = tone === 'ok' ? CheckCircle : tone === 'warn' ? AlertTriangle : Info
  return (
    <div className={`flex items-start gap-2.5 rounded-lg border px-4 py-3 ${colorClasses}`}>
      <Icon size={16} className="shrink-0 mt-0.5" />
      <div className="flex flex-col gap-1">
        <p className="text-sm font-semibold">{headline}</p>
        <p className="text-xs text-gray-400 leading-relaxed">{detail}</p>
      </div>
    </div>
  )
}

function SamplesList({ samples, total }: { samples: DetectedStructure['samples']; total: number }) {
  if (samples.length === 0) return null
  const overflow = total - samples.length
  return (
    <div className="flex flex-col divide-y divide-white/5 rounded-xl border border-white/10 overflow-hidden">
      {samples.map(s => (
        <div key={s.relativePath} className="flex items-center justify-between gap-4 px-4 py-2.5">
          <span className="text-sm text-gray-300 font-medium tabular-nums shrink-0">{s.date}</span>
          <span className="text-xs text-gray-500 truncate text-right">
            {s.games.length > 0 ? s.games.join(', ') : '—'}
          </span>
        </div>
      ))}
      {overflow > 0 && (
        <div className="px-4 py-2.5 text-xs text-gray-600">
          …and {overflow} more
        </div>
      )}
    </div>
  )
}

function StepSetup({ streamsDir, selectedMode, detection, scanning, onPickDir, onModeChange }: StepSetupProps) {
  const [overrideOpen, setOverrideOpen] = useState(false)
  // Reset the override toggle whenever the user picks a different folder.
  useEffect(() => { setOverrideOpen(false) }, [streamsDir])

  const suggested = detection?.suggestedMode || ''
  const detected = !!detection && detection.layoutKind !== 'unknown'
  // Cards appear when:
  //  - detection failed AND the folder isn't empty (genuine ambiguity — show fallback)
  //  - the user explicitly opened the override
  const showCards = !!detection && (
    overrideOpen || (detection.layoutKind === 'unknown' && !detection.isEmpty)
  )

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-gray-400 leading-relaxed">
        Select the folder where your stream sessions live. Stream Manager will scan it and figure out how it's organized so you can confirm and continue.
      </p>

      <div className="flex gap-2">
        <input
          className="flex-1 bg-navy-900 border border-white/10 text-gray-200 text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500/50"
          value={streamsDir}
          readOnly
          placeholder="Select your streams folder…"
        />
        <Button variant="secondary" size="sm" icon={<FolderOpen size={14} />} onClick={onPickDir}>
          Browse
        </Button>
      </div>

      {scanning && (
        <p className="text-sm text-gray-500 animate-pulse">Scanning folder…</p>
      )}

      {!scanning && detection && (
        <>
          <DetectionBanner detection={detection} />

          {detection.layoutKind === 'nested' && (
            <p className="rounded-lg border border-purple-400/30 bg-purple-500/10 px-4 py-3 text-sm text-purple-100 leading-relaxed">
              New streams created in the app will land as flat <span className="font-mono text-white">YYYY-MM-DD</span> folders at the root of your streams directory, regardless of how existing streams are grouped.
            </p>
          )}
          {detection.layoutKind === 'dump' && (
            <p className="rounded-lg border border-purple-400/30 bg-purple-500/10 px-4 py-3 text-sm text-purple-100 leading-relaxed">
              Some features are reduced in dump-folder mode. The next step can convert your dump folder into folder-per-stream for the full experience.
            </p>
          )}

          {detection.samples.length > 0 && (
            <div className="flex flex-col gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500">Sample sessions</h3>
              <SamplesList samples={detection.samples} total={detection.sessionCount} />
            </div>
          )}

          {/* Quiet escape hatch when detection succeeded — keep the default UX clean,
              but let power users / mis-detections override the mode. */}
          {detected && !overrideOpen && (
            <button
              type="button"
              onClick={() => setOverrideOpen(true)}
              className="self-start text-xs text-gray-500 hover:text-gray-300 underline underline-offset-2 transition-colors"
            >
              Not what you expected? Choose mode manually
            </button>
          )}

          {showCards && (
            <div className="flex flex-col gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                {detected ? 'Override the detected mode' : 'Pick a mode'}
              </h3>
              <div className="flex gap-4">
                <ModeCard
                  selected={selectedMode === 'folder-per-stream'}
                  suggested={suggested === 'folder-per-stream'}
                  onSelect={() => onModeChange('folder-per-stream')}
                  title="Folder per stream"
                  flavor="Each stream and related items go into a folder specific to that stream"
                  image={imgFolderPerStream}
                />
                <ModeCard
                  selected={selectedMode === 'dump-folder'}
                  suggested={suggested === 'dump-folder'}
                  onSelect={() => onModeChange('dump-folder')}
                  title="Dump folder"
                  flavor="All streams and related items are all together in a single folder"
                  image={imgDumpFolder}
                />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── Step 2: Convert dump folder (only shown when mode is 'dump-folder') ───────

type ConvertStatus = 'idle' | 'converting' | 'done' | 'undoing' | 'undone'
interface ConvertManifest { moves: { from: string; to: string }[]; createdFolders: string[] }
interface ConvertResult { moved: number; skipped: number; manifest: ConvertManifest }

interface StepConvertProps {
  dir: string
  result: ConvertResult | null
  onResult: (result: ConvertResult | null) => void
  onConverted: () => void
}

function StepConvert({ dir, result, onResult, onConverted }: StepConvertProps) {
  const [status, setStatus] = useState<ConvertStatus>(result ? 'done' : 'idle')

  const convert = async () => {
    if (!dir) return
    setStatus('converting')
    const res = await window.api.convertDumpFolder(dir)
    onResult(res)
    setStatus('done')
    // Conversion turns this dir into folder-per-stream
    await window.api.setConfig({ streamMode: 'folder-per-stream' })
    onConverted()
  }

  const undo = async () => {
    if (!result) return
    setStatus('undoing')
    await window.api.undoConvertDumpFolder(result.manifest)
    setStatus('undone')
    onResult(null)
    await window.api.setConfig({ streamMode: 'dump-folder' })
  }

  return (
    <div className="flex flex-col gap-5">
      <DumpConvertExplainer />

      <div className="flex justify-center">
        {status === 'done' ? (
          <Button variant="secondary" size="lg" onClick={undo}>
            Undo structure update
          </Button>
        ) : (
          <Button
            variant="primary"
            size="lg"
            onClick={convert}
            disabled={!dir || status === 'converting' || status === 'undoing'}
          >
            {status === 'converting' ? 'Converting…' : status === 'undoing' ? 'Undoing…' : 'Update structure'}
          </Button>
        )}
      </div>

      {status === 'done' && result && (
        <div className="flex items-start gap-2 text-sm text-green-400 bg-green-400/10 border border-green-400/20 rounded-lg px-4 py-3">
          <CheckCircle size={16} className="shrink-0 mt-0.5" />
          <span>
            Done — {result.manifest.createdFolders.length} folder{result.manifest.createdFolders.length !== 1 ? 's' : ''} created, {result.moved} file{result.moved !== 1 ? 's' : ''} organized.
            {result.skipped > 0 && ` ${result.skipped} file${result.skipped !== 1 ? 's' : ''} with no date in the filename were left in place.`}
          </span>
        </div>
      )}

      {status === 'undone' && (
        <div className="flex items-start gap-2 text-sm text-gray-400 bg-white/5 border border-white/10 rounded-lg px-4 py-3">
          <CheckCircle size={16} className="shrink-0 mt-0.5" />
          <span>Undone — files have been moved back to their original locations.</span>
        </div>
      )}
    </div>
  )
}

// ── Step 3: Suggested auto-rule ───────────────────────────────────────────────

interface StepAutoRuleProps {
  streamsDir: string
  recordingsDir: string
  pattern: string
  onRecordingsDirChange: (dir: string) => void
  onPatternChange: (pattern: string) => void
}

function StepAutoRule({ streamsDir, recordingsDir, pattern, onRecordingsDirChange, onPatternChange }: StepAutoRuleProps) {
  const pick = async () => {
    const picked = await window.api.openDirectoryDialog()
    if (picked) onRecordingsDirChange(picked)
  }

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-gray-400 leading-relaxed">
        If your streaming software saves recordings to a separate folder, Stream Manager can auto-move new files into your streams folder. Skip this step if it doesn't match your workflow — rules can be added or changed later on the <span className="font-semibold text-gray-200">Auto-rules</span> page.
      </p>

      <div className="flex flex-col gap-4">
        {/* Source */}
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-gray-300">Recordings folder <span className="text-gray-500 font-normal">(where your streaming software saves files)</span></label>
          <div className="flex gap-2">
            <input
              className="flex-1 bg-navy-900 border border-white/10 text-gray-200 text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500/50"
              value={recordingsDir}
              readOnly
              placeholder="Select your recordings folder…"
            />
            <Button variant="secondary" size="sm" icon={<FolderOpen size={14} />} onClick={pick}>
              Browse
            </Button>
          </div>
        </div>

        {/* Arrow + destination */}
        <div className="flex items-center gap-3">
          <div className="flex-1 h-px bg-white/10" />
          <div className="flex items-center gap-1.5 text-xs text-gray-500">
            <MoveRight size={14} />
            <span>moves to</span>
          </div>
          <div className="flex-1 h-px bg-white/10" />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-gray-300">Destination <span className="text-gray-500 font-normal">(your streams folder)</span></label>
          <input
            className="flex-1 bg-navy-900/50 border border-white/10 text-gray-500 text-sm rounded-lg px-3 py-2 cursor-not-allowed"
            value={streamsDir}
            readOnly
          />
        </div>

        {/* Pattern */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5">
            <label className="text-sm font-medium text-gray-300">File pattern <span className="text-gray-500 font-normal">(which files to watch for)</span></label>
            <Tooltip width="w-72" content={
              <>
                <p className="font-semibold text-gray-200 mb-1">Glob pattern syntax</p>
                <p><span className="font-mono text-purple-300">*</span> — matches any sequence of characters</p>
                <p><span className="font-mono text-purple-300">?</span> — matches any single character</p>
                <p><span className="font-mono text-purple-300">{'*.{mkv,mp4}'}</span> — matches multiple types using comma-separated values inside <span className="font-mono">{'{}'}</span></p>
                <p className="mt-1.5 font-semibold text-gray-400">Examples</p>
                <p><span className="font-mono text-purple-300">*.mkv</span> — all MKV files (OBS default)</p>
                <p><span className="font-mono text-purple-300">*.mp4</span> — all MP4 files</p>
                <p><span className="font-mono text-purple-300">{'*.{mkv,mp4}'}</span> — MKV or MP4</p>
                <p><span className="font-mono text-purple-300">*</span> — all files <span className="text-gray-500">(not recommended)</span></p>
              </>
            }>
              <HelpCircle size={14} className="text-gray-600 hover:text-gray-400 cursor-default transition-colors" />
            </Tooltip>
          </div>
          <input
            className="w-48 bg-navy-900 border border-white/10 text-gray-200 text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500/50"
            value={pattern}
            onChange={e => onPatternChange(e.target.value)}
            placeholder="e.g. *.mkv"
            spellCheck={false}
          />
        </div>
      </div>
    </div>
  )
}

// ── Step 4: Done ──────────────────────────────────────────────────────────────

interface StepDoneProps {
  mode: StreamMode
  streamsDir: string
  convertResult: ConvertResult | null
  autoRule: WatchRule | null
}

function StepDone({ mode, streamsDir, convertResult, autoRule }: StepDoneProps) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500">Summary</h3>
        <div className="flex flex-col divide-y divide-white/5 rounded-xl border border-white/10 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-sm text-gray-400">Mode</span>
            <span className="text-sm text-gray-200 font-medium">
              {mode === 'folder-per-stream' ? 'Folder per stream' : 'Dump folder'}
            </span>
          </div>
          <div className="flex items-start justify-between gap-4 px-4 py-3">
            <span className="text-sm text-gray-400 shrink-0">Streams directory</span>
            <span className="text-sm text-gray-200 font-medium text-right break-all">{streamsDir}</span>
          </div>
          {convertResult && (
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-sm text-gray-400">Structure update</span>
              <span className="text-sm text-gray-200 font-medium">
                {convertResult.manifest.createdFolders.length} folder{convertResult.manifest.createdFolders.length !== 1 ? 's' : ''} created, {convertResult.moved} file{convertResult.moved !== 1 ? 's' : ''} organized
              </span>
            </div>
          )}
          {autoRule && (
            <div className="flex items-start justify-between gap-4 px-4 py-3">
              <span className="text-sm text-gray-400 shrink-0">Auto-rule created</span>
              <span className="text-sm text-gray-200 font-medium text-right break-all">{autoRule.watchPath}</span>
            </div>
          )}
        </div>
      </div>

      <p className="text-sm text-gray-400 leading-relaxed">
        You're all set up! The app will scan your directory and show the detected sessions on the <span className="font-bold text-gray-200">Streams</span> page. You can then begin exploring, tagging, converting, and much more!
      </p>
    </div>
  )
}

// ── Orchestrator ──────────────────────────────────────────────────────────────

type Step = 'setup' | 'convert' | 'auto-rule' | 'done'

export function OnboardingModal({ isOpen, onComplete }: Props) {
  const [step, setStep] = useState<Step>('setup')
  const [streamsDir, setStreamsDir] = useState('')
  const [selectedMode, setSelectedMode] = useState<StreamMode>('')
  const [detection, setDetection] = useState<DetectedStructure | null>(null)
  const [scanning, setScanning] = useState(false)
  const [convertResult, setConvertResult] = useState<ConvertResult | null>(null)
  const [recordingsDir, setRecordingsDir] = useState('')
  const [rulePattern, setRulePattern] = useState('*.{mkv,mp4}')
  const [createdRule, setCreatedRule] = useState<WatchRule | null>(null)

  const pickDir = async () => {
    const picked = await window.api.openDirectoryDialog()
    if (!picked) return
    setStreamsDir(picked)
    setDetection(null)
    setConvertResult(null)
    setScanning(true)
    try {
      const result = await window.api.detectStreamStructure(picked)
      setDetection(result)
      // Detected layout wins. Empty folders auto-apply the canonical default
      // (folder-per-stream) so the user can just hit Next without picking a mode.
      if (result.suggestedMode) setSelectedMode(result.suggestedMode)
      else if (result.isEmpty) setSelectedMode('folder-per-stream')
    } catch {
      setDetection({ suggestedMode: '', layoutKind: 'unknown', nestingDepth: 0, sessionCount: 0, samples: [], groupingHints: [], isEmpty: false })
    } finally {
      setScanning(false)
    }
  }

  const handleBack = () => {
    if (step === 'convert') setStep('setup')
    else if (step === 'auto-rule') setStep(selectedMode === 'dump-folder' ? 'convert' : 'setup')
    else if (step === 'done') setStep('auto-rule')
  }

  const handleNext = async () => {
    if (step === 'setup') {
      if (!streamsDir || !selectedMode) return
      await window.api.setConfig({ streamsDir, streamMode: selectedMode })
      setStep(selectedMode === 'dump-folder' ? 'convert' : 'auto-rule')
      return
    }
    if (step === 'convert') {
      setStep('auto-rule')
      return
    }
    if (step === 'auto-rule') {
      if (recordingsDir) {
        const rule: WatchRule = {
          id: uuidv4(),
          enabled: true,
          watchPath: recordingsDir,
          pattern: rulePattern || '*',
          action: 'move',
          destinationMode: 'auto',
          destination: streamsDir,
          autoMatchDate: true,
          onlyNewFiles: true,
        }
        const existing = await window.api.getWatchRules()
        await window.api.setWatchRules([...existing, rule])
        setCreatedRule(rule)
      }
      setStep('done')
      return
    }
    if (step === 'done') {
      onComplete()
    }
  }

  const titles: Record<Step, string> = {
    'setup': 'Set up your streams folder',
    'convert': 'Convert your dump folder (Recommended)',
    'auto-rule': 'Set up automatic file moving',
    'done': 'Ready to go!',
  }

  // Conversion bumps the user into folder-per-stream mode mid-flow
  const onConverted = () => setSelectedMode('folder-per-stream')

  const nextDisabled =
    (step === 'setup' && (!streamsDir || !selectedMode))

  const nextLabel = step === 'done' ? 'Get started' : step === 'auto-rule' ? (recordingsDir ? 'Create rule & continue' : 'Skip') : 'Next'

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => {}}
      title={titles[step]}
      width="2xl"
      dismissible={false}
      footer={
        <div className="flex items-center justify-between w-full">
          {step === 'setup' ? (
            <Button variant="ghost" onClick={() => window.api.windowClose()}>
              Close Stream Manager
            </Button>
          ) : (
            <Button variant="ghost" onClick={handleBack}>
              Back
            </Button>
          )}
          <Button variant="primary" onClick={handleNext} disabled={nextDisabled}>
            {nextLabel}
          </Button>
        </div>
      }
    >
      {step === 'setup' && (
        <StepSetup
          streamsDir={streamsDir}
          selectedMode={selectedMode}
          detection={detection}
          scanning={scanning}
          onPickDir={pickDir}
          onModeChange={setSelectedMode}
        />
      )}
      {step === 'convert' && (
        <StepConvert
          dir={streamsDir}
          result={convertResult}
          onResult={setConvertResult}
          onConverted={onConverted}
        />
      )}
      {step === 'auto-rule' && (
        <StepAutoRule
          streamsDir={streamsDir}
          recordingsDir={recordingsDir}
          pattern={rulePattern}
          onRecordingsDirChange={setRecordingsDir}
          onPatternChange={setRulePattern}
        />
      )}
      {step === 'done' && (
        <StepDone mode={selectedMode} streamsDir={streamsDir} convertResult={convertResult} autoRule={createdRule} />
      )}
    </Modal>
  )
}
