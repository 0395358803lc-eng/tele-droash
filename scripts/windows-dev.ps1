$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$nodeMajor = [int](node -p "process.versions.node.split('.')[0]")
if ($LASTEXITCODE -ne 0 -or $nodeMajor -lt 22) {
  throw 'Node.js 22 or newer is required. Run setup.bat to install the supported version.'
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

$apiEnv = @{
  SESSION_SECRET = $env:SESSION_SECRET
  DATABASE_PATH = $env:DATABASE_PATH
  PYTHON_BIN = $env:PYTHON_BIN
  PORT = '3000'
  HOST = '127.0.0.1'
  NODE_ENV = 'development'
}
$frontendEnv = @{
  PORT = '5173'
  BASE_PATH = '/'
  API_TARGET = 'http://127.0.0.1:3000'
  NODE_ENV = 'development'
}

function New-EnvPrefix([hashtable]$vars) {
  return ($vars.GetEnumerator() | ForEach-Object {
    '$env:{0}={1};' -f $_.Key, (ConvertTo-Json ([string]$_.Value) -Compress)
  }) -join ' '
}

$apiCommand = (New-EnvPrefix $apiEnv) + " Set-Location " + (ConvertTo-Json $root -Compress) + "; pnpm --filter @workspace/api-server run dev"
$webCommand = (New-EnvPrefix $frontendEnv) + " Set-Location " + (ConvertTo-Json $root -Compress) + "; pnpm --filter @workspace/telegram-checker run dev"

Write-Host ('SQLite database: ' + $env:DATABASE_PATH)
Write-Host ('Python: ' + $env:PYTHON_BIN)
Write-Host 'Starting API at http://127.0.0.1:3000'
Write-Host 'Starting dashboard at http://127.0.0.1:5173'

Start-Process powershell -ArgumentList '-NoExit','-NoProfile','-ExecutionPolicy','Bypass','-Command',$apiCommand
Start-Sleep -Seconds 2
Start-Process powershell -ArgumentList '-NoExit','-NoProfile','-ExecutionPolicy','Bypass','-Command',$webCommand
