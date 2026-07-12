import React, { useEffect, useMemo, useRef, useState } from 'react'
import { RefreshCw, Upload, Download, Check, Loader2, ChevronRight, ListChecks, X, Eye, EyeOff, RotateCcw, ArrowUpDown, ImageOff, WifiOff, AlertTriangle } from 'lucide-react'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { Tooltip } from '../ui/Tooltip'
import { ThumbImage } from './ThumbImage'
import { renderStreamTitle } from '../../lib/streamTitle'
import { MISMATCH_FIELD_LABELS, type OutOfSyncItem } from '../../lib/broadcastMismatch'
import type { StreamFolder } from '../../types'

// Quota model (YouTube Data API v3): writes cost 50 units each. A push does one
// snippet update (title/description/tags/category) + a status update when a
// privacy value is staged + a thumbnail upload when the thumbnail diverges,
// then ~2 read units refreshing the pushed video's canonical state. Privacy on
// a non-broadcast can burn a second 50-unit call (broadcast-status 404 → video
// fallback) — the estimate stays at 50 and the label says "~" for a reason.
// Default daily quota is 10,000 units; remaining isn't reported by the API.
const PUSH_UNITS_SNIPPET = 50
const PUSH_UNITS_PRIVACY = 50
const PUSH_UNITS_THUMBNAIL = 50
const PUSH_UNITS_REFRESH_READS = 2
const DAILY_QUOTA = 10_000
const HEAVY_PUSH_STREAMS = 10
const HEAVY_PUSH_UNITS = 2_000

function estimatePushUnits(items: OutOfSyncItem[]): number {
  return items.reduce((sum, it) =>
    sum + PUSH_UNITS_SNIPPET
    + (it.folder.meta?.ytPrivacyStatus ? PUSH_UNITS_PRIVACY : 0)
    + (it.mismatch.has('thumbnail') ? PUSH_UNITS_THUMBNAIL : 0)
    + PUSH_UNITS_REFRESH_READS, 0)
}

/** Direction → accent. Matches the sidebar's per-field dots: blue = local-ahead
 *  (push), orange = remote-ahead (pull). */
const KIND_ACCENT: Record<OutOfSyncItem['kind'], string> = {
  push: 'text-blue-300',
  pull: 'text-orange-300',
  conflict: 'text-red-300',
}

function FieldChips({ item }: { item: OutOfSyncItem }) {
  return (
    <span className={`truncate ${KIND_ACCENT[item.kind]}`}>
      {[...item.mismatch.keys()].map(f => MISMATCH_FIELD_LABELS[f]).join(' · ')}
    </span>
  )
}

