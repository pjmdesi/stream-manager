import React, { useState, useEffect, useCallback, useRef, Component } from 'react'
import * as LucideIcons from 'lucide-react'
import { version as appVersion } from '../../../package.json'
import { Film, Shuffle, Zap, Settings, Minus, Square, Minimize2, X, Radio, Combine, Plug, Play, AlertTriangle, ArrowDownToDot, AlertCircle, Bot, CheckCircle, Loader2, RefreshCw, Pause, Rocket, Image as ImageIcon, Cloud, Star, GitBranch } from 'lucide-react'
import { Youtube as BrandYoutube, Twitch as BrandTwitch } from './components/ui/BrandIcons'
import { Button } from './components/ui/Button'
import { Modal } from './components/ui/Modal'
import { Tooltip } from './components/ui/Tooltip'
import logoUrl from './assets/stream-manager-logo.svg'
import type { Page, LauncherGroup } from './types'
import { StreamsPage } from './components/pages/StreamsPage'
import { PlayerPage } from './components/pages/PlayerPage'
import { TemplatesPage } from './components/pages/TemplatesPage'
import { RulesPage } from './components/pages/RulesPage'
import { ConverterPage } from './components/pages/ConverterPage'
import { CombinePage } from './components/pages/CombinePage'
import { IntegrationsPage } from './components/pages/IntegrationsPage'
import { SettingsPage } from './components/pages/SettingsPage'
import { LauncherPage } from './components/pages/LauncherPage'
import { ThumbnailPage } from './components/pages/ThumbnailPage'
import { useConversionJobs } from './context/ConversionContext'
import { useWatcher } from './context/WatcherContext'
import { CloudOpsProvider } from './context/CloudOpsContext'
import { RelayPromptProvider } from './context/RelayPromptContext'
import { CloudOpsModal } from './components/CloudOpsModal'
import { CloudOpsWidget } from './components/CloudOpsWidget'
import { StreamRelayWidget } from './components/StreamRelayWidget'
import { useStore } from './hooks/useStore'
import { useAnimationConfig } from './hooks/useAnimationConfig'
import { OnboardingModal } from './components/OnboardingModal'
import { HelpModal } from './components/HelpModal'
import { isAnyModalOpen, isTypingTarget } from './lib/shortcuts'
import { PostStreamTwitchModal } from './components/PostStreamTwitchModal'
import { ThumbnailEditorProvider, useThumbnailEditor } from './context/ThumbnailEditorContext'
import { PageActivityProvider, usePageActivity } from './context/PageActivityContext'
import type { PendingThumbnailStream } from './context/ThumbnailEditorContext'

