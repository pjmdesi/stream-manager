import React, { useMemo, useState } from 'react'
import { Check, ChevronRight, Copy, ExternalLink, Loader2, ShieldCheck, TriangleAlert } from 'lucide-react'
import { Youtube } from './ui/BrandIcons'
import { Button } from './ui/Button'
import { FileDropZone } from './ui/FileDropZone'
import { Modal } from './ui/Modal'
import { Tooltip } from './ui/Tooltip'

/**
 * Guided YouTube connection setup (IDEA-11).
 *
 * SM deliberately uses bring-your-own Google credentials: every user gets
 * their own private API quota and maximum privacy, at the cost of a Google
 * Cloud walk-through that is hostile to non-technical users. This wizard is
 * that walk-through made survivable: one console task per step with a deep
 * link, per-step validation where SM can actually check something, and
 * honest mapped errors when Google refuses.
 *
 * Copy discipline (style guide / BIG-5 lesson): steps describe what each
 * console task DOES, never what the console page looks like — Google
 * reshuffles that UI constantly and concept-level copy rots at the speed
 * of concepts, not releases. Deep links are still worth it; Google
 * redirects them sensibly when sections move.
 */

const PROGRESS_KEY = 'ytSetupWizardDone'

/** Inline monospace value with a copy button — same interaction as the
 *  stream relay's Server URL / stream key rows. */
function CopyValue({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="font-mono text-gray-300 select-all">{value}</span>
      <Tooltip content={copied ? 'Copied' : 'Copy'}>
        <button
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value)
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            } catch { /* clipboard refused — ignore */ }
          }}
          className="text-gray-400 hover:text-gray-200 transition-colors"
        >
          {copied ? <Check size={11} className="text-green-400" /> : <Copy size={11} />}
        </button>
      </Tooltip>
    </span>
  )
}

/** Console steps (1-5) are tasks done in the browser; steps 6-7 are
 *  interactive inside the wizard. */
const CONSOLE_STEPS: { key: string; title: string; linkLabel: string; url: string; body: React.ReactNode }[] = [
  {
    key: 'project',
    title: 'Create a Google Cloud project',
    linkLabel: 'Create a project',
    url: 'https://console.cloud.google.com/projectcreate',
    body: (
      <>
        <p>
          A project of your own is what gives you a private API allowance: SM talks to YouTube
          as <span className="text-gray-300">your</span> app, and nobody else shares your limits.
        </p>
        <p>
          Sign in with the Google account you stream with and create a project. Any name works
          (&ldquo;Stream Manager&rdquo; is fine).
        </p>
      </>
    ),
  },
  {
    key: 'api',
    title: 'Enable the YouTube Data API',
    linkLabel: 'Open the API page',
    url: 'https://console.cloud.google.com/apis/library/youtube.googleapis.com',
    body: (
      <p>
        This switches on the YouTube API for your project. The link lands directly on
        <span className="text-gray-300"> YouTube Data API v3</span>: click{' '}
        <span className="text-gray-300">Enable</span>, and that&rsquo;s the whole step.
      </p>
    ),
  },
  {
    key: 'consent',
    title: 'Set up the consent screen',
    linkLabel: 'Open the consent setup',
    url: 'https://console.cloud.google.com/auth/overview',
    body: (
      <>
        <p>
          This screen is what Google shows <span className="text-gray-300">you</span> when SM connects
          (it may appear as a &ldquo;Get started&rdquo; flow or a Branding page). Fill exactly these fields:
        </p>
        <ul className="list-disc list-inside flex flex-col gap-1 marker:text-gray-500">
          <li>App name: &ldquo;Stream Manager&rdquo; works</li>
          <li>Both email fields: your own email</li>
          <li>Application home page: <CopyValue value="https://stream-manager.app" /></li>
          <li>Privacy policy link: <CopyValue value="https://stream-manager.app/app-privacy" /></li>
        </ul>
        <p>
          The two links describe what a personal app like yours is and how it handles data. Pick{' '}
          <span className="text-gray-300">External</span> for the user type, skip everything optional,
          and don&rsquo;t submit for verification.
        </p>
      </>
    ),
  },
  {
    key: 'publish',
    title: 'Publish the app',
    linkLabel: 'Open publishing status',
    url: 'https://console.cloud.google.com/auth/audience',
    body: (
      <>
        <p>
          New apps start in Testing status, which Google disconnects every 7 days. Publishing makes your
          connection permanent; nothing is reviewed or sent to anyone.
        </p>
        <p>
          Under <span className="text-gray-300">Publishing status</span>, click{' '}
          <span className="text-gray-300">Publish app</span>.
        </p>
        <p>
          Greyed out behind an &ldquo;incomplete configuration&rdquo; banner? A field from the previous step
          is still empty. Open{' '}
          <button onClick={() => window.api.openUrl('https://console.cloud.google.com/auth/branding')} className="text-accent-400 hover:text-accent-300 hover:underline transition-colors">Branding</button>
          {' '}and check the list again (the two links are the easiest to miss: Google doesn&rsquo;t star them,
          but publishing demands them). Save and come back.
        </p>
      </>
    ),
  },
  {
    key: 'credentials',
    title: 'Create the credentials',
    linkLabel: 'Create an OAuth client',
    url: 'https://console.cloud.google.com/auth/clients/create',
    body: (
      <>
        <p>
          Create an <span className="text-gray-300">OAuth client ID</span> with the application type{' '}
          <span className="text-gray-300">Desktop app</span> (the name doesn&rsquo;t matter). Desktop is
          the type that lets SM receive Google&rsquo;s sign-in answer on this PC with no extra setup.
        </p>
        <p>
          When Google shows the new client, click <span className="text-gray-300">Download JSON</span>.
          That file is the next step.
        </p>
      </>
    ),
  },
]

