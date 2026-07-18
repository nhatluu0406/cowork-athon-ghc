# fetch-model.ps1 — Download BGE-M3 quantized (int8) ONNX embedding model from HuggingFace.
#
# Downloads Xenova/bge-m3 ONNX int8 model files into vendors/bge-m3/.
# This directory is git-ignored (large binary); run before `npm run package:win`.
#
# Usage:
#   npm run fetch:model
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/fetch-model.ps1

[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RepoRoot = Join-Path $PSScriptRoot ".."
$Dest = Join-Path $RepoRoot "vendors\bge-m3"

$BaseUrl = "https://huggingface.co/Xenova/bge-m3/resolve/main"

$Files = @(
    @{ Url = "$BaseUrl/config.json";                   Out = "config.json"    },
    @{ Url = "$BaseUrl/tokenizer.json";                Out = "tokenizer.json" },
    @{ Url = "$BaseUrl/tokenizer_config.json";         Out = "tokenizer_config.json" },
    @{ Url = "$BaseUrl/special_tokens_map.json";       Out = "special_tokens_map.json" },
    @{ Url = "$BaseUrl/onnx/model_quantized.onnx";     Out = "model.onnx"    }
)

if (-not (Test-Path $Dest)) {
    New-Item -ItemType Directory -Force -Path $Dest | Out-Null
}

foreach ($f in $Files) {
    $OutPath = Join-Path $Dest $f.Out
    if (Test-Path $OutPath) {
        Write-Host "SKIP  $($f.Out) (already present)"
        continue
    }
    Write-Host "GET   $($f.Url)"
    Invoke-WebRequest -Uri $f.Url -OutFile $OutPath -UseBasicParsing
    $SizeMb = [math]::Round((Get-Item $OutPath).Length / 1MB, 1)
    Write-Host "OK    $($f.Out)  ($SizeMb MB)"
}

Write-Host ""
Write-Host "BGE-M3 int8 model ready at $Dest"
Write-Host "Run 'npm run package:win' to include it in the Electron package."
