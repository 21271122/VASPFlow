# Sync the worktree plugin into the DSH desktop profile.
#
# The desktop app installs dsh-vaspflow as a real directory under
#   <DSH_HOME>/profiles/<profile>/node_modules/dsh-vaspflow
# so edits here only reach it after a copy. The client bundle happens to be
# picked up live, the host half (lib/index.js, lib/host/*) does not — which
# makes the UI look new while the data service is old.
#
# Run this with DeepSeek Harness fully closed, then start the app again.

$ErrorActionPreference = 'Stop'

$src = (Resolve-Path (Join-Path $PSScriptRoot '..\plugins\dsh-vaspflow')).Path
$dst = 'D:\Apps\DeepSeekHarness-0.2.0-rc.2\desktop-home\profiles\desktop\node_modules\dsh-vaspflow'

if (-not (Test-Path $dst)) { throw "Profile plugin not found: $dst" }

$running = @(Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue)
if ($running.Count -gt 0) {
  throw 'DeepSeek Harness is running. Quit it completely (tray icon too), then run this script again.'
}

Write-Host "Source : $src"
Write-Host "Target : $dst"

# /E copies everything, keeps extra files, never deletes; node_modules stays.
$null = robocopy $src $dst /E /XD node_modules /XF '*.bak-*' /NFL /NDL /NJH /NJS /NP
if ($LASTEXITCODE -ge 8) { throw "robocopy failed with code $LASTEXITCODE" }

$files = @('lib\index.js', 'lib\host\input-builder.js', 'lib\host\index.js', 'lib\client.js', 'package.json')
$bad = 0
foreach ($file in $files) {
  $a = Join-Path $src $file
  $b = Join-Path $dst $file
  if (-not (Test-Path $a)) { continue }
  $ha = (Get-FileHash $a -Algorithm SHA256).Hash
  $hb = (Get-FileHash $b -Algorithm SHA256).Hash
  if ($ha -ne $hb) { $bad++; Write-Host ("MISMATCH " + $file) } else { Write-Host ("ok       " + $file) }
}

if ($bad -gt 0) { throw "$bad file(s) still differ" }
Write-Host 'Synced. Start DeepSeek Harness again.'
