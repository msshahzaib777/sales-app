# Taqseem installer: sets up (or updates) an installation after TaqseemSetup.exe has copied the
# program files. Run by the installer as administrator; not meant to be run by hand.
#
#   -Mode demo       new installation with demo data
#   -Mode business   new installation for a real business (-Business, -Owner, -Email)
#   -Mode update     keep the data: back it up, apply database changes, restart
#   -Fresh           delete the existing data first (then demo or business)
#
# Program files: the install folder (read-only). Data: C:\ProgramData\Taqseem (database, settings,
# backups, logs), so updating or reinstalling the program never touches it.
# Written for Windows PowerShell 5.1. ASCII only.

param(
  [Parameter(Mandatory = $true)][ValidateSet("demo", "business", "update")][string]$Mode,
  [string]$Business = "",
  [string]$Owner = "",
  [string]$Email = "",
  [switch]$Fresh,
  [string]$DataDir = (Join-Path $env:ProgramData "Taqseem")
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$AppDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$Node = Join-Path $AppDir "node\node.exe"
$PgBin = Join-Path $AppDir "pgsql\bin"
$Tools = Join-Path $AppDir "tools"
$DbDir = Join-Path $DataDir "db"
$LogDir = Join-Path $DataDir "logs"
$BackupDir = Join-Path $DataDir "backups"
$ServiceDir = Join-Path $DataDir "service"
$Settings = Join-Path $DataDir "settings.env"
$LoginFile = Join-Path $DataDir "first-login.txt"
$DbService = "TaqseemDatabase"
$WebService = "TaqseemWeb"
$FirewallRule = "Taqseem website"

New-Item -ItemType Directory -Force -Path $DataDir, $LogDir, $BackupDir, $ServiceDir | Out-Null
# Folder permissions first, before anything is written: only administrators and Windows itself may
# read the data folder (it holds the passwords); anyone on this computer may read the logs (no
# passwords are written there), so a failed setup can always be looked into; and the database
# folder is writable by this user and Network Service, because PostgreSQL drops administrator
# rights when an administrator starts it (initdb runs as this same user without them) and its
# service runs as Network Service.
$DbDir = Join-Path $DataDir "db"
New-Item -ItemType Directory -Force -Path $DbDir | Out-Null
$me = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
# Administrators own everything in the data folder first: files left by another account, by an
# older setup or by hand can otherwise refuse the changes below (and hide settings.env, so the
# database passwords could not be read). /A: the Administrators group, not this user.
cmd /c "takeown /F `"$DataDir`" /R /A /D Y >nul 2>&1"
cmd /c "icacls `"$DataDir`" /inheritance:r /grant:r *S-1-5-18:(OI)(CI)F *S-1-5-32-544:(OI)(CI)F /T /Q >nul 2>&1"
cmd /c "icacls `"$LogDir`" /grant *S-1-5-32-545:(OI)(CI)RX /T /Q >nul 2>&1"
cmd /c "icacls `"$DbDir`" /grant *${me}:(OI)(CI)M *S-1-5-20:(OI)(CI)M /T /Q >nul 2>&1"
Start-Transcript -Path (Join-Path $LogDir "install-log.txt") -Append | Out-Null

# Anyone on this computer may read the logs, so a failed setup can be looked into without taking
# over the folder (/C: carry on past a file that is in use).
function Open-Logs { cmd /c "icacls `"$LogDir`" /grant *S-1-5-32-545:(OI)(CI)RX /T /C /Q >nul 2>&1" }

function Step($text) { Write-Host "==> $text" }
function Fail($text) {
  Write-Host "FAILED: $text"
  try { Stop-Transcript | Out-Null } catch {}
  Open-Logs
  exit 1
}

# Any error the script did not expect still ends with one clear FAILED line (shown by the setup
# window), instead of a PowerShell error the window cuts off.
trap {
  Fail "$($_.Exception.Message) (install.ps1 line $($_.InvocationInfo.ScriptLineNumber))"
}

# Runs a program, returns its output and exit code (stderr warnings are not failures).
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

function Random-Hex([int]$bytes) {
  $buffer = New-Object byte[] $bytes
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($buffer)
  return -join ($buffer | ForEach-Object { $_.ToString("x2") })
}

function Test-Port([int]$port) {
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $async = $client.BeginConnect("127.0.0.1", $port, $null, $null)
    if (-not $async.AsyncWaitHandle.WaitOne(500)) { return $false }
    $client.EndConnect($async)
    return $true
  } catch {
    return $false
  } finally {
    $client.Close()
  }
}

function Free-Port([int]$start) {
  for ($p = $start; $p -lt $start + 50; $p++) { if (-not (Test-Port $p)) { return $p } }
  Fail "No free network port near $start."
}

function Read-Settings {
  $s = @{}
  if (Test-Path $Settings) {
    foreach ($line in Get-Content $Settings) {
      if ($line -match '^([A-Z_]+)=(.*)$') { $s[$Matches[1]] = $Matches[2] }
    }
  }
  return $s
}

function Write-Settings($s) {
  $s.Keys | Sort-Object | ForEach-Object { "$_=$($s[$_])" } | Set-Content -Path $Settings -Encoding ASCII
}

function Service-Exists($name) { return [bool](Get-Service -Name $name -ErrorAction SilentlyContinue) }

function Stop-Services {
  foreach ($name in $WebService, $DbService) {
    if (Service-Exists $name) {
      Capture { sc.exe stop $name } | Out-Null
      for ($i = 0; $i -lt 30 -and (Get-Service $name).Status -ne "Stopped"; $i++) { Start-Sleep -Seconds 1 }
    }
  }
}

function Remove-Services {
  Stop-Services
  $web = Join-Path $ServiceDir "$WebService.exe"
  if ((Service-Exists $WebService) -and (Test-Path $web)) { Capture { & $web uninstall } | Out-Null }
  if (Service-Exists $DbService) { Capture { & (Join-Path $PgBin "pg_ctl.exe") unregister -N $DbService } | Out-Null }
  for ($i = 0; $i -lt 10 -and ((Service-Exists $WebService) -or (Service-Exists $DbService)); $i++) { Start-Sleep -Seconds 1 }
}

# Runs one of the bundled tools (tools\*.mjs) with the app's database.
function Tool($name, [string[]]$arguments, [hashtable]$env = @{}) {
  $saved = @{}
  foreach ($k in $env.Keys) { $saved[$k] = [Environment]::GetEnvironmentVariable($k); [Environment]::SetEnvironmentVariable($k, $env[$k]) }
  try {
    return Capture { & $Node (Join-Path $Tools $name) @arguments }
  } finally {
    foreach ($k in $saved.Keys) { [Environment]::SetEnvironmentVariable($k, $saved[$k]) }
  }
}

function Wait-Database {
  for ($i = 0; $i -lt 60 -and -not (Test-Port ([int]$s.PG_PORT)); $i++) { Start-Sleep -Seconds 1 }
}

# The passwords in settings.env no longer match the database (the file was lost or rewritten):
# with the data kept, the database is started once allowing local sign-in without a password,
# the superuser gets the password from settings.env, and the normal sign-in rules are put back.
# PostgreSQL listens on this computer only, and only for this minute.
function Repair-Passwords {
  Step "Resetting the database passwords to the ones in settings.env"
  $hba = Join-Path $DbDir "pg_hba.conf"
  $saved = "$hba.taqseem-saved"
  Copy-Item $hba $saved -Force
  $result = $null
  try {
    Stop-Services
    @("host all all 127.0.0.1/32 trust", "host all all ::1/128 trust") | Set-Content -Path $hba -Encoding ASCII
    Start-Service $DbService
    Wait-Database
    $result = Tool "db.mjs" @("set-super-password") @{
      SALES_PG_SUPER_URL = "postgresql://postgres@localhost:$($s.PG_PORT)/postgres"
      SALES_PG_SUPER_PASSWORD = $s.PG_SUPER_PASSWORD
    }
  } catch {
    # Caught here, not by the trap, so the sign-in rules below are always put back.
    $result = @{ Code = 1; Out = $_.Exception.Message }
  } finally {
    Copy-Item $saved $hba -Force
    Remove-Item $saved -Force -ErrorAction SilentlyContinue
    Capture { sc.exe stop $DbService } | Out-Null
    for ($i = 0; $i -lt 30 -and (Get-Service $DbService).Status -ne "Stopped"; $i++) { Start-Sleep -Seconds 1 }
    Start-Service $DbService
    Wait-Database
  }
  if (-not $result -or $result.Code -ne 0) { Fail "Resetting the database passwords failed: $($result.Out)" }
}

Write-Host "Taqseem setup: $Mode$(if ($Fresh) { ' (fresh)' })"
Write-Host "Program: $AppDir"
Write-Host "Data:    $DataDir"

# -- 1. A fresh start deletes the old data --------------------------------------
if ($Fresh) {
  Step "Deleting the old data"
  Remove-Services
  foreach ($path in $DbDir, $Settings, $LoginFile) {
    if (Test-Path $path) {
      try { Remove-Item $path -Recurse -Force } catch { Fail "Could not delete $path. Restart the computer and run the setup again." }
    }
  }
}

# -- 2. Settings: ports and secrets, kept between updates -----------------------
$s = Read-Settings
$hadSettings = [bool]$s.PG_SUPER_PASSWORD
if (-not $hadSettings -and (Test-Path (Join-Path $DbDir "PG_VERSION"))) {
  Write-Host "    settings.env is missing or unreadable: new passwords are set on the existing database."
}
if (-not $s.PG_PORT) {
  # The database service already has its port (settings.env may have been lost).
  $image = (Get-ItemProperty "HKLM:\SYSTEM\CurrentControlSet\Services\$DbService" -ErrorAction SilentlyContinue).ImagePath
  if ($image -match '-p\s+(\d+)') { $s.PG_PORT = $Matches[1] } else { $s.PG_PORT = Free-Port 5433 }
}
if (-not $s.PORT) { $s.PORT = Free-Port 3000 }
if (-not $s.PG_SUPER_PASSWORD) { $s.PG_SUPER_PASSWORD = Random-Hex 16 }
if (-not $s.APP_DB_PASSWORD) { $s.APP_DB_PASSWORD = Random-Hex 16 }
if (-not $s.AUTH_SECRET) { $s.AUTH_SECRET = Random-Hex 32 }
if ($hadSettings) { Copy-Item $Settings "$Settings.bak" -Force }
Write-Settings $s
$superUrl = "postgresql://postgres:$($s.PG_SUPER_PASSWORD)@localhost:$($s.PG_PORT)/postgres"
$appUrl = "postgresql://sales_app:$($s.APP_DB_PASSWORD)@localhost:$($s.PG_PORT)/sales_app?schema=public"


# -- 3. Database ----------------------------------------------------------------
Step "Preparing the database"
$newDatabase = -not (Test-Path (Join-Path $DbDir "PG_VERSION"))
if ($newDatabase) {
  if ($Mode -eq "update") { Fail "There is no existing data to update. Run the setup again and choose demo data or your business." }
  # Again here: "start fresh" may have just deleted the folder.
  New-Item -ItemType Directory -Force -Path $DbDir | Out-Null
  cmd /c "icacls `"$DbDir`" /grant *${me}:(OI)(CI)M *S-1-5-20:(OI)(CI)M /T /Q >nul 2>&1"
  # In this user's own temp folder: initdb runs without administrator rights (see the folder
  # permissions at the top) and could not read a file in the administrators-only data folder.
  # Deleted straight after.
  $pwFile = [IO.Path]::GetTempFileName()
  Remove-Item (Join-Path $DataDir "pw.tmp") -Force -ErrorAction SilentlyContinue # left by older setups
  Set-Content -Path $pwFile -Value $s.PG_SUPER_PASSWORD -NoNewline -Encoding ASCII
  $r = Capture { & (Join-Path $PgBin "initdb.exe") -D $DbDir -U postgres "--pwfile=$pwFile" -A scram-sha-256 -E UTF8 --no-locale }
  Remove-Item $pwFile -Force -ErrorAction SilentlyContinue
  if ($r.Code -ne 0) { Fail "Creating the database failed: $($r.Out)" }
}
# The database service runs as Network Service, which needs to write only its own folder.
Capture { icacls $DbDir /grant "*S-1-5-20:(OI)(CI)M" /T /Q } | Out-Null

if (-not (Service-Exists $DbService)) {
  $r = Capture { & (Join-Path $PgBin "pg_ctl.exe") register -N $DbService -U "NT AUTHORITY\NetworkService" -D $DbDir -S auto -w -o "-p $($s.PG_PORT) -c listen_addresses=localhost" }
  if ($r.Code -ne 0) { Fail "Registering the database service failed: $($r.Out)" }
  Capture { sc.exe description $DbService "Taqseem database (PostgreSQL)" } | Out-Null
}
# Back to starting with Windows ("Stop Taqseem" may have turned that off).
Set-Service $DbService -StartupType Automatic
if ((Get-Service $DbService).Status -ne "Running") { Start-Service $DbService }
for ($i = 0; $i -lt 60 -and -not (Test-Port ([int]$s.PG_PORT)); $i++) { Start-Sleep -Seconds 1 }
if (-not (Test-Port ([int]$s.PG_PORT))) {
  $log = Get-ChildItem $DbDir -Filter "*.log" -Recurse -ErrorAction SilentlyContinue | Sort-Object LastWriteTime | Select-Object -Last 1
  Fail "The database did not start. $(if ($log) { "See $($log.FullName)" })"
}

$ensureEnv = @{ SALES_PG_SUPER_URL = $superUrl; SALES_APP_DB_PASSWORD = $s.APP_DB_PASSWORD }
$r = Tool "db.mjs" @("ensure") $ensureEnv
if ($r.Code -ne 0 -and $r.Out -match "password authentication failed") {
  Repair-Passwords
  $r = Tool "db.mjs" @("ensure") $ensureEnv
}
if ($r.Code -ne 0) { Fail "Preparing the database failed: $($r.Out)" }

# -- 4. Database changes (after a backup when there is data) ---------------------
Step "Updating the database"
$dbEnv = @{ DATABASE_URL = $appUrl }
$pending = Tool "migrate.mjs" @((Join-Path $AppDir "migrations"), "--status") $dbEnv
if ($pending.Code -ne 0) { Fail "Checking the database failed: $($pending.Out)" }
if (-not $newDatabase -and $pending.Out -ne "0") {
  Step "Backing up the database first"
  $file = Join-Path $BackupDir ("taqseem-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".sql")
  $r = Capture { & (Join-Path $PgBin "pg_dump.exe") "--dbname=$($appUrl -replace '\?.*$', '')" "--file=$file" --no-owner }
  if ($r.Code -ne 0) { Fail "The backup failed, so nothing was changed: $($r.Out)" }
  Get-ChildItem $BackupDir -Filter "taqseem-*.sql" | Sort-Object Name -Descending | Select-Object -Skip 10 | Remove-Item -Force
  Write-Host "    Backup: $file"
}
$r = Tool "migrate.mjs" @((Join-Path $AppDir "migrations")) $dbEnv
Write-Host $r.Out
if ($r.Code -ne 0) { Fail "Updating the database failed: $($r.Out)" }

# -- 5. First business ------------------------------------------------------------
$tenants = Tool "db.mjs" @("tenants") @{ SALES_APP_DB_URL = $appUrl }
if ($tenants.Code -ne 0) { Fail "Reading the database failed: $($tenants.Out)" }
if ($tenants.Out -eq "0") {
  if ($Mode -eq "demo") {
    Step "Loading the demo data"
    $r = Tool "seed.mjs" @() $dbEnv
    if ($r.Code -ne 0) { Fail "Loading the demo data failed: $($r.Out)" }
    $login = "Demo data. Sign in with owner@demo.test, accountant@demo.test or staff@demo.test, password Demo@12345."
  } elseif ($Mode -eq "business") {
    Step "Creating your business"
    if ($Business.Length -lt 2 -or $Owner.Length -lt 2 -or $Email -notmatch "^[^@\s]+@[^@\s]+\.[^@\s]+$") {
      Fail "Business name, owner name and a valid email are needed."
    }
    $r = Tool "create-tenant.mjs" @($Business, $Owner, $Email) $dbEnv
    if ($r.Code -ne 0) { Fail "Creating the business failed: $($r.Out)" }
    $lines = ($r.Out -split "`r?`n") | Where-Object { $_ -match "^(Owner login|One-time password):" }
    $login = "$Business. $($lines -join '. ')."
  }
  if ($login) {
    @(
      "Taqseem - first sign-in"
      ""
      $login
      ""
      "Open http://localhost:$($s.PORT) in a browser."
      "Write this down, then delete this file."
    ) | Set-Content -Path $LoginFile -Encoding ASCII
  }
}

# -- 6. Website service -------------------------------------------------------------
Step "Starting the website"
if (Service-Exists $WebService) {
  Capture { sc.exe stop $WebService } | Out-Null
  for ($i = 0; $i -lt 30 -and (Get-Service $WebService).Status -ne "Stopped"; $i++) { Start-Sleep -Seconds 1 }
}
$exe = Join-Path $ServiceDir "$WebService.exe"
# The stopped service can hold its program for a few seconds more: try again before giving up.
for ($i = 1; ; $i++) {
  try {
    Copy-Item (Join-Path $AppDir "service\WinSW.exe") $exe -Force
    break
  } catch {
    if ($i -ge 15) { Fail "Could not replace $exe ($($_.Exception.Message)). Restart the computer and run the setup again." }
    Start-Sleep -Seconds 2
  }
}
$xmlEscape = { param($v) [System.Security.SecurityElement]::Escape($v) }
@"
<service>
  <id>$WebService</id>
  <name>Taqseem website</name>
  <description>Taqseem: orders, delivery, stock and khata.</description>
  <executable>$(& $xmlEscape $Node)</executable>
  <arguments>server.js</arguments>
  <workingdirectory>$(& $xmlEscape (Join-Path $AppDir "app"))</workingdirectory>
  <depend>$DbService</depend>
  <startmode>Automatic</startmode>
  <onfailure action="restart" delay="10 sec" />
  <onfailure action="restart" delay="30 sec" />
  <resetfailure>1 hour</resetfailure>
  <logpath>$(& $xmlEscape $LogDir)</logpath>
  <log mode="roll-by-size"><sizeThreshold>5120</sizeThreshold><keepFiles>5</keepFiles></log>
  <env name="NODE_ENV" value="production" />
  <env name="PORT" value="$($s.PORT)" />
  <env name="HOSTNAME" value="0.0.0.0" />
  <env name="DATABASE_URL" value="$(& $xmlEscape $appUrl)" />
  <env name="AUTH_SECRET" value="$($s.AUTH_SECRET)" />
  <env name="AUTH_TRUST_HOST" value="true" />
</service>
"@ | Set-Content -Path (Join-Path $ServiceDir "$WebService.xml") -Encoding UTF8
if (-not (Service-Exists $WebService)) {
  $r = Capture { & $exe install }
  if ($r.Code -ne 0) { Fail "Registering the website service failed: $($r.Out)" }
}
Set-Service $WebService -StartupType Automatic
Start-Service $WebService
$ready = $false
for ($i = 0; $i -lt 90; $i++) {
  Start-Sleep -Seconds 1
  try {
    Invoke-WebRequest -Uri "http://localhost:$($s.PORT)/login" -UseBasicParsing -TimeoutSec 5 | Out-Null
    $ready = $true
    break
  } catch {}
}
if (-not $ready) { Fail "The website did not start. See the logs in $LogDir" }

# -- 7. Other computers in the office, and the shortcut ------------------------------
Get-NetFirewallRule -DisplayName $FirewallRule -ErrorAction SilentlyContinue | Remove-NetFirewallRule
New-NetFirewallRule -DisplayName $FirewallRule -Direction Inbound -Protocol TCP -LocalPort $s.PORT -Action Allow -Profile Private | Out-Null
@("[InternetShortcut]", "URL=http://localhost:$($s.PORT)/") | Set-Content -Path (Join-Path $AppDir "Taqseem.url") -Encoding ASCII

Write-Host "Done: http://localhost:$($s.PORT)"
Stop-Transcript | Out-Null
Open-Logs
exit 0
