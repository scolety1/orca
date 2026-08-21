<#
.SYNOPSIS
  Removes the Thousand Sunny Fleet Desktop and Start Menu shortcuts (M14).

.DESCRIPTION
  Only removes the two .lnk files Install-TsfLauncher.ps1 created. Does not touch
  Orca itself, Orca's settings, or the TSF repo/checkout -- this uninstalls the
  launch shortcuts only, not TSF.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File Uninstall-TsfLauncher.ps1
#>

$ErrorActionPreference = 'Stop'

$desktopLnk = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Thousand Sunny Fleet.lnk'
$startMenuLnk = Join-Path ([Environment]::GetFolderPath('Programs')) 'Thousand Sunny Fleet.lnk'

foreach ($lnk in @($desktopLnk, $startMenuLnk)) {
    if (Test-Path $lnk) {
        Remove-Item $lnk -Force
        Write-Host "Removed $lnk"
    } else {
        Write-Host "Not present: $lnk"
    }
}

Write-Host ''
Write-Host 'Thousand Sunny Fleet shortcuts removed. Orca itself and its settings were not changed.'
