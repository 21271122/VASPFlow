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
  [string]$DesktopHome = 'D:\Apps\DeepSeekHarness-0.2.0-rc.2\desktop-home',
  [string]$DesktopExe = 'D:\Apps\DeepSeekHarness-0.2.0-rc.2\Desktop\DeepSeek Harness.exe',
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

Write-Host ("[1/4] Building client bundle ...")
Push-Location $source
try { & node scripts/build-client.mjs } finally { Pop-Location }

function Remove-Link {
  param([string]$Path)
  # rmdir removes the junction itself and never touches the target.
  & cmd /c rmdir "$Path" | Out-Null
}

function Set-DevLink {
  $item = Get-Item $pluginPath -Force -ErrorAction SilentlyContinue
  if ($item -and $item.LinkType -eq 'Junction') {
    if ($item.Target -eq $source) { Write-Host '[2/4] Already linked to the worktree.'; return }
    Remove-Link $pluginPath
  } elseif ($item) {
    $backup = "$pluginPath.release-backup"
    if (Test-Path $backup) { Remove-Item $backup -Recurse -Force }
    Move-Item $pluginPath $backup
    Write-Host "[2/4] Previous install kept at $backup"
  }
  New-Item -ItemType Junction -Path $pluginPath -Target $source | Out-Null
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

if ($NoLaunch) {
  Write-Host '[4/4] Skipped launching (-NoLaunch).'
} else {
  if (-not (Test-Path $DesktopExe)) { throw "Desktop executable not found: $DesktopExe" }
  Start-Process -FilePath $DesktopExe
  Write-Host '[4/4] DeepSeek Harness started.'
}

if ($Mode -eq 'dev' -and -not $NoWatch) {
  # Rebuild lib/client.js on every save; refresh the page to see the change.
  $watchCommand = "`$host.UI.RawUI.WindowTitle='VASPFlow client watch'; Set-Location '$source'; node scripts/build-client.mjs --watch"
  Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoExit', '-NoProfile', '-Command', $watchCommand)
  Write-Host 'Watcher window opened (lib/client.js rebuilds on save).'
}