// Row mirrors the player's Session Videos list: a tight hover-highlighted row
// (thumbnail + title + meta). Out of select mode the row opens the stream and
// reveals a resolve action on hover; in select mode it's a selection target
// with a checkbox.
function Row({
  item, folders, thumbsKey, busy, selectMode, selected, ignoredRow,
  onOpen, onQuickResolve, onUnignore, onSelectMouseDown, onSelectMouseEnter, onSelectClick,
}: {
  item: OutOfSyncItem
  folders: StreamFolder[]
  thumbsKey: number
  busy: boolean
  selectMode: boolean
  selected: boolean
  ignoredRow?: boolean
  onOpen: () => void
  onQuickResolve?: () => void
  onUnignore?: () => void
  onSelectMouseDown: () => void
  onSelectMouseEnter: () => void
  onSelectClick: (shiftKey: boolean) => void
}) {
  const { folder } = item
  const thumb = folder.thumbnails[0]
  const thumbLocal = folder.thumbnailLocalFlags?.[0] ?? true
  const title = renderStreamTitle(folder, folders)

  const inner = (
    <>
      <span className="relative w-12 h-7 rounded overflow-hidden bg-white/5 shrink-0 flex items-center justify-center">
        {thumb
          ? <ThumbImage path={thumb} thumbsKey={thumbsKey} isLocal={thumbLocal} className="w-full h-full object-cover" iconSize={11} />
          : <ImageOff size={12} className="text-gray-400" />}
      </span>
      <span className="flex flex-col min-w-0 flex-1 leading-tight">
        <span className={`text-[11px] truncate ${ignoredRow ? 'text-gray-400' : 'text-gray-300'}`}>{title}</span>
        <span className="flex items-center gap-1.5 text-[10px] min-w-0">
          <span className="text-gray-400 tabular-nums shrink-0">{folder.date}</span>
          <FieldChips item={item} />
        </span>
      </span>
    </>
  )

  if (selectMode) {
    return (
      <div
        onMouseDown={onSelectMouseDown}
        onMouseEnter={onSelectMouseEnter}
        onClick={e => onSelectClick(e.shiftKey)}
        className={`flex items-center gap-2 px-2 py-1.5 rounded-lg transition-colors cursor-pointer select-none ${selected ? 'bg-purple-600/20' : 'hover:bg-white/5'}`}
      >
        <span className={`w-4 h-4 rounded border-2 shrink-0 flex items-center justify-center transition-colors ${selected ? 'bg-purple-700 border-purple-700' : 'border-gray-600 hover:border-gray-400'}`}>
          {selected && <Check size={10} className="text-white" strokeWidth={3} />}
        </span>
        {inner}
      </div>
    )
  }

  return (
    <div className={`group/item flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-white/5 transition-colors ${ignoredRow ? 'opacity-70' : ''}`}>
      <button onClick={onOpen} className="flex items-center gap-2 flex-1 min-w-0 text-left cursor-pointer">
        {inner}
      </button>
      {ignoredRow ? (
        <Tooltip content="Un-ignore" side="left">
          <button onClick={onUnignore} className="shrink-0 p-1 rounded text-gray-400 hover:text-gray-200 hover:bg-white/5 transition-colors opacity-0 group-hover/item:opacity-100 focus:opacity-100" aria-label="Un-ignore">
            <RotateCcw size={13} />
          </button>
        </Tooltip>
      ) : onQuickResolve ? (
        <Tooltip content={item.kind === 'push' ? 'Push this to YouTube' : 'Pull this into SM'} side="left">
          <button
            onClick={onQuickResolve}
            disabled={busy}
            className={`shrink-0 p-1 rounded transition-colors opacity-0 group-hover/item:opacity-100 focus:opacity-100 disabled:opacity-100 ${item.kind === 'push'
              ? 'text-blue-400 hover:text-blue-300 hover:bg-blue-500/10'
              : 'text-orange-400 hover:text-orange-300 hover:bg-orange-500/10'}`}
            aria-label={item.kind === 'push' ? 'Push to YouTube' : 'Pull into SM'}
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : (item.kind === 'push' ? <Upload size={13} /> : <Download size={13} />)}
          </button>
        </Tooltip>
      ) : (
        <ChevronRight size={13} className="text-gray-500 shrink-0" />
      )}
    </div>
  )
}

