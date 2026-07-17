import { spawn, spawnSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'

// Windows Cloud Files API integration. Drives Synology Drive Client / OneDrive /
// Dropbox / iCloud "Free up space" semantics provider-agnostically.
//
// Two-step offload:
//   1. attrib +U -P  — clear PINNED, set UNPINNED (placeholders allowed).
//   2. CfDehydratePlaceholder — immediate eviction. Pinned files reject this
//      with ERROR_CLOUD_FILE_INVALID_REQUEST (0x80070188), so step 1 must run
//      first.
//
// Pin-and-hydrate is the inverse:
//   1. attrib +P -U  — set PINNED. Synology Drive honors this lazily, so we
//      can't trust it to actually download; step 2 is the workhorse.
//   2. CfHydratePlaceholder — synchronous; blocks until the provider has
//      streamed the full file local.

const REPARSE_POINT = 0x400
const OFFLINE_MASK = 0x1000 | 0x40000 | 0x400000

// Per-direction concurrency. Each unit is one PowerShell process running one
// CFAPI call; provider contention (Synology Drive / OneDrive / etc.) caps
// the useful number well before host CPU/RAM matters. 4 strikes a balance:
// large enough to amortize PowerShell startup overhead and overlap network
// transfers, small enough to stay below typical provider rate limits.
export const DEHYDRATE_CONCURRENCY = 4
export const HYDRATE_CONCURRENCY = 4

export interface CloudOpResult {
  ok: string[]
  failed: { path: string; reason: string }[]
}

// Friendly translations for HRESULTs CFAPI commonly returns. The raw code is
// kept in the string so it stays searchable. Only codes we've verified are
// listed — anything else passes through untranslated.
const CLOUD_HRESULT_HINTS: Record<string, string> = {
  // ERROR_NOT_A_CLOUD_FILE: the sync client hasn't converted this file into a
  // placeholder (not uploaded yet, or it lost track of it), so there is no
  // cloud copy to offload to / recall from.
  '0x80070178': 'This file is not synced to the cloud yet (the sync client has not uploaded it), so there is no cloud copy. Check that your sync client is running and fully synced, then retry',
  // ERROR_CLOUD_FILE_PROVIDER_NOT_RUNNING
  '0x8007016A': 'The cloud sync client is not running',
  // ERROR_CLOUD_FILE_INVALID_REQUEST
  '0x8007017C': 'The cloud provider rejected the operation as invalid',
  // Synology rejects operations with this while another process holds the file
  '0x80070187': 'The cloud provider could not complete the operation, the file may be in use',
}

function friendlyCloudReason(reason: string): string {
  const m = reason.match(/0x[0-9A-Fa-f]{8}/)
  if (!m) return reason
  const code = '0x' + m[0].slice(2).toUpperCase()
  const hint = CLOUD_HRESULT_HINTS[code]
  return hint ? `${hint} (${code})` : reason
}

// Per-file dehydrate script — same shape as the spike that's known to work.
// We write it to a temp file once and invoke `powershell.exe -File` per path.
// CALLER must pause the chokidar streams watcher around this call — its
// ReadDirectoryChangesW handles otherwise cause Synology to reject
// CfDehydratePlaceholder with HRESULT 0x80070187 (file in use).
//
// Output is a single status token on the last stdout line:
//   OK                      — was hydrated, now a verified placeholder
//   SKIP-ALREADY-OFFLINE    — was already a placeholder, no work done
//   ERR|||<reason>          — failed at any step
const DEHYDRATE_SCRIPT = `
param([Parameter(Mandatory=$true, Position=0)][string]$Path)
$ErrorActionPreference = 'Continue'
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class CFAPI {
    [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
    public static extern IntPtr CreateFileW(string n, uint a, uint s, IntPtr sa, uint c, uint f, IntPtr t);
    [DllImport("kernel32.dll", SetLastError=true)]
    public static extern bool CloseHandle(IntPtr h);
    [DllImport("cldapi.dll", SetLastError=true)]
    public static extern int CfDehydratePlaceholder(IntPtr h, long off, long len, uint flags, IntPtr o);
}
"@
# Bail early if already a placeholder. OFFLINE | RECALL_ON_OPEN | RECALL_ON_DATA_ACCESS = 0x441000.
$attrs = [int][System.IO.File]::GetAttributes($Path)
if (($attrs -band 0x441000) -ne 0) {
  Write-Output "SKIP-ALREADY-OFFLINE"
  exit 0
}
& attrib +U -P $Path 2>$null
$len = (Get-Item -LiteralPath $Path).Length
$GENERIC_RW = [Convert]::ToUInt32('C0000000', 16)
$h = [CFAPI]::CreateFileW($Path, $GENERIC_RW, [uint32]7, [IntPtr]::Zero, [uint32]3, [uint32]0x02000000, [IntPtr]::Zero)
if ($h -eq [IntPtr]::new(-1)) {
  Write-Output ("ERR|||CreateFile " + [Runtime.InteropServices.Marshal]::GetLastWin32Error())
  exit 1
}
$hr = [CFAPI]::CfDehydratePlaceholder($h, 0, $len, 0, [IntPtr]::Zero)
[CFAPI]::CloseHandle($h) | Out-Null
if ($hr -ne 0) {
  Write-Output ("ERR|||HRESULT 0x" + ('{0:X8}' -f $hr))
  exit 1
}
# Verify: re-read attributes and confirm an offline/recall flag is now set.
$verify = [int][System.IO.File]::GetAttributes($Path)
if (($verify -band 0x441000) -ne 0) { Write-Output "OK" }
else { Write-Output ("ERR|||dehydrate reported success but file still local (0x" + ('{0:X}' -f $verify) + ')') }
`

let dehydrateScriptPath: string | null = null
function getDehydrateScriptPath(): string {
  if (dehydrateScriptPath && fs.existsSync(dehydrateScriptPath)) return dehydrateScriptPath
  const p = path.join(os.tmpdir(), `stream-manager-dehydrate-${process.pid}.ps1`)
  fs.writeFileSync(p, DEHYDRATE_SCRIPT, 'utf8')
  dehydrateScriptPath = p
  return p
}

export type DehydrateOutcome = 'ok' | 'already-offline' | 'failed'

function runOnePath(scriptPath: string, filePath: string): Promise<{ outcome: DehydrateOutcome; reason?: string }> {
  return new Promise(resolve => {
    let stdout = ''
    let stderr = ''
    const proc = spawn('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', scriptPath, filePath
    ])
    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString() })
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString() })
    proc.on('close', () => {
      const lines = stdout.trim().split(/\r?\n/).filter(Boolean)
      const last = lines[lines.length - 1] ?? ''
      if (last === 'OK') { resolve({ outcome: 'ok' }); return }
      if (last === 'SKIP-ALREADY-OFFLINE') { resolve({ outcome: 'already-offline' }); return }
      if (last.startsWith('ERR|||')) { resolve({ outcome: 'failed', reason: friendlyCloudReason(last.slice(6)) }); return }
      resolve({ outcome: 'failed', reason: stderr.trim() || 'no-output' })
    })
    proc.on('error', err => resolve({ outcome: 'failed', reason: err.message }))
  })
}

