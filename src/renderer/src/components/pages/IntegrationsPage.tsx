import React, { useState, useEffect, useCallback, useRef } from 'react'
import { CheckCircle2, AlertCircle, Loader2, Bot, Eye, EyeOff, ChevronDown, Radio, Copy, Check, WifiOff } from 'lucide-react'
import type { RelayStatus, RelayStats, OrchestratorEvent } from '../../types'
import { Youtube, Twitch } from '../ui/BrandIcons'
import { Button } from '../ui/Button'
import { Checkbox } from '../ui/Checkbox'
import { Textarea } from '../ui/Input'
import { Modal } from '../ui/Modal'
import { Tooltip } from '../ui/Tooltip'
import { useStore } from '../../hooks/useStore'
import { useOnlineStatus } from '../../hooks/useOnlineStatus'
import { quotaColor } from '../../lib/quotaColor'
import { YouTubeImportModal } from '../streams/YouTubeImportModal'
import { YouTubeLinkModal } from '../streams/YouTubeLinkModal'


/** HH:MM:SS for the relay duration (drops the hours segment when zero).
 *  Mirrors the sidebar widget's formatter. */
function srFormatDuration(s: number): string {
  if (!Number.isFinite(s) || s < 0) return '0:00'
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = Math.floor(s % 60)
  const mm = String(m).padStart(2, '0')
  const ss = String(sec).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function IntegrationsPage() {
  const { config, updateConfig } = useStore()
  // OS-level connectivity — drives the offline banner and blocks
  // ENABLING the relay (never disables an already-running session).
  const online = useOnlineStatus()

  // ── YouTube state ─────────────────────────────────────────────────────────
  // Credential inputs bind directly to config (auto-save on every keystroke).
  // No local mirror state and no Save button needed.
  const [ytConnected, setYtConnected] = useState(false)
  const [ytTokenValid, setYtTokenValid] = useState(true)
  const [ytTokenError, setYtTokenError] = useState<string | null>(null)
  // Why the last validation failed: 'auth' = Google rejected the token
  // (genuinely expired/revoked), 'network' = the check itself couldn't
  // reach Google — NOT a token problem, so don't say "expired".
  const [ytTokenIssue, setYtTokenIssue] = useState<'auth' | 'network' | null>(null)
  const [ytConnecting, setYtConnecting] = useState(false)
  const [ytError, setYtError] = useState<string | null>(null)
  const [ytQuota, setYtQuota] = useState<{ exceeded: boolean; resetsAt: string | null; used: number; limit: number } | null>(null)
  const [importModalOpen, setImportModalOpen] = useState(false)
  const [linkModalOpen, setLinkModalOpen] = useState(false)

  // ── Stream Relay ──────────────────────────────────────────────────────────
  // Localhost RTMP server that forwards OBS/Aitum to YouTube. Enable flag,
  // port, and outbound key (channel's persistent stream key) live in
  // electron-store. Live status comes from the main-process RelayManager
  // via IPC subscription so the section can show "Listening / Streaming /
  // Error" without needing to re-poll. Validation gates the enable toggle
  // to "outbound key looks like a YouTube stream key" — the canonical
  // format is four dash-separated 4-char blocks (`xxxx-xxxx-xxxx-xxxx`).
  const [srPort, setSrPort] = useState<string>(String(config.streamRelayPort ?? 1935))
  const [srOutboundKey, setSrOutboundKey] = useState<string>(config.streamRelayOutboundKey ?? '')
  const [srFetchingKey, setSrFetchingKey] = useState(false)
  const [srFetchError, setSrFetchError] = useState<string | null>(null)
  const [srCopied, setSrCopied] = useState<'server' | 'key' | null>(null)
  const [srStatus, setSrStatus] = useState<RelayStatus>({ state: 'idle' })
  const [srStats, setSrStats] = useState<RelayStats | null>(null)
  const [srLifecycle, setSrLifecycle] = useState<OrchestratorEvent | null>(null)
  // "Use custom port" — UI affordance to hide the port field by default.
  // Initialized from current config: if the port differs from the default
  // 1935, the user has clearly customized it and we want the field visible.
  const [srUseCustomPort, setSrUseCustomPort] = useState(() => (config.streamRelayPort ?? 1935) !== 1935)

  // Resync local fields when the saved config changes (e.g. after an external edit).
  useEffect(() => {
    setSrPort(String(config.streamRelayPort ?? 1935))
    setSrOutboundKey(config.streamRelayOutboundKey ?? '')
  }, [config.streamRelayPort, config.streamRelayOutboundKey])

  // Subscribe to live relay status + stats + lifecycle so the card mirrors the
  // sidebar widget (kbps/duration/speed while streaming, lifecycle stage +
  // grace countdown). Cleanup is from the preload subscriber pattern — each
  // `on*` returns its own unsubscribe fn. Stats reset on stream start/stop.
  useEffect(() => {
    window.api.streamRelayGetStatus().then(setSrStatus).catch(() => {})
    const offs = [
      window.api.onRelayStatus(setSrStatus),
      window.api.onRelayStats(setSrStats),
      window.api.onRelayStreamStarted(() => setSrStats(null)),
      window.api.onRelayStreamStopped(() => setSrStats(null)),
      window.api.onRelayLifecycle(setSrLifecycle),
    ]
    return () => { for (const off of offs) off() }
  }, [])

  // Key looks like a YouTube stream key: four 4-char dash-separated blocks.
  // Used to gate the enable toggle; if it doesn't look like a real key, the
  // relay would just fail at YouTube's ingest anyway. Loose match — YouTube
  // has historically used both 4x4 and 5x4 patterns over the years.
  const srOutboundKeyLooksValid = /^[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4,5}(-[a-z0-9]{4,5})?$/i.test(srOutboundKey.trim())

  // Lock configuration fields AND the Enabled checkbox while a stream is
  // actively flowing through the relay — any edit that triggers a ffmpeg
  // rebind (port, outbound key) tears down the live connection, and
  // disabling mid-stream kills the feed with the broadcast still live.
  // Emergency exit if it's ever truly needed: quit SM (ffmpeg dies with it).
  const srIsStreaming = srStatus.state === 'streaming'
  const srFieldsLocked = !ytConnected || srIsStreaming

  const srAutoFillDefaultKey = async () => {
    setSrFetchingKey(true)
    setSrFetchError(null)
    try {
      const res = await window.api.youtubeGetDefaultStreamKey()
      if (!res) {
        setSrFetchError("No stream key found. Make sure your channel has live streaming enabled, then try again.")
        return
      }
      setSrOutboundKey(res.streamName)
      // Persist BOTH the key (what gets pushed into the outbound RTMP URL)
      // and the streamId (what liveBroadcasts.bind needs). Saves the
      // orchestrator a pre-flight lookup at stream start.
      await updateConfig({ streamRelayOutboundKey: res.streamName, streamRelayStreamId: res.streamId })
    } catch (e: any) {
      setSrFetchError(e?.message ?? String(e))
    } finally {
      setSrFetchingKey(false)
    }
  }

  const srSavePort = async () => {
    const n = parseInt(srPort, 10)
    if (!Number.isFinite(n) || n < 1 || n > 65535) return
    await updateConfig({ streamRelayPort: n })
    if (config.streamRelayEnabled) {
      // Apply immediately by reapplying the config — bounces the ffmpeg child
      await window.api.streamRelayReapplyConfig()
    }
  }

  const srToggleEnabled = async (next: boolean) => {
    if (next) {
      // Commit the in-progress port + outbound key values + the enabled flag
      // first so (a) the renderer's local config state reflects the toggle
      // immediately, and (b) the child spawns with current edits, not the
      // last-saved values. The renderer is the source of truth for
      // streamRelayEnabled now — the IPC handlers no longer touch the store.
      const portNum = parseInt(srPort, 10)
      await updateConfig({
        streamRelayPort: Number.isFinite(portNum) && portNum > 0 ? portNum : 1935,
        streamRelayOutboundKey: srOutboundKey.trim(),
        streamRelayEnabled: true,
      })
      await window.api.streamRelayEnable()
    } else {
      await updateConfig({ streamRelayEnabled: false })
      await window.api.streamRelayDisable()
    }
  }

  // Switching off "Use custom port" resets the port to 1935 (and reapplies
  // config if the relay is running so the child rebinds). Switching on is
  // just a UI-visibility flip — the user picks a new value via the input.
  const srTogglePortMode = async (custom: boolean) => {
    setSrUseCustomPort(custom)
    if (!custom) {
      setSrPort('1935')
      await updateConfig({ streamRelayPort: 1935 })
      if (config.streamRelayEnabled) {
        await window.api.streamRelayReapplyConfig()
      }
    }
  }

  const srCopyToClipboard = async (text: string, kind: 'server' | 'key') => {
    try {
      await navigator.clipboard.writeText(text)
      setSrCopied(kind)
      setTimeout(() => setSrCopied(null), 1500)
    } catch { /* clipboard refused — ignore */ }
  }

  // ── Twitch state ──────────────────────────────────────────────────────────
  // Credential inputs bind directly to config (auto-save on every keystroke
  // via updateConfig's optimistic-update path) — no local mirror state and
  // no Save button needed.
  const [twConnected, setTwConnected] = useState(false)
  const [twConnecting, setTwConnecting] = useState(false)
  const [twError, setTwError] = useState<string | null>(null)

  // ── Claude state ──────────────────────────────────────────────────────────
  // API key binds directly to config (single-line input, no perceptible
  // typing lag). The system-prompt textarea is much longer-form, and
  // saving on every keystroke noticeably lagged typing — it now mirrors
  // into local state and commits on blur. Test-key result is local to
  // this session.
  const [claudeTesting, setClaudeTesting] = useState(false)
  const [claudeTestResult, setClaudeTestResult] = useState<{ valid: boolean; error?: string } | null>(null)
  // Mirror the persisted prompt into local state so typing doesn't
  // hit IPC on every keystroke. Resync when the persisted value
  // changes externally (only happens here via Disconnect, but kept
  // robust in case another writer appears).
  const [claudePromptLocal, setClaudePromptLocal] = useState(config.claudeSystemPrompt ?? '')
  useEffect(() => {
    setClaudePromptLocal(config.claudeSystemPrompt ?? '')
  }, [config.claudeSystemPrompt])
  // Models the connected account has access to (free vs. paid tiers differ),
  // fetched from the Anthropic models API so the dropdown only offers valid
  // choices. Loaded on mount (if a key exists) and after a successful test.
  const [claudeModels, setClaudeModels] = useState<Array<{ id: string; displayName: string }>>([])
  const [claudeModelsLoading, setClaudeModelsLoading] = useState(false)
  const [claudeModelsError, setClaudeModelsError] = useState<string | null>(null)
  const loadClaudeModels = useCallback(async (key: string) => {
    const k = key.trim()
    if (!k) { setClaudeModels([]); setClaudeModelsError(null); return }
    setClaudeModelsLoading(true); setClaudeModelsError(null)
    const res = await window.api.claudeListModels(k)
    if (res.ok) setClaudeModels(res.models)
    else setClaudeModelsError(res.error)
    setClaudeModelsLoading(false)
  }, [])

  // ── YouTube instructions toggle ───────────────────────────────────────────
  const [ytInstructionsExpanded, setYtInstructionsExpanded] = useState(false)

  // ── Secret reveal ─────────────────────────────────────────────────────────
  type RevealField = 'yt-secret' | 'tw-secret' | 'claude-key' | 'sr-key'
  const ALL_REVEAL_FIELDS: RevealField[] = ['yt-secret', 'tw-secret', 'claude-key', 'sr-key']
  const [revealed, setRevealed] = useState<Set<RevealField>>(new Set())
  // 'all' is the sentinel for the header "Reveal all" action — the
  // confirmation modal is shared with the per-field reveal.
  const [pendingReveal, setPendingReveal] = useState<RevealField | 'all' | null>(null)

  const requestReveal = (field: RevealField) => {
    if (revealed.has(field)) {
      setRevealed(prev => { const s = new Set(prev); s.delete(field); return s })
    } else {
      setPendingReveal(field)
    }
  }
  const allRevealed = ALL_REVEAL_FIELDS.every(f => revealed.has(f))
  const toggleRevealAll = () => {
    // Hiding needs no confirmation; revealing routes through the warning modal.
    if (allRevealed) setRevealed(new Set())
    else setPendingReveal('all')
  }
  const confirmReveal = () => {
    if (pendingReveal === 'all') setRevealed(new Set(ALL_REVEAL_FIELDS))
    else if (pendingReveal) setRevealed(prev => new Set(prev).add(pendingReveal))
    setPendingReveal(null)
  }

  // Reset test result when the user changes the Claude key — otherwise a
  // stale "valid"/"invalid" badge would linger against a different key.
  useEffect(() => {
    setClaudeTestResult(null)
  }, [config.claudeApiKey])

  const checkYtToken = useCallback(() => {
    window.api.youtubeValidateToken().then(r => {
      setYtTokenValid(r.valid)
      setYtTokenIssue(r.valid ? null : (r.reason ?? 'auth'))
      setYtTokenError(r.valid ? null : (r.error ?? 'Token is invalid'))
    }).catch(() => {})
  }, [])
  useEffect(() => {
    window.api.youtubeGetStatus().then((s: { connected: boolean }) => {
      setYtConnected(s.connected)
      if (!s.connected) return
      checkYtToken()
    }).catch(() => {})
    window.api.twitchGetStatus().then((s: { connected: boolean }) => {
      setTwConnected(s.connected)
    }).catch(() => {})
    const key = (config.claudeApiKey ?? '').trim()
    if (key) loadClaudeModels(key)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // Re-verify the token when connectivity returns — a validation that
  // failed while offline would otherwise stick as a failure until the
  // app restarts. Transition-guarded so mount doesn't double-validate.
  const onlineWasRef = useRef(online)
  useEffect(() => {
    const was = onlineWasRef.current
    onlineWasRef.current = online
    if (!was && online && ytConnected) checkYtToken()
  }, [online, ytConnected, checkYtToken])

  // Live YouTube quota usage — fetch once, then update on every API call
  // (main pushes 'youtube:quota-changed' as usage accrues / resets at PT midnight).
  useEffect(() => {
    window.api.youtubeGetQuotaState().then(setYtQuota).catch(() => {})
    return window.api.onYouTubeQuotaChanged(setYtQuota)
  }, [])

  // ── YouTube actions ───────────────────────────────────────────────────────
  const connectYt = async () => {
    setYtConnecting(true); setYtError(null)
    try {
      await window.api.youtubeConnect()
      setYtConnected(true)
      setYtTokenValid(true)
      setYtTokenError(null)
      setYtTokenIssue(null)
    }
    catch (e: any) { setYtError(e.message) }
    finally { setYtConnecting(false) }
  }
  const disconnectYt = async () => {
    await window.api.youtubeDisconnect()
    setYtConnected(false)
    setYtTokenValid(true)
    setYtTokenError(null)
    setYtTokenIssue(null)
  }

  // ── Claude actions ────────────────────────────────────────────────────────
  const disconnectClaude = async () => {
    await updateConfig({ claudeApiKey: '', claudeSystemPrompt: '', claudeModel: '' })
    setClaudeTestResult(null)
    setClaudeModels([])
    setClaudeModelsError(null)
  }
  const testClaudeKey = async () => {
    const key = (config.claudeApiKey ?? '').trim()
    if (!key) return
    setClaudeTesting(true); setClaudeTestResult(null)
    const result = await window.api.claudeTestKey(key)
    setClaudeTestResult(result)
    setClaudeTesting(false)
    if (result.valid) loadClaudeModels(key)
  }

  // ── Twitch actions ────────────────────────────────────────────────────────
  const connectTw = async () => {
    setTwConnecting(true); setTwError(null)
    try { await window.api.twitchConnect(); setTwConnected(true) }
    catch (e: any) { setTwError(e.message) }
    finally { setTwConnecting(false) }
  }
  const disconnectTw = async () => { await window.api.twitchDisconnect(); setTwConnected(false) }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-white/5 shrink-0">
        <div>
          <h1 className="text-lg font-semibold">Integrations</h1>
          <p className="text-xs text-gray-400 mt-0.5">Connect and manage your streaming platform accounts.</p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          className="ml-auto"
          onClick={toggleRevealAll}
          icon={allRevealed ? <EyeOff size={13} /> : <Eye size={13} />}
        >
          {allRevealed ? 'Hide all' : 'Reveal all'}
        </Button>
      </div>

      <div className="flex-1 overflow-hidden pr-2">
      <div className="h-full overflow-y-auto">
      <div className="flex flex-col gap-6 p-4">

        {/* Offline notice — everything on this page needs internet
            (OAuth flows, API calls, the relay's push to YouTube). */}
        {!online && (
          <div className="flex items-start gap-2 text-[11px] bg-amber-500/10 border border-amber-500/30 text-amber-200 rounded-md px-3 py-2">
            <WifiOff size={13} className="shrink-0 mt-0.5" />
            <div className="flex-1">
              <div className="font-medium">No internet connection</div>
              <div className="text-amber-200/80 mt-0.5">
                Connecting accounts, syncing, and streaming through the relay need internet. This clears on its own once the connection is restored.
              </div>
            </div>
          </div>
        )}

        {/* ── YouTube ─────────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 px-1">
            <Youtube size={16} className="text-red-400 shrink-0" />
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">YouTube</span>
            <span className={`ml-auto text-xs font-medium ${
              !online ? 'text-amber-400' :
              ytConnected && ytTokenValid ? 'text-green-400' :
              ytConnected && !ytTokenValid ? 'text-amber-400' :
              'text-gray-400'
            }`}>
              {!online ? 'Offline' :
               ytConnected && ytTokenValid ? 'Connected' :
               ytConnected && ytTokenIssue === 'network' ? 'Can’t reach YouTube' :
               ytConnected && !ytTokenValid ? 'Token expired' :
               'Not connected'}
            </span>
          </div>

          {/* Token expired banner — genuine auth failures only. A check
              that failed for network reasons says nothing about the
              token, and the Reconnect flow can't help (or even run)
              without internet. */}
          {online && ytConnected && !ytTokenValid && ytTokenIssue === 'auth' && (
            <div className="flex items-start gap-3 px-4 py-3 rounded-lg bg-amber-500/10 border border-amber-500/30">
              <AlertCircle size={15} className="text-amber-400 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-amber-300">YouTube token expired</p>
                <p className="text-xs text-amber-400/70 mt-0.5">{ytTokenError ?? 'The stored token is no longer valid.'} Reconnect to restore access.</p>
              </div>
              <Button variant="primary" size="sm" onClick={connectYt} disabled={ytConnecting}
                icon={ytConnecting ? <Loader2 size={13} className="animate-spin" /> : <Youtube size={13} />}>
                {ytConnecting ? 'Connecting…' : 'Reconnect'}
              </Button>
            </div>
          )}

          {/* API quota usage (estimated) */}
          {ytConnected && ytQuota && (
            <div className="bg-navy-800 border border-white/5 rounded-lg overflow-hidden">
              <div className="px-4 py-2.5 border-b border-white/5 flex items-center gap-2">
                <span className="text-xs font-medium text-gray-400">API quota used today</span>
                <span
                  className="ml-auto text-xs font-mono font-medium tabular-nums"
                  style={{ color: quotaColor(ytQuota.used / ytQuota.limit) }}
                >
                  {ytQuota.used.toLocaleString()} / {ytQuota.limit.toLocaleString()}
                </span>
              </div>
              <div className="px-4 py-3 flex flex-col gap-2">
                <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${Math.min(100, (ytQuota.used / ytQuota.limit) * 100)}%`,
                      backgroundColor: quotaColor(ytQuota.used / ytQuota.limit),
                    }}
                  />
                </div>
                <p className="text-[11px] text-gray-400 leading-relaxed">
                  Estimated YouTube Data API units used today against the default 10,000-unit daily
                  limit. Reads cost ~1 unit, writes ~50. This is an estimate and resets at midnight
                  Pacific Time.
                </p>
              </div>
            </div>
          )}

          {/* Import from YouTube — requires folder-per-stream mode (dump mode has
              no per-stream folders to organize recordings into). */}
          {ytConnected && ytTokenValid && (
            <div className="bg-navy-800 border border-white/5 rounded-lg px-4 py-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-gray-300">Import from YouTube</p>
                <p className="text-[11px] text-gray-400 mt-0.5">
                  {config.streamMode === 'dump-folder'
                    ? 'Unavailable in dump-folder mode — switch to folder-per-stream so each import gets its own folder for recordings.'
                    : 'Create new stream items from your videos, or link videos to existing streams. Details + thumbnail only, not the video files.'}
                </p>
              </div>
              <Button size="sm" variant="ghost" disabled={config.streamMode === 'dump-folder'} onClick={() => setLinkModalOpen(true)}>Link existing…</Button>
              <Button size="sm" variant="ghost" disabled={config.streamMode === 'dump-folder'} onClick={() => setImportModalOpen(true)}>Import new…</Button>
            </div>
          )}
          <YouTubeImportModal isOpen={importModalOpen} onClose={() => setImportModalOpen(false)} />
          <YouTubeLinkModal isOpen={linkModalOpen} onClose={() => setLinkModalOpen(false)} />

          {/* YT Credentials */}
          <div className="bg-navy-800 border border-white/5 rounded-lg overflow-hidden">
            <div className="px-4 py-2.5 border-b border-white/5">
              <span className="text-xs font-medium text-gray-400">Google API Credentials</span>
            </div>
            <div className="px-4 py-4 flex flex-col gap-4">
              <div className="flex flex-col gap-2.5 text-xs text-gray-400 leading-relaxed">
                <p>
                  To connect YouTube, you need OAuth 2.0 credentials from the{' '}
                  <button onClick={() => window.api.openUrl('https://console.cloud.google.com')} className="text-purple-400 hover:text-purple-300 hover:underline transition-colors">Google Cloud Console</button>.
                  Credentials are stored locally only and never shared.
                  See Google's{' '}
                  <button onClick={() => window.api.openUrl('https://developers.google.com/youtube/registering_an_application')} className="text-purple-400 hover:text-purple-300 hover:underline transition-colors">registration guide</button>
                  {' '}for more detail.
                </p>
                {(!ytConnected || !ytTokenValid || ytInstructionsExpanded) && (
                  <ol className="flex flex-col gap-1.5 list-decimal list-inside marker:text-gray-500">
                    <li>In the Cloud Console, create a new project (or select an existing one).</li>
                    <li>
                      Go to{' '}
                      <button onClick={() => window.api.openUrl('https://console.cloud.google.com/apis/library/youtube.googleapis.com')} className="text-purple-400 hover:text-purple-300 hover:underline transition-colors">APIs &amp; Services → Library</button>
                      , search for <span className="text-gray-300">YouTube Data API v3</span>, and enable it.
                    </li>
                    <li>
                      Go to{' '}
                      <button onClick={() => window.api.openUrl('https://console.cloud.google.com/apis/credentials/consent')} className="text-purple-400 hover:text-purple-300 hover:underline transition-colors">OAuth consent screen</button>.
                      Set User Type to <span className="text-gray-300">External</span>, fill in the required app name and email fields, then add your Google account as a <span className="text-gray-300">Test user</span>. You do not need to submit for verification.
                    </li>
                    <li>
                      Go to{' '}
                      <button onClick={() => window.api.openUrl('https://console.cloud.google.com/apis/credentials')} className="text-purple-400 hover:text-purple-300 hover:underline transition-colors">Credentials</button>
                      {' '}→ <span className="text-gray-300">Create Credentials → OAuth client ID</span>. Set Application type to <span className="text-gray-300">Web application</span>.
                    </li>
                    <li>
                      Under <span className="text-gray-300">Authorised redirect URIs</span>, add:{' '}
                      <span className="font-mono text-gray-300 select-all">http://localhost:42813/oauth2callback</span>
                    </li>
                    <li>Copy the generated Client ID and Client Secret into the fields below.</li>
                  </ol>
                )}
                {ytConnected && ytTokenValid && (
                  <button
                    onClick={() => setYtInstructionsExpanded(v => !v)}
                    className="flex items-center gap-1.5 text-gray-400 hover:text-gray-300 transition-colors self-start"
                  >
                    <ChevronDown size={13} className={`transition-transform duration-150 ${ytInstructionsExpanded ? 'rotate-180' : ''}`} />
                    {ytInstructionsExpanded ? 'Hide setup instructions' : 'Show setup instructions'}
                  </button>
                )}
              </div>
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-gray-400">Client ID</label>
                  <input
                    value={config.youtubeClientId ?? ''}
                    onChange={e => updateConfig({ youtubeClientId: e.target.value })}
                    placeholder="…apps.googleusercontent.com"
                    className="w-full bg-navy-900 border border-white/10 text-gray-200 text-xs font-mono rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-gray-400">Client Secret</label>
                  <div className="relative">
                    <input
                      type={revealed.has('yt-secret') ? 'text' : 'password'}
                      value={config.youtubeClientSecret ?? ''}
                      onChange={e => updateConfig({ youtubeClientSecret: e.target.value })}
                      placeholder="GOCSPX-…"
                      className="w-full bg-navy-900 border border-white/10 text-gray-200 text-xs font-mono rounded-lg px-3 py-2 pr-8 focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                    />
                    <button onClick={() => requestReveal('yt-secret')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-400 transition-colors">
                      {revealed.has('yt-secret') ? <EyeOff size={13} /> : <Eye size={13} />}
                    </button>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {!ytConnected
                  ? <Button variant="primary" size="sm" onClick={connectYt} disabled={!config.youtubeClientId || !config.youtubeClientSecret || ytConnecting}
                      icon={ytConnecting ? <Loader2 size={13} className="animate-spin" /> : <Youtube size={13} />}>
                      {ytConnecting ? 'Connecting…' : 'Connect to YouTube'}
                    </Button>
                  : <Button variant="danger" size="sm" onClick={disconnectYt}>Disconnect</Button>
                }
              </div>
              {ytConnecting && (
                <p className="text-xs text-yellow-400/80 flex items-center gap-1.5">
                  <AlertCircle size={12} />
                  A Google sign-in page has opened in your browser — complete the sign-in there to continue.
                </p>
              )}
              {ytError && <p className="text-xs text-red-400 flex items-center gap-1.5"><AlertCircle size={12} />{ytError}</p>}
            </div>
          </div>

          {/* ── Stream Relay ─────────────────────────────────────────────────
              Sub-card under YouTube because the relay is YouTube-specific.
              Gated by YouTube connection — the Enable toggle disables when
              not connected so users can't turn the feature on before the
              channel default key can be auto-fetched. */}
          <div className="bg-navy-800 border border-white/5 rounded-lg overflow-hidden">
            {/* Card header: title on the left, live status + Enabled checkbox on the right */}
            <div className="px-4 py-2.5 border-b border-white/5 flex items-center gap-3">
              <Radio size={12} className="text-purple-400 shrink-0" />
              <span className="text-xs font-medium text-gray-400">Stream Relay</span>
              {/* Status pill always renders so the user has a clear "Off"
                  affordance when the feature is disabled. When enabled, the
                  pill tracks the manager's live state. */}
              <span className={`text-[11px] font-medium ${
                !config.streamRelayEnabled ? 'text-gray-400' :
                srStatus.state === 'streaming' ? 'text-green-400' :
                srStatus.state === 'listening' ? 'text-gray-200' :
                srStatus.state === 'starting' || srStatus.state === 'restarting' ? 'text-amber-400' :
                srStatus.state === 'error' ? 'text-red-400' :
                'text-gray-400'
              }`}>
                {!config.streamRelayEnabled ? '○ Off' :
                 srStatus.state === 'streaming' ? '● Streaming' :
                 srStatus.state === 'listening' ? '● Listening' :
                 srStatus.state === 'starting' ? '● Starting…' :
                 srStatus.state === 'restarting' ? '● Restarting…' :
                 srStatus.state === 'error' ? '● Error' :
                 '○ Off'}
              </span>
              <div className="ml-auto">
                <Tooltip
                  content={srIsStreaming
                    ? 'Streaming through the relay right now. Stop your encoder first.'
                    : 'No internet connection.'}
                  open={srIsStreaming || (!online && !config.streamRelayEnabled) ? undefined : false}
                >
                  <Checkbox
                    size="sm"
                    checked={config.streamRelayEnabled}
                    onChange={srToggleEnabled}
                    // Offline blocks ENABLING only — turning the relay
                    // off (or an already-enabled one) stays available,
                    // and a running session is never touched.
                    disabled={!ytConnected || srIsStreaming || (!config.streamRelayEnabled && (!srOutboundKeyLooksValid || !online))}
                    label="Enabled"
                  />
                </Tooltip>
              </div>
            </div>
            {/* Live activity strip — mirrors the sidebar widget so the user
                gets the same lifecycle stage + stats while the setup page is
                open during their first stream. Only renders when enabled and
                there's something transitional/streaming to show. */}
            {config.streamRelayEnabled && (() => {
              const lc = srLifecycle
              const streaming = srStatus.state === 'streaming'
              const transitional = lc && (lc.stage === 'binding' || lc.stage === 'waiting-for-ingest' || lc.stage === 'going-live')
              const lifecycleMsg =
                lc?.stage === 'binding' ? `Connecting broadcast${lc.broadcastTitle ? `: ${lc.broadcastTitle}` : '…'}` :
                lc?.stage === 'waiting-for-ingest' ? 'Waiting for YouTube to receive stream…' :
                lc?.stage === 'going-live' ? `Going live${lc.broadcastTitle ? ` as ${lc.broadcastTitle}` : '…'}` :
                lc?.stage === 'grace' ? `Finalizing in ${lc.graceRemainingSec ?? 30}s…` :
                lc?.stage === 'completing' ? 'Finalizing broadcast…' :
                (lc?.stage === 'no-broadcast' && streaming) ? 'Streaming without a bound broadcast (YouTube will auto-create one).' :
                null
              const errorMsg = lc?.stage === 'error' ? lc.error
                : (srStatus.state === 'error' ? srStatus.error : undefined)
              const showStats = streaming && srStats && !transitional
              if (!lifecycleMsg && !showStats && !errorMsg) return null
              return (
                <div className="px-4 py-2 border-b border-white/5 flex flex-wrap items-center gap-x-3 gap-y-1">
                  {lifecycleMsg && (
                    <span className={`text-[11px] tabular-nums ${lc?.stage === 'no-broadcast' ? 'text-gray-400' : 'text-amber-400'}`}>
                      {lifecycleMsg}
                    </span>
                  )}
                  {showStats && (
                    <span className="flex items-center gap-2 text-[11px] text-gray-400 tabular-nums">
                      <span>{Math.round(srStats!.kbps)} kbps</span>
                      <span>·</span>
                      <span>{srFormatDuration(srStats!.durationSec)}</span>
                      {srStats!.speed < 0.97 && <span className="text-amber-400">· {srStats!.speed.toFixed(2)}x</span>}
                    </span>
                  )}
                  {errorMsg && <span className="text-[11px] text-red-400 leading-tight">{errorMsg}</span>}
                </div>
              )
            })()}
            <div className="px-4 py-4 flex flex-col gap-4">
              <p className="text-xs text-gray-400 leading-relaxed">
                Routes your stream to YouTube with the option to automatically connect to the next scheduled
                broadcast in Stream Manager.
              </p>

              {/* Disconnected gate */}
              {!ytConnected && (
                <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-xs text-amber-300">
                  <AlertCircle size={12} className="shrink-0 mt-0.5" />
                  <span>Connect YouTube above to set up Stream Relay.</span>
                </div>
              )}

              {/* Streaming-software config display — bold copyable text rows.
                  The whole row is clickable; the icon sits next to the text
                  rather than at the far right edge so it's clear what the
                  click target encompasses. */}
              <div className="flex flex-col gap-2">
                <span className="text-xs font-medium text-gray-400">In your streaming software (OBS, etc.), configure a custom output:</span>
                <div className="flex flex-col gap-0.5">
                  <Tooltip content="Click to copy" triggerClassName="self-start">
                  <button
                    onClick={() => srCopyToClipboard(`rtmp://localhost:${srPort || 1935}/sm`, 'server')}
                    className="group flex items-center gap-3 px-2 py-1 rounded hover:bg-white/5 transition-colors text-left"
                  >
                    <span className="text-xs text-gray-400 w-20 shrink-0">Server URL</span>
                    <code className="font-mono text-xs font-semibold text-gray-200 select-all">
                      rtmp://localhost:{srPort || 1935}/sm
                    </code>
                    {srCopied === 'server'
                      ? <Check size={12} className="text-green-400 shrink-0" />
                      : <Copy size={12} className="text-gray-400 group-hover:text-gray-200 transition-colors shrink-0" />}
                  </button>
                  </Tooltip>
                  <Tooltip content="Click to copy" triggerClassName="self-start">
                  <button
                    onClick={() => srCopyToClipboard(config.streamRelayInboundKey || 'live', 'key')}
                    className="group flex items-center gap-3 px-2 py-1 rounded hover:bg-white/5 transition-colors text-left"
                  >
                    <span className="text-xs text-gray-400 w-20 shrink-0">Stream Key</span>
                    <code className="font-mono text-xs font-semibold text-gray-200 select-all">
                      {config.streamRelayInboundKey || 'live'}
                    </code>
                    {srCopied === 'key'
                      ? <Check size={12} className="text-green-400 shrink-0" />
                      : <Copy size={12} className="text-gray-400 group-hover:text-gray-200 transition-colors shrink-0" />}
                  </button>
                  </Tooltip>
                </div>
              </div>

              {/* Streaming-lock notice */}
              {srIsStreaming && (
                <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-blue-500/10 border border-blue-500/30 text-xs text-blue-300">
                  <AlertCircle size={12} className="shrink-0 mt-0.5" />
                  <span>A stream is currently flowing through the relay — config fields are locked. Stop streaming to make changes.</span>
                </div>
              )}

              {/* Custom port — placed AFTER the streaming-software section so
                  if the user toggles a custom port, the URL preview above
                  is the next thing they look at for confirmation. */}
              <div className="flex flex-col gap-1.5">
                <Checkbox
                  size="sm"
                  checked={srUseCustomPort}
                  onChange={srTogglePortMode}
                  disabled={srFieldsLocked}
                  label="Use custom port"
                />
                {srUseCustomPort && (
                  <div className="flex flex-col gap-1 pl-6">
                    <input
                      type="number"
                      min={1}
                      max={65535}
                      value={srPort}
                      onChange={e => setSrPort(e.target.value)}
                      onBlur={srSavePort}
                      disabled={srFieldsLocked}
                      className="w-24 bg-navy-900 border border-white/10 text-gray-200 text-xs font-mono rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500/50 disabled:opacity-50 disabled:cursor-not-allowed"
                    />
                    <p className="text-xs text-gray-400">RTMP's default is 1935. Change only if it conflicts with something else on your machine.</p>
                  </div>
                )}
              </div>

              {/* Outbound key (YouTube channel default) */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-gray-400">YouTube channel default stream key</label>
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <input
                      type={revealed.has('sr-key') ? 'text' : 'password'}
                      value={srOutboundKey}
                      onChange={e => setSrOutboundKey(e.target.value)}
                      onBlur={() => {
                        const trimmed = srOutboundKey.trim()
                        // If the user pasted/edited the key, the cached streamId
                        // probably no longer matches. Clear it so the
                        // orchestrator does a fresh lookup on next stream-start.
                        const cleared = trimmed !== (config.streamRelayOutboundKey ?? '')
                        updateConfig(
                          cleared
                            ? { streamRelayOutboundKey: trimmed, streamRelayStreamId: '' }
                            : { streamRelayOutboundKey: trimmed },
                        )
                      }}
                      placeholder="xxxx-xxxx-xxxx-xxxx"
                      disabled={srFieldsLocked}
                      className="w-full bg-navy-900 border border-white/10 text-gray-200 text-xs font-mono rounded-lg px-3 py-2 pr-8 focus:outline-none focus:ring-2 focus:ring-purple-500/50 disabled:opacity-50 disabled:cursor-not-allowed"
                    />
                    <button
                      onClick={() => requestReveal('sr-key')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-400 transition-colors"
                    >
                      {revealed.has('sr-key') ? <EyeOff size={13} /> : <Eye size={13} />}
                    </button>
                  </div>
                  <Tooltip content="Fetch your channel's default ingestion key from YouTube and fill the field for you.">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={srAutoFillDefaultKey}
                      disabled={srFieldsLocked || srFetchingKey}
                      icon={srFetchingKey ? <Loader2 size={13} className="animate-spin" /> : undefined}
                    >
                      {srFetchingKey ? 'Fetching…' : 'Auto-fill'}
                    </Button>
                  </Tooltip>
                </div>
                <p className="text-xs text-gray-400">
                  The persistent key for your channel's default ingestion stream. Click Auto-fill to grab it from YouTube,
                  or paste it manually from YT Studio → Stream → Stream Key.
                </p>
                {srOutboundKey && !srOutboundKeyLooksValid && (
                  <p className="text-xs text-amber-400 flex items-center gap-1.5 mt-0.5"><AlertCircle size={11} />Doesn't look like a YouTube key</p>
                )}
                {srFetchError && (
                  <p className="text-xs text-red-400 flex items-start gap-1.5 mt-0.5">
                    <AlertCircle size={11} className="shrink-0 mt-0.5" />
                    <span>{srFetchError}</span>
                  </p>
                )}
              </div>

              {/* Live error from manager */}
              {srStatus.state === 'error' && srStatus.error && (
                <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-300">
                  <AlertCircle size={12} className="shrink-0 mt-0.5" />
                  <span>{srStatus.error}</span>
                </div>
              )}
            </div>
          </div>

        </div>

        {/* ── Twitch ───────────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 px-1">
            <Twitch size={16} className="text-twitch-400 shrink-0" />
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Twitch</span>
            <span className={`ml-auto text-xs font-medium ${
              !online ? 'text-amber-400' : twConnected ? 'text-green-400' : 'text-gray-400'
            }`}>
              {!online ? 'Offline' : twConnected ? 'Connected' : 'Not connected'}
            </span>
          </div>

          {/* Twitch Credentials */}
          <div className="bg-navy-800 border border-white/5 rounded-lg overflow-hidden">
            <div className="px-4 py-2.5 border-b border-white/5">
              <span className="text-xs font-medium text-gray-400">Twitch API Credentials</span>
            </div>
            <div className="px-4 py-4 flex flex-col gap-4">
              <p className="text-xs text-gray-400 leading-relaxed">
                Create an application at{' '}
                <button onClick={() => window.api.openUrl('https://dev.twitch.tv/console')}
                  className="font-mono text-purple-400 hover:text-purple-300 hover:underline transition-colors">
                  dev.twitch.tv/console
                </button>
                {' '}using <strong className="text-gray-300">Confidential</strong> as the Client Type,
                and add the following as a redirect URL:{' '}
                <span className="font-mono text-gray-400 select-all">http://localhost:42814/oauth2callback</span>
                {' '}Stored locally only.
              </p>
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-gray-400">Client ID</label>
                  <input
                    value={config.twitchClientId ?? ''}
                    onChange={e => updateConfig({ twitchClientId: e.target.value })}
                    placeholder="Twitch Client ID"
                    className="w-full bg-navy-900 border border-white/10 text-gray-200 text-xs font-mono rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-gray-400">Client Secret</label>
                  <div className="relative">
                    <input
                      type={revealed.has('tw-secret') ? 'text' : 'password'}
                      value={config.twitchClientSecret ?? ''}
                      onChange={e => updateConfig({ twitchClientSecret: e.target.value })}
                      placeholder="Twitch Client Secret"
                      className="w-full bg-navy-900 border border-white/10 text-gray-200 text-xs font-mono rounded-lg px-3 py-2 pr-8 focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                    />
                    <button onClick={() => requestReveal('tw-secret')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-400 transition-colors">
                      {revealed.has('tw-secret') ? <EyeOff size={13} /> : <Eye size={13} />}
                    </button>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {!twConnected
                  ? <Button variant="primary" size="sm" onClick={connectTw} disabled={!config.twitchClientId || !config.twitchClientSecret || twConnecting}
                      icon={twConnecting ? <Loader2 size={13} className="animate-spin" /> : <Twitch size={13} />}
                      className="bg-purple-600 hover:bg-purple-500">
                      {twConnecting ? 'Connecting…' : 'Connect to Twitch'}
                    </Button>
                  : <Button variant="danger" size="sm" onClick={disconnectTw}>Disconnect</Button>
                }
              </div>
              {twConnecting && (
                <p className="text-xs text-yellow-400/80 flex items-center gap-1.5">
                  <AlertCircle size={12} />
                  A Twitch sign-in page has opened in your browser — complete the sign-in there to continue.
                </p>
              )}
              {twError && <p className="text-xs text-red-400 flex items-center gap-1.5"><AlertCircle size={12} />{twError}</p>}

              {/* Post-stream Twitch behavior — divider keeps it visually
                  grouped with the connection block above. Disabled when
                  Twitch isn't connected, but the option is visible so
                  users discover it exists. Tri-state: Always silently
                  pushes, Ask shows the post-stream modal, Never skips
                  entirely. Mirrors the buttons shown inside the modal. */}
              <div className="pt-3 border-t border-white/5 flex flex-col gap-2">
                <div>
                  <div className="text-sm font-medium text-gray-200">After a stream ends, push the next stream's Twitch details</div>
                  <div className="text-xs text-gray-400">When a SM-orchestrated stream completes, the next-upcoming stream item's title, game, and tags can be pushed to your Twitch channel.</div>
                </div>
                <div className="flex items-center gap-1.5">
                  {([
                    { value: 'always' as const, label: 'Always', desc: 'Push silently after every stream' },
                    { value: 'ask' as const,    label: 'Ask',    desc: 'Show a confirmation modal each time' },
                    { value: 'never' as const,  label: 'Never',  desc: "Don't push, don't ask" },
                  ]).map(({ value, label, desc }) => {
                    const active = (config.autoUpdateTwitchAfterStream ?? 'ask') === value
                    return (
                      <Tooltip key={value} content={desc}>
                        <button
                          type="button"
                          disabled={!twConnected}
                          onClick={() => updateConfig({ autoUpdateTwitchAfterStream: value })}
                          className={`flex items-center justify-center px-3 py-1 rounded-lg text-xs font-medium border transition-colors ${
                            active
                              ? 'bg-purple-600/25 border-purple-500/40 text-purple-200'
                              : 'bg-white/5 border-white/10 text-gray-400 hover:bg-white/10 hover:text-gray-200'
                          } disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-white/5 disabled:hover:text-gray-400`}
                        >
                          {label}
                        </button>
                      </Tooltip>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Claude AI ───────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 px-1">
            <Bot size={16} className="text-orange-400 shrink-0" />
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Claude AI</span>
            <span className={`ml-auto text-xs font-medium ${
              !online ? 'text-amber-400' : config.claudeApiKey ? 'text-green-400' : 'text-gray-400'
            }`}>
              {!online ? 'Offline' : config.claudeApiKey ? 'Connected' : 'Not connected'}
            </span>
          </div>

          <div className="bg-navy-800 border border-white/5 rounded-lg overflow-hidden">
            <div className="px-4 py-2.5 border-b border-white/5">
              <span className="text-xs font-medium text-gray-400">Claude API</span>
            </div>
            <div className="px-4 py-4 flex flex-col gap-4">
              <p className="text-xs text-gray-400 leading-relaxed">
                Connect your Anthropic API key to enable AI-generated suggestions for stream titles, descriptions, and tags.
                Get a key at <button onClick={() => window.api.openUrl('https://console.anthropic.com')} className="text-purple-400 font-mono hover:text-purple-300 hover:underline transition-colors">console.anthropic.com</button>. Stored locally only.
              </p>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-gray-400">API Key</label>
                <div className="relative">
                  <input
                    type={revealed.has('claude-key') ? 'text' : 'password'}
                    value={config.claudeApiKey ?? ''}
                    onChange={e => updateConfig({ claudeApiKey: e.target.value })}
                    placeholder="sk-ant-…"
                    className="w-full bg-navy-900 border border-white/10 text-gray-200 text-xs font-mono rounded-lg px-3 py-2 pr-8 focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                  />
                  <button onClick={() => requestReveal('claude-key')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-400 transition-colors">
                    {revealed.has('claude-key') ? <EyeOff size={13} /> : <Eye size={13} />}
                  </button>
                </div>
              </div>
              {(config.claudeApiKey ?? '').trim() && (
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-gray-400">Model</label>
                  <div className="relative">
                    <select
                      value={config.claudeModel ?? ''}
                      onChange={e => updateConfig({ claudeModel: e.target.value })}
                      className="w-full appearance-none bg-navy-900 border border-white/10 text-gray-200 text-xs rounded-lg px-3 py-2 pr-8 focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                    >
                      <option value="">Default (Claude Sonnet 4.6)</option>
                      {/* Stored model that isn't in the fetched list (not loaded
                          yet, or access changed) — keep it selectable so the
                          dropdown reflects the saved value. */}
                      {(config.claudeModel ?? '').trim() && !claudeModels.some(m => m.id === config.claudeModel) && (
                        <option value={config.claudeModel}>{config.claudeModel}</option>
                      )}
                      {claudeModels.map(m => (
                        <option key={m.id} value={m.id}>{m.displayName}</option>
                      ))}
                    </select>
                    <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                  </div>
                  <p className="text-xs text-gray-400 flex items-center gap-1.5">
                    {claudeModelsLoading
                      ? <><Loader2 size={11} className="animate-spin" /> Loading available models…</>
                      : claudeModelsError
                        ? <span className="text-amber-400">Couldn’t load model list ({claudeModelsError}). Showing your saved choice — test the connection to retry.</span>
                        : <>Only models your account can access are listed. Stronger models (Sonnet 4.6, Opus 4.8) give better suggestions, especially tags.</>}
                  </p>
                </div>
              )}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-gray-400">
                  Preferences / System Prompt
                  <span className="text-gray-400 font-normal ml-1">(optional)</span>
                </label>
                <Textarea
                  value={claudePromptLocal}
                  onChange={e => setClaudePromptLocal(e.target.value)}
                  onBlur={() => {
                    if (claudePromptLocal !== (config.claudeSystemPrompt ?? '')) {
                      updateConfig({ claudeSystemPrompt: claudePromptLocal })
                    }
                  }}
                  rows={4}
                  placeholder="e.g. I stream horror games. Keep titles under 60 characters. Always include the episode number. My channel tagline is …"
                  className="text-xs"
                />
                <p className="text-xs text-gray-400">Tell Claude about your channel, content style, or any preferences for how suggestions should be worded.</p>
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                <Button variant="secondary" size="sm" onClick={testClaudeKey}
                  disabled={!(config.claudeApiKey ?? '').trim() || claudeTesting}
                  icon={claudeTesting ? <Loader2 size={13} className="animate-spin" /> : undefined}>
                  {claudeTesting ? 'Testing…' : 'Test connection'}
                </Button>
                {config.claudeApiKey && (
                  <Button variant="danger" size="sm" onClick={disconnectClaude}>Disconnect</Button>
                )}
                {claudeTestResult && (
                  claudeTestResult.valid
                    ? <span className="flex items-center gap-1.5 text-xs text-green-400"><CheckCircle2 size={13} /> Connected</span>
                    : <span className="flex items-center gap-1.5 text-xs text-red-400"><AlertCircle size={13} /> {claudeTestResult.error ?? 'Invalid key'}</span>
                )}
              </div>
            </div>
          </div>
        </div>

      </div>
      </div>
      </div>

      {/* Reveal warning */}
      <Modal
        isOpen={pendingReveal !== null}
        onClose={() => setPendingReveal(null)}
        title={pendingReveal === 'all' ? 'Reveal all sensitive values?' : 'Reveal sensitive value?'}
        width="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPendingReveal(null)}>Cancel</Button>
            <Button variant="primary" onClick={confirmReveal}>{pendingReveal === 'all' ? 'Reveal all' : 'Reveal'}</Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <p className="text-sm text-gray-300 leading-relaxed">
            {pendingReveal === 'all'
              ? 'These values are sensitive and should be kept private.'
              : 'This value is sensitive and should be kept private.'}
          </p>
          <ul className="flex flex-col gap-1.5 text-xs text-gray-400 leading-relaxed list-disc list-inside marker:text-gray-600">
            <li>Never share this with anyone.</li>
            <li>Make sure you are not currently streaming or recording your screen.</li>
            <li>Close this view when you are done.</li>
          </ul>
        </div>
      </Modal>

    </div>
  )
}
