import { app } from 'electron'
import fs from 'fs'
import path from 'path'

// The one place the app writes logs (APP-20): `logs` under the config
// directory, one `.log` file per log. A log opens with a few `#` lines
// that say what it is, then holds a run of JSON records, each printed over
// several lines with a two-space indent and followed by a blank line, so
// the file reads in any text editor and still parses: a record opens with
// `{` at the start of a line and closes with `}` at the start of a line,
// and the indent gives nothing else that shape. Every record is stamped
// with `time` and the app version here, so pruning can read any log the
// same way. Local only: nothing in this folder is sent anywhere.

export function logsDir(): string {
  const dir = path.join(app.getPath('userData'), 'logs')
  try { fs.mkdirSync(dir, { recursive: true }) } catch { /* the write reports */ }
  return dir
}

export function logFilePath(name: string): string {
  return path.join(logsDir(), `${name}.log`)
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

/** Launch-time care for one log: the file exists with the current header
 *  (so the folder is never empty and a reader knows what the file is),
 *  records older than maxAgeDays are gone, and so is any text that is
 *  not a whole record (a write the app did not live to finish). A rewrite
 *  goes through a temp sibling that is flushed and then renamed over the
 *  log (the shape of the _meta.json write), so a crash mid-rewrite leaves
 *  either the old file or the new one. Synchronous and meant for launch,
 *  before anything can append to the log. */
export function initLog(name: string, opts: { header: string[]; maxAgeDays: number }): void {
  const file = logFilePath(name)
  let text = ''
  try { text = fs.readFileSync(file, 'utf-8') } catch { /* a new log */ }
  const { header, records, dropped } = parseLogRecords(text)
  const cutoff = Date.now() - opts.maxAgeDays * 86_400_000
  const kept = records.filter(r => {
    const t = typeof r.time === 'string' ? Date.parse(r.time) : NaN
    return !Number.isFinite(t) || t >= cutoff
  })
  const headerCurrent = header.join('\n') === opts.header.join('\n')
  if (text && headerCurrent && dropped === 0 && kept.length === records.length) return
  const tmp = `${file}.tmp`
  try {
    const fd = fs.openSync(tmp, 'w')
    try {
      fs.writeSync(fd, formatHeader(opts.header) + kept.map(formatRecord).join(''), null, 'utf-8')
      fs.fsyncSync(fd)
    } finally {
      fs.closeSync(fd)
    }
    fs.renameSync(tmp, file)
  } catch (err) {
    console.warn(`[logs] could not write ${name}.log:`, err)
    try { fs.unlinkSync(tmp) } catch { /* nothing to clean */ }
  }
}

/** Appends one record, flushed to disk before the call returns. Never
 *  throws: a log must not take down the job it describes, so a failed
 *  write is a console warning. */
export function appendLogRecord(name: string, record: Record<string, unknown>): void {
  const text = formatRecord({ time: localIsoTime(), app: app.getVersion(), ...record })
  try {
    const fd = fs.openSync(logFilePath(name), 'a')
    try {
      fs.writeSync(fd, text, null, 'utf-8')
      fs.fsyncSync(fd)
    } finally {
      fs.closeSync(fd)
    }
  } catch (err) {
    console.warn(`[logs] could not write ${name}.log:`, err)
  }
}

/** Reads a log back as records. A record the file cuts off (a write the
 *  app did not live to finish) is left out; the others still read. */
export function readLogRecords(name: string): Record<string, unknown>[] {
  let text: string
  try { text = fs.readFileSync(logFilePath(name), 'utf-8') } catch { return [] }
  return parseLogRecords(text).records
}

/** The header as it sits in the file: each line behind `# `, then a blank
 *  line. */
function formatHeader(lines: string[]): string {
  return lines.length ? lines.map(l => `# ${l}`).join('\n') + '\n\n' : ''
}

/** One record as it sits in the file: indented JSON and a blank line. */
function formatRecord(record: Record<string, unknown>): string {
  return JSON.stringify(record, null, 2) + '\n\n'
}

/** Splits a log's text into its header lines (the `#` lines outside any
 *  record, without the marker) and its records: each is the lines from a
 *  `{` at the start of a line through the next `}` at the start of a
 *  line. Text that is neither (a cut-off write, a stray line) is counted
 *  in `dropped`. */
export function parseLogRecords(text: string): { header: string[]; records: Record<string, unknown>[]; dropped: number } {
  const header: string[] = []
  const records: Record<string, unknown>[] = []
  let dropped = 0
  let chunk: string[] | null = null
  for (const line of text.split(/\r?\n/)) {
    if (line === '{') {
      // A record opening while another is still open: the earlier one
      // was cut off.
      if (chunk !== null) dropped++
      chunk = [line]
      continue
    }
    if (chunk === null) {
      if (line.startsWith('#')) header.push(line.replace(/^#\s?/, ''))
      else if (line.trim()) dropped++
      continue
    }
    chunk.push(line)
    if (line === '}') {
      try { records.push(JSON.parse(chunk.join('\n'))) } catch { dropped++ }
      chunk = null
    }
  }
  if (chunk !== null) dropped++
  return { header, records, dropped }
}
