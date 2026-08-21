<#
.SYNOPSIS
  One-time local install for the Thousand Sunny Fleet desktop launcher (M14).

.DESCRIPTION
  Creates a Desktop shortcut and a Start Menu shortcut that both invoke
  Launch-TSF.ps1 from this checkout in place -- TSF runs from source (like the
  rest of this program), so nothing is copied elsewhere; this only wires up the
  double-click entry points. Safe to re-run: it only ever (re)writes the two
  .lnk files it owns and never touches any other Orca or Windows shortcut/setting.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File Install-TsfLauncher.ps1
#>

$ErrorActionPreference = 'Stop'

$LauncherDir = $PSScriptRoot
$LaunchScript = Join-Path $LauncherDir 'Launch-TSF.ps1'
$IconPath = Join-Path $LauncherDir 'tsf.ico'

if (-not (Test-Path $LaunchScript)) {
    throw "Launch-TSF.ps1 not found next to this script -- run Install-TsfLauncher.ps1 from inside tsf/launcher."
}

function New-TsfShortcut {
    param([string]$LnkPath)
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($LnkPath)
    $shortcut.TargetPath = (Get-Command powershell.exe).Source
    $shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$LaunchScript`""
    $shortcut.WorkingDirectory = $LauncherDir
    $shortcut.Description = 'Thousand Sunny Fleet'
    if (Test-Path $IconPath) {
        $shortcut.IconLocation = "$IconPath,0"
    }
    $shortcut.Save()
    Write-Host "Wrote $LnkPath"
}

$desktopLnk = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Thousand Sunny Fleet.lnk'
New-TsfShortcut -LnkPath $desktopLnk

$startMenuDir = Join-Path ([Environment]::GetFolderPath('Programs')) ''
if (-not (Test-Path $startMenuDir)) { New-Item -ItemType Directory -Path $startMenuDir -Force | Out-Null }
$startMenuLnk = Join-Path $startMenuDir 'Thousand Sunny Fleet.lnk'
New-TsfShortcut -LnkPath $startMenuLnk

Write-Host ''
Write-Host 'Thousand Sunny Fleet is installed. Double-click the Desktop or Start Menu shortcut to launch it.'
Write-Host 'If this is the first launch on this machine, a one-time guided setup page will open -- see tsf/launcher/first-run-setup.html.'
Write-Host 'To remove: run Uninstall-TsfLauncher.ps1 from this same folder.'
