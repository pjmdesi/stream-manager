import React, { useState, useRef, useMemo } from 'react'
import ReactDOM from 'react-dom'
import { ChevronDown, Loader2, AlertTriangle, Link2, Radio } from 'lucide-react'
import type { LiveBroadcast } from '../../types'

/** Cross-link map entry — surfaced under any broadcast in the dropdown that
 *  is already pointed to by a different stream item. Helps the user spot
 *  accidental double-links without preventing intentional ones. */
export interface BroadcastLinkRef {
  broadcastId: string
  folderDate: string
  folderTitle?: string
}

interface BroadcastPickerProps {
  value: string
  onChange: (broadcastId: string) => void
  broadcasts: LiveBroadcast[]
  /** Other stream items already linked to broadcasts in this list. Used to
   *  surface a "Linked to: …" hint under any conflicting option. Should NOT
   *  include the current stream item — the caller is responsible for
   *  filtering itself out before passing this in. */
  otherFolderLinks?: BroadcastLinkRef[]
  loading?: boolean
  /** Placeholder text when no broadcast is selected. */
  placeholder?: string
  /** Distinguishes the "nothing exists yet" empty state from the "select one"
   *  prompt. Surfaced in the trigger when value is empty AND broadcasts is empty. */
  emptyLabel?: string
  /** Past-streams variant — used by VOD picker. Disables the "future" lens
   *  on time formatting (so a VOD from last week reads as "Nov 12 2024"
   *  rather than as a relative day). */
  showDateOnly?: boolean
  /** Click handler for opening — used by the VOD picker to lazy-load the
   *  full list of completed broadcasts on first interaction. */
  onOpen?: () => void
  /** Open the dropdown above the trigger instead of below. For the new
   *  streams page's sidebar where the picker sits low in the viewport
   *  and the downward dropdown would clip against the window edge. */
  dropUp?: boolean
  /** Fallback metadata for the trigger label when the broadcast id in
   *  `value` isn't present in `broadcasts` (e.g. a quota outage blocked
   *  the pool fetch). Renders as the trigger label only — NOT added to
   *  the dropdown options and NOT plumbed into any mismatch logic.
   *  Caller passes locally-cached fields from meta so the link doesn't
   *  appear disconnected during an outage. */
  triggerFallback?: { title: string; scheduledIso?: string }
  /** Click-to-open is blocked when true. The trigger still renders
   *  (showing `selected` or `triggerFallback`) but the dropdown can't
   *  open — used while quota is exceeded since picking a different
   *  broadcast needs a fresh pool fetch. */
  disableOpen?: boolean
  /** Small hint string shown under the trigger when the fallback is in
   *  use — e.g. "Cached — refresh blocked by quota". */
  triggerHint?: string
}

