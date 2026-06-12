import React, { useState, useEffect, useCallback, useRef, Component } from 'react'
import * as LucideIcons from 'lucide-react'
import { version as appVersion } from '../../../package.json'
import { Film, Shuffle, Zap, Settings, Minus, Square, Minimize2, X, Radio, Combine, Plug, Play, AlertTriangle, ArrowDownToDot, AlertCircle, RefreshCw, Pause, Rocket, Image as ImageIcon, Cloud, Star } from 'lucide-react'
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
}

interface PendingConverterFile {
  path: string
  token: number
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

function ConversionWidget({ onNavigate, collapsed }: { onNavigate: () => void; collapsed: boolean }) {
  const { jobs, jobEtas } = useConversionJobs()

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
  if (active.length === 0) return null

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

  if (collapsed) {
    return (
      <Tooltip content={`Converting · ${label}${allDownloading ? '' : ` · ${totalProgress.toFixed(0)}%`}${etaText ? ` · ${etaText}` : ''}`} side="right" triggerClassName="block w-full">
        <button
          onClick={onNavigate}
          // Two-container layout: primary Zap icon left-aligned at
          // x=16 (matches nav icon column above), secondary indicators
          // (percent, status spinner) centered below. Same convention
          // as the AutoRulesWidget — primary icons follow the nav's
          // left column, decorative status content stays centered.
          className="w-full py-2.5 bg-navy-900 border-y border-white/5 hover:border-white/10 hover:bg-white/5 transition-colors"
        >
          <div className="flex items-center px-4 mb-0.5">
            <Zap size={14} className={statusColor} />
          </div>
          <div className="flex flex-col items-center gap-0.5">
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
        </button>
      </Tooltip>
    )
  }

  return (
    <button
      onClick={onNavigate}
      className="w-full p-3 bg-navy-900 border-y border-white/5 hover:border-white/10 hover:bg-white/5 transition-colors text-left whitespace-nowrap"
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Converting</span>
        <span className={`text-[10px] font-medium ${statusColor}`}>{label}</span>
      </div>
      <div className="h-1 w-full bg-white/10 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${barColor}`}
          style={{ width: `${totalProgress}%` }}
        />
      </div>
      <div className="mt-1.5 text-[10px] text-gray-400 tabular-nums flex items-center justify-between gap-2">
        <span>
          {allDownloading ? `${active.length} downloading` : `${totalProgress.toFixed(1)}% · ${active.length} job${active.length !== 1 ? 's' : ''}`}
        </span>
        {etaText && <span title={etaTitle}>{etaText}</span>}
      </div>
    </button>
  )
}

function AutoRulesWidget({ active, onNavigate, collapsed }: { active: boolean; onNavigate: () => void; collapsed: boolean }) {
  const { rules, running, startWatcher, stopWatcher } = useWatcher()
  const enabledCount = rules.filter(r => r.enabled).length

  // Main button row uses the exact nav-item pattern — same flex layout
  // in both modes, icon at x=16 from the left, label always rendered
  // and cropped by the parent nav's overflow-hidden as the sidebar
  // shrinks. The Tooltip's content swaps based on `collapsed` so it
  // doesn't fire in expanded mode where the label is already visible.
  const mainButton = (
    <button
      onClick={onNavigate}
      className={`relative flex items-center gap-3 w-full px-4 h-10 text-sm font-medium transition-colors ${active ? 'text-purple-300' : 'text-gray-400 hover:text-gray-200'}`}
    >
      <span className="shrink-0 inline-flex"><Shuffle size={18} /></span>
      <span className="flex-1 min-w-0 text-left whitespace-nowrap overflow-hidden">Auto-Rules</span>
    </button>
  )
  const mainButtonWrapped = collapsed
    ? <Tooltip content="Auto-Rules" side="right" triggerClassName="block w-full">{mainButton}</Tooltip>
    : mainButton

  return (
    <div className={`border-y transition-colors whitespace-nowrap ${active ? 'bg-purple-600/20 border-purple-600/30' : 'bg-navy-900 border-white/5'}`}>
      {mainButtonWrapped}
      {rules.length > 0 && (
        <>
          {/* Start/Stop button: centered in collapsed mode (the button
              is a control, not a "column" element — visually the
              square reads better in the middle of the 48px sidebar
              than left-aligned with the button's left edge butting
              against the sidebar edge). Full-width with text label
              when expanded. */}
          <div className={collapsed ? 'flex justify-center pb-1' : 'px-3 pb-1'}>
            {running ? (
              <Button variant="danger" size="sm" icon={<Square size={12} />} className={collapsed ? 'justify-center' : 'w-full whitespace-nowrap'} onClick={stopWatcher}>
                {collapsed ? null : 'Stop Watcher'}
              </Button>
            ) : (
              <Button variant="success" size="sm" icon={<Play size={12} />} className={collapsed ? 'justify-center' : 'w-full whitespace-nowrap'} onClick={startWatcher} disabled={enabledCount === 0}>
                {collapsed ? null : 'Start Watcher'}
              </Button>
            )}
          </div>
          {/* Status row: centered with separate dot/bullet/count
              elements when collapsed (small content reads better
              centered in the 48px rail and the count stays visible);
              left-aligned with prose "Running · N rules active" when
              expanded. */}
          {collapsed ? (
            <div className="flex items-center justify-center gap-1 pb-2">
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${running ? 'bg-green-400 animate-pulse' : 'bg-gray-600'}`} />
              <span className="text-[10px] text-gray-400">•</span>
              <span className="text-[10px] text-gray-400">{enabledCount}</span>
            </div>
          ) : (
            <div className="px-4 py-2 flex items-center gap-1.5">
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${running ? 'bg-green-400 animate-pulse' : 'bg-gray-600'}`} />
              <span className="text-[10px] text-gray-400">
                {running ? 'Running' : 'Stopped'} · {enabledCount} rule{enabledCount !== 1 ? 's' : ''} active
              </span>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function GroupIcon({ name, size = 16 }: { name?: string; size?: number }) {
  const pascal = (n: string) => n.split('-').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join('')
  const Icon = name
    ? (((LucideIcons as unknown) as Record<string, React.ComponentType<{ size?: number }>>)[pascal(name)] ?? Rocket)
    : Rocket
  return <Icon size={size} />
}

function LauncherWidget({ onNavigate, collapsed }: { onNavigate: () => void; collapsed: boolean }) {
  const { config } = useStore()
  const [groups, setGroups] = useState<LauncherGroup[]>([])
  const [launching, setLaunching] = useState(false)
  const [feedback, setFeedback] = useState<number | null>(null)

  useEffect(() => {
    window.api.getLauncherGroups().then(setGroups).catch(() => {})
  }, [config.launcherWidgetGroupId])

  const group = groups.find(g => g.id === config.launcherWidgetGroupId) ?? null
  if (!group) return null

  const launch = async () => {
    if (launching) return
    setLaunching(true)
    try {
      const result = await window.api.launchGroup(group.id)
      setFeedback(result.launched)
      setTimeout(() => setFeedback(null), 2000)
    } finally {
      setLaunching(false)
    }
  }

  const appCount = group.apps.length
  const appListContent = (
    <div className="flex flex-col gap-0.5">
      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">{group.name}</p>
      {group.apps.map(a => (
        <p key={a.id} className="text-xs text-gray-200">{a.name}</p>
      ))}
    </div>
  )

  // Main row uses the nav-item pattern — identical flex layout in both
  // modes, icon at x=16 from the left, label always rendered + cropped
  // by the nav's outer overflow-hidden as the sidebar shrinks. Click
  // target differs per mode: collapsed = quick-launch the group;
  // expanded = navigate to the Launcher page (the dedicated launch
  // button below handles the launch in that mode).
  const mainButton = (
    <button
      onClick={collapsed ? launch : onNavigate}
      className="flex items-center gap-3 w-full px-4 h-10 text-sm font-medium text-gray-400 hover:text-gray-200 transition-colors"
    >
      <span className="shrink-0 inline-flex"><GroupIcon name={group.icon} size={16} /></span>
      <span className="flex-1 min-w-0 text-left whitespace-nowrap overflow-hidden">{group.name}</span>
    </button>
  )
  const mainButtonWrapped = collapsed
    ? <Tooltip content={appListContent} side="right" triggerClassName="block w-full">{mainButton}</Tooltip>
    : mainButton

  return (
    <div className="bg-navy-900 border-y border-white/5 hover:border-white/10 transition-colors whitespace-nowrap">
      {mainButtonWrapped}
      {/* Launch button row only in expanded mode — there's no room
          for it at 48px wide, and the main row's onClick handles
          launch directly in collapsed mode. */}
      {!collapsed && (
        <div className="px-3 pb-2">
          <Tooltip content={appListContent} side="right" triggerClassName="block w-full">
            <Button
              variant="primary"
              size="sm"
              icon={<Rocket size={12} />}
              className="w-full whitespace-nowrap"
              disabled={launching || appCount === 0}
              onClick={launch}
            >
              {feedback != null ? `Launched ${feedback}` : `Launch ${appCount} app${appCount === 1 ? '' : 's'}`}
            </Button>
          </Tooltip>
        </div>
      )}
    </div>
  )
}

const NAV_ITEMS: { id: Page; label: string; icon: React.ReactNode }[] = [
  { id: 'streams',      label: 'Streams',      icon: <Radio size={18} /> },
  { id: 'player',       label: 'Player',       icon: <Film size={18} /> },
  { id: 'converter',    label: 'Converter',    icon: <Zap size={18} /> },
  { id: 'combine',      label: 'Combine',      icon: <Combine size={18} /> },
  { id: 'thumbnails',   label: 'Thumbnails',   icon: <ImageIcon size={18} /> },
  { id: 'launcher',     label: 'Launcher',     icon: <Rocket size={18} /> },
  { id: 'integrations', label: 'Integrations', icon: <Plug size={18} /> },
  { id: 'settings',     label: 'Settings',     icon: <Settings size={18} /> },
]

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
  const [aboutOpen, setAboutOpen] = useState(false)
  // Update detection — fires once on mount, results cached for 6h in the
  // store. Honors the `checkForUpdates` config opt-out. Failures are silent.
  const [updateInfo, setUpdateInfo] = useState<{ latest: string; releaseUrl: string; releaseNotes: string } | null>(null)
  useEffect(() => {
    let cancelled = false
    window.api.checkForUpdate().then(res => {
      if (cancelled) return
      if (res.hasUpdate && res.latest && res.releaseUrl) {
        setUpdateInfo({ latest: res.latest, releaseUrl: res.releaseUrl, releaseNotes: res.releaseNotes ?? '' })
      }
    }).catch(() => {})
    return () => { cancelled = true }
  }, [])
  const [helpOpen, setHelpOpen] = useState(false)
  const [onboardingOpen, setOnboardingOpen] = useState(false)
  const [integrationAlert, setIntegrationAlert] = useState(false)
  // Persist collapse state across app restarts. localStorage is the right
  // store for UI-only prefs (matches the streams page's viewMode pattern).
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('sidebarCollapsed') === 'true')
  useEffect(() => { localStorage.setItem('sidebarCollapsed', String(sidebarCollapsed)) }, [sidebarCollapsed])
  const [quitConfirm, setQuitConfirm] = useState<{ running: number; queued: number } | null>(null)
  const { config, loading, updateConfig, refreshConfig } = useStore()
  const { refreshRules } = useWatcher()
  const { _setNavigate } = useThumbnailEditor()
  // Per-page "has activity" signals, used to drive the nav rail's
  // brightness shift + right-edge accent. Converter reads directly
  // from the existing job context; player + thumbnails publish into
  // PageActivityContext since their working state is local to those
  // pages.
  const { playerHasVideo, thumbnailHasCanvas } = usePageActivity()
  const { jobs: conversionJobs } = useConversionJobs()
  const converterHasJobs = conversionJobs.some(j => j.status !== 'cancelled' && j.status !== 'done')
  // Honor the user's disable / slow-animation prefs for the nav-rail
  // width transition. Without this the nav was always at 200ms even
  // when the rest of the app was respecting the 5x slow-down.
  const anim = useAnimationConfig()
  const navTransitionDurationMs = anim.duration(200)
  const pageActivity: Partial<Record<Page, boolean>> = {
    player: playerHasVideo,
    converter: converterHasJobs,
    thumbnails: thumbnailHasCanvas,
  }
  // Tracks whether we've already routed to the user's chosen startup
  // page after first config load. A ref instead of state so toggling
  // it doesn't re-render; we only need it to fire once.
  const startupPageAppliedRef = useRef(false)

  const checkIntegrationAlert = () => {
    window.api.youtubeValidateToken?.().then(r => {
      setIntegrationAlert(!r.valid)
    }).catch(() => {})
  }

  useEffect(() => {
    checkIntegrationAlert()
  }, [])

  useEffect(() => {
    if (page === 'integrations') checkIntegrationAlert()
  }, [page])

  useEffect(() => {
    return window.api.onConfirmQuit(({ running, queued }) => {
      setQuitConfirm({ running, queued })
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

  const [pendingPlayer, setPendingPlayer] = useState<PendingFile | null>(null)
  const [pendingConverter, setPendingConverter] = useState<PendingConverterFile | null>(null)
  const [pendingCombine, setPendingCombine] = useState<PendingFiles | null>(null)

  const sendToPlayer = (filePath: string) => {
    setPendingPlayer(prev => ({ path: filePath, token: (prev?.token ?? 0) + 1 }))
    setPage('player')
  }
  const sendToConverter = (filePath: string) => {
    setPendingConverter(prev => ({ path: filePath, token: (prev?.token ?? 0) + 1 }))
    setPage('converter')
  }

  const sendToCombine = (filePaths: string[]) => {
    setPendingCombine(prev => ({ paths: filePaths, token: (prev?.token ?? 0) + 1 }))
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
      {/* Custom title bar */}
      <div
        className="flex items-center justify-between h-10 bg-navy-800 border-b border-white/5 px-4 shrink-0"
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
          className={`relative ${sidebarCollapsed ? 'w-12' : 'w-48'} bg-navy-800 flex flex-col shrink-0 transition-[width] overflow-hidden`}
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

          <div className="flex-1">
            {NAV_ITEMS.map(item => {
              const showAlert = item.id === 'integrations' && integrationAlert
              const isSelected = page === item.id
              const hasActivity = !!pageActivity[item.id]
              // Settings + integrations are excluded from the startup-
              // page selector: they're settings pages, not workflow
              // surfaces. The horizontal divider rendered below sits
              // between launcher (last functional page) and
              // integrations to make this grouping legible.
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

              const row = (
                // `group/nav` scopes the hover state to this row so the
                // star only appears for the row the cursor is over. The
                // outer wrapper is a div (not a button) so the star can
                // be a real sibling button — nesting buttons is invalid
                // HTML.
                <div className="relative group/nav">
                  <button
                    onClick={() => setPage(item.id)}
                    // `h-10` locks the button height (40px = the natural
                    // expanded height with `py-2.5` + text-sm content)
                    // so collapse/expand doesn't bounce the row height
                    // by the 2-3px difference between icon-only and
                    // icon+text content. `gap-3 px-4` stays constant in
                    // both modes — `justify-content` doesn't animate,
                    // and keeping a stable flex layout means the icon's
                    // x position never jumps. The label, star, and any
                    // alert at the right get clipped by the nav's
                    // outer `overflow-hidden` as the width shrinks.
                    className={`
                      relative w-full flex items-center gap-3 px-4 h-10 text-sm font-medium transition-all duration-150 border
                      ${isSelected
                        ? 'bg-purple-600/20 text-purple-300 border-purple-600/30'
                        : hasActivity
                          ? 'text-gray-100 hover:text-white hover:bg-white/5 border-transparent'
                          : 'text-gray-400 hover:text-gray-200 hover:bg-white/5 border-transparent'
                      }
                    `}
                  >
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
                        the label's diminishing width for a clean crop. */}
                    <span className="flex-1 min-w-0 text-left whitespace-nowrap overflow-hidden">{item.label}</span>
                    {!sidebarCollapsed && showAlert && <AlertTriangle size={13} className="text-amber-400 shrink-0" />}
                    {sidebarCollapsed && showAlert && (
                      <span className="absolute top-1.5 right-2 w-1.5 h-1.5 rounded-full bg-amber-400" />
                    )}
                    {/* Right-edge activity accent — muted purple bar
                        inside the button's right edge. Shown for any
                        page that currently has work open, including
                        the currently-selected one (the user asked for
                        a consistent indicator regardless of selection
                        state). Sits below any alert dot via the inset
                        top/bottom. */}
                    {hasActivity && (
                      <span className="pointer-events-none absolute right-0 top-2 bottom-2 w-[2px] rounded-full bg-purple-400/50" />
                    )}
                  </button>
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
                      triggerClassName={`absolute right-2 top-1/2 -translate-y-1/2 ${sidebarCollapsed ? 'hidden' : ''}`}
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
                </div>
              )

              return (
                <React.Fragment key={item.id}>
                  {/* Subtle divider between the functional pages
                      (above) and the settings pages — integrations,
                      settings — (below). Rendered BEFORE the
                      integrations item so the line sits visually
                      between launcher and integrations regardless of
                      future reordering inside each group. */}
                  {item.id === 'integrations' && (
                    <div className="my-1 mx-3 border-t border-white/10" />
                  )}
                  {sidebarCollapsed ? (
                    <Tooltip content={item.label} side="right" triggerClassName="block w-full">
                      {row}
                    </Tooltip>
                  ) : (
                    row
                  )}
                </React.Fragment>
              )
            })}
          </div>

          <div className="border-t border-white/5" />
          {page !== 'converter' && <ConversionWidget onNavigate={() => setPage('converter')} collapsed={sidebarCollapsed} />}
          <CloudOpsWidget collapsed={sidebarCollapsed} />
          <LauncherWidget onNavigate={() => setPage('launcher')} collapsed={sidebarCollapsed} />
          <StreamRelayWidget onNavigate={setPage} collapsed={sidebarCollapsed} />
          <AutoRulesWidget active={page === 'rules'} onNavigate={() => setPage('rules')} collapsed={sidebarCollapsed} />
          <div className={`py-1 flex justify-center w-full ${sidebarCollapsed ? 'flex-col items-center gap-0.5' : 'gap-2'}`}>
            <button
              onClick={() => setHelpOpen(true)}
              className="text-[10px] text-gray-400 hover:text-gray-300 transition-colors whitespace-nowrap"
            >
              {sidebarCollapsed ? 'Help' : 'How to use'}
            </button>
            {!sidebarCollapsed && <span className="text-[10px] text-gray-400">·</span>}
            <Tooltip content={updateInfo ? `Update available: v${updateInfo.latest.replace(/^v/, '')} — click for details` : `Stream Manager v${appVersion}`} side="top">
              <button
                onClick={() => setAboutOpen(true)}
                className={`text-[10px] transition-colors flex items-center gap-1 ${updateInfo ? 'text-amber-400 hover:text-amber-300' : 'text-gray-400 hover:text-gray-300'}`}
              >
                {updateInfo && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" aria-label="update available" />}
                v{appVersion}
              </button>
            </Tooltip>
          </div>
        </nav>

        {/* Page content */}
        <main className="flex-1 overflow-hidden">
        <PageErrorBoundary>
          {/* Persistent pages — must live outside ErrorBoundary so key={page} doesn't remount them */}
          <div className={`h-full ${page === 'player' ? '' : 'hidden'}`}>
            <PlayerPage initialFile={pendingPlayer} onNavigateToConverter={() => setPage('converter')} />
          </div>
          <div className={`h-full ${page === 'converter' ? '' : 'hidden'}`}>
            <ConverterPage initialFile={pendingConverter} />
          </div>
          <div className={`h-full ${page === 'thumbnails' ? '' : 'hidden'}`}>
            <ThumbnailPage isVisible={page === 'thumbnails'} />
          </div>
          <div className={`h-full ${page === 'streams' ? '' : 'hidden'}`}>
            <StreamsPage isVisible={page === 'streams'} onSendToPlayer={sendToPlayer} onSendToConverter={sendToConverter} onSendToCombine={sendToCombine} />
          </div>
          {page === 'templates' && <TemplatesPage />}
          {page === 'rules'     && <RulesPage />}
          {page === 'combine'   && <CombinePage initialFiles={pendingCombine} />}
          {page === 'launcher'  && <LauncherPage />}
          {page === 'integrations'   && <IntegrationsPage />}
          {page === 'settings'  && (
            <SettingsPage
              onOpenOnboarding={() => setOnboardingOpen(true)}
              onDirtyChange={setSettingsDirty}
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

      <Modal
        isOpen={!!quitConfirm}
        onClose={() => setQuitConfirm(null)}
        title="Conversions in progress"
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
              <p className="text-gray-200">
                {quitConfirm.running} conversion{quitConfirm.running === 1 ? ' is' : 's are'} still running
                {quitConfirm.queued > 0 ? ` (and ${quitConfirm.queued} queued)` : ''}.
              </p>
              <p className="text-gray-400">
                Quitting now will cancel them and any progress will be lost.
              </p>
            </div>
          </div>
        )}
      </Modal>

      <HelpModal isOpen={helpOpen} onClose={() => setHelpOpen(false)} />

      <CloudOpsModal />

      <PostStreamTwitchModal />

      <Modal isOpen={aboutOpen} onClose={() => setAboutOpen(false)} title="About Stream Manager" width="sm">
        <div className="flex flex-col items-center gap-4 py-2 text-center">
          <img src={logoUrl} alt="" className="w-12 h-12 opacity-90" />
          <div className="flex flex-col gap-1">
            <p className="text-sm text-gray-300 leading-relaxed">
              A desktop app for streamers to manage, review, and process local recording files.
            </p>
            <p className="text-xs text-gray-400 mt-1">Version {appVersion}</p>
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
