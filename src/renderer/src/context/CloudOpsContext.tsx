import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'

export type CloudOpDirection = 'offload' | 'hydrate'

export type CloudOpItemStatus =
  | 'pending'
  | 'running'
  | 'done'
  | 'already-offline'
  | 'already-local'
  | 'failed'
  | 'skipped-protected'
  | 'cancelled'

export interface CloudOpItem {
  path: string
  name: string
  size: number
  status: CloudOpItemStatus
  reason?: string
  direction: CloudOpDirection
  batchId: string
}

interface CloudOpsContextValue {
  offloadItems: CloudOpItem[]
  hydrateItems: CloudOpItem[]
  offloadActive: boolean
  hydrateActive: boolean
  offloadCancelling: boolean
  hydrateCancelling: boolean
  /** True iff the user has any cloud op (running or just-completed) worth
   *  showing in the modal. The widget uses `*Active` to gate visibility. */
  hasActivity: boolean
  modalOpen: boolean
  enqueueOffload: (files: { path: string; size: number }[]) => void
  enqueueHydrate: (files: { path: string; size: number }[]) => void
  cancelOffload: () => void
  cancelHydrate: () => void
  openModal: () => void
  closeModal: () => void
}

const CloudOpsContext = createContext<CloudOpsContextValue | null>(null)

