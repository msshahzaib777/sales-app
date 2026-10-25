# Builds the Windows installer: dist\TaqseemSetup-<version>.exe (run: pnpm package:windows).
#
# What goes in (no source code):
#   app\         the self-contained website (Next.js standalone build: compiled files only)
#   node\        node.exe, so nothing has to be installed
#   pgsql\       PostgreSQL 17 (from the npm registry, like setup-windows.bat)
#   tools\       migrate / seed / create-tenant / db helpers, each bundled into one .mjs file
#   migrations\  the database changes (SQL)
#   service\     WinSW, which runs the website as a Windows service
#   setup\       install.ps1 and remove.ps1, run by the installer
# Needs Inno Setup 6 (installed with winget if missing) and an internet connection the first time.
# Written for Windows PowerShell 5.1. ASCII only.

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
Set-Location $Root
$Out = Join-Path $Root "dist"
$Stage = Join-Path $Out "package"
$Cache = Join-Path $Out "cache"
$PgVersion = "17.10.0-beta.17"
$WinSwUrl = "https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW-x64.exe"
$Version = (Get-Content package.json -Raw | ConvertFrom-Json).version

function Step($text) { Write-Host ""; Write-Host "==> $text" -ForegroundColor Cyan }
function Run($what, [scriptblock]$command) {
  & $command
  if ($LASTEXITCODE -ne 0) { throw "$what failed (exit code $LASTEXITCODE)." }
}

Step "Cleaning dist\package"
if (Test-Path $Stage) { Remove-Item $Stage -Recurse -Force }
New-Item -ItemType Directory -Force -Path $Stage, $Cache | Out-Null

Step "Building the website (standalone)"
$env:TAQSEEM_STANDALONE = "1"
# The build only needs some database address; it does not connect.
if (-not $env:DATABASE_URL) { $env:DATABASE_URL = "postgresql://build@localhost:5432/build" }
# The generated database client is not in Git; make it here so packaging works on a computer
# without a developer setup (no .env, no database).
Run "Generating the database client" { pnpm exec prisma generate }
try { Run "Build" { pnpm build } } finally { Remove-Item Env:TAQSEEM_STANDALONE }
$build = Join-Path $Root ".next-package"
$standalone = Join-Path $build "standalone"
if (-not (Test-Path (Join-Path $standalone "server.js"))) { throw "The standalone build is missing (.next-package\standalone\server.js)." }
# The app without its node_modules (exit codes below 8 mean success), then node_modules made flat:
# pnpm links packages together, and an installer cannot carry links (see flatten-modules.mjs).
$aliasDir = Join-Path $standalone ".next-package\node_modules"
robocopy $standalone (Join-Path $Stage "app") /E /XD (Join-Path $standalone "node_modules") $aliasDir /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "Copying the standalone build failed." }
Run "Flattening node_modules" {
  node (Join-Path $PSScriptRoot "flatten-modules.mjs") (Join-Path $standalone "node_modules") (Join-Path $Stage "app\node_modules")
}
# Turbopack loads some packages through hashed aliases (.next-package\node_modules\pg-<hash>), which
# are links too: each becomes a copy of the flattened package it points to.
$aliases = Get-ChildItem $aliasDir -Force -ErrorAction SilentlyContinue | ForEach-Object {
  if ($_.Name.StartsWith("@")) { Get-ChildItem $_.FullName -Force | ForEach-Object { @{ Alias = "$($_.Parent.Name)\$($_.Name)"; Item = $_ } } }
  else { @{ Alias = $_.Name; Item = $_ } }
}
foreach ($a in $aliases) {
  if (-not $a.Item.LinkType) { throw "Unexpected folder in the build's module aliases: $($a.Alias)" }
  # The package name is the end of the link's target: ...\node_modules\pg or ...\node_modules\@prisma\client
  $target = [string]$a.Item.Target
  $name = if ($target -match '\\node_modules\\(@[^\\]+\\[^\\]+|[^\\@][^\\]*)$') { $Matches[1] } else { throw "Cannot read the alias $($a.Alias) -> $target" }
  $from = Join-Path $Stage "app\node_modules\$name"
  if (-not (Test-Path $from)) { throw "The alias $($a.Alias) needs $name, which is not in node_modules." }
  robocopy $from (Join-Path $Stage "app\.next-package\node_modules\$($a.Alias)") /E /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "Copying $name for $($a.Alias) failed." }
  Write-Host "    $($a.Alias) -> $name"
}robocopy (Join-Path $build "static") (Join-Path $Stage "app\.next-package\static") /E /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "Copying the static files failed." }
if (Test-Path (Join-Path $Root "public")) {
  robocopy (Join-Path $Root "public") (Join-Path $Stage "app\public") /E /NFL /NDL /NJH /NJS /NP | Out-Null
}
# The standalone copy may include a local .env from the build machine: never ship secrets.
Get-ChildItem (Join-Path $Stage "app") -Filter ".env*" -Force | Remove-Item -Force

