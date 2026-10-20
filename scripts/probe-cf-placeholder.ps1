# Read-only probe of a Cloud Files placeholder (SYNC-8 investigation).
# Prints the file's attributes, the platform's placeholder info
# (CfGetPlaceholderInfo, STANDARD class) and the provider's identity blob.
# With -TailBytes N it also asks the provider for the last N bytes
# (CfHydratePlaceholder on that range) and reports what that did.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\probe-cf-placeholder.ps1 "D:\path\file.mkv"
#   powershell -ExecutionPolicy Bypass -File scripts\probe-cf-placeholder.ps1 "D:\path\file.mkv" -TailBytes 65536
#
# Struct layout (cfapi.h, CF_PLACEHOLDER_STANDARD_INFO): OnDiskDataSize 0,
# ValidatedDataSize 8, ModifiedDataSize 16, PropertiesSize 24, PinState 32,
# InSyncState 36, FileId 40, SyncRootFileId 48, FileIdentityLength 56,
# FileIdentity 60. Enum values from the same header: info class STANDARD = 1,
# in-sync IN_SYNC = 1, pin UNSPECIFIED 0 / PINNED 1 / UNPINNED 2 / EXCLUDED 3.

param(
    [Parameter(Mandatory=$true, Position=0)][string]$Path,
    [long]$TailBytes = 0
)

