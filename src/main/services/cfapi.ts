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
// Pinning is the inverse: attrib +P -U. No API call needed; data hydrates
// transparently on next access via the existing cloud-hydrate path in converter.

const REPARSE_POINT = 0x400
const OFFLINE_MASK = 0x1000 | 0x40000 | 0x400000

export interface CloudOpResult {
  ok: string[]
  failed: { path: string; reason: string }[]
}

const PWSH_HEADER = `
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
    [DllImport("cldapi.dll", SetLastError=true)]
    public static extern int CfHydratePlaceholder(IntPtr h, long off, long len, uint flags, IntPtr o);
}
"@
$GENERIC_RW = [Convert]::ToUInt32('C0000000', 16)
`

function runBatch(paths: string[], perPath: string): Promise<CloudOpResult> {
  return new Promise(resolve => {
    if (process.platform !== 'win32' || paths.length === 0) {
      resolve({ ok: [], failed: paths.map(p => ({ path: p, reason: 'not-windows' })) })
      return
    }
    // '|||' is the delimiter (Windows paths can't contain '|', so it's
    // unambiguous). Avoids PowerShell backtick-tab escapes which would close
    // the JS template literal.
    const script = `${PWSH_HEADER}
while (($line = [Console]::In.ReadLine()) -ne $null) {
  $p = $line
  try {
${perPath}
  } catch {
    Write-Output ("ERR|||" + $p + "|||" + $_.Exception.Message)
  }
}
`
    let stdout = ''
    let stderr = ''
    const proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script])
    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString() })
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString() })
    proc.on('close', () => {
      const ok: string[] = []
      const failed: { path: string; reason: string }[] = []
      const seen = new Set<string>()
      for (const line of stdout.split(/\r?\n/)) {
        const trimmed = line.trim()
        if (!trimmed) continue
        const [tag, p, reason] = trimmed.split('|||')
        if (!p) continue
        seen.add(p)
        if (tag === 'OK') ok.push(p)
        else failed.push({ path: p, reason: reason || tag || 'unknown' })
      }
      // Anything that didn't produce a line at all is a failure (process crashed
      // mid-stream, bad path, etc.). Surface it rather than silently dropping.
      for (const p of paths) {
        if (!seen.has(p)) failed.push({ path: p, reason: stderr.trim() || 'no-output' })
      }
      resolve({ ok, failed })
    })
    proc.on('error', err => {
      resolve({ ok: [], failed: paths.map(p => ({ path: p, reason: err.message })) })
    })
    proc.stdin.write(paths.join('\n') + '\n')
    proc.stdin.end()
  })
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
      if (last.startsWith('ERR|||')) { resolve({ outcome: 'failed', reason: last.slice(6) }); return }
      resolve({ outcome: 'failed', reason: stderr.trim() || 'no-output' })
    })
    proc.on('error', err => resolve({ outcome: 'failed', reason: err.message }))
  })
}

export interface DehydrateProgressEvent {
  path: string
  status: 'running' | 'done' | 'already-offline' | 'failed'
  reason?: string
}

/**
 * Dehydrate files one at a time, emitting progress per file via `onProgress`.
 * Serial execution by design — concurrent PowerShell processes against the same
 * sync provider risk contention.
 *
 * Cancel via `shouldCancel()` is checked between files. The currently-running
 * file is allowed to finish so we never interrupt CfDehydratePlaceholder
 * mid-call (which could leave the file in an intermediate state).
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
  for (const p of paths) {
    if (shouldCancel?.()) { cancelled = true; break }
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
  return { ok, failed, skippedAlreadyOffline, cancelled }
}

/** Pin a file as "always keep local". Inverse of dehydratePaths. Hydration of
 *  any currently-evicted data happens lazily on next read. */
export function pinPaths(paths: string[]): Promise<CloudOpResult> {
  return runBatch(paths, `
    & attrib +P -U $p 2>$null | Out-Null
    Write-Output ("OK|||" + $p)
  `)
}

/** Force immediate hydration without changing the pin state. Useful for
 *  prefetching before a known-imminent operation. */
export function hydratePaths(paths: string[]): Promise<CloudOpResult> {
  return runBatch(paths, `
    $len = (Get-Item -LiteralPath $p).Length
    $h = [CFAPI]::CreateFileW($p, $GENERIC_RW, [uint32]7, [IntPtr]::Zero, [uint32]3, [uint32]0x02000000, [IntPtr]::Zero)
    if ($h -eq [IntPtr]::new(-1)) {
      Write-Output ("ERR|||" + $p + "|||CreateFile " + [Runtime.InteropServices.Marshal]::GetLastWin32Error())
    } else {
      $hr = [CFAPI]::CfHydratePlaceholder($h, 0, $len, 0, [IntPtr]::Zero)
      [CFAPI]::CloseHandle($h) | Out-Null
      if ($hr -eq 0) { Write-Output ("OK|||" + $p) }
      else { Write-Output ("ERR|||" + $p + "|||HRESULT 0x" + ('{0:X8}' -f $hr)) }
    }
  `)
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
