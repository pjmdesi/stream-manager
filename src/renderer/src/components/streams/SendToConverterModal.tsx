import React, { useEffect, useState } from 'react'
import { Zap } from 'lucide-react'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { Checkbox } from '../ui/Checkbox'
import type { StreamFolder, VideoInfo } from '../../types'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let val = bytes / 1024
  let i = 0
  while (val >= 1024 && i < units.length - 1) { val /= 1024; i++ }
  return `${val.toFixed(val >= 10 ? 0 : 1)} ${units[i]}`
}

function formatTimecode(seconds: number): string {
  if (!isFinite(seconds) || seconds <= 0) return '0:00'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`
}

interface Row {
  path: string
  name: string
  size?: number
  isLocal?: boolean
  info?: VideoInfo
  loading: boolean
}

interface Props {
  isOpen: boolean
  /** The stream folder whose videos are being picked. */
  folder: StreamFolder | null
  onClose: () => void
  /** Fires with the checked file paths when the user confirms. */
  onSend: (paths: string[]) => void
}

/**
 * SendToConverterModal — shown when a stream has more than one video so the user
 * can choose which file(s) to send to the converter. Each row shows the file
 * size, duration, and current encoding (codec / resolution / fps) probed via
 * ffprobe. Cloud-offloaded files aren't probed (to avoid hydrating them) but can
 * still be selected — the converter downloads them when it runs.
 */
export function SendToConverterModal({ isOpen, folder, onClose, onSend }: Props) {
  const [rows, setRows] = useState<Row[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!isOpen || !folder) return
    const videos = folder.videos
    setRows(videos.map(p => ({ path: p, name: p.split(/[\\/]/).pop() ?? p, loading: true })))
    setSelected(new Set())
    let cancelled = false
    ;(async () => {
      const [sizes, localFlags] = await Promise.all([
        window.api.getFileSizes(videos),
        window.api.checkLocalFiles(videos),
      ])
      if (cancelled) return
      // Only probe local files — probing a cloud placeholder would hydrate the
      // whole file just to read its header.
      const infos = await Promise.all(videos.map((p, i) =>
        localFlags[i] ? window.api.probeFile(p).catch(() => null) : Promise.resolve(null)
      ))
      if (cancelled) return
      setRows(videos.map((p, i) => ({
        path: p,
        name: p.split(/[\\/]/).pop() ?? p,
        size: sizes[i] ?? undefined,
        isLocal: localFlags[i],
        info: infos[i] ?? undefined,
        loading: false,
      })))
    })()
    return () => { cancelled = true }
  }, [isOpen, folder])

  const toggle = (path: string) => setSelected(prev => {
    const next = new Set(prev)
    if (next.has(path)) next.delete(path)
    else next.add(path)
    return next
  })
  const selectAll = () => setSelected(new Set(rows.map(r => r.path)))
  const clear = () => setSelected(new Set())

  const handleSend = () => {
    const paths = rows.filter(r => selected.has(r.path)).map(r => r.path)
    if (paths.length > 0) onSend(paths)
  }

  const metaLine = (row: Row): string => {
    if (row.loading) return 'Reading…'
    const parts: string[] = []
    if (row.size != null) parts.push(formatBytes(row.size))
    if (row.info) {
      parts.push(formatTimecode(row.info.duration))
      const enc = [
        row.info.videoCodec?.toUpperCase(),
        row.info.width && row.info.height ? `${row.info.width}×${row.info.height}` : null,
        row.info.fps ? `${Math.round(row.info.fps)}fps` : null,
      ].filter(Boolean).join(' ')
      if (enc) parts.push(enc)
    } else if (row.isLocal === false) {
      parts.push('Cloud — downloads on convert')
    }
    return parts.join('  ·  ') || '—'
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Send videos to converter"
      width="2xl"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            size="sm"
            icon={<Zap size={13} />}
            onClick={handleSend}
            disabled={selected.size === 0}
          >
            Send{selected.size > 0 ? ` (${selected.size})` : ''}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-400">{selected.size} of {rows.length} selected</span>
          <div className="flex items-center gap-3">
            <button onClick={selectAll} className="text-xs text-purple-300 hover:text-purple-200 transition-colors">Select all</button>
            <button onClick={clear} className="text-xs text-gray-400 hover:text-gray-300 transition-colors">Clear</button>
          </div>
        </div>
        <div className="flex flex-col gap-1 max-h-[480px] overflow-y-auto -mx-1 px-1">
          {rows.map(row => (
            <div
              key={row.path}
              onClick={() => toggle(row.path)}
              className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/5 cursor-pointer"
            >
              {/* Visual checkbox — the row's onClick drives selection so the
                  whole row is clickable; onChange is a no-op to avoid a double
                  toggle when the click bubbles up. */}
              <Checkbox checked={selected.has(row.path)} onChange={() => {}} />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-200 truncate">{row.name}</p>
                <p className="text-xs text-gray-400 truncate">{metaLine(row)}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  )
}
