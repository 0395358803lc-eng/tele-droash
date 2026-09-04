param(
  [switch]$SkipValidation
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$packagingDir = Join-Path $root "packaging\windows"
$releaseDir = Join-Path $root "release\windows"

Set-Location $root

Write-Host "== Telegram Checker Windows package build =="

$nodeMajor = [int](node -p "process.versions.node.split('.')[0]")
if ($LASTEXITCODE -ne 0 -or $nodeMajor -lt 22) {
  throw "Node.js 22 or newer is required."
}

$pnpmVersion = (pnpm --version).Trim()
if ($LASTEXITCODE -ne 0 -or $pnpmVersion -ne "10.34.5") {
  throw "pnpm 10.34.5 is required."
}

pnpm install --frozen-lockfile
if ($LASTEXITCODE -ne 0) { throw "Workspace install failed." }

if (-not $SkipValidation) {
  pnpm desktop:check
  if ($LASTEXITCODE -ne 0) { throw "Workspace validation failed." }
}

pnpm --filter @workspace/telegram-checker run build
if ($LASTEXITCODE -ne 0) { throw "Dashboard build failed." }

& (Join-Path $root "scripts\build-python-engine.ps1")
if ($LASTEXITCODE -ne 0) { throw "Python engine build failed." }

if (Test-Path $releaseDir) { Remove-Item $releaseDir -Recurse -Force }

Push-Location $packagingDir
try {
  npm install --no-audit --no-fund --package-lock=false
  if ($LASTEXITCODE -ne 0) { throw "Electron packaging dependencies failed to install." }

  npm run build
  if ($LASTEXITCODE -ne 0) { throw "Electron main-process bundle failed." }

  npx electron-builder install-app-deps
  if ($LASTEXITCODE -ne 0) { throw "Electron native dependency rebuild failed." }

  npm run dist:win -- --publish never
  if ($LASTEXITCODE -ne 0) { throw "Windows installer build failed." }
} finally {
  Pop-Location
}

$setup = Get-ChildItem $releaseDir -Filter "Telegram-Checker-Setup-*.exe" -File | Select-Object -First 1
$portable = Get-ChildItem $releaseDir -Filter "Telegram-Checker-Portable-*.exe" -File | Select-Object -First 1

if (-not $setup) { throw "NSIS installer artifact was not created." }
if (-not $portable) { throw "Portable executable artifact was not created." }
if ($setup.Length -lt 10MB) { throw "Installer artifact is unexpectedly small." }
if ($portable.Length -lt 10MB) { throw "Portable artifact is unexpectedly small." }

Get-FileHash $setup.FullName -Algorithm SHA256
Get-FileHash $portable.FullName -Algorithm SHA256

& (Join-Path $root "scripts\smoke-windows-package.ps1")
if ($LASTEXITCODE -ne 0) { throw "Packaged runtime smoke test failed." }

Write-Host ("Installer: " + $setup.FullName)
Write-Host ("Portable:  " + $portable.FullName)
