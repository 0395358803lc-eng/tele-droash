$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host '== Telegram Checker dependency security audit =='

$venvPython = Join-Path $root 'telegram-phone-number-checker\.venv\Scripts\python.exe'
if (-not (Test-Path $venvPython)) {
  throw 'Project Python virtual environment is missing. Run: pnpm desktop:setup'
}

pnpm audit --prod
if ($LASTEXITCODE -ne 0) { throw 'Node production dependency audit failed.' }

Push-Location (Join-Path $root 'telegram-phone-number-checker')
try {
  & $venvPython -m pip_audit
  if ($LASTEXITCODE -ne 0) { throw 'Python dependency audit failed.' }
} finally {
  Pop-Location
}

Write-Host 'Dependency security audit completed successfully.'
