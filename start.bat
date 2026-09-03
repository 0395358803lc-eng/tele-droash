@echo off
setlocal

title Telegram Checker Dashboard
cd /d "%~dp0"

echo ========================================
echo   Telegram Checker Dashboard
echo ========================================
echo.

where pnpm >nul 2>&1
if errorlevel 1 (
    echo [ERROR] pnpm was not found in PATH.
    echo Install Node.js and pnpm, then run this file again.
    echo.
    pause
    exit /b 1
)

call pnpm desktop:start
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
    echo.
    echo [ERROR] Telegram Checker stopped with exit code %EXIT_CODE%.
    echo.
    pause
)

exit /b %EXIT_CODE%