/** Map Google's OAuth/API failures to honest, specific fixes that name the
 *  wizard step to revisit. Raw message is preserved when unrecognized. */
export function explainYtConnectError(raw: string): string {
  const m = raw.toLowerCase()
  if (m.includes('redirect_uri_mismatch')) {
    return 'Google rejected the connection address. This usually means the OAuth client was created as a "Web application" instead of "Desktop app" (step 5). Recreate it as Desktop app and re-import the JSON, or add http://localhost:42813/oauth2callback to the web client\'s authorized redirect URIs.'
  }
  if (m.includes('access_denied')) {
    return 'The sign-in was cancelled or blocked by Google. If Google said "access blocked" without an Advanced link, the app is still in Testing without you as a test user: publish it (step 4), or add your account under Test users.'
  }
  if (m.includes('invalid_client') || m.includes('unauthorized_client')) {
    return 'Google didn\'t recognize these credentials. The client ID or secret is wrong: re-import the JSON downloaded in step 5.'
  }
  if (m.includes('accessnotconfigured') || m.includes('has not been used') || m.includes('is disabled')) {
    return 'The YouTube Data API isn\'t enabled in your project (step 2). Enable it, wait a minute, and connect again.'
  }
  if (m.includes('invalid_grant')) {
    return 'The sign-in code expired or the credentials changed mid-connection. Click Connect and finish the browser sign-in in one go.'
  }
  if (m.includes('timed out')) {
    return 'The sign-in timed out. Click Connect again and finish in the browser within 5 minutes.'
  }
  return raw
}

function loadProgress(): Set<string> {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY)
    if (raw) return new Set(JSON.parse(raw) as string[])
  } catch { /* fresh start */ }
  return new Set()
}

function saveProgress(done: Set<string>): void {
  try { localStorage.setItem(PROGRESS_KEY, JSON.stringify([...done])) } catch { /* non-fatal */ }
}

const STEP_KEYS = [...CONSOLE_STEPS.map(s => s.key), 'import', 'connect']

