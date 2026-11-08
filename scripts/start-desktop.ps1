# Point the DSH desktop profile at this worktree (dev) or at a real copy (release),
# then start DeepSeek Harness.
#
# Why this exists: the desktop profile declares
#   "dsh-vaspflow": "file:D:/Projects/VASPFlow-0.2/plugins/dsh-vaspflow"
# but pnpm materialises that as a *copy* under node_modules. The client bundle is
# read on every page load, yet lib/index.js and lib/host/* are read once at
# startup — so a copied install silently serves an old data service while the UI
# looks current.
#
#   -Mode dev      node_modules/dsh-vaspflow becomes a junction to the worktree.
#                  Rebuild the client, refresh the page; restart for host changes.
#                  A watcher window keeps rebuilding lib/client.js on save.
#   -Mode release  node_modules/dsh-vaspflow becomes a real copy of the worktree
#                  (what a normal install looks like).

param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('dev', 'release')]
  [string]$Mode,
  [string]$DesktopHome = 'D:\Apps\DeepSeekHarness-0.2.2-rc.1\desktop-home',
  [string]$DesktopExe = 'D:\Apps\DeepSeekHarness-0.2.2-rc.1\Desktop\DeepSeek Harness.exe',
  [switch]$NoLaunch,
  [switch]$NoWatch,
  # Only for dry runs: with -NoLaunch on a scratch profile, skip the running-app guard.
  [switch]$Force
)

$ErrorActionPreference = 'Stop'

$source = (Resolve-Path (Join-Path $PSScriptRoot '..\plugins\dsh-vaspflow')).Path
$profileRoot = Join-Path $DesktopHome 'profiles\desktop'
$pluginPath = Join-Path $profileRoot 'node_modules\dsh-vaspflow'

if (-not (Test-Path $profileRoot)) { throw "Desktop profile not found: $profileRoot" }

$running = @(Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue)
if ($running.Count -gt 0 -and -not $Force) {
  throw 'DeepSeek Harness is running. Quit it completely (tray icon included), then run this script again.'
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw 'node was not found on PATH; it is needed to build lib/client.js.'
}

Write-Host ("[1/4] Building client bundle ...")
Push-Location $source
try { & node scripts/build-client.mjs } finally { Pop-Location }

function Remove-Link {
  param([string]$Path)
  # Delete the junction itself without recursing into its target.
  [System.IO.Directory]::Delete($Path)
}

function Set-DevLink {
  $item = Get-Item $pluginPath -Force -ErrorAction SilentlyContinue
  if ($item -and $item.LinkType -eq 'Junction') {
    if ((Resolve-Path $item.Target).Path -eq $source) { Write-Host '[2/4] Already linked to the worktree.'; return }
    Remove-Link $pluginPath
  } elseif ($item -and -not (Get-ChildItem $pluginPath -Force -ErrorAction SilentlyContinue)) {
    # A previous run left an empty directory behind; drop it.
    Remove-Item $pluginPath -Force
  } elseif ($item) {
    $backup = "$pluginPath.release-backup-$(Get-Date -Format yyyyMMddHHmmssfff)"
    Move-Item $pluginPath $backup
    Write-Host "[2/4] Previous install kept at $backup"
  }
  # mklink /J works on PowerShell 5.1 too; New-Item -ItemType Junction does not.
  $made = & cmd /c mklink /J "$pluginPath" "$source" 2>&1
  if ($LASTEXITCODE -ne 0) { throw "mklink failed: $made" }
  Write-Host '[2/4] node_modules/dsh-vaspflow -> worktree (junction).'
}

function Set-ReleaseCopy {
  $item = Get-Item $pluginPath -Force -ErrorAction SilentlyContinue
  if ($item -and $item.LinkType -eq 'Junction') {
    Remove-Link $pluginPath
    Write-Host '[2/4] Removed the dev junction.'
  }
  New-Item -ItemType Directory -Force $pluginPath | Out-Null
  # Same shape as a normal install: package files only, dependencies come from
  # the profile's own node_modules.
  $null = robocopy $source $pluginPath /E /XD node_modules /XF '*.bak-*' /NFL /NDL /NJH /NJS /NP
  if ($LASTEXITCODE -ge 8) { throw "robocopy failed with code $LASTEXITCODE" }
  Write-Host '[2/4] Copied the worktree into the profile.'
}

if ($Mode -eq 'dev') { Set-DevLink } else { Set-ReleaseCopy }

Write-Host '[3/4] Verifying ...'
$checks = @('lib\index.js', 'lib\client.js', 'package.json')
$bad = 0
foreach ($file in $checks) {
  $a = Join-Path $source $file
  $b = Join-Path $pluginPath $file
  $ha = (Get-FileHash $a -Algorithm SHA256).Hash
  $hb = (Get-FileHash $b -Algorithm SHA256).Hash
  if ($ha -ne $hb) { $bad++; Write-Host "  MISMATCH $file" } else { Write-Host "  ok $file" }
}
if ($bad -gt 0) { throw "$bad file(s) differ; the app would run stale code." }

$link = Get-Item $pluginPath -Force -ErrorAction SilentlyContinue
Write-Host ("      home    : " + $DesktopHome)
Write-Host ("      profile : desktop")
Write-Host ("      plugin  : " + $link.LinkType + " -> " + ($link.Target -join ','))

if ($NoLaunch) {
  Write-Host '[4/4] Skipped launching (-NoLaunch).'
} else {
  if (-not (Test-Path $DesktopExe)) { throw "Desktop executable not found: $DesktopExe" }
  # Pin the home/profile for the child so it cannot fall back to ~\.dsh.
  $env:DSH_HOME = $DesktopHome
  $env:DSH_PROFILE = 'desktop'
  Start-Process -FilePath $DesktopExe -WorkingDirectory (Split-Path $DesktopExe -Parent)
  Write-Host '[4/4] DeepSeek Harness started.'

  # Confirm the child actually uses this home: without DSH_HOME the desktop app
  # silently falls back to ~\.dsh, where the 'desktop' profile has no plugin and
  # the sessions are from the 0.1.0 era.
  $confirmed = $false
  for ($i = 0; $i -lt 12 -and -not $confirmed; $i++) {
    Start-Sleep -Milliseconds 700
    $hit = Get-CimInstance Win32_Process -Filter "Name='DeepSeek Harness.exe'" -ErrorAction SilentlyContinue |
      Where-Object { $_.CommandLine -and $_.CommandLine.Contains('dsh-desktop-host') -and $_.CommandLine.Contains($DesktopHome) }
    if ($hit) { $confirmed = $true }
  }
  if ($confirmed) {
    Write-Host '      verified: the running instance uses this DSH_HOME.'
  } else {
    Write-Warning 'could not confirm the instance uses this DSH_HOME. If you see old sessions, it fell back to ~\.dsh.'
  }
}

if ($Mode -eq 'dev' -and -not $NoWatch) {
  # Rebuild lib/client.js on every save; refresh the page to see the change.
  $watchCommand = "`$host.UI.RawUI.WindowTitle='VASPFlow client watch'; Set-Location '$source'; node scripts/build-client.mjs --watch"
  Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoExit', '-NoProfile', '-Command', $watchCommand) -WindowStyle Hidden
  Write-Host 'Background watcher started (lib/client.js rebuilds on save).'
}
