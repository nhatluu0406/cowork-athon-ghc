@echo off
setlocal EnableExtensions
rem Cowork GHC - start.bat : start the packaged desktop app. Double-click safe.
rem Requires scripts\build.bat output at dist-app\win-unpacked\Cowork GHC.exe.
rem Does not auto-build and does not fall back to the dev Electron entry.
for %%I in ("%~dp0..") do set "ROOT=%%~fI"
title Cowork GHC - start
set "EXE=%ROOT%\dist-app\win-unpacked\Cowork GHC.exe"

where node >nul 2>nul
if errorlevel 1 goto :nonode

if not exist "%EXE%" goto :nobuild

rem Fast already-running check (no long wait). Only restore if a window exists now.
call :quick_running
if not errorlevel 1 (
  echo [Cowork GHC] start: already running - restoring window
  call :show_window
  pause
  exit /b 0
)

rem Clear stale packaged helper/main processes that have no restorable window.
echo [Cowork GHC] Clearing any stale Cowork GHC.exe processes...
taskkill /F /T /IM "Cowork GHC.exe" >nul 2>nul

echo [Cowork GHC] Starting packaged app...
echo Project root: %ROOT%
echo Executable: %EXE%
echo.
node "%ROOT%\tools\app\cli.mjs" start --root "%ROOT%"
set "RC=%ERRORLEVEL%"
echo.
if "%RC%"=="0" (
  echo [Cowork GHC] Waiting for main window...
  call :show_window
  if errorlevel 1 echo [Cowork GHC] WARN: app started, but no visible window was detected yet.
  echo [Cowork GHC] start: READY
) else if "%RC%"=="3" (
  echo [Cowork GHC] start: NOT INITIALIZED - run init.bat first.
) else (
  echo [Cowork GHC] start: FAILED with exit code %RC%  - see .runtime\logs\start.log
)
pause
exit /b %RC%

:nobuild
echo [Cowork GHC] ERROR: packaged app not built.
echo Expected executable:
echo   %EXE%
echo.
echo Run scripts\build.bat first, then run scripts\start.bat again.
pause
exit /b 3

:nonode
echo [Cowork GHC] ERROR: Node.js not found on PATH.
echo Install Node.js LTS from https://nodejs.org, then run init.bat and build.bat.
pause
exit /b 9

:quick_running
rem Exit 0 if a Cowork GHC process already has a main window; else exit 1 immediately.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$p = Get-Process -Name 'Cowork GHC' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero } | Select-Object -First 1; if ($null -eq $p) { exit 1 } else { exit 0 }" >nul 2>nul
exit /b %ERRORLEVEL%

:show_window
rem Bounded restore (up to ~10s). Only used AFTER launch or when already running.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$code = 'using System; using System.Runtime.InteropServices; public class W { [StructLayout(LayoutKind.Sequential)] public struct R { public int Left; public int Top; public int Right; public int Bottom; } [DllImport(\"user32.dll\")] public static extern bool GetWindowRect(IntPtr hWnd, out R r); [DllImport(\"user32.dll\")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow); [DllImport(\"user32.dll\")] public static extern bool SetForegroundWindow(IntPtr hWnd); [DllImport(\"user32.dll\")] public static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int Wd, int Ht, bool Repaint); }'; Add-Type $code -ErrorAction SilentlyContinue; $p = $null; for ($i = 0; $i -lt 40; $i++) { $p = Get-Process -Name 'Cowork GHC' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero } | Sort-Object StartTime -Descending | Select-Object -First 1; if ($p) { break }; Start-Sleep -Milliseconds 250 }; if (-not $p) { exit 1 }; $h = $p.MainWindowHandle; $r = New-Object W+R; [W]::ShowWindow($h, 9) | Out-Null; [W]::GetWindowRect($h, [ref]$r) | Out-Null; if ($r.Right -lt 100 -or $r.Bottom -lt 100 -or $r.Left -gt 3000 -or $r.Top -gt 2000) { [W]::MoveWindow($h, 80, 80, 1280, 800, $true) | Out-Null }; [W]::SetForegroundWindow($h) | Out-Null; exit 0" >nul 2>nul
exit /b %ERRORLEVEL%