$ErrorActionPreference = 'Continue'

Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class CFP {
    [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
    public static extern IntPtr CreateFileW(string n, uint a, uint s, IntPtr sa, uint c, uint f, IntPtr t);
    [DllImport("kernel32.dll", SetLastError=true)]
    public static extern bool CloseHandle(IntPtr h);
    [DllImport("cldapi.dll", SetLastError=true)]
    public static extern int CfGetPlaceholderInfo(IntPtr h, int infoClass, IntPtr buf, uint bufLen, out uint returned);
    [DllImport("cldapi.dll", SetLastError=true)]
    public static extern int CfHydratePlaceholder(IntPtr h, long off, long len, uint flags, IntPtr o);
}
"@

$FILE_READ_ATTRIBUTES = [uint32]0x80
$GENERIC_READ = [Convert]::ToUInt32('80000000', 16)
$SHARE_ALL = [uint32]7
$OPEN_EXISTING = [uint32]3
$FLAG_BACKUP_SEMANTICS = [uint32]0x02000000
$FLAG_OPEN_REPARSE_POINT = [uint32]0x00200000

function Get-Attrs([string]$p) {
    try { return [int][System.IO.File]::GetAttributes($p) } catch { return -1 }
}

function Describe-Attrs([int]$a) {
    $names = @()
    if ($a -band 0x400)    { $names += 'REPARSE_POINT' }
    if ($a -band 0x1000)   { $names += 'OFFLINE' }
    if ($a -band 0x40000)  { $names += 'RECALL_ON_OPEN' }
    if ($a -band 0x400000) { $names += 'RECALL_ON_DATA_ACCESS' }
    if ($a -band 0x80000)  { $names += 'PINNED' }
    if ($a -band 0x100000) { $names += 'UNPINNED' }
    if ($a -band 0x200)    { $names += 'SPARSE_FILE' }
    if ($a -band 0x20)     { $names += 'ARCHIVE' }
    return ('0x{0:X8} [{1}]' -f $a, ($names -join ' '))
}

function Read-PlaceholderInfo([string]$p) {
    $flags = $FLAG_BACKUP_SEMANTICS -bor $FLAG_OPEN_REPARSE_POINT
    $h = [CFP]::CreateFileW($p, $FILE_READ_ATTRIBUTES, $SHARE_ALL, [IntPtr]::Zero, $OPEN_EXISTING, $flags, [IntPtr]::Zero)
    if ($h -eq [IntPtr]::new(-1)) {
        Write-Output ("placeholder-info: CreateFile failed, Win32 error " + [Runtime.InteropServices.Marshal]::GetLastWin32Error())
        return
    }
    $size = 8192
    $buf = [Runtime.InteropServices.Marshal]::AllocHGlobal($size)
    try {
        $ret = [uint32]0
        $hr = [CFP]::CfGetPlaceholderInfo($h, 1, $buf, [uint32]$size, [ref]$ret)
        if ($hr -ne 0) {
            Write-Output ('placeholder-info: HRESULT 0x{0:X8} (0x80070178 = not a cloud file)' -f $hr)
            return
        }
        $M = [Runtime.InteropServices.Marshal]
        $onDisk    = $M::ReadInt64($buf, 0)
        $validated = $M::ReadInt64($buf, 8)
        $modified  = $M::ReadInt64($buf, 16)
        $props     = $M::ReadInt64($buf, 24)
        $pin       = $M::ReadInt32($buf, 32)
        $inSync    = $M::ReadInt32($buf, 36)
        $fileId    = $M::ReadInt64($buf, 40)
        $rootId    = $M::ReadInt64($buf, 48)
        $idLen     = $M::ReadInt32($buf, 56)
        $pinName = @('UNSPECIFIED','PINNED','UNPINNED','EXCLUDED','INHERIT')[$pin]
        $syncName = @('NOT_IN_SYNC','IN_SYNC')[$inSync]
        Write-Output ("on-disk-data-size:   {0:N0}" -f $onDisk)
        Write-Output ("validated-data-size: {0:N0}" -f $validated)
        Write-Output ("modified-data-size:  {0:N0}" -f $modified)
        Write-Output ("properties-size:     {0:N0}" -f $props)
        Write-Output ("pin-state:           {0} ({1})" -f $pin, $pinName)
        Write-Output ("in-sync-state:       {0} ({1})" -f $inSync, $syncName)
        Write-Output ("file-id:             0x{0:X16}" -f $fileId)
        Write-Output ("sync-root-file-id:   0x{0:X16}" -f $rootId)
        Write-Output ("identity-length:     {0}" -f $idLen)
        if ($idLen -gt 0 -and $idLen -le 4096) {
            $bytes = New-Object byte[] $idLen
            $M::Copy([IntPtr]::Add($buf, 60), $bytes, 0, $idLen)
            $zeros = ($bytes | Where-Object { $_ -eq 0 }).Count
            if ($zeros -gt ($idLen / 4)) { $text = [System.Text.Encoding]::Unicode.GetString($bytes) }
            else { $text = [System.Text.Encoding]::UTF8.GetString($bytes) }
            $text = $text.TrimEnd([char]0)
            Write-Output ("identity-text:       {0}" -f $text)
            Write-Output ("identity-hex-head:   {0}" -f (($bytes[0..([Math]::Min(31, $idLen-1))] | ForEach-Object { '{0:X2}' -f $_ }) -join ' '))
        }
    } finally {
        [Runtime.InteropServices.Marshal]::FreeHGlobal($buf)
        [CFP]::CloseHandle($h) | Out-Null
    }
}

if (-not (Test-Path -LiteralPath $Path)) { Write-Output "File not found: $Path"; exit 1 }

$len = (Get-Item -LiteralPath $Path -Force).Length
Write-Output ("path:                {0}" -f $Path)
Write-Output ("length:              {0:N0}" -f $len)
Write-Output ("attributes:          {0}" -f (Describe-Attrs (Get-Attrs $Path)))
Read-PlaceholderInfo $Path

if ($TailBytes -gt 0) {
    $off = [Math]::Max(0, $len - $TailBytes)
    $want = $len - $off
    Write-Output ("tail-request:        offset {0:N0}, length {1:N0}" -f $off, $want)
    $flags = $FLAG_BACKUP_SEMANTICS -bor $FLAG_OPEN_REPARSE_POINT
    $h = [CFP]::CreateFileW($Path, $GENERIC_READ, $SHARE_ALL, [IntPtr]::Zero, $OPEN_EXISTING, $flags, [IntPtr]::Zero)
    if ($h -eq [IntPtr]::new(-1)) {
        Write-Output ("tail-request:        CreateFile failed, Win32 error " + [Runtime.InteropServices.Marshal]::GetLastWin32Error())
        exit 1
    }
    Write-Output ("attributes-after-open: {0}" -f (Describe-Attrs (Get-Attrs $Path)))
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $hr = [CFP]::CfHydratePlaceholder($h, $off, $want, 0, [IntPtr]::Zero)
    $sw.Stop()
    [CFP]::CloseHandle($h) | Out-Null
    Write-Output ('tail-result:         HRESULT 0x{0:X8} after {1:N1} s' -f $hr, $sw.Elapsed.TotalSeconds)
    Write-Output ("attributes-after:    {0}" -f (Describe-Attrs (Get-Attrs $Path)))
    Write-Output "--- placeholder info after the tail request ---"
    Read-PlaceholderInfo $Path
}
