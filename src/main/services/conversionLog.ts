import { appendLogRecord, localIsoTime, pruneLogByAge } from './appLogs'

// The conversion log (CONV-4): `logs/conversions.jsonl`, a record of every
// conversion, archive, clip export and combine the app actually ran. Each
// job writes two lines matched by `id`: a `start` line the moment its
// encoder is about to run (what is being made from what, with which
// settings) and an `end` line when it finishes (the outcome and the
// timings). A `start` with no later `end` for the same id is a job the app
// did not live to finish. A job that never reached its encoder (a download
// that failed or was cancelled) gets both lines at once. Queued jobs that
// were removed before running write nothing. Kept for a year.
//
// The callers (ipc/converter.ts, ipc/combine.ts) report what happens; the
// timing bookkeeping lives here so neither grows a clock of its own.

const LOG_NAME = 'conversions'
const MAX_AGE_DAYS = 365

export type JobLogKind = 'conversion' | 'archive' | 'clip-export' | 'combine'
export type JobLogOutcome = 'done' | 'error' | 'cancelled' | 'interrupted'

export interface JobLogInput { path: string; bytes?: number }

export interface JobLogPreset {
  id: string
  name: string
  builtin: boolean
  source?: string
  args: string
}

/** What ffprobe said about the input, folded into its `inputs` entry. */
export interface JobLogProbe {
  durationSec?: number
  width?: number
  height?: number
  videoCodec?: string
  fps?: number
  audioTracks?: number
}

export interface JobLogFields {
  kind: JobLogKind
  /** The owning stream's key, when the input lives in the library. */
  stream: string | null
  inputs: JobLogInput[]
  output: string
  preset: JobLogPreset | null
}

interface JobLogState {
  id: string
  fields: JobLogFields
  encode: { args: string; videoEncoder: string | null; audioEncoder: string | null } | null
  probe: JobLogProbe | null
  /** The media's length, for the speed figure. */
  durationSec: number
  /** When the start line was written; null until then. */
  startedAt: number | null
  downloadStartedAt: number | null
  downloadMs: number
  pausedAt: number | null
  pausedMs: number
  /** The first estimate the job's own progress allowed, kept beside the
   *  actual time so the two can be compared later (CONV-5). */
  firstEta: { atPercent: number; etaSec: number } | null
  /** The last progress figure, for how far a job that did not finish got. */
  percent: number
}

const states = new Map<string, JobLogState>()

/** Takes a job on. Idempotent: a job that downloads first and starts
 *  later keeps the state that holds its download time. */
export function openJobLog(id: string, fields: JobLogFields): void {
  if (states.has(id)) return
  states.set(id, {
    id, fields, encode: null, probe: null, durationSec: 0,
    startedAt: null, downloadStartedAt: null, downloadMs: 0,
    pausedAt: null, pausedMs: 0, firstEta: null, percent: 0,
  })
}

/** Forgets a job that went back to the queue before its encoder ran.
 *  Nothing was written for it. */
export function dropJobLog(id: string): void {
  states.delete(id)
}

export function noteDownloadStart(id: string): void {
  const s = states.get(id)
  if (s && s.downloadStartedAt == null) s.downloadStartedAt = Date.now()
}

export function noteDownloadEnd(id: string): void {
  const s = states.get(id)
  if (s) settleDownload(s)
}

/** Writes the start line: the encoder is about to run. */
export function startJobLog(
  id: string,
  details: { encodeArgs?: string; probe?: JobLogProbe | null; durationSec?: number }
): void {
  const s = states.get(id)
  if (!s || s.startedAt != null) return
  settleDownload(s)
  s.encode = details.encodeArgs
    ? { args: details.encodeArgs, videoEncoder: codecOf(details.encodeArgs, 'v'), audioEncoder: codecOf(details.encodeArgs, 'a') }
    : null
  s.probe = details.probe ?? null
  s.durationSec = details.durationSec ?? s.probe?.durationSec ?? 0
  writeStart(s)
}

export function noteJobPaused(id: string): void {
  const s = states.get(id)
  if (s && s.pausedAt == null) s.pausedAt = Date.now()
}

export function noteJobResumed(id: string): void {
  const s = states.get(id)
  if (s?.pausedAt != null) {
    s.pausedMs += Date.now() - s.pausedAt
    s.pausedAt = null
  }
}

/** The first progress sample that supports an estimate (a few percent in,
 *  a few seconds along) becomes the job's recorded ETA. */
