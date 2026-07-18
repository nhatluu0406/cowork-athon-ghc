@echo off
setlocal EnableExtensions

echo Searching for all Visual Studio installations...
echo.

echo Checking Program Files (64-bit)...
cd /d "C:\Program Files\Microsoft Visual Studio" 2>nul
if %errorlevel% equ 0 (
    echo Success - Now in: C:\Program Files\Microsoft Visual Studio
    dir /b
    echo.
) else (
    echo Could not access: C:\Program Files\Microsoft Visual Studio
)

echo.
echo Checking Program Files (32-bit)...
cd /d "C:\Program Files (x86)\Microsoft Visual Studio" 2>nul
if %errorlevel% equ 0 (
    echo Success - Now in: C:\Program Files (x86)\Microsoft Visual Studio
    dir /b
    echo.
) else (
    echo Could not access: C:\Program Files (x86)\Microsoft Visual Studio
)

echo.
echo Checking alternative paths...
echo Looking for vcvars64.bat files...
dir /s "C:\Program Files\*vcvars64.bat" 2>nul
dir /s "C:\Program Files (x86)\*vcvars64.bat" 2>nul

exit /b 0
