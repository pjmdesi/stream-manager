import React, { useState, useEffect, Component } from 'react'
import { version as appVersion } from '../../../package.json'
import { Film, Shuffle, Zap, Settings, Minus, Square, X, Radio, Combine, Plug, Play, AlertTriangle } from 'lucide-react'
import { Button } from './components/ui/Button'
import { Modal } from './components/ui/Modal'
import logoUrl from './assets/stream-manager-logo.svg'
import type { Page } from './types'
import { StreamsPage } from './components/pages/StreamsPage'
import { PlayerPage } from './components/pages/PlayerPage'
import { TemplatesPage } from './components/pages/TemplatesPage'
import { RulesPage } from './components/pages/RulesPage'
import { ConverterPage } from './components/pages/ConverterPage'
import { CombinePage } from './components/pages/CombinePage'
import { YouTubePage } from './components/pages/YouTubePage'
import { SettingsPage } from './components/pages/SettingsPage'
import { useConversionJobs } from './context/ConversionContext'
import { useWatcher } from './context/WatcherContext'
import { useStore } from './hooks/useStore'
import { OnboardingModal } from './components/OnboardingModal'

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
          <p className="text-xs text-gray-500 font-mono break-all max-w-lg">{this.state.error.message}</p>
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

function ConversionWidget({ onNavigate }: { onNavigate: () => void }) {
  const { jobs } = useConversionJobs()

  const relevant = jobs.filter(j => j.status === 'running' || j.status === 'paused' || j.status === 'error' || j.status === 'done')
  const active = relevant.filter(j => j.status === 'running' || j.status === 'paused' || j.status === 'error')
  if (active.length === 0) return null

  const hasError   = active.some(j => j.status === 'error')
  const allPaused  = !hasError && active.every(j => j.status === 'paused')

  const label = hasError ? 'Error' : allPaused ? 'All Paused' : 'In Progress'
  const totalProgress = relevant.length > 0
    ? relevant.reduce((sum, j) => sum + j.progress, 0) / relevant.length
    : 0

  const barColor = hasError ? 'bg-red-500' : allPaused ? 'bg-yellow-400' : 'bg-purple-500'

  return (
    <button
      onClick={onNavigate}
      className="w-full p-3 bg-navy-900 border-y border-white/5 hover:border-white/10 hover:bg-white/5 transition-colors text-left"
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Converting</span>
        <span className={`text-[10px] font-medium ${hasError ? 'text-red-400' : allPaused ? 'text-yellow-400' : 'text-purple-400'}`}>
          {label}
        </span>
      </div>
      <div className="h-1 w-full bg-white/10 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${barColor}`}
          style={{ width: `${totalProgress}%` }}
        />
      </div>
      <div className="mt-1.5 text-[10px] text-gray-600 tabular-nums">
        {totalProgress.toFixed(1)}% · {active.length} job{active.length !== 1 ? 's' : ''}
      </div>
    </button>
  )
}

function AutoRulesWidget({ active, onNavigate }: { active: boolean; onNavigate: () => void }) {
  const { rules, running, startWatcher, stopWatcher } = useWatcher()
  const enabledCount = rules.filter(r => r.enabled).length

  return (
    <div className={`border-y transition-colors ${active ? 'bg-purple-600/20 border-purple-600/30' : 'bg-navy-900 border-white/5'}`}>
      <button
        onClick={onNavigate}
        className={`flex items-center gap-3 w-full px-4 py-2.5 text-sm font-medium transition-colors ${active ? 'text-purple-300' : 'text-gray-400 hover:text-gray-200'}`}
      >
        <Shuffle size={18} />
        Auto-Rules
      </button>
      {rules.length > 0 && (
        <>
          <div className="px-3 pb-1">
            {running ? (
              <Button variant="danger" size="sm" icon={<Square size={12} />} className="w-full" onClick={stopWatcher}>
                Stop Watcher
              </Button>
            ) : (
              <Button variant="success" size="sm" icon={<Play size={12} />} className="w-full" onClick={startWatcher} disabled={enabledCount === 0}>
                Start Watcher
              </Button>
            )}
          </div>
          <div className="px-4 py-2 flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${running ? 'bg-green-400 animate-pulse' : 'bg-gray-600'}`} />
            <span className="text-[10px] text-gray-500">
              {running ? 'Running' : 'Stopped'} · {enabledCount} rule{enabledCount !== 1 ? 's' : ''} active
            </span>
          </div>
        </>
      )}
    </div>
  )
}

