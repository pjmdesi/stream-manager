import React, { useEffect, useRef, useState, useCallback } from 'react'
import { FolderOpen, Save, ChevronDown, AlertTriangle, Trash2, AlertCircle, Plus, Bot, FolderTree, CheckCircle, User, HardDrive, Radio, Film, Zap, Palette, MonitorCog, Shuffle, FlaskConical, ArrowRight } from 'lucide-react'
import { Youtube, Twitch } from '../ui/BrandIcons'
import { useStore } from '../../hooks/useStore'
import { useThumbnailEditor } from '../../context/ThumbnailEditorContext'
import { Button } from '../ui/Button'
import { Checkbox } from '../ui/Checkbox'
import { Input } from '../ui/Input'
import { Modal } from '../ui/Modal'
import { DumpConvertExplainer } from '../DumpConvertExplainer'
import type { ConversionPreset, ThumbnailTemplate, Page } from '../../types'
import { isClipExportCompatible } from '../../lib/clipExport'

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
}

function DirInput({
  label,
  value,
  onChange,
  hint,
}: {
  label: React.ReactNode
  value: string
  onChange: (v: string) => void
  hint?: string
}) {
  const pick = async () => {
    const dir = await window.api.openDirectoryDialog()
    if (dir) onChange(dir)
  }

  return (
    <div className="flex flex-col gap-1">
      <label className="text-sm font-medium text-gray-300">{label}</label>
      <div className="flex gap-2">
        <input
          className="flex-1 bg-navy-900 border border-white/10 text-gray-200 text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500/50"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder="Select a folder…"
        />
        <Button variant="secondary" size="sm" icon={<FolderOpen size={14} />} onClick={pick}>
          Browse
        </Button>
      </div>
      {hint && <p className="text-xs text-gray-400">{hint}</p>}
    </div>
  )
}

/**
 * ForceQuotaToggle — dev-only checkbox surfaced inside the Settings
 * form. Stages into `local` like every other setting; the parent's
 * save handler persists the field AND fires the IPC so the main-side
 * `ytQuotaState.forcedExceeded` matches the just-saved config. On app
 * startup the same flag is re-applied from the persisted config.
 */
function ForceQuotaToggle({
  checked, onChange, labelSuffix,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  labelSuffix?: React.ReactNode
}) {
  return (
    <Checkbox
      checked={checked}
      onChange={onChange}
      label={<div><div className="text-sm font-medium text-gray-200">Force YouTube quota-exceeded {labelSuffix}</div><div className="text-xs text-gray-400">Pretends the YouTube Data API returned a quota 403 for every call. All push/pull, auto-refresh, and relay broadcast lifecycle operations will fail with the same banner + gating as a real outage — useful for exercising the offline-cache fallbacks. Applied on Save; persists across restarts until you toggle it back off.</div></div>}
    />
  )
}

// TODO (cloud sync): if users report perf issues with the parallel
// dehydrate/hydrate workers, expose two settings here:
//   1. Max concurrent files (currently hardcoded at DEHYDRATE_CONCURRENCY /
//      HYDRATE_CONCURRENCY = 4 in src/main/services/cfapi.ts). HDD users may
//      benefit from 1; users on fast NAS could try 6–8.
//   2. Cloud service provider selector (Synology Drive / OneDrive / Dropbox /
//      iCloud / Generic). Lets us tune per-provider quirks — e.g. Synology's
//      0x80070187 sensitivity, OneDrive's API rate limit, attribute-flag
//      heuristics — instead of a one-size-fits-all CFAPI path. Remove this
//      note if we either ship the settings or decide they're not warranted.
interface SettingsPageProps {
  /** Called after a save in which the streams root changed AND the new
   *  directory has no _meta.json. The app interprets this as "the user is
   *  pointing at an uninitialized folder" and re-opens the onboarding flow. */
  onOpenOnboarding?: () => void
  /** Reports the page's dirty state to App so the global setPage wrapper
   *  can intercept nav-away clicks. Fires on every isDirty transition. */
  onDirtyChange?: (dirty: boolean) => void
  /** Set by App's setPage wrapper when the user tries to navigate while
   *  there are unsaved changes — the modal below prompts Save / Discard /
   *  Cancel and resolves via onConfirmNav / onCancelNav. */
  pendingNav?: Page | null
  /** Called when the user picks Save or Discard in the prompt. App is
   *  expected to perform the actual page change (bypassing the wrapper). */
  onConfirmNav?: (target: Page) => void
  /** Called when the user picks Cancel. App should clear pendingNav so the
   *  modal closes and the user stays on Settings. */
  onCancelNav?: () => void
  /** Navigate to another page (App's guarded setPage). Used by the
   *  "Manage integrations" link in the Profile section. */
  onNavigate?: (target: Page) => void
}

/** Section metadata for the jump-nav. `keys` are the config keys a
 *  section owns — used to show an "unsaved changes" dot on its nav chip.
 *  `dev` sections only appear in dev builds. */
interface SettingsSectionMeta {
  id: string
  label: string
  icon: React.ReactNode
  keys: (keyof import('../../types').AppConfig)[]
  dev?: boolean
}

