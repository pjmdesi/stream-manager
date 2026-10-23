import { app } from 'electron'
import fs from 'fs'
import path from 'path'

// The one place the app writes logs (APP-20): `logs` under the config
// directory, one `.jsonl` file per log, one JSON record per line. Every
// record is stamped with `time` and the app version here, so pruning can
// read any log the same way. Local only: nothing in this folder is sent
// anywhere.

export function logsDir(): string {
  const dir = path.join(app.getPath('userData'), 'logs')
  try { fs.mkdirSync(dir, { recursive: true }) } catch { /* the write reports */ }
  return dir
}

export function logFilePath(name: string): string {
  return path.join(logsDir(), `${name}.jsonl`)
}

/** Local time with its UTC offset (`2026-10-23T14:05:11-04:00`): reads as
 *  the user's clock in the file and still parses with Date. */
export function localIsoTime(ms = Date.now()): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  const offset = -d.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  const abs = Math.abs(offset)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
}

/** Appends one record as a line. Never throws: a log must not take down
 *  the job it describes, so a failed write is a console warning. */
export function appendLogRecord(name: string, record: Record<string, unknown>): void {
  const line = JSON.stringify({ time: localIsoTime(), app: app.getVersion(), ...record })
  try {
    fs.appendFileSync(logFilePath(name), line + '\n', 'utf-8')
  } catch (err) {
    console.warn(`[logs] could not write ${name}.jsonl:`, err)
  }
}

/** Drops the lines whose `time` is older than maxAgeDays, rewriting the
 *  file through a temp name so a crash mid-rewrite loses nothing. Lines
 *  without a readable time are kept. Synchronous and meant for launch,
 *  before anything can append to the log. */
export function pruneLogByAge(name: string, maxAgeDays: number): void {
  const file = logFilePath(name)
  let text: string
  try { text = fs.readFileSync(file, 'utf-8') } catch { return }
  const cutoff = Date.now() - maxAgeDays * 86_400_000
  const lines = text.split('\n').filter(Boolean)
  const kept = lines.filter(line => {
    const stamp = /"time":"([^"]+)"/.exec(line)?.[1]
    const t = stamp ? Date.parse(stamp) : NaN
    return !Number.isFinite(t) || t >= cutoff
  })
  if (kept.length === lines.length) return
  const tmp = `${file}.tmp`
  try {
    fs.writeFileSync(tmp, kept.length ? kept.join('\n') + '\n' : '', 'utf-8')
    fs.renameSync(tmp, file)
  } catch (err) {
    console.warn(`[logs] could not prune ${name}.jsonl:`, err)
    try { fs.unlinkSync(tmp) } catch { /* nothing to clean */ }
  }
}
