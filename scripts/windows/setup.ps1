# Sales App: one-step setup and start on a Windows laptop with nothing installed.
#
# Run it by double-clicking setup-windows.bat in the project folder. It is safe to run again: each
# step checks what is already done. The first run installs Node.js, pnpm and PostgreSQL, creates
# the database, asks whether to load demo data or set up your business, builds the website and
# starts it. Later runs ask whether to start the website (keeping all data) or to do a fresh
# installation (delete all data, after typing DELETE), then update and start it.
#
# Written for Windows PowerShell 5.1 (built into Windows 10 and 11).

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$Root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $Root
$SetupDir = Join-Path $Root ".setup"
New-Item -ItemType Directory -Force -Path $SetupDir | Out-Null
Start-Transcript -Path (Join-Path $SetupDir "setup-log.txt") -Append | Out-Null

$PnpmVersion = "10.28.0"
$Port = 3000
$EnvFile = Join-Path $Root ".env"
$DbHelper = Join-Path $Root "scripts\windows\db.mjs"
$PgVersion = "17.10.0-beta.17"
$PgRoot = Join-Path $env:LOCALAPPDATA "SalesApp\postgres"
$PgBin = Join-Path $PgRoot "bin"
$PgData = Join-Path $env:LOCALAPPDATA "SalesApp\data"
$SuperFile = Join-Path $env:LOCALAPPDATA "SalesApp\postgres-superuser-password.txt"
$PgPort = 5432

function Step($text) { Write-Host ""; Write-Host "==> $text" -ForegroundColor Cyan }
function Ok($text) { Write-Host "    $text" -ForegroundColor Green }
function Info($text) { Write-Host "    $text" }
function Fail($text) {
  Write-Host ""
  Write-Host "SETUP STOPPED: $text" -ForegroundColor Red
  Write-Host "A log of this run is in $SetupDir\setup-log.txt" -ForegroundColor Yellow
  Stop-Transcript | Out-Null
  exit 1
}

# Runs a command and stops the setup if it fails.
function Run($what, [scriptblock]$command) {
  & $command
  if ($LASTEXITCODE -ne 0) { Fail "$what failed (exit code $LASTEXITCODE). See the messages above." }
}

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

Write-Host "Sales App setup" -ForegroundColor White
Write-Host "Project folder: $Root"

# -- 0. Start, or fresh installation -----------------------------------------
$Fresh = $false
if ((Test-Path $EnvFile) -or (Test-Path $PgData)) {
  Write-Host ""
  Write-Host "Sales App is already installed on this laptop. What do you want to do?" -ForegroundColor White
  Write-Host "    1 = Start the website and keep all data (press Enter)"
  Write-Host "    2 = Fresh installation: DELETE ALL DATA (orders, bills, payments, stock, customers...)"
  Write-Host "        and start again with an empty database"
  $choice = Read-Host "    Type 1 or 2"
  if ($choice -eq "2") {
    Write-Host ""
    Write-Host "    Everything in the database will be deleted for good. There is no undo." -ForegroundColor Red
    Write-Host "    Make a backup first if any of it is real business data." -ForegroundColor Red
    $confirm = Read-Host "    Type DELETE (in capitals) to delete everything, or press Enter to keep it"
    if ($confirm -ceq "DELETE") {
      $Fresh = $true
      Write-Host "    Fresh installation: the data will be deleted below." -ForegroundColor Yellow
    } else {
      Write-Host "    Nothing deleted. Starting the website with your data." -ForegroundColor Green
    }
  }
}

# -- 1. Windows package manager ----------------------------------------------
Step "Checking the Windows package manager (winget)"
if (-not (Have "winget")) {
  Write-Host "    winget is missing. Install 'App Installer' from the Microsoft Store, then run this again." -ForegroundColor Yellow
  Start-Process "ms-windows-store://pdp/?productid=9NBLGGH4NNS1"
  Fail "winget (App Installer) is not installed."
}
Ok "winget is available"

# -- 2. Node.js --------------------------------------------------------------
Step "Checking Node.js (needs 20.19 or newer)"
Refresh-Path
$needNode = $true
if (Have "node") {
  $v = (node --version).TrimStart("v").Split(".")
  if ([int]$v[0] -gt 20 -or ([int]$v[0] -eq 20 -and [int]$v[1] -ge 19)) { $needNode = $false }
}
if ($needNode) {
  Info "Installing Node.js LTS..."
  $code = Winget-Install "OpenJS.NodeJS.LTS" @("--silent")
  Refresh-Path
  if (-not (Have "node")) { Fail "Node.js did not install (winget exit code $code)." }
}
Ok "Node.js $(node --version)"

