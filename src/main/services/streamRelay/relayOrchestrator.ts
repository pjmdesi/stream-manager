/**
 * Stream Relay orchestrator — the YouTube-lifecycle layer that sits on top
 * of the byte-pushing RelayManager. Subscribes to relay events and calls
 * liveBroadcasts.bind + transition('live') / transition('complete') against
 * the active broadcast.
 *
 *   relay listening / pick changes → PRE-BIND the picked broadcast to the
 *     channel's stream, so the moment bytes hit the key YouTube routes them
 *     to the scheduled broadcast instead of auto-starting the channel's
 *     default ("always on") broadcast. Without this there's a race: the
 *     relay forwards bytes the instant OBS connects, but the stream-started
 *     bind below takes several API round-trips — YouTube saw an unbound key
 *     receiving data and started the default broadcast alongside ours.
 *   stream-started → bind broadcast to channel's stream → transition 'live'
 *   stream-stopped → start 30s grace timer
 *     ↳ stream-started fires during grace → cancel timer, keep live
 *     ↳ grace expires → transition 'complete', finalize VOD
 *
 * `enableAutoStop: true` on SM-created broadcasts is the safety net for
 * cases where SM dies mid-stream and never gets to call complete — YouTube
 * auto-completes after ~1 minute of silence. Our explicit call after 30s
 * is faster and deterministic, but no longer load-bearing.
 *
 * NOT responsible for:
 *   - Spawning/managing ffmpeg                  (that's RelayManager)
 *   - Picking which broadcast is active         (that's ActiveBroadcastService)
 *   - Forwarding bytes                          (ffmpeg + the RTMP fabric)
 */
import { EventEmitter } from 'events'
import { relayManager } from './relayManager'
import { activeBroadcastService } from './activeBroadcast'
import { bindBroadcast, unbindBroadcast, transitionBroadcast, findStreamIdByName, getStreamStatus, getBroadcastContentDetails, getBroadcastLifeCycleStatus } from '../youtubeApi'
import { getStore, setConfigPartial } from '../../ipc/store'

/** Stages the renderer can observe via the lifecycle event. Pure information —
 *  the orchestrator's behavior doesn't branch on which stage the UI shows. */
export type OrchestratorStage =
  | 'idle'                   // not in a stream session
  | 'no-broadcast'           // stream started but no active broadcast picked; SM doesn't orchestrate
  | 'binding'                // calling liveBroadcasts.bind
  | 'waiting-for-ingest'     // bound; polling liveStreams.status until YouTube reports 'active'
  | 'going-live'             // stream active; calling liveBroadcasts.transition('live')
  | 'live'                   // broadcast is in the 'live' lifeCycleStatus
  | 'grace'                  // stream-stopped, waiting GRACE_MS before completing
  | 'completing'             // calling liveBroadcasts.transition('complete')
  | 'completed'              // VOD finalized
  | 'error'                  // an API call failed; broadcast may still be live

export interface OrchestratorEvent {
  stage: OrchestratorStage
  broadcastId?: string
  broadcastTitle?: string
  error?: string
  /** Remaining grace seconds when `stage === 'grace'`. Ticks once per second
   *  so the widget can render a countdown without its own timer. */
  graceRemainingSec?: number
}

class RelayOrchestrator extends EventEmitter {
  /** How long to wait after stream-stopped before transitioning to 'complete'.
   *  Less than YouTube's ~60s enableAutoStop window so SM's explicit call
   *  wins, but enough time for OBS to recover from a transient drop without
   *  ending the broadcast. */
  private static GRACE_MS = 30_000

  /** Poll cadence + overall budget while waiting for YouTube to report the
   *  bound stream as 'active' (i.e. it's receiving + validating ingest data).
   *  90s of headroom covers slow uplinks / encoder spin-up without hanging
   *  forever. 2s cadence = ~45 quota units worst case per start — negligible. */
  private static INGEST_POLL_MS = 2000
  private static INGEST_TIMEOUT_MS = 90_000
  /** Fallback retries for transition('live') itself once the stream is
   *  active — covers the brief window where YouTube reports 'active' but the
   *  transition still 409s for a beat. */
  private static MAX_LIVE_ATTEMPTS = 3
  private static TRANSITION_RETRY_MS = 2000