const SETTINGS_SECTIONS: SettingsSectionMeta[] = [
  { id: 'profile', label: 'Profile', icon: <User size={14} />, keys: ['streamerName'] },
  { id: 'directories', label: 'Directories', icon: <FolderTree size={14} />, keys: ['streamsDir', 'defaultWatchDir', 'tempDir'] },
  { id: 'cache', label: 'Cache', icon: <HardDrive size={14} />, keys: ['audioCacheLimit'] },
  { id: 'streams', label: 'Streams', icon: <Radio size={14} />, keys: ['useBuiltinThumbnailByDefault', 'defaultBuiltinThumbnailTemplate', 'defaultThumbnailTemplate', 'archivePresetId', 'checkEpisodeIteration', 'defaultBroadcastTime', 'defaultYouTubeCategoryId', 'twitchSkipCategoryRenamePrompt'] },
  { id: 'player', label: 'Video Player', icon: <Film size={14} />, keys: ['clipPresetId', 'defaultBleepVolume', 'skipClipMergeWarning'] },
  { id: 'converter', label: 'Converter', icon: <Zap size={14} />, keys: ['autoDeletePartialOnCancel'] },
  { id: 'appearance', label: 'Appearance', icon: <Palette size={14} />, keys: ['disableAnimations', 'calendarFirstDayOfWeek'] },
  { id: 'autorules', label: 'Auto-rules', icon: <Shuffle size={14} />, keys: ['autoStartWatcher'] },
  { id: 'system', label: 'System', icon: <MonitorCog size={14} />, keys: ['checkForUpdates', 'startWithWindows', 'startMinimized'] },
  { id: 'devtools', label: 'Dev Tools', icon: <FlaskConical size={14} />, keys: ['slowAnimations', 'devForceYouTubeQuotaExceeded'], dev: true },
]

/** A settings section with an icon'd header. Registers its DOM node by
 *  id so the jump-nav can scroll to it + track which one is in view. */
function Section({
  id, icon, title, headerClass, registerRef, children,
}: {
  id: string
  icon: React.ReactNode
  title: string
  /** Override the header text color (Dev Tools uses amber). */
  headerClass?: string
  registerRef: (id: string, el: HTMLElement | null) => void
  children: React.ReactNode
}) {
  return (
    <section
      id={`settings-${id}`}
      ref={el => registerRef(id, el)}
      className="flex flex-col gap-4 scroll-mt-4"
    >
      <h2 className={`flex items-center gap-2 text-sm font-semibold uppercase tracking-wider border-b pb-2 ${headerClass ?? 'text-gray-300 border-white/5'}`}>
        <span className={headerClass ? 'text-yellow-600' : 'text-purple-300'}>{icon}</span>
        {title}
      </h2>
      {children}
    </section>
  )
}