# -- 3. pnpm -----------------------------------------------------------------
Step "Checking pnpm"
if (-not (Have "pnpm") -or ((pnpm --version) -ne $PnpmVersion)) {
  Info "Installing pnpm $PnpmVersion..."
  Run "Installing pnpm" { npm install --global "pnpm@$PnpmVersion" }
  Refresh-Path
}
if (-not (Have "pnpm")) { Fail "pnpm did not install." }
Ok "pnpm $(pnpm --version)"

# -- 4. Packages ------------------------------------------------------------
# First, because the database helper (scripts/windows/db.mjs) uses the app's `pg` driver.
Step "Installing the website's packages"
# Before .env exists, `prisma generate` (run by the install) needs some DATABASE_URL; it does not
# connect. Removed straight after, so the real one in .env is used from then on.
$placeholderUrl = -not (Test-Path (Join-Path $Root ".env"))
if ($placeholderUrl) { $env:DATABASE_URL = "postgresql://placeholder@localhost:5432/placeholder" }
Run "pnpm install" { pnpm install --frozen-lockfile }
if ($placeholderUrl) { Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue }
Ok "Packages installed"

# -- 5. PostgreSQL -----------------------------------------------------------
# A PostgreSQL already installed as a Windows service is used as it is. Otherwise PostgreSQL 17 is
# downloaded from the npm registry (the EnterpriseDB download site refuses some connections) into
# this Windows user's app data, and this script starts it on every run.
Step "Checking PostgreSQL"

function Find-ServicePsql {
  $found = Get-ChildItem "C:\Program Files\PostgreSQL\*\bin\psql.exe" -ErrorAction SilentlyContinue |
    Sort-Object { [int]($_.Directory.Parent.Name -replace "\D", "") } -Descending |
    Select-Object -First 1
  if ($found) { return $found.FullName } else { return $null }
}

