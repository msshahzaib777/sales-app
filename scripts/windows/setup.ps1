# Sales App: one-step setup and start on a Windows laptop with nothing installed.
#
# Run it by double-clicking setup-windows.bat in the project folder. It is safe to run again: each
# step checks what is already done. The first run installs Node.js, pnpm and PostgreSQL, creates
# the database, asks whether to load demo data or set up your business, builds the website and
# starts it. Later runs just update and start it.
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

# -- 4. PostgreSQL -----------------------------------------------------------
Step "Checking PostgreSQL"
function Find-Psql {
  $found = Get-ChildItem "C:\Program Files\PostgreSQL\*\bin\psql.exe" -ErrorAction SilentlyContinue |
    Sort-Object { [int]($_.Directory.Parent.Name -replace "\D", "") } -Descending |
    Select-Object -First 1
  if ($found) { return $found.FullName } else { return $null }
}
$SuperFile = Join-Path $SetupDir "postgres-superuser-password.txt"
$psql = Find-Psql
if (-not $psql) {
  $superPassword = Random-Hex 12
  Set-Content -Path $SuperFile -Value $superPassword -NoNewline
  Info "Installing PostgreSQL (this takes a few minutes)..."
  $override = "--mode unattended --unattendedmodeui none --disable-components stackbuilder --superpassword $superPassword --serverport 5432"
  $code = 1
  foreach ($id in @("PostgreSQL.PostgreSQL.17", "PostgreSQL.PostgreSQL.16")) {
    $code = Winget-Install $id @("--override", $override)
    $psql = Find-Psql
    if ($psql) { break }
  }
  if (-not $psql) { Fail "PostgreSQL did not install (winget exit code $code)." }
}
Get-Service -Name "postgresql*" -ErrorAction SilentlyContinue | Where-Object { $_.Status -ne "Running" } | Start-Service
Ok "PostgreSQL at $psql"

if (Test-Path $SuperFile) {
  $superPassword = Get-Content $SuperFile -Raw
} else {
  Write-Host "    PostgreSQL was already on this laptop. Type the password of its 'postgres' user." -ForegroundColor Yellow
  $secure = Read-Host "    postgres password" -AsSecureString
  $superPassword = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
}

# Runs SQL from a temporary file (avoids Windows quoting problems) and returns the output.
function Sql($sql, $database = "postgres", $user = "postgres", $password = $superPassword) {
  $file = Join-Path $SetupDir "query.sql"
  Set-Content -Path $file -Value $sql -Encoding ASCII
  $env:PGPASSWORD = $password
  $result = Capture { & $psql -h localhost -p 5432 -U $user -d $database -v ON_ERROR_STOP=1 -t -A -q -f $file }
  Remove-Item $file -ErrorAction SilentlyContinue
  $env:PGPASSWORD = $null
  if ($result.Code -ne 0) { Fail "Database command failed: $($result.Out)" }
  return $result.Out
}

# -- 5. Database and .env ----------------------------------------------------
Step "Preparing the database"
$EnvFile = Join-Path $Root ".env"
if (-not (Test-Path $EnvFile)) {
  $appPassword = Random-Hex 16
  Sql @"
DO `$`$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'sales_app') THEN
    ALTER ROLE sales_app WITH LOGIN PASSWORD '$appPassword';
  ELSE
    CREATE ROLE sales_app WITH LOGIN PASSWORD '$appPassword';
  END IF;
END `$`$;
"@ | Out-Null
  $exists = Sql "SELECT 1 FROM pg_database WHERE datname = 'sales_app';"
  if ($exists -ne "1") { Sql "CREATE DATABASE sales_app OWNER sales_app;" | Out-Null }
  $authSecret = Random-Hex 32
  @(
    "# Written by scripts/windows/setup.ps1. Keep this file private and keep it when you update."
    "DATABASE_URL=`"postgresql://sales_app:$appPassword@localhost:5432/sales_app?schema=public`""
    "AUTH_SECRET=`"$authSecret`""
  ) | Set-Content -Path $EnvFile -Encoding ASCII
  Ok "Database 'sales_app' and .env created"
} else {
  Ok ".env already exists, keeping it"
}

# -- 6. Packages, tables -----------------------------------------------------
Step "Installing the website's packages"
Run "pnpm install" { pnpm install --frozen-lockfile }
Ok "Packages installed"

Step "Creating or updating the database tables"
Run "Database update" { pnpm db:deploy }
Ok "Database is up to date"

# -- 7. First business -------------------------------------------------------
$appUrl = (Get-Content $EnvFile | Where-Object { $_ -like "DATABASE_URL=*" }) -replace '^DATABASE_URL="?([^"]*)"?$', '$1'
$appPass = ([regex]::Match($appUrl, "sales_app:([^@]+)@")).Groups[1].Value
$tenants = Sql 'SELECT count(*) FROM "Tenant";' "sales_app" "sales_app" $appPass
if ($tenants -eq "0") {
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