  private liveBroadcastId: string | null = null
  private liveBroadcastTitle: string | null = null
  // Broadcast we bound this session — set at bind regardless of whether the
  // subsequent go-live succeeded. Used so a stream that ends WITHOUT a clean
  // SM go-live (transition failed, or user went live manually) still emits a
  // session-end 'completed' signal for the renderer's post-stream prompt.
  private boundBroadcastId: string | null = null
  private boundBroadcastTitle: string | null = null
  private graceTimer: NodeJS.Timeout | null = null
  private graceTick: NodeJS.Timeout | null = null
  private graceStartedAt = 0
  // Session token. handleStreamStarted spans several awaits (upcoming
  // refresh, bind, up to 90s of ingest polling); a stream-stop or a fresh
  // start mid-flight bumps this so the orphaned run goes silent instead of
  // emitting a late 'error' (which dismissed the post-stream modal and
  // cancelled the pending auto-push) or double-running bind/transition
  // after an encoder reconnect.
  private startSeq = 0

  // Broadcast currently pre-bound to the relay's stream (claimed while the
  // relay is idle-listening). Dedupes rebinds of the same pick and tells us
  // what to unbind when the pick changes.
  private preBoundId: string | null = null
  private preBindInFlight = false
  private preBindQueued = false

  constructor() {
    super()
    relayManager.on('stream-started', () => this.handleStreamStarted())
    relayManager.on('stream-stopped', () => this.handleStreamStopped())
    // Pre-bind triggers: the relay coming up to 'listening' (boot auto-start,
    // manual enable, respawn after OBS disconnects) and any change of the
    // picked broadcast (manual pick, auto-pick refresh, post-stream unlock).
    relayManager.on('status-change', (s: { state: string }) => {
      if (s.state === 'listening') void this.preBindActive()
    })
    activeBroadcastService.on('active-changed', () => void this.preBindActive())
  }

  // ─── Pre-bind ───────────────────────────────────────────────────────────

  /** Bind the picked broadcast to the stream while the relay is idle, so
   *  first bytes on the key start OUR broadcast — never the default one.
   *  Only runs in the 'listening' state: binding while bytes are flowing
   *  could pull a second broadcast live on the active ingest, and binding
   *  while stopped is wasted quota. Failures are logged, not surfaced —
   *  the stream-started bind remains the authoritative one with real error
   *  reporting. */
  private async preBindActive(): Promise<void> {
    // Serialize: a pick change landing mid-bind re-queues one pass.
    if (this.preBindInFlight) { this.preBindQueued = true; return }
    this.preBindInFlight = true
    try {
      if (relayManager.getStatus().state !== 'listening') return
      const active = activeBroadcastService.getActive()
      if (active.isLiveSession) return
      const id = active.broadcast?.id ?? null
      if (id === this.preBoundId) return
      const { clientId, clientSecret } = this.getCreds()
      if (!clientId || !clientSecret) return
      const streamId = await this.getStreamId()
      if (!streamId) return
      if (relayManager.getStatus().state !== 'listening') return
      // Pick changed — release the previous claim first so only one
      // upcoming broadcast is attached to the stream when bytes arrive.
      if (this.preBoundId && this.preBoundId !== id) {
        try {
          await unbindBroadcast(this.preBoundId, clientId, clientSecret)
        } catch { /* deleted/completed since — nothing left to unbind */ }
        this.preBoundId = null
      }
      // No pick (or the pick is gone): leave the key unbound — streaming
      // with nothing selected intentionally targets the default broadcast.
      if (!id) return
      try {
        await bindBroadcast(id, streamId, clientId, clientSecret)
        this.preBoundId = id
        console.log(`[relay] pre-bound broadcast ${id} to stream ${streamId}`)
      } catch (e: any) {
        console.warn(`[relay] pre-bind failed (stream-start bind will retry): ${e?.message ?? e}`)
      }
    } finally {
      this.preBindInFlight = false
      if (this.preBindQueued) {
        this.preBindQueued = false
        void this.preBindActive()
      }
    }
  }

