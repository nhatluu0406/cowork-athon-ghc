# fix-line-endings.ps1
# Rewrites all .bat files under scripts\ to Windows CRLF line endings.
# Run once if BAT files were created on Linux/Mac or by a tool that writes LF.
#
# Usage:
#   PowerShell -NoProfile -ExecutionPolicy Bypass -File scripts\fix-line-endings.ps1

param([string]$Root = (Split-Path $PSScriptRoot -Parent))

$batFiles = Get-ChildItem -Path (Join-Path $Root "scripts") -Filter "*.bat" -File

foreach ($f in $batFiles) {
    $raw = [IO.File]::ReadAllBytes($f.FullName)
    # Normalise: strip existing CR, then add CR before every LF
    $text = [System.Text.Encoding]::UTF8.GetString($raw)
    $normalized = $text -replace "`r`n", "`n" -replace "`n", "`r`n"
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($normalized)
    [IO.File]::WriteAllBytes($f.FullName, $bytes)
    Write-Host "Fixed: $($f.Name)"
}

Write-Host ""
Write-Host "Done. All .bat files in scripts\ now use CRLF line endings."