const NAV_ITEMS: { id: Page; label: string; icon: React.ReactNode }[] = [
  { id: 'streams',   label: 'Streams',      icon: <Radio size={18} /> },
  { id: 'player',    label: 'Player',       icon: <Film size={18} /> },
  { id: 'converter', label: 'Converter',    icon: <Zap size={18} /> },
  { id: 'combine',   label: 'Combine',      icon: <Combine size={18} /> },
  { id: 'youtube',   label: 'Integrations', icon: <Plug size={18} /> },
  { id: 'settings',  label: 'Settings',     icon: <Settings size={18} /> },
]

export default function App() {
  const [page, setPage] = useState<Page>('streams')
  const [aboutOpen, setAboutOpen] = useState(false)
  const [onboardingOpen, setOnboardingOpen] = useState(false)
  const [integrationAlert, setIntegrationAlert] = useState(false)
  const { config, loading, refreshConfig } = useStore()
  const { refreshRules } = useWatcher()

  const checkIntegrationAlert = () => {
    window.api.youtubeValidateToken?.().then(r => {
      setIntegrationAlert(!r.valid)
    }).catch(() => {})
  }

  useEffect(() => {
    checkIntegrationAlert()
  }, [])

  useEffect(() => {
    if (page === 'youtube') checkIntegrationAlert()
  }, [page])

  useEffect(() => {
    if (loading) return
    if (!config.streamsDir) setOnboardingOpen(true)
    const splash = document.getElementById('splash')
    if (splash) {
      splash.classList.add('fade-out')
      setTimeout(() => splash.remove(), 400)
    }
  }, [loading])
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
          <button
            onClick={() => window.api.windowMinimize()}
            className="p-1.5 rounded hover:bg-white/10 text-gray-500 hover:text-gray-300 transition-colors"
          >
            <Minus size={12} />
          </button>
          <button
            onClick={() => window.api.windowMaximize()}
            className="p-1.5 rounded hover:bg-white/10 text-gray-500 hover:text-gray-300 transition-colors"
          >
            <Square size={12} />
          </button>
          <button
            onClick={() => window.api.windowClose()}
            className="p-1.5 rounded hover:bg-red-600 text-gray-500 hover:text-white transition-colors"
          >
            <X size={12} />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <nav className="w-48 bg-navy-800 border-r border-white/5 flex flex-col shrink-0">
          <div className="flex-1">
            {NAV_ITEMS.map(item => {
              const showAlert = item.id === 'youtube' && integrationAlert
              return (
                <button
                  key={item.id}
                  onClick={() => setPage(item.id)}
                  className={`
                    w-full flex items-center gap-3 px-4 py-2.5 text-sm font-medium transition-all duration-150 border
                    ${page === item.id
                      ? 'bg-purple-600/20 text-purple-300 border-purple-600/30'
                      : 'text-gray-400 hover:text-gray-200 hover:bg-white/5 border-transparent'
                    }
                  `}
                >
                  {item.icon}
                  <span className="flex-1 text-left">{item.label}</span>
                  {showAlert && (
                    <AlertTriangle size={13} className="text-amber-400 shrink-0" />
                  )}
                </button>
              )
            })}
          </div>
          <div className="border-t border-white/5" />
          {page !== 'converter' && <ConversionWidget onNavigate={() => setPage('converter')} />}
          <AutoRulesWidget active={page === 'rules'} onNavigate={() => setPage('rules')} />
          <button
            onClick={() => setAboutOpen(true)}
            className="py-1 flex justify-center w-full hover:text-gray-500 transition-colors"
          >
            <span className="text-[10px] text-gray-700">v{appVersion}</span>
          </button>
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
          {page === 'streams'   && <StreamsPage onSendToPlayer={sendToPlayer} onSendToConverter={sendToConverter} onSendToCombine={sendToCombine} />}
          {page === 'templates' && <TemplatesPage />}
          {page === 'rules'     && <RulesPage />}
          {page === 'combine'   && <CombinePage initialFiles={pendingCombine} />}
          {page === 'youtube'   && <YouTubePage />}
          {page === 'settings'  && <SettingsPage />}
        </PageErrorBoundary>
        </main>
      </div>
      <OnboardingModal isOpen={onboardingOpen} onComplete={() => { setOnboardingOpen(false); refreshConfig(); refreshRules() }} />

      <Modal isOpen={aboutOpen} onClose={() => setAboutOpen(false)} title="About Stream Manager" width="sm">
        <div className="flex flex-col items-center gap-4 py-2 text-center">
          <img src={logoUrl} alt="" className="w-12 h-12 opacity-90" />
          <div className="flex flex-col gap-1">
            <p className="text-sm text-gray-300 leading-relaxed">
              A desktop app for streamers to manage, review, and process local recording files.
            </p>
            <p className="text-xs text-gray-500 mt-1">Version {appVersion}</p>
          </div>
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
