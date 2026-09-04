param(
  [string]$Python = "python"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$project = Join-Path $root "telegram-phone-number-checker"
$releaseDir = Join-Path $root "release\python"
$workDir = Join-Path $root ".build\pyinstaller"
$venvDir = Join-Path $workDir ".venv"
$venvPython = Join-Path $venvDir "Scripts\python.exe"
$engineExe = Join-Path $releaseDir "telegram-engine.exe"

if (Test-Path $workDir) { Remove-Item $workDir -Recurse -Force }
if (Test-Path $releaseDir) { Remove-Item $releaseDir -Recurse -Force }
New-Item -ItemType Directory -Force -Path $workDir, $releaseDir | Out-Null

Write-Host "== Building packaged Telegram Python engine =="

& $Python -m venv $venvDir
if ($LASTEXITCODE -ne 0) { throw "Failed to create PyInstaller virtual environment." }

& $venvPython -m pip install --disable-pip-version-check --upgrade pip
if ($LASTEXITCODE -ne 0) { throw "Failed to upgrade pip." }

Push-Location $project
try {
  & $venvPython -m pip install --disable-pip-version-check --require-hashes -r .\requirements.txt
  if ($LASTEXITCODE -ne 0) { throw "Failed to install locked Telegram runtime dependencies." }

  & $venvPython -m pip install --disable-pip-version-check "PySocks==1.7.1" "pyinstaller==6.22.2"
  if ($LASTEXITCODE -ne 0) { throw "Failed to install packaging dependencies." }

  & $venvPython -m pip install --disable-pip-version-check --no-deps -e .
  if ($LASTEXITCODE -ne 0) { throw "Failed to install local Telegram checker package." }

  $pyInstallerArgs = @(
    "--noconfirm",
    "--clean",
    "--onefile",
    "--name", "telegram-engine",
    "--distpath", $releaseDir,
    "--workpath", (Join-Path $workDir "work"),
    "--specpath", (Join-Path $workDir "spec"),
    "--paths", $project,
    "--collect-submodules", "telethon",
    "--collect-submodules", "phonenumbers",
    "--collect-data", "phonenumbers",
    "--hidden-import", "socks",
    ".\packaged_entry.py"
  )
  & $venvPython -m PyInstaller @pyInstallerArgs
  if ($LASTEXITCODE -ne 0) { throw "PyInstaller build failed." }
} finally {
  Pop-Location
}

if (-not (Test-Path $engineExe)) {
  throw "telegram-engine.exe was not created."
}

$selfTest = & $engineExe self-test
if ($LASTEXITCODE -ne 0) { throw "telegram-engine.exe self-test failed." }

try {
  $parsed = $selfTest | ConvertFrom-Json
} catch {
  throw "telegram-engine.exe self-test returned invalid JSON: $selfTest"
}

if (-not $parsed.ok) {
  throw "telegram-engine.exe self-test returned an unhealthy result."
}

Write-Host ("Telegram engine self-test: " + ($parsed | ConvertTo-Json -Compress))
Write-Host ("Telegram engine: " + $engineExe)
