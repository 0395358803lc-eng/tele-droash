param(
  [int]$TimeoutSeconds = 60
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$exe = Join-Path $root "release\windows\win-unpacked\Telegram Checker.exe"
$smokeAppData = Join-Path $root ".build\electron-smoke\appdata"
$smokeLocalAppData = Join-Path $root ".build\electron-smoke\localappdata"

if (-not (Test-Path $exe)) {
  throw "Packaged Electron executable was not found: $exe"
}

if (Test-Path (Join-Path $root ".build\electron-smoke")) {
  Remove-Item (Join-Path $root ".build\electron-smoke") -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $smokeAppData, $smokeLocalAppData | Out-Null

$oldSmoke = $env:TELEGRAM_CHECKER_SMOKE_TEST
$oldAppData = $env:APPDATA
$oldLocalAppData = $env:LOCALAPPDATA

try {
  $env:TELEGRAM_CHECKER_SMOKE_TEST = "1"
  $env:APPDATA = $smokeAppData
  $env:LOCALAPPDATA = $smokeLocalAppData

  Write-Host "Starting packaged runtime smoke test..."
  $process = Start-Process -FilePath $exe -PassThru -WorkingDirectory (Split-Path $exe -Parent)

  if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
    try { $process.Kill($true) } catch {}
    throw "Packaged runtime smoke test timed out after $TimeoutSeconds seconds."
  }

  if ($process.ExitCode -ne 0) {
    throw "Packaged runtime smoke test failed with exit code $($process.ExitCode)."
  }

  Write-Host "Packaged runtime smoke test: PASS"
} finally {
  $env:TELEGRAM_CHECKER_SMOKE_TEST = $oldSmoke
  $env:APPDATA = $oldAppData
  $env:LOCALAPPDATA = $oldLocalAppData
}
