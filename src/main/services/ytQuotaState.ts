/**
 * YouTube API quota-exceeded tracker.
 *
 * Sticky in-memory flag set when `ytRequest` observes a 403 with
 * `reason: 'quotaExceeded'` from the YouTube Data API. Daily quotas
 * reset at midnight Pacific Time per Google's documented behavior, so
 * we compute the next PT-midnight at the time the flag is set, expose
 * it as `resetsAt`, and auto-clear the flag once the current instant
 * passes that boundary. Auto-clear means the renderer doesn't have to
 * poll or re-check via API to know quota is back — just reading
 * `getQuotaState()` gives a fresh answer.
 *
 * A small change subscriber pattern (used by the IPC layer) emits
 * `quota-changed` to webContents so the renderer can react without
 * polling: a banner appears the moment quota is exceeded and
 * disappears the moment it resets.
 */

import { BrowserWindow } from 'electron'

export interface QuotaState {
  exceeded: boolean
  /** ISO timestamp of the next midnight Pacific Time after the flag
   *  was set. Null when not exceeded. */
  resetsAt: string | null
}

let exceededAt: Date | null = null
let resetsAtCached: Date | null = null
// Dev-only: when true, getQuotaState() reports exceeded regardless of
// the real flag. Lets us exercise quota-outage UI paths without
// burning real API quota. Toggled via IPC from the Dev Tools section
// of Settings (guarded to dev builds in the renderer).
let forcedExceeded = false

/** Returns the next instant that is 00:00:00 in America/Los_Angeles
 *  as a Date in UTC. Handles PDT/PST automatically — picks whichever
 *  of UTC-7 / UTC-8 yields 00:00 PT when read back through Intl in
 *  that timezone. */
export function nextMidnightPT(from: Date = new Date()): Date {
  // Get the current calendar date in PT (en-CA gives YYYY-MM-DD).
  const ptDateStr = from.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
  const [y, m, d] = ptDateStr.split('-').map(Number)
  // Candidate 1: PDT (UTC-7) — midnight PT = 07:00 UTC the next PT day.
  const candidatePDT = new Date(Date.UTC(y, m - 1, d + 1, 7, 0, 0))
  // Candidate 2: PST (UTC-8) — midnight PT = 08:00 UTC the next PT day.
  const candidatePST = new Date(Date.UTC(y, m - 1, d + 1, 8, 0, 0))
  // Pick the one that actually reads as 00:00 in LA. Whichever passes
  // is correct for the current DST window; the other will not.
  const isMidnightLA = (d: Date) => d.toLocaleTimeString('en-US', {
    timeZone: 'America/Los_Angeles', hour12: false, hour: '2-digit',
  }) === '00'
  return isMidnightLA(candidatePDT) ? candidatePDT : candidatePST
}

/** Mark quota as exceeded. No-op if already marked + still valid;
 *  re-extends the reset time if the flag had been auto-cleared but
 *  the caller observed a fresh 403. */
export function markQuotaExceeded(): void {
  // If we're past the previously-cached resetsAt, the flag should be
  // re-set from scratch (covers the "quota reset, then exceeded
  // again" case). Otherwise this is a re-mark — leave existing
  // resetsAt alone so the renderer's countdown stays stable.
  if (!exceededAt || !resetsAtCached || Date.now() >= resetsAtCached.getTime()) {
    exceededAt = new Date()
    resetsAtCached = nextMidnightPT(exceededAt)
    emitChange()
  }
}

/** Returns the current quota state. Lazy auto-clears if we've passed
 *  the cached `resetsAt` — callers don't need to poll a clear-loop.
 *  Honours the dev-only `forcedExceeded` flag so we can exercise
 *  outage paths without hitting a real 403; the synthetic resetsAt
 *  rolls forward if the day flips while the toggle is on so the
 *  banner's countdown stays accurate. */
export function getQuotaState(): QuotaState {
  if (forcedExceeded) {
    if (!resetsAtCached || Date.now() >= resetsAtCached.getTime()) {
      resetsAtCached = nextMidnightPT()
    }
    return { exceeded: true, resetsAt: resetsAtCached.toISOString() }
  }
  if (!exceededAt || !resetsAtCached) return { exceeded: false, resetsAt: null }
  if (Date.now() >= resetsAtCached.getTime()) {
    exceededAt = null
    resetsAtCached = null
    emitChange()
    return { exceeded: false, resetsAt: null }
  }
  return { exceeded: true, resetsAt: resetsAtCached.toISOString() }
}

/** Dev-only: force the quota gate to report exceeded. Idempotent.
 *  Synthesizes a resetsAt when no real outage is in flight so the
 *  emitted state shape matches a real 403 exactly (renderer banner,
 *  countdown, gated effects all behave the same). */
export function setForcedExceeded(forced: boolean): void {
  if (forcedExceeded === forced) return
  forcedExceeded = forced
  if (forced) {
    if (!resetsAtCached) resetsAtCached = nextMidnightPT()
  } else if (!exceededAt) {
    // No real outage running — clear our synthetic reset so a future
    // real outage starts fresh from its own moment.
    resetsAtCached = null
  }
  emitChange()
}

export function isForcedExceeded(): boolean { return forcedExceeded }

/** Forces a manual clear — used by the IPC reset path if we ever want
 *  to expose "try anyway" to the user. Not wired yet but cheap to
 *  keep here. */
export function clearQuotaExceeded(): void {
  if (!exceededAt) return
  exceededAt = null
  resetsAtCached = null
  emitChange()
}

function emitChange(): void {
  // Funnels through getQuotaState so the synthetic-resetsAt path stays
  // in one place — guarantees the pushed shape always matches what a
  // fresh read would return.
  const state = getQuotaState()
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('youtube:quota-changed', state)
  }
}
