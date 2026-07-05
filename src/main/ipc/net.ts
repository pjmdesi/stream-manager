import { ipcMain } from 'electron'

// Internet reachability probe. Used by the renderer to classify a failed
// YouTube request while the OS reports the network interface as up:
// probe fails → no actual internet (interface up, no route out);
// probe succeeds → the internet is fine and YouTube itself is the problem.
//
// Two independent providers so one CDN blip can't fake "internet down" —
// both are purpose-built connectivity endpoints with tiny responses.
// Promise.any resolves true on the FIRST success; only both failing
// (or timing out) reads as offline.
const PROBE_URLS = [
  'https://cloudflare.com/cdn-cgi/trace',
  'https://www.gstatic.com/generate_204',
]
const PROBE_TIMEOUT_MS = 3_000
// A burst of failing YT calls shouldn't re-probe each time — the answer
// can't meaningfully change within this window.
const RESULT_CACHE_MS = 30_000

let cached: { at: number; result: boolean } | null = null
let inFlight: Promise<boolean> | null = null

async function probeOne(url: string): Promise<boolean> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS)
  try {
    const res = await fetch(url, { method: 'GET', signal: ctrl.signal })
    return res.ok || res.status === 204
  } catch {
    return false
  } finally {
    clearTimeout(t)
  }
}

export async function checkInternet(): Promise<boolean> {
  if (cached && Date.now() - cached.at < RESULT_CACHE_MS) return cached.result
  if (inFlight) return inFlight
  inFlight = (async () => {
    let result: boolean
    try {
      await Promise.any(PROBE_URLS.map(u =>
        probeOne(u).then(ok => (ok ? true : Promise.reject(new Error('unreachable'))))
      ))
      result = true
    } catch {
      result = false
    }
    cached = { at: Date.now(), result }
    inFlight = null
    return result
  })()
  return inFlight
}

export function registerNetIPC(): void {
  ipcMain.handle('net:checkInternet', () => checkInternet())
}
