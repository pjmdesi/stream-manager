import React, { useState, useEffect } from 'react'
import { CheckCircle2, AlertCircle, Loader2, Bot, Eye, EyeOff, ChevronDown } from 'lucide-react'
import { Youtube, Twitch } from '../ui/BrandIcons'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'
import { useStore } from '../../hooks/useStore'


// ─── Main page ────────────────────────────────────────────────────────────────

export function IntegrationsPage() {
  const { config, updateConfig } = useStore()

  // ── YouTube credentials ───────────────────────────────────────────────────
  const [ytClientId, setYtClientId] = useState('')
  const [ytClientSecret, setYtClientSecret] = useState('')
  const [ytCredsSaved, setYtCredsSaved] = useState(false)
  const [ytConnected, setYtConnected] = useState(false)
  const [ytTokenValid, setYtTokenValid] = useState(true)
  const [ytTokenError, setYtTokenError] = useState<string | null>(null)
  const [ytConnecting, setYtConnecting] = useState(false)
  const [ytError, setYtError] = useState<string | null>(null)

  // ── Twitch credentials ────────────────────────────────────────────────────
  const [twClientId, setTwClientId] = useState('')
  const [twClientSecret, setTwClientSecret] = useState('')
  const [twCredsSaved, setTwCredsSaved] = useState(false)
  const [twConnected, setTwConnected] = useState(false)
  const [twConnecting, setTwConnecting] = useState(false)
  const [twError, setTwError] = useState<string | null>(null)

  // ── Claude credentials ────────────────────────────────────────────────────
  const [claudeApiKey, setClaudeApiKey] = useState('')
  const [claudeSystemPrompt, setClaudeSystemPrompt] = useState('')
  const [claudeSaved, setClaudeSaved] = useState(false)
  const [claudeTesting, setClaudeTesting] = useState(false)
  const [claudeTestResult, setClaudeTestResult] = useState<{ valid: boolean; error?: string } | null>(null)

  // ── YouTube instructions toggle ───────────────────────────────────────────
  const [ytInstructionsExpanded, setYtInstructionsExpanded] = useState(false)

  // ── Secret reveal ─────────────────────────────────────────────────────────
  type RevealField = 'yt-secret' | 'tw-secret' | 'claude-key'
  const [revealed, setRevealed] = useState<Set<RevealField>>(new Set())
  const [pendingReveal, setPendingReveal] = useState<RevealField | null>(null)

  const requestReveal = (field: RevealField) => {
    if (revealed.has(field)) {
      setRevealed(prev => { const s = new Set(prev); s.delete(field); return s })
    } else {
      setPendingReveal(field)
    }
  }
  const confirmReveal = () => {
    if (pendingReveal) setRevealed(prev => new Set(prev).add(pendingReveal))
    setPendingReveal(null)
  }

  useEffect(() => {
    setYtClientId(config.youtubeClientId ?? '')
    setYtClientSecret(config.youtubeClientSecret ?? '')
    setTwClientId(config.twitchClientId ?? '')
    setTwClientSecret(config.twitchClientSecret ?? '')
  }, [config.youtubeClientId, config.youtubeClientSecret, config.twitchClientId, config.twitchClientSecret])

  useEffect(() => {
    setClaudeApiKey(config.claudeApiKey ?? '')
    setClaudeSystemPrompt(config.claudeSystemPrompt ?? '')
  }, [config.claudeApiKey, config.claudeSystemPrompt])

  useEffect(() => {
    window.api.youtubeGetStatus().then((s: { connected: boolean }) => {
      setYtConnected(s.connected)
      if (!s.connected) return
      window.api.youtubeValidateToken().then(r => {
        setYtTokenValid(r.valid)
        setYtTokenError(r.valid ? null : (r.error ?? 'Token is invalid'))
      }).catch(() => {})
    }).catch(() => {})
    window.api.twitchGetStatus().then((s: { connected: boolean }) => {
      setTwConnected(s.connected)
    }).catch(() => {})
  }, [])

  // ── YouTube actions ───────────────────────────────────────────────────────
  const saveYtCredentials = async () => {
    await updateConfig({ youtubeClientId: ytClientId.trim(), youtubeClientSecret: ytClientSecret.trim() })
    setYtCredsSaved(true); setTimeout(() => setYtCredsSaved(false), 2000)
  }
  const connectYt = async () => {
    setYtConnecting(true); setYtError(null)
    try {
      await window.api.youtubeConnect()
      setYtConnected(true)
      setYtTokenValid(true)
      setYtTokenError(null)
    }
    catch (e: any) { setYtError(e.message) }
    finally { setYtConnecting(false) }
  }
  const disconnectYt = async () => {
    await window.api.youtubeDisconnect()
    setYtConnected(false)
    setYtTokenValid(true)
    setYtTokenError(null)
  }

  // ── Claude actions ────────────────────────────────────────────────────────
  const saveClaudeSettings = async () => {
    await updateConfig({ claudeApiKey: claudeApiKey.trim(), claudeSystemPrompt: claudeSystemPrompt.trim() })
    setClaudeSaved(true); setTimeout(() => setClaudeSaved(false), 2000)
    setClaudeTestResult(null)
  }
  const disconnectClaude = async () => {
    await updateConfig({ claudeApiKey: '', claudeSystemPrompt: '' })
    setClaudeApiKey('')
    setClaudeSystemPrompt('')
    setClaudeTestResult(null)
  }
  const testClaudeKey = async () => {
    if (!claudeApiKey.trim()) return
    setClaudeTesting(true); setClaudeTestResult(null)
    const result = await window.api.claudeTestKey(claudeApiKey.trim())
    setClaudeTestResult(result)
    setClaudeTesting(false)
  }

  // ── Twitch actions ────────────────────────────────────────────────────────
  const saveTwCredentials = async () => {
    await updateConfig({ twitchClientId: twClientId.trim(), twitchClientSecret: twClientSecret.trim() })
    setTwCredsSaved(true); setTimeout(() => setTwCredsSaved(false), 2000)
  }
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
          <p className="text-xs text-gray-500 mt-0.5">Connect and manage your streaming platform accounts.</p>
        </div>
      </div>

      <div className="flex-1 overflow-hidden pr-2">
      <div className="h-full overflow-y-auto">
      <div className="flex flex-col gap-6 p-4">

        {/* ── YouTube ─────────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 px-1">
            <Youtube size={16} className="text-red-400 shrink-0" />
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">YouTube</span>
            <span className={`ml-auto text-xs font-medium ${
              ytConnected && ytTokenValid ? 'text-green-400' :
              ytConnected && !ytTokenValid ? 'text-amber-400' :
              'text-gray-600'
            }`}>
              {ytConnected && ytTokenValid ? 'Connected' :
               ytConnected && !ytTokenValid ? 'Token expired' :
               'Not connected'}
            </span>
          </div>

          {/* Token expired banner */}
          {ytConnected && !ytTokenValid && (
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
                    className="flex items-center gap-1.5 text-gray-500 hover:text-gray-300 transition-colors self-start"
                  >
                    <ChevronDown size={13} className={`transition-transform duration-150 ${ytInstructionsExpanded ? 'rotate-180' : ''}`} />
                    {ytInstructionsExpanded ? 'Hide setup instructions' : 'Show setup instructions'}
                  </button>
                )}
              </div>
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-gray-400">Client ID</label>
                  <input value={ytClientId} onChange={e => setYtClientId(e.target.value)} placeholder="…apps.googleusercontent.com"
                    className="w-full bg-navy-900 border border-white/10 text-gray-200 text-xs font-mono rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500/50" />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-gray-400">Client Secret</label>
                  <div className="relative">
                    <input type={revealed.has('yt-secret') ? 'text' : 'password'} value={ytClientSecret} onChange={e => setYtClientSecret(e.target.value)} placeholder="GOCSPX-…"
                      className="w-full bg-navy-900 border border-white/10 text-gray-200 text-xs font-mono rounded-lg px-3 py-2 pr-8 focus:outline-none focus:ring-2 focus:ring-purple-500/50" />
                    <button onClick={() => requestReveal('yt-secret')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-600 hover:text-gray-400 transition-colors">
                      {revealed.has('yt-secret') ? <EyeOff size={13} /> : <Eye size={13} />}
                    </button>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Button variant="secondary" size="sm" onClick={saveYtCredentials}
                  icon={ytCredsSaved ? <CheckCircle2 size={13} className="text-green-400" /> : undefined}>
                  {ytCredsSaved ? 'Saved!' : 'Save credentials'}
                </Button>
                {!ytConnected
                  ? <Button variant="primary" size="sm" onClick={connectYt} disabled={!ytClientId || !ytClientSecret || ytConnecting}
                      icon={ytConnecting ? <Loader2 size={13} className="animate-spin" /> : <Youtube size={13} />}>
                      {ytConnecting ? 'Connecting…' : 'Connect to YouTube'}
                    </Button>
                  : <Button variant="ghost" size="sm" onClick={disconnectYt}>Disconnect</Button>
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

        </div>

        {/* ── Twitch ───────────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 px-1">
            <Twitch size={16} className="text-twitch-400 shrink-0" />
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Twitch</span>
            <span className={`ml-auto text-xs font-medium ${twConnected ? 'text-green-400' : 'text-gray-600'}`}>
              {twConnected ? 'Connected' : 'Not connected'}
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
                  <input value={twClientId} onChange={e => setTwClientId(e.target.value)} placeholder="Twitch Client ID"
                    className="w-full bg-navy-900 border border-white/10 text-gray-200 text-xs font-mono rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500/50" />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-gray-400">Client Secret</label>
                  <div className="relative">
                    <input type={revealed.has('tw-secret') ? 'text' : 'password'} value={twClientSecret} onChange={e => setTwClientSecret(e.target.value)} placeholder="Twitch Client Secret"
                      className="w-full bg-navy-900 border border-white/10 text-gray-200 text-xs font-mono rounded-lg px-3 py-2 pr-8 focus:outline-none focus:ring-2 focus:ring-purple-500/50" />
                    <button onClick={() => requestReveal('tw-secret')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-600 hover:text-gray-400 transition-colors">
                      {revealed.has('tw-secret') ? <EyeOff size={13} /> : <Eye size={13} />}
                    </button>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Button variant="secondary" size="sm" onClick={saveTwCredentials}
                  icon={twCredsSaved ? <CheckCircle2 size={13} className="text-green-400" /> : undefined}>
                  {twCredsSaved ? 'Saved!' : 'Save credentials'}
                </Button>
                {!twConnected
                  ? <Button variant="primary" size="sm" onClick={connectTw} disabled={!twClientId || !twClientSecret || twConnecting}
                      icon={twConnecting ? <Loader2 size={13} className="animate-spin" /> : <Twitch size={13} />}
                      className="bg-purple-600 hover:bg-purple-500">
                      {twConnecting ? 'Connecting…' : 'Connect to Twitch'}
                    </Button>
                  : <Button variant="ghost" size="sm" onClick={disconnectTw}>Disconnect</Button>
                }
              </div>
              {twConnecting && (
                <p className="text-xs text-yellow-400/80 flex items-center gap-1.5">
                  <AlertCircle size={12} />
                  A Twitch sign-in page has opened in your browser — complete the sign-in there to continue.
                </p>
              )}
              {twError && <p className="text-xs text-red-400 flex items-center gap-1.5"><AlertCircle size={12} />{twError}</p>}
            </div>
          </div>
        </div>

        {/* ── Claude AI ───────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 px-1">
            <Bot size={16} className="text-orange-400 shrink-0" />
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Claude AI</span>
            <span className={`ml-auto text-xs font-medium ${config.claudeApiKey ? 'text-green-400' : 'text-gray-600'}`}>
              {config.claudeApiKey ? 'Connected' : 'Not connected'}
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
                    value={claudeApiKey}
                    onChange={e => { setClaudeApiKey(e.target.value); setClaudeTestResult(null) }}
                    placeholder="sk-ant-…"
                    className="w-full bg-navy-900 border border-white/10 text-gray-200 text-xs font-mono rounded-lg px-3 py-2 pr-8 focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                  />
                  <button onClick={() => requestReveal('claude-key')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-600 hover:text-gray-400 transition-colors">
                    {revealed.has('claude-key') ? <EyeOff size={13} /> : <Eye size={13} />}
                  </button>
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-gray-400">
                  Preferences / System Prompt
                  <span className="text-gray-500 font-normal ml-1">(optional)</span>
                </label>
                <textarea
                  value={claudeSystemPrompt}
                  onChange={e => setClaudeSystemPrompt(e.target.value)}
                  rows={4}
                  placeholder="e.g. I stream horror games. Keep titles under 60 characters. Always include the episode number. My channel tagline is …"
                  className="w-full bg-navy-900 border border-white/10 text-gray-200 text-xs rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500/50 resize-y"
                />
                <p className="text-xs text-gray-400">Tell Claude about your channel, content style, or any preferences for how suggestions should be worded.</p>
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                <Button variant="secondary" size="sm" onClick={saveClaudeSettings}
                  icon={claudeSaved ? <CheckCircle2 size={13} className="text-green-400" /> : undefined}>
                  {claudeSaved ? 'Saved!' : 'Save'}
                </Button>
                <Button variant="ghost" size="sm" onClick={testClaudeKey}
                  disabled={!claudeApiKey.trim() || claudeTesting}
                  icon={claudeTesting ? <Loader2 size={13} className="animate-spin" /> : undefined}>
                  {claudeTesting ? 'Testing…' : 'Test connection'}
                </Button>
                {config.claudeApiKey && (
                  <Button variant="ghost" size="sm" onClick={disconnectClaude}>Disconnect</Button>
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
        title="Reveal sensitive value?"
        width="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPendingReveal(null)}>Cancel</Button>
            <Button variant="primary" onClick={confirmReveal}>Reveal</Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <p className="text-sm text-gray-300 leading-relaxed">
            This value is sensitive and should be kept private.
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
