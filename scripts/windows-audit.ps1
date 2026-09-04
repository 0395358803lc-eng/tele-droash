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

$pythonProject = Join-Path $root 'telegram-phone-number-checker'
$auditVenv = Join-Path $root 'data\.audit-venv'
$auditPython = Join-Path $auditVenv 'Scripts\python.exe'
if (-not (Test-Path $auditPython)) {
  Write-Host 'Creating isolated pip-audit environment...'
  & $venvPython -m venv $auditVenv
  if ($LASTEXITCODE -ne 0) { throw 'Failed to create pip-audit environment.' }
}

& $auditPython -m pip install --upgrade pip pip-audit
if ($LASTEXITCODE -ne 0) { throw 'Failed to install pip-audit in its isolated environment.' }

& $auditPython -m pip_audit --requirement (Join-Path $pythonProject 'requirements.txt')
if ($LASTEXITCODE -ne 0) { throw 'Python dependency audit failed.' }

Write-Host 'Dependency security audit completed successfully.'
