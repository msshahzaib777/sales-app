# Taqseem: Start / Stop from the Start menu (shortcuts made by the installer).
#
#   -Action stop    stop the website and the database, and keep them stopped (also after a restart)
#   -Action start   start them, start them with Windows again, and open the website
#
# Asks for administrator permission itself (Windows services need it) and reports with a small
# message box, since it runs without a window. Written for Windows PowerShell 5.1. ASCII only.

param([Parameter(Mandatory = $true)][ValidateSet("start", "stop")][string]$Action)

$ErrorActionPreference = "Stop"
$AppDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$Shell = New-Object -ComObject WScript.Shell
function Say($text, [int]$icon = 64) { $Shell.Popup($text, 0, "Taqseem", $icon) | Out-Null }

# Not yet administrator: start again with permission (Windows shows the usual Yes / No box).
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) {
  try {
    Start-Process -FilePath powershell.exe -Verb RunAs -WindowStyle Hidden -ArgumentList @(
      "-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden",
      "-File", "`"$PSCommandPath`"", "-Action", $Action)
  } catch {
    Say "Taqseem needs administrator permission to $Action. Nothing was changed." 48
  }
  exit 0
}

$Web = "TaqseemWeb"
$Db = "TaqseemDatabase"
foreach ($name in $Web, $Db) {
  if (-not (Get-Service -Name $name -ErrorAction SilentlyContinue)) {
    Say "Taqseem is not set up on this computer (the service $name is missing). Run TaqseemSetup again." 16
    exit 1
  }
}

function Wait-Status($name, $status) {
  for ($i = 0; $i -lt 60 -and (Get-Service $name).Status -ne $status; $i++) { Start-Sleep -Seconds 1 }
  return (Get-Service $name).Status -eq $status
}

$url = "http://localhost:3000/"
$link = Join-Path $AppDir "Taqseem.url"
if (Test-Path $link) {
  $line = Get-Content $link | Where-Object { $_ -like "URL=*" } | Select-Object -First 1
  if ($line) { $url = $line.Substring(4) }
}

try {
  if ($Action -eq "stop") {
    # The website first: it uses the database.
    Stop-Service $Web -Force
    Stop-Service $Db -Force
    $ok = (Wait-Status $Web "Stopped") -and (Wait-Status $Db "Stopped")
    Set-Service $Web -StartupType Manual
    Set-Service $Db -StartupType Manual
    if ($ok) {
      Say "Taqseem is stopped. It stays stopped, also after a restart, until you click Start Taqseem."
    } else {
      Say "Taqseem did not stop completely. Restart the computer; it will stay stopped after that." 48
    }
  } else {
    Set-Service $Db -StartupType Automatic
    Set-Service $Web -StartupType Automatic
    Start-Service $Db
    Start-Service $Web
    $ready = $false
    for ($i = 0; $i -lt 90 -and -not $ready; $i++) {
      Start-Sleep -Seconds 1
      try {
        Invoke-WebRequest -Uri "${url}login" -UseBasicParsing -TimeoutSec 5 | Out-Null
        $ready = $true
      } catch {}
    }
    if ($ready) {
      Start-Process $url
    } else {
      Say "Taqseem was started but the website is not answering yet. Wait a minute and open it again. Logs: $env:ProgramData\Taqseem\logs" 48
    }
  }
} catch {
  Say "Could not $Action Taqseem: $($_.Exception.Message)" 16
  exit 1
}
exit 0
