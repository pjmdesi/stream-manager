import type { ChildProcess } from 'child_process'

/** The one list of ffmpeg children Stream Manager has spawned (CONV-17).
 *
 *  Every spawn site registers its child here with the thing in SM's own
 *  state that wants it running (a converter job, the single Combine run,
 *  the relay). That gives three things no single site had:
 *
 *  - kill-all at quit, so no encoder outlives the app;
 *  - an orphan sweep: a registered child whose owner no longer wants it
 *    (the job was cancelled, the run ended) but which is still alive is
 *    killed. Only SM's own bookkeeping is consulted, never the machine's
 *    process list, so an ffmpeg some other program runs is never touched;
 *  - counts by purpose, for diagnostics.
 *
 *  False positives are guarded two ways: a child counts as orphaned only
 *  after its owner has read as gone on two sweeps a few seconds apart (a
 *  teardown in progress is not an orphan), and an owner check that throws
 *  reads as "still wanted". */

export type FfmpegPurpose =
  | 'convert'       // converter job, fluent-ffmpeg path
  | 'clip-segment'  // clip export, phase 1 stream copy
  | 'clip-export'   // clip export, phase 2 encode
  | 'combine'
  | 'audio-extract' // player's multi-track audio extraction
  | 'waveform'
  | 'relay'
  | 'probe'         // encoder list and encoder runtime tests

/** The state a spawn site hands over: who owns the child in SM's terms and
 *  how to ask whether that owner still wants it. */
export interface ChildOwner {
  id: string
  isLive: () => boolean
}

interface TrackedChild {
  pid: number
  purpose: FfmpegPurpose
  owner: ChildOwner
  startedAt: number
  proc: ChildProcess
  /** First sweep that found the owner gone. The kill waits for a later
   *  sweep past ORPHAN_GRACE_MS so an in-progress teardown (the owner's
   *  own kill has been sent, the exit event has not landed yet) is not
   *  misread as an orphan. */
  orphanSince?: number
}

export interface TrackedChildInfo {
  pid: number
  purpose: FfmpegPurpose
  owner: string
  ageMs: number
}

const ORPHAN_GRACE_MS = 3000
const SWEEP_INTERVAL_MS = 10_000
/** Sweeps requested after a cancel: one soon, to catch a lost kill, and
 *  one past the grace period to carry it out. */
const REQUESTED_SWEEP_DELAYS_MS = [1500, ORPHAN_GRACE_MS + 2000]

const children = new Map<number, TrackedChild>()

/** An owner that is always live: the child is wanted until it exits on its
 *  own (an awaited one-shot such as a waveform read or an encoder probe).
 *  These still get the quit kill and the counts. */
export const UNTIL_EXIT = (id: string): ChildOwner => ({ id, isLive: () => true })

/** Register a child the moment it is spawned. Removes itself on exit. */
export function trackChild(proc: ChildProcess, purpose: FfmpegPurpose, owner: ChildOwner): void {
  const pid = proc.pid
  if (!pid) return
  children.set(pid, { pid, purpose, owner, startedAt: Date.now(), proc })
  const forget = () => { if (children.get(pid)?.proc === proc) children.delete(pid) }
  proc.once('exit', forget)
  proc.once('error', forget)
}

function kill(entry: TrackedChild, why: string): void {
  console.warn(`[ffmpegChildren] killing ffmpeg pid ${entry.pid} (${entry.purpose}, owner ${entry.owner.id}, ${Math.round((Date.now() - entry.startedAt) / 1000)} s old): ${why}`)
  try { entry.proc.kill('SIGKILL') } catch { /* already gone */ }
  children.delete(entry.pid)
}

function ownerLive(entry: TrackedChild): boolean {
  try { return entry.owner.isLive() } catch { return true }
}

/** Kill every registered child whose owner has read as gone for longer
 *  than the grace period. Returns how many were killed. */
export function sweepOrphans(now = Date.now()): number {
  let killed = 0
  for (const entry of [...children.values()]) {
    if (entry.proc.exitCode !== null || entry.proc.signalCode !== null) { children.delete(entry.pid); continue }
    if (ownerLive(entry)) { entry.orphanSince = undefined; continue }
    if (entry.orphanSince === undefined) { entry.orphanSince = now; continue }
    if (now - entry.orphanSince < ORPHAN_GRACE_MS) continue
    kill(entry, `no owner for ${Math.round((now - entry.orphanSince) / 1000)} s`)
    killed++
  }
  return killed
}

/** Kill every registered child now. For quit. Returns how many were sent
 *  the signal. */
export function killAllChildren(why = 'quit'): number {
  const live = [...children.values()]
  for (const entry of live) kill(entry, why)
  return live.length
}

let sweepTimer: NodeJS.Timeout | null = null
const requestedTimers = new Set<NodeJS.Timeout>()

/** Start the periodic sweep. Idempotent. */
export function startOrphanSweep(): void {
  if (sweepTimer) return
  sweepTimer = setInterval(() => { sweepOrphans() }, SWEEP_INTERVAL_MS)
  sweepTimer.unref()
}

/** Ask for prompt sweeps after an event that may have left an orphan (a
 *  cancel). Coalesces with any sweeps already requested. */
export function requestOrphanSweep(): void {
  if (requestedTimers.size > 0) return
  for (const delay of REQUESTED_SWEEP_DELAYS_MS) {
    const t = setTimeout(() => { requestedTimers.delete(t); sweepOrphans() }, delay)
    t.unref()
    requestedTimers.add(t)
  }
}

export function ffmpegChildCounts(): Partial<Record<FfmpegPurpose, number>> {
  const counts: Partial<Record<FfmpegPurpose, number>> = {}
  for (const c of children.values()) counts[c.purpose] = (counts[c.purpose] ?? 0) + 1
  return counts
}

export function trackedChildren(): TrackedChildInfo[] {
  const now = Date.now()
  return [...children.values()].map(c => ({ pid: c.pid, purpose: c.purpose, owner: c.owner.id, ageMs: now - c.startedAt }))
}
