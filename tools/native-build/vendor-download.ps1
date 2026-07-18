# vendor-download.ps1: Download bundled vendor ZIPs to vendor/ before packaging.
#
# MUST be run from the repo root, or pass -Root explicitly.
# Downloads:
#   postgresql-16.14-windows-x64-binaries.zip  (EDB — no official checksum)
#   neo4j-community-5.26.28-windows.zip        (Neo4j — checksum fetched fresh from vendor)
#   jre-21-windows-x64.zip                     (Temurin JRE 21 — checksum from Adoptium API)
#
# Run once before `scripts\build.bat` to pre-populate vendor/.
# vendor/ is .gitignore'd — CI/CD or release builds MUST run this script first.
#
# Usage:
#   PowerShell -ExecutionPolicy Bypass -File scripts\vendor-download.ps1
#   PowerShell -ExecutionPolicy Bypass -File scripts\vendor-download.ps1 -Root C:\path\to\repo

param(
    [string]$Root = (Split-Path $PSScriptRoot -Parent)
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"   # suppress slow progress bar for Invoke-WebRequest

$VendorDir = Join-Path $Root "vendor"
if (-not (Test-Path $VendorDir)) {
    New-Item -ItemType Directory -Path $VendorDir | Out-Null
}

function Download-Verified {
    param(
        [string]$Name,
        [string]$Url,
        [string]$Dest,
        [string]$ExpectedSha256 = ""   # empty = no checksum (EDB case)
    )
    if (Test-Path $Dest) {
        Write-Host "[vendor] $Name already downloaded, skipping."
        return
    }
    Write-Host "[vendor] Downloading $Name ..."
    $tmp = "$Dest.part"
    try {
        Invoke-WebRequest -Uri $Url -OutFile $tmp -UseBasicParsing
    } catch {
        throw "[vendor] Failed to download $Name from $Url : $_"
    }
    if ($ExpectedSha256 -ne "") {
        $actual = (Get-FileHash $tmp -Algorithm SHA256).Hash.ToLower()
        if ($actual -ne $ExpectedSha256.ToLower()) {
            Remove-Item $tmp -Force
            throw "[vendor] Checksum mismatch for $Name (expected $ExpectedSha256, got $actual)"
        }
        Write-Host "[vendor] $Name SHA-256 verified."
    } else {
        Write-Host "[vendor] $Name — no vendor checksum (HTTPS transport only)."
    }
    Move-Item $tmp $Dest
    Write-Host "[vendor] $Name saved to $Dest"
}

# ---- PostgreSQL 16.14 Windows x64 ----
$PgDest = Join-Path $VendorDir "postgresql-16.14-windows-x64-binaries.zip"
$PgUrl  = "https://get.enterprisedb.com/postgresql/postgresql-16.14-2-windows-x64-binaries.zip"
Download-Verified -Name "postgresql-16.14" -Url $PgUrl -Dest $PgDest

# ---- Neo4j Community 5.26.28 Windows ----
$Neo4jVersion = "5.26.28"
$Neo4jDest    = Join-Path $VendorDir "neo4j-community-$Neo4jVersion-windows.zip"
$Neo4jUrl     = "https://dist.neo4j.org/neo4j-community-$Neo4jVersion-windows.zip"
$Neo4jSha256Url = "$Neo4jUrl.sha256"
Write-Host "[vendor] Fetching Neo4j checksum from $Neo4jSha256Url ..."
$Neo4jSha256 = ((Invoke-WebRequest -Uri $Neo4jSha256Url -UseBasicParsing).Content -split '\s+')[0].Trim()
if ($Neo4jSha256 -notmatch '^[0-9a-fA-F]{64}$') {
    throw "[vendor] Neo4j checksum was not a SHA-256 hex digest: $Neo4jSha256"
}
Download-Verified -Name "neo4j-community-$Neo4jVersion" -Url $Neo4jUrl -Dest $Neo4jDest -ExpectedSha256 $Neo4jSha256

# ---- Temurin JRE 21 Windows x64 ----
$JreDest    = Join-Path $VendorDir "jre-21-windows-x64.zip"
$AdoptiumApi = "https://api.adoptium.net/v3/assets/latest/21/hotspot?image_type=jre&os=windows&architecture=x64"
Write-Host "[vendor] Fetching Temurin JRE 21 metadata from Adoptium API ..."
$JreAssets = (Invoke-WebRequest -Uri $AdoptiumApi -UseBasicParsing).Content | ConvertFrom-Json
$JreAsset  = $JreAssets[0]
$JreUrl    = $JreAsset.binary.package.link
$JreSha256 = $JreAsset.binary.package.checksum
if (-not $JreUrl -or -not $JreSha256) {
    throw "[vendor] Adoptium API did not return expected binary.package.link/checksum"
}
Download-Verified -Name "temurin-jre-21" -Url $JreUrl -Dest $JreDest -ExpectedSha256 $JreSha256

Write-Host ""
Write-Host "[vendor] All vendor dependencies downloaded to $VendorDir"
Write-Host "[vendor] Run scripts\build.bat to package the app."