  // ─── Stream-started ─────────────────────────────────────────────────────

  private async handleStreamStarted(): Promise<void> {
    // Mid-grace stream resume: cancel the timer, leave the broadcast 'live',
    // emit a 'live' update so the UI clears the "grace" indicator.
    if (this.graceTimer) {
      this.clearGraceTimer()
      this.emit('lifecycle', {
        stage: 'live',
        broadcastId: this.liveBroadcastId ?? undefined,
        broadcastTitle: this.liveBroadcastTitle ?? undefined,
      })
      return
    }

    // Fresh stream start. Everything below is cancellation-checked against
    // the session token: a stop (or a reconnect starting a NEW session)
    // bumps startSeq, and this run must then stop touching shared state.
    const seq = ++this.startSeq
    const cancelled = () => seq !== this.startSeq

    // Force-refresh the upcoming list FIRST so we bind
    // against current YouTube state, not a possibly-stale background-poll cache
    // — a broadcast scheduled moments ago must still bind correctly. Falls back
    // to the cache on failure. This is what lets the widget's poll run as
    // slowly as it likes (idle/minimized) without affecting go-live.
    await activeBroadcastService.getUpcoming(true).catch(() => {})
    if (cancelled()) return
    // Pull the active broadcast at this exact moment so a later auto-pick
    // refresh doesn't change what we bind to mid-session.
    const active = activeBroadcastService.getActive()
    if (!active.broadcast) {
      // User started OBS without picking a broadcast. We don't orchestrate —
      // bytes flow to YouTube's default key and YouTube creates whatever
      // broadcast it would have without us. The UI surfaces this so the
      // user knows nothing was bound.
      this.emit('lifecycle', { stage: 'no-broadcast' })
      return
    }

    const broadcast = active.broadcast
    const broadcastId = broadcast.id
    const broadcastTitle = broadcast.snippet?.title?.trim() || 'Untitled broadcast'

    // Pin this broadcast for the duration of the session so the widget keeps
    // showing it even after YouTube flips its status to 'live' (which would
    // otherwise drop it from the upcoming list and bump the auto-pick to the
    // next stream). Locked before bind so the pin survives a bind/transition
    // failure too — bytes are still flowing to this broadcast either way.
    this.boundBroadcastId = broadcastId
    this.boundBroadcastTitle = broadcastTitle
    activeBroadcastService.lockSession(broadcast)

    // Look up streamId — cached from auto-fill, looked up if missing.
    const streamId = await this.getStreamId()
    if (cancelled()) return
    if (!streamId) {
      this.emit('lifecycle', {
        stage: 'error',
        broadcastId,
        broadcastTitle,
        error: 'No YouTube stream found for the configured key. Open Integrations → Stream Relay and re-run Auto-fill.',
      })
      return
    }

    // Bind broadcast to the stream
    this.emit('lifecycle', { stage: 'binding', broadcastId, broadcastTitle })
    try {
      const { clientId, clientSecret } = this.getCreds()
      await bindBroadcast(broadcastId, streamId, clientId, clientSecret)
      // This is now the stream's bound broadcast — keep the pre-bind
      // bookkeeping in sync so post-session pre-binds dedupe correctly.
      this.preBoundId = broadcastId
    } catch (e: any) {
      if (cancelled()) return
      this.emit('lifecycle', {
        stage: 'error',
        broadcastId,
        broadcastTitle,
        error: `Couldn't bind broadcast: ${e?.message ?? e}`,
      })
      return
    }
    if (cancelled()) return

    // Wait for YouTube to actually be receiving the stream before trying to
    // go live — calling transition('live') before the bound stream is
    // 'active' is the usual cause of "couldn't go live". Poll the ingest
    // status, surfacing a 'waiting-for-ingest' stage so the widget can say
    // "Waiting for YouTube to receive stream…".
    this.emit('lifecycle', { stage: 'waiting-for-ingest', broadcastId, broadcastTitle })
    const ingestActive = await this.waitForStreamActive(streamId, cancelled)
    // An aborted wait means the session ended (or restarted) while we were
    // polling — say nothing. The old behavior let this poll run to its 90s
    // timeout and emit a late 'error' the renderer read as a new session:
    // it dismissed the post-stream modal mid-decision and cancelled the
    // pending 'always' auto-push.
    if (ingestActive === 'aborted' || cancelled()) return
    if (!ingestActive) {
      this.emit('lifecycle', {
        stage: 'error',
        broadcastId,
        broadcastTitle,
        error: "YouTube never started receiving the stream. Check that your streaming app is actually sending to the relay, then try again. (The broadcast wasn't set live.)",
      })
      return
    }

    // Broadcasts with enableMonitorStream:true (YouTube Studio's default
    // for manually-created broadcasts) MUST go ready → testing → live;
    // calling transition('live') from 'ready' directly is rejected with
    // an "invalid transition" error. SM-created broadcasts set
    // enableMonitorStream:false so they go straight ready → live, but
    // the user can also pick a broadcast they created externally — so
    // we check per-broadcast rather than assuming our own default.
    let needsTestingTransition = false
    try {
      const { clientId, clientSecret } = this.getCreds()
      const cd = await getBroadcastContentDetails(broadcastId, clientId, clientSecret)
      // Default-true semantics from YouTube: treat an undefined value as
      // monitor-on. Better to do a no-op testing transition on a
      // ready-direct broadcast (YouTube returns a redundant-transition
      // response that we retry past) than to skip and 100% fail on a
      // monitor-on broadcast.
      needsTestingTransition = cd?.enableMonitorStream !== false
      if (cancelled()) return
    } catch {
      // ContentDetails lookup failed — fall back to assuming testing is
      // needed. Same reasoning as above: an extra testing call is far
      // less harmful than skipping a required one.
      needsTestingTransition = true
    }

    if (needsTestingTransition) {
      try {
        const { clientId, clientSecret } = this.getCreds()
        await transitionBroadcast(broadcastId, 'testing', clientId, clientSecret)
      } catch {
        // If the broadcast doesn't actually need testing (enableMonitorStream:
        // false but our fallback assumed true), YouTube returns a
        // redundantTransition error — safe to ignore and proceed to live.
        // Any other failure surfaces on the live transition below, with
        // the same error message the user already knows how to recover
        // from (set live in YT Studio).
      }
      // Brief settle window — testStarting → testing can take a beat
      // before transition('live') is accepted. Same magnitude as the
      // existing transition retry cadence so the failure window is small.
      await new Promise(r => setTimeout(r, RelayOrchestrator.TRANSITION_RETRY_MS))
    }
    if (cancelled()) return

    // Stream is active — transition to live. A couple of quick retries cover
    // the brief window where 'active' is reported but transition still 409s.
    this.emit('lifecycle', { stage: 'going-live', broadcastId, broadcastTitle })
    const ok = await this.transitionToLiveWithRetry(broadcastId, cancelled)
    if (cancelled()) return
    if (ok) {
      this.liveBroadcastId = broadcastId
      this.liveBroadcastTitle = broadcastTitle
      this.emit('lifecycle', { stage: 'live', broadcastId, broadcastTitle })
    } else {
      this.emit('lifecycle', {
        stage: 'error',
        broadcastId,
        broadcastTitle,
        error: "Couldn't go live — YouTube was receiving the stream but rejected the transition. The stream is still flowing; you can set it live in YT Studio.",
      })
    }
  }