/** Dehydrate a single file. Building block for callers that own their own
 *  worker pool (cloudSync's shared per-direction queue); dehydratePaths
 *  below remains for one-shot batch callers (converter archive hook). */
export function dehydrateOnePath(filePath: string): Promise<{ outcome: DehydrateOutcome; reason?: string }> {
  if (process.platform !== 'win32') return Promise.resolve({ outcome: 'failed', reason: 'not-windows' })
  return runOnePath(getDehydrateScriptPath(), filePath)
}

export interface DehydrateProgressEvent {
  path: string
  status: 'running' | 'done' | 'already-offline' | 'failed'
  reason?: string
}

/**
 * Dehydrate files with up to DEHYDRATE_CONCURRENCY in flight at a time,
 * emitting progress per file via `onProgress`. Workers pull from a shared
 * cursor, so a slow file doesn't block the rest of the batch.
 *
 * Cancel via `shouldCancel()` is checked at the start of each file. Files
 * already in flight when cancel fires are allowed to finish — we never
 * interrupt CfDehydratePlaceholder mid-call (which could leave the file in
 * an intermediate state).
 */
export async function dehydratePaths(
  paths: string[],
  onProgress?: (event: DehydrateProgressEvent) => void,
  shouldCancel?: () => boolean
): Promise<CloudOpResult & { skippedAlreadyOffline: string[]; cancelled: boolean }> {
  if (process.platform !== 'win32' || paths.length === 0) {
    return { ok: [], failed: paths.map(p => ({ path: p, reason: 'not-windows' })), skippedAlreadyOffline: [], cancelled: false }
  }
  const scriptPath = getDehydrateScriptPath()
  const ok: string[] = []
  const failed: { path: string; reason: string }[] = []
  const skippedAlreadyOffline: string[] = []
  let cancelled = false
  // Shared cursor. The single-threaded event loop makes `next++` safe across
  // workers without explicit locking.
  let next = 0
  const worker = async (): Promise<void> => {
    while (true) {
      if (shouldCancel?.()) { cancelled = true; return }
      const i = next++
      if (i >= paths.length) return
      const p = paths[i]
      onProgress?.({ path: p, status: 'running' })
      const result = await runOnePath(scriptPath, p)
      if (result.outcome === 'ok') {
        ok.push(p)
        onProgress?.({ path: p, status: 'done' })
      } else if (result.outcome === 'already-offline') {
        skippedAlreadyOffline.push(p)
        onProgress?.({ path: p, status: 'already-offline' })
      } else {
        failed.push({ path: p, reason: result.reason ?? 'unknown' })
        onProgress?.({ path: p, status: 'failed', reason: result.reason })
      }
    }
  }
  const workerCount = Math.min(DEHYDRATE_CONCURRENCY, paths.length)
  await Promise.all(Array.from({ length: workerCount }, () => worker()))
  return { ok, failed, skippedAlreadyOffline, cancelled }
}

