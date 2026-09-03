$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if (-not $env:SESSION_SECRET) {
  throw 'SESSION_SECRET is required. Example: $env:SESSION_SECRET = [Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Maximum 256 })) is NOT recommended for persistence; configure a stable secret securely.'
}

if (-not $env:DATABASE_PATH) {
  $env:DATABASE_PATH = Join-Path $root 'data\checker.db'
}

$venvPython = Join-Path $root 'telegram-phone-number-checker\.venv\Scripts\python.exe'
if (Test-Path $venvPython) {
  $env:PYTHON_BIN = $venvPython
} elseif (-not $env:PYTHON_BIN) {
  $env:PYTHON_BIN = 'python'
}

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
Write-Host 'Starting API at http://127.0.0.1:3000'
Write-Host 'Starting dashboard at http://127.0.0.1:5173'

Start-Process powershell -ArgumentList '-NoExit','-NoProfile','-ExecutionPolicy','Bypass','-Command',$apiCommand
Start-Sleep -Seconds 2
Start-Process powershell -ArgumentList '-NoExit','-NoProfile','-ExecutionPolicy','Bypass','-Command',$webCommand