  /** Poll liveStreams.status until streamStatus === 'active' or we time out.
   *  Returns true if the stream went active. Aborts early if the relay stops
   *  mid-wait (graceTimer/no child) — handled implicitly because a later
   *  stream-stopped clears state, but the poll itself is bounded by the
   *  timeout regardless. */
  private async waitForStreamActive(streamId: string, cancelled: () => boolean): Promise<boolean | 'aborted'> {
    const deadline = Date.now() + RelayOrchestrator.INGEST_TIMEOUT_MS
    const { clientId, clientSecret } = this.getCreds()
    while (Date.now() < deadline) {
      if (cancelled()) return 'aborted'
      try {
        const { streamStatus } = await getStreamStatus(streamId, clientId, clientSecret)
        if (streamStatus === 'active') return true
        // 'error' is terminal — no point polling further.
        if (streamStatus === 'error') return false
      } catch {
        // Transient API hiccup — keep polling until the deadline.
      }
      await new Promise(r => setTimeout(r, RelayOrchestrator.INGEST_POLL_MS))
    }
    return false
  }

  // ─── Stream-stopped ─────────────────────────────────────────────────────

  private handleStreamStopped(): void {
    // Kill any in-flight handleStreamStarted (it may be deep in the 90s
    // ingest wait) — the session it was starting no longer exists.
    this.startSeq++

    // Stream-stopped without a clean SM go-live: either a false start
    // (accidental OBS start/stop that never got anywhere) or the user went
    // live manually after a bind/transition failure. One status read tells
    // them apart — the post-stream flow (Twitch auto-update / prompt) only
    // runs for sessions that ACTUALLY reached 'live'. A 3-second blip used
    // to push the next stream's metadata to Twitch 60s later, potentially
    // right as the real stream started.
    if (!this.liveBroadcastId) {
      const boundId = this.boundBroadcastId
      const boundTitle = this.boundBroadcastTitle ?? undefined
      this.boundBroadcastId = null
      this.boundBroadcastTitle = null
      void (async () => {
        let wentLive = false
        if (boundId) {
          try {
            const { clientId, clientSecret } = this.getCreds()
            const status = await getBroadcastLifeCycleStatus(boundId, clientId, clientSecret)
            wentLive = status === 'live' || status === 'liveStarting' || status === 'complete'
          } catch {
            // Can't verify → treat as not-live. Worst case the user pushes
            // to Twitch manually; the false-start auto-push was the far
            // worse failure mode.
          }
        }
        if (boundId && wentLive) {
          this.emit('lifecycle', {
            stage: 'completed',
            broadcastId: boundId,
            broadcastTitle: boundTitle,
          })
        } else {
          // Clears any transitional stage (binding / waiting-for-ingest)
          // the widget may still be showing for the aborted session.
          this.emit('lifecycle', { stage: 'idle' })
        }
        await activeBroadcastService.getUpcoming(true).catch(() => {})
        activeBroadcastService.unlockSession()
      })()
      return
    }

    const broadcastId = this.liveBroadcastId
    const broadcastTitle = this.liveBroadcastTitle ?? undefined
    this.graceStartedAt = Date.now()

    this.emit('lifecycle', {
      stage: 'grace',
      broadcastId,
      broadcastTitle,
      graceRemainingSec: Math.round(RelayOrchestrator.GRACE_MS / 1000),
    })

    // Tick the remaining-seconds count once per second so the widget can
    // render a countdown. Cancelled in clearGraceTimer().
    this.graceTick = setInterval(() => {
      const remaining = Math.max(0, Math.round((RelayOrchestrator.GRACE_MS - (Date.now() - this.graceStartedAt)) / 1000))
      this.emit('lifecycle', {
        stage: 'grace',
        broadcastId,
        broadcastTitle,
        graceRemainingSec: remaining,
      })
    }, 1000)

    this.graceTimer = setTimeout(async () => {
      this.clearGraceTimer()
      this.emit('lifecycle', { stage: 'completing', broadcastId, broadcastTitle })
      try {
        const { clientId, clientSecret } = this.getCreds()
        await transitionBroadcast(broadcastId, 'complete', clientId, clientSecret)
        this.emit('lifecycle', { stage: 'completed', broadcastId, broadcastTitle })
      } catch (e: any) {
        // Non-fatal — enableAutoStop is the safety net. Log the message so
        // the user can see what happened, but the broadcast will still
        // finalize within ~60s on YouTube's side.
        this.emit('lifecycle', {
          stage: 'error',
          broadcastId,
          broadcastTitle,
          error: `Couldn't finalize broadcast cleanly (YouTube will auto-finalize within ~60s): ${e?.message ?? e}`,
        })
      }
      this.liveBroadcastId = null
      this.liveBroadcastTitle = null
      this.boundBroadcastId = null
      this.boundBroadcastTitle = null
      // The completed broadcast's binding died with it — clear so the next
      // active-changed pre-binds the fresh pick instead of skipping (or
      // trying to unbind a completed broadcast).
      this.preBoundId = null
      // Refresh the upcoming list first (still pinned, so the widget doesn't
      // flicker), then release the pin — getActive() then reports the fresh
      // next-soonest auto-pick. Order matters: unlocking before the refresh
      // would briefly surface the just-completed broadcast.
      await activeBroadcastService.getUpcoming(true).catch(() => {})
      activeBroadcastService.unlockSession()
    }, RelayOrchestrator.GRACE_MS)
  }

