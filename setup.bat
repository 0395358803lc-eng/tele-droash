@echo off
setlocal EnableExtensions EnableDelayedExpansion

title Telegram Checker - First Time Setup
cd /d "%~dp0"

set "PNPM_VERSION=10.4.1"
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

rem ------------------------------------------------------------
rem Node.js 20+
rem ------------------------------------------------------------
set "NODE_OK=0"
where node >nul 2>&1
if not errorlevel 1 (
    for /f %%V in ('node -p "parseInt(process.versions.node.split('.')[0],10)" 2^>nul') do set "NODE_MAJOR=%%V"
    if defined NODE_MAJOR if !NODE_MAJOR! GEQ 20 set "NODE_OK=1"
)

if "%NODE_OK%"=="0" (
    echo [SETUP] Node.js 20+ is missing. Installing Node.js LTS...
    call :require_winget || goto :failed
    winget install --id OpenJS.NodeJS.LTS -e --accept-package-agreements --accept-source-agreements --silent
    if errorlevel 1 (
        winget upgrade --id OpenJS.NodeJS.LTS -e --accept-package-agreements --accept-source-agreements --silent
        if errorlevel 1 goto :failed
    )
    call :refresh_path
)

where node >nul 2>&1 || (
    echo [ERROR] Node.js was installed but is still not available in PATH.
    echo Close this window, open setup.bat again, and retry.
    goto :failed
)

for /f "delims=" %%V in ('node --version') do echo [OK] Node.js %%V

rem ------------------------------------------------------------
rem Python 3.11+
rem ------------------------------------------------------------
set "PYTHON_OK=0"
python -c "import sys; raise SystemExit(0 if sys.version_info >= (3,11) else 1)" >nul 2>&1
if not errorlevel 1 set "PYTHON_OK=1"

if "%PYTHON_OK%"=="0" (
    echo [SETUP] Python 3.11+ is missing. Installing Python 3.11...
    call :require_winget || goto :failed
    winget install --id Python.Python.3.11 -e --scope user --accept-package-agreements --accept-source-agreements --silent
    if errorlevel 1 (
        winget upgrade --id Python.Python.3.11 -e --scope user --accept-package-agreements --accept-source-agreements --silent
        if errorlevel 1 goto :failed
    )
    call :refresh_path
)

python -c "import sys; raise SystemExit(0 if sys.version_info >= (3,11) else 1)" >nul 2>&1 || (
    echo [ERROR] Python 3.11+ is not available after installation.
    echo Close this window, open setup.bat again, and retry.
    goto :failed
)

for /f "delims=" %%V in ('python --version 2^>^&1') do echo [OK] %%V

rem ------------------------------------------------------------
rem pnpm pinned to the project-tested version
rem ------------------------------------------------------------
set "PNPM_OK=0"
where pnpm >nul 2>&1
if not errorlevel 1 (
    for /f "delims=" %%V in ('pnpm --version 2^>nul') do if "%%V"=="%PNPM_VERSION%" set "PNPM_OK=1"
)

if "%PNPM_OK%"=="0" (
    echo [SETUP] Installing pnpm %PNPM_VERSION%...
    where corepack >nul 2>&1
    if not errorlevel 1 (
        call corepack enable >nul 2>&1
        call corepack prepare pnpm@%PNPM_VERSION% --activate >nul 2>&1
    )

    call :refresh_path
    set "PNPM_OK=0"
    where pnpm >nul 2>&1
    if not errorlevel 1 (
        for /f "delims=" %%V in ('pnpm --version 2^>nul') do if "%%V"=="%PNPM_VERSION%" set "PNPM_OK=1"
    )

    if "!PNPM_OK!"=="0" (
        call npm install --global pnpm@%PNPM_VERSION%
        if errorlevel 1 goto :failed
        call :refresh_path
    )
)

where pnpm >nul 2>&1 || goto :failed
for /f "delims=" %%V in ('pnpm --version') do echo [OK] pnpm %%V

rem ------------------------------------------------------------
rem Node workspace installation
rem ------------------------------------------------------------
echo.
echo [SETUP] Installing Node.js workspace dependencies...
call pnpm install --frozen-lockfile
if errorlevel 1 goto :failed

rem ------------------------------------------------------------
rem Python/runtime environment setup
rem ------------------------------------------------------------
echo.
echo [SETUP] Creating Python environment and configuring Windows...
powershell -NoProfile -ExecutionPolicy Bypass -File ".\scripts\windows-setup.ps1" -SkipNodeInstall
if errorlevel 1 goto :failed

rem ------------------------------------------------------------
rem Full validation
rem ------------------------------------------------------------
echo.
echo [CHECK] Running full project validation...
powershell -NoProfile -ExecutionPolicy Bypass -File ".\scripts\windows-check.ps1"
if errorlevel 1 goto :failed

echo.
echo ============================================================
echo   SETUP COMPLETED SUCCESSFULLY
echo ============================================================
echo.
echo The project is ready to run.
echo Double-click start.bat to start Telegram Checker.
echo.
if "%NO_PAUSE%"=="0" pause
exit /b 0

:refresh_path
for /f "usebackq delims=" %%P in (`powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')"`) do set "PATH=%%P"
set "PATH=%ProgramFiles%\nodejs;%LocalAppData%\Programs\Python\Python311;%LocalAppData%\Programs\Python\Python311\Scripts;%LocalAppData%\pnpm;%AppData%\npm;%PATH%"
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