export function YouTubeSetupWizard({
  isOpen, onClose, clientId, clientSecret, connected, onCredentials, onConnect,
}: {
  isOpen: boolean
  onClose: () => void
  clientId: string
  clientSecret: string
  connected: boolean
  /** Persist a client ID + secret pair (both at once — from the JSON import). */
  onCredentials: (id: string, secret: string) => void
  /** Runs the OAuth flow; throws with Google's error message on failure. */
  onConnect: () => Promise<void>
}) {
  const [done, setDone] = useState<Set<string>>(loadProgress)
  // Active step: user-chosen, else the first not-done step.
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const [importNote, setImportNote] = useState<{ kind: 'ok' | 'warn' | 'error'; text: string } | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [connectError, setConnectError] = useState<string | null>(null)
  const [probeResult, setProbeResult] = useState<'ok' | null>(null)

  const credsPresent = !!clientId && !!clientSecret

  const markDone = (key: string, isDone = true) => {
    setDone(prev => {
      const next = new Set(prev)
      if (isDone) next.add(key); else next.delete(key)
      saveProgress(next)
      return next
    })
    if (isDone) {
      const idx = STEP_KEYS.indexOf(key)
      setActiveKey(STEP_KEYS[Math.min(idx + 1, STEP_KEYS.length - 1)])
    }
  }

  // ── JSON import ────────────────────────────────────────────────────────────
  const importJsonFile = async (path: string) => {
    setImportNote(null)
    let parsed: unknown
    try {
      parsed = JSON.parse(await window.api.readFile(path))
    } catch {
      setImportNote({ kind: 'error', text: 'That file couldn\'t be read as JSON. Use the file downloaded from the credentials page (usually named client_secret_….json).' })
      return
    }
    const obj = parsed as { installed?: { client_id?: string; client_secret?: string }; web?: { client_id?: string; client_secret?: string } }
    const creds = obj.installed ?? obj.web
    if (!creds?.client_id || !creds?.client_secret) {
      setImportNote({ kind: 'error', text: 'That JSON isn\'t an OAuth client file (no client ID and secret inside). Download it from the credentials page in step 5.' })
      return
    }
    onCredentials(creds.client_id, creds.client_secret)
    if (obj.web) {
      setImportNote({ kind: 'warn', text: 'Read the credentials, but this client was created as a "Web application", not "Desktop app". It only works if its authorized redirect URIs include http://localhost:42813/oauth2callback. If connecting fails in step 7, recreate the client as Desktop app (step 5).' })
    } else {
      setImportNote({ kind: 'ok', text: 'Credentials read and saved on this PC. Nothing else in the file is used.' })
    }
    markDone('import')
  }

  // ── Manual entry validation (fallback for hand-copied values) ─────────────
  const manualIssue = useMemo((): string | null => {
    const id = clientId.trim()
    const secret = clientSecret.trim()
    if (!id && !secret) return null
    if (id && /^GOCSPX-/.test(id)) return 'The Client ID field contains a client secret (GOCSPX-…). The two values are swapped.'
    if (secret && /\.apps\.googleusercontent\.com$/.test(secret)) return 'The Client Secret field contains a client ID (…apps.googleusercontent.com). The two values are swapped.'
    if (id && !/\.apps\.googleusercontent\.com$/.test(id)) return 'The Client ID should end in .apps.googleusercontent.com. Check the copied value.'
    return null
  }, [clientId, clientSecret])

  // The two in-app steps also complete from OUTSIDE the wizard: credentials
  // typed into the Integrations fields satisfy 'import', and an existing
  // connection satisfies 'connect' — the checklist reflects reality, not
  // just clicks made inside it.
  const isStepDone = (key: string): boolean => {
    if (key === 'import') return done.has('import') || (credsPresent && !manualIssue)
    if (key === 'connect') return done.has('connect') || connected
    return done.has(key)
  }
  const effectiveActive = activeKey ?? STEP_KEYS.find(k => !isStepDone(k)) ?? 'connect'

  // ── Connect + end-to-end probe ─────────────────────────────────────────────
  const runConnect = async () => {
    setConnecting(true)
    setConnectError(null)
    setProbeResult(null)
    try {
      await onConnect()
      // End-to-end probe: one cheap API call proves the whole chain (API
      // enabled, consent granted, token valid) — a "connected" that can't
      // actually reach the channel would be a dishonest success.
      await window.api.youtubeGetChannelId()
      setProbeResult('ok')
      markDone('connect')
    } catch (e) {
      setConnectError(explainYtConnectError(e instanceof Error ? e.message : String(e)))
    } finally {
      setConnecting(false)
    }
  }

  // ── Step chrome ────────────────────────────────────────────────────────────
  const stepHeader = (key: string, index: number, title: string) => {
    const isDone = isStepDone(key)
    const isActive = effectiveActive === key
    return (
      <button
        onClick={() => setActiveKey(key)}
        className={`flex items-center gap-2.5 w-full text-left py-1.5 transition-colors ${isActive ? 'text-gray-100' : 'text-gray-400 hover:text-gray-200'}`}
      >
        <span className={`w-5 h-5 rounded-full border flex items-center justify-center text-[10px] tabular-nums shrink-0 transition-colors ${
          isDone ? 'bg-green-600/25 border-green-500/50 text-green-300' : isActive ? 'border-accent-400 text-accent-300' : 'border-white/20 text-gray-400'
        }`}>
          {isDone ? <Check size={11} strokeWidth={3} /> : index + 1}
        </span>
        <span className="text-sm flex-1">{title}</span>
        <ChevronRight size={13} className={`shrink-0 transition-transform ${isActive ? 'rotate-90 text-gray-300' : 'text-gray-500'}`} />
      </button>
    )
  }

  const noteColor = (kind: 'ok' | 'warn' | 'error') =>
    kind === 'ok' ? 'text-green-400' : kind === 'warn' ? 'text-amber-300' : 'text-red-400'

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Connect YouTube — setup guide" width="xl" autoFocus="none">
      <div className="flex flex-col gap-1">
        <p className="text-xs text-gray-400 leading-relaxed mb-2">
          Don&rsquo;t worry: this looks like a lot, but it&rsquo;s all copy-paste and you only ever do it once.
          You&rsquo;re creating your own private Google credentials, so nobody sits between SM and your channel.
          Progress is saved: leave and come back anytime.
        </p>

        {CONSOLE_STEPS.map((step, i) => (
          <div key={step.key} className="border-b border-white/5 last:border-b-0">
            {stepHeader(step.key, i, step.title)}
            {effectiveActive === step.key && (
              <div className="pl-[30px] pb-3 flex flex-col gap-2.5">
                {/* div, not p — step bodies hold their own paragraphs/lists */}
                <div className="text-xs text-gray-400 leading-relaxed flex flex-col gap-1.5">{step.body}</div>
                <div className="flex items-center gap-2">
                  <Tooltip content="Opens in your browser">
                    <Button size="sm" variant="secondary" icon={<ExternalLink size={12} />} onClick={() => window.api.openUrl(step.url)}>
                      {step.linkLabel}
                    </Button>
                  </Tooltip>
                  <Tooltip content="Check this step off and move on">
                    <Button size="sm" variant="primary" onClick={() => markDone(step.key)}>
                      Done, next
                    </Button>
                  </Tooltip>
                  {done.has(step.key) && (
                    <Tooltip content="Un-check this step">
                      <button onClick={() => markDone(step.key, false)} className="text-[11px] text-gray-400 hover:text-gray-300 transition-colors">
                        Mark not done
                      </button>
                    </Tooltip>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}

        {/* Step 6 — import the credentials */}
        <div className="border-b border-white/5">
          {stepHeader('import', CONSOLE_STEPS.length, 'Hand the credentials to SM')}
          {effectiveActive === 'import' && (
            <div className="pl-[30px] pb-3 flex flex-col gap-2.5">
              <p className="text-xs text-gray-400 leading-relaxed">
                Drop the downloaded JSON below. SM reads two values from it (the client ID and secret),
                stores them <span className="text-gray-300">on this PC only</span>, and sends them nowhere
                except Google.
              </p>
              <p className="text-xs text-amber-300/90 leading-relaxed flex items-start gap-1.5">
                <ShieldCheck size={13} className="shrink-0 mt-0.5" />
                <span>
                  Treat the file like a password: never share it, and never import one you didn&rsquo;t
                  download yourself. Afterwards, keep it somewhere private or delete it.
                </span>
              </p>
              <FileDropZone
                onFiles={paths => { if (paths[0]) void importJsonFile(paths[0]) }}
                accept={['json']}
                label="Drop the client_secret….json here or click to browse"
                browseFilterName="OAuth client JSON"
                compact
              />
              {importNote && (
                <p className={`text-xs leading-relaxed ${noteColor(importNote.kind)}`}>{importNote.text}</p>
              )}
              {credsPresent && !importNote && (
                <p className="text-xs text-green-400">Credentials are already saved. Re-import to replace them.</p>
              )}
              {manualIssue && (
                <p className="text-xs text-red-400 flex items-center gap-1.5"><TriangleAlert size={12} className="shrink-0" />{manualIssue}</p>
              )}
              <p className="text-xs text-gray-400">
                Prefer typing? The fields on the Integrations page accept the two values directly, and
                this step checks itself off once both look right.
              </p>
            </div>
          )}
        </div>

        {/* Step 7 — connect + end-to-end check */}
        <div>
          {stepHeader('connect', CONSOLE_STEPS.length + 1, 'Connect and verify')}
          {effectiveActive === 'connect' && (
            <div className="pl-[30px] pb-1 flex flex-col gap-2.5">
              <p className="text-xs text-gray-400 leading-relaxed">
                This opens Google&rsquo;s sign-in in your browser. Pick the account (or brand account) for
                the channel you stream on.
              </p>
              <p className="text-xs text-gray-400 leading-relaxed">
                Google shows a one-time &ldquo;Google hasn&rsquo;t verified this app&rdquo; screen: expected
                for a personal app. Click <span className="text-gray-300">Advanced</span>, then continue.
                Back in SM, one tiny API call proves the whole chain works.
              </p>
              <div className="flex items-center gap-2">
                <Tooltip content={credsPresent ? 'Opens Google sign-in in your browser' : 'Import or enter the credentials first (previous step)'}>
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={!credsPresent || connecting}
                    icon={connecting ? <Loader2 size={13} className="animate-spin" /> : <Youtube size={13} />}
                    onClick={() => void runConnect()}
                  >
                    {connecting ? 'Waiting for the browser sign-in…' : connected ? 'Reconnect' : 'Connect to YouTube'}
                  </Button>
                </Tooltip>
              </div>
              {probeResult === 'ok' && (
                <p className="text-xs text-green-400 flex items-center gap-1.5">
                  <Check size={13} strokeWidth={3} className="shrink-0" />
                  Connected, and the channel answered end to end. You&rsquo;re done: close this guide and stream.
                </p>
              )}
              {connectError && (
                <p className="text-xs text-red-400 leading-relaxed flex items-start gap-1.5">
                  <TriangleAlert size={13} className="shrink-0 mt-0.5" />
                  <span>{connectError}</span>
                </p>
              )}
            </div>
          )}
        </div>

        {/* Dev-only: reset the checklist for clean walkthrough runs. The
            import/connect steps still reflect reality (saved credentials /
            an active connection keep them checked) — this only clears the
            clicked-through console steps. */}
        {import.meta.env.DEV && (
          <Tooltip content="Dev only: clear the checklist and start from step 1">
            <button
              onClick={() => {
                setDone(new Set())
                saveProgress(new Set())
                setActiveKey(STEP_KEYS[0])
                setImportNote(null)
                setConnectError(null)
                setProbeResult(null)
              }}
              className="self-start mt-2 text-[11px] text-gray-400 hover:text-amber-300 transition-colors"
            >
              Start over (dev)
            </button>
          </Tooltip>
        )}
      </div>
    </Modal>
  )
}
