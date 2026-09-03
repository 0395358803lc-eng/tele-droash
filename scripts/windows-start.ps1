$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

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

foreach ($port in @(3000, 5173)) {
  $listener = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue
  if ($listener) {
    throw "Port $port is already in use. Stop the existing process before starting Telegram Checker."
  }
}

$apiDist = Join-Path $root 'artifacts\api-server\dist\index.mjs'
$webDist = Join-Path $root 'artifacts\telegram-checker\dist\public\index.html'
if (-not (Test-Path $apiDist)) {
  pnpm --filter @workspace/api-server run build
  if ($LASTEXITCODE -ne 0) { throw 'API build failed.' }
}
if (-not (Test-Path $webDist)) {
  pnpm --filter @workspace/telegram-checker run build
  if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' }
}

$env:HOST = '127.0.0.1'
$env:PORT = '3000'
$env:NODE_ENV = 'production'
$env:API_TARGET = 'http://127.0.0.1:3000'

Write-Host ('SQLite database: ' + $env:DATABASE_PATH)
Write-Host ('Python: ' + $env:PYTHON_BIN)
Write-Host 'API:       http://127.0.0.1:3000'
Write-Host 'Dashboard: http://127.0.0.1:5173'
Write-Host 'Keep this terminal open while Telegram Checker is running. Ctrl+C stops both processes.'

pnpm exec concurrently --kill-others --names API,WEB --prefix-colors blue,green `
  "pnpm --filter @workspace/api-server run start" `
  "pnpm --filter @workspace/telegram-checker run serve"

if ($LASTEXITCODE -ne 0) {
  throw 'Telegram Checker runtime exited with an error.'
}