export function BroadcastPicker({
  value,
  onChange,
  broadcasts,
  otherFolderLinks = [],
  loading = false,
  placeholder = 'Select a broadcast…',
  emptyLabel,
  showDateOnly = false,
  onOpen,
  dropUp = false,
  triggerFallback,
  disableOpen = false,
  triggerHint,
}: BroadcastPickerProps) {
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLButtonElement>(null)

  // Pre-index cross-links for O(1) lookup while rendering rows.
  const linkMap = useMemo(() => {
    const m = new Map<string, BroadcastLinkRef[]>()
    for (const link of otherFolderLinks) {
      const arr = m.get(link.broadcastId) ?? []
      arr.push(link)
      m.set(link.broadcastId, arr)
    }
    return m
  }, [otherFolderLinks])

  const selected = useMemo(
    () => broadcasts.find(b => b.id === value) ?? null,
    [broadcasts, value],
  )

  const handleOpen = () => {
    if (loading || disableOpen) return
    if (open) { setOpen(false); return }
    onOpen?.()
    setOpen(true)
  }
  const pick = (broadcastId: string) => {
    onChange(broadcastId)
    setOpen(false)
  }

  // Show the cached fallback only when the pool genuinely missed AND
  // the caller passed a fallback. `value` is the bound broadcast id —
  // having one but no `selected` is the "linked but pool-blind" case
  // we want to cover. Falsy `value` means truly unlinked → fall through
  // to the placeholder.
  const fallbackInUse = !selected && !!value && !!triggerFallback
  const cursorCls = disableOpen
    ? 'cursor-not-allowed'
    : loading
      ? 'cursor-wait'
      : 'cursor-pointer'

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        onClick={handleOpen}
        disabled={loading}
        title={disableOpen ? 'Picker disabled while YouTube quota is exhausted.' : undefined}
        className={`w-full bg-navy-900 border border-white/10 text-gray-200 text-xs rounded-lg px-3 py-2 pr-8 focus:outline-none focus:ring-2 focus:ring-purple-500/50 disabled:opacity-50 ${cursorCls} text-left relative ${
          open ? 'ring-2 ring-purple-500/50' : ''
        } ${disableOpen ? 'opacity-70' : ''}`}
      >
        {selected ? (
          <RowContent broadcast={selected} showDateOnly={showDateOnly} compact />
        ) : fallbackInUse ? (
          <RowContent
            broadcast={{
              id: value,
              snippet: {
                title: triggerFallback!.title || 'Untitled broadcast',
                description: '',
                scheduledStartTime: triggerFallback!.scheduledIso,
              },
              status: { lifeCycleStatus: '', privacyStatus: '' },
            }}
            showDateOnly={showDateOnly}
            compact
          />
        ) : (
          <span className="text-gray-400">
            {broadcasts.length === 0 ? (emptyLabel ?? placeholder) : placeholder}
          </span>
        )}
        {loading
          ? <Loader2 size={12} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 animate-spin" />
          : <ChevronDown size={12} className={`absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 transition-transform ${open ? 'rotate-180' : ''} ${disableOpen ? 'opacity-40' : ''}`} />
        }
      </button>
      {triggerHint && fallbackInUse && (
        <p className="mt-1 text-[10px] text-gray-400 italic">{triggerHint}</p>
      )}

      {open && anchorRef.current && ReactDOM.createPortal(
        (() => {
          const rect = anchorRef.current.getBoundingClientRect()
          return (
            <>
              {/* Backdrop swallows outside clicks. Below the dropdown z-wise
                  so clicks on the items still go through. */}
              <div className="fixed inset-0 z-[9998]" onClick={() => setOpen(false)} />
              <div
                style={{
                  position: 'fixed',
                  left: rect.left,
                  width: rect.width,
                  zIndex: 9999,
                  // `dropUp` flips the anchor edge: the dropdown grows
                  // upward from the trigger, max height capped by space
                  // above the trigger so it never clips past the
                  // viewport top.
                  ...(dropUp
                    ? { bottom: window.innerHeight - rect.top + 4, maxHeight: Math.max(160, rect.top - 16) }
                    : { top: rect.bottom + 4, maxHeight: Math.max(160, window.innerHeight - rect.bottom - 16) }),
                }}
                className="bg-navy-700 border border-white/10 rounded-lg shadow-xl overflow-y-auto"
              >
                {broadcasts.length === 0 ? (
                  <p className="px-3 py-3 text-xs text-gray-400 italic">
                    {emptyLabel ?? 'No broadcasts available.'}
                  </p>
                ) : broadcasts.map(b => {
                  const isCurrent = b.id === value
                  const links = linkMap.get(b.id) ?? []
                  return (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => pick(b.id)}
                      className={`flex flex-col items-start w-full px-3 py-2 text-left transition-colors border-b border-white/5 last:border-b-0 ${
                        isCurrent ? 'bg-white/10 hover:bg-white/15 text-gray-100' : 'text-gray-300 hover:bg-white/5'
                      }`}
                    >
                      <RowContent broadcast={b} showDateOnly={showDateOnly} />
                      {isLikelyDefaultBroadcast(b) && (
                        <span className="mt-1 inline-flex items-start gap-1 text-[10px] text-gray-300 bg-white/5 border border-white/10 rounded px-1.5 py-0.5">
                          <Radio size={9} className="shrink-0 mt-0.5" />
                          <span>Default livestream (no scheduled time)</span>
                        </span>
                      )}
                      {links.length > 0 && (
                        <span className="mt-1 inline-flex items-start gap-1 text-[10px] text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded px-1.5 py-0.5">
                          <Link2 size={9} className="shrink-0 mt-0.5" />
                          <span>
                            Linked to{links.length > 1 ? ` ${links.length} other stream items` : `: ${links[0].folderTitle || links[0].folderDate}`}
                          </span>
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            </>
          )
        })(),
        document.body,
      )}
    </>
  )
}

/** Renders title + scheduled time. `compact` truncates the title so the
 *  closed-anchor state stays single-line. */
function RowContent({
  broadcast,
  showDateOnly,
  compact,
}: {
  broadcast: LiveBroadcast
  showDateOnly?: boolean
  compact?: boolean
}) {
  const title = broadcast.snippet?.title?.trim() || 'Untitled broadcast'
  const start = broadcast.snippet?.actualStartTime ?? broadcast.snippet?.scheduledStartTime ?? ''
  const formatted = start ? (showDateOnly ? formatDateOnly(start) : formatScheduledTime(start)) : ''

  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 min-w-0 w-full leading-tight">
      <span className={`text-xs text-gray-200 ${compact ? 'truncate' : 'break-words'} flex-shrink min-w-0`}>
        {title}
      </span>
      {formatted && (
        <span className="text-[10px] text-gray-400 tabular-nums shrink-0">
          {formatted}
        </span>
      )}
    </div>
  )
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** YouTube's persistent "Stream now" default broadcast has no
 *  scheduledStartTime — event broadcasts always do (it's required at
 *  creation). YouTube's own `snippet.isDefaultBroadcast` field is
 *  deprecated and no longer reliably returned, so we lean on the
 *  data we already have. A broadcast in 'live' state that's the
 *  default will have actualStartTime but still no
 *  scheduledStartTime, so this check works across lifecycle states. */
function isLikelyDefaultBroadcast(b: LiveBroadcast): boolean {
  return !b.snippet?.scheduledStartTime
}

/** "Today 7:00 PM" / "Tomorrow 8:30 PM" / "Jun 17 7:00 PM". */
function formatScheduledTime(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  const isTomorrow = d.toDateString() === tomorrow.toDateString()
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  if (sameDay) return `Today ${time}`
  if (isTomorrow) return `Tomorrow ${time}`
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + time
}

/** Date only, for past streams where the time isn't meaningful. */
function formatDateOnly(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}
