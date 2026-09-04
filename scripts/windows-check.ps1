$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host '== Telegram Checker Desktop validation =='

foreach ($tool in @('node','pnpm')) {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
    throw "Required tool not found in PATH: $tool"
  }
}

if (-not $env:SESSION_SECRET) {
  $env:SESSION_SECRET = [Environment]::GetEnvironmentVariable('SESSION_SECRET', 'User')
}
if (-not $env:DATABASE_PATH) {
  $env:DATABASE_PATH = [Environment]::GetEnvironmentVariable('DATABASE_PATH', 'User')
}
if (-not $env:DATABASE_PATH) {
  $env:DATABASE_PATH = Join-Path $root 'data\checker.db'
}
if (-not $env:SESSION_SECRET -or $env:SESSION_SECRET.Length -lt 32) {
  throw 'SESSION_SECRET is missing or too short. Run: pnpm desktop:setup'
}

$venvPython = Join-Path $root 'telegram-phone-number-checker\.venv\Scripts\python.exe'
if (-not (Test-Path $venvPython)) {
  throw 'Project Python virtual environment is missing. Run: pnpm desktop:setup'
}
$env:PYTHON_BIN = $venvPython

Write-Host ("Node:   " + (node --version))
Write-Host ("pnpm:   " + (pnpm --version))
Write-Host ("Python: " + (& $venvPython --version))
Write-Host ("Python executable: " + $venvPython)
Write-Host ("SQLite: " + $env:DATABASE_PATH)

$pythonProject = Join-Path $root 'telegram-phone-number-checker'
Push-Location $pythonProject
try {
  & $venvPython -m pip check
  if ($LASTEXITCODE -ne 0) { throw 'Python dependency consistency check failed.' }

  & $venvPython -c "import telethon, phonenumbers, dotenv, telegram_phone_number_checker"
  if ($LASTEXITCODE -ne 0) { throw 'Python runtime dependency import check failed.' }

  & $venvPython -m compileall -q .\telegram_phone_number_checker
  if ($LASTEXITCODE -ne 0) { throw 'Python compile check failed.' }

  & $venvPython -m pytest -q
  if ($LASTEXITCODE -ne 0) { throw 'Python tests failed.' }
} finally {
  Pop-Location
}

if (Test-Path $env:DATABASE_PATH) {
  & $venvPython -c "import sqlite3,sys; p=sys.argv[1]; c=sqlite3.connect(p); r=c.execute('PRAGMA quick_check').fetchone(); c.close(); assert r and r[0]=='ok', r; print('SQLite quick_check: ok')" $env:DATABASE_PATH
  if ($LASTEXITCODE -ne 0) { throw 'SQLite integrity check failed.' }
}

pnpm run typecheck
if ($LASTEXITCODE -ne 0) { throw 'TypeScript typecheck failed.' }

pnpm --filter @workspace/api-server run build
if ($LASTEXITCODE -ne 0) { throw 'API build failed.' }

pnpm --filter @workspace/api-server run test:integration
if ($LASTEXITCODE -ne 0) { throw 'API integration tests failed.' }

pnpm --filter @workspace/telegram-checker run build
if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' }

Write-Host 'Validation completed successfully.'
