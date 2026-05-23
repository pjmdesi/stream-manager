/**
 * Stream Relay orchestrator — the YouTube-lifecycle layer that sits on top
 * of the byte-pushing RelayManager. Subscribes to relay events and calls
 * liveBroadcasts.bind + transition('live') / transition('complete') against
 * the active broadcast.
 *
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
import { bindBroadcast, transitionBroadcast, findStreamIdByName } from '../youtubeApi'
import { getStore } from '../../ipc/store'

/** Stages the renderer can observe via the lifecycle event. Pure information —
 *  the orchestrator's behavior doesn't branch on which stage the UI shows. */
export type OrchestratorStage =
  | 'idle'                   // not in a stream session
  | 'no-broadcast'           // stream started but no active broadcast picked; SM doesn't orchestrate
  | 'binding'                // calling liveBroadcasts.bind
  | 'going-live'             // calling liveBroadcasts.transition('live')
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

  /** Max attempts when transition('live') is rejected for "stream not yet
   *  active". YouTube needs a few seconds to confirm ingest data; we retry
   *  every TRANSITION_RETRY_MS until it sticks or we give up. */
  private static MAX_LIVE_ATTEMPTS = 5
  private static TRANSITION_RETRY_MS = 3000

  private liveBroadcastId: string | null = null
  private liveBroadcastTitle: string | null = null
  private graceTimer: NodeJS.Timeout | null = null
  private graceTick: NodeJS.Timeout | null = null
  private graceStartedAt = 0

  constructor() {
    super()
    relayManager.on('stream-started', () => this.handleStreamStarted())
    relayManager.on('stream-stopped', () => this.handleStreamStopped())
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

    // Fresh stream start. Pull the active broadcast at this exact moment so a
    // later auto-pick refresh doesn't change what we bind to mid-session.
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

    // Look up streamId — cached from auto-fill, looked up if missing.
    const streamId = await this.getStreamId()
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
    } catch (e: any) {
      this.emit('lifecycle', {
        stage: 'error',
        broadcastId,
        broadcastTitle,
        error: `Couldn't bind broadcast: ${e?.message ?? e}`,
      })
      return
    }

    // Transition to live, with retries to ride out the "stream not yet
    // active" race (YouTube needs a few seconds of ingest data before it
    // accepts the transition).
    this.emit('lifecycle', { stage: 'going-live', broadcastId, broadcastTitle })
    const ok = await this.transitionToLiveWithRetry(broadcastId)
    if (ok) {
      this.liveBroadcastId = broadcastId
      this.liveBroadcastTitle = broadcastTitle
      this.emit('lifecycle', { stage: 'live', broadcastId, broadcastTitle })
    } else {
      this.emit('lifecycle', {
        stage: 'error',
        broadcastId,
        broadcastTitle,
        error: "Couldn't go live after multiple attempts. The stream is still flowing — try ending the broadcast in YT Studio if needed.",
      })
    }
  }

  // ─── Stream-stopped ─────────────────────────────────────────────────────

  private handleStreamStopped(): void {
    // Stream-stopped without ever having gone live (e.g. bind failed earlier,
    // or no-broadcast scenario) — nothing to finalize.
    if (!this.liveBroadcastId) return

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
    }, RelayOrchestrator.GRACE_MS)
  }

  // ─── Helpers ────────────────────────────────────────────────────────────

  private clearGraceTimer(): void {
    if (this.graceTimer) { clearTimeout(this.graceTimer); this.graceTimer = null }
    if (this.graceTick) { clearInterval(this.graceTick); this.graceTick = null }
  }

  private async transitionToLiveWithRetry(broadcastId: string): Promise<boolean> {
    const { clientId, clientSecret } = this.getCreds()
    for (let attempt = 1; attempt <= RelayOrchestrator.MAX_LIVE_ATTEMPTS; attempt++) {
      try {
        await transitionBroadcast(broadcastId, 'live', clientId, clientSecret)
        return true
      } catch (e: any) {
        const msg: string = e?.message ?? String(e)
        // YouTube returns this kind of error while the bound stream is still
        // negotiating; back off and try again. Other errors (auth, permission,
        // bad broadcast id) won't fix themselves with retries, so abort fast.
        const isRetryable = /stream.*status|status.*stream|not.*active|redundant.*transition/i.test(msg)
        if (!isRetryable || attempt === RelayOrchestrator.MAX_LIVE_ATTEMPTS) return false
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
        store.set('config', { ...cfg, streamRelayStreamId: found })
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
