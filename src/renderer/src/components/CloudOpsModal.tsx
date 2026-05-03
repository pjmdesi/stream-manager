import React, { useEffect, useMemo, useRef } from 'react'
import { Modal } from './ui/Modal'
import { Button } from './ui/Button'
import { Loader2, CheckCircle2, XCircle, Cloud, CloudCheck, CloudDownload, Pin, Ban, Info } from 'lucide-react'
import { useCloudOps, type CloudOpItem, type CloudOpItemStatus, type CloudOpDirection } from '../context/CloudOpsContext'

function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(0)} MB`
  if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(0)} KB`
  return `${bytes} B`
}

interface SectionTotals {
  total: number
  done: number
  alreadyDone: number
  failed: number
  protectedCount: number
  cancelledCount: number
  pendingOrRunning: number
  /** Bytes saved (offload) or bytes downloaded (hydrate). Same calc, the
   *  caller chooses the label. */
  bytesMoved: number
  /** Sum of size across files that count toward progress. Excludes
   *  protected/cancelled which the user didn't intend to move. */
  totalBytes: number
}

function computeTotals(items: CloudOpItem[]): SectionTotals {
  const t: SectionTotals = {
    total: 0, done: 0, alreadyDone: 0, failed: 0,
    protectedCount: 0, cancelledCount: 0, pendingOrRunning: 0,
    bytesMoved: 0, totalBytes: 0,
  }
  for (const it of items) {
    t.total += 1
    if (it.status === 'done') {
      t.done += 1
      t.bytesMoved += it.size
      t.totalBytes += it.size
    } else if (it.status === 'already-offline' || it.status === 'already-local') {
      t.alreadyDone += 1
    } else if (it.status === 'failed') {
      t.failed += 1
      t.totalBytes += it.size
    } else if (it.status === 'skipped-protected') {
      t.protectedCount += 1
    } else if (it.status === 'cancelled') {
      t.cancelledCount += 1
    } else {
      t.pendingOrRunning += 1
      t.totalBytes += it.size
    }
  }
  return t
}

/**
 * Cloud sync progress modal. Shows two stacked sections — offload (top) and
 * download (bottom) — that surface only when their queue has rows. Closing
 * the modal is non-destructive: the underlying operations keep running, and
 * the sidebar widget continues to show progress until they finish. Per-
 * section cancel buttons let the user abort one direction without affecting
 * the other.
 */
export function CloudOpsModal() {
  const {
    offloadItems, hydrateItems,
    offloadActive, hydrateActive,
    offloadCancelling, hydrateCancelling,
    modalOpen, closeModal,
    cancelOffload, cancelHydrate,
  } = useCloudOps()

  const anySectionVisible = offloadItems.length > 0 || hydrateItems.length > 0
  const anyActive = offloadActive || hydrateActive

  return (
    <Modal
      isOpen={modalOpen}
      onClose={closeModal}
      title="Cloud sync"
      width="2xl"
      dismissible
      footer={<Button variant="primary" onClick={closeModal}>{anyActive ? 'Run in background' : 'Close'}</Button>}
    >
      {!anySectionVisible ? (
        <div className="py-8 text-center text-sm text-gray-500">No cloud operations.</div>
      ) : (
        <div className="space-y-5">
          {offloadItems.length > 0 && (
            <CloudOpsSection
              direction="offload"
              items={offloadItems}
              active={offloadActive}
              cancelling={offloadCancelling}
              onCancel={cancelOffload}
            />
          )}
          {hydrateItems.length > 0 && (
            <CloudOpsSection
              direction="hydrate"
              items={hydrateItems}
              active={hydrateActive}
              cancelling={hydrateCancelling}
              onCancel={cancelHydrate}
            />
          )}
        </div>
      )}
    </Modal>
  )
}

interface SectionProps {
  direction: CloudOpDirection
  items: CloudOpItem[]
  active: boolean
  cancelling: boolean
  onCancel: () => void
}

