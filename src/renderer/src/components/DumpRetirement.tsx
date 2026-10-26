import React, { useState } from 'react'
import { AlertTriangle, CheckCircle } from 'lucide-react'
import { Modal } from './ui/Modal'
import { Button } from './ui/Button'
import { DumpConvertExplainer } from './DumpConvertExplainer'

// The dump-folder layout is being retired (APP-54). This release still
// opens a dump library; version 3.0.0 will open a library only in the
// folder-per-stream layout, with no date set for it. Three pieces say so
// and lead to the one-click conversion: a notice on the first launch in
// dump mode (acknowledged once, like the first-archive notice), a strip at
// the top of the Streams page that stays until the library is converted,
// and the conversion modal itself, shared with Settings.

/** The one-time notice on the first launch of a dump library. */
export function DumpRetirementModal({ isOpen, onConvert, onLater }: {
  isOpen: boolean
  /** Acknowledge and open the conversion. */
  onConvert: () => void
  /** Acknowledge and close; the Streams page strip keeps the reminder. */
  onLater: () => void
}) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onLater}
      title="Dump-folder libraries are being retired"
      width="lg"
      footer={
        <div className="flex items-center justify-end gap-2 w-full">
          <Button variant="ghost" onClick={onLater}>Not now</Button>
          <Button variant="primary" onClick={onConvert}>Convert now</Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3 text-sm text-gray-300 leading-relaxed">
        <p>
          Your library uses the dump-folder layout: every stream's files in one folder, told apart by the date in their names. Stream Manager 3.0.0 will open a library only in the folder-per-stream layout, so this one will have to be converted first. No date is set for that release; until then the app keeps opening the dump folder as it does today.
        </p>
        <p>
          The conversion moves each file into a folder named after its date. It takes one click and can be undone. Files with no date in their name stay where they are, and the app tells you how many.
        </p>
      </div>
    </Modal>
  )
}

/** The standing reminder at the top of the Streams page in dump mode. */
export function DumpRetirementStrip({ onConvert }: { onConvert: () => void }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-4 py-2 text-sm text-yellow-100 leading-relaxed">
      <AlertTriangle size={14} className="shrink-0" />
      <span className="flex-1 min-w-0">
        Dump-folder libraries are being retired. Stream Manager 3.0.0 will open this library only after it is converted to one folder per stream; no date is set.
      </span>
      <Button variant="secondary" size="sm" onClick={onConvert}>Convert</Button>
    </div>
  )
}

type ConvertManifest = { moves: { from: string; to: string }[]; createdFolders: string[] }
type ConvertResult = { moved: number; skipped: number; manifest: ConvertManifest }
type ConvertStatus = 'idle' | 'converting' | 'done' | 'undoing' | 'undone'

/** The conversion itself: the explainer, Update structure, then Undo or
 *  Close. Moved here from the Settings page so the first-launch notice and
 *  the Streams page strip open the same modal. A finished conversion sets
 *  the stream mode; the caller refreshes its config on close. */
export function DumpConvertModal({ isOpen, onClose, streamsDir }: {
  isOpen: boolean
  onClose: () => void
  streamsDir: string
}) {
  const [status, setStatus] = useState<ConvertStatus>('idle')
  const [result, setResult] = useState<ConvertResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  if (!isOpen) return null

  const convert = async () => {
    if (!streamsDir) return
    setStatus('converting')
    setError(null)
    try {
      const res = await window.api.convertDumpFolder(streamsDir)
      setResult(res)
      await window.api.setConfig({ streamMode: 'folder-per-stream' })
      setStatus('done')
    } catch (err: any) {
      setError(err?.message ?? String(err))
      setStatus('idle')
    }
  }

  const undo = async () => {
    if (!result) return
    setStatus('undoing')
    setError(null)
    try {
      await window.api.undoConvertDumpFolder(result.manifest)
      await window.api.setConfig({ streamMode: 'dump-folder' })
      setResult(null)
      setStatus('undone')
    } catch (err: any) {
      setError(err?.message ?? String(err))
      setStatus('done')
    }
  }

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Convert to folder-per-stream"
      width="2xl"
      footer={
        <div className="flex items-center justify-end gap-2 w-full">
          {status === 'done' ? (
            /* Done: Close is the most-likely-next action, so it takes the
               right/primary slot (style guide → Modal button order); the
               rarely-used Undo sits to its left. */
            <>
              <Button variant="secondary" onClick={undo}>Undo conversion</Button>
              <Button variant="primary" onClick={onClose}>Close</Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={onClose}>Cancel</Button>
              <Button variant="primary" onClick={convert} disabled={status === 'converting' || status === 'undoing'}>
                {status === 'converting' ? 'Converting…' : status === 'undoing' ? 'Undoing…' : 'Update structure'}
              </Button>
            </>
          )}
        </div>
      }
    >
      <DumpConvertExplainer />

      {status === 'done' && result && (
        <div className="mt-5 flex items-start gap-2 text-sm text-green-400 bg-green-400/10 border border-green-400/20 rounded-lg px-4 py-3">
          <CheckCircle size={16} className="shrink-0 mt-0.5" />
          <span>
            Done — {result.manifest.createdFolders.length} folder{result.manifest.createdFolders.length !== 1 ? 's' : ''} created, {result.moved} file{result.moved !== 1 ? 's' : ''} organized.
            {result.skipped > 0 && ` ${result.skipped} file${result.skipped !== 1 ? 's' : ''} with no date in the filename ${result.skipped === 1 ? 'was' : 'were'} left in place.`}
          </span>
        </div>
      )}

      {status === 'undone' && (
        <div className="mt-5 flex items-start gap-2 text-sm text-gray-400 bg-white/5 border border-white/10 rounded-lg px-4 py-3">
          <CheckCircle size={16} className="shrink-0 mt-0.5" />
          <span>Undone — files have been moved back to their original locations.</span>
        </div>
      )}

      {error && (
        <div className="mt-5 flex items-start gap-2 text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}
    </Modal>
  )
}
