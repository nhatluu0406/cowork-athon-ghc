@echo off
setlocal EnableExtensions
rem Cowork GHC - build-backend.bat : Compile the Go backend (m365-knowledge-graph.exe).
rem Requires Go 1.22+ on PATH. Outputs to app\backend\bin\m365-knowledge-graph.exe.
rem Resolve project root from this script's own location.
for %%I in ("%~dp0..") do set "ROOT=%%~fI"
title Cowork GHC - build-backend
set "BACKEND_DIR=%ROOT%\app\backend"
set "OUT=%BACKEND_DIR%\bin\m365-knowledge-graph.exe"

where go >nul 2>nul
if errorlevel 1 (
  echo [build-backend] ERROR: Go not found on PATH.
  echo Install Go 1.22+ from https://golang.org/dl/ and add it to PATH.
  exit /b 9
)

echo [build-backend] Building m365-knowledge-graph ...
echo   Go source: %BACKEND_DIR%
echo   Output:    %OUT%
echo.

if not exist "%BACKEND_DIR%\bin\" mkdir "%BACKEND_DIR%\bin"

cd /d "%BACKEND_DIR%"
set CGO_ENABLED=1
set GOOS=windows
set GOARCH=amd64
go build -trimpath -ldflags "-s -w" -o "%OUT%" ./cmd/...
if errorlevel 1 (
  echo [build-backend] FAILED.
  exit /b %ERRORLEVEL%
)

echo [build-backend] OK: %OUT%
exit /b 0
