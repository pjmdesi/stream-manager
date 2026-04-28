# Quick test for CfDehydratePlaceholder against a single file.
# Usage:  pwsh -ExecutionPolicy Bypass -File .\scripts\test-cf-dehydrate.ps1 "D:\path\to\file.mkv"
# Run from an elevated (admin) PowerShell.

param(
    [Parameter(Mandatory=$true, Position=0)]
    [string]$Path
)

if (-not (Test-Path -LiteralPath $Path)) {
    Write-Host "File not found: $Path" -ForegroundColor Red
    exit 1
}

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

$before = [int][System.IO.File]::GetAttributes($Path)
Write-Host ("Before:  0x{0:X8}" -f $before)

# Unpin first — CfDehydratePlaceholder rejects pinned files (ERROR_CLOUD_FILE_INVALID_REQUEST).
# +U sets Unpinned, -P clears Pinned.
& attrib +U -P $Path 2>$null
$afterUnpin = [int][System.IO.File]::GetAttributes($Path)
Write-Host ("After unpin: 0x{0:X8}" -f $afterUnpin)

$logicalLength = (Get-Item -LiteralPath $Path).Length
Write-Host ("Logical length: {0:N0} bytes" -f $logicalLength)

# GENERIC_READ|GENERIC_WRITE = 0xC0000000, share R|W|D = 7, OPEN_EXISTING = 3, FILE_FLAG_BACKUP_SEMANTICS = 0x02000000
$GENERIC_RW = [Convert]::ToUInt32('C0000000', 16)
$h = [CFAPI]::CreateFileW($Path, $GENERIC_RW, [uint32]7, [IntPtr]::Zero, [uint32]3, [uint32]0x02000000, [IntPtr]::Zero)
if ($h -eq [IntPtr]::new(-1)) {
    Write-Host "CreateFile failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())" -ForegroundColor Red
    exit 1
}

$hr = [CFAPI]::CfDehydratePlaceholder($h, 0, $logicalLength, 0, [IntPtr]::Zero)
[CFAPI]::CloseHandle($h) | Out-Null
Write-Host ("HRESULT: 0x{0:X8}" -f $hr)

Start-Sleep -Seconds 2
$after = [int][System.IO.File]::GetAttributes($Path)
Write-Host ("After:   0x{0:X8}" -f $after)
Write-Host ("OFFLINE: $((($after -band 0x1000) -ne 0))  RECALL_ON_OPEN: $((($after -band 0x40000) -ne 0))  RECALL_ON_DATA_ACCESS: $((($after -band 0x400000) -ne 0))")