  // ─── Helpers ────────────────────────────────────────────────────────────

  private clearGraceTimer(): void {
    if (this.graceTimer) { clearTimeout(this.graceTimer); this.graceTimer = null }
    if (this.graceTick) { clearInterval(this.graceTick); this.graceTick = null }
  }

  private async transitionToLiveWithRetry(broadcastId: string, cancelled?: () => boolean): Promise<boolean> {
    const { clientId, clientSecret } = this.getCreds()
    for (let attempt = 1; attempt <= RelayOrchestrator.MAX_LIVE_ATTEMPTS; attempt++) {
      if (cancelled?.()) return false
      try {
        await transitionBroadcast(broadcastId, 'live', clientId, clientSecret)
        return true
      } catch (e: any) {
        // Already live — happens when an externally-created broadcast has
        // Auto-start enabled: pre-binding means YouTube starts it itself the
        // moment ingest begins, and our transition comes back redundant.
        // That's success, not failure.
        if (/redundant/i.test(String(e?.message ?? e))) return true
        // Retry on any failure until the whole window is exhausted. Previously
        // we early-exited on errors that didn't match a "stream not active"
        // pattern, but YouTube's error wording varies enough that legitimate
        // "still warming up" failures would sometimes bail after one attempt
        // and surface a scary red error before the user's stream was even
        // ready. Wasting ~15s on a genuinely fatal error (auth revoked, bad
        // broadcast id) is the much better tradeoff.
        if (attempt === RelayOrchestrator.MAX_LIVE_ATTEMPTS) return false
        await new Promise(r => setTimeout(r, RelayOrchestrator.TRANSITION_RETRY_MS))
      }
    }
    return false
  }

  private async getStreamId(): Promise<string | null> {
    const store = getStore()
    const cfg = store.get('config') as any
    if (cfg?.streamRelayStreamId) return cfg.streamRelayStreamId
    // No cached id (user pasted the key without auto-fill) — look it up.
    try {
      const { clientId, clientSecret } = this.getCreds()
      const found = await findStreamIdByName(cfg?.streamRelayOutboundKey ?? '', clientId, clientSecret)
      if (found) {
        setConfigPartial({ streamRelayStreamId: found })
        return found
      }
    } catch {
      // Lookup failure handled by caller (returns null → error event)
    }
    return null
  }

  private getCreds(): { clientId: string; clientSecret: string } {
    const cfg = getStore().get('config') as any
    return {
      clientId: cfg?.youtubeClientId ?? '',
      clientSecret: cfg?.youtubeClientSecret ?? '',
    }
  }
}

export const relayOrchestrator = new RelayOrchestrator()
