# Taqseem uninstaller step: run by Windows "Uninstall" (and by the installer before files are
# replaced). Stops and removes the two Windows services and the firewall rule.
#
#   -StopOnly     only stop the services (the installer is about to replace the program files)
#   -DeleteData   also delete C:\ProgramData\Taqseem (database, backups, settings, logs)
#
# Written for Windows PowerShell 5.1. ASCII only.

param(
  [switch]$StopOnly,
  [switch]$DeleteData,
  [string]$DataDir = (Join-Path $env:ProgramData "Taqseem")
)

$ErrorActionPreference = "Continue"
$AppDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$PgCtl = Join-Path $AppDir "pgsql\bin\pg_ctl.exe"
$WebExe = Join-Path $DataDir "service\TaqseemWeb.exe"

function Service-Exists($name) { return [bool](Get-Service -Name $name -ErrorAction SilentlyContinue) }

foreach ($name in "TaqseemWeb", "TaqseemDatabase") {
  if (Service-Exists $name) {
    sc.exe stop $name | Out-Null
    for ($i = 0; $i -lt 30 -and (Get-Service $name).Status -ne "Stopped"; $i++) { Start-Sleep -Seconds 1 }
  }
}
# The services hold program files open; make sure nothing is left running from the install folder.
Get-Process -Name "node", "postgres", "pg_ctl" -ErrorAction SilentlyContinue |
  Where-Object { $_.Path -and $_.Path.StartsWith($AppDir, [StringComparison]::OrdinalIgnoreCase) } |
  Stop-Process -Force -ErrorAction SilentlyContinue
if ($StopOnly) { exit 0 }

if ((Service-Exists "TaqseemWeb") -and (Test-Path $WebExe)) { & $WebExe uninstall | Out-Null }
if ((Service-Exists "TaqseemDatabase") -and (Test-Path $PgCtl)) { & $PgCtl unregister -N TaqseemDatabase | Out-Null }
Get-NetFirewallRule -DisplayName "Taqseem website" -ErrorAction SilentlyContinue | Remove-NetFirewallRule
Remove-Item (Join-Path $AppDir "Taqseem.url") -Force -ErrorAction SilentlyContinue
if ($DeleteData -and (Test-Path $DataDir)) {
  Start-Sleep -Seconds 2
  Remove-Item $DataDir -Recurse -Force -ErrorAction SilentlyContinue
}
exit 0
