@echo off

setlocal EnableExtensions EnableDelayedExpansion



title Telegram Checker - First Time Setup

cd /d "%~dp0"



set "PNPM_VERSION=10.34.5"

set "NO_PAUSE=0"

if /I "%~1"=="--no-pause" set "NO_PAUSE=1"



echo ============================================================

echo   Telegram Checker - Windows One-Click Setup

echo ============================================================

echo.

echo This setup will:

echo   - Install Node.js LTS if needed

echo   - Install Python 3.11 if needed

echo   - Install pnpm %PNPM_VERSION% if needed

echo   - Install all Node.js workspace dependencies

echo   - Create an isolated Python .venv

echo   - Install all Python dependencies

echo   - Configure the persistent Windows runtime environment

echo   - Run the full project validation suite

echo.



call :refresh_path
rem Preserve the current process PATH first. This keeps toolchain selectors
rem such as GitHub Actions setup-node/setup-python ahead of system fallbacks.
set "CURRENT_PROCESS_PATH=%PATH%"
for /f "usebackq delims=" %%P in (`powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')"`) do set "PERSISTENT_PATH=%%P"
set "PATH=%CURRENT_PROCESS_PATH%;%LocalAppData%\Programs\Python\Python311;%LocalAppData%\Programs\Python\Python311\Scripts;%LocalAppData%\pnpm;%AppData%\npm;%ProgramFiles%\nodejs;%PERSISTENT_PATH%"
exit /b 0

:require_winget

where winget >nul 2>&1

if errorlevel 1 (

    echo [ERROR] Windows Package Manager ^(winget^) is not available.

    echo Install/update "App Installer" from Microsoft Store, then run setup.bat again.

    exit /b 1

)

exit /b 0



:failed

echo.

echo ============================================================

echo   SETUP FAILED

echo ============================================================

echo.

echo Review the error messages above and run setup.bat again.

echo No Telegram credentials are required during dependency setup.

echo.

if "%NO_PAUSE%"=="0" pause

exit /b 1

