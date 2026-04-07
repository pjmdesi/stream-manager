import React, { useState } from 'react'
import { FolderOpen, CheckCircle } from 'lucide-react'
import { Modal } from './ui/Modal'
import { Button } from './ui/Button'
import type { StreamMode } from '../types'
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
            Done — {result.manifest.createdFolders.length} folder{result.manifest.createdFolders.length !== 1 ? 's' : ''} created, {result.moved} file{result.moved !== 1 ? 's' : ''} organised.
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

// ── Step 3: Done ──────────────────────────────────────────────────────────────

interface Step3Props {
  mode: StreamMode
  streamsDir: string
  convertResult: ConvertResult | null
}

function Step3({ mode, streamsDir, convertResult }: Step3Props) {
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
                {convertResult.manifest.createdFolders.length} folder{convertResult.manifest.createdFolders.length !== 1 ? 's' : ''} created, {convertResult.moved} file{convertResult.moved !== 1 ? 's' : ''} organised
              </span>
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
  onDirChange: (dir: string) => void
}

function Step2({ streamsDir, onDirChange }: Step2Props) {
  const pickDir = async () => {
    const picked = await window.api.openDirectoryDialog()
    if (picked) onDirChange(picked)
  }

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
    </div>
  )
}

// ── Orchestrator ──────────────────────────────────────────────────────────────

type Step = 'mode' | 'convert' | 'streams-dir' | 'done'

export function OnboardingModal({ isOpen, onComplete }: Props) {
  const [step, setStep] = useState<Step>('mode')
  const [selectedMode, setSelectedMode] = useState<StreamMode>('')
  const [dumpDir, setDumpDir] = useState('')
  const [streamsDir, setStreamsDir] = useState('')
  const [convertResult, setConvertResult] = useState<ConvertResult | null>(null)

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
    'done': 'Ready to go!',
  }

  const nextDisabled =
    (step === 'mode' && !selectedMode) ||
    (step === 'streams-dir' && !streamsDir)

  const nextLabel = step === 'done' ? 'Get started' : 'Next'

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
        <Step2 streamsDir={streamsDir} onDirChange={setStreamsDir} />
      )}
      {step === 'done' && (
        <Step3 mode={selectedMode} streamsDir={streamsDir} convertResult={convertResult} />
      )}
    </Modal>
  )
}