// Per-file pin-and-hydrate script. Inverse of DEHYDRATE_SCRIPT and meant to
// be invoked the same way (one PowerShell process per file so we get
// per-file progress events).
//
// Steps:
//   1. attrib +P -U   — set PINNED ("always keep local"), clear UNPINNED.
//      Required because Synology Drive Client honors +P lazily; we still
//      drive the actual download via CfHydratePlaceholder below.
//   2. If file already lacks any offline/recall flag, exit SKIP-ALREADY-LOCAL.
//   3. Open the file with CreateFileW (FILE_FLAG_OPEN_REPARSE_POINT, 0x02000000).
//   4. CfHydratePlaceholder(0, len, 0, NULL) — synchronous; blocks until the
//      provider has streamed the full file local. Slow; can take many minutes
//      on large files / slow links.
//   5. Verify offline flags are cleared.
//
// Output is a single status token on the last stdout line:
//   OK                      — was a placeholder, now fully local
//   SKIP-ALREADY-LOCAL      — was already local, no work done
//   ERR|||<reason>          — failed at any step
const HYDRATE_SCRIPT = `
param([Parameter(Mandatory=$true, Position=0)][string]$Path)
$ErrorActionPreference = 'Continue'
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class CFAPI {
    [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
    public static extern IntPtr CreateFileW(string n, uint a, uint s, IntPtr sa, uint c, uint f, IntPtr t);
    [DllImport("kernel32.dll", SetLastError=true)]
    public static extern bool CloseHandle(IntPtr h);
    [DllImport("cldapi.dll", SetLastError=true)]
    public static extern int CfHydratePlaceholder(IntPtr h, long off, long len, uint flags, IntPtr o);
}
"@
& attrib +P -U $Path 2>$null | Out-Null
# OFFLINE | RECALL_ON_OPEN | RECALL_ON_DATA_ACCESS = 0x441000.
$attrs = [int][System.IO.File]::GetAttributes($Path)
if (($attrs -band 0x441000) -eq 0) {
  Write-Output "SKIP-ALREADY-LOCAL"
  exit 0
}
$len = (Get-Item -LiteralPath $Path).Length
$GENERIC_RW = [Convert]::ToUInt32('C0000000', 16)
$h = [CFAPI]::CreateFileW($Path, $GENERIC_RW, [uint32]7, [IntPtr]::Zero, [uint32]3, [uint32]0x02000000, [IntPtr]::Zero)
if ($h -eq [IntPtr]::new(-1)) {
  Write-Output ("ERR|||CreateFile " + [Runtime.InteropServices.Marshal]::GetLastWin32Error())
  exit 1
}
$hr = [CFAPI]::CfHydratePlaceholder($h, 0, $len, 0, [IntPtr]::Zero)
[CFAPI]::CloseHandle($h) | Out-Null
if ($hr -ne 0) {
  Write-Output ("ERR|||HRESULT 0x" + ('{0:X8}' -f $hr))
  exit 1
}
$verify = [int][System.IO.File]::GetAttributes($Path)
if (($verify -band 0x441000) -eq 0) { Write-Output "OK" }
else { Write-Output ("ERR|||hydrate reported success but file still offline (0x" + ('{0:X}' -f $verify) + ')') }
`