export function OutOfSyncPanel({
  items, folders, thumbsKey, loading, checkedAt, quotaExceeded,
  netProblem, error,
  onRefresh, onOpenStream, onResolve, onIgnore, onUnignore,
}: {
  items: OutOfSyncItem[]
  folders: StreamFolder[]
  thumbsKey: number
  loading: boolean
  checkedAt: number | null
  quotaExceeded: boolean
  /** Page-level network problem: 'offline' blocks checks and all resolve
   *  actions; 'yt' blocks pushes but leaves pulls (cached data) and the
   *  re-check (doubles as a retry) available. */
  netProblem: null | 'offline' | 'yt'
  /** Last check failure, if the most recent refresh threw. */
  error: string | null
  onRefresh: () => void
  onOpenStream: (folder: StreamFolder) => void
  onResolve: (kind: 'push' | 'pull', folders: StreamFolder[]) => Promise<void>
  onIgnore: (folders: StreamFolder[]) => Promise<void>
  onUnignore: (folders: StreamFolder[]) => Promise<void>
}) {
  const active = useMemo(() => items.filter(i => !i.ignored), [items])
  const ignored = useMemo(() => items.filter(i => i.ignored), [items])
  const push = useMemo(() => active.filter(i => i.kind === 'push'), [active])
  const pull = useMemo(() => active.filter(i => i.kind === 'pull'), [active])
  const conflict = useMemo(() => active.filter(i => i.kind === 'conflict'), [active])

  const [showIgnored, setShowIgnored] = useState(false)
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busyPaths, setBusyPaths] = useState<Set<string>>(new Set())
  const [confirm, setConfirm] = useState<{ pushItems: OutOfSyncItem[]; pullItems: OutOfSyncItem[] } | null>(null)
  const [confirmText, setConfirmText] = useState('')
  const [resolving, setResolving] = useState(false)
  // Render rows in chunks to keep the DOM small for 200+ row lists; reveal more
  // automatically as the user nears the bottom (infinite scroll).
  const CHUNK = 50
  const [shownCount, setShownCount] = useState(CHUNK)
  const loadMoreRef = useRef<HTMLDivElement>(null)
  // Reset the chunk window when the list identity changes (e.g. a reload).
  useEffect(() => { setShownCount(CHUNK) }, [items])

  // Capped, in-order slices across the active groups; ignored is capped
  // separately (it sits behind its own toggle).
  const pushShown = push.slice(0, shownCount)
  const pullShown = pull.slice(0, Math.max(0, shownCount - pushShown.length))
  const conflictShown = conflict.slice(0, Math.max(0, shownCount - pushShown.length - pullShown.length))
  const ignoredShown = showIgnored ? ignored.slice(0, shownCount) : []
  const hiddenActive = (push.length + pull.length + conflict.length) - (pushShown.length + pullShown.length + conflictShown.length)

  // Auto-load the next chunk when the sentinel (placed ~10 rows above the
  // bottom via rootMargin) scrolls into view. Re-observes whenever the window
  // grows, and stops once nothing is hidden.
  useEffect(() => {
    const el = loadMoreRef.current
    if (!el || hiddenActive <= 0) return
    const io = new IntersectionObserver(
      entries => { if (entries[0].isIntersecting) setShownCount(c => c + CHUNK) },
      { rootMargin: '0px 0px 400px 0px' }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [hiddenActive])

  // Flat display order — drives the index-based range selection (over the
  // currently-rendered rows). Ignored rows only participate when shown.
  const flat = [...pushShown, ...pullShown, ...conflictShown, ...ignoredShown]
  const indexOfPath = new Map(flat.map((it, i) => [it.folder.folderPath, i] as const))

  // Leaving select mode (or the list changing out from under us) clears state.
  useEffect(() => { if (!selectMode) setSelected(new Set()) }, [selectMode])

  // ── Range / drag selection (mirrors the main streams list) ────────────────
  const isDragging = useRef(false)
  const dragStart = useRef<number | null>(null)
  const dragAction = useRef<'add' | 'remove'>('add')
  const preDrag = useRef<Set<string>>(new Set())
  const dragMoved = useRef(false)
  const lastClicked = useRef<number | null>(null)
  useEffect(() => {
    const up = () => { isDragging.current = false }
    document.addEventListener('mouseup', up)
    return () => document.removeEventListener('mouseup', up)
  }, [])
  const startDrag = (index: number) => {
    const it = flat[index]; if (!it) return
    isDragging.current = true
    dragStart.current = index
    dragAction.current = selected.has(it.folder.folderPath) ? 'remove' : 'add'
    preDrag.current = new Set(selected)
    dragMoved.current = false
  }
  const extendDrag = (index: number) => {
    if (!isDragging.current || dragStart.current === null) return
    dragMoved.current = true
    const s = Math.min(dragStart.current, index)
    const e = Math.max(dragStart.current, index)
    setSelected(() => {
      const next = new Set(preDrag.current)
      for (let i = s; i <= e; i++) {
        const it = flat[i]; if (!it) continue
        if (dragAction.current === 'add') next.add(it.folder.folderPath)
        else next.delete(it.folder.folderPath)
      }
      return next
    })
  }
  const clickSelect = (index: number, shiftKey: boolean) => {
    if (dragMoved.current) { dragMoved.current = false; return } // swallow the click that ends a drag
    const it = flat[index]; if (!it) return
    const path = it.folder.folderPath
    if (shiftKey && lastClicked.current !== null) {
      const s = Math.min(lastClicked.current, index)
      const e = Math.max(lastClicked.current, index)
      setSelected(prev => {
        const next = new Set(prev)
        for (let i = s; i <= e; i++) { const x = flat[i]; if (x) next.add(x.folder.folderPath) }
        return next
      })
    } else {
      setSelected(prev => {
        const next = new Set(prev)
        if (next.has(path)) next.delete(path); else next.add(path)
        return next
      })
      lastClicked.current = index
    }
  }

  // ── Resolve flow ──────────────────────────────────────────────────────────
  const directResolve = async (kind: 'push' | 'pull', item: OutOfSyncItem) => {
    const path = item.folder.folderPath
    setBusyPaths(prev => new Set(prev).add(path))
    try { await onResolve(kind, [item.folder]) }
    finally { setBusyPaths(prev => { const n = new Set(prev); n.delete(path); return n }) }
  }
  // Single item (1 total) → resolve immediately (no modal); ≥2 → confirm.
  const requestResolve = (pushItems: OutOfSyncItem[], pullItems: OutOfSyncItem[]) => {
    const total = pushItems.length + pullItems.length
    if (total === 0) return
    if (total === 1) {
      if (pushItems[0]) directResolve('push', pushItems[0])
      else directResolve('pull', pullItems[0])
      return
    }
    setConfirmText('')
    setConfirm({ pushItems, pullItems })
  }
  const estUnits = estimatePushUnits(confirm?.pushItems ?? [])
  const heavy = !!confirm && (confirm.pushItems.length > HEAVY_PUSH_STREAMS || estUnits > HEAVY_PUSH_UNITS)
  const confirmBlocked = heavy && confirmText.trim().toLowerCase() !== 'confirm'
  const runConfirm = async () => {
    if (!confirm || resolving) return
    setResolving(true)
    try {
      if (confirm.pushItems.length) await onResolve('push', confirm.pushItems.map(i => i.folder))
      if (confirm.pullItems.length) await onResolve('pull', confirm.pullItems.map(i => i.folder))
      setConfirm(null)
      setSelectMode(false)
    } finally { setResolving(false) }
  }

  // ── Select-mode bulk actions ──────────────────────────────────────────────
  const selectedItems = useMemo(() => flat.filter(i => selected.has(i.folder.folderPath)), [flat, selected])
  const selPush = selectedItems.filter(i => i.kind === 'push' && !i.ignored)
  const selPull = selectedItems.filter(i => i.kind === 'pull' && !i.ignored)
  const runIgnore = async () => {
    const targets = selectedItems.filter(i => !i.ignored).map(i => i.folder)
    if (targets.length > 0) await onIgnore(targets)
    setSelectMode(false)
  }

  const checkedLabel = checkedAt
    ? `checked ${new Date(checkedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
    : ''
  // "All" covers the complete active list, not just the rendered chunk — the
  // infinite-scroll window (shownCount) is a DOM optimization, not a
  // selection boundary. Selecting All on a 200-row list must mean 200.
  const allItems = [...push, ...pull, ...conflict, ...(showIgnored ? ignored : [])]
  const allSelected = allItems.length > 0 && allItems.every(i => selected.has(i.folder.folderPath))

  const renderRow = (it: OutOfSyncItem, opts?: { ignoredRow?: boolean }) => {
    const path = it.folder.folderPath
    const index = indexOfPath.get(path) ?? -1
    return (
      <Row
        key={path} item={it} folders={folders} thumbsKey={thumbsKey}
        busy={busyPaths.has(path)}
        selectMode={selectMode}
        selected={selected.has(path)}
        ignoredRow={opts?.ignoredRow}
        onOpen={() => onOpenStream(it.folder)}
        onQuickResolve={it.kind === 'conflict'
          || (it.kind === 'push' && (quotaExceeded || netProblem !== null))
          || (it.kind === 'pull' && netProblem === 'offline')
          ? undefined
          : () => directResolve(it.kind === 'push' ? 'push' : 'pull', it)}
        onUnignore={() => onUnignore([it.folder])}
        onSelectMouseDown={() => startDrag(index)}
        onSelectMouseEnter={() => extendDrag(index)}
        onSelectClick={shiftKey => clickSelect(index, shiftKey)}
      />
    )
  }

  return (
    // Flows inside the parent's scroll container (StreamsPage); the header and
    // action bar stick to the top/bottom of that scroll area.
    <div className="border-t border-white/5">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-navy-800 flex items-center justify-between gap-2 px-3 py-2">
        {selectMode ? (
          <>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-300">{selected.size} selected</span>
            <div className="flex items-center gap-1">
              <button onClick={() => setSelected(allSelected ? new Set() : new Set(allItems.map(i => i.folder.folderPath)))}
                className="text-[10px] text-gray-400 hover:text-gray-200 px-1.5 py-0.5 rounded hover:bg-white/5 transition-colors">
                {allSelected ? 'None' : 'All'}
              </button>
              <Tooltip content="Done" side="top">
                <button onClick={() => setSelectMode(false)} className="p-1 rounded text-gray-400 hover:text-gray-200 hover:bg-white/5 transition-colors" aria-label="Exit select mode">
                  <X size={13} />
                </button>
              </Tooltip>
            </div>
          </>
        ) : (
          <>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
              {checkedAt === null
                ? (netProblem === 'offline' ? 'Can’t check YouTube' : error ? 'YouTube check failed' : 'Checking YouTube…')
                : active.length > 0 ? `Out of sync · ${active.length}` : 'In sync with YouTube'}
            </span>
            <div className="flex items-center gap-0.5">
              {active.length > 0 && (
                <Tooltip content="Select multiple" side="top">
                  <button onClick={() => setSelectMode(true)} className="p-1 rounded text-gray-400 hover:text-gray-200 hover:bg-white/5 transition-colors" aria-label="Select multiple">
                    <ListChecks size={13} />
                  </button>
                </Tooltip>
              )}
              <Tooltip content={
                netProblem === 'offline' ? 'No internet connection.'
                  : checkedLabel ? `Re-check YouTube — ${checkedLabel}` : 'Re-check YouTube'
              } side="top">
                <button onClick={onRefresh} disabled={loading || netProblem === 'offline'} className="p-1 rounded text-gray-400 hover:text-gray-200 hover:bg-white/5 transition-colors disabled:opacity-50" aria-label="Re-check YouTube">
                  {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                </button>
              </Tooltip>
            </div>
          </>
        )}
      </div>

      {/* List (flows; the parent scrolls) */}
      <div className="px-1.5 pb-2">
        {/* Mid-session disconnect with results on screen: keep the list
            visible but say plainly that it's a snapshot, not live truth. */}
        {checkedAt !== null && netProblem === 'offline' && (
          <p className="flex items-start gap-1.5 text-[10px] text-amber-300 px-1.5 pb-1">
            <WifiOff size={11} className="shrink-0 mt-0.5" />
            <span>No internet connection. Shown from the last successful check{checkedLabel ? ` (${checkedLabel})` : ''}, so it may be out of date.</span>
          </p>
        )}
        {checkedAt === null ? (
          netProblem === 'offline' ? (
            <p className="flex items-start gap-1.5 text-[10px] text-amber-300 px-1.5 py-1">
              <WifiOff size={11} className="shrink-0 mt-0.5" />
              <span>Can’t check YouTube: no internet connection. The check runs automatically once the connection is restored.</span>
            </p>
          ) : error ? (
            <div className="flex flex-col items-start gap-1.5 px-1.5 py-1">
              <p className="flex items-start gap-1.5 text-[10px] text-red-400">
                <AlertTriangle size={11} className="shrink-0 mt-0.5" />
                <span>Couldn’t reach YouTube{netProblem === 'yt' ? ' (it looks like a YouTube problem, not your connection)' : ''}. The sync state is unknown.</span>
              </p>
              <button onClick={onRefresh} disabled={loading}
                className="flex items-center gap-1 text-[10px] px-2 py-1 rounded bg-white/5 hover:bg-white/10 text-gray-200 hover:text-white transition-colors disabled:opacity-50">
                {loading ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />} Retry
              </button>
            </div>
          ) : (
            <p className="flex items-center gap-1.5 text-[10px] text-gray-400 px-1.5 py-1">
              <Loader2 size={11} className="animate-spin" /> Checking YouTube…
            </p>
          )
        ) : active.length === 0 && ignored.length === 0 ? (
          <p className="flex items-center gap-1.5 text-[10px] text-gray-400 px-1.5 py-1">
            <Check size={11} className="text-green-400" /> Every linked stream matches YouTube.
          </p>
        ) : (
          <div className="flex flex-col gap-3 pt-0.5">
            {pushShown.length > 0 && (
              <Group title="Ready to push" count={push.length} accent="text-blue-300"
                action={!selectMode && !quotaExceeded && !netProblem ? { label: 'Push all', icon: <Upload size={12} />, onClick: () => requestResolve(push, []) } : undefined}>
                {pushShown.map(it => renderRow(it))}
              </Group>
            )}
            {pullShown.length > 0 && (
              <Group title="Changed on YouTube" count={pull.length} accent="text-orange-300"
                action={!selectMode && netProblem !== 'offline' ? { label: 'Pull all', icon: <Download size={12} />, onClick: () => requestResolve([], pull) } : undefined}>
                {pullShown.map(it => renderRow(it))}
              </Group>
            )}
            {conflictShown.length > 0 && (
              <Group title="Conflicts" count={conflict.length} accent="text-red-300">
                {conflictShown.map(it => renderRow(it))}
                <p className="text-[10px] text-gray-400 leading-snug px-2">Both sides changed — open each to resolve which value wins.</p>
              </Group>
            )}
            {hiddenActive > 0 && (
              <div ref={loadMoreRef} className="flex items-center justify-center gap-1.5 py-1.5 text-[10px] text-gray-500">
                <Loader2 size={11} className="animate-spin" /> Loading {hiddenActive} more…
              </div>
            )}
            {ignored.length > 0 && (
              <div className="flex flex-col gap-0.5">
                <button onClick={() => setShowIgnored(v => !v)}
                  className="flex items-center gap-1 px-1.5 text-[10px] text-gray-500 hover:text-gray-300 transition-colors">
                  {showIgnored ? <Eye size={11} /> : <EyeOff size={11} />} Ignored · {ignored.length}
                </button>
                {showIgnored && <div className="flex flex-col gap-px">{ignoredShown.map(it => renderRow(it, { ignoredRow: true }))}</div>}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Select-mode action bar */}
      {selectMode && selected.size > 0 && (
        <div className="sticky bottom-0 z-10 border-t border-white/5 px-2 py-1.5 flex items-center gap-1 bg-navy-800">
          {selPush.length > 0 && selPull.length > 0 && !quotaExceeded && !netProblem && (
            <ActionBtn icon={<ArrowUpDown size={12} />} label="Sync" onClick={() => requestResolve(selPush, selPull)} />
          )}
          {selPush.length > 0 && !quotaExceeded && !netProblem && (
            <ActionBtn icon={<Upload size={12} />} label="Push" onClick={() => requestResolve(selPush, [])} accent="text-blue-300" />
          )}
          {selPull.length > 0 && netProblem !== 'offline' && (
            <ActionBtn icon={<Download size={12} />} label="Pull" onClick={() => requestResolve([], selPull)} accent="text-orange-300" />
          )}
          <ActionBtn icon={<EyeOff size={12} />} label="Ignore" onClick={runIgnore} />
        </div>
      )}

      {/* Confirm dialog — bulk (≥2) resolves only. */}
      <Modal
        isOpen={!!confirm}
        onClose={() => { if (!resolving) setConfirm(null) }}
        title={(() => {
          if (!confirm) return ''
          const p = confirm.pushItems.length, u = confirm.pullItems.length
          if (p && u) return `Sync ${p + u} streams with YouTube?`
          if (p) return `Push ${p} streams to YouTube?`
          return `Pull ${u} streams from YouTube?`
        })()}
        width="md"
        footer={confirm ? (
          <>
            <Button variant="ghost" onClick={() => setConfirm(null)} disabled={resolving}>Cancel</Button>
            <Button variant="primary" icon={resolving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} onClick={runConfirm} disabled={resolving || confirmBlocked}>
              {resolving ? 'Working…' : confirm.pushItems.length && confirm.pullItems.length ? 'Sync' : confirm.pushItems.length ? 'Push to YouTube' : 'Pull into SM'}
            </Button>
          </>
        ) : undefined}
      >
        {confirm && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1 max-h-52 overflow-y-auto pr-1">
              {[...confirm.pushItems.map(i => ({ it: i, dir: 'push' as const })), ...confirm.pullItems.map(i => ({ it: i, dir: 'pull' as const }))].map(({ it, dir }) => (
                <div key={it.folder.folderPath} className="flex items-baseline justify-between gap-3 text-xs">
                  <span className="text-gray-200 truncate">{renderStreamTitle(it.folder, folders)}</span>
                  <span className={`shrink-0 text-[10px] uppercase tracking-wide ${dir === 'push' ? 'text-blue-300' : 'text-orange-300'}`}>{dir}</span>
                </div>
              ))}
            </div>
            {confirm.pushItems.length > 0 && (
              <div className="flex flex-col gap-1.5 text-[11px] text-gray-300 bg-navy-900/60 border border-white/10 rounded-md px-3 py-2 leading-snug">
                <p>Pushing overwrites each video's YouTube title, description, tags, category{confirm.pushItems.some(i => i.folder.meta?.ytPrivacyStatus) ? ', privacy' : ''}{confirm.pushItems.some(i => i.mismatch.has('thumbnail')) ? ', and thumbnail' : ''} with your local values.</p>
                <p>Estimated API quota: <strong className="text-gray-100">~{estUnits.toLocaleString()} units</strong> of the {DAILY_QUOTA.toLocaleString()}/day default. Exceeding the daily limit blocks YouTube push/pull until it resets (~midnight Pacific). YouTube doesn't report remaining quota, so this is an estimate.</p>
              </div>
            )}
            {confirm.pullItems.length > 0 && (
              <p className="text-[11px] text-gray-300 bg-navy-900/60 border border-white/10 rounded-md px-3 py-2 leading-snug">
                Pulling overwrites local title, description, game, tags, category, and privacy for {confirm.pullItems.length} stream{confirm.pullItems.length === 1 ? '' : 's'} with YouTube's current values. No API quota — local change.
              </p>
            )}
            {heavy && (
              <label className="flex flex-col gap-1 text-[11px] text-amber-300">
                <span>This is a large push. Type <strong className="text-amber-200">confirm</strong> to proceed.</span>
                <input value={confirmText} onChange={e => setConfirmText(e.target.value)} placeholder="confirm" autoFocus
                  className="bg-navy-900 border border-white/10 rounded-md px-2 py-1 text-xs text-gray-200 placeholder-gray-600 outline-none focus:border-amber-500/50 w-40" />
              </label>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}

function ActionBtn({ icon, label, onClick, accent }: { icon: React.ReactNode; label: string; onClick: () => void; accent?: string }) {
  return (
    <button onClick={onClick}
      className={`flex items-center gap-1 text-[10px] px-2 py-1 rounded hover:bg-white/10 transition-colors ${accent ?? 'text-gray-200'} hover:text-white`}>
      {icon}{label}
    </button>
  )
}

function Group({
  title, count, accent, action, children,
}: {
  title: string
  count: number
  accent: string
  action?: { label: string; icon: React.ReactNode; onClick: () => void }
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center justify-between gap-2 px-1.5">
        <span className={`text-[10px] font-medium ${accent}`}>{title} · {count}</span>
        {action && (
          <button onClick={action.onClick} className="flex items-center gap-1 text-[10px] text-gray-300 hover:text-white px-1.5 py-0.5 rounded hover:bg-white/10 transition-colors">
            {action.icon}{action.label}
          </button>
        )}
      </div>
      <div className="flex flex-col gap-px">{children}</div>
    </div>
  )
}
