import React, { useEffect, useState } from 'react'
import { FolderOpen, Save, ChevronDown, AlertTriangle, Trash2, Youtube, Twitch, AlertCircle } from 'lucide-react'
import { useStore } from '../../hooks/useStore'
import { Button } from '../ui/Button'
import { Checkbox } from '../ui/Checkbox'
import { Input } from '../ui/Input'
import type { ConversionPreset } from '../../types'

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
  label: string
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
      {hint && <p className="text-xs text-gray-500">{hint}</p>}
    </div>
  )
}

export function SettingsPage() {
  const { config, updateConfig, loading } = useStore()
  const [local, setLocal] = useState(config)
  const [saved, setSaved] = useState(false)
  const [allPresets, setAllPresets] = useState<ConversionPreset[]>([])
  const [thumbnailTemplates, setThumbnailTemplates] = useState<{ name: string; path: string }[]>([])
  const [cacheSize, setCacheSize] = useState<number>(0)
  const [clearingCache, setClearingCache] = useState(false)
  const [ytStatus, setYtStatus] = useState<{ connected: boolean; valid: boolean } | null>(null)
  const [twStatus, setTwStatus] = useState<{ connected: boolean } | null>(null)

  useEffect(() => {
    if (!loading) setLocal(config)
  }, [loading, config])

  useEffect(() => {
    Promise.all([window.api.getBuiltinPresets(), window.api.getImportedPresets()])
      .then(([builtin, imported]) => setAllPresets([...builtin, ...imported]))
  }, [])

  useEffect(() => {
    if (!local.streamsDir) { setThumbnailTemplates([]); return }
    window.api.listStreamTemplates(local.streamsDir).then(setThumbnailTemplates)
  }, [local.streamsDir])

  useEffect(() => {
    window.api.getAudioCacheSize().then(setCacheSize)
  }, [])

  useEffect(() => {
    window.api.youtubeGetStatus().then(async (s: { connected: boolean }) => {
      if (!s.connected) { setYtStatus({ connected: false, valid: false }); return }
      const v = await window.api.youtubeValidateToken().catch(() => ({ valid: false }))
      setYtStatus({ connected: true, valid: v.valid })
    }).catch(() => {})
    window.api.twitchGetStatus?.().then((s: { connected: boolean }) => {
      setTwStatus({ connected: s.connected })
    }).catch(() => {})
  }, [])

  const clearCache = async () => {
    setClearingCache(true)
    await window.api.clearAudioCache()
    setCacheSize(0)
    setClearingCache(false)
  }

  const isDirty = JSON.stringify(local) !== JSON.stringify(config)

  const set = (key: keyof typeof config, value: any) => {
    setLocal(prev => ({ ...prev, [key]: value }))
    setSaved(false)
  }

  const save = async () => {
    await updateConfig(local)
    await window.api.setStartupSettings(!!local.startWithWindows, !!local.startMinimized)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  if (loading) {
    return <div className="flex items-center justify-center h-full text-gray-500 text-sm">Loading…</div>
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 shrink-0">
        <div>
          <h1 className="text-lg font-semibold">Settings</h1>
          <p className="text-xs text-gray-500 mt-0.5">Configure default paths and preferences</p>
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

      <div className="flex-1 overflow-hidden pr-2">
      <div className="h-full overflow-y-auto">
      <div className="p-6 flex flex-col gap-8 max-w-2xl">
        {/* Profile */}
        <section className="flex flex-col gap-4">
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider border-b border-white/5 pb-2">
            Profile
          </h2>
          <Input
            label="Streamer Name"
            value={local.streamerName}
            onChange={e => set('streamerName', e.target.value)}
            placeholder="Your channel name"
            hint="Used to pre-fill your name in stream metadata and integrations"
          />
          {(ytStatus || twStatus) && (
            <div className="flex items-center gap-4">
              {ytStatus && (
                <span className={`flex items-center gap-1.5 text-xs ${
                  ytStatus.connected && ytStatus.valid ? 'text-green-400' :
                  ytStatus.connected && !ytStatus.valid ? 'text-amber-400' :
                  'text-gray-600'
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
                <span className={`flex items-center gap-1.5 text-xs ${twStatus.connected ? 'text-purple-400' : 'text-gray-600'}`}>
                  <Twitch size={18} />
                  {twStatus.connected ? 'Connected' : 'Not connected'}
                </span>
              )}
            </div>
          )}
        </section>

        {/* Directories */}
        <section className="flex flex-col gap-4">
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider border-b border-white/5 pb-2">
            Directories
          </h2>
          <DirInput
            label="Streams Directory"
            value={local.streamsDir}
            onChange={v => set('streamsDir', v)}
            hint="Root folder containing your YYYY-MM-DD stream session folders"
          />
          <DirInput
            label="Default Watch Directory"
            value={local.defaultWatchDir}
            onChange={v => set('defaultWatchDir', v)}
            hint="Where Auto-Rules watch for new files by default"
          />
          <DirInput
            label="Cache Directory"
            value={local.tempDir}
            onChange={v => set('tempDir', v)}
            hint="Where temporary cached files are stored during processing"
          />
        </section>

        {/* Audio Cache */}
        <section className="flex flex-col gap-4">
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider border-b border-white/5 pb-2">
            Cache Files
          </h2>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-gray-300">Cache Limit</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={128}
                step={128}
                value={Math.round((local.audioCacheLimit ?? 1_073_741_824) / (1024 * 1024))}
                onChange={e => set('audioCacheLimit', Math.max(128, parseInt(e.target.value) || 128) * 1024 * 1024)}
                className="w-28 bg-navy-900 border border-white/10 text-gray-200 text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500/50"
              />
              <span className="text-sm text-gray-500">MB</span>
            </div>
            <p className="text-xs text-gray-500">
              Maximum disk space used by cached files. Oldest entries are evicted automatically when the limit is reached.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-500">Currently using {formatBytes(cacheSize)}</span>
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
        </section>

        {/* Streams */}
        <section className="flex flex-col gap-4">
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider border-b border-white/5 pb-2">
            Streams
          </h2>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-gray-300">Default Thumbnail Template</label>
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
              <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
            </div>
            <p className="text-xs text-gray-500">Copied into new stream folders as <span className="font-mono">[date] thumbnail.af</span></p>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-gray-300">Default Archive Preset</label>
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
              <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
            </div>
            {local.archivePresetId && !allPresets.find(p => p.id === local.archivePresetId) && (
              <p className="flex items-center gap-1 text-xs text-yellow-500">
                <AlertTriangle size={11} />
                Selected preset not found — it may have been removed or the presets directory hasn't loaded yet.
              </p>
            )}
            <p className="text-xs text-gray-500">Converter preset used when archiving stream folders from the Streams page. Compresses MKVs in-place and marks them as archived.</p>
          </div>

          <Checkbox
            checked={local.checkEpisodeIteration ?? true}
            onChange={v => set('checkEpisodeIteration', v)}
            label={<div><div className="text-sm font-medium text-gray-200">Check for episode iteration</div><div className="text-xs text-gray-500">When creating a new stream folder, automatically detect and increment the episode number based on previous sessions of the same game</div></div>}
          />

          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-gray-300">
              Clip duration threshold — <span className="text-purple-400 tabular-nums">{Math.round((local.clipDurationThreshold ?? 300) / 60)} min</span>
            </label>
            <input
              type="range"
              min={1} max={30} step={1}
              value={Math.round((local.clipDurationThreshold ?? 300) / 60)}
              onChange={e => set('clipDurationThreshold', parseInt(e.target.value) * 60)}
            />
            <p className="text-xs text-gray-500">Videos at or under this length are classified as clips in the stream video map. Default is 5 minutes.</p>
          </div>
        </section>

        {/* Video Player */}
        <section className="flex flex-col gap-4">
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider border-b border-white/5 pb-2">
            Video Player
          </h2>

          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-gray-300">Default Clip Export Preset</label>
            <div className="relative">
              <select
                value={local.clipPresetId ?? ''}
                onChange={e => set('clipPresetId', e.target.value)}
                className="w-full appearance-none bg-navy-900 border border-white/10 text-gray-200 text-sm rounded-lg px-3 py-2 pr-8 focus:outline-none focus:ring-2 focus:ring-purple-500/50"
              >
                <option value="">— Copy stream (no re-encode) —</option>
                {allPresets.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
            </div>
            {local.clipPresetId && !allPresets.find(p => p.id === local.clipPresetId) && (
              <p className="flex items-center gap-1 text-xs text-yellow-500">
                <AlertTriangle size={11} />
                Selected preset not found — it may have been removed.
              </p>
            )}
            <p className="text-xs text-gray-500">Converter preset used when exporting clips from the player. Leave blank to copy the stream without re-encoding.</p>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-gray-300">
              Default Bleep Volume — <span className="text-purple-400 tabular-nums">{Math.round((local.defaultBleepVolume ?? 0.25) * 100)}%</span>
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
            <div className="flex justify-between text-xs text-gray-600">
              <span>Silent</span>
              <span>100%</span>
              <span>150%</span>
            </div>
            <p className="text-xs text-gray-500">Starting volume for bleep markers in clip mode. Can be adjusted per-session by dragging the line on a marker.</p>
          </div>
        </section>

        {/* Converter */}
        <section className="flex flex-col gap-4">
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider border-b border-white/5 pb-2">
            Converter
          </h2>
          <Checkbox
            checked={!!local.autoDeletePartialOnCancel}
            onChange={v => set('autoDeletePartialOnCancel', v)}
            label={
              <div>
                <div className="text-sm font-medium text-gray-200">Automatically delete partial files on cancel</div>
                <div className="text-xs text-gray-500">When unchecked, you'll be asked each time a conversion is cancelled</div>
              </div>
            }
          />
        </section>

        {/* Appearance */}
        <section className="flex flex-col gap-4">
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider border-b border-white/5 pb-2">
            Appearance
          </h2>
          <Checkbox
            checked={!!local.disableAnimations}
            onChange={v => set('disableAnimations', v)}
            label={
              <div>
                <div className="text-sm font-medium text-gray-200">Disable animations</div>
                <div className="text-xs text-gray-500">Turn off motion animations throughout the app. Also applies automatically if your OS has "Reduce motion" enabled.</div>
              </div>
            }
          />
        </section>

        {/* System */}
        <section className="flex flex-col gap-4">
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider border-b border-white/5 pb-2">
            System
          </h2>
          <Checkbox
            checked={!!local.startWithWindows}
            onChange={v => set('startWithWindows', v)}
            disabled={import.meta.env.DEV}
            label={
              <div>
                <div className="text-sm font-medium text-gray-200">
                  Start with Windows
                  {import.meta.env.DEV && <span className="ml-2 text-xs text-yellow-600 font-normal">(deployable builds only)</span>}
                </div>
                <div className="text-xs text-gray-500">Automatically launch Stream Manager when Windows starts</div>
              </div>
            }
          />
          <Checkbox
            checked={!!local.startMinimized}
            onChange={v => set('startMinimized', v)}
            disabled={import.meta.env.DEV || !local.startWithWindows}
            label={
              <div>
                <div className="text-sm font-medium text-gray-200">Start Minimized</div>
                <div className="text-xs text-gray-500">Hide to tray on launch instead of opening the window</div>
              </div>
            }
          />
        </section>

        {/* Behaviour */}
        <section className="flex flex-col gap-4">
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider border-b border-white/5 pb-2">
            Auto-rules Behaviour
          </h2>
          <Checkbox
            checked={local.autoStartWatcher}
            onChange={v => set('autoStartWatcher', v)}
            label={<div><div className="text-sm font-medium text-gray-200">Auto-start file watcher on launch</div><div className="text-xs text-gray-500">Automatically activate all enabled rules when the app opens</div></div>}
          />
        </section>

        {import.meta.env.DEV && (
          <section className="flex flex-col gap-4">
            <h2 className="text-sm font-semibold text-yellow-600 uppercase tracking-wider border-b border-yellow-600/20 pb-2">
              Dev Tools
            </h2>
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
              <p className="text-xs text-gray-600">Clears streamsDir and streamerName, then reloads the app to trigger the onboarding flow. Not visible in production builds.</p>
            </div>
            <div className="flex flex-col gap-1">
              <Checkbox
                label="Slow down animations (5×)"
                checked={!!local.slowAnimations}
                onChange={v => setLocal(prev => ({ ...prev, slowAnimations: v }))}
              />
              <p className="text-xs text-gray-600">Multiplies all motion animation durations by 10 to make transitions easier to inspect.</p>
            </div>
          </section>
        )}
      </div>
      </div>
      </div>
    </div>
  )
}
