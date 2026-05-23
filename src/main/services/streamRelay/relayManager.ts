/**
 * Stream Relay manager — runs an ffmpeg-based localhost RTMP server in a
 * child process and forwards bytes to YouTube. The child IS the ffmpeg
 * process itself (no Node middleman), giving us native OS-level isolation
 * and crash boundaries while keeping the code in main-process scope.
 *
 * High-level lifecycle:
 *   start()  → spawn ffmpeg with -listen 1
 *   stop()   → SIGTERM the child, no respawn
 *   crash    → respawn with a short delay, up to a small retry budget
 *   stream   → ffmpeg emits progress on stderr; we parse for stats + events
 *
 * What the manager intentionally does NOT do:
 *   - call YouTube API (bind/transition/complete) — that's main-process orchestration
 *   - know which broadcast is active — that's also main-process
 *   - persist its own state — caller owns config, manager owns runtime
 *
 * Caller subscribes to events via the EventEmitter interface.
 */
import { ChildProcess, spawn } from 'child_process'
import { EventEmitter } from 'events'
import os from 'os'
import ffmpegStatic from 'ffmpeg-static'

const FFMPEG_PATH = ffmpegStatic as unknown as string

export interface RelayConfig {
  port: number
  inboundKey: string       // identifier Aitum sends; just for matching the listen URL
  youtubeBase: string      // 'rtmp://a.rtmp.youtube.com/live2'
  outboundKey: string      // channel's persistent YouTube stream key
}

export type RelayState =
  | 'idle'           // not running
  | 'starting'       // spawn issued, waiting for ffmpeg to be ready
  | 'listening'      // ffmpeg is up, waiting for OBS to connect
  | 'streaming'      // OBS connected, bytes flowing to YouTube
  | 'restarting'     // ffmpeg died, respawning shortly
  | 'error'          // gave up retrying

export interface RelayStatus {
  state: RelayState
  /** Last error message (only meaningful when state === 'error'). */
  error?: string
  /** Wall-clock ms when the current streaming session started. */
  streamStartedAt?: number
}

export interface RelayStats {
  /** Throttled to ~1/sec from ffmpeg's progress lines. */
  kbps: number
  durationSec: number
  /** ffmpeg's "speed=X.Xx" — should hover near 1.0 in a healthy stream. */
  speed: number
}

/**
 * Strongly-typed event names. Consumers do `manager.on('stream-started', …)`.
 */
export interface RelayEventMap {
  'status-change': [RelayStatus]
  'stats': [RelayStats]
  'stream-started': []
  'stream-stopped': [{ code: number | null }]
  'error': [string]
}

export class RelayManager extends EventEmitter {
  private config: RelayConfig | null = null
  private child: ChildProcess | null = null
  private status: RelayStatus = { state: 'idle' }
  private streamingNow = false
  private restartAttempts = 0
  private restartWindowStart = 0
  private lastStatsAt = 0
  private respawnTimer: NodeJS.Timeout | null = null
  private intentionalStop = false

  /** Start (or restart) the relay with the given config. Idempotent — calling
   *  with the same config while running is a no-op; calling with a different
   *  config does a clean restart. */
  start(config: RelayConfig): void {
    if (this.child && this.config && this.configEquals(this.config, config)) return
    if (this.child) {
      // Config changed — clean restart
      this.intentionalStop = true
      this.child.kill('SIGTERM')
      this.child = null
    }
    this.config = config
    this.intentionalStop = false
    this.restartAttempts = 0
    this.spawn()
  }

  /** Stop the relay. No respawn. Idempotent. */
  stop(): void {
    this.config = null
    this.intentionalStop = true
    if (this.respawnTimer) {
      clearTimeout(this.respawnTimer)
      this.respawnTimer = null
    }
    if (this.child) {
      this.child.kill('SIGTERM')
      // Force-kill if it doesn't exit cleanly
      const c = this.child
      setTimeout(() => { try { c.kill('SIGKILL') } catch { /* already gone */ } }, 3000).unref()
      this.child = null
    }
    this.streamingNow = false
    this.updateStatus({ state: 'idle', error: undefined, streamStartedAt: undefined })
  }

  getStatus(): RelayStatus {
    return this.status
  }

  isRunning(): boolean {
    return this.child !== null
  }

  // ─── internals ──────────────────────────────────────────────────────────

  private configEquals(a: RelayConfig, b: RelayConfig): boolean {
    return a.port === b.port
      && a.inboundKey === b.inboundKey
      && a.youtubeBase === b.youtubeBase
      && a.outboundKey === b.outboundKey
  }

  private buildArgs(cfg: RelayConfig): string[] {
    // -listen 1 makes ffmpeg a one-shot RTMP server. -c copy forwards bytes
    // with zero re-encode — minimal CPU regardless of inbound bitrate.
    return [
      '-hide_banner',
      '-loglevel', 'info',
      '-listen', '1',
      '-f', 'flv',
      '-i', `rtmp://0.0.0.0:${cfg.port}/sm/${cfg.inboundKey}`,
      '-c', 'copy',
      '-f', 'flv',
      `${cfg.youtubeBase}/${cfg.outboundKey}`,
    ]
  }

