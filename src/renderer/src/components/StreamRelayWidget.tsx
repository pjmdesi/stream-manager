import React, { useEffect, useState, useRef } from 'react'
import ReactDOM from 'react-dom'
import { TrendingUpDown, Calendar, RotateCcw, ChevronDown } from 'lucide-react'
import { useStore } from '../hooks/useStore'
import { Tooltip } from './ui/Tooltip'
import type { RelayStatus, RelayStats, ActivePickResult, OrchestratorEvent, LiveBroadcast, Page } from '../types'

/**
 * Stream Relay sidebar widget — quick status + active-broadcast picker.
 * Only renders when the relay is enabled (per user spec). Clicking the
 * title row navigates to the Integrations page where the relay config
 * lives.
 *
 * Live data subscriptions:
 *   - Status (state + error)         → onRelayStatus
 *   - Stats (kbps, duration, speed)  → onRelayStats
 *   - Active broadcast pick          → onRelayActiveBroadcastChanged
 *   - Upcoming broadcast list        → onRelayUpcomingChanged
 *
 * Layout in collapsed mode mirrors AutoRulesWidget: icon + small status
 * dot. Expanded mode shows the full picker.
 */
export function StreamRelayWidget({
  collapsed,
  onNavigate,
}: {
  collapsed: boolean
  onNavigate: (page: Page) => void
}) {
  const { config } = useStore()
  const [status, setStatus] = useState<RelayStatus>({ state: 'idle' })
  const [stats, setStats] = useState<RelayStats | null>(null)
  const [active, setActive] = useState<ActivePickResult>({ broadcast: null, isManual: false, manualPickStale: false })
  const [upcoming, setUpcoming] = useState<LiveBroadcast[]>([])
  const [lifecycle, setLifecycle] = useState<OrchestratorEvent | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const pickerAnchorRef = useRef<HTMLDivElement>(null)

  // Initial fetch + live subscriptions. The cleanup functions returned from
  // each on* call are the preload's removeListener wrappers — composed via
  // an array so a single useEffect-teardown handles them all.
  useEffect(() => {
    if (!config.streamRelayEnabled) return

    window.api.streamRelayGetStatus().then(setStatus).catch(() => {})
    window.api.streamRelayGetActiveBroadcast().then(setActive).catch(() => {})
    window.api.streamRelayGetUpcomingBroadcasts().then(setUpcoming).catch(() => {})

    const offs = [
      window.api.onRelayStatus(setStatus),
      window.api.onRelayStats(setStats),
      window.api.onRelayStreamStarted(() => setStats(null)),
      window.api.onRelayStreamStopped(() => setStats(null)),
      window.api.onRelayActiveBroadcastChanged(setActive),
      window.api.onRelayUpcomingChanged(setUpcoming),
      window.api.onRelayLifecycle(setLifecycle),
    ]
    return () => { for (const off of offs) off() }
  }, [config.streamRelayEnabled])

  // Per-user spec: hide entirely when feature is off.
  if (!config.streamRelayEnabled) return null

  // ── Helpers ─────────────────────────────────────────────────────────────

  const isStreaming = status.state === 'streaming'
  const isError = status.state === 'error'

  const pickBroadcast = async (broadcastId: string | null) => {
    setPickerOpen(false)
    const result = await window.api.streamRelaySetActiveBroadcast(broadcastId)
    setActive(result)
  }
  const refreshUpcoming = async () => {
    const list = await window.api.streamRelayGetUpcomingBroadcasts(true)
    setUpcoming(list)
    const next = await window.api.streamRelayGetActiveBroadcast()
    setActive(next)
  }
  // Opens the picker and force-refreshes the upcoming list. The refresh
  // covers the case where the widget mounted with an empty cache — without
  // it the dropdown could show "No upcoming broadcasts" even when YouTube
  // has some.
  const togglePicker = () => {
    if (pickerOpen) { setPickerOpen(false); return }
    setPickerOpen(true)
    refreshUpcoming().catch(() => {})
  }

  // ── Collapsed mode ──────────────────────────────────────────────────────

  if (collapsed) {
    return (
      <div className="border-y border-white/5 bg-navy-900">
        <Tooltip content="Stream Relay" side="right" triggerClassName="block w-full">
          <button
            onClick={() => onNavigate('integrations')}
            className="flex items-center justify-center w-full py-2.5 text-sm font-medium transition-colors text-gray-400 hover:text-gray-200"
          >
            <TrendingUpDown size={18} />
          </button>
        </Tooltip>
        <div className="flex items-center justify-center gap-1 pb-2">
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
            isStreaming ? 'bg-green-400 animate-pulse' :
            status.state === 'listening' ? 'bg-gray-200' :
            status.state === 'starting' || status.state === 'restarting' ? 'bg-amber-400' :
            isError ? 'bg-red-400' :
            'bg-gray-600'
          }`} />
        </div>
      </div>
    )
  }

  // ── Expanded mode ──────────────────────────────────────────────────────

  const broadcast = active.broadcast
  const broadcastTitle = broadcast?.snippet?.title?.trim() || 'Untitled broadcast'
  const broadcastTime = broadcast?.snippet?.scheduledStartTime
    ? formatScheduledTime(broadcast.snippet.scheduledStartTime)
    : ''
  const statusLabel = isStreaming ? 'Streaming'
    : status.state === 'listening' ? 'Listening'
    : status.state === 'starting' ? 'Starting…'
    : status.state === 'restarting' ? 'Restarting…'
    : isError ? 'Error'
    : 'Idle'
  const statusColor = isStreaming ? 'text-green-400'
    : status.state === 'listening' ? 'text-gray-200'
    : status.state === 'starting' || status.state === 'restarting' ? 'text-amber-400'
    : isError ? 'text-red-400'
    : 'text-gray-600'

  return (
    <div className="border-y border-white/5 bg-navy-900">
      {/* Title row — navigates to Integrations on click. Icon on the left;
          title + status stacked vertically on the right so the title never
          wraps when the sidebar is at its narrowest. */}
      <button
        onClick={() => onNavigate('integrations')}
        className="flex items-center gap-3 w-full px-4 py-2.5 text-sm font-medium transition-colors text-gray-400 hover:text-gray-200"
      >
        <TrendingUpDown size={18} className="shrink-0" />
        <div className="flex flex-col items-start min-w-0 leading-tight">
          <span className="whitespace-nowrap">Stream Relay</span>
          <span className={`text-[10px] font-medium ${statusColor}`}>
            {status.state === 'idle' ? '○ ' : '● '}{statusLabel}
          </span>
        </div>
      </button>

      {/* Active broadcast row */}
      <div ref={pickerAnchorRef} className="px-3 pb-2 flex flex-col gap-1">
        {broadcast ? (
          <button
            onClick={() => togglePicker()}
            disabled={isStreaming}
            className="flex items-start gap-1.5 w-full px-2 py-1 rounded text-left hover:bg-white/5 transition-colors disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:bg-transparent"
            title={isStreaming ? 'End the current stream to change the active broadcast' : 'Change active broadcast'}
          >
            <Calendar size={11} className="text-purple-400 shrink-0 mt-0.5" />
            <div className="flex flex-col flex-1 min-w-0 leading-tight">
              <span className="text-[11px] text-gray-200 truncate">{broadcastTitle}</span>
              <span className="text-[10px] text-gray-500 tabular-nums">
                {broadcastTime}
                {active.isManual && <span className="text-purple-400 ml-1">· picked</span>}
                {!active.isManual && <span className="text-gray-600 ml-1">· auto</span>}
              </span>
            </div>
            {!isStreaming && <ChevronDown size={11} className="text-gray-500 shrink-0 mt-1" />}
          </button>
        ) : (
          // Render an interactive trigger even with no auto-pick so the user
          // can open the picker to refresh / manually select.
          <button
            onClick={() => togglePicker()}
            disabled={isStreaming}
            className="flex items-center gap-1.5 w-full px-2 py-1 rounded text-left hover:bg-white/5 transition-colors disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:bg-transparent"
            title="Pick a broadcast"
          >
            <Calendar size={11} className="text-gray-500 shrink-0" />
            <span className="text-[10px] text-gray-500 italic flex-1">No upcoming broadcasts.</span>
            {!isStreaming && <ChevronDown size={11} className="text-gray-500 shrink-0" />}
          </button>
        )}

        {/* Stale-pick warning */}
        {active.manualPickStale && (
          <p className="px-2 text-[10px] text-amber-400/80 leading-tight">
            Picked broadcast no longer upcoming. Showing soonest instead.
          </p>
        )}

        {/* Lifecycle stage strip — shown for transitional states only. The
            stable 'live' state isn't surfaced separately because the status
            pill at the top already says "Streaming". */}
        {lifecycle && lifecycle.stage === 'binding' && (
          <p className="px-2 text-[10px] text-amber-400 leading-tight">
            Connecting broadcast{lifecycle.broadcastTitle ? `: ${lifecycle.broadcastTitle}` : '…'}
          </p>
        )}
        {lifecycle && lifecycle.stage === 'going-live' && (
          <p className="px-2 text-[10px] text-amber-400 leading-tight">
            Going live{lifecycle.broadcastTitle ? ` as ${lifecycle.broadcastTitle}` : '…'}
          </p>
        )}
        {lifecycle && lifecycle.stage === 'grace' && (
          <p className="px-2 text-[10px] text-amber-400 leading-tight tabular-nums">
            Finalizing in {lifecycle.graceRemainingSec ?? 30}s…
          </p>
        )}
        {lifecycle && lifecycle.stage === 'completing' && (
          <p className="px-2 text-[10px] text-amber-400 leading-tight">
            Finalizing broadcast…
          </p>
        )}
        {lifecycle && lifecycle.stage === 'no-broadcast' && isStreaming && (
          <p className="px-2 text-[10px] text-gray-500 leading-tight">
            Streaming without a bound broadcast (YouTube will auto-create one).
          </p>
        )}

        {/* Live stats while streaming */}
        {isStreaming && stats && lifecycle?.stage !== 'going-live' && lifecycle?.stage !== 'binding' && (
          <div className="px-2 pt-1 flex items-center gap-2 text-[10px] text-gray-500 tabular-nums">
            <span>{Math.round(stats.kbps)} kbps</span>
            <span>·</span>
            <span>{formatDurationSec(stats.durationSec)}</span>
            {stats.speed < 0.97 && (
              <span className="text-amber-400">· {stats.speed.toFixed(2)}x</span>
            )}
          </div>
        )}

        {/* Error surface — prefer the orchestrator's more specific error if
            present (it's about the YT-side lifecycle), else show the relay's
            own connection error. */}
        {lifecycle?.stage === 'error' && lifecycle.error && (
          <p className="px-2 text-[10px] text-red-400 leading-tight">
            {lifecycle.error}
          </p>
        )}
        {isError && status.error && lifecycle?.stage !== 'error' && (
          <p className="px-2 text-[10px] text-red-400 leading-tight">
            {status.error}
          </p>
        )}
      </div>

      {/* Picker dropdown — portalled out of the sidebar so the overflow-hidden
          on the nav doesn't clip it. Anchored to the right edge of the sidebar
          so it pops out beside the widget. */}
      {pickerOpen && pickerAnchorRef.current && ReactDOM.createPortal(
        (() => {
          const rect = pickerAnchorRef.current.getBoundingClientRect()
          return (
            <>
              <div className="fixed inset-0 z-[60]" onClick={() => setPickerOpen(false)} />
              <div
                style={{
                  position: 'fixed',
                  top: rect.top,
                  left: rect.right + 4,
                  zIndex: 61,
                  maxHeight: Math.max(160, window.innerHeight - rect.top - 12),
                }}
                className="bg-navy-700 border border-white/10 rounded-lg shadow-xl w-72 overflow-y-auto"
              >
                <div className="sticky top-0 z-10 bg-navy-700 px-3 py-2 border-b border-white/5 flex items-center gap-2">
                  <span className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">Pick a broadcast</span>
                  <Tooltip content="Refresh from YouTube" side="bottom">
                    <button
                      onClick={refreshUpcoming}
                      className="ml-auto p-1 rounded text-gray-500 hover:text-gray-200 hover:bg-white/5 transition-colors"
                    >
                      <RotateCcw size={11} />
                    </button>
                  </Tooltip>
                </div>
                {/* Auto-pick row — clears the manual override */}
                <button
                  onClick={() => pickBroadcast(null)}
                  className={`flex flex-col items-start w-full px-3 py-2 text-left transition-colors border-b border-white/5 ${
                    !active.isManual ? 'bg-purple-600/20 text-purple-200' : 'text-gray-300 hover:bg-white/5'
                  }`}
                >
                  <span className="text-[11px] font-medium">Use soonest upcoming (auto)</span>
                  <span className="text-[10px] text-gray-500">SM auto-picks the next-scheduled broadcast</span>
                </button>
                {upcoming.length === 0 ? (
                  <p className="px-3 py-3 text-[11px] text-gray-500 italic">No upcoming broadcasts.</p>
                ) : upcoming.map(b => {
                  const isCurrent = active.isManual && active.broadcast?.id === b.id
                  const title = b.snippet?.title?.trim() || 'Untitled broadcast'
                  const when = b.snippet?.scheduledStartTime
                    ? formatScheduledTime(b.snippet.scheduledStartTime)
                    : ''
                  return (
                    <button
                      key={b.id}
                      onClick={() => pickBroadcast(b.id)}
                      className={`flex flex-col items-start w-full px-3 py-1.5 text-left transition-colors ${
                        isCurrent ? 'bg-purple-600/20 text-purple-200' : 'text-gray-300 hover:bg-white/5'
                      }`}
                    >
                      <span className="text-[11px] truncate w-full">{title}</span>
                      <span className="text-[10px] text-gray-500 tabular-nums">{when}</span>
                    </button>
                  )
                })}
              </div>
            </>
          )
        })(),
        document.body,
      )}
    </div>
  )
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** "Today 7:00 PM" / "Tomorrow 8:30 PM" / "Jun 17 7:00 PM" — short, human. */
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

/** HH:MM:SS — drops the hours segment when zero. */
function formatDurationSec(s: number): string {
  if (!Number.isFinite(s) || s < 0) return '0:00'
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = Math.floor(s % 60)
  const mm = String(m).padStart(2, '0')
  const ss = String(sec).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`
}