$useService = [bool](Find-ServicePsql) -and -not (Test-Path $PgData)
if ($useService) {
  Get-Service -Name "postgresql*" -ErrorAction SilentlyContinue | Where-Object { $_.Status -ne "Running" } | Start-Service
  Ok "Using the PostgreSQL already installed on this laptop"
  $superPassword = $null # asked for below, only if the database still has to be created
} else {
  if ($Fresh -and (Test-Path $PgData)) {
    Info "Deleting the old database..."
    $pgCtl = Join-Path $PgBin "pg_ctl.exe"
    if ((Test-Port $PgPort) -and (Test-Path $pgCtl)) {
      Capture { & $pgCtl stop -D $PgData -m fast } | Out-Null
      for ($i = 0; $i -lt 30 -and (Test-Port $PgPort); $i++) { Start-Sleep -Seconds 1 }
    }
    try {
      Remove-Item $PgData -Recurse -Force
    } catch {
      Fail "Could not delete $PgData (the database may still be running). Restart the laptop and run this again."
    }
    Remove-Item $SuperFile -Force -ErrorAction SilentlyContinue
    Ok "Old database deleted"
  }

  # Microsoft Visual C++ runtime, needed by PostgreSQL's programs.
  $sys = Join-Path $env:WINDIR "System32"
  if (-not ((Test-Path "$sys\vcruntime140.dll") -and (Test-Path "$sys\vcruntime140_1.dll") -and (Test-Path "$sys\msvcp140.dll"))) {
    Info "Installing the Microsoft Visual C++ runtime..."
    $code = Winget-Install "Microsoft.VCRedist.2015+.x64" @("--silent")
    if (-not (Test-Path "$sys\vcruntime140_1.dll")) {
      Fail "The Microsoft Visual C++ runtime did not install (winget exit code $code). Install it from https://aka.ms/vs/17/release/vc_redist.x64.exe and run this again."
    }
  }

  if (-not (Test-Path (Join-Path $PgBin "pg_ctl.exe"))) {
    Info "Downloading PostgreSQL 17 (about 40 MB)..."
    $tmp = Join-Path $env:TEMP "salesapp-postgres"
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Force -Path $tmp | Out-Null
    Run "Downloading PostgreSQL" { npm pack "@embedded-postgres/windows-x64@$PgVersion" --pack-destination $tmp }
    $tgz = Get-ChildItem $tmp -Filter *.tgz | Select-Object -First 1
    if (-not $tgz) { Fail "The PostgreSQL download did not arrive." }
    Run "Unpacking PostgreSQL" { & (Join-Path $env:WINDIR "System32\tar.exe") -xzf $tgz.FullName -C $tmp }
    New-Item -ItemType Directory -Force -Path (Split-Path $PgRoot) | Out-Null
    Remove-Item $PgRoot -Recurse -Force -ErrorAction SilentlyContinue
    Move-Item (Join-Path $tmp "package\native") $PgRoot
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
    if (-not (Test-Path (Join-Path $PgBin "pg_ctl.exe"))) { Fail "PostgreSQL did not unpack." }
  }

  if (-not (Test-Path (Join-Path $PgData "PG_VERSION"))) {
    Info "Creating the database storage..."
    $superPassword = Random-Hex 12
    Set-Content -Path $SuperFile -Value $superPassword -NoNewline
    $pwFile = Join-Path $env:TEMP "salesapp-pw.txt"
    Set-Content -Path $pwFile -Value $superPassword -NoNewline -Encoding ASCII
    $result = Capture { & (Join-Path $PgBin "initdb.exe") -D $PgData -U postgres "--pwfile=$pwFile" -A scram-sha-256 -E UTF8 --no-locale }
    Remove-Item $pwFile -ErrorAction SilentlyContinue
    if ($result.Code -ne 0) { Fail "Creating the database storage failed: $($result.Out)" }
  }
  if (-not (Test-Path $SuperFile)) {
    Fail "The database administrator password file $SuperFile is missing. Restore it from a backup."
  }
  $superPassword = (Get-Content $SuperFile -Raw).Trim()

  $pgCtl = Join-Path $PgBin "pg_ctl.exe"
  $pgLog = Join-Path $PgData "server.log"
  if (-not (Test-Port $PgPort)) {
    Info "Starting PostgreSQL..."
    # Started in the background on purpose: the server keeps running and holds on to whatever
    # output it was given, so waiting for pg_ctl's output here would never finish.
    $pgArgs = @("start", "-D", "`"$PgData`"", "-l", "`"$pgLog`"", "-o", "`"-p $PgPort -c listen_addresses=localhost`"")
    Start-Process -FilePath $pgCtl -ArgumentList $pgArgs -WindowStyle Hidden
    $ready = $false
    for ($i = 0; $i -lt 60; $i++) {
      Start-Sleep -Seconds 1
      if (Test-Port $PgPort) { $ready = $true; break }
    }
    if (-not $ready) {
      $tail = if (Test-Path $pgLog) { (Get-Content $pgLog -Tail 15) -join "`n" } else { "(no log)" }
      Fail "PostgreSQL did not start within a minute. Last lines of $pgLog`n$tail"
    }
  }
  Ok "PostgreSQL is running (data in $PgData)"
}

