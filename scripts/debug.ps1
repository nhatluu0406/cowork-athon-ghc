# Cowork GHC - debug.ps1 : launch the PACKAGED app with remote + verbose logging and tail the
# live logs in this window, so you can watch the gateway URL, provider verification, and errors
# while you test. Ctrl+C stops tailing (the app keeps running; close its window to quit it).
#
# Usage:   powershell -ExecutionPolicy Bypass -File scripts\debug.ps1
#          (or right-click > Run with PowerShell)
#   -NoLaunch : only tail the logs, do not start the app (use if it is already running).
param([switch]$NoLaunch)

$ErrorActionPreference = "SilentlyContinue"
$root = Split-Path -Parent $PSScriptRoot
$exe  = Join-Path $root "dist-app\win-unpacked\Cowork GHC.exe"
$data = Join-Path $env:LOCALAPPDATA "Cowork GHC"
$lifecycle  = Join-Path $data "service-lifecycle.log"
$structured = Join-Path $data "data\logs\cowork-ghc.log"

function Note($m) { Write-Host "[debug] $m" -ForegroundColor Cyan }

if (-not $NoLaunch) {
  if (-not (Test-Path $exe)) {
    Write-Host "[debug] Packaged app not found: $exe" -ForegroundColor Red
    Write-Host "[debug] Build it first: scripts\build.bat" -ForegroundColor Yellow
    exit 1
  }
  # Remote/phone access ON for the demo; verbose file logging ON so provider + service debug is
  # written to data\logs\cowork-ghc.log. Set CGHC_REMOTE_LAN=0 before running to stay loopback-only.
  if (-not $env:CGHC_REMOTE_LAN) { $env:CGHC_REMOTE_LAN = "1" }
  if ($env:CGHC_REMOTE_LAN -ne "0" -and -not $env:CGHC_REMOTE_ENABLED) { $env:CGHC_REMOTE_ENABLED = "1" }
  $env:COWORK_GHC_VERBOSE_LOGGING = "1"
  Note "stopping any running instance..."
  Start-Process taskkill -ArgumentList "/F","/T","/IM","Cowork GHC.exe" -Wait -WindowStyle Hidden | Out-Null
  Start-Sleep -Milliseconds 800
  Note "launching app (remote LAN + verbose logging)..."
  Start-Process -FilePath $exe
}

Note "data dir : $data"
Note "tailing  : service-lifecycle.log  +  data\logs\cowork-ghc.log"
Note "watch for: [cowork-remote] LAN URL, live_ready, and any 'error' / 'Not Found' lines."
Note "Ctrl+C to stop tailing (app keeps running)."
Write-Host ""

# Wait (bounded) for the log files to appear, then tail both with a source prefix.
foreach ($f in @($lifecycle, $structured)) {
  for ($i = 0; $i -lt 40 -and -not (Test-Path $f); $i++) { Start-Sleep -Milliseconds 500 }
}
$targets = @($lifecycle, $structured) | Where-Object { Test-Path $_ }
if ($targets.Count -eq 0) {
  Write-Host "[debug] no log files yet at $data - unlock the app + configure a provider, then re-run." -ForegroundColor Yellow
  exit 0
}
$jobs = foreach ($f in $targets) {
  Start-Job -ArgumentList $f -ScriptBlock {
    param($f)
    $tag = [System.IO.Path]::GetFileName($f)
    Get-Content -LiteralPath $f -Tail 20 -Wait | ForEach-Object { "[$tag] $_" }
  }
}
try {
  while ($true) {
    $jobs | Receive-Job | ForEach-Object {
      if ($_ -match 'error|Not Found|fail|refused|scheme_not') { Write-Host $_ -ForegroundColor Red }
      elseif ($_ -match 'cowork-remote|live_ready|listening|Wi-Fi') { Write-Host $_ -ForegroundColor Green }
      else { Write-Host $_ }
    }
    Start-Sleep -Milliseconds 400
  }
} finally {
  $jobs | Stop-Job -ErrorAction SilentlyContinue
  $jobs | Remove-Job -ErrorAction SilentlyContinue
}
