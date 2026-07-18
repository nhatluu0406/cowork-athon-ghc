# ensure-protoc.ps1
# Downloads protoc (Protocol Buffers compiler) to .tools\protoc\ if not already
# present, then prints the path to protoc.exe on stdout so callers can set PROTOC.
#
# Usage from build-llm-svc.bat:
#   for /f "delims=" %%P in ('powershell -NoProfile -ExecutionPolicy Bypass
#       -File scripts\ensure-protoc.ps1 -Root "%ROOT%"') do set "PROTOC=%%P"
#
# The script is idempotent: if protoc.exe already exists in .tools\protoc\bin\
# it is returned immediately without a network call.

param(
    [string]$Root  = (Split-Path $PSScriptRoot -Parent),
    [string]$Version = "29.3"
)

$ErrorActionPreference = "Stop"
$ProgressPreference    = "SilentlyContinue"

$toolsDir  = Join-Path $Root ".tools\protoc"
$protocExe = Join-Path $toolsDir "bin\protoc.exe"

if (Test-Path $protocExe) {
    # Already downloaded — return path and exit.
    Write-Output $protocExe
    exit 0
}

$zipUrl  = "https://github.com/protocolbuffers/protobuf/releases/download/v$Version/protoc-$Version-win64.zip"
$zipDest = Join-Path $env:TEMP "protoc-$Version-win64.zip"

Write-Host "[ensure-protoc] Downloading protoc v$Version ..." -ForegroundColor Cyan
Write-Host "  URL: $zipUrl"

try {
    Invoke-WebRequest -Uri $zipUrl -OutFile "$zipDest.part" -UseBasicParsing
} catch {
    throw "[ensure-protoc] Download failed: $_"
}
Move-Item "$zipDest.part" $zipDest -Force

Write-Host "[ensure-protoc] Extracting to $toolsDir ..."
if (Test-Path $toolsDir) { Remove-Item $toolsDir -Recurse -Force }
New-Item -ItemType Directory -Path $toolsDir | Out-Null

Expand-Archive -Path $zipDest -DestinationPath $toolsDir -Force
Remove-Item $zipDest -Force

if (-not (Test-Path $protocExe)) {
    throw "[ensure-protoc] protoc.exe not found after extraction at: $protocExe"
}

Write-Host "[ensure-protoc] protoc v$Version ready: $protocExe" -ForegroundColor Green
Write-Output $protocExe
