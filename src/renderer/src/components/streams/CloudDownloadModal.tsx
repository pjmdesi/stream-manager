import { CloudDownload } from 'lucide-react'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'

/** Where the file goes once it has downloaded. Only 'player' is wired to
 *  a quiet (non-navigating) hand-off today; the others read the same way
 *  for when they are. */
export type CloudDownloadDestination = 'player' | 'converter' | 'combine'

const DESTINATION_COPY: Record<CloudDownloadDestination, { verb: string; where: string }> = {
  player: { verb: 'open in the player', where: 'the Player item in the navigation shows what is open' },
  converter: { verb: 'be added to the converter queue', where: 'the Converter item in the navigation shows the queue' },
  combine: { verb: 'be added to the combine list', where: 'the Combine page lists it' },
}

/**
 * Confirm step before downloading an offloaded (cloud placeholder) file the
 * user just sent somewhere. Confirming hands the download to the regular
 * cloud queue (progress in the cloud sync widget, failures with retry in
 * the cloud modal) and closes this dialog at once. The file is handed to
 * its destination when it lands, WITHOUT switching pages: a download can
 * take minutes and the user has moved on by then (STR-19, 2026-09-10).
 * There is deliberately no downloading stage and no cancel: a hydration in
 * progress cannot be stopped, so offering to stop it was a false promise.
 */
export function CloudDownloadModal({
  fileName,
  filePath,
  destination,
  onConfirm,
  onDismiss,
}: {
  fileName: string
  filePath: string
  destination: CloudDownloadDestination
  onConfirm: () => void
  onDismiss: () => void
}) {
  const copy = DESTINATION_COPY[destination]
  return (
    <Modal
      isOpen
      onClose={onDismiss}
      title="File not available on this device"
      width="lg"
      footer={
        <div className="flex gap-2 justify-end w-full">
          <Button variant="ghost" onClick={onDismiss}>Dismiss</Button>
          <Button variant="primary" icon={<CloudDownload size={13} />} onClick={onConfirm}>
            Download
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-sm text-gray-300">
          <span className="font-medium text-gray-100">{fileName}</span> is stored in the cloud and has not been downloaded to this device.
        </p>
        <p className="text-sm text-gray-400">
          Download it now? The download runs in the background (progress shows in the cloud sync widget), and when it finishes the file will {copy.verb} automatically. You will not be switched there; {copy.where}.
        </p>
        <p className="text-xs text-gray-400">
          Downloads cannot be interrupted once started, so this dialog closes as soon as the download begins.
        </p>
        <p className="text-xs text-gray-400 font-mono break-all">{filePath}</p>
      </div>
    </Modal>
  )
}
