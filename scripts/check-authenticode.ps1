param(
  [string]$ReleaseDir = ""
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
if (-not $ReleaseDir) {
  $ReleaseDir = Join-Path $root "release\windows"
}

$files = Get-ChildItem $ReleaseDir -Filter "*.exe" -File | Sort-Object Name
if (-not $files) {
  throw "No Windows executable artifacts found in $ReleaseDir."
}

$records = foreach ($file in $files) {
  $signature = Get-AuthenticodeSignature -FilePath $file.FullName
  [pscustomobject]@{
    File = $file.Name
    Status = [string]$signature.Status
    StatusMessage = [string]$signature.StatusMessage
    SignerSubject = if ($signature.SignerCertificate) {
      $signature.SignerCertificate.Subject
    } else {
      ""
    }
    SignerThumbprint = if ($signature.SignerCertificate) {
      $signature.SignerCertificate.Thumbprint
    } else {
      ""
    }
  }
}

$outPath = Join-Path $ReleaseDir "AUTHENTICODE.txt"
$lines = @(
  "Telegram Checker Windows Authenticode status",
  "GeneratedUTC=$([DateTime]::UtcNow.ToString('o'))"
)
foreach ($record in $records) {
  $lines += (
    "File={0}; Status={1}; SignerSubject={2}; SignerThumbprint={3}; StatusMessage={4}" -f
    $record.File,
    $record.Status,
    $record.SignerSubject,
    $record.SignerThumbprint,
    ($record.StatusMessage -replace "[\r\n]+", " ")
  )
}
$lines | Set-Content -Path $outPath -Encoding utf8

$records | Format-Table -AutoSize

if ($env:REQUIRE_CODE_SIGNING -eq "1") {
  $invalid = @($records | Where-Object { $_.Status -ne "Valid" })
  if ($invalid.Count -gt 0) {
    throw "Authenticode signing is required but one or more executables are not Valid."
  }
}

Write-Host ("Authenticode evidence: " + $outPath)