# -- 6. Database and .env ----------------------------------------------------
Step "Preparing the database"
if ($Fresh) {
  Remove-Item $EnvFile -Force -ErrorAction SilentlyContinue
  Remove-Item (Join-Path $SetupDir "first-login.txt") -Force -ErrorAction SilentlyContinue
}
if (-not (Test-Path $EnvFile)) {
  if (-not $superPassword) {
    Write-Host "    Type the password of the existing PostgreSQL's 'postgres' user (set when it was installed)." -ForegroundColor Yellow
    $secure = Read-Host "    postgres password" -AsSecureString
    $superPassword = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
  }
  $appPassword = Random-Hex 16
  $env:SALES_PG_SUPER_URL = "postgresql://postgres:$([uri]::EscapeDataString($superPassword))@localhost:$PgPort/postgres"
  $env:SALES_APP_DB_PASSWORD = $appPassword
  if ($Fresh -and $useService) {
    # Existing PostgreSQL service: delete only this app's database and user.
    $result = Capture { node $DbHelper reset }
    if ($result.Code -ne 0) { Fail "Deleting the old database failed: $($result.Out)" }
    Ok "Old database deleted"
  }
  $result = Capture { node $DbHelper ensure }
  $env:SALES_PG_SUPER_URL = $null
  $env:SALES_APP_DB_PASSWORD = $null
  if ($result.Code -ne 0) { Fail "Creating the database failed: $($result.Out)" }
  $authSecret = Random-Hex 32
  @(
    "# Written by scripts/windows/setup.ps1. Keep this file private and keep it when you update."
    "DATABASE_URL=`"postgresql://sales_app:$appPassword@localhost:$PgPort/sales_app?schema=public`""
    "AUTH_SECRET=`"$authSecret`""
  ) | Set-Content -Path $EnvFile -Encoding ASCII
  Ok "Database 'sales_app' and .env created"
} else {
  Ok ".env already exists, keeping it"
}

Step "Creating or updating the database tables"
Run "Database update" { pnpm db:deploy }
Ok "Database is up to date"

# -- 7. First business -------------------------------------------------------
$env:SALES_APP_DB_URL = (Get-Content $EnvFile | Where-Object { $_ -like "DATABASE_URL=*" }) -replace '^DATABASE_URL="?([^"]*)"?$', '$1'
$result = Capture { node $DbHelper tenants }
$env:SALES_APP_DB_URL = $null
if ($result.Code -ne 0) { Fail "Reading the database failed: $($result.Out)" }
if ($result.Out -eq "0") {
  Step "First start: what should the website contain?"
  Write-Host "    1 = Demo data to try things out (sample companies, products, customers)"
  Write-Host "    2 = My real business (empty; you enter your own data)"
  $choice = ""
  while ($choice -ne "1" -and $choice -ne "2") { $choice = Read-Host "    Type 1 or 2" }
  if ($choice -eq "1") {
    Run "Loading demo data" { pnpm db:seed }
    $login = "Demo logins (password Demo@12345): owner@demo.test, accountant@demo.test, staff@demo.test"
  } else {
    $business = ""; while ($business.Length -lt 2) { $business = Read-Host "    Business name" }
    $owner = ""; while ($owner.Length -lt 2) { $owner = Read-Host "    Owner's full name" }
    $email = ""; while ($email -notmatch "^[^@\s]+@[^@\s]+\.[^@\s]+$") { $email = Read-Host "    Owner's email (used to sign in)" }
    $result = Capture { pnpm tenant:create $business $owner $email }
    if ($result.Code -ne 0) { Fail "Creating the business failed: $($result.Out)" }
    Write-Host $result.Out
    $login = (($result.Out -split "`r?`n") | Where-Object { $_ -match "^(Owner login|One-time password):" }) -join " / "
  }
  Set-Content -Path (Join-Path $SetupDir "first-login.txt") -Value $login
  Write-Host ""
  Write-Host "    $login" -ForegroundColor Yellow
  Write-Host "    (Also saved in $SetupDir\first-login.txt. Write it down, then delete that file.)" -ForegroundColor Yellow
  Read-Host "    Press Enter to continue"
}

# -- 8. Build (only when the code changed) -----------------------------------
Step "Building the website"
$buildId = Join-Path $Root ".next\BUILD_ID"
$needBuild = -not (Test-Path $buildId)
if (-not $needBuild) {
  $built = (Get-Item $buildId).LastWriteTime
  $newest = Get-ChildItem -Path (Join-Path $Root "src"), (Join-Path $Root "prisma"), (Join-Path $Root "package.json"), (Join-Path $Root "pnpm-lock.yaml") -Recurse -File |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if ($newest.LastWriteTime -gt $built) { $needBuild = $true }
}
if ($needBuild) {
  Info "Building (a minute or two)..."
  Run "Build" { pnpm build }
  Ok "Built"
} else {
  Ok "Already built and up to date"
}

# -- 9. Other computers in the office ----------------------------------------
$rule = "Sales App (port $Port)"
if (-not (Get-NetFirewallRule -DisplayName $rule -ErrorAction SilentlyContinue)) {
  New-NetFirewallRule -DisplayName $rule -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow -Profile Private | Out-Null
}
$lan = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" } |
  Select-Object -ExpandProperty IPAddress -First 1

# -- 10. Start ---------------------------------------------------------------
Step "Starting the website"
Write-Host ""
Write-Host "    On this laptop:        http://localhost:$Port" -ForegroundColor Green
if ($lan) { Write-Host "    Other office computers: http://${lan}:$Port (same Wi-Fi or network)" -ForegroundColor Green }
Write-Host "    Keep this window open while you use the website. Close it to stop the website." -ForegroundColor Yellow
Write-Host ""
Stop-Transcript | Out-Null

# Open the browser once the website answers.
Start-Job -ArgumentList $Port -ScriptBlock {
  param($port)
  for ($i = 0; $i -lt 120; $i++) {
    try {
      Invoke-WebRequest -Uri "http://localhost:$port/login" -UseBasicParsing -TimeoutSec 2 | Out-Null
      Start-Process "http://localhost:$port"
      return
    } catch { Start-Sleep -Seconds 1 }
  }
} | Out-Null

pnpm start --port $Port
