$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host '== Telegram Checker Desktop setup =='

foreach ($tool in @('node','pnpm','python')) {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
    throw "Required tool not found in PATH: $tool"
  }
}

$pythonProject = Join-Path $root 'telegram-phone-number-checker'
$venvPython = Join-Path $pythonProject '.venv\Scripts\python.exe'
if (-not (Test-Path $venvPython)) {
  Write-Host 'Creating isolated Python environment...'
  python -m venv (Join-Path $pythonProject '.venv')
  if ($LASTEXITCODE -ne 0) { throw 'Failed to create Python virtual environment.' }
}

Write-Host 'Installing Python runtime/test/audit dependencies...'
& $venvPython -m pip install --upgrade pip
if ($LASTEXITCODE -ne 0) { throw 'Failed to upgrade pip in the project virtual environment.' }
Push-Location $pythonProject
try {
  & $venvPython -m pip install -e . pytest pytest-asyncio pip-audit
  if ($LASTEXITCODE -ne 0) { throw 'Failed to install Python project dependencies.' }
  & $venvPython -m pip check
  if ($LASTEXITCODE -ne 0) { throw 'Python dependency consistency check failed.' }
} finally {
  Pop-Location
}

Write-Host 'Installing Node workspace dependencies...'
pnpm install
if ($LASTEXITCODE -ne 0) { throw 'pnpm install failed.' }

$userSecret = [Environment]::GetEnvironmentVariable('SESSION_SECRET', 'User')
if (-not $userSecret -and $env:SESSION_SECRET -and $env:SESSION_SECRET.Length -ge 32) {
  $userSecret = $env:SESSION_SECRET
}
if (-not $userSecret -or $userSecret.Length -lt 32) {
  $bytes = New-Object byte[] 48
  $rng = New-Object Security.Cryptography.RNGCryptoServiceProvider
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  $userSecret = [Convert]::ToBase64String($bytes)
  Write-Host 'Generated a persistent SESSION_SECRET for the current Windows user.'
}
[Environment]::SetEnvironmentVariable('SESSION_SECRET', $userSecret, 'User')

$userDb = [Environment]::GetEnvironmentVariable('DATABASE_PATH', 'User')
if (-not $userDb) { $userDb = Join-Path $root 'data\checker.db' }
[Environment]::SetEnvironmentVariable('DATABASE_PATH', $userDb, 'User')
[Environment]::SetEnvironmentVariable('PYTHON_BIN', $venvPython, 'User')

$env:SESSION_SECRET = $userSecret
$env:DATABASE_PATH = $userDb
$env:PYTHON_BIN = $venvPython

Write-Host ('Python: ' + $venvPython)
Write-Host ('SQLite: ' + $userDb)
Write-Host 'Persistent Windows user environment is configured.'
Write-Host 'Setup completed. Run: pnpm desktop:check'