export function SettingsPage({ onOpenOnboarding, onDirtyChange, onNavigate, pendingNav, onConfirmNav, onCancelNav }: SettingsPageProps = {}) {
  const { config, updateConfig, loading } = useStore()
  const [local, setLocal] = useState(config)
  // Snapshot the streamsDir as it was when the page mounted (or after the
  // last save). Compared to local.streamsDir on save so we only fire the
  // post-change checks when the user actually changed it.
  const lastSavedStreamsDirRef = useRef(config.streamsDir)
  useEffect(() => { lastSavedStreamsDirRef.current = config.streamsDir }, [config.streamsDir])
  const [saved, setSaved] = useState(false)
  const [allPresets, setAllPresets] = useState<ConversionPreset[]>([])
  const [thumbnailTemplates, setThumbnailTemplates] = useState<{ name: string; path: string }[]>([])
  const [builtinTemplates, setBuiltinTemplates] = useState<ThumbnailTemplate[]>([])
  const { navigateToEditor } = useThumbnailEditor()
  const [cacheSize, setCacheSize] = useState<number>(0)
  const [clearingCache, setClearingCache] = useState(false)
  const [ytStatus, setYtStatus] = useState<{ connected: boolean; valid: boolean } | null>(null)
  const [twStatus, setTwStatus] = useState<{ connected: boolean } | null>(null)
  // Convert dump → folder-per-stream modal state
  const [convertModalOpen, setConvertModalOpen] = useState(false)
  type ConvertManifest = { moves: { from: string; to: string }[]; createdFolders: string[] }
  type ConvertResult = { moved: number; skipped: number; manifest: ConvertManifest }
  const [convertStatus, setConvertStatus] = useState<'idle' | 'converting' | 'done' | 'undoing' | 'undone'>('idle')
  const [convertResult, setConvertResult] = useState<ConvertResult | null>(null)
  const [convertError, setConvertError] = useState<string | null>(null)

  useEffect(() => {
    if (!loading) setLocal(config)
  }, [loading, config])

  useEffect(() => {
    Promise.all([window.api.getBuiltinPresets(), window.api.getImportedPresets()])
      .then(([builtin, imported]) => setAllPresets([...builtin, ...imported]))
  }, [])

  useEffect(() => {
    if (!local.streamsDir) { setThumbnailTemplates([]); setBuiltinTemplates([]); return }
    window.api.listStreamTemplates(local.streamsDir).then(setThumbnailTemplates)
    window.api.thumbnailListTemplates(local.streamsDir).then(setBuiltinTemplates).catch(() => setBuiltinTemplates([]))
  }, [local.streamsDir])

  useEffect(() => {
    window.api.getAudioCacheSize().then(setCacheSize)
  }, [])

  useEffect(() => {
    window.api.youtubeGetStatus().then(async (s: { connected: boolean }) => {
      if (!s.connected) { setYtStatus({ connected: false, valid: false }); return }
      const v = await window.api.youtubeValidateToken().catch(() => ({ valid: false }))
      setYtStatus({ connected: true, valid: v.valid })
      // Categories list — only fetchable when YT is connected. Used to
      // populate the "Default YouTube category" dropdown in the
      // Streams section. Failure is non-fatal — dropdown just stays
      // empty + disabled with a hint.
      window.api.youtubeGetCategories()
        .then(setYtCategories)
        .catch(() => {})
    }).catch(() => {})
    window.api.twitchGetStatus?.().then((s: { connected: boolean }) => {
      setTwStatus({ connected: s.connected })
    }).catch(() => {})
  }, [])

  const [ytCategories, setYtCategories] = useState<{ id: string; title: string; assignable: boolean }[]>([])

  const clearCache = async () => {
    setClearingCache(true)
    await window.api.clearAudioCache()
    setCacheSize(0)
    setClearingCache(false)
  }

  const isDirty = JSON.stringify(local) !== JSON.stringify(config)

  // Bubble the dirty state up so App can intercept nav clicks. Single
  // signal (boolean) — App doesn't need the local diff itself.
  useEffect(() => { onDirtyChange?.(isDirty) }, [isDirty, onDirtyChange])

  // True while the nav-prompt's Save action is mid-flight. Disables the
  // modal buttons so the user can't double-click and trigger two saves.
  const [navSaving, setNavSaving] = useState(false)

  const set = (key: keyof typeof config, value: any) => {
    setLocal(prev => ({ ...prev, [key]: value }))
    setSaved(false)
  }

  // One-time thumbnail-hash backfill (Dev Tools).
  const [backfillState, setBackfillState] = useState<'idle' | 'running' | string>('idle')
  const runThumbnailBackfill = async () => {
    if (!local.streamsDir) { setBackfillState('No streams directory configured.'); return }
    setBackfillState('running')
    try {
      const mode = local.streamMode === 'dump-folder' ? 'dump-folder' : 'folder-per-stream'
      const r = await window.api.backfillThumbnailHashes(local.streamsDir, mode)
      setBackfillState(`Stamped ${r.updated} stream${r.updated === 1 ? '' : 's'}` +
        (r.skippedNoThumb > 0 ? ` · ${r.skippedNoThumb} skipped (no thumbnail)` : '') +
        '. Re-check the out-of-sync panel.')
    } catch (err: any) {
      setBackfillState(`Failed: ${err?.message ?? String(err)}`)
    }
  }

  // ── Jump-nav ───────────────────────────────────────────────────────────
  const isDev = import.meta.env.DEV
  const sections = SETTINGS_SECTIONS.filter(s => !s.dev || isDev)
  const scrollRef = useRef<HTMLDivElement>(null)
  const sectionEls = useRef<Map<string, HTMLElement>>(new Map())
  const [activeSection, setActiveSection] = useState<string>(sections[0]?.id ?? '')
  const registerSection = useCallback((id: string, el: HTMLElement | null) => {
    if (el) sectionEls.current.set(id, el)
    else sectionEls.current.delete(id)
  }, [])

  // Active-section tracking: the section whose top is at/above a trigger
  // line near the container top is "active". Runs on scroll of the inner
  // container (not the window). The bottom-of-scroll case forces the last
  // section so a short final section still highlights.
  const computeActive = useCallback(() => {
    const sc = scrollRef.current
    if (!sc) return
    if (sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 4) {
      setActiveSection(sections[sections.length - 1]?.id ?? '')
      return
    }
    const line = sc.getBoundingClientRect().top + 72
    let current = sections[0]?.id ?? ''
    for (const s of sections) {
      const el = sectionEls.current.get(s.id)
      if (el && el.getBoundingClientRect().top <= line) current = s.id
    }
    setActiveSection(current)
  }, [sections])

  useEffect(() => {
    const sc = scrollRef.current
    if (!sc) return
    computeActive()
    sc.addEventListener('scroll', computeActive, { passive: true })
    return () => sc.removeEventListener('scroll', computeActive)
  }, [computeActive])

  const jumpTo = (id: string) => {
    sectionEls.current.get(id)?.scrollIntoView({ behavior: local.disableAnimations ? 'auto' : 'smooth', block: 'start' })
  }

  // Per-key dirty check — a key is dirty when its staged value differs
  // from what's saved. Drives both the per-field label dots and the
  // section nav-chip dots. Blue matches the "local edit" mismatch dot
  // color used in the streams detail sidebar.
  const keyDirty = (key: keyof typeof config) =>
    JSON.stringify(local[key]) !== JSON.stringify(config[key])
  const sectionDirty = (keys: (keyof typeof config)[]) => keys.some(keyDirty)
  const dirtyDot = (key: keyof typeof config) =>
    keyDirty(key)
      ? <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-400 ml-1.5 align-middle shrink-0" />
      : null

  const save = async () => {
    const prevStreamsDir = lastSavedStreamsDirRef.current
    const newStreamsDir = local.streamsDir
    await updateConfig(local)
    await window.api.setStartupSettings(!!local.startWithWindows, !!local.startMinimized)
    // Dev-only: apply the just-persisted force-quota flag to the live
    // runtime in ytQuotaState. No-op in production builds since the
    // toggle isn't visible there; safe to call unconditionally.
    await window.api.youtubeSetForcedQuotaExceeded(!!local.devForceYouTubeQuotaExceeded).catch(() => {})
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)

    // If the streams root just changed AND the new location has no
    // _meta.json (uninitialized or a wrong-folder mistake), re-run the
    // onboarding flow so the user reconfigures stream-mode + scaffolds the
    // initial state instead of working against a blank dir. .catch(true)
    // is conservative: on probe error, leave the user alone.
    if (newStreamsDir !== prevStreamsDir) {
      const hasMeta = newStreamsDir
        ? await window.api.fileExists(`${newStreamsDir}/_meta.json`).catch(() => true)
        : false
      if (!hasMeta) onOpenOnboarding?.()
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center h-full text-gray-400 text-sm">Loading…</div>
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 shrink-0">
        <div>
          <h1 className="text-lg font-semibold">Settings</h1>
          <p className="text-xs text-gray-400 mt-0.5">Configure default paths and preferences</p>
        </div>
        <Button
          variant={saved ? 'success' : 'primary'}
          size="sm"
          icon={<Save size={14} />}
          onClick={save}
          disabled={!isDirty && !saved}
          className={isDirty ? 'save-attention' : ''}
        >
          {saved ? 'Saved!' : 'Save'}
        </Button>
      </div>

      {/* Jump-nav — always visible below the header. Clicking a chip
          scrolls the content to that section; the active chip tracks the
          section in view; a dot marks sections with unsaved changes. */}
      <nav className="shrink-0 border-b border-white/5 overflow-x-auto">
        {/* `w-max mx-auto` centers the chips when they fit and falls back
            to left-anchored + horizontal scroll when they don't (narrow
            window), so the first chip is always reachable. */}
        <div className="flex items-center gap-1 w-max mx-auto px-6 py-2">
          {sections.map(s => {
            const active = activeSection === s.id
            const dirty = sectionDirty(s.keys)
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => jumpTo(s.id)}
                className={`relative flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs whitespace-nowrap transition-colors ${
                  active ? 'bg-purple-600/25 text-purple-200' : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'
                }`}
              >
                <span className={active ? 'text-purple-300' : (s.dev ? 'text-yellow-600' : 'text-gray-500')}>{s.icon}</span>
                {s.label}
                {dirty && <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-blue-400" />}
              </button>
            )
          })}
        </div>
      </nav>

      <div ref={scrollRef} className="flex-1 overflow-y-auto pr-2">
      <div className="p-6 flex flex-col gap-12 max-w-2xl mx-auto">
        {/* Profile */}
        <Section id="profile" icon={<User size={14} />} title="Profile" registerRef={registerSection}>
          <Input
            label="Streamer Name"
            labelSuffix={dirtyDot('streamerName')}
            value={local.streamerName}
            onChange={e => set('streamerName', e.target.value)}
            placeholder="Your channel name"
            hint="Used to pre-fill your name in stream metadata and integrations"
          />
          {(ytStatus || twStatus || local.claudeApiKey !== undefined) && (
            <div className="flex items-center gap-4 flex-wrap">
              {ytStatus && (
                <span className={`flex items-center gap-1.5 text-xs ${
                  ytStatus.connected && ytStatus.valid ? 'text-green-400' :
                  ytStatus.connected && !ytStatus.valid ? 'text-amber-400' :
                  'text-gray-400'
                }`}>
                  {ytStatus.connected && !ytStatus.valid
                    ? <AlertCircle size={18} />
                    : <Youtube size={18} />
                  }
                  {ytStatus.connected && ytStatus.valid ? 'Connected' :
                   ytStatus.connected ? 'Token expired' :
                   'Not connected'}
                </span>
              )}
              {twStatus && (
                <span className={`flex items-center gap-1.5 text-xs ${twStatus.connected ? 'text-twitch-400' : 'text-gray-400'}`}>
                  <Twitch size={18} />
                  {twStatus.connected ? 'Connected' : 'Not connected'}
                </span>
              )}
              <span className={`flex items-center gap-1.5 text-xs ${local.claudeApiKey ? 'text-orange-400' : 'text-gray-400'}`}>
                <Bot size={18} />
                {local.claudeApiKey ? 'Connected' : 'Not connected'}
              </span>
              <button
                type="button"
                onClick={() => onNavigate?.('integrations')}
                className="flex items-center gap-1 text-xs text-gray-400 hover:text-purple-300 transition-colors ml-auto"
              >
                Manage integrations
                <ArrowRight size={12} />
              </button>
            </div>
          )}
        </Section>

        {/* Directories */}
        <Section id="directories" icon={<FolderTree size={14} />} title="Directories" registerRef={registerSection}>
          <DirInput
            label={<>Streams Directory {dirtyDot('streamsDir')}</>}
            value={local.streamsDir}
            onChange={v => set('streamsDir', v)}
            hint="Root folder containing your YYYY-MM-DD stream session folders"
          />
          {local.streamMode === 'dump-folder' && local.streamsDir && (
            <div className="flex items-center gap-3 -mt-2 pl-1">
              <Button
                variant="secondary"
                size="sm"
                icon={<FolderTree size={14} />}
                onClick={() => {
                  setConvertStatus('idle')
                  setConvertResult(null)
                  setConvertError(null)
                  setConvertModalOpen(true)
                }}
              >
                Convert to folder-per-stream
              </Button>
              <span className="text-xs text-gray-400">Currently using dump-folder mode.</span>
            </div>
          )}
          <DirInput
            label={<>Default Watch Directory {dirtyDot('defaultWatchDir')}</>}
            value={local.defaultWatchDir}
            onChange={v => set('defaultWatchDir', v)}
            hint="Where Auto-Rules watch for new files by default"
          />
          <DirInput
            label={<>Cache Directory {dirtyDot('tempDir')}</>}
            value={local.tempDir}
            onChange={v => set('tempDir', v)}
            hint="Where temporary cached files are stored during processing"
          />
        </Section>

        {/* Cache */}
        <Section id="cache" icon={<HardDrive size={14} />} title="Cache Files" registerRef={registerSection}>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-gray-300">Cache Limit {dirtyDot('audioCacheLimit')}</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={128}
                step={128}
                value={Math.round((local.audioCacheLimit ?? 1_073_741_824) / (1024 * 1024))}
                onChange={e => set('audioCacheLimit', Math.max(128, parseInt(e.target.value) || 128) * 1024 * 1024)}
                className="w-28 bg-navy-900 border border-white/10 text-gray-200 text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500/50"
              />
              <span className="text-sm text-gray-400">MB</span>
            </div>
            <p className="text-xs text-gray-400">
              Maximum disk space used by cached files. Oldest entries are evicted automatically when the limit is reached.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-400">Currently using: <span className="font-semibold text-gray-300">{formatBytes(cacheSize)}</span></span>
            <Button
              variant="ghost"
              size="sm"
              icon={<Trash2 size={13} />}
              onClick={clearCache}
              disabled={clearingCache || cacheSize === 0}
            >
              {clearingCache ? 'Clearing…' : 'Clear Cache'}
            </Button>
          </div>
        </Section>

        {/* Streams */}
        <Section id="streams" icon={<Radio size={14} />} title="Streams" registerRef={registerSection}>
          <Checkbox
            checked={local.useBuiltinThumbnailByDefault ?? true}
            onChange={v => set('useBuiltinThumbnailByDefault', v)}
            label={<div><div className="text-sm font-medium text-gray-200">Use the built-in thumbnail creator by default {dirtyDot('useBuiltinThumbnailByDefault')}</div><div className="text-xs text-gray-400">Pre-checks the "use the built-in thumbnail creator" option when creating new streams, so the thumbnail editor opens with your default built-in template instead of copying an external template file.</div></div>}
          />

          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-gray-300">Default Built-in Thumbnail Template {dirtyDot('defaultBuiltinThumbnailTemplate')}</label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <select
                  value={local.defaultBuiltinThumbnailTemplate ?? ''}
                  onChange={e => set('defaultBuiltinThumbnailTemplate', e.target.value)}
                  className="w-full appearance-none bg-navy-900 border border-white/10 text-gray-200 text-sm rounded-lg px-3 py-2 pr-8 focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                >
                  <option value="">— None —</option>
                  {builtinTemplates.map(t => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
                <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              </div>
              {builtinTemplates.length === 0 && (
                <Button variant="secondary" size="sm" icon={<Plus size={13} />} onClick={navigateToEditor}>
                  Create Template
                </Button>
              )}
            </div>
            <p className="text-xs text-gray-400">Used when the "use built-in thumbnail creator" option is checked in the new-stream dialog.</p>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-gray-300">Default External Thumbnail Template {dirtyDot('defaultThumbnailTemplate')}</label>
            <div className="relative">
              <select
                value={local.defaultThumbnailTemplate ?? ''}
                onChange={e => set('defaultThumbnailTemplate', e.target.value)}
                className="w-full appearance-none bg-navy-900 border border-white/10 text-gray-200 text-sm rounded-lg px-3 py-2 pr-8 focus:outline-none focus:ring-2 focus:ring-purple-500/50"
              >
                <option value="">— None —</option>
                {thumbnailTemplates.map(t => (
                  <option key={t.name} value={t.name}>{t.name}</option>
                ))}
              </select>
              <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            </div>
            <p className="text-xs text-gray-400">Copied into new stream folders as <span className="font-mono">[date] thumbnail.af</span> when the built-in option is unchecked.</p>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-gray-300">Default Archive Preset {dirtyDot('archivePresetId')}</label>
            <div className="relative">
              <select
                value={local.archivePresetId ?? ''}
                onChange={e => set('archivePresetId', e.target.value)}
                className="w-full appearance-none bg-navy-900 border border-white/10 text-gray-200 text-sm rounded-lg px-3 py-2 pr-8 focus:outline-none focus:ring-2 focus:ring-purple-500/50"
              >
                <option value="">— None selected —</option>
                {allPresets.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            </div>
            {local.archivePresetId && !allPresets.find(p => p.id === local.archivePresetId) && (
              <p className="flex items-center gap-1 text-xs text-yellow-500">
                <AlertTriangle size={11} />
                Selected preset not found — it may have been removed or the presets directory hasn't loaded yet.
              </p>
            )}
            <p className="text-xs text-gray-400">Converter preset used when archiving stream folders from the Streams page. Compresses MKVs in-place and marks them as archived.</p>
          </div>

          <Checkbox
            checked={local.checkEpisodeIteration ?? true}
            onChange={v => set('checkEpisodeIteration', v)}
            label={<div><div className="text-sm font-medium text-gray-200">Check for episode iteration {dirtyDot('checkEpisodeIteration')}</div><div className="text-xs text-gray-400">When creating a new stream folder, automatically detect and increment the episode number based on previous sessions of the same game.</div></div>}
          />

          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-gray-300">Default broadcast time {dirtyDot('defaultBroadcastTime')}</label>
            <input
              type="time"
              value={local.defaultBroadcastTime || '19:00'}
              onChange={e => set('defaultBroadcastTime', e.target.value || '19:00')}
              className="w-32 bg-navy-900 border border-white/10 text-gray-200 text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500/50 [color-scheme:dark]"
            />
            <p className="text-xs text-gray-400">Pre-fills the start time when scheduling a YouTube broadcast — both when creating one from a stream item and when rescheduling. You can still change it per-broadcast.</p>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-gray-300">Default YouTube category {dirtyDot('defaultYouTubeCategoryId')}</label>
            <div className="relative">
              <select
                value={local.defaultYouTubeCategoryId ?? ''}
                onChange={e => set('defaultYouTubeCategoryId', e.target.value)}
                disabled={!ytStatus?.connected || ytCategories.length === 0}
                className="w-full appearance-none bg-navy-900 border border-white/10 text-gray-200 text-sm rounded-lg px-3 py-2 pr-8 focus:outline-none focus:ring-2 focus:ring-purple-500/50 [color-scheme:dark] disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <option value="">— None —</option>
                {ytCategories.filter(c => c.assignable).map(c => (
                  <option key={c.id} value={c.id}>{c.title}</option>
                ))}
              </select>
              <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            </div>
            <p className="text-xs text-gray-400">Pre-fills the YouTube category field on newly-created streams (both "New stream" and "New episode"). YouTube requires a category on every video — picking a default here means the Push to YouTube button won't soft-block on new streams. Existing streams need to have a category picked manually before they can push to YouTube. {!ytStatus?.connected && <span className="text-amber-400">Connect YouTube to populate this list.</span>}</p>
          </div>

          <Checkbox
            checked={local.twitchSkipCategoryRenamePrompt ?? false}
            onChange={v => set('twitchSkipCategoryRenamePrompt', v)}
            label={<div><div className="text-sm font-medium text-gray-200">Skip "rename category" prompt after Twitch pushes {dirtyDot('twitchSkipCategoryRenamePrompt')}</div><div className="text-xs text-gray-400">Twitch fuzzy-matches the pushed game name through its search → game_id round-trip, so a typed "Black Flag" may come back as "Assassin's Creed IV Black Flag." When this is unchecked and the canonical name differs from what you sent, a modal asks whether to rename your local game tag to match. The modal also has its own "Don't ask again" button that sets this option.</div></div>}
          />
        </Section>

        {/* Video Player */}
        <Section id="player" icon={<Film size={14} />} title="Video Player" registerRef={registerSection}>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-gray-300">Default Clip Export Preset {dirtyDot('clipPresetId')}</label>
            <div className="relative">
              <select
                value={local.clipPresetId ?? ''}
                onChange={e => set('clipPresetId', e.target.value)}
                className="w-full appearance-none bg-navy-900 border border-white/10 text-gray-200 text-sm rounded-lg px-3 py-2 pr-8 focus:outline-none focus:ring-2 focus:ring-purple-500/50"
              >
                <option value="">— Default (H.264 CRF 18 + AAC 192k) —</option>
                {allPresets.filter(p => isClipExportCompatible(p.ffmpegArgs)).map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            </div>
            {local.clipPresetId && !allPresets.find(p => p.id === local.clipPresetId) && (
              <p className="flex items-center gap-1 text-xs text-yellow-500">
                <AlertTriangle size={11} />
                Selected preset not found — it may have been removed.
              </p>
            )}
            {local.clipPresetId && allPresets.find(p => p.id === local.clipPresetId) && !isClipExportCompatible(allPresets.find(p => p.id === local.clipPresetId)!.ffmpegArgs) && (
              <p className="flex items-center gap-1 text-xs text-yellow-500">
                <AlertTriangle size={11} />
                Selected preset uses stream copy or is audio-only and can't be used for clip exports. Pick an encoding preset or leave blank.
              </p>
            )}
            <p className="text-xs text-gray-400">Converter preset used when exporting clips from the player. Stream-copy and audio-only presets are filtered out — clips always re-encode because of trim/crop/bleep filters.</p>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-gray-300">
              Default Bleep Volume — <span className="text-purple-400 tabular-nums">{Math.round((local.defaultBleepVolume ?? 0.25) * 100)}%</span> {dirtyDot('defaultBleepVolume')}
            </label>
            <input
              type="range"
              min={0}
              max={1.5}
              step={0.01}
              value={local.defaultBleepVolume ?? 0.25}
              onChange={e => set('defaultBleepVolume', parseFloat(e.target.value))}
              className="w-full accent-purple-500"
            />
            <div className="flex justify-between text-xs text-gray-400">
              <span>Silent</span>
              <span>100%</span>
              <span>150%</span>
            </div>
            <p className="text-xs text-gray-400">Starting volume for bleep markers in clip mode. Can be adjusted per-session by dragging the line on a marker.</p>
          </div>

          <Checkbox
            checked={local.skipClipMergeWarning ?? false}
            onChange={v => set('skipClipMergeWarning', v)}
            label={<div><div className="text-sm font-medium text-gray-200">Skip multi-track confirmation on entering clip mode {dirtyDot('skipClipMergeWarning')}</div><div className="text-xs text-gray-400">Enter clip mode immediately on videos with multiple audio tracks instead of prompting to enable multi-track mode. You can still enable multi-track mode when clip mode is active.</div></div>}
          />
        </Section>

        {/* Converter */}
        <Section id="converter" icon={<Zap size={14} />} title="Converter" registerRef={registerSection}>
          <Checkbox
            checked={!!local.autoDeletePartialOnCancel}
            onChange={v => set('autoDeletePartialOnCancel', v)}
            label={<div><div className="text-sm font-medium text-gray-200">Automatically delete partial files on cancel {dirtyDot('autoDeletePartialOnCancel')}</div><div className="text-xs text-gray-400">When unchecked, you'll be asked each time a conversion is cancelled.</div></div>}
          />
        </Section>

        {/* Appearance */}
        <Section id="appearance" icon={<Palette size={14} />} title="Appearance" registerRef={registerSection}>
          <Checkbox
            checked={!!local.disableAnimations}
            onChange={v => set('disableAnimations', v)}
            label={<div><div className="text-sm font-medium text-gray-200">Disable animations {dirtyDot('disableAnimations')}</div><div className="text-xs text-gray-400">Turn off motion animations throughout the app. Also applies automatically if your OS has "Reduce motion" enabled.</div></div>}
          />
          <div className="flex flex-col gap-1.5">
            <div>
              <div className="text-sm font-medium text-gray-200">First day of the week {dirtyDot('calendarFirstDayOfWeek')}</div>
              <div className="text-xs text-gray-400">Sets the starting day for every calendar and date picker across the app, including the streams sidebar calendar. The sidebar calendar's own settings stay in sync with this.</div>
            </div>
            <div className="flex bg-navy-800 border border-white/10 rounded-lg overflow-hidden w-48">
              {(['sunday', 'monday'] as const).map(opt => {
                const selected = (local.calendarFirstDayOfWeek || 'sunday') === opt
                return (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => set('calendarFirstDayOfWeek', opt)}
                    className={`flex-1 py-1.5 text-sm capitalize transition-colors ${
                      selected ? 'bg-purple-600/25 text-purple-200' : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'
                    }`}
                  >
                    {opt}
                  </button>
                )
              })}
            </div>
          </div>
        </Section>

        {/* Auto-rules */}
        <Section id="autorules" icon={<Shuffle size={14} />} title="Auto-rules" registerRef={registerSection}>
          <Checkbox
            checked={local.autoStartWatcher}
            onChange={v => set('autoStartWatcher', v)}
            label={<div><div className="text-sm font-medium text-gray-200">Auto-start file watcher on launch {dirtyDot('autoStartWatcher')}</div><div className="text-xs text-gray-400">Automatically activate all enabled rules when the app opens.</div></div>}
          />
        </Section>

        {/* System */}
        <Section id="system" icon={<MonitorCog size={14} />} title="System" registerRef={registerSection}>
          <Checkbox
            checked={local.checkForUpdates ?? true}
            onChange={v => set('checkForUpdates', v)}
            label={<div><div className="text-sm font-medium text-gray-200">Check for app updates {dirtyDot('checkForUpdates')}</div><div className="text-xs text-gray-400">On launch, check the GitHub releases page for a newer version of Stream Manager. An indicator appears next to the version label in the sidebar when an update is available. No data is sent — only a public API call.</div></div>}
          />
          <Checkbox
            checked={!!local.startWithWindows}
            onChange={v => set('startWithWindows', v)}
            disabled={import.meta.env.DEV}
            label={
              <div>
                <div className="text-sm font-medium text-gray-200">
                  Start with Windows {dirtyDot('startWithWindows')}
                  {import.meta.env.DEV && <span className="ml-2 text-xs text-yellow-600 font-normal">(deployable builds only)</span>}
                </div>
                <div className="text-xs text-gray-400">Automatically launch Stream Manager when Windows starts</div>
              </div>
            }
          />
          <Checkbox
            checked={!!local.startMinimized}
            onChange={v => set('startMinimized', v)}
            disabled={import.meta.env.DEV || !local.startWithWindows}
            label={<div><div className="text-sm font-medium text-gray-200">Start Minimized {dirtyDot('startMinimized')}</div><div className="text-xs text-gray-400">Hide to tray on launch instead of opening the window.</div></div>}
          />
        </Section>

        {import.meta.env.DEV && (
          <Section id="devtools" icon={<FlaskConical size={14} />} title="Dev Tools" headerClass="text-yellow-600 border-yellow-600/20" registerRef={registerSection}>
            <div className="flex flex-col gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={async () => {
                  await window.api.resetOnboarding()
                  window.location.reload()
                }}
              >
                Reset onboarding
              </Button>
              <p className="text-xs text-gray-400">Clears streamsDir and streamerName, then reloads the app to trigger the onboarding flow. Not visible in production builds.</p>
            </div>
            <Checkbox
              checked={!!local.slowAnimations}
              onChange={v => setLocal(prev => ({ ...prev, slowAnimations: v }))}
              label={<div><div className="text-sm font-medium text-gray-200">Slow down animations (5×) {dirtyDot('slowAnimations')}</div><div className="text-xs text-gray-400">Multiplies all motion animation durations by 10 to make transitions easier to inspect.</div></div>}
            />
            <ForceQuotaToggle
              checked={!!local.devForceYouTubeQuotaExceeded}
              onChange={v => set('devForceYouTubeQuotaExceeded', v)}
              labelSuffix={dirtyDot('devForceYouTubeQuotaExceeded')}
            />
            <div className="flex flex-col gap-1">
              <Button variant="ghost" size="sm" disabled={backfillState === 'running'} onClick={runThumbnailBackfill}>
                {backfillState === 'running' ? 'Stamping…' : 'Backfill thumbnail sync snapshots'}
              </Button>
              <p className="text-xs text-gray-400">
                One-time: records each <span className="text-gray-300">linked</span> stream's current thumbnail hash as its last-pushed snapshot, so thumbnails that were already up to date on YouTube stop showing as out-of-sync. Only fills in streams that have no snapshot yet — never overwrites a real push. Run this only if you're sure your local thumbnails already match YouTube.
              </p>
              {backfillState !== 'idle' && backfillState !== 'running' && (
                <p className="text-xs text-yellow-600">{backfillState}</p>
              )}
            </div>
          </Section>
        )}
      </div>
      </div>

      {/* Convert dump → folder-per-stream */}
      {convertModalOpen && (
        <Modal
          isOpen
          onClose={() => setConvertModalOpen(false)}
          title="Convert to folder-per-stream"
          width="2xl"
          footer={
            <div className="flex items-center justify-end gap-2 w-full">
              <Button variant="ghost" onClick={() => setConvertModalOpen(false)}>
                {convertStatus === 'done' ? 'Close' : 'Cancel'}
              </Button>
              {convertStatus === 'done' ? (
                <Button
                  variant="secondary"
                  onClick={async () => {
                    if (!convertResult) return
                    setConvertStatus('undoing')
                    setConvertError(null)
                    try {
                      await window.api.undoConvertDumpFolder(convertResult.manifest)
                      await window.api.setConfig({ streamMode: 'dump-folder' })
                      setConvertResult(null)
                      setConvertStatus('undone')
                    } catch (err: any) {
                      setConvertError(err?.message ?? String(err))
                      setConvertStatus('done')
                    }
                  }}
                >
                  Undo conversion
                </Button>
              ) : (
                <Button
                  variant="primary"
                  onClick={async () => {
                    if (!local.streamsDir) return
                    setConvertStatus('converting')
                    setConvertError(null)
                    try {
                      const res = await window.api.convertDumpFolder(local.streamsDir)
                      setConvertResult(res)
                      await window.api.setConfig({ streamMode: 'folder-per-stream' })
                      setConvertStatus('done')
                    } catch (err: any) {
                      setConvertError(err?.message ?? String(err))
                      setConvertStatus('idle')
                    }
                  }}
                  disabled={convertStatus === 'converting' || convertStatus === 'undoing'}
                >
                  {convertStatus === 'converting' ? 'Converting…' : convertStatus === 'undoing' ? 'Undoing…' : 'Update structure'}
                </Button>
              )}
            </div>
          }
        >
          <DumpConvertExplainer />

          {convertStatus === 'done' && convertResult && (
            <div className="mt-5 flex items-start gap-2 text-sm text-green-400 bg-green-400/10 border border-green-400/20 rounded-lg px-4 py-3">
              <CheckCircle size={16} className="shrink-0 mt-0.5" />
              <span>
                Done — {convertResult.manifest.createdFolders.length} folder{convertResult.manifest.createdFolders.length !== 1 ? 's' : ''} created, {convertResult.moved} file{convertResult.moved !== 1 ? 's' : ''} organized.
                {convertResult.skipped > 0 && ` ${convertResult.skipped} file${convertResult.skipped !== 1 ? 's' : ''} with no date in the filename were left in place.`}
              </span>
            </div>
          )}

          {convertStatus === 'undone' && (
            <div className="mt-5 flex items-start gap-2 text-sm text-gray-400 bg-white/5 border border-white/10 rounded-lg px-4 py-3">
              <CheckCircle size={16} className="shrink-0 mt-0.5" />
              <span>Undone — files have been moved back to their original locations.</span>
            </div>
          )}

          {convertError && (
            <div className="mt-5 flex items-start gap-2 text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3">
              <AlertTriangle size={14} className="shrink-0 mt-0.5" />
              <span>{convertError}</span>
            </div>
          )}
        </Modal>
      )}

      {/* Nav-away unsaved-changes prompt. Surfaces only when App has set
          pendingNav (which it only does when this page is dirty). Three
          exits: Save (commit then navigate), Discard (drop local edits
          then navigate), Cancel (stay). Closing via X behaves as Cancel. */}
      {pendingNav && (
        <Modal
          isOpen
          onClose={() => { if (!navSaving) onCancelNav?.() }}
          title="Unsaved changes"
          width="sm"
          dismissible={!navSaving}
          footer={
            <>
              <Button variant="ghost" size="sm" disabled={navSaving} onClick={() => onCancelNav?.()}>
                Cancel
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={navSaving}
                onClick={() => {
                  // Drop unsaved edits — revert local to whatever's in
                  // config — then proceed with the navigation.
                  setLocal(config)
                  onConfirmNav?.(pendingNav)
                }}
                className="text-red-400 hover:text-red-300"
              >
                Discard changes
              </Button>
              <Button
                variant="primary"
                size="sm"
                loading={navSaving}
                onClick={async () => {
                  setNavSaving(true)
                  try {
                    await save()
                    onConfirmNav?.(pendingNav)
                  } catch (err) {
                    console.error('Save before nav failed', err)
                  } finally {
                    setNavSaving(false)
                  }
                }}
              >
                Save & continue
              </Button>
            </>
          }
        >
          <p className="text-sm text-gray-300">
            You have unsaved changes on the Settings page. What would you like to do?
          </p>
        </Modal>
      )}
    </div>
  )
}
