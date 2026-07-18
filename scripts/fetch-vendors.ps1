# fetch-vendors.ps1 — Download and extract PostgreSQL, Neo4j, and JRE into vendors/
# Run from the repo root before `npm run package:win`.
#
# Versions (update here when upgrading):
$PG_VERSION   = "17.2-1"          # PostgreSQL binaries zip from EnterpriseDB
$NEO4J_VERSION = "5.26.0"         # Neo4j Community Edition
$JRE_VERSION  = "21"              # Eclipse Temurin LTS major version (Adoptium API)
$JRE_ARCH     = "x64"

$ErrorActionPreference = "Stop"
$VendorRoot = Join-Path (Join-Path $PSScriptRoot "..") "vendors"

function Expand-Flat {
    param([string]$ZipPath, [string]$Dest)
    $tmp = "$Dest.tmp"
    if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
    Expand-Archive -LiteralPath $ZipPath -DestinationPath $tmp -Force
    # If the zip has a single top-level directory, flatten it
    $children = Get-ChildItem $tmp
    if ($children.Count -eq 1 -and $children[0].PSIsContainer) {
        if (Test-Path $Dest) { Remove-Item $Dest -Recurse -Force }
        Move-Item $children[0].FullName $Dest
        Remove-Item $tmp -Force
    } else {
        if (Test-Path $Dest) { Remove-Item $Dest -Recurse -Force }
        Move-Item $tmp $Dest
    }
}

# ── PostgreSQL ──────────────────────────────────────────────────────────────
$pgDest = Join-Path $VendorRoot "postgresql"
if (-not (Test-Path (Join-Path (Join-Path $pgDest "bin") "postgres.exe"))) {
    Write-Host "Downloading PostgreSQL $PG_VERSION..."
    $pgUrl  = "https://get.enterprisedb.com/postgresql/postgresql-$PG_VERSION-windows-x64-binaries.zip"
    $pgZip  = Join-Path $env:TEMP "pg-$PG_VERSION.zip"
    Invoke-WebRequest -Uri $pgUrl -OutFile $pgZip -UseBasicParsing
    Write-Host "Extracting PostgreSQL..."
    Expand-Flat -ZipPath $pgZip -Dest $pgDest
    Remove-Item $pgZip -Force
    Write-Host "PostgreSQL ready at: $pgDest"
} else {
    Write-Host "PostgreSQL already present, skipping."
}

# ── Neo4j Community ─────────────────────────────────────────────────────────
$neo4jDest = Join-Path $VendorRoot "neo4j"
if (-not (Test-Path (Join-Path (Join-Path $neo4jDest "bin") "neo4j.bat"))) {
    Write-Host "Downloading Neo4j $NEO4J_VERSION..."
    $neo4jUrl = "https://dist.neo4j.org/neo4j-community-$NEO4J_VERSION-windows.zip"
    $neo4jZip = Join-Path $env:TEMP "neo4j-$NEO4J_VERSION.zip"
    Invoke-WebRequest -Uri $neo4jUrl -OutFile $neo4jZip -UseBasicParsing
    Write-Host "Extracting Neo4j..."
    Expand-Flat -ZipPath $neo4jZip -Dest $neo4jDest
    Remove-Item $neo4jZip -Force
    Write-Host "Neo4j ready at: $neo4jDest"
} else {
    Write-Host "Neo4j already present, skipping."
}

# ── Eclipse Temurin JRE (required by Neo4j) ─────────────────────────────────
$jreDest = Join-Path $VendorRoot "jre"
if (-not (Test-Path (Join-Path (Join-Path $jreDest "bin") "java.exe"))) {
    Write-Host "Fetching Temurin JRE $JRE_VERSION download URL..."
    $apiUrl = "https://api.adoptium.net/v3/assets/latest/$JRE_VERSION/hotspot?image_type=jre&os=windows&architecture=$JRE_ARCH"
    $assets = Invoke-RestMethod -Uri $apiUrl -UseBasicParsing
    $jreAsset = $assets | Where-Object { $_.binary.package.name -like "*.zip" } | Select-Object -First 1
    if ($null -eq $jreAsset) { throw "Could not find Temurin JRE $JRE_VERSION ZIP for windows/$JRE_ARCH" }
    $jreUrl = $jreAsset.binary.package.link
    $jreZip = Join-Path $env:TEMP "jre-$JRE_VERSION.zip"
    Write-Host "Downloading JRE from $jreUrl..."
    Invoke-WebRequest -Uri $jreUrl -OutFile $jreZip -UseBasicParsing
    Write-Host "Extracting JRE..."
    Expand-Flat -ZipPath $jreZip -Dest $jreDest
    Remove-Item $jreZip -Force
    Write-Host "JRE ready at: $jreDest"
} else {
    Write-Host "JRE already present, skipping."
}

Write-Host ""
Write-Host "All vendors ready. Run 'npm run package:win' to build the release."
