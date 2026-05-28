/**
 * Active-broadcast service for the Stream Relay feature.
 *
 * Maintains the renderer-facing concept of "which YouTube broadcast does
 * the relay route to right now?" — derived from:
 *   1. A cached list of the user's upcoming broadcasts (refetched as needed)
 *   2. A persisted manual pick (electron-store) — survives SM restarts
 *
 * The "effective active" broadcast is:
 *   - the manual pick, if it's still in the upcoming list
 *   - else the soonest-upcoming broadcast (by scheduledStartTime)
 *   - else null (nothing to bind to)
 *
 * This service is *passive* in Phase 1b — it just holds and exposes the
 * picked broadcast. Phase 1c will subscribe to RelayManager's stream-started
 * event and call liveBroadcasts.bind + transition('live') against whatever
 * `getActive()` returns at that moment.
 */
import { EventEmitter } from 'events'
import { getLiveBroadcasts } from '../youtubeApi'
import type { LiveBroadcast } from '../youtubeApi'
import { getStore } from '../../ipc/store'

export interface ActivePickResult {
  /** The broadcast that the relay should bind to on next stream-start. */
  broadcast: LiveBroadcast | null
  /** True if the user explicitly picked this one (vs. SM auto-picking). */
  isManual: boolean
  /** True if a manual pick was set but is no longer in the upcoming list
   *  (e.g., the broadcast was deleted or already aired). UI should surface
   *  this so the user can re-pick or accept the fallback. */
  manualPickStale: boolean
  /** True while this broadcast is the one the relay is actively streaming to
   *  this session (pinned by the orchestrator). Distinguishes "currently
   *  live" from "next auto-pick" in the UI. */
  isLiveSession?: boolean
}

class ActiveBroadcastService extends EventEmitter {
  private upcoming: LiveBroadcast[] = []
  private lastFetchAt = 0
  private fetchInFlight: Promise<LiveBroadcast[]> | null = null
  /** While a stream session is active, the orchestrator pins the bound
   *  broadcast here. getActive() returns it regardless of the upcoming
   *  list — otherwise, once YouTube flips its lifeCycleStatus to 'live'
   *  the doFetch filter drops it and the auto-pick would jump to the next
   *  upcoming broadcast mid-stream. Cleared when the session ends. */
  private sessionBroadcast: LiveBroadcast | null = null

  /** Stale-while-revalidate cache window. 30s is plenty for "the user just
   *  scheduled a new broadcast and expects to see it in the picker" without
   *  spamming the YT API on every dropdown open. */
  private static CACHE_MS = 30_000

  /** Returns the cached upcoming list, refetching if stale or forced. Multiple
   *  callers during an in-flight fetch share the same promise. */
  async getUpcoming(force = false): Promise<LiveBroadcast[]> {
    const now = Date.now()
    if (!force && now - this.lastFetchAt < ActiveBroadcastService.CACHE_MS) {
      return this.upcoming
    }
    if (this.fetchInFlight) return this.fetchInFlight
    this.fetchInFlight = this.doFetch()
    try {
      return await this.fetchInFlight
    } finally {
      this.fetchInFlight = null
    }
  }

  /** Compute the effective active broadcast given the current cache + store
   *  state. Doesn't trigger a refetch — pair with getUpcoming() if you want
   *  freshness. */
  /** Pin the broadcast the relay is streaming to this session. Keeps the
   *  widget showing the live broadcast even after YouTube flips its status
   *  to 'live' (which would otherwise drop it from the upcoming list). */
  lockSession(broadcast: LiveBroadcast): void {
    this.sessionBroadcast = broadcast
    this.emit('active-changed', this.getActive())
  }
  /** Release the session pin (stream ended). Reverts to the normal
   *  manual-pick / soonest-upcoming logic. */
  unlockSession(): void {
    if (!this.sessionBroadcast) return
    this.sessionBroadcast = null
    this.emit('active-changed', this.getActive())
  }