export function noteJobProgress(id: string, percent: number): void {
  const s = states.get(id)
  if (!s) return
  if (Number.isFinite(percent)) s.percent = Math.min(100, Math.max(s.percent, percent))
  if (s.firstEta || s.startedAt == null) return
  if (!(percent >= 2 && percent < 100)) return
  const elapsedMs = encodeMs(s)
  if (elapsedMs < 5000) return
  s.firstEta = {
    atPercent: Math.round(percent * 10) / 10,
    etaSec: Math.round((elapsedMs / 1000) * (100 - percent) / percent),
  }
}

/** Writes the end line and forgets the job. A job with no start line yet
 *  (it never reached its encoder) gets one first, so every end has its
 *  start. No-op for a job this log never took on, such as a queued job
 *  that was cancelled. */
export function endJobLog(
  id: string,
  outcome: JobLogOutcome,
  opts?: { error?: string; reason?: string; outputBytes?: number; keptOriginal?: boolean }
): void {
  const s = states.get(id)
  if (!s) return
  states.delete(id)
  settleDownload(s)
  if (s.startedAt == null) writeStart(s)
  if (s.pausedAt != null) {
    s.pausedMs += Date.now() - s.pausedAt
    s.pausedAt = null
  }
  const endedAt = Date.now()
  const encodeSec = Math.round(encodeMs(s) / 100) / 10
  // How much of the media the encoder got through: all of it for a job
  // that finished, the last progress figure for one that did not. The
  // speed is media seconds per encoder second over that stretch.
  const percent = outcome === 'done' ? 100 : s.percent
  const encodedSec = s.durationSec * percent / 100
  appendLogRecord(LOG_NAME, {
    event: 'end',
    id,
    ...identity(s),
    outcome,
    error: opts?.error,
    reason: opts?.reason,
    startedAt: localIsoTime(s.startedAt!),
    endedAt: localIsoTime(endedAt),
    percent: outcome === 'done' ? undefined : Math.round(percent * 10) / 10,
    downloadSec: s.downloadMs > 0 ? Math.round(s.downloadMs / 100) / 10 : undefined,
    encodeSec,
    pausedSec: s.pausedMs > 0 ? Math.round(s.pausedMs / 100) / 10 : undefined,
    speed: encodedSec > 0 && encodeSec > 0 ? Math.round((encodedSec / encodeSec) * 100) / 100 : undefined,
    firstEta: s.firstEta ?? undefined,
    outputBytes: opts?.outputBytes,
    keptOriginal: opts?.keptOriginal || undefined,
  })
}

/** Ends every job still open, for a quit: the encoders die with the app,
 *  and the log says so instead of leaving their start lines to read as a
 *  crash. */
export function endOpenJobLogs(reason: string): void {
  for (const id of [...states.keys()]) endJobLog(id, 'interrupted', { reason })
}

/** Launch-time retention. Synchronous, so it runs before any job can add
 *  a line the rewrite would lose. */
export function pruneConversionLog(): void {
  pruneLogByAge(LOG_NAME, MAX_AGE_DAYS)
}

function writeStart(s: JobLogState): void {
  s.startedAt = Date.now()
  appendLogRecord(LOG_NAME, {
    event: 'start',
    id: s.id,
    ...identity(s),
    startedAt: localIsoTime(s.startedAt),
  })
}

/** The fields both lines carry: what was made from what, with which
 *  settings. The end line repeats them so it reads on its own. */
function identity(s: JobLogState): Record<string, unknown> {
  const inputs = s.fields.inputs.map((input, i) => (i === 0 && s.probe ? { ...input, ...s.probe } : input))
  return {
    kind: s.fields.kind,
    stream: s.fields.stream,
    inputs,
    output: s.fields.output,
    preset: s.fields.preset,
    encode: s.encode,
  }
}

function settleDownload(s: JobLogState): void {
  if (s.downloadStartedAt == null) return
  s.downloadMs += Date.now() - s.downloadStartedAt
  s.downloadStartedAt = null
}

/** Encoder wall time so far: since the start line, less any pause. */
function encodeMs(s: JobLogState): number {
  if (s.startedAt == null) return 0
  const now = Date.now()
  const pausedNow = s.pausedAt != null ? now - s.pausedAt : 0
  return Math.max(0, now - s.startedAt - s.pausedMs - pausedNow)
}

/** The codec ffmpeg was told to use for one stream type, from the final
 *  argument string: `-c:v hevc_nvenc`, `-vcodec libx264`, or a bare
 *  `-c copy` that covers both. */
function codecOf(args: string, type: 'v' | 'a'): string | null {
  const specific = type === 'v'
    ? /(?:^|\s)-(?:c:v|vcodec|codec:v)\s+(\S+)/
    : /(?:^|\s)-(?:c:a|acodec|codec:a)\s+(\S+)/
  const m = specific.exec(args) ?? /(?:^|\s)-c\s+(\S+)/.exec(args)
  return m ? m[1] : null
}
