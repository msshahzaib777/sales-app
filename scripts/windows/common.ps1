# Taqseem: settings and helpers shared by setup.ps1 (first install) and deploy.ps1 (start, stop,
# update). Dot-source it: . (Join-Path $PSScriptRoot "common.ps1")
#
# Written for Windows PowerShell 5.1 (built into Windows 10 and 11). ASCII only.

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$SetupDir = Join-Path $Root ".setup"
New-Item -ItemType Directory -Force -Path $SetupDir | Out-Null

$PnpmVersion = "10.28.0"
$Port = 3000
$EnvFile = Join-Path $Root ".env"
$DbHelper = Join-Path $Root "scripts\windows\db.mjs"
$PgVersion = "17.10.0-beta.17"
# The data folder keeps its first name ("SalesApp") so existing installations keep their data.
$AppData = Join-Path $env:LOCALAPPDATA "SalesApp"
$PgRoot = Join-Path $AppData "postgres"
$PgBin = Join-Path $PgRoot "bin"
$PgData = Join-Path $AppData "data"
$SuperFile = Join-Path $AppData "postgres-superuser-password.txt"
$BackupDir = Join-Path $AppData "backups"
$PgPort = 5432

function Step($text) { Write-Host ""; Write-Host "==> $text" -ForegroundColor Cyan }
function Ok($text) { Write-Host "    $text" -ForegroundColor Green }
function Info($text) { Write-Host "    $text" }
function Warn($text) { Write-Host "    $text" -ForegroundColor Yellow }

function Refresh-Path {
  $machine = [Environment]::GetEnvironmentVariable("Path", "Machine")
  $user = [Environment]::GetEnvironmentVariable("Path", "User")
  $env:Path = "$machine;$user"
  $npmGlobal = Join-Path $env:APPDATA "npm"
  if (Test-Path $npmGlobal) { $env:Path = "$env:Path;$npmGlobal" }
}

function Random-Hex([int]$bytes) {
  $buffer = New-Object byte[] $bytes
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($buffer)
  return -join ($buffer | ForEach-Object { $_.ToString("x2") })
}

# True when something accepts connections on this port on this laptop.
function Test-Port([int]$port) {
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $async = $client.BeginConnect("127.0.0.1", $port, $null, $null)
    if (-not $async.AsyncWaitHandle.WaitOne(1000)) { return $false }
    $client.EndConnect($async)
    return $true
  } catch {
    return $false
  } finally {
    $client.Close()
  }
}

function Have($command) { return [bool](Get-Command $command -ErrorAction SilentlyContinue) }

function Winget-Install($id, $extra) {
  $wingetArgs = @("install", "--exact", "--id", $id, "--accept-source-agreements", "--accept-package-agreements", "--disable-interactivity")
  if ($extra) { $wingetArgs += $extra }
  & winget @wingetArgs | Out-Host
  return $LASTEXITCODE
}

# Runs a program and returns its output (stdout and stderr) as text with its exit code. Windows
# PowerShell 5.1 turns stderr lines into errors, which "Stop" would treat as fatal; warnings from
# psql or pnpm are not failures, so collect them with "Continue" and judge by the exit code.
function Capture([scriptblock]$command) {
  $previous = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $out = & $command 2>&1 | ForEach-Object { "$_" } | Out-String
    return @{ Out = $out.Trim(); Code = $LASTEXITCODE }
  } finally {
    $ErrorActionPreference = $previous
  }
}

# The newest PostgreSQL installed as a Windows service (C:\Program Files\PostgreSQL\NN), if any.
function Find-ServicePsql {
  $found = Get-ChildItem "C:\Program Files\PostgreSQL\*\bin\psql.exe" -ErrorAction SilentlyContinue |
    Sort-Object { [int]($_.Directory.Parent.Name -replace "\D", "") } -Descending |
    Select-Object -First 1
  if ($found) { return $found.FullName } else { return $null }
}

# Which PostgreSQL this installation uses: its own copy in the app data folder, or a Windows service.
function Uses-OwnPostgres { return (Test-Path (Join-Path $PgData "PG_VERSION")) }

# Starts the database if it is not running. Returns $null when it runs, or an error message.
function Start-Database {
  if (Test-Port $PgPort) { return $null }
  if (-not (Uses-OwnPostgres)) {
    Get-Service -Name "postgresql*" -ErrorAction SilentlyContinue | Where-Object { $_.Status -ne "Running" } | Start-Service
    for ($i = 0; $i -lt 30 -and -not (Test-Port $PgPort); $i++) { Start-Sleep -Seconds 1 }
    if (Test-Port $PgPort) { return $null }
    return "The PostgreSQL service did not start. Open Services (services.msc) and start it."
  }
  $pgCtl = Join-Path $PgBin "pg_ctl.exe"
  $pgLog = Join-Path $PgData "server.log"
  # Started in the background on purpose: the server keeps running and holds on to whatever output
  # it was given, so waiting for pg_ctl's output here would never finish.
  $pgArgs = @("start", "-D", "`"$PgData`"", "-l", "`"$pgLog`"", "-o", "`"-p $PgPort -c listen_addresses=localhost`"")
  Start-Process -FilePath $pgCtl -ArgumentList $pgArgs -WindowStyle Hidden
  for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Seconds 1
    if (Test-Port $PgPort) { return $null }
  }
  $tail = if (Test-Path $pgLog) { (Get-Content $pgLog -Tail 15) -join "`n" } else { "(no log)" }
  return "PostgreSQL did not start within a minute. Last lines of $pgLog`n$tail"
}

# The DATABASE_URL from .env.
function Read-DatabaseUrl {
  if (-not (Test-Path $EnvFile)) { return $null }
  $line = Get-Content $EnvFile | Where-Object { $_ -like "DATABASE_URL=*" } | Select-Object -First 1
  if (-not $line) { return $null }
  return ($line -replace '^DATABASE_URL="?([^"]*)"?$', '$1')
}

# True when the built website is older than the code (or there is no build yet).
function Needs-Build {
  $buildId = Join-Path $Root ".next\BUILD_ID"
  if (-not (Test-Path $buildId)) { return $true }
  $built = (Get-Item $buildId).LastWriteTime
  $newest = Get-ChildItem -Path (Join-Path $Root "src"), (Join-Path $Root "prisma"), (Join-Path $Root "package.json"), (Join-Path $Root "pnpm-lock.yaml") -Recurse -File |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
  return ($newest.LastWriteTime -gt $built)
}