  private spawn(): void {
    if (!this.config) return
    const cfg = this.config

    this.updateStatus({ state: 'starting' })

    const child = spawn(FFMPEG_PATH, this.buildArgs(cfg), {
      stdio: ['ignore', 'pipe', 'pipe'],
      // Detach=false (default) so SIGTERM from main can take it down cleanly
    })

    // Bump priority on Windows so packet forwarding stays prompt even if SM
    // is doing heavy work elsewhere. Best-effort — not fatal if it fails.
    if (child.pid && process.platform === 'win32') {
      try {
        os.setPriority(child.pid, os.constants.priority.PRIORITY_ABOVE_NORMAL)
      } catch { /* ignore */ }
    }

    this.child = child
    this.streamingNow = false

    // All event handlers gate on `this.child === child` so stale events from
    // a child we've already replaced (e.g. on a port-change restart) don't
    // mutate manager state that now belongs to the new child. Without this,
    // the old child's delayed `exit` would clobber `this.child` and trigger
    // a phantom restart loop while the new child runs fine in the background.
    child.stderr?.on('data', (chunk: Buffer) => {
      if (this.child !== child) return
      this.handleStderr(chunk.toString())
    })
    child.on('error', (err) => {
      if (this.child !== child) return
      this.emit('error', `ffmpeg spawn failed: ${err.message}`)
      this.updateStatus({ state: 'error', error: err.message })
    })
    child.on('exit', (code, signal) => {
      if (this.child !== child) return
      this.handleExit(code, signal)
    })

    // ffmpeg in -listen 1 mode prints nothing while idle — it doesn't emit
    // a "now listening" log line. So instead of grepping for a message that
    // never comes, transition to 'listening' after a brief moment to bind
    // the port. If the spawn actually failed (EADDRINUSE etc.) the exit
    // handler fires inside that window and overrides the state.
    setTimeout(() => {
      if (this.child === child && this.status.state === 'starting') {
        this.updateStatus({ state: 'listening' })
      }
    }, 500)
  }

  private handleStderr(text: string): void {

    // First sign of actual stream ingestion. ffmpeg prints "Stream mapping:"
    // once it's negotiated codecs with the inbound stream and is ready to mux.
    if (text.includes('Stream mapping:') && !this.streamingNow) {
      this.streamingNow = true
      this.updateStatus({ state: 'streaming', streamStartedAt: Date.now() })
      this.emit('stream-started')
    }

    // Progress lines look like:
    //   frame=1234 fps=60 q=-1 size=12345kB time=00:02:34.21 bitrate=7500.0kb/s speed=1.0x
    // Throttle to 1/sec so we don't spam IPC.
    const m = text.match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)\s+bitrate=(\d+(?:\.\d+)?)kbits\/s.*?speed=([\d.]+)x/)
    if (m && this.streamingNow) {
      const now = Date.now()
      if (now - this.lastStatsAt < 1000) return
      this.lastStatsAt = now
      const durationSec =
        parseInt(m[1], 10) * 3600 +
        parseInt(m[2], 10) * 60 +
        parseFloat(m[3])
      this.emit('stats', {
        kbps: parseFloat(m[4]),
        durationSec,
        speed: parseFloat(m[5]),
      })
    }

    // Surface unexpected error lines for diagnostics. ffmpeg's output is
    // noisy; we only emit the ones that look like real problems.
    if (/Error|error|failed|refused/.test(text) && !/Conversion failed!/.test(text)) {
      // The "Conversion failed!" line is the bookend after an error chain;
      // the actual error came earlier and would already have fired this branch.
      const line = text.trim().split('\n').find(l => /Error|error|failed|refused/.test(l))
      if (line) this.emit('error', line.trim())
    }
  }

  private handleExit(code: number | null, _signal: NodeJS.Signals | null): void {
    const wasStreaming = this.streamingNow
    this.streamingNow = false
    this.child = null

    if (wasStreaming) {
      this.emit('stream-stopped', { code })
    }

    if (this.intentionalStop) {
      this.updateStatus({ state: 'idle', streamStartedAt: undefined })
      return
    }
    if (!this.config) {
      this.updateStatus({ state: 'idle', streamStartedAt: undefined })
      return
    }

    // Restart budget: max 2 restarts within 5 seconds. Beyond that, something
    // is systemically wrong (bad config, port permanently bound, etc.) — stop
    // hammering and surface an error.
    const now = Date.now()
    if (now - this.restartWindowStart > 5000) {
      this.restartWindowStart = now
      this.restartAttempts = 0
    }
    this.restartAttempts++
    if (this.restartAttempts > 2) {
      this.updateStatus({
        state: 'error',
        error: 'Relay crashed repeatedly within a short window. Disable + re-enable to retry.',
      })
      return
    }

    this.updateStatus({ state: 'restarting' })
    // Crash during streaming → respawn fast (OBS may still be holding its connection
    // and will retry — we want to be back up before it gives up).
    // Crash while idle → small delay to avoid tight loop on bad config.
    const delay = wasStreaming ? 200 : 1500
    this.respawnTimer = setTimeout(() => {
      this.respawnTimer = null
      this.spawn()
    }, delay)
  }

  private updateStatus(patch: Partial<RelayStatus>): void {
    this.status = { ...this.status, ...patch }
    this.emit('status-change', this.status)
  }
}

/** Singleton — there's only ever one relay per app instance, and it owns a
 *  privileged port. Modules that need access import this. */
export const relayManager = new RelayManager()
