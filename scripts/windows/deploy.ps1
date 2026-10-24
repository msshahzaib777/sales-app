# Taqseem: run the website in the background, stop it, or update it. Use taqseem.bat in the
# project folder (double-click for a menu), or run it with one word:
#
#   taqseem.bat start     start the website in the background (restarts it if it is running);
#                         first applies database updates and builds the website if the code changed
#   taqseem.bat stop      stop the website (the database keeps running)
#   taqseem.bat update    get the latest code from GitHub, then the same as start
#   taqseem.bat status    is it running, where, and which version
#   taqseem.bat autostart start the website by itself when you sign in to Windows (on/off)
#
# Before database changes are applied, the database is backed up to
# .backups in the project folder (the last 10 are kept).
#
# The first installation is done by setup-windows.bat. Written for Windows PowerShell 5.1. ASCII only.

param(
  [string]$Action = "",
  # No questions and no browser: for setup.ps1 and for the start at Windows sign-in.
  [switch]$Quiet
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

. (Join-Path $PSScriptRoot "common.ps1")
Set-Location $Root

$RepoUrlFile = Join-Path $SetupDir "repo-url.txt"
$DefaultRepoUrl = "https://github.com/msshahzaib777/sales-app.git"
$Branch = "main"
$PidFile = Join-Path $SetupDir "website.pid"
$WebLog = Join-Path $SetupDir "website-log.txt"
$TaskName = "Taqseem website"

class DeployError : System.Exception {
  DeployError([string]$message) : base($message) {}
}
function Fail($text) { throw [DeployError]::new($text) }

function Run($what, [scriptblock]$command) {
  & $command
  if ($LASTEXITCODE -ne 0) { Fail "$what failed (exit code $LASTEXITCODE). See the messages above." }
}

# -- The website process ------------------------------------------------------

# The process listening on the website's port, or $null.
function Website-Process {
  $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $conn) { return $null }
  return Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
}

function Stop-Website {
  $stopped = $false
  # The hidden window started by Start-Website (and the node process under it).
  if (Test-Path $PidFile) {
    $savedPid = (Get-Content $PidFile -Raw).Trim()
    if ($savedPid -match "^\d+$" -and (Get-Process -Id $savedPid -ErrorAction SilentlyContinue)) {
      Capture { taskkill /PID $savedPid /T /F } | Out-Null
      $stopped = $true
    }
    Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
  }
  # Also a website started some other way (e.g. by hand), if it is node.
  $proc = Website-Process
  if ($proc) {
    if ($proc.ProcessName -ne "node") {
      Fail "Port $Port is used by another program ($($proc.ProcessName), process $($proc.Id)), not the website. Close it, then try again."
    }
    Capture { taskkill /PID $proc.Id /T /F } | Out-Null
    $stopped = $true
  }
  for ($i = 0; $i -lt 20 -and (Test-Port $Port); $i++) { Start-Sleep -Seconds 1 }
  if (Test-Port $Port) { Fail "The website did not stop. Restart the laptop." }
  return $stopped
}

function Website-Answers {
  try {
    Invoke-WebRequest -Uri "http://localhost:$Port/login" -UseBasicParsing -TimeoutSec 5 | Out-Null
    return $true
  } catch {
    return $false
  }
}

function Start-Website {
  # Keep the log from growing for ever: start a new one past 5 MB.
  if ((Test-Path $WebLog) -and (Get-Item $WebLog).Length -gt 5MB) {
    Move-Item $WebLog "$WebLog.old" -Force
  }
  Add-Content -Path $WebLog -Value "`r`n==== Started $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ===="
  $node = (Get-Command node).Source
  $next = Join-Path $Root "node_modules\next\dist\bin\next"
  # A hidden window that keeps running after this one closes; its output goes to the log.
  $command = "`"`"$node`" `"$next`" start --port $Port >> `"$WebLog`" 2>&1`""
  $proc = Start-Process -FilePath "cmd.exe" -ArgumentList "/c", $command -WorkingDirectory $Root -WindowStyle Hidden -PassThru
  Set-Content -Path $PidFile -Value $proc.Id
  for ($i = 0; $i -lt 90; $i++) {
    Start-Sleep -Seconds 1
    if (Website-Answers) { return }
    if ($proc.HasExited) { break }
  }
  $tail = if (Test-Path $WebLog) { (Get-Content $WebLog -Tail 20) -join "`n" } else { "(no log)" }
  Fail "The website did not start. Last lines of $WebLog`n$tail"
}

function Show-Addresses {
  Write-Host ""
  Write-Host "    On this laptop:         http://localhost:$Port" -ForegroundColor Green
  $lan = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" } |
    Select-Object -ExpandProperty IPAddress -First 1
  if ($lan) { Write-Host "    Other office computers: http://${lan}:$Port" -ForegroundColor Green }
  Write-Host "    It runs in the background: you can close this window." -ForegroundColor Green
  Write-Host "    To stop it, run taqseem.bat and choose Stop." -ForegroundColor Green
}