function makeBatchId(direction: CloudOpDirection): string {
  return `${direction}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function basename(p: string): string {
  return p.split(/[\\/]/).pop() ?? p
}

const TERMINAL_STATUSES: CloudOpItemStatus[] = [
  'done', 'already-offline', 'already-local', 'failed', 'skipped-protected', 'cancelled',
]
function isTerminal(s: CloudOpItemStatus): boolean {
  return TERMINAL_STATUSES.includes(s)
}

export function CloudOpsProvider({ children }: { children: React.ReactNode }) {
  const [offloadItems, setOffloadItems] = useState<CloudOpItem[]>([])
  const [hydrateItems, setHydrateItems] = useState<CloudOpItem[]>([])
  const [modalOpen, setModalOpen] = useState(false)
  const [offloadCancelling, setOffloadCancelling] = useState(false)
  const [hydrateCancelling, setHydrateCancelling] = useState(false)

  // Listen for progress events from main. One listener for the lifetime of
  // the provider — events carry direction + batchId so we route them to the
  // right queue regardless of how many batches are concurrently in flight.
  useEffect(() => {
    const unsub = window.api.onCloudSyncProgress(ev => {
      const setter = ev.direction === 'offload' ? setOffloadItems : setHydrateItems
      if (ev.type === 'init') {
        // Mark protected paths as skipped (offload only — hydrate sends [] here).
        if (ev.skippedProtected.length === 0) return
        const protectedSet = new Set(ev.skippedProtected)
        setter(prev => prev.map(it =>
          it.batchId === ev.batchId && protectedSet.has(it.path)
            ? { ...it, status: 'skipped-protected' as CloudOpItemStatus }
            : it
        ))
      } else if (ev.type === 'item') {
        setter(prev => prev.map(it =>
          it.batchId === ev.batchId && it.path === ev.path
            ? {
                ...it,
                status:
                  ev.status === 'done' ? 'done' :
                  ev.status === 'failed' ? 'failed' :
                  ev.status === 'already-offline' ? 'already-offline' :
                  ev.status === 'already-local' ? 'already-local' :
                  'running',
                reason: ev.reason,
              }
            : it
        ))
      } else if (ev.type === 'complete') {
        // Promote any pending/running rows in this batch to 'cancelled'
        // when the batch was cancelled. Otherwise leave them — the per-item
        // events should have settled them already.
        if (ev.cancelled) {
          setter(prev => prev.map(it =>
            it.batchId === ev.batchId && (it.status === 'pending' || it.status === 'running')
              ? { ...it, status: 'cancelled' as CloudOpItemStatus }
              : it
          ))
        }
      }
    })
    return () => unsub()
  }, [])

  // Derive active flags from queue contents. A direction is "active" iff it
  // has any row not yet in a terminal state.
  const offloadActive = useMemo(
    () => offloadItems.some(it => !isTerminal(it.status)),
    [offloadItems],
  )
  const hydrateActive = useMemo(
    () => hydrateItems.some(it => !isTerminal(it.status)),
    [hydrateItems],
  )

  // Auto-clear "cancelling" flags once the queue drains. The cancel button
  // shows "Cancelling…" until the in-flight file finishes and the queue
  // empties out, at which point the flag returns to false.
  useEffect(() => {
    if (offloadCancelling && !offloadActive) setOffloadCancelling(false)
  }, [offloadCancelling, offloadActive])
  useEffect(() => {
    if (hydrateCancelling && !hydrateActive) setHydrateCancelling(false)
  }, [hydrateCancelling, hydrateActive])

  // The widget is interested in anything still in flight; the modal cares
  // about "anything at all" (so completed rows can still be reviewed). We
  // surface the latter so callers don't have to recompute.
  const hasActivity = offloadItems.length > 0 || hydrateItems.length > 0

  // ─── Actions ──────────────────────────────────────────────────────────────

  const enqueueOffload = useCallback((files: { path: string; size: number }[]) => {
    if (files.length === 0) return
    const batchId = makeBatchId('offload')
    const newRows: CloudOpItem[] = files.map(f => ({
      path: f.path,
      name: basename(f.path),
      size: f.size,
      status: 'pending',
      direction: 'offload',
      batchId,
    }))
    setOffloadItems(prev => {
      // Drop terminal rows from prior batches when the user starts a new one;
      // keep anything still pending/running so concurrent batches stay
      // visible together.
      const stillActive = prev.filter(it => !isTerminal(it.status))
      return [...stillActive, ...newRows]
    })
    setModalOpen(true)
    window.api.cloudSyncOffload(files.map(f => f.path), batchId).catch(() => {})
  }, [])

  const enqueueHydrate = useCallback((files: { path: string; size: number }[]) => {
    if (files.length === 0) return
    const batchId = makeBatchId('hydrate')
    const newRows: CloudOpItem[] = files.map(f => ({
      path: f.path,
      name: basename(f.path),
      size: f.size,
      status: 'pending',
      direction: 'hydrate',
      batchId,
    }))
    setHydrateItems(prev => {
      const stillActive = prev.filter(it => !isTerminal(it.status))
      return [...stillActive, ...newRows]
    })
    setModalOpen(true)
    window.api.cloudSyncPin(files.map(f => f.path), batchId).catch(() => {})
  }, [])

  const cancelOffload = useCallback(() => {
    if (!offloadActive || offloadCancelling) return
    setOffloadCancelling(true)
    window.api.cloudSyncCancelOffload().catch(() => {})
  }, [offloadActive, offloadCancelling])

  const cancelHydrate = useCallback(() => {
    if (!hydrateActive || hydrateCancelling) return
    setHydrateCancelling(true)
    window.api.cloudSyncCancelPin().catch(() => {})
  }, [hydrateActive, hydrateCancelling])

  const openModal = useCallback(() => setModalOpen(true), [])

  const closeModal = useCallback(() => {
    // Auto-clear terminal rows on close; keep anything still in flight so the
    // widget continues to surface progress for the user to come back to.
    setOffloadItems(prev => prev.filter(it => !isTerminal(it.status)))
    setHydrateItems(prev => prev.filter(it => !isTerminal(it.status)))
    setModalOpen(false)
  }, [])

  // Memoize the value object so consumers don't rerender on unrelated state.
  const value = useMemo<CloudOpsContextValue>(() => ({
    offloadItems,
    hydrateItems,
    offloadActive,
    hydrateActive,
    offloadCancelling,
    hydrateCancelling,
    hasActivity,
    modalOpen,
    enqueueOffload,
    enqueueHydrate,
    cancelOffload,
    cancelHydrate,
    openModal,
    closeModal,
  }), [
    offloadItems, hydrateItems,
    offloadActive, hydrateActive,
    offloadCancelling, hydrateCancelling,
    hasActivity, modalOpen,
    enqueueOffload, enqueueHydrate,
    cancelOffload, cancelHydrate,
    openModal, closeModal,
  ])

  return (
    <CloudOpsContext.Provider value={value}>
      {children}
    </CloudOpsContext.Provider>
  )
}

export function useCloudOps(): CloudOpsContextValue {
  const ctx = useContext(CloudOpsContext)
  if (!ctx) throw new Error('useCloudOps must be used within a CloudOpsProvider')
  return ctx
}
