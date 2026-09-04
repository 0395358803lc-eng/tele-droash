param([switch]$SkipNodeInstall)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host '== Telegram Checker Desktop setup =='

foreach ($tool in @('node','pnpm','python')) {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
    throw "Required tool not found in PATH: $tool"
  }
}

python -c "import sys; raise SystemExit(0 if sys.version_info >= (3,11) else 1)"
if ($LASTEXITCODE -ne 0) {
  throw 'Python 3.11 or newer is required. Run setup.bat to install the supported version.'
}

$pythonProject = Join-Path $root 'telegram-phone-number-checker'
$venvPython = Join-Path $pythonProject '.venv\Scripts\python.exe'
if (-not (Test-Path $venvPython)) {
  Write-Host 'Creating isolated Python environment...'
  python -m venv (Join-Path $pythonProject '.venv')
  if ($LASTEXITCODE -ne 0) { throw 'Failed to create Python virtual environment.' }
}

Write-Host 'Installing locked Python runtime/test dependencies...'
& $venvPython -m pip install --upgrade pip
if ($LASTEXITCODE -ne 0) { throw 'Failed to upgrade pip in the project virtual environment.' }
Push-Location $pythonProject
try {
  & $venvPython -m pip install --require-hashes -r .\requirements-dev.txt
  if ($LASTEXITCODE -ne 0) { throw 'Failed to install locked Python dependencies.' }

  & $venvPython -m pip install --no-deps -e .
  if ($LASTEXITCODE -ne 0) { throw 'Failed to install the local Python project.' }

  & $venvPython -m pip check
  if ($LASTEXITCODE -ne 0) { throw 'Python dependency consistency check failed.' }
} finally {
  Pop-Location
}

if (-not $SkipNodeInstall) {
  Write-Host 'Installing Node workspace dependencies...'
  pnpm install --frozen-lockfile
  if ($LASTEXITCODE -ne 0) { throw 'pnpm install failed.' }
} else {
  Write-Host 'Node workspace dependencies were installed by the bootstrap launcher.'
}

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