function CloudOpsSection({ direction, items, active, cancelling, onCancel }: SectionProps) {
  const totals = useMemo(() => computeTotals(items), [items])
  const isOffload = direction === 'offload'
  const title = isOffload ? 'Offload to cloud' : 'Download from cloud'
  const Icon = isOffload ? Cloud : CloudDownload
  const bytesLabel = isOffload ? 'Space saved' : 'Downloaded'

  // Auto-scroll the currently-running row into view, but only when the
  // user's cursor isn't inside the list (so they can scan freely without
  // the list yanking out from under them).
  const listRef = useRef<HTMLDivElement | null>(null)
  const isHovering = useRef(false)
  const runningPathRef = useRef<string | null>(null)
  useEffect(() => {
    const running = items.find(it => it.status === 'running')
    runningPathRef.current = running ? running.path : null
  }, [items])
  useEffect(() => {
    if (!active || isHovering.current) return
    const path = runningPathRef.current
    if (!path) return
    const list = listRef.current
    if (!list) return
    const row = list.querySelector<HTMLDivElement>(`[data-row="${cssEscape(path)}"]`)
    if (!row) return
    const rowTop = row.offsetTop
    const rowBottom = rowTop + row.offsetHeight
    if (rowTop < list.scrollTop || rowBottom > list.scrollTop + list.clientHeight) {
      row.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [items, active])

  const denominator = totals.total - totals.protectedCount - totals.cancelledCount
  const doneCount = totals.done + totals.alreadyDone

  return (
    <div className="rounded-lg border border-white/10 bg-navy-800/40 overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-3 py-2 border-b border-white/10">
        <div className="flex items-center gap-2 text-sm text-gray-200">
          <Icon size={14} className={isOffload ? 'text-pink-300' : 'text-cyan-300'} />
          <span className="font-medium">{title}</span>
          {active && <Loader2 size={11} className="text-blue-300 animate-spin" />}
        </div>
        {active && (
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={cancelling}>
            {cancelling ? 'Cancelling…' : 'Cancel'}
          </Button>
        )}
      </div>
      <div className="px-3 py-3 space-y-3">
        {!isOffload && (
          <p className="flex items-start gap-1.5 text-[11px] text-gray-500 leading-relaxed">
            <Info size={11} className="shrink-0 mt-0.5" />
            <span>
              Stream Manager can only see per-file completion, not live byte progress. For real-time download progress, check your cloud app (Synology Drive, OneDrive, etc.) or the Windows notification center.
            </span>
          </p>
        )}
        <div className="grid grid-cols-4 gap-2 text-xs">
          <SummaryStat label="Files" value={`${totals.total}`} />
          <SummaryStat label="Done" value={`${doneCount} / ${denominator}`} />
          <SummaryStat
            label={bytesLabel}
            value={formatBytes(totals.bytesMoved)}
            sub={`of ${formatBytes(totals.totalBytes)}`}
          />
          <SummaryStat
            label="Failed"
            value={`${totals.failed}`}
            tone={totals.failed > 0 ? 'error' : 'muted'}
          />
        </div>
        <div className="border border-white/10 rounded-lg overflow-hidden">
          <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 px-3 py-1.5 text-[10px] uppercase tracking-wide text-gray-500 border-b border-white/10 bg-navy-900/60">
            <span>File</span>
            <span className="text-right">Size</span>
            <span className="text-right w-32">Status</span>
          </div>
          <div
            ref={listRef}
            onMouseEnter={() => { isHovering.current = true }}
            onMouseLeave={() => { isHovering.current = false }}
            className="max-h-[35vh] overflow-y-auto divide-y divide-white/5"
          >
            {items.map(it => (
              <div
                key={`${it.batchId}:${it.path}`}
                data-row={it.path}
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
    </div>
  )
}

function SummaryStat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'error' | 'muted' }) {
  const valueClass = tone === 'error' ? 'text-red-300' : 'text-gray-200'
  return (
    <div className="bg-navy-900 border border-white/5 rounded-lg px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-gray-500">{label}</div>
      <div className={`text-sm tabular-nums ${valueClass}`}>
        {value}
        {sub && <span className="text-gray-600 text-[10px] ml-1.5">{sub}</span>}
      </div>
    </div>
  )
}

function StatusBadge({ status, reason }: { status: CloudOpItemStatus; reason?: string }) {
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
      return wrap('text-green-300', <><CheckCircle2 size={11} className={iconCls} /> Done</>)
    case 'already-offline':
      return wrap('text-gray-400', <><Cloud size={11} className={iconCls} /> Already offline</>)
    case 'already-local':
      return wrap('text-gray-400', <><CloudCheck size={11} className={iconCls} /> Already local</>)
    case 'skipped-protected':
      return wrap('text-amber-300/80', <><Pin size={11} className={iconCls} /> Pinned</>, "Kept local because it's the stream's primary thumbnail")
    case 'failed':
      return wrap('text-red-300', <><XCircle size={11} className={iconCls} /> Failed</>, reason)
    case 'cancelled':
      return wrap('text-gray-500', <><Ban size={11} className={iconCls} /> Cancelled</>)
  }
}

// CSS.escape isn't typed on global in older lib targets; tiny hand-rolled
// equivalent for the data-row selector.
function cssEscape(s: string): string {
  return s.replace(/([!"#$%&'()*+,./:;<=>?@[\\\]^`{|}~ ])/g, '\\$1')
}
