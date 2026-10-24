# Taqseem: remove everything the setup created on this laptop, after testing or development.
#
# Run it by double-clicking uninstall-windows.bat in the project folder. After typing DELETE it:
#   1. stops the website and removes "start at Windows sign-in";
#   2. deletes the database: the app's own PostgreSQL (stopped, then its whole folder
#      %LOCALAPPDATA%\SalesApp: data, program, password file, backups), or, when an existing
#      PostgreSQL service was used, only the sales_app database and user;
#   3. removes the firewall rule for other office computers;
#   4. deletes the files the setup made in the project folder: .env, .setup, node_modules, .next
#      and the generated database client. The code itself stays.
# It can also uninstall Node.js, pnpm and Git, if you say so (they may be used by other programs).
#
# Written for Windows PowerShell 5.1 (built into Windows 10 and 11). ASCII only.

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

. (Join-Path $PSScriptRoot "common.ps1")
Set-Location $Root

# The log goes to TEMP: the .setup folder is deleted below.
$Log = Join-Path $env:TEMP "taqseem-uninstall-log.txt"
Start-Transcript -Path $Log -Append | Out-Null

$TaskName = "Taqseem website"
$Problems = @()
function Problem($text) {
  Write-Host "    $text" -ForegroundColor Red
  $script:Problems += $text
}

# Deletes a folder or file; reports instead of stopping when something holds it open.
function Remove-Path($path, $label) {
  if (-not (Test-Path $path)) { return }
  try {
    Remove-Item $path -Recurse -Force
    Ok "Deleted $label"
  } catch {
    Problem "Could not delete $label ($path): $($_.Exception.Message)"
  }
}

Write-Host "Taqseem: remove from this laptop" -ForegroundColor White
Write-Host "Project folder: $Root"
Write-Host ""
Write-Host "This deletes for good:" -ForegroundColor Red
Write-Host "    - the database: every order, bill, payment, customer, product and stock record" -ForegroundColor Red
Write-Host "    - the database backups in $BackupDir" -ForegroundColor Red
Write-Host "    - the settings (.env with the passwords), logs, packages and the built website" -ForegroundColor Red
Write-Host "The code in this folder stays. Nothing is uploaded or changed on GitHub."
Write-Host ""
$confirm = Read-Host "    Type DELETE (in capitals) to remove everything, or press Enter to cancel"
if ($confirm -cne "DELETE") {
  Write-Host "    Cancelled. Nothing was changed." -ForegroundColor Green
  Stop-Transcript | Out-Null
  exit 0
}
$removeTools = (Read-Host "    Also uninstall Node.js, pnpm and Git? Only if nothing else on this laptop uses them. Type YES, or press Enter to keep them") -ceq "YES"

# -- 1. Website ----------------------------------------------------------------
Step "Stopping the website"
try {
  & (Join-Path $PSScriptRoot "deploy.ps1") stop -Quiet
} catch {
  Problem "Stopping the website: $($_.Exception.Message)"
}
# A website left without its saved process number: anything node on the port.
$conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($conn) {
  $proc = Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
  if ($proc -and $proc.ProcessName -eq "node") { Capture { taskkill /PID $proc.Id /T /F } | Out-Null }
}
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Ok "Removed: start at Windows sign-in"
}
Ok "Website stopped"

# -- 2. Database ---------------------------------------------------------------
Step "Deleting the database"
if (Uses-OwnPostgres) {
  $pgCtl = Join-Path $PgBin "pg_ctl.exe"
  if ((Test-Port $PgPort) -and (Test-Path $pgCtl)) {
    Capture { & $pgCtl stop -D $PgData -m fast } | Out-Null
    for ($i = 0; $i -lt 30 -and (Test-Port $PgPort); $i++) { Start-Sleep -Seconds 1 }
  }
  # Any of its programs still running hold files open.
  Get-Process -Name "postgres", "pg_ctl" -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -and $_.Path.StartsWith($PgRoot, [StringComparison]::OrdinalIgnoreCase) } |
    Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 1
  Remove-Path $AppData "the database, PostgreSQL and backups ($AppData)"
} elseif (Test-Path $EnvFile) {
  # A PostgreSQL service that was already on the laptop: delete only this app's database and user.
  Info "This installation used the PostgreSQL already installed on the laptop."
  Info "Only the 'sales_app' database and user are deleted; PostgreSQL itself stays."
  Get-Service -Name "postgresql*" -ErrorAction SilentlyContinue | Where-Object { $_.Status -ne "Running" } | Start-Service
  $secure = Read-Host "    Password of its 'postgres' user (Enter to skip)" -AsSecureString
  $password = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
  if ($password -and (Have "node") -and (Test-Path (Join-Path $Root "node_modules\pg"))) {
    $env:SALES_PG_SUPER_URL = "postgresql://postgres:$([uri]::EscapeDataString($password))@localhost:$PgPort/postgres"
    $result = Capture { node $DbHelper reset }
    $env:SALES_PG_SUPER_URL = $null
    if ($result.Code -eq 0) { Ok "Deleted the sales_app database and user" }
    else { Problem "Deleting the database failed: $($result.Out)" }
  } else {
    Problem "The sales_app database was not deleted (no password, or the packages are missing). Delete it in pgAdmin: database sales_app, then login role sales_app."
  }
  Remove-Path $AppData "app data ($AppData)"
} else {
  Ok "No database found"
  Remove-Path $AppData "app data ($AppData)"
}

# -- 3. Firewall ---------------------------------------------------------------
Step "Removing the firewall rule"
foreach ($name in @("Taqseem (port $Port)", "Sales App (port $Port)")) {
  if (Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue) {
    Remove-NetFirewallRule -DisplayName $name
    Ok "Removed $name"
  }
}

# -- 4. Files in the project folder --------------------------------------------
Step "Deleting the setup's files in the project folder"
Remove-Path $EnvFile ".env (passwords)"
Remove-Path (Join-Path $Root ".next") "the built website (.next)"
Remove-Path (Join-Path $Root "src\generated") "the generated database client (src\generated)"
Remove-Path (Join-Path $Root "node_modules") "the packages (node_modules)"
Remove-Path $SetupDir "logs and settings (.setup)"

# -- 5. Programs (only when asked) ---------------------------------------------
if ($removeTools) {
  Step "Uninstalling Node.js, pnpm and Git"
  if (Have "pnpm") {
    Capture { npm uninstall --global pnpm } | Out-Null
    Ok "pnpm removed"
  }
  foreach ($id in @("OpenJS.NodeJS.LTS", "Git.Git")) {
    $result = Capture { winget uninstall --exact --id $id --silent --disable-interactivity }
    if ($result.Code -eq 0) { Ok "$id removed" } else { Info "$id was not removed by winget (maybe not installed by it)." }
  }
}

# -- Done ----------------------------------------------------------------------
Write-Host ""
if ($Problems.Count -eq 0) {
  Write-Host "Done. Taqseem is removed from this laptop." -ForegroundColor Green
} else {
  Write-Host "Done, but these need a look:" -ForegroundColor Yellow
  $Problems | ForEach-Object { Write-Host "  - $_" -ForegroundColor Yellow }
  Write-Host "A restart usually frees files that could not be deleted; then run this again." -ForegroundColor Yellow
}
Write-Host "The code folder ($Root) is still here. Delete it yourself if you no longer need it,"
Write-Host "or run setup-windows.bat to install again from scratch."
Write-Host "Log of this run: $Log"
Stop-Transcript | Out-Null
