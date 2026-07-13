@echo off
setlocal EnableExtensions
rem Fast pre-commit checks: typecheck, focused tests, renderer build.
for %%I in ("%~dp0..") do set "ROOT=%%~fI"
cd /d "%ROOT%"
title Cowork GHC - verify-fast

where node >nul 2>nul
if errorlevel 1 (
  echo [Cowork GHC] ERROR: Node.js not found on PATH.
  exit /b 9
)

echo [Cowork GHC] verify-fast: typecheck...
call npm run typecheck
if errorlevel 1 exit /b 1

echo [Cowork GHC] verify-fast: provider + conversation tests...
node --import tsx --test service/tests/provider-profiles.test.ts service/tests/provider-readiness.test.ts service/tests/conversation-store.test.ts service/tests/conversation-router.test.ts app/ui/tests/conversation-controller.test.ts app/ui/tests/surface-registry.test.ts app/ui/tests/provider-readiness.test.ts
if errorlevel 1 exit /b 1

echo [Cowork GHC] verify-fast: renderer build...
call npm run build:renderer
if errorlevel 1 exit /b 1

echo [Cowork GHC] verify-fast: PASS
exit /b 0
