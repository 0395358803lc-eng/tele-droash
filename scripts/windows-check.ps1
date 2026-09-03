$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host '== Telegram Checker Desktop validation =='

$required = @('node','pnpm','python')
foreach ($tool in $required) {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
    throw "Required tool not found in PATH: $tool"
  }
}

$venvPython = Join-Path $root 'telegram-phone-number-checker\.venv\Scripts\python.exe'
$pythonBin = if (Test-Path $venvPython) { $venvPython } else { (Get-Command python).Source }
$env:PYTHON_BIN = $pythonBin

Write-Host ("Node:   " + (node --version))
Write-Host ("pnpm:   " + (pnpm --version))
Write-Host ("Python: " + (& $pythonBin --version))
Write-Host ("Python executable: " + $pythonBin)

if (-not $env:SESSION_SECRET -or $env:SESSION_SECRET.Length -lt 32) {
  throw 'SESSION_SECRET must be stable and contain at least 32 characters.'
}

if (-not $env:DATABASE_PATH) {
  $env:DATABASE_PATH = Join-Path $root 'data\checker.db'
}

Write-Host ("SQLite: " + $env:DATABASE_PATH)

$pythonProject = Join-Path $root 'telegram-phone-number-checker'
Push-Location $pythonProject
try {
  & $pythonBin -c "import telethon, phonenumbers, dotenv, telegram_phone_number_checker" 2>$null
  if ($LASTEXITCODE -ne 0) {
    throw 'Python runtime dependencies are missing. Install dependencies for telegram-phone-number-checker.'
  }

  & $pythonBin -m compileall -q .\telegram_phone_number_checker
  if ($LASTEXITCODE -ne 0) { throw 'Python compile check failed.' }
} finally {
  Pop-Location
}

pnpm run typecheck
if ($LASTEXITCODE -ne 0) { throw 'TypeScript typecheck failed.' }

pnpm --filter @workspace/api-server run build
if ($LASTEXITCODE -ne 0) { throw 'API build failed.' }

pnpm --filter @workspace/telegram-checker run build
if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' }

Write-Host 'Validation completed successfully.'