Step "Bundling the tools"
$tools = Join-Path $Stage "tools"
New-Item -ItemType Directory -Force -Path $tools | Out-Null
$bundles = @(
  @{ In = "installer\tools\migrate.ts"; Out = "migrate.mjs" },
  @{ In = "prisma\seed.ts"; Out = "seed.mjs" },
  @{ In = "prisma\create-tenant.ts"; Out = "create-tenant.mjs" },
  @{ In = "scripts\windows\db.mjs"; Out = "db.mjs" }
)
foreach ($b in $bundles) {
  # react-server: "server-only" imports resolve to its empty module outside Next.js.
  Run "Bundling $($b.In)" {
    pnpm exec esbuild $b.In --bundle --platform=node --format=esm --target=node20 `
      --conditions=react-server,node --tsconfig=tsconfig.json --log-level=warning `
      "--banner:js=import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" `
      "--outfile=$(Join-Path $tools $b.Out)"
  }
}
robocopy (Join-Path $Root "prisma\migrations") (Join-Path $Stage "migrations") /E /NFL /NDL /NJH /NJS /NP | Out-Null
Remove-Item (Join-Path $Stage "migrations\migration_lock.toml") -Force -ErrorAction SilentlyContinue

Step "Adding Node.js"
New-Item -ItemType Directory -Force -Path (Join-Path $Stage "node") | Out-Null
Copy-Item (Get-Command node).Source (Join-Path $Stage "node\node.exe")
Write-Host "    Node $(node --version)"

Step "Adding PostgreSQL"
$pgCache = Join-Path $Cache "pgsql-$PgVersion"
if (-not (Test-Path (Join-Path $pgCache "bin\pg_ctl.exe"))) {
  $tmp = Join-Path $Cache "pg-download"
  if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $tmp | Out-Null
  Run "Downloading PostgreSQL" { npm pack "@embedded-postgres/windows-x64@$PgVersion" --pack-destination $tmp --silent }
  $tgz = Get-ChildItem $tmp -Filter *.tgz | Select-Object -First 1
  Run "Unpacking PostgreSQL" { & (Join-Path $env:WINDIR "System32\tar.exe") -xzf $tgz.FullName -C $tmp }
  if (Test-Path $pgCache) { Remove-Item $pgCache -Recurse -Force }
  Move-Item (Join-Path $tmp "package\native") $pgCache
  Remove-Item $tmp -Recurse -Force
}
robocopy $pgCache (Join-Path $Stage "pgsql") /E /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "Copying PostgreSQL failed." }

Step "Adding the service helper (WinSW)"
$winsw = Join-Path $Cache "WinSW-x64.exe"
if (-not (Test-Path $winsw)) { Invoke-WebRequest -Uri $WinSwUrl -OutFile $winsw -UseBasicParsing }
New-Item -ItemType Directory -Force -Path (Join-Path $Stage "service") | Out-Null
Copy-Item $winsw (Join-Path $Stage "service\WinSW.exe")

Step "Adding the setup scripts"
New-Item -ItemType Directory -Force -Path (Join-Path $Stage "setup") | Out-Null
Copy-Item (Join-Path $Root "installer\setup\*.ps1") (Join-Path $Stage "setup")

Step "Making the installer"
$iscc = @(
  "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
  "$env:ProgramFiles\Inno Setup 6\ISCC.exe",
  "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $iscc) {
  Write-Host "    Installing Inno Setup 6..."
  winget install --exact --id JRSoftware.InnoSetup --scope user --silent --accept-source-agreements --accept-package-agreements --disable-interactivity | Out-Host
  $iscc = "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe"
  if (-not (Test-Path $iscc)) { throw "Inno Setup did not install. Install it from https://jrsoftware.org/isdl.php and run this again." }
}
Run "Inno Setup" { & $iscc /Q "/DAppVersion=$Version" "/DDist=$Stage" "/DOutDir=$Out" (Join-Path $Root "installer\taqseem.iss") }
$setup = Join-Path $Out "TaqseemSetup-$Version.exe"
Write-Host ""
Write-Host "Done: $setup ($([math]::Round((Get-Item $setup).Length / 1MB)) MB)" -ForegroundColor Green
