import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Modal } from './ui/Modal'
import { Button } from './ui/Button'
import { Loader2, CheckCircle2, XCircle, Cloud, Pin, Ban } from 'lucide-react'

function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(0)} MB`
  if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(0)} KB`
  return `${bytes} B`
}

type ItemStatus = 'pending' | 'running' | 'done' | 'already-offline' | 'failed' | 'skipped-protected' | 'cancelled'

interface FileEntry {
  path: string
  name: string
  size: number
  status: ItemStatus
  reason?: string
}

interface Props {
  isOpen: boolean
  onClose: () => void
  /** Files to process. Path + display name + logical size in bytes. */
  files: { path: string; size: number }[]
}

/**
 * Drives the offload IPC + listens to its progress events. Self-contained:
 * caller just opens it with a list of files. The dispatch + subscription
 * lifecycle is internal so race conditions between IPC invoke and event
 * listener registration can't happen.
 */
export function CloudOffloadModal({ isOpen, onClose, files }: Props) {
  const [items, setItems] = useState<FileEntry[]>([])
  const [running, setRunning] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const launched = useRef(false)
  const listRef = useRef<HTMLDivElement | null>(null)
  const isHoveringList = useRef(false)
  const runningPath = useRef<string | null>(null)

  // Reset + dispatch when the modal opens with a new file set.
  useEffect(() => {
    if (!isOpen) { launched.current = false; return }
    if (launched.current) return
    launched.current = true

    setItems(files.map(f => ({
      path: f.path,
      name: f.path.split(/[\\/]/).pop() ?? f.path,
      size: f.size,
      status: 'pending',
    })))
    setRunning(true)
    setCancelling(false)
    runningPath.current = null

    const unsub = window.api.onCloudSyncProgress(ev => {
      if (ev.type === 'init') {
        setItems(prev => prev.map(it =>
          ev.skippedProtected.includes(it.path)
            ? { ...it, status: 'skipped-protected' }
            : it
        ))
      } else if (ev.type === 'item') {
        if (ev.status === 'running') runningPath.current = ev.path
        setItems(prev => prev.map(it =>
          it.path === ev.path
            ? {
                ...it,
                status:
                  ev.status === 'done' ? 'done' :
                  ev.status === 'failed' ? 'failed' :
                  ev.status === 'already-offline' ? 'already-offline' :
                  'running',
                reason: ev.reason,
              }
            : it
        ))
      } else if (ev.type === 'complete') {
        setRunning(false)
        setCancelling(false)
        if (ev.cancelled) {
          // Promote any leftover pending/running rows to "cancelled" so the
          // user can see exactly where the operation stopped.
          setItems(prev => prev.map(it =>
            it.status === 'pending' || it.status === 'running'
              ? { ...it, status: 'cancelled' }
              : it
          ))
        }
      }
    })

    window.api.cloudSyncOffload(files.map(f => f.path)).catch(() => setRunning(false))

    return () => unsub()
  }, [isOpen, files])

  // Auto-scroll the currently-running row into view, but only when the user's
  // cursor isn't inside the list (so they can scan freely without the list
  // yanking out from under them).
  useEffect(() => {
    if (!running || isHoveringList.current) return
    const path = runningPath.current
    if (!path) return
    const idx = items.findIndex(it => it.path === path)
    if (idx === -1) return
    const list = listRef.current
    if (!list) return
    const row = list.querySelector<HTMLDivElement>(`[data-row="${idx}"]`)
    if (!row) return
    const rowTop = row.offsetTop
    const rowBottom = rowTop + row.offsetHeight
    if (rowTop < list.scrollTop || rowBottom > list.scrollTop + list.clientHeight) {
      row.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [items, running])

  const totals = useMemo(() => {
    let total = 0
    let saved = 0
    let alreadyOffline = 0
    let failed = 0
    let done = 0
    let protectedCount = 0
    let cancelledCount = 0
    let pendingOrRunning = 0
    for (const it of items) {
      if (it.status === 'done') { done += 1; saved += it.size; total += it.size }
      else if (it.status === 'already-offline') { alreadyOffline += 1 }
      else if (it.status === 'failed') { failed += 1; total += it.size }
      else if (it.status === 'skipped-protected') { protectedCount += 1 }
      else if (it.status === 'cancelled') { cancelledCount += 1 }
      else { pendingOrRunning += 1; total += it.size }
    }
    return { total, saved, alreadyOffline, failed, done, protectedCount, cancelledCount, pendingOrRunning }
  }, [items])

  const handleCancel = () => {
    if (!running || cancelling) return
    setCancelling(true)
    window.api.cloudSyncCancelOffload().catch(() => {})
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={running ? () => {} : onClose}
      title="Offload to cloud"
      width="2xl"
      dismissible={!running}
      footer={
        running ? (
          <Button variant="ghost" onClick={handleCancel} disabled={cancelling}>
            {cancelling ? 'Cancelling…' : 'Cancel'}
          </Button>
        ) : (
          <Button variant="primary" onClick={onClose}>Close</Button>
        )
      }
    >
      <div className="space-y-4">
        {/* Summary header */}
        <div className="grid grid-cols-4 gap-3 text-xs">
          <SummaryStat label="Files" value={`${items.length}`} />
          <SummaryStat
            label="Done"
            value={`${totals.done + totals.alreadyOffline} / ${items.length - totals.protectedCount - totals.cancelledCount}`}
          />
          <SummaryStat label="Space saved" value={formatBytes(totals.saved)} sub={`of ${formatBytes(totals.total)}`} />
          <SummaryStat label="Failed" value={`${totals.failed}`} tone={totals.failed > 0 ? 'error' : 'muted'} />
        </div>

        {/* File list */}
        <div className="border border-white/10 rounded-lg overflow-hidden">
          <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 px-3 py-2 text-[10px] uppercase tracking-wide text-gray-500 border-b border-white/10 bg-navy-800">
            <span>File</span>
            <span className="text-right">Size</span>
            <span className="text-right w-32">Status</span>
          </div>
          <div
            ref={listRef}
            onMouseEnter={() => { isHoveringList.current = true }}
            onMouseLeave={() => { isHoveringList.current = false }}
            className="max-h-[50vh] overflow-y-auto divide-y divide-white/5"
          >
            {items.map((it, idx) => (
              <div
                key={it.path}
                data-row={idx}
                className="grid grid-cols-[1fr_auto_auto] gap-x-4 px-3 h-7 text-xs items-center hover:bg-white/5 transition-colors"
              >
                <span className="truncate text-gray-300" title={it.path}>{it.name}</span>
                <span className="text-right tabular-nums text-gray-400">{formatBytes(it.size)}</span>
                <span className="text-right w-32"><StatusBadge status={it.status} reason={it.reason} /></span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  )
}

function SummaryStat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'error' | 'muted' }) {
  const valueClass = tone === 'error' ? 'text-red-300' : 'text-gray-200'
  return (
    <div className="bg-navy-800 border border-white/5 rounded-lg px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-gray-500">{label}</div>
      <div className={`text-sm tabular-nums ${valueClass}`}>
        {value}
        {sub && <span className="text-gray-600 text-[10px] ml-1.5">{sub}</span>}
      </div>
    </div>
  )
}

function StatusBadge({ status, reason }: { status: ItemStatus; reason?: string }) {
  // Fixed-height wrapper + leading-none so icons (which lucide renders as
  // inline SVGs with implicit baseline whitespace) can't push the row
  // taller than text-only states like "Pending".
  const wrap = (className: string, content: React.ReactNode, title?: string) => (
    <span className={`inline-flex items-center gap-1 h-4 leading-none ${className}`} title={title}>{content}</span>
  )
  const iconCls = 'shrink-0'
  switch (status) {
    case 'pending':
      return wrap('text-gray-500', 'Pending')
    case 'running':
      return wrap('text-blue-300', <><Loader2 size={11} className={`${iconCls} animate-spin`} /> Working</>)
    case 'done':
      return wrap('text-green-300', <><CheckCircle2 size={11} className={iconCls} /> Offloaded</>)
    case 'already-offline':
      return wrap('text-gray-400', <><Cloud size={11} className={iconCls} /> Already offline</>)
    case 'skipped-protected':
      return wrap('text-amber-300/80', <><Pin size={11} className={iconCls} /> Pinned</>, "Kept local because it's the stream's primary thumbnail")
    case 'failed':
      return wrap('text-red-300', <><XCircle size={11} className={iconCls} /> Failed</>, reason)
    case 'cancelled':
      return wrap('text-gray-500', <><Ban size={11} className={iconCls} /> Cancelled</>)
  }
}
