import React, { useState } from 'react'
import { FolderOpen, CheckCircle, MoveRight, HelpCircle } from 'lucide-react'
import { v4 as uuidv4 } from 'uuid'
import { Modal } from './ui/Modal'
import { Button } from './ui/Button'
import { Tooltip } from './ui/Tooltip'
import type { StreamMode, WatchRule } from '../types'
import imgFolderPerStream from '../assets/onboarding/per-stream-folders.png'
import imgDumpFolder from '../assets/onboarding/stream-dump-folder.png'

interface Props {
  isOpen: boolean
  onComplete: () => void
}

// ── Step 1: Mode selection ────────────────────────────────────────────────────

interface ModeCardProps {
  value: StreamMode
  selected: boolean
  onSelect: () => void
  title: string
  flavor: string
  image: string
}

function ModeCard({ value: _value, selected, onSelect, title, flavor, image }: ModeCardProps) {
  return (
    <button
      onClick={onSelect}
      className={`flex-1 flex flex-col items-center gap-3 p-5 rounded-xl border-2 transition-all text-left ${
        selected
          ? 'border-purple-500 bg-purple-600/15'
          : 'border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/8'
      }`}
    >
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

interface Step1Props {
  selectedMode: StreamMode
  onSelect: (mode: StreamMode) => void
}

function Step1({ selectedMode, onSelect }: Step1Props) {
  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-gray-400 leading-relaxed">
        Pick which option best describes the way you organize your recordings. This sets the mode of the app. If your content is structured as a mix of these or something else, the app is not currently designed to handle that.
      </p>
      <div className="flex gap-4">
        <ModeCard
          value="folder-per-stream"
          selected={selectedMode === 'folder-per-stream'}
          onSelect={() => onSelect('folder-per-stream')}
          title="Folder per stream"
          flavor="Each stream and related items go into a folder specific to that stream"
          image={imgFolderPerStream}
        />
        <ModeCard
          value="dump-folder"
          selected={selectedMode === 'dump-folder'}
          onSelect={() => onSelect('dump-folder')}
          title="Dump folder"
          flavor="All streams and related items are all together in a single folder"
          image={imgDumpFolder}
        />
      </div>
    </div>
  )
}

// ── Step 1.5: Convert dump folder ─────────────────────────────────────────────

type ConvertStatus = 'idle' | 'converting' | 'done' | 'undoing' | 'undone'

interface ConvertManifest { moves: { from: string; to: string }[]; createdFolders: string[] }
interface ConvertResult { moved: number; skipped: number; manifest: ConvertManifest }

interface Step1_5Props {
  dir: string
  onDirChange: (dir: string) => void
  onResult: (result: ConvertResult | null) => void
}

function Step1_5({ dir, onDirChange, onResult }: Step1_5Props) {
  const [status, setStatus] = useState<ConvertStatus>('idle')
  const [result, setResult] = useState<ConvertResult | null>(null)

  const pickDir = async () => {
    const picked = await window.api.openDirectoryDialog()
    if (picked) { onDirChange(picked); setResult(null); setStatus('idle') }
  }

  const convert = async () => {
    if (!dir) return
    setStatus('converting')
    const res = await window.api.convertDumpFolder(dir)
    setResult(res)
    setStatus('done')
    onResult(res)
    await window.api.setConfig({ streamMode: 'folder-per-stream' })
  }

  const undo = async () => {
    if (!result) return
    setStatus('undoing')
    await window.api.undoConvertDumpFolder(result.manifest)
    setStatus('undone')
    setResult(null)
    onResult(null)
    await window.api.setConfig({ streamMode: 'dump-folder' })
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <p className="text-sm text-gray-400 leading-relaxed">
          It's recommended (but not required) that you convert your dump folder to the folder-per-stream structure.
          It prevents certain ambiguity issues and helps organize related files. If you would like, this app can handle
          this for you. Select your stream dump folder, and click the "Update structure" button below. This will detect
          each stream session and related assets based on the filename of your stream recording files.
        </p>
        <p className="text-xs text-gray-500 italic leading-relaxed">
          Your recording files must include the full date in the filename with format YYYY-MM-DD (this is the default naming convention for OBS).
          This process will not touch any subfolders in your selected directory.
        </p>
      </div>

      <p className="text-sm text-gray-400">
        If not, simply move on to the next step!
      </p>

      <div className="flex flex-col gap-2">
        <div className="flex gap-2">
          <input
            className="flex-1 bg-navy-900 border border-white/10 text-gray-200 text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500/50"
            value={dir}
            readOnly
            placeholder="Select your dump folder…"
          />
          <Button variant="secondary" size="sm" icon={<FolderOpen size={14} />} onClick={pickDir} disabled={status === 'converting' || status === 'undoing'}>
            Browse
          </Button>
        </div>

        {status === 'done' ? (
          <Button variant="secondary" size="sm" onClick={undo}>
            Undo structure update
          </Button>
        ) : (
          <Button
            variant="primary"
            size="sm"
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

// ── Step 2.5: Suggested auto-rule ─────────────────────────────────────────────

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
        Many streamers save recordings to a separate folder — often kept off a cloud or NAS drive to avoid sync conflicts — and then move them into their organized streams folder afterward. Stream Manager can automate this for you with an <span className="font-semibold text-gray-200">Auto-rule</span>.
      </p>
      <p className="text-sm text-gray-400 leading-relaxed">
        If this matches your workflow, enter the folder where your streaming software saves recordings. The rule will automatically move new files into your streams folder. You can adjust or disable this at any time from the <span className="font-semibold text-gray-200">Auto-rules</span> page.
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

// ── Step 3: Done ──────────────────────────────────────────────────────────────

interface Step3Props {
  mode: StreamMode
  streamsDir: string
  convertResult: ConvertResult | null
  autoRule: WatchRule | null
}

function Step3({ mode, streamsDir, convertResult, autoRule }: Step3Props) {
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

// ── Step 2: Streams directory ─────────────────────────────────────────────────

interface Step2Props {
  streamsDir: string
  mode: StreamMode
  onDirChange: (dir: string) => void
}

function Step2({ streamsDir, mode, onDirChange }: Step2Props) {
  const [scanning, setScanning] = useState(false)
  const [preview, setPreview] = useState<{ date: string; games: string[] }[] | null>(null)

  const pickDir = async () => {
    const picked = await window.api.openDirectoryDialog()
    if (picked) {
      onDirChange(picked)
      setPreview(null)
      setScanning(true)
      try {
        const folders = await window.api.listStreams(picked, mode || 'folder-per-stream')
        setPreview(
          folders.map(f => ({
            date: f.date,
            games: f.meta?.games ?? f.detectedGames ?? [],
          }))
        )
      } catch {
        setPreview([])
      } finally {
        setScanning(false)
      }
    }
  }

  const shown = preview?.slice(0, 5) ?? []
  const overflow = (preview?.length ?? 0) - shown.length

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-gray-400 leading-relaxed">
        Select the folder where your stream sessions live. This is the directory Stream Manager will use to detect and manage your stream sessions and the related files.
      </p>
      <div className="flex gap-2">
        <input
          className="flex-1 bg-navy-900 border border-white/10 text-gray-200 text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500/50"
          value={streamsDir}
          readOnly
          placeholder="Select your streams folder…"
        />
        <Button variant="secondary" size="sm" icon={<FolderOpen size={14} />} onClick={pickDir}>
          Browse
        </Button>
      </div>

      {scanning && (
        <p className="text-sm text-gray-500 animate-pulse">Scanning folder…</p>
      )}

      {!scanning && preview !== null && (
        preview.length === 0 ? (
          <div className="flex flex-col gap-1 rounded-lg border border-yellow-500/20 bg-yellow-500/5 px-4 py-3">
            <p className="text-sm text-yellow-400 font-medium">No stream sessions detected</p>
            <p className="text-xs text-gray-500">Make sure this is the correct folder and that it contains dated session folders or recordings.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">
              {preview.length} session{preview.length !== 1 ? 's' : ''} detected
            </p>
            <div className="flex flex-col divide-y divide-white/5 rounded-xl border border-white/10 overflow-hidden">
              {shown.map(s => (
                <div key={s.date} className="flex items-center justify-between gap-4 px-4 py-2.5">
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
            <div className="flex items-center gap-1.5 text-xs text-green-400">
              <CheckCircle size={13} />
              <span>Looks good — these sessions will appear on the Streams page.</span>
            </div>
          </div>
        )
      )}
    </div>
  )
}

// ── Orchestrator ──────────────────────────────────────────────────────────────

type Step = 'mode' | 'convert' | 'streams-dir' | 'auto-rule' | 'done'

export function OnboardingModal({ isOpen, onComplete }: Props) {
  const [step, setStep] = useState<Step>('mode')
  const [selectedMode, setSelectedMode] = useState<StreamMode>('')
  const [dumpDir, setDumpDir] = useState('')
  const [streamsDir, setStreamsDir] = useState('')
  const [convertResult, setConvertResult] = useState<ConvertResult | null>(null)
  const [recordingsDir, setRecordingsDir] = useState('')
  const [rulePattern, setRulePattern] = useState('*.{mkv,mp4}')
  const [createdRule, setCreatedRule] = useState<WatchRule | null>(null)

  // When the dump folder is picked in step 1.5, pre-fill streams dir for step 2
  const handleDumpDirChange = (dir: string) => {
    setDumpDir(dir)
    setStreamsDir(dir)
  }

  const handleNext = async () => {
    if (step === 'mode') {
      if (!selectedMode) return
      await window.api.setConfig({ streamMode: selectedMode })
      setStep(selectedMode === 'dump-folder' ? 'convert' : 'streams-dir')
      return
    }
    if (step === 'convert') {
      setStep('streams-dir')
      return
    }
    if (step === 'streams-dir') {
      if (!streamsDir) return
      await window.api.setConfig({ streamsDir })
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
    'mode': 'Get Started',
    'convert': 'Convert your dump folder (Recommended)',
    'streams-dir': 'Your streams folder',
    'auto-rule': 'Set up automatic file moving',
    'done': 'Ready to go!',
  }

  const nextDisabled =
    (step === 'mode' && !selectedMode) ||
    (step === 'streams-dir' && !streamsDir)

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
          {step === 'mode' ? (
            <Button variant="ghost" onClick={() => window.api.windowClose()}>
              Close Stream Manager
            </Button>
          ) : (
            <div />
          )}
          <Button variant="primary" onClick={handleNext} disabled={nextDisabled}>
            {nextLabel}
          </Button>
        </div>
      }
    >
      {step === 'mode' && (
        <Step1 selectedMode={selectedMode} onSelect={setSelectedMode} />
      )}
      {step === 'convert' && (
        <Step1_5 dir={dumpDir} onDirChange={handleDumpDirChange} onResult={setConvertResult} />
      )}
      {step === 'streams-dir' && (
        <Step2 streamsDir={streamsDir} mode={selectedMode} onDirChange={setStreamsDir} />
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
        <Step3 mode={selectedMode} streamsDir={streamsDir} convertResult={convertResult} autoRule={createdRule} />
      )}
    </Modal>
  )
}