# -- Preparing the code -------------------------------------------------------

function Ensure-Ready {
  if (-not (Test-Path $EnvFile)) {
    Fail "Taqseem is not installed on this laptop yet. Run setup-windows.bat first."
  }
  Refresh-Path
  if (-not (Have "node") -or -not (Have "pnpm")) {
    Fail "Node.js or pnpm is missing. Run setup-windows.bat to install them."
  }
  Step "Starting the database"
  $problem = Start-Database
  if ($problem) { Fail $problem }
  Ok "Database is running"
}

# Installs packages when the package list changed since the last install.
function Install-Packages {
  $installed = Join-Path $Root "node_modules\.modules.yaml"
  $lock = Join-Path $Root "pnpm-lock.yaml"
  if ((Test-Path $installed) -and (Get-Item $lock).LastWriteTime -le (Get-Item $installed).LastWriteTime) {
    return
  }
  Step "Installing the website's packages"
  Run "pnpm install" { pnpm install --frozen-lockfile }
  Ok "Packages installed"
}

# Backs up the database (before changing its tables). Returns the file, or fails.
function Backup-Database {
  $pgDump = if (Uses-OwnPostgres) {
    Join-Path $PgBin "pg_dump.exe"
  } else {
    $psql = Find-ServicePsql
    if ($psql) { Join-Path (Split-Path $psql) "pg_dump.exe" } else { $null }
  }
  if (-not $pgDump -or -not (Test-Path $pgDump)) {
    Fail "pg_dump.exe was not found, so the database can't be backed up before the update."
  }
  New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
  # Backups from before they moved to the project folder.
  if (Test-Path $OldBackupDir) {
    Get-ChildItem $OldBackupDir -Filter "taqseem-*.sql" | Move-Item -Destination $BackupDir -Force
    Remove-Item $OldBackupDir -Force -ErrorAction SilentlyContinue
  }
  $file = Join-Path $BackupDir ("taqseem-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".sql")
  # pg_dump does not know Prisma's "?schema=public".
  $url = (Read-DatabaseUrl) -replace "\?.*$", ""
  $result = Capture { & $pgDump --dbname=$url --file=$file --no-owner }
  if ($result.Code -ne 0) { Fail "The database backup failed: $($result.Out)" }
  # Keep the last 10.
  Get-ChildItem $BackupDir -Filter "taqseem-*.sql" | Sort-Object Name -Descending |
    Select-Object -Skip 10 | Remove-Item -Force
  return $file
}

# Applies database changes that came with the code, after a backup.
function Update-Database {
  Step "Checking for database changes"
  $status = Capture { pnpm exec prisma migrate status }
  if ($status.Code -eq 0) {
    Ok "Database is up to date"
    return
  }
  if ($status.Out -notmatch "not yet been applied|have not been applied") {
    Fail "Could not check the database: $($status.Out)"
  }
  Info "There are database changes to apply. Backing up the database first..."
  $file = Backup-Database
  Ok "Backup saved: $file"
  Run "Database update" { pnpm db:deploy }
  Ok "Database updated"
}

function Build-IfNeeded {
  if (-not (Needs-Build)) { return }
  Step "Building the website (a minute or two)"
  Run "Build" { pnpm build }
  Ok "Built"
}

# -- Getting the latest code --------------------------------------------------

function Ensure-Git {
  Refresh-Path
  if (Have "git") { return }
  Step "Installing Git (to download updates)"
  $code = Winget-Install "Git.Git" @("--silent")
  Refresh-Path
  $gitCmd = "C:\Program Files\Git\cmd"
  if (-not (Have "git") -and (Test-Path $gitCmd)) { $env:Path = "$env:Path;$gitCmd" }
  if (-not (Have "git")) { Fail "Git did not install (winget exit code $code)." }
  Ok "Git installed"
}

function Repo-Url {
  if (Test-Path $RepoUrlFile) {
    $url = (Get-Content $RepoUrlFile -Raw).Trim()
    if ($url) { return $url }
  }
  return $DefaultRepoUrl
}

# Brings the code to the latest on GitHub. Returns $true when it changed.
function Get-LatestCode {
  Ensure-Git
  Step "Getting the latest code from GitHub"
  $url = Repo-Url
  if (-not (Test-Path (Join-Path $Root ".git"))) {
    # Downloaded as a ZIP: link the folder to GitHub. Files Git ignores (.env, packages, the build)
    # stay as they are.
    Info "Linking this folder to $url ..."
    Run "git init" { git init --quiet }
    Run "git remote" { git remote add origin $url }
    $old = ""
  } else {
    Run "git remote" { git remote set-url origin $url }
    $old = (Capture { git rev-parse HEAD }).Out
    $changed = (Capture { git status --porcelain --untracked-files=no }).Out
    if ($changed) {
      Warn "These files were changed on this laptop; the update replaces them:"
      $changed -split "`r?`n" | ForEach-Object { Warn "  $_" }
      if ($Quiet) { Fail "Local changes would be lost. Run taqseem.bat update by hand." }
      $answer = Read-Host "    Type YES to replace them, or press Enter to cancel"
      if ($answer -cne "YES") { Fail "Update cancelled. Nothing was changed." }
    }
  }
  Info "Downloading (a sign-in window may open the first time)..."
  Run "git fetch" { git fetch --quiet origin $Branch }
  Run "git checkout" { git checkout --quiet --force -B $Branch "origin/$Branch" }
  $new = (Capture { git rev-parse HEAD }).Out
  $when = (Capture { git log -1 "--format=%cd" --date=short }).Out
  if ($old -eq $new) {
    Ok "Already the latest code ($($new.Substring(0, 7)), $when)"
    return $false
  }
  Ok "Updated to $($new.Substring(0, 7)) ($when)"
  return $true
}

# -- Actions ------------------------------------------------------------------

function Do-Start([bool]$update) {
  Ensure-Ready
  if ($update) { Get-LatestCode | Out-Null }
  # Stopped before building: the build replaces the files the running website uses.
  $needsWork = (Needs-Build) -or $update
  $wasRunning = [bool](Website-Process)
  if ($wasRunning -and $needsWork) {
    Step "Stopping the website for the update"
    Stop-Website | Out-Null
  }
  Install-Packages
  Update-Database
  Build-IfNeeded
  if ($wasRunning -and -not $needsWork) {
    Step "Restarting the website"
    Stop-Website | Out-Null
  } else {
    Step "Starting the website"
  }
  Start-Website
  Ok "The website is running"
  Show-Addresses
  if (-not $Quiet) { Start-Process "http://localhost:$Port" }
}

function Do-Stop {
  Step "Stopping the website"
  if (Stop-Website) { Ok "Stopped" } elseif (-not $Quiet) { Ok "It was not running" }
}

function Do-Status {
  Step "Status"
  $proc = Website-Process
  if ($proc -and (Website-Answers)) {
    Ok "Running (process $($proc.Id), since $($proc.StartTime.ToString('dd MMM yyyy HH:mm')))"
    Show-Addresses
  } elseif ($proc) {
    Warn "Starting, or not answering (process $($proc.Id)). Log: $WebLog"
  } else {
    Warn "Not running. Choose Start."
  }
  if ((Have "git") -and (Test-Path (Join-Path $Root ".git"))) {
    $version = (Capture { git log -1 "--format=%h, %cd" --date=short }).Out
    Info "Code version: $version"
  }
  $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Info ("Starts by itself at Windows sign-in: " + $(if ($task) { "yes" } else { "no" }))
  Info "Website log: $WebLog"
  Info "Database backups: $BackupDir"
}

function Do-Autostart {
  $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if ($task) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Ok "The website no longer starts by itself. Use taqseem.bat to start it."
    return
  }
  $script = Join-Path $PSScriptRoot "deploy.ps1"
  $taskAction = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`" start -Quiet" `
    -WorkingDirectory $Root
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 1)
  Register-ScheduledTask -TaskName $TaskName -Action $taskAction -Trigger $trigger -Settings $settings `
    -Description "Starts the Taqseem website in the background (taqseem.bat)." | Out-Null
  Ok "The website will start by itself when $env:USERNAME signs in to Windows."
}

function Run-Action([string]$name) {
  switch ($name.ToLower()) {
    "start" { Do-Start $false }
    "update" { Do-Start $true }
    "stop" { Do-Stop }
    "status" { Do-Status }
    "autostart" { Do-Autostart }
    default { Fail "Unknown action '$name'. Use start, stop, update, status or autostart." }
  }
}

# -- Main -----------------------------------------------------------------------

Start-Transcript -Path (Join-Path $SetupDir "deploy-log.txt") -Append | Out-Null
$exitCode = 0
try {
  if ($Action) {
    Run-Action $Action
  } else {
    while ($true) {
      Write-Host ""
      Write-Host "Taqseem" -ForegroundColor White
      Write-Host "    1 = Start (or restart) the website in the background"
      Write-Host "    2 = Update to the latest code from GitHub, then restart"
      Write-Host "    3 = Stop the website"
      Write-Host "    4 = Status"
      Write-Host "    5 = Start by itself when I sign in to Windows (on/off)"
      Write-Host "    0 = Close this window"
      $choice = Read-Host "    Type a number"
      $name = @{ "1" = "start"; "2" = "update"; "3" = "stop"; "4" = "status"; "5" = "autostart" }[$choice]
      if ($choice -eq "0" -or $choice -eq "") { break }
      if (-not $name) { continue }
      try {
        Run-Action $name
      } catch [DeployError] {
        Write-Host ""
        Write-Host "STOPPED: $($_.Exception.Message)" -ForegroundColor Red
      }
    }
  }
} catch [DeployError] {
  Write-Host ""
  Write-Host "STOPPED: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "A log of this run is in $SetupDir\deploy-log.txt" -ForegroundColor Yellow
  $exitCode = 1
} finally {
  Stop-Transcript | Out-Null
}
exit $exitCode