let hydrateScriptPath: string | null = null
function getHydrateScriptPath(): string {
  if (hydrateScriptPath && fs.existsSync(hydrateScriptPath)) return hydrateScriptPath
  const p = path.join(os.tmpdir(), `stream-manager-hydrate-${process.pid}.ps1`)
  fs.writeFileSync(p, HYDRATE_SCRIPT, 'utf8')
  hydrateScriptPath = p
  return p
}

export type HydrateOutcome = 'ok' | 'already-local' | 'failed'

function runOneHydrate(scriptPath: string, filePath: string): Promise<{ outcome: HydrateOutcome; reason?: string }> {
  return new Promise(resolve => {
    let stdout = ''
    let stderr = ''
    const proc = spawn('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', scriptPath, filePath
    ])
    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString() })
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString() })
    proc.on('close', () => {
      const lines = stdout.trim().split(/\r?\n/).filter(Boolean)
      const last = lines[lines.length - 1] ?? ''
      if (last === 'OK') { resolve({ outcome: 'ok' }); return }
      if (last === 'SKIP-ALREADY-LOCAL') { resolve({ outcome: 'already-local' }); return }
      if (last.startsWith('ERR|||')) { resolve({ outcome: 'failed', reason: friendlyCloudReason(last.slice(6)) }); return }
      resolve({ outcome: 'failed', reason: stderr.trim() || 'no-output' })
    })
    proc.on('error', err => resolve({ outcome: 'failed', reason: err.message }))
  })
}

/** Pin + hydrate a single file. Building block for cloudSync's shared
 *  per-direction worker pool — the old batch-level helper
 *  (hydratePathsWithProgress) is gone; the pool owns concurrency now. */
export function hydrateOnePath(filePath: string): Promise<{ outcome: HydrateOutcome; reason?: string }> {
  if (process.platform !== 'win32') return Promise.resolve({ outcome: 'failed', reason: 'not-windows' })
  return runOneHydrate(getHydrateScriptPath(), filePath)
}

/**
 * Detect whether a directory is inside (or is) a CFAPI-aware sync root by
 * probing one file inside it. The directory itself often isn't a placeholder
 * even when its children are, so we sample the first regular file we find.
 *
 * Heuristic: a folder is considered a sync root if at least one file inside it
 * has REPARSE_POINT set AND any of the offline/recall flags, OR if the folder
 * itself is a reparse point with cloud-related attributes. Returns false on
 * non-Windows, on missing dirs, and on any error (fail closed — don't show the
 * feature unless we're confident).
 */
export function isCfApiSyncRoot(dirPath: string): boolean {
  if (process.platform !== 'win32' || !dirPath) return false
  try {
    const escaped = dirPath.replace(/'/g, "''")
    const script = `
      $ErrorActionPreference = 'SilentlyContinue'
      $dir = '${escaped}'
      try {
        $dirAttrs = [int][System.IO.File]::GetAttributes($dir)
        if (($dirAttrs -band 0x400) -ne 0) { Write-Output 'ROOT'; exit }
      } catch {}
      Get-ChildItem -LiteralPath $dir -Recurse -File -Depth 3 -ErrorAction SilentlyContinue | ForEach-Object {
        try {
          $a = [int][System.IO.File]::GetAttributes($_.FullName)
          if ((($a -band 0x400) -ne 0) -and (($a -band 0x441000) -ne 0)) {
            Write-Output 'PLACEHOLDER'
            return
          }
          if (($a -band 0x400) -ne 0) {
            Write-Output 'REPARSE'
            return
          }
        } catch {}
      } | Select-Object -First 1
    `
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8',
      timeout: 8000,
    })
    if (result.status !== 0 || !result.stdout) return false
    const out = result.stdout.trim()
    // ROOT or PLACEHOLDER are strong positives. REPARSE alone (no offline/recall
    // flag seen yet) is enough on Synology because every synced file carries the
    // reparse point regardless of hydration state.
    return out === 'ROOT' || out === 'PLACEHOLDER' || out === 'REPARSE'
  } catch {
    return false
  }
}

export const CFAPI_FLAGS = { REPARSE_POINT, OFFLINE_MASK }
