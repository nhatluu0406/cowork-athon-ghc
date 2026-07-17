@echo off
setlocal EnableExtensions

echo Searching for Visual Studio 2026 installation...
echo.

rem Check Program Files
echo Checking C:\Program Files\Microsoft Visual Studio\
if exist "C:\Program Files\Microsoft Visual Studio\2026" (
    echo Found: C:\Program Files\Microsoft Visual Studio\2026
    dir "C:\Program Files\Microsoft Visual Studio\2026"
    echo.

    if exist "C:\Program Files\Microsoft Visual Studio\2026\BuildTools" (
        echo BuildTools found at: C:\Program Files\Microsoft Visual Studio\2026\BuildTools
        dir "C:\Program Files\Microsoft Visual Studio\2026\BuildTools\VC\Auxiliary\Build"
    )
) else (
    echo NOT found at: C:\Program Files\Microsoft Visual Studio\2026
)

echo.
echo Checking C:\Program Files (x86)\Microsoft Visual Studio\
if exist "C:\Program Files (x86)\Microsoft Visual Studio\2026" (
    echo Found: C:\Program Files (x86)\Microsoft Visual Studio\2026
    dir "C:\Program Files (x86)\Microsoft Visual Studio\2026"
    echo.

    if exist "C:\Program Files (x86)\Microsoft Visual Studio\2026\BuildTools" (
        echo BuildTools found at: C:\Program Files (x86)\Microsoft Visual Studio\2026\BuildTools
        dir "C:\Program Files (x86)\Microsoft Visual Studio\2026\BuildTools\VC\Auxiliary\Build"
    )
) else (
    echo NOT found at: C:\Program Files (x86)\Microsoft Visual Studio\2026
)

echo.
echo All Visual Studio installations found:
dir "C:\Program Files\Microsoft Visual Studio" /b 2>nul
dir "C:\Program Files (x86)\Microsoft Visual Studio" /b 2>nul

exit /b 0