  getActive(): ActivePickResult {
    // Active stream session pins its broadcast — report it as live so the
    // widget doesn't jump to the next-upcoming when YouTube marks the
    // current one 'live' and the fetch filter removes it from `upcoming`.
    if (this.sessionBroadcast) {
      return { broadcast: this.sessionBroadcast, isManual: false, manualPickStale: false, isLiveSession: true }
    }
    const cfg = getStore().get('config') as any
    const manualId: string = cfg?.streamRelayActiveBroadcastId ?? ''
    const upcoming = this.upcoming

    if (manualId) {
      const found = upcoming.find(b => b.id === manualId)
      if (found) return { broadcast: found, isManual: true, manualPickStale: false }
      // Manual pick no longer in upcoming — fall through to auto-pick but
      // flag the staleness so the UI can prompt the user.
      const auto = pickSoonest(upcoming)
      return { broadcast: auto, isManual: false, manualPickStale: true }
    }
    const auto = pickSoonest(upcoming)
    return { broadcast: auto, isManual: false, manualPickStale: false }
  }

  /** Persist the user's manual pick. Pass null to clear (= revert to auto). */
  setManualPick(broadcastId: string | null): ActivePickResult {
    const store = getStore()
    const current = store.get('config') as any
    store.set('config', {
      ...current,
      streamRelayActiveBroadcastId: broadcastId ?? '',
      streamRelayActivePickedAt: broadcastId ? Date.now() : 0,
    })
    const result = this.getActive()
    this.emit('active-changed', result)
    return result
  }

  private async doFetch(): Promise<LiveBroadcast[]> {
    const cfg = getStore().get('config') as any
    const clientId: string = cfg?.youtubeClientId ?? ''
    const clientSecret: string = cfg?.youtubeClientSecret ?? ''
    if (!clientId || !clientSecret) {
      this.upcoming = []
      this.lastFetchAt = Date.now()
      return []
    }
    try {
      const broadcasts = await getLiveBroadcasts(clientId, clientSecret)
      // Filter by lifeCycleStatus rather than scheduledStartTime: a broadcast
      // the user scheduled for earlier today (or yesterday) that they never
      // started is still a valid bind target. getLiveBroadcasts already drops
      // 'complete', so we only need to exclude in-flight ones here.
      this.upcoming = broadcasts.filter(b => {
        const lc = b.status?.lifeCycleStatus
        return lc !== 'live' && lc !== 'liveStarting' && lc !== 'complete'
      })
      this.lastFetchAt = Date.now()
      this.emit('upcoming-changed', this.upcoming)
      // Recompute the active pick now that the cache has changed — without
      // this, any caller that ran getActive() against the empty initial cache
      // would be stuck with broadcast:null until they manually re-queried.
      this.emit('active-changed', this.getActive())
      return this.upcoming
    } catch (err) {
      // Failed — keep the old cache (don't blow away usable data) but reset
      // the timestamp so callers can retry sooner than the 30s window.
      this.lastFetchAt = Date.now() - (ActiveBroadcastService.CACHE_MS - 5000)
      throw err
    }
  }
}

/** Prefer the soonest future-scheduled broadcast; if every broadcast is in
 *  the past, fall back to the most-recently-scheduled one (closest to now).
 *  Returns null if the list is empty. */
function pickSoonest(broadcasts: LiveBroadcast[]): LiveBroadcast | null {
  if (broadcasts.length === 0) return null
  const now = Date.now()
  const withTime = broadcasts.map(b => ({
    b,
    t: new Date(b.snippet?.scheduledStartTime ?? 0).getTime(),
  }))
  const future = withTime.filter(x => x.t >= now).sort((a, b) => a.t - b.t)
  if (future.length > 0) return future[0].b
  const past = [...withTime].sort((a, b) => b.t - a.t)
  return past[0].b
}

export const activeBroadcastService = new ActiveBroadcastService()