class PageErrorBoundary extends Component<{ children: React.ReactNode }, { error: Error | null }> {
  constructor(props: { children: React.ReactNode }) {
    super(props)
    this.state = { error: null }
  }
  static getDerivedStateFromError(error: Error) { return { error } }
  render() {
    if (this.state.error) {
      return (
        <div className="flex flex-col items-center justify-center h-full gap-4 text-center px-8">
          <AlertTriangle size={32} className="text-red-400" />
          <p className="text-sm text-gray-300 font-medium">Something went wrong on this page.</p>
          <p className="text-xs text-gray-400 font-mono break-all max-w-lg">{this.state.error.message}</p>
          <button
            onClick={() => this.setState({ error: null })}
            className="px-3 py-1.5 rounded text-xs bg-white/10 hover:bg-white/15 text-gray-300 transition-colors"
          >
            Try again
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

interface PendingFile {
  path: string
  token: number  // increment to re-trigger even if same path
}

interface PendingFiles {
  paths: string[]
  token: number
  /** Set when the files were sent from a stream — powers the combine rows'
   *  stream-title link + date (mirrors PendingConverterFile.stream). */
  stream?: { folderPath: string; label: string; date?: string }
}

interface PendingConverterFile {
  paths: string[]
  token: number
  /** Set when the files were sent from a stream — drives the "from stream" link
   *  in the converter and the click-to-open-its-sidebar navigation back. All
   *  paths in one send share the same origin (they come from one folder). */
  stream?: { folderPath: string; label: string }
}

/** ETA formatter for the conversion widget. Uses `h m` for ≥ 1 minute and
 *  drops to `s` for sub-minute so the countdown stays readable as a job
 *  approaches completion. Negative or NaN inputs render as empty so a
 *  garbage estimate doesn't leak into the UI. */
function formatEta(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return ''
  const totalSec = Math.round(ms / 1000)
  if (totalSec < 60) return `${totalSec}s`
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

/** Live-conversion info block for the hybrid Converter nav item (nav
 *  redesign Pass B). Slides shut while the converter is quiet (SlideBlock
 *  animates the info's appearance when a job starts and its disappearance
 *  when the last one finishes); while jobs are active it expands the nav
 *  item with the info the old bottom-stack ConversionWidget showed — same
 *  states (running / paused / error / all-downloading) and the same
 *  aggregate progress + ETA math.
 *  Deliberately no background, border, or click handling of its own: it
 *  renders INSIDE the nav item's button (plain content only — nested
 *  buttons are invalid HTML), so the item is one interactive surface.
 *  Unlike the old widget it stays visible while the converter page is
 *  open — hiding on selection would bounce the nav. */
function ConverterNavExtra({ collapsed }: { collapsed: boolean }) {
  const { jobs, jobEtas } = useConversionJobs()
  const anim = useAnimationConfig()

  // Include 'downloading' (cloud-hydrate wait) and 'replacing' (atomic swap)
  // as active states so the widget keeps surfacing while files are still
  // hydrating — otherwise queueing an archive against cloud placeholders
  // looked like "nothing happened" until the first file finished
  // downloading and started encoding.
  const relevant = jobs.filter(j => j.status === 'running' || j.status === 'paused' || j.status === 'error' || j.status === 'done')
  const active = jobs.filter(j =>
    j.status === 'running' || j.status === 'paused' || j.status === 'error' ||
    j.status === 'downloading' || j.status === 'replacing'
  )
  // No early null — the SlideBlock below animates the appearance and
  // disappearance of the info, so it must stay mounted while quiet.
  const hasContent = active.length > 0

  const hasError = active.some(j => j.status === 'error')
  const allPaused = !hasError && active.every(j => j.status === 'paused')
  // Only true when EVERY active job is mid-cloud-hydrate. As soon as one
  // job starts encoding the widget reverts to its normal percentage view.
  const allDownloading = !hasError && !allPaused && active.every(j => j.status === 'downloading')

  const label =
    hasError ? 'Error' :
    allPaused ? 'All Paused' :
    allDownloading ? 'Waiting on Download' :
    'In Progress'
  const totalProgress = relevant.length > 0
    ? relevant.reduce((sum, j) => sum + j.progress, 0) / relevant.length
    : 0

  // ETA = max of all currently-running job ETAs (jobs run in parallel, so
  // "time until everything's done" = whenever the slowest finishes, NOT
  // the sum). Anything paused / queued / downloading / replacing is
  // indeterminate from here, as is any running job that hasn't yet
  // produced a first ETA tick — they contribute a "+" suffix instead of
  // skewing the number.
  const running = active.filter(j => j.status === 'running')
  const runningEtas = running
    .map(j => jobEtas.get(j.id))
    .filter((e): e is number => typeof e === 'number' && e > 0)
  const maxEta = runningEtas.length > 0 ? Math.max(...runningEtas) : null
  const hasIndeterminate = active.some(j => j.status !== 'running') || runningEtas.length < running.length
  const etaText = maxEta !== null ? `${formatEta(maxEta)}${hasIndeterminate ? '+' : ''}` : ''
  const etaTitle = etaText
    ? 'Time remaining for active conversions. Paused, queued, and downloading tasks are not included.'
    : undefined

  const barColor =
    hasError ? 'bg-red-500' :
    allPaused ? 'bg-yellow-400' :
    allDownloading ? 'bg-blue-400' :
    'bg-purple-500'
  const statusColor =
    hasError ? 'text-red-400' :
    allPaused ? 'text-yellow-400' :
    allDownloading ? 'text-blue-400' :
    'text-purple-400'

  // Icon-mode: the nav item's own Zap is the primary icon directly
  // above, so the extra only shows the secondary indicators (percent /
  // cloud, status icon), centered under it.
  const body = !hasContent ? null : collapsed ? (
      <div className="w-full pt-0.5 pb-2 flex flex-col items-center gap-0.5">
        {allDownloading
          ? <Cloud size={12} className="text-blue-400" />
          : <span className={`text-[10px] tabular-nums ${statusColor}`}>{totalProgress.toFixed(0)}%</span>
        }
        {hasError
          ? <AlertCircle size={10} className="text-red-400" />
          : allPaused
            ? <Pause size={10} className="text-yellow-400" />
            : <RefreshCw size={10} className={`${statusColor} animate-spin`} />
        }
      </div>
  ) : (
    // Expanded: the nav item's label is the title, so no "Converting"
    // header — just the aggregate bar and one status line.
    <div className="w-full px-3.5 pt-0.5 pb-2 text-left whitespace-nowrap">
      <div className="h-1 w-full bg-white/10 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${barColor}`}
          style={{ width: `${totalProgress}%` }}
        />
      </div>
      <div className="mt-1 text-[10px] tabular-nums flex items-center justify-between gap-2">
        <span className="min-w-0 overflow-hidden">
          <span className={`font-medium ${statusColor}`}>{label}</span>
          <span className="text-gray-400">
            {allDownloading
              ? ` · ${active.length} downloading`
              : ` · ${totalProgress.toFixed(1)}% · ${active.length} job${active.length !== 1 ? 's' : ''}`}
          </span>
        </span>
        {etaText && <Tooltip content={etaTitle}><span className="text-gray-400 shrink-0">{etaText}</span></Tooltip>}
      </div>
    </div>
  )
  return (
    <SlideBlock show={hasContent} durationMs={anim.duration(200)}>
      {body}
    </SlideBlock>
  )
}

/** Watcher status for the hybrid Auto-Rules nav item (nav redesign Pass
 *  B) — passive info, so it renders INSIDE the nav button (plain content
 *  only). Shows only while the watcher is RUNNING: that's the "work in
 *  progress" state that earns the item its expansion; stopped is the
 *  quiet state (the start control stays reachable via the row action). */
/** Compact watcher status as the Auto-Rules item's second line — the
 *  subtitle layout the other nav items use: "[dot] Running • enabled/total",
 *  only while the watcher runs. */
function AutoRulesSubline() {
  const { rules, running } = useWatcher()
  if (!running) return null
  const enabledCount = rules.filter(r => r.enabled).length
  return (
    <span className="flex items-center gap-1.5 leading-tight text-[10px] font-normal text-gray-400">
      <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-green-400 animate-pulse" />
      <span className="truncate">Running • {enabledCount}/{rules.length}</span>
    </span>
  )
}

/** Dot+icon status row for the Integrations nav item (nav redesign Pass C
 *  sub-item m), rendered as the item's second line. One pair per SET-UP
 *  service (green dot healthy, amber dot broken); services the user never
 *  connected show nothing at all — resting quiet beats a gray dot. */
function IntegrationsSubline({ status }: { status: Record<'youtube' | 'twitch' | 'claude', { setUp: boolean; healthy: boolean }> }) {
  const services: Array<{ key: 'youtube' | 'twitch' | 'claude'; icon: React.ReactNode }> = [
    { key: 'youtube', icon: <BrandYoutube size={11} /> },
    { key: 'twitch', icon: <BrandTwitch size={11} /> },
    { key: 'claude', icon: <Bot size={11} /> },
  ]
  const shown = services.filter(s => status[s.key].setUp)
  if (shown.length === 0) return null
  return (
    <span className="flex items-center gap-2 leading-tight">
      {shown.map(s => (
        <span key={s.key} className="flex items-center gap-1">
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${status[s.key].healthy ? 'bg-green-400' : 'bg-amber-400'}`} />
          <span className="text-gray-400 inline-flex">{s.icon}</span>
        </span>
      ))}
    </span>
  )
}

/** Start/Stop control for the Auto-Rules nav item — an ACTION, so it gets
 *  its own surface via NavItem.rowAction (same placement rules as the
 *  Launcher's quick-launch). Self-nulls when no rules exist yet. */
function AutoRulesNavAction({ collapsed, active, onNavigate }: { collapsed: boolean; active?: boolean; onNavigate?: () => void }) {
  const { rules, running, startWatcher, stopWatcher } = useWatcher()
  const enabledCount = rules.filter(r => r.enabled).length
  if (rules.length === 0) return null
  // stopPropagation: the collapsed container navigates on click, and the
  // control must not double as a navigation.
  const button = running ? (
    <Button
      variant="danger"
      size="sm"
      icon={<Square size={collapsed ? 12 : 14} />}
      className="justify-center"
      onClick={e => { e.stopPropagation(); stopWatcher() }}
      aria-label="Stop watcher"
    />
  ) : (
    <Button
      variant="success"
      size="sm"
      icon={<Play size={collapsed ? 12 : 14} />}
      className="justify-center"
      onClick={e => { e.stopPropagation(); startWatcher() }}
      disabled={enabledCount === 0}
      aria-label="Start watcher"
    />
  )
  const tooltip = running
    ? 'Stop the file watcher'
    : enabledCount === 0
      ? 'No enabled rules — enable one on the Auto-Rules page first'
      : `Start the file watcher · ${enabledCount} rule${enabledCount !== 1 ? 's' : ''} enabled`
  if (collapsed) {
    // Control first (directly under the nav icon), status below — and the
    // status uses the same enabled/total format as the expanded subtitle.
    // The block lives inside the item's group/nav wrapper, so the whole
    // column washes as ONE hover surface; when the page is OPEN it
    // continues the selected purple + side borders down the column
    // (transparent borders otherwise, so selection never shifts layout).
    return (
      <div
        onClick={onNavigate}
        className={`flex flex-col items-center gap-1 pb-2 pt-0.5 border border-t-0 cursor-pointer transition-colors ${active ? 'bg-purple-600/20 border-purple-600/30' : 'border-transparent group-hover/nav:bg-white/5'}`}
      >
        <Tooltip content={tooltip} side="right">{button}</Tooltip>
        {running && (
          <div className="flex items-center justify-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-green-400 animate-pulse" />
            <span className="text-[10px] text-gray-400 tabular-nums">{enabledCount}/{rules.length}</span>
          </div>
        )}
      </div>
    )
  }
  return <Tooltip content={tooltip} side="right">{button}</Tooltip>
}

/** jQuery slideDown/slideUp-style height reveal for the rail's collapsed
 *  widgets (nav redesign): mounts closed and eases open when `open` goes
 *  true (double-rAF so the zero-height frame paints first), eases shut
 *  when it goes false — the caller keeps it mounted through the close
 *  animation and unmounts afterward. Grid-rows 0fr↔1fr is the animatable
 *  height-to-auto trick (same family as CollapsibleLabel's grid-cols). */
function SlideOpen({ open, durationMs, children }: { open: boolean; durationMs: number; children: React.ReactNode }) {
  // Seeded from `open` so mounting in the steady-open state (app boots
  // with the rail already collapsed) renders open without an entrance
  // slide; a mid-choreography mount starts closed and animates.
  const [shown, setShown] = useState(open)
  useEffect(() => {
    if (!open) { setShown(false); return }
    let raf2 = 0
    const raf1 = requestAnimationFrame(() => { raf2 = requestAnimationFrame(() => setShown(true)) })
    return () => { cancelAnimationFrame(raf1); cancelAnimationFrame(raf2) }
  }, [open])
  return (
    <div
      className="grid transition-[grid-template-rows]"
      style={{ gridTemplateRows: shown ? '1fr' : '0fr', transitionDuration: `${durationMs}ms` }}
    >
      <div className="overflow-hidden min-h-0">{children}</div>
    </div>
  )
}

/** Slide-open/slide-shut visibility for a nav item's live info block (nav
 *  redesign, todo sub-item o): content appearing eases the block open —
 *  the same feel as the collapsed-rail slide — and content disappearing
 *  eases it shut, holding the last rendered state through the exit so a
 *  finishing job closes on its "100%" rather than blanking. Mounting in
 *  the steady-shown state (app boots with jobs running) renders open
 *  without an entrance slide. */
function SlideBlock({ show, durationMs, children }: { show: boolean; durationMs: number; children?: React.ReactNode }) {
  const [shown, setShown] = useState(show)
  const [mounted, setMounted] = useState(show)
  const heldRef = useRef<React.ReactNode>(show ? children : null)
  if (show) heldRef.current = children
  useEffect(() => {
    if (show) {
      setMounted(true)
      let raf2 = 0
      const raf1 = requestAnimationFrame(() => { raf2 = requestAnimationFrame(() => setShown(true)) })
      return () => { cancelAnimationFrame(raf1); cancelAnimationFrame(raf2) }
    }
    setShown(false)
    const t = setTimeout(() => { setMounted(false); heldRef.current = null }, durationMs)
    return () => clearTimeout(t)
  }, [show, durationMs])
  if (!mounted) return null
  return (
    <div
      className="grid transition-[grid-template-rows] ease-out"
      style={{ gridTemplateRows: shown ? '1fr' : '0fr', transitionDuration: `${durationMs}ms` }}
    >
      <div className="overflow-hidden min-h-0">{heldRef.current}</div>
    </div>
  )
}

/** Animated appearance for a nav item's subtitle line (nav redesign): the
 *  line's height eases open — which floats the title up to its two-line
 *  position, since the row's flex centering tracks the growing stack —
 *  while the text fades in and rises into place. Disappearing plays the
 *  reverse, holding the last text through the exit before unmounting.
 *  A text CHANGE while visible swaps in place with no animation. */
function NavSubtextReveal({ text, durationMs }: { text: string | null | undefined; durationMs: number }) {
  const [shown, setShown] = useState(!!text)
  // Last non-null text — kept through the exit animation so the line has
  // something to fade out.
  const [held, setHeld] = useState<string | null>(text ?? null)
  useEffect(() => {
    if (text) {
      setHeld(text)
      // Double rAF: let the closed state paint first so a fresh
      // appearance eases open instead of popping.
      let raf2 = 0
      const raf1 = requestAnimationFrame(() => { raf2 = requestAnimationFrame(() => setShown(true)) })
      return () => { cancelAnimationFrame(raf1); cancelAnimationFrame(raf2) }
    }
    setShown(false)
    const t = setTimeout(() => setHeld(null), durationMs)
    return () => clearTimeout(t)
  }, [text, durationMs])
  if (!held) return null
  return (
    <span
      className="grid transition-[grid-template-rows] ease-out"
      style={{ gridTemplateRows: shown ? '1fr' : '0fr', transitionDuration: `${durationMs}ms` }}
    >
      <span
        className={`block truncate leading-tight text-[10px] font-normal text-gray-400 min-h-0 overflow-hidden transition-[opacity,transform] ease-out ${shown ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-1'}`}
        style={{ transitionDuration: `${durationMs}ms` }}
      >
        {held}
      </span>
    </span>
  )
}

/** Resolve a launch group's chosen icon name (kebab-case, as the launcher
 *  page stores it) to its Lucide component; falls back to Rocket when the
 *  group has no icon set or the name doesn't resolve. */
function GroupIcon({ name, size = 16 }: { name?: string; size?: number }) {
  const pascal = (n: string) => n.split('-').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join('')
  const Icon = name
    ? (((LucideIcons as unknown) as Record<string, React.ComponentType<{ size?: number }>>)[pascal(name)] ?? Rocket)
    : Rocket
  return <Icon size={size} />
}

/** Quick-launch control for the Launcher nav item (nav redesign Pass B).
 *  Launching is an ACTION, not passive status, so — unlike the converter's
 *  info block — it gets its own interactive surface instead of living
 *  inside the nav button:
 *    expanded  → hover-revealed icon button on the row's right (the
 *                startup-star pattern; sits left of the star's slot)
 *    collapsed → compact centered launch row below the item, mirroring
 *                the old widget's collapsed shape
 *  Self-nulls when no launch group is pinned to the widget slot. The icon
 *  doubles as transient feedback: spinner while launching, check on
 *  success, amber alert when some apps failed (details in the tooltip). */
function LauncherNavAction({ collapsed, active, onNavigate }: { collapsed: boolean; active?: boolean; onNavigate?: () => void }) {
  const { config } = useStore()
  const [groups, setGroups] = useState<LauncherGroup[]>([])
  const [launching, setLaunching] = useState(false)
  const [feedback, setFeedback] = useState<{ text: string; ok: boolean } | null>(null)

  useEffect(() => {
    const refetch = () => { window.api.getLauncherGroups().then(setGroups).catch(() => {}) }
    refetch()
    // LauncherPage dispatches this on every save so the control reflects
    // renames / app-list edits live instead of serving a stale snapshot.
    window.addEventListener('sm:launcher-groups-changed', refetch)
    return () => window.removeEventListener('sm:launcher-groups-changed', refetch)
  }, [config.launcherWidgetGroupId])

  const group = groups.find(g => g.id === config.launcherWidgetGroupId) ?? null
  // Transient launch feedback as the Launcher item's subtext — ONLY for
  // the feedback window (2-4s), then cleared. The pinned group's NAME is
  // deliberately not published: subtext pairs with the activity paradigm
  // ("something is open / just happened"), and static configuration
  // isn't that — the group's identity already shows via the launch
  // button's icon and its tooltip (name + app list).
  const { setNavSubtext } = usePageActivity()
  const feedbackText = feedback?.text ?? null
  useEffect(() => {
    setNavSubtext('launcher', feedbackText)
  }, [feedbackText, setNavSubtext])
  if (!group) return null

  const launch = async () => {
    if (launching) return
    setLaunching(true)
    try {
      const result = await window.api.launchGroup(group.id)
      const ok = result.failed.length === 0
      setFeedback({
        text: ok
          ? `Launched ${result.launched}`
          : `${result.launched} of ${result.launched + result.failed.length} launched`,
        ok,
      })
      setTimeout(() => setFeedback(null), ok ? 2000 : 4000)
    } finally {
      setLaunching(false)
    }
  }

  const appCount = group.apps.length
  const tooltipContent = (
    <div className="flex flex-col gap-0.5">
      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">
        {feedback ? feedback.text : `Launch ${group.name}`}
      </p>
      {group.apps.map(a => (
        <p key={a.id} className="text-xs text-gray-200">{a.name}</p>
      ))}
    </div>
  )
  // Resting icon is the GROUP's chosen icon (Rocket only as its fallback),
  // not a repeat of the nav item's Rocket right next to it — it identifies
  // WHAT gets launched. Transient states still override.
  const statusIcon = (size: number) =>
    launching ? <Loader2 size={size} className="animate-spin" />
      : feedback ? (feedback.ok ? <CheckCircle size={size} className="text-green-400" /> : <AlertCircle size={size} className="text-amber-400" />)
        : <GroupIcon name={group.icon} size={size} />

  // `border border-transparent` on both buttons: the primary variant has
  // no border while the Auto-Rules control uses bordered variants
  // (success/danger) — without the compensation the two boxes differ by
  // 2px and the column doesn't line up.
  if (collapsed) {
    // The block lives inside the item's group/nav wrapper, so the whole
    // column washes as ONE hover surface; when the page is OPEN it
    // continues the selected purple + side borders down the column
    // (transparent borders otherwise, so selection never shifts layout).
    return (
      <div
        onClick={onNavigate}
        className={`flex justify-center pb-2 pt-0.5 border border-t-0 cursor-pointer transition-colors ${active ? 'bg-purple-600/20 border-purple-600/30' : 'border-transparent group-hover/nav:bg-white/5'}`}
      >
        <Tooltip content={tooltipContent} side="right" shortcut="Ctrl+L">
          <Button
            variant="primary"
            size="sm"
            icon={statusIcon(12)}
            className="justify-center border border-transparent"
            disabled={launching || appCount === 0}
            onClick={e => { e.stopPropagation(); launch() }}
          />
        </Tooltip>
      </div>
    )
  }

  // Expanded: proper Button treatment (same primary icon-button as the
  // collapsed row), always visible — a launch affordance shouldn't need
  // discovering via hover.
  return (
    <Tooltip content={tooltipContent} side="right" shortcut="Ctrl+L">
      <Button
        variant="primary"
        size="sm"
        icon={statusIcon(14)}
        className="justify-center border border-transparent"
        disabled={launching || appCount === 0}
        onClick={launch}
        aria-label={`Launch ${group.name}`}
      />
    </Tooltip>
  )
}

type NavItem = {
  id: Page
  label: string
  icon: React.ReactNode
  /** Hybrid nav/widget items (nav redesign Pass B): a component rendered
   *  INSIDE the nav item's button, below the icon+label line. It
   *  self-nulls while its tool is quiet and expands the item with live
   *  info while work is in progress — the widget behavior, absorbed into
   *  the item as one interactive surface (one hover, one click, one
   *  focus target). Must render plain content only, never its own
   *  button: it lives inside the nav button. */
  extra?: React.ComponentType<{ collapsed: boolean }>
  /** ACTION control for the item — the counterpart to `extra` for hybrid
   *  items whose widget behavior is a control rather than status (rule:
   *  passive status lives inside the nav button, actions get their own
   *  surface). Expanded: rendered as a hover-revealed overlay at the
   *  row's right, left of the startup star. Collapsed: rendered as its
   *  own compact row below the item, receiving `active` so it can
   *  continue the selected-page styling down the column. May render real
   *  buttons — it is never nested inside the nav button. Collapsed
   *  blocks treat any click OUTSIDE their real button as navigation
   *  (`onNavigate`) so the whole item column stays one navigable
   *  surface. */
  rowAction?: React.ComponentType<{ collapsed: boolean; active?: boolean; onNavigate?: () => void }>
}

// Nav groups (nav redesign). Group names are internal reference only —
// nothing renders them.
//   Create    — the content-producing pages.
//   Utilities — post-stream processing tools with live activity; hybrid
//               nav/widget items (Pass B), and Auto-Rules joins the group
//               when its widget converts to one.
//   Session   — live-session helpers: pre-stream prep now (Launcher),
//               and Stream Relay whenever it gets its own page. Split
//               from Utilities because these are action-oriented, not
//               passive processing status.
//   System    — settings pages, pinned to the bottom of the nav's
//               flexible zone by the spacer in the render (they're also
//               excluded from the startup-page selector).
const NAV_GROUP_CREATE: NavItem[] = [
  { id: 'streams',    label: 'Streams',    icon: <Radio size={18} /> },
  { id: 'player',     label: 'Player',     icon: <Film size={18} /> },
  { id: 'thumbnails', label: 'Thumbnails', icon: <ImageIcon size={18} /> },
]
const NAV_GROUP_UTILITIES: NavItem[] = [
  { id: 'converter', label: 'Converter',  icon: <Zap size={18} />, extra: ConverterNavExtra },
  { id: 'combine',   label: 'Combine',    icon: <Combine size={18} /> },
  // Auto-Rules collapsed status lives inside its rowAction (control on
  // top, dot + enabled/total below); expanded status is the subline.
  { id: 'rules',     label: 'Auto-Rules', icon: <Shuffle size={18} />, rowAction: AutoRulesNavAction },
]
const NAV_GROUP_SESSION: NavItem[] = [
  { id: 'launcher', label: 'Launcher', icon: <Rocket size={18} />, rowAction: LauncherNavAction },
]
const NAV_GROUP_SYSTEM: NavItem[] = [
  { id: 'integrations', label: 'Integrations', icon: <Plug size={18} /> },
  { id: 'settings',     label: 'Settings',     icon: <Settings size={18} /> },
]
/** Flat list in rendered order — feeds startup-page validation and any
 *  other "is this a nav page" check. */
const NAV_ITEMS: NavItem[] = [...NAV_GROUP_CREATE, ...NAV_GROUP_UTILITIES, ...NAV_GROUP_SESSION, ...NAV_GROUP_SYSTEM]

// Page-jump shortcut labels for the collapsed-nav tooltips (mirror the global
// handler's Ctrl+1…6 / Ctrl+,). The number corresponds to the item's VISUAL
// position in the nav, not the page's identity — reordering the nav
// renumbers the shortcuts. PAGE_NAV (the handler's array) must stay in sync
// with this order.
const NAV_SHORTCUTS: Partial<Record<Page, string>> = {
  streams: 'Ctrl+1', player: 'Ctrl+2', thumbnails: 'Ctrl+3',
  converter: 'Ctrl+4', combine: 'Ctrl+5', rules: 'Ctrl+6',
  launcher: 'Ctrl+7', settings: 'Ctrl+,',
}

function AppInner() {
  const [page, setPageRaw] = useState<Page>('streams')
  // Tracks whether SettingsPage has unsaved changes — reported up via its
  // onDirtyChange callback. When true and the user attempts to navigate
  // anywhere, the wrapped setPage below intercepts and stashes the target
  // in pendingNav; SettingsPage then renders a Save/Discard/Cancel modal.
  const [settingsDirty, setSettingsDirty] = useState(false)
  const [pendingNav, setPendingNav] = useState<Page | null>(null)
  // Stable wrapper that all existing setPage() callsites already use. When
  // we're on settings AND dirty, redirect the navigation request to
  // pendingNav so SettingsPage can prompt before actually changing pages.
  // Otherwise behaves identically to the raw setter.
  const setPage = useCallback((target: Page) => {
    if (target === page) return
    if (page === 'settings' && settingsDirty) {
      setPendingNav(target)
      return
    }
    setPageRaw(target)
  }, [page, settingsDirty])
  // Mirror the dirty state to main: the window-close guard (X / tray Quit /
  // Alt+F4) lives there and would otherwise discard the draft silently.
  useEffect(() => { window.api.setSettingsDirty(settingsDirty) }, [settingsDirty])
  const [aboutOpen, setAboutOpen] = useState(false)
  // Two independent "not the release" signals badge the sidebar version:
  // - branchBadge (purple, GitBranch icon): the git BRANCH the code came
  //   from — .git/HEAD in dev runs, the dev-branch.txt marker in packaged
  //   _DEV builds. Null on master and in release builds.
  // - isDevServer (amber): the ENVIRONMENT — true only when running
  //   unpackaged on the electron-vite dev server (npm run dev), regardless
  //   of branch. import.meta.env.DEV is false in any packaged build, so a
  //   _DEV exe shows only the branch chip.
  const [gitBranch, setGitBranch] = useState<string | null>(null)
  useEffect(() => {
    window.api.getGitBranch?.().then(b => setGitBranch(b)).catch(() => {})
  }, [])
  const branchBadge = gitBranch && gitBranch !== 'master' ? gitBranch : null
  const isDevServer = import.meta.env.DEV
  // A second dev launch was blocked by the single-instance lock — main
  // focused THIS (already-running) window; explain why nothing new opened.
  const [secondInstanceOpen, setSecondInstanceOpen] = useState(false)
  useEffect(() => {
    return window.api.onSecondInstanceBlocked?.(() => setSecondInstanceOpen(true))
  }, [])
  // Tray-initiated launch group failures — main focuses the window; this
  // modal is the in-app surface for what didn't open.
  const [trayLaunchError, setTrayLaunchError] = useState<{ groupName: string; launched: number; failed: { id: string; name: string; error: string }[] } | null>(null)
  useEffect(() => {
    return window.api.onGroupLaunchFailed?.(result => setTrayLaunchError(result))
  }, [])
  // Update detection: fires on mount, then re-checks every 6 hours for as
  // long as the app stays up. SM is a tray app that can run for days, and
  // a launch-only check meant a long-lived instance never learned about a
  // release until restarted. The interval matches the store cache's 6h
  // TTL, so each re-check lands just as the cache expires and the extra
  // API traffic rounds to zero. Honors the `checkForUpdates` config
  // opt-out (in main). Failures are silent.
  const [updateInfo, setUpdateInfo] = useState<{ latest: string; releaseUrl: string; releaseNotes: string } | null>(null)
  useEffect(() => {
    let cancelled = false
    const check = () => {
      window.api.checkForUpdate().then(res => {
        if (cancelled) return
        if (res.hasUpdate && res.latest && res.releaseUrl) {
          setUpdateInfo({ latest: res.latest, releaseUrl: res.releaseUrl, releaseNotes: res.releaseNotes ?? '' })
        }
      }).catch(() => {})
    }
    check()
    const timer = setInterval(check, 6 * 60 * 60 * 1000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [])
  const [helpOpen, setHelpOpen] = useState(false)
  const [onboardingOpen, setOnboardingOpen] = useState(false)
  // Per-service integration state for the Integrations nav indicator (nav
  // redesign Pass C sub-item m). setUp = the user connected it; healthy =
  // it currently works (token valid / key accepted). Not-set-up services
  // show nothing at all — resting quiet beats a gray dot.
  const [integrationStatus, setIntegrationStatus] = useState<Record<'youtube' | 'twitch' | 'claude', { setUp: boolean; healthy: boolean }>>({
    youtube: { setUp: false, healthy: true },
    twitch: { setUp: false, healthy: true },
    claude: { setUp: false, healthy: true },
  })
  // Persist collapse state across app restarts. localStorage is the right
  // store for UI-only prefs (matches the streams page's viewMode pattern).
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('sidebarCollapsed') === 'true')
  useEffect(() => { localStorage.setItem('sidebarCollapsed', String(sidebarCollapsed)) }, [sidebarCollapsed])
  const [quitConfirm, setQuitConfirm] = useState<{ running: number; queued: number; fileOps: number; settingsDirty: boolean } | null>(null)
  // Ctrl+L in-flight latch — OS key-repeat and double-presses must not stack
  // launchGroup calls (each repeat opened another browser tab per URL item).
  const launchHotkeyBusyRef = useRef(false)
  const { config, loading, updateConfig, refreshConfig } = useStore()
  const { refreshRules } = useWatcher()
  const { _setNavigate } = useThumbnailEditor()
  // Per-page "has activity" signals, used to drive the nav rail's
  // brightness shift + right-edge accent. Converter reads directly
  // from the existing job context; player + thumbnails publish into
  // PageActivityContext since their working state is local to those
  // pages.
  const { playerHasVideo, thumbnailHasCanvas, combineHasFiles, navSubtext } = usePageActivity()
  const { jobs: conversionJobs } = useConversionJobs()
  const converterHasJobs = conversionJobs.some(j => j.status !== 'cancelled' && j.status !== 'done')
  // Honor the user's disable / slow-animation prefs for the nav-rail
  // width transition. Without this the nav was always at 200ms even
  // when the rest of the app was respecting the 5x slow-down.
  const anim = useAnimationConfig()
  const navTransitionDurationMs = anim.duration(200)
  // Collapse/expand choreography for the rail's per-item widgets (nav
  // redesign): on COLLAPSE the expanded variants stay mounted and clip
  // against the moving edge, and the collapsed variants (which exist at
  // zero height throughout the width transition) slide open
  // jQuery-slideDown style once the width lands. On EXPAND the collapsed
  // variants disappear IMMEDIATELY (no exit animation — a slide-up here
  // read as the content wandering while the rail widened) and the
  // expanded ones are re-revealed by the moving edge.
  //   railCollapsed — "steady collapsed state reached" (lags the toggle
  //                    on collapse, resets instantly on expand)
  const [railCollapsed, setRailCollapsed] = useState(() => localStorage.getItem('sidebarCollapsed') === 'true')
  useEffect(() => {
    if (!sidebarCollapsed) { setRailCollapsed(false); return }
    const t = setTimeout(() => setRailCollapsed(true), navTransitionDurationMs)
    return () => clearTimeout(t)
  }, [sidebarCollapsed, navTransitionDurationMs])
  // The width class lags the toggle by two frames on EXPAND: the
  // collapsed variants unmount in the toggle's commit, and starting the
  // width transition in that same frame made it hitch (transition start
  // competing with the unmount reflow/paint). Two rAFs let the settled
  // narrow layout paint first; then the widening runs smooth. Collapse
  // keeps the width change immediate.
  const [widthCollapsed, setWidthCollapsed] = useState(() => localStorage.getItem('sidebarCollapsed') === 'true')
  useEffect(() => {
    if (sidebarCollapsed) { setWidthCollapsed(true); return }
    let raf2 = 0
    const raf1 = requestAnimationFrame(() => { raf2 = requestAnimationFrame(() => setWidthCollapsed(false)) })
    return () => { cancelAnimationFrame(raf1); cancelAnimationFrame(raf2) }
  }, [sidebarCollapsed])
  const pageActivity: Partial<Record<Page, boolean>> = {
    // Streams derives from its subtext: both mean "a stream is open in
    // the detail sidebar" (the subtext falls back to the date, so it's
    // never empty while one is selected), and deriving keeps the accent
    // and the subtitle from ever disagreeing.
    streams: !!navSubtext['streams'],
    player: playerHasVideo,
    converter: converterHasJobs,
    thumbnails: thumbnailHasCanvas,
    combine: combineHasFiles,
  }
  // Component-shaped second lines for items whose context isn't plain
  // text (text sublines ride navSubtext instead). Rendered inside the
  // label stack; each self-nulls when there's nothing to show.
  const navSublines: Partial<Record<Page, React.ReactNode>> = {
    rules: <AutoRulesSubline />,
    integrations: <IntegrationsSubline status={integrationStatus} />,
  }
  // Collapsed-rail aggregate for the Integrations indicator: one green
  // dot while every SET-UP service is healthy, a warning triangle when
  // any is broken, nothing when none are connected.
  const integrationsSetUp = Object.values(integrationStatus).some(s => s.setUp)
  const integrationsUnhealthy = Object.values(integrationStatus).some(s => s.setUp && !s.healthy)
  // Tracks whether we've already routed to the user's chosen startup
  // page after first config load. A ref instead of state so toggling
  // it doesn't re-render; we only need it to fire once.
  const startupPageAppliedRef = useRef(false)

  // YouTube + Twitch legs of the integration indicator. On transport
  // failure each leg keeps its previous state rather than flipping to
  // "broken" — a dropped connection isn't a broken integration.
  const checkIntegrationStatus = () => {
    window.api.youtubeGetStatus?.().then(async (s: { connected: boolean }) => {
      if (!s.connected) {
        setIntegrationStatus(prev => ({ ...prev, youtube: { setUp: false, healthy: true } }))
        return
      }
      const v = await window.api.youtubeValidateToken().catch(() => null)
      setIntegrationStatus(prev => ({
        ...prev,
        youtube: { setUp: true, healthy: v ? !!v.valid : prev.youtube.healthy },
      }))
    }).catch(() => {})
    window.api.twitchGetStatus?.().then((s: { connected: boolean }) => {
      setIntegrationStatus(prev => ({ ...prev, twitch: { setUp: s.connected, healthy: true } }))
    }).catch(() => {})
  }

  useEffect(() => {
    checkIntegrationStatus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (page === 'integrations') checkIntegrationStatus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page])

  // Re-validate the moment a connect OR disconnect lands — the indicator
  // on the Integrations nav item used to lag both ways (lingering after a
  // reconnect, absent after a disconnect) until the user happened to
  // revisit the page.
  useEffect(() => {
    const offs = [
      window.api.onYouTubeConnected(() => checkIntegrationStatus()),
      window.api.onYouTubeDisconnected(() => checkIntegrationStatus()),
      window.api.onTwitchConnected(() => checkIntegrationStatus()),
      window.api.onTwitchDisconnected(() => checkIntegrationStatus()),
    ]
    return () => offs.forEach(off => off())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Claude leg — keyed on the stored key. A cheap models-list call
  // doubles as validation; its catch keeps the previous verdict (network
  // trouble is not a broken key).
  useEffect(() => {
    const key = (config.claudeApiKey ?? '').trim()
    if (!key) {
      setIntegrationStatus(prev => ({ ...prev, claude: { setUp: false, healthy: true } }))
      return
    }
    let cancelled = false
    window.api.claudeListModels(key)
      .then(r => {
        if (cancelled) return
        setIntegrationStatus(prev => ({ ...prev, claude: { setUp: true, healthy: !!r.ok } }))
      })
      .catch(() => {
        if (cancelled) return
        setIntegrationStatus(prev => ({ ...prev, claude: { setUp: true, healthy: prev.claude.healthy } }))
      })
    return () => { cancelled = true }
  }, [config.claudeApiKey])

  useEffect(() => {
    return window.api.onConfirmQuit(({ running, queued, fileOps, settingsDirty: dirtyDraft }) => {
      setQuitConfirm({ running, queued, fileOps: fileOps ?? 0, settingsDirty: !!dirtyDraft })
    })
  }, [])

  useEffect(() => {
    if (loading) return
    if (!config.streamsDir) setOnboardingOpen(true)
    // Apply the user's chosen startup page once, on first load. Skip
    // the navigation if they've already interacted (ref blocks
    // re-fires on subsequent config refreshes). Setting via setPage
    // routes through the dirty-settings guard, which is the right
    // behavior — the guard is a no-op at app launch since the user
    // hasn't been in Settings yet.
    if (!startupPageAppliedRef.current) {
      startupPageAppliedRef.current = true
      // `|| 'streams'` covers both blank configs (existing users
      // upgrading without the field) and brand-new installs (where
      // the default config already has 'streams'). The NAV_ITEMS
      // membership check guards against hand-edited config values
      // pointing at non-nav pages like 'rules' / 'templates'.
      const target = (config.startupPage || 'streams') as Page
      if (target !== page && NAV_ITEMS.some(i => i.id === target)) {
        setPage(target)
      }
    }
    const splash = document.getElementById('splash')
    if (splash) {
      splash.classList.add('fade-out')
      setTimeout(() => splash.remove(), 400)
    }
  }, [loading])
  const [isMaximized, setIsMaximized] = useState(false)
  useEffect(() => {
    window.api.windowIsMaximized().then(setIsMaximized)
    return window.api.onMaximizeChange(setIsMaximized)
  }, [])

  // App-wide Ctrl/Cmd+Shift+Z → redo for native editable fields. Chromium
  // only binds Ctrl+Y to redo in text inputs on Windows, so we route the
  // PS/Affinity-style shortcut to the native redo command when an editable
  // is focused. Gated on editable focus so page-level handlers (e.g. the
  // thumbnail editor's own undo stack on the canvas) keep their own
  // Ctrl+Shift+Z; preventDefault avoids a double-redo on platforms that do
  // bind it natively (e.g. macOS).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || !e.shiftKey || e.key.toLowerCase() !== 'z') return
      const el = document.activeElement as HTMLElement | null
      const editable = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
      if (!editable) return
      e.preventDefault()
      window.api.editRedo()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // ── Global keyboard shortcuts ──────────────────────────────────────────────
  // Work from any page. Suppressed while a modal is open. Modifier-based
  // shortcuts fire even with a field focused (they don't type a character and
  // edits autosave); `?` (help) stands down while the user is typing.
  useEffect(() => {
    // Ctrl+1…7 targets, in the nav's VISUAL order (Create, then
    // Utilities, then Session) — keep in sync with NAV_SHORTCUTS above.
    const PAGE_NAV: Page[] = ['streams', 'player', 'thumbnails', 'converter', 'combine', 'rules', 'launcher']
    const onKey = (e: KeyboardEvent) => {
      if (isAnyModalOpen()) return
      const mod = e.ctrlKey || e.metaKey
      // ? → open Help (a typed character, so only when not editing)
      if (!mod && e.key === '?' && !isTypingTarget(e.target)) {
        e.preventDefault()
        setHelpOpen(true)
        if (!config.hasOpenedHelp) updateConfig({ hasOpenedHelp: true })
        return
      }
      if (!mod) return
      // Ctrl+, → Settings
      if (e.key === ',') { e.preventDefault(); setPage('settings'); return }
      // Ctrl+L → launch the widget's default launch group. Repeat-guarded:
      // holding the key fires keydown per OS repeat, and each un-guarded
      // call re-launched the whole group (one browser tab per URL item).
      if (!e.shiftKey && e.key.toLowerCase() === 'l') {
        if (config.launcherWidgetGroupId) {
          e.preventDefault()
          if (e.repeat || launchHotkeyBusyRef.current) return
          launchHotkeyBusyRef.current = true
          window.api.launchGroup(config.launcherWidgetGroupId)
            .catch(() => {})
            .finally(() => { launchHotkeyBusyRef.current = false })
        }
        return
      }
      // Ctrl+1…7 → jump directly to a page
      if (!e.shiftKey && e.key >= '1' && e.key <= '7') {
        e.preventDefault()
        setPage(PAGE_NAV[Number(e.key) - 1])
        return
      }
      // Ctrl+PageUp / PageDown → cycle through the pages
      if (e.key === 'PageUp' || e.key === 'PageDown') {
        e.preventDefault()
        const delta = e.key === 'PageDown' ? 1 : -1
        const idx = PAGE_NAV.indexOf(page)
        const base = idx === -1 ? (delta === 1 ? -1 : 0) : idx
        setPage(PAGE_NAV[(base + delta + PAGE_NAV.length) % PAGE_NAV.length])
        return
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [page, config.hasOpenedHelp, config.launcherWidgetGroupId, setPage, updateConfig])

  const [pendingPlayer, setPendingPlayer] = useState<PendingFile | null>(null)
  const [pendingConverter, setPendingConverter] = useState<PendingConverterFile | null>(null)
  const [pendingCombine, setPendingCombine] = useState<PendingFiles | null>(null)
  // Bumped (token++) when something wants the streams page to select/open a
  // specific folder's detail sidebar — e.g. the converter's "from stream"
  // link (folderPath) or the auto-push failure modal (streamKey, which is
  // exact in both stream modes; a bare folderPath is ambiguous in dump mode).
  const [pendingStreamSelect, setPendingStreamSelect] = useState<{ folderPath?: string; streamKey?: string; token: number } | null>(null)
  // Post-stream Twitch auto-update failure awaiting acknowledgement — the
  // push runs unattended, so its category miss needs an app-level modal the
  // user can't miss regardless of the page they're on. (Banners can't do
  // it: they render only inside the affected stream's open sidebar and are
  // cleared on selection, so the unattended path was effectively silent.)
  const [autoPushError, setAutoPushError] = useState<{ streamKey: string; title: string; game: string } | null>(null)

  const sendToPlayer = (filePath: string) => {
    setPendingPlayer(prev => ({ path: filePath, token: (prev?.token ?? 0) + 1 }))
    setPage('player')
  }
  const sendToConverter = (filePaths: string[], stream?: { folderPath: string; label: string }) => {
    setPendingConverter(prev => ({ paths: filePaths, token: (prev?.token ?? 0) + 1, stream }))
    setPage('converter')
  }
  const navigateToStream = (folderPath: string) => {
    setPendingStreamSelect(prev => ({ folderPath, token: (prev?.token ?? 0) + 1 }))
    setPage('streams')
  }
  const navigateToStreamByKey = (streamKey: string) => {
    setPendingStreamSelect(prev => ({ streamKey, token: (prev?.token ?? 0) + 1 }))
    setPage('streams')
  }

  const sendToCombine = (filePaths: string[], stream?: { folderPath: string; label: string; date?: string }) => {
    setPendingCombine(prev => ({ paths: filePaths, token: (prev?.token ?? 0) + 1, stream }))
    setPage('combine')
  }

  // Wire up thumbnail navigation
  useEffect(() => {
    _setNavigate((_stream: PendingThumbnailStream | null) => {
      setPage('thumbnails')
    })
  }, [_setNavigate])

  return (
    <div className="flex flex-col h-screen bg-navy-900 text-gray-200 overflow-hidden">
      {/* Custom title bar. Asymmetric horizontal padding so the right
          edge of the close button sits ~6px from the window's right
          edge, matching the ~5–7px the buttons sit from the window's
          top edge (top gap is set by `items-center` against `h-10`
          minus the button's own height — `p-1.5` padding + 14–18px
          icon ≈ 26–30px, centered in 40px). Left side keeps `pl-4`
          so the logo + app name have room to breathe. */}
      <div
        className="flex items-center justify-between h-10 bg-navy-800 border-b border-white/5 pl-4 pr-1.5 shrink-0"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <div className="flex items-center gap-2">
          <img src={logoUrl} alt="" className="w-5 h-5 shrink-0" />
          <span className="text-sm font-semibold text-purple-400 tracking-wide">Stream Manager</span>
        </div>
        <div
          className="flex items-center gap-1"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <Tooltip content="Minimize to tray" side="bottom">
            <button
              onClick={() => window.api.windowMinimizeToTray()}
              className="p-1.5 rounded hover:bg-white/10 text-gray-400 hover:text-gray-300 transition-colors"
            >
              <ArrowDownToDot size={14} />
            </button>
          </Tooltip>
          <button
            onClick={() => window.api.windowMinimize()}
            className="p-1.5 rounded hover:bg-white/10 text-gray-400 hover:text-gray-300 transition-colors"
          >
            <Minus size={14} />
          </button>
          <button
            onClick={() => window.api.windowMaximize()}
            className="p-1.5 rounded hover:bg-white/10 text-gray-400 hover:text-gray-300 transition-colors"
          >
            {isMaximized ? <Minimize2 size={14} /> : <Square size={14} />}
          </button>
          <button
            onClick={() => window.api.windowClose()}
            className="p-1.5 rounded hover:bg-red-600 text-gray-400 hover:text-white transition-colors"
          >
            {/* Lucide's X has more whitespace around its strokes than Square's
                box outline, so it visually reads ~1–2px smaller at the same
                size value. Bump it to keep the row optically balanced. */}
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <nav
          // Inline `transitionDuration` overrides the static Tailwind
          // `duration-200` so the nav participates in the slow-animation
          // setting (and snaps instantly when animations are disabled).
          style={{ transitionDuration: `${navTransitionDurationMs}ms` }}
          // w-52 (208px): the nav-redesign width bump — the todo asked for
          // "200px or the next default size"; 52 is the next Tailwind step
          // up from the old w-48 (192px) that clears 200.
          className={`relative ${widthCollapsed ? 'w-12' : 'w-52'} bg-navy-800 flex flex-col shrink-0 transition-[width] overflow-hidden`}
        >
          {/* Right edge — collapse/expand handle */}
          <Tooltip content={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} side="right" triggerClassName="group/edge absolute right-0 inset-y-0 w-2 z-20">
            <button
              onClick={() => setSidebarCollapsed(c => !c)}
              className="absolute inset-0 cursor-col-resize"
              aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            />
            <div className="pointer-events-none absolute inset-y-0 right-0 w-px bg-white/5 group-hover/edge:w-0.5 group-hover/edge:bg-purple-500 transition-all duration-150" />
          </Tooltip>

          {(() => {
            const renderNavItem = (item: NavItem) => {
              const isSelected = page === item.id
              const hasActivity = !!pageActivity[item.id]
              // Settings + integrations are excluded from the startup-
              // page selector: they're settings pages, not workflow
              // surfaces (the System nav group, pinned to the bottom of
              // the flexible zone by the spacer below).
              const isStartupCandidate = item.id !== 'integrations' && item.id !== 'settings'
              // Fall back to 'streams' when the user hasn't set a
              // startup page yet — covers both brand-new installs
              // (where getDefaultConfig sets the value) AND existing
              // users upgrading from a version without the field
              // (where config.startupPage comes back undefined). Either
              // way the star renders on Streams by default and the
              // launch routes there.
              const effectiveStartupPage = config.startupPage || 'streams'
              const isStartupPage = isStartupCandidate && effectiveStartupPage === item.id
              // Hybrid items render their live-info block inside the nav
              // button (self-nulls while quiet — see NavItem.extra) and/or
              // an action control with its own surface (NavItem.rowAction).
              const Extra = item.extra
              const RowAction = item.rowAction

              // The main nav button, defined separately so collapsed mode
              // can wrap JUST it in the label tooltip while the row
              // wrapper below (the group/nav hover scope) also contains
              // the star and any row action — the whole item hovers as
              // one surface in both modes, with zone-specific tooltips.
              const navButton = (
                  <button
                    onClick={() => setPage(item.id)}
                    // Single interactive surface for the whole item: the
                    // icon+label line and (for hybrid items) the live
                    // info block below it share ONE button — one hover
                    // highlight, one click target, one focus stop. The
                    // inner line div carries the old `h-10` height lock
                    // (so collapse/expand doesn't bounce the row height)
                    // and the constant `gap-3 px-3.5` flex layout so the
                    // icon's x position never jumps; labels and
                    // right-side adornments clip at the nav's outer
                    // `overflow-hidden` as the width shrinks.
                    // Selected + steady-collapsed with a control block
                    // below: the bottom border goes transparent so it
                    // doesn't draw a hairline through the item. Keyed on
                    // railCollapsed, not the raw toggle — during the
                    // collapse transition nothing is below yet, and
                    // dropping the border early left the box visibly
                    // open along its bottom edge.
                    className={`
                      relative w-full flex flex-col text-sm font-medium transition-all duration-150 border
                      ${isSelected
                        ? `bg-purple-600/20 text-purple-300 border-purple-600/30${railCollapsed && RowAction ? ' border-b-transparent' : ''}`
                        : hasActivity
                          ? 'text-gray-100 group-hover/nav:text-white group-hover/nav:bg-white/5 border-transparent'
                          : 'text-gray-400 group-hover/nav:text-gray-200 group-hover/nav:bg-white/5 border-transparent'
                      }
                    `}
                  >
                    <div className="w-full flex items-center gap-3 px-3.5 h-10">
                    {/* `shrink-0` on the icon wrapper prevents the SVG
                        from being compressed by the flex algorithm when
                        the parent button narrows below its content's
                        intrinsic size — without it, the icon visibly
                        shrinks at the end of the collapse animation. */}
                    <span className="shrink-0 inline-flex">{item.icon}</span>
                    {/* Label always rendered. `flex-1` claims remaining
                        space when there's room; `min-w-0` lets the flex
                        item shrink below its text's intrinsic width so
                        the label collapses to 0 as the nav narrows;
                        `whitespace-nowrap` keeps the text on a single
                        line so it slides out the right edge instead of
                        wrapping; `overflow-hidden` clips the text at
                        the label's diminishing width for a clean crop.
                        With a published subtext (nav redesign Pass C:
                        the open stream / pinned launch group) the label
                        becomes a tight two-line stack that still fits
                        the h-10 line, so the icon, star, and row-action
                        anchors all stay put. */}
                    <span className="flex-1 min-w-0 text-left whitespace-nowrap overflow-hidden">
                      <span className="block truncate leading-tight">{item.label}</span>
                      <NavSubtextReveal text={navSubtext[item.id]} durationMs={navTransitionDurationMs} />
                      {navSublines[item.id]}
                    </span>
                    </div>
                    {/* Hybrid items: live info inside the same button —
                        self-nulls while the tool is quiet (NavItem.extra).
                        Variant choice follows railCollapsed, not the raw
                        toggle: during a collapse the expanded block stays
                        (pinned at the expanded width so the moving edge
                        CLIPS it instead of squeezing it), and the
                        collapsed block slides open only once the width
                        lands / slides shut the moment an expand starts. */}
                    {Extra && !railCollapsed && (
                      <div className="w-52">
                        <Extra collapsed={false} />
                      </div>
                    )}
                    {Extra && sidebarCollapsed && (
                      <SlideOpen open={railCollapsed} durationMs={navTransitionDurationMs}>
                        <Extra collapsed />
                      </SlideOpen>
                    )}
                    {railCollapsed && item.id === 'integrations' && integrationsSetUp && (
                      integrationsUnhealthy
                        ? <AlertTriangle size={10} className="absolute top-1 right-1.5 text-amber-400" />
                        : <span className="absolute top-1.5 right-2 w-1.5 h-1.5 rounded-full bg-green-400" />
                    )}
                    {/* Right-edge activity accent — muted purple bar
                        inside the button's right edge. Shown for any
                        page that currently has work open, including
                        the currently-selected one (the user asked for
                        a consistent indicator regardless of selection
                        state). Sits below any alert dot via the inset
                        top/bottom. Always mounted, fading in/out on the
                        activity signal (no motion — just opacity). */}
                    <span
                      className={`pointer-events-none absolute right-0 top-2 bottom-2 w-[2px] rounded-full bg-purple-400/50 transition-opacity ease-out ${hasActivity ? 'opacity-100' : 'opacity-0'}`}
                      style={{ transitionDuration: `${navTransitionDurationMs}ms` }}
                    />
                  </button>
              )

              const row = (
                // `group/nav` scopes the hover state to this row. The
                // outer wrapper is a div (not a button) so the star and
                // row action can be real sibling buttons — nesting
                // buttons is invalid HTML.
                <div className="relative group/nav">
                  {sidebarCollapsed ? (
                    <Tooltip content={item.label} side="right" triggerClassName="block w-full" shortcut={NAV_SHORTCUTS[item.id]}>
                      {navButton}
                    </Tooltip>
                  ) : (
                    navButton
                  )}
                  {/* Startup-page star — hidden in collapsed sidebar
                      mode. Rendered in BOTH modes (just CSS-hidden
                      when collapsed) so collapse/expand doesn't have
                      to mount/unmount 6 Tooltip+button trees per
                      toggle — that was the largest mid-transition
                      main-thread cost and made the width animation
                      hitch. Hover-revealed for non-startup items,
                      persistently yellow + filled for the chosen
                      startup page. Mirrors the launcher's widget-pin
                      star pattern. The absolute positioning lives on
                      the Tooltip's trigger wrapper (via
                      triggerClassName) — the default inline-flex
                      wrapper would otherwise sit in the row's normal
                      flow, eating layout space below the nav button
                      and pulling the star off vertical center. */}
                  {isStartupCandidate && (
                    <Tooltip
                      content={isStartupPage ? 'Startup page' : 'Set as startup page'}
                      side="right"
                      // `top-5` (20px = the icon line's h-10 center), not
                      // top-1/2: a hybrid item's expanded info makes the
                      // wrapper taller, and the star must stay centered
                      // on the icon+label LINE, not the whole item.
                      triggerClassName={`absolute right-2 top-5 -translate-y-1/2 ${sidebarCollapsed ? 'hidden' : ''}`}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          if (!isStartupPage) updateConfig({ startupPage: item.id })
                        }}
                        // Hidden by default in BOTH states — even the
                        // chosen startup page's filled star only
                        // appears on row hover. Trades the launcher's
                        // "always show the pin" pattern for a cleaner
                        // resting state; the user can still discover
                        // their startup pick by hovering.
                        className={`shrink-0 p-1 transition-colors opacity-0 group-hover/nav:opacity-100 ${
                          isStartupPage
                            ? 'text-yellow-400'
                            : 'text-gray-400 hover:text-gray-200'
                        }`}
                        aria-label={isStartupPage ? 'Startup page' : 'Set as startup page'}
                      >
                        <Star size={12} className={isStartupPage ? 'fill-yellow-400' : ''} />
                      </button>
                    </Tooltip>
                  )}
                  {/* Row action (e.g. Launcher's quick-launch) — always
                      visible at the row's right, vertically centered on
                      the icon+label line (top-5 = the line's h-10
                      center), sitting left of the startup star's
                      hover-reveal slot. A real sibling button: actions
                      never nest inside the nav button (invalid HTML), and
                      they deserve their own hover/focus surface.
                      The pointer-events-none layer pins the control at
                      the EXPANDED rail width, anchored left — a
                      right-anchored control would ride the moving edge
                      inward during a collapse; pinned, the edge clips it
                      in place (and reveals it in place on expand). */}
                  {RowAction && !railCollapsed && (
                    <div className="pointer-events-none absolute inset-y-0 left-0 w-52">
                      <div className="pointer-events-auto absolute right-8 top-5 -translate-y-1/2">
                        <RowAction collapsed={false} />
                      </div>
                    </div>
                  )}
                  {/* Collapsed: the action control renders as its own
                      block below the icon button — INSIDE the group/nav
                      wrapper so the whole column hovers as one item,
                      while keeping its own tooltip zone (the label
                      tooltip wraps only the icon button above). Slides
                      open after the collapse lands; on expand it
                      unmounts instantly (no exit slide). */}
                  {RowAction && sidebarCollapsed && (
                    <SlideOpen open={railCollapsed} durationMs={navTransitionDurationMs}>
                      <RowAction collapsed active={isSelected} onNavigate={() => setPage(item.id)} />
                    </SlideOpen>
                  )}
                </div>
              )

              return <React.Fragment key={item.id}>{row}</React.Fragment>
            }
            return (
              <div className="flex-1 min-h-0 flex flex-col">
                {NAV_GROUP_CREATE.map(renderNavItem)}
                {/* Create ↔ Utilities separator. */}
                <div className="my-1 mx-3 border-t border-white/10" />
                {NAV_GROUP_UTILITIES.map(renderNavItem)}
                {/* Utilities ↔ Session separator. */}
                <div className="my-1 mx-3 border-t border-white/10" />
                {NAV_GROUP_SESSION.map(renderNavItem)}
                {/* Flexible gap — floats the System group to the bottom
                    of the nav's item zone, directly above the widget
                    stack. The gap itself is the visual separation, so
                    no divider before Integrations. */}
                <div className="flex-1" />
                {NAV_GROUP_SYSTEM.map(renderNavItem)}
              </div>
            )
          })()}

          <div className="border-t border-white/5" />
          {/* Widget stack — the two permanent residents (per the redesign
              spec: these get their own pages one day, but stay widgets
              until there's enough content to justify it). Everything else
              has been absorbed into the hybrid nav items above. */}
          <CloudOpsWidget collapsed={sidebarCollapsed} />
          <StreamRelayWidget onNavigate={setPage} collapsed={sidebarCollapsed} />
          <div className={`py-1 flex justify-center w-full ${sidebarCollapsed ? 'flex-col items-center gap-0.5' : 'gap-2'}`}>
            <Tooltip content="Open help" side="top" shortcut="?">
              <button
                onClick={() => { setHelpOpen(true); if (!config.hasOpenedHelp) updateConfig({ hasOpenedHelp: true }) }}
                className={`text-[10px] transition-colors whitespace-nowrap rounded px-1 -mx-1 ${!loading && !config.hasOpenedHelp ? 'help-attention' : 'text-gray-400 hover:text-gray-300'}`}
              >
                {sidebarCollapsed ? 'Help' : 'How to use'}
              </button>
            </Tooltip>
            {!sidebarCollapsed && <span className="text-[10px] text-gray-400">·</span>}
            <Tooltip content={updateInfo ? `Update available: v${updateInfo.latest.replace(/^v/, '')} — click for details` : `Stream Manager v${appVersion}`} side="top">
              <button
                onClick={() => setAboutOpen(true)}
                className={`text-[10px] transition-colors flex items-center gap-1 ${sidebarCollapsed ? 'flex-col gap-0.5' : ''} ${updateInfo ? 'text-amber-400 hover:text-amber-300' : 'text-gray-400 hover:text-gray-300'}`}
              >
                {updateInfo && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" aria-label="update available" />}
                v{appVersion}
              </button>
            </Tooltip>
          </div>
          {/* Not-the-release chips get their own row: inline with the version
              they pushed the footer too wide to scan. Purple = git branch,
              amber = environment (see ~style_guide.md build/env naming). */}
          {(isDevServer || branchBadge) && (
            <div className={`pb-1 flex justify-center items-center w-full ${sidebarCollapsed ? 'flex-col gap-0.5' : 'gap-1'}`}>
              {isDevServer && (
                <Tooltip content="Running unpackaged on the electron-vite dev server" side="top">
                  <span className="px-1 rounded bg-amber-500/20 text-amber-300 text-[10px] font-semibold leading-tight">
                    server
                  </span>
                </Tooltip>
              )}
              {branchBadge && (
                <Tooltip content={`Built from the ${branchBadge} git branch`} side="top">
                  <span className="px-1 rounded bg-purple-500/20 text-purple-300 text-[10px] font-semibold leading-tight flex items-center gap-0.5">
                    <GitBranch size={9} className="shrink-0" />
                    {branchBadge}
                  </span>
                </Tooltip>
              )}
            </div>
          )}
        </nav>

        {/* Page content */}
        <main className="flex-1 overflow-hidden">
        <PageErrorBoundary>
          {/* Persistent pages — must live outside ErrorBoundary so key={page} doesn't remount them */}
          <div className={`h-full ${page === 'player' ? '' : 'hidden'}`}>
            <PlayerPage isVisible={page === 'player'} initialFile={pendingPlayer} onNavigateToConverter={() => setPage('converter')} />
          </div>
          <div className={`h-full ${page === 'converter' ? '' : 'hidden'}`}>
            <ConverterPage pending={pendingConverter} onNavigateToStream={navigateToStream} />
          </div>
          <div className={`h-full ${page === 'thumbnails' ? '' : 'hidden'}`}>
            <ThumbnailPage isVisible={page === 'thumbnails'} />
          </div>
          <div className={`h-full ${page === 'streams' ? '' : 'hidden'}`}>
            <StreamsPage isVisible={page === 'streams'} onSendToPlayer={sendToPlayer} onSendToConverter={sendToConverter} onSendToCombine={sendToCombine} pendingSelect={pendingStreamSelect} onAutoPushCategoryMiss={setAutoPushError} onOpenIntegrations={() => setPage('integrations')} />
          </div>
          {/* Combine is persistent too: switch-mounting it meant every
              navigation away unmounted the page, and the remount re-ran the
              initialFiles ingest — resurrecting removed files and resetting
              the sort order, output path, and delete-sources checkbox. */}
          <div className={`h-full ${page === 'combine' ? '' : 'hidden'}`}>
            <CombinePage initialFiles={pendingCombine} onNavigateToStream={navigateToStream} />
          </div>
          {page === 'templates' && <TemplatesPage />}
          {page === 'rules'     && <RulesPage />}
          {page === 'launcher'  && <LauncherPage />}
          {page === 'integrations'   && <IntegrationsPage />}
          {page === 'settings'  && (
            <SettingsPage
              onOpenOnboarding={() => setOnboardingOpen(true)}
              onDirtyChange={setSettingsDirty}
              onNavigate={setPage}
              pendingNav={pendingNav}
              onConfirmNav={(target) => { setPageRaw(target); setPendingNav(null); setSettingsDirty(false) }}
              onCancelNav={() => setPendingNav(null)}
            />
          )}
        </PageErrorBoundary>
        </main>
      </div>
      <OnboardingModal
        isOpen={onboardingOpen}
        initialStreamsDir={config.streamsDir}
        onComplete={() => { setOnboardingOpen(false); refreshConfig(); refreshRules() }}
      />
      {/* Unattended post-stream Twitch update failed to apply the category —
          attention-grabbing by design: it fires ~60s after a stream ends,
          when the user is rarely looking at the affected stream. */}
      {autoPushError && (
        <Modal
          isOpen
          onClose={() => setAutoPushError(null)}
          title="Twitch auto-update problem"
          width="md"
          footer={
            <>
              <Button variant="ghost" size="sm" onClick={() => setAutoPushError(null)}>
                Ignore
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  const key = autoPushError.streamKey
                  setAutoPushError(null)
                  navigateToStreamByKey(key)
                }}
              >
                Go to stream
              </Button>
            </>
          }
        >
          <p className="text-sm text-gray-300 leading-relaxed">
            The post-stream update pushed the title and tags for{' '}
            <span className="text-gray-100">{autoPushError.title}</span> to Twitch, but no Twitch category
            matches <span className="text-gray-100">"{autoPushError.game}"</span> — the channel's category was
            left unchanged. Open the stream and pick a category in its Twitch section (it searches real
            Twitch categories).
          </p>
        </Modal>
      )}

      {/* Tray-initiated launch group failures — main focuses the window and
          this modal reports what didn't open (no OS notifications, ever). */}
      {trayLaunchError && (
        <Modal
          isOpen
          onClose={() => setTrayLaunchError(null)}
          title="Launch group problem"
          width="md"
          footer={
            <Button variant="primary" size="sm" onClick={() => setTrayLaunchError(null)}>
              Close
            </Button>
          }
        >
          <div className="flex flex-col gap-3">
            <p className="text-sm text-gray-300 leading-relaxed">
              Launched {trayLaunchError.launched} of {trayLaunchError.launched + trayLaunchError.failed.length} from{' '}
              <span className="text-gray-100">"{trayLaunchError.groupName}"</span> — the rest failed:
            </p>
            <ul className="flex flex-col gap-1.5">
              {trayLaunchError.failed.map((f, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
                  <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                  <span className="min-w-0"><span className="font-medium">{f.name}</span> — {f.error}</span>
                </li>
              ))}
            </ul>
          </div>
        </Modal>
      )}

      <Modal
        isOpen={!!quitConfirm}
        onClose={() => setQuitConfirm(null)}
        title={!quitConfirm ? 'Conversions in progress'
          : quitConfirm.running > 0 ? 'Conversions in progress'
          : quitConfirm.fileOps > 0 ? 'File operations in progress'
          : 'Unsaved settings'}
        width="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setQuitConfirm(null)}>Cancel</Button>
            <Button variant="danger" onClick={() => { setQuitConfirm(null); window.api.proceedQuit() }}>
              Quit anyway
            </Button>
          </>
        }
      >
        {quitConfirm && (
          <div className="flex gap-3 py-1">
            <AlertTriangle size={20} className="text-yellow-400 shrink-0 mt-0.5" />
            <div className="flex flex-col gap-1.5 text-sm">
              {quitConfirm.running > 0 && (
                <p className="text-gray-200">
                  {quitConfirm.running} conversion{quitConfirm.running === 1 ? ' is' : 's are'} still running
                  {quitConfirm.queued > 0 ? ` (and ${quitConfirm.queued} queued)` : ''}.
                </p>
              )}
              {quitConfirm.fileOps > 0 && (
                <p className="text-gray-200">
                  {quitConfirm.fileOps} auto-rule file operation{quitConfirm.fileOps === 1 ? ' is' : 's are'} still
                  moving or copying files.
                </p>
              )}
              {quitConfirm.settingsDirty && (
                <p className="text-gray-200">
                  The Settings page has unsaved changes.
                </p>
              )}
              <p className="text-gray-400">
                {(quitConfirm.running > 0 || quitConfirm.fileOps > 0) &&
                  'Quitting now will cancel them and any progress will be lost. A partially-transferred file is cleaned up and its original stays in place. '}
                {quitConfirm.settingsDirty && 'Unsaved Settings changes will be discarded.'}
              </p>
            </div>
          </div>
        )}
      </Modal>

      <HelpModal isOpen={helpOpen} onClose={() => setHelpOpen(false)} />

      <Modal
        isOpen={secondInstanceOpen}
        onClose={() => setSecondInstanceOpen(false)}
        title="Stream Manager is already running"
        width="md"
        footer={
          <Button variant="primary" size="sm" onClick={() => setSecondInstanceOpen(false)}>
            Got it
          </Button>
        }
      >
        <p className="text-sm text-gray-300 leading-relaxed">
          You launched Stream Manager again, but this instance was already open — it may have
          been sitting in the system tray. If you meant to start a newer version (for example
          after switching branches or pulling changes), close this one first, then launch again.
        </p>
      </Modal>

      <CloudOpsModal />

      <PostStreamTwitchModal />

      <Modal isOpen={aboutOpen} onClose={() => setAboutOpen(false)} title="About Stream Manager" width="sm">
        <div className="flex flex-col items-center gap-4 py-2 text-center">
          <img src={logoUrl} alt="" className="w-12 h-12 opacity-90" />
          <div className="flex flex-col gap-1">
            <p className="text-sm text-gray-300 leading-relaxed">
              A desktop app for streamers to manage, review, and process local recording files.
            </p>
            <p className="text-xs text-gray-400 mt-1">Version {appVersion}{branchBadge ? ` — ${branchBadge} branch` : ''}{isDevServer ? ' — dev server' : ''}</p>
          </div>
          {updateInfo && (
            <div className="w-full flex flex-col gap-2 p-3 rounded-lg bg-amber-400/10 border border-amber-400/30">
              <p className="text-xs text-amber-200 font-medium">Update available — v{updateInfo.latest.replace(/^v/, '')}</p>
              <button
                onClick={() => window.api.openUrl(updateInfo.releaseUrl)}
                className="text-xs text-amber-300 hover:text-amber-200 underline self-center"
              >
                View release on GitHub
              </button>
            </div>
          )}
          <a
            href="https://github.com/pjmdesi/stream-manager"
            onClick={e => { e.preventDefault(); window.api.openUrl('https://github.com/pjmdesi/stream-manager') }}
            className="text-xs text-purple-400 hover:text-purple-300 transition-colors"
          >
            github.com/pjmdesi/stream-manager
          </a>
          <a
            href="https://buymeacoffee.com/pjm"
            onClick={e => { e.preventDefault(); window.api.openUrl('https://buymeacoffee.com/pjm') }}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-yellow-400/10 border border-yellow-400/30 hover:bg-yellow-400/20 transition-colors text-xs text-yellow-300 font-medium"
          >
            ☕ Buy me a coffee
          </a>
        </div>
      </Modal>
    </div>
  )
}

export default function App() {
  // Double-click ANYWHERE in a text field selects its content — but only
  // when the browser's own word-selection came up empty. Chromium selects
  // the word under the pointer, so double-clicking the empty space beside
  // short text merely placed the caret (triple-click worked: line
  // selection ignores the pointer's x). Double-clicking ON a word keeps
  // the normal word-selection. One document-level listener covers every
  // input/textarea in the app, portaled modals included.
  useEffect(() => {
    const onDblClick = (e: MouseEvent) => {
      const t = e.target
      if (!(t instanceof HTMLInputElement) && !(t instanceof HTMLTextAreaElement)) return
      // Text-editable inputs only — not checkboxes, color wells, range, file.
      if (t instanceof HTMLInputElement && !['text', 'search', 'url', 'tel', 'password', 'email', 'number'].includes(t.type)) return
      try {
        // number/email inputs report null selection bounds in Chromium —
        // that reads as collapsed, which is exactly right: select all.
        if (t.selectionStart === t.selectionEnd) t.select()
      } catch {
        // Some input types throw on selectionStart per spec; selecting all
        // is still the wanted outcome.
        t.select()
      }
    }
    document.addEventListener('dblclick', onDblClick)
    return () => document.removeEventListener('dblclick', onDblClick)
  }, [])
  return (
    <ThumbnailEditorProvider>
      <PageActivityProvider>
        <CloudOpsProvider>
          <RelayPromptProvider>
            <AppInner />
          </RelayPromptProvider>
        </CloudOpsProvider>
      </PageActivityProvider>
    </ThumbnailEditorProvider>
  )
}
