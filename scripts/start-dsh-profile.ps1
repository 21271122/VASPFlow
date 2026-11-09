param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('web', 'web-dev')]
  [string]$ProfileName,
  [Parameter(Mandatory = $true)]
  [string]$DisplayName
)

$ErrorActionPreference = 'Stop'
$supportedDshVersion = '0.1.0-rc.6'

function Test-DshPort {
  $client = New-Object Net.Sockets.TcpClient
  try {
    $client.Connect('127.0.0.1', 3080)
    return $true
  } catch {
    return $false
  } finally {
    $client.Dispose()
  }
}

Write-Host '[1/3] Stopping the running DSH service...'
$dshProcesses = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object {
  $_.CommandLine -match '@deepseek-ai[\\/]dsh[\\/]lib[\\/]bin\.js'
})
if ($dshProcesses.Count -eq 0) {
  Write-Host '[INFO] No running DSH service found.'
} else {
  foreach ($process in $dshProcesses) {
    Stop-Process -Id $process.ProcessId -Force
    Write-Host ('[INFO] Stopped DSH process ' + $process.ProcessId)
  }
  Start-Sleep -Milliseconds 300
}

Write-Host ('[2/3] Starting ' + $DisplayName + '...')
$cacheRoot = Join-Path $env:LOCALAPPDATA 'npm-cache\_npx'
$bins = @(Get-ChildItem -Path $cacheRoot -Directory -ErrorAction SilentlyContinue | ForEach-Object {
  $root = Join-Path $_.FullName 'node_modules\@deepseek-ai\dsh'
  $manifest = Join-Path $root 'package.json'
  $bin = Join-Path $root 'lib\bin.js'
  if (-not (Test-Path $manifest) -or -not (Test-Path $bin)) { return }
  try {
    if ((Get-Content $manifest -Raw | ConvertFrom-Json).version -eq $supportedDshVersion) {
      Get-Item $bin
    }
  } catch {
    # Ignore a partial or unreadable npx cache entry.
  }
} | Sort-Object LastWriteTime -Descending)

if ($bins.Count -eq 0) {
  throw "DSH $supportedDshVersion was not found in the npm npx cache. Start DeepSeek Harness once first."
}

$node = 'D:\nodejs\node.exe'
if (-not (Test-Path $node)) {
  $node = (Get-Command node -ErrorAction Stop).Source
}

$projectRoot = Split-Path $PSScriptRoot -Parent

# The VASP Agent preset is copied into DSH_HOME, while the development plugin
# itself is loaded from this checkout. Keep the development preset in sync so
# a restarted session cannot combine new tools with an old persona prompt.
if ($ProfileName -eq 'web-dev') {
  $presetSource = Join-Path $projectRoot 'plugins\dsh-vaspflow\preset\vasp'
  $dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $HOME '.dsh' }
  $presetDestination = Join-Path $dshHome '.agent-presets\vasp'
  $sourceLatest = Get-ChildItem -LiteralPath $presetSource -Recurse -File | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
  $destinationLatest = if (Test-Path $presetDestination) {
    Get-ChildItem -LiteralPath $presetDestination -Recurse -File | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
  }
  if ($null -eq $destinationLatest -or $sourceLatest.LastWriteTimeUtc -gt $destinationLatest.LastWriteTimeUtc) {
    Write-Host '[INFO] Syncing the VASP Agent preset from the development checkout...'
    & $node (Join-Path $projectRoot 'plugins\dsh-vaspflow\scripts\install-preset.mjs') '--replace'
    if ($LASTEXITCODE -ne 0) { throw 'VASP Agent preset sync failed.' }
  } else {
    Write-Host '[INFO] VASP Agent preset is up to date.'
  }
}

$logDir = Join-Path $env:LOCALAPPDATA 'VASPFlow\logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$stdout = Join-Path $logDir ('dsh-' + $ProfileName + '.out.log')
$stderr = Join-Path $logDir ('dsh-' + $ProfileName + '.err.log')
Start-Process -FilePath $node -ArgumentList @($bins[0].FullName, '--profile', $ProfileName) -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr
Write-Host ('[INFO] Started profile: ' + $ProfileName)

Write-Host '[3/3] Waiting for DSH to become ready...'
for ($attempt = 1; $attempt -le 20; $attempt += 1) {
  if (Test-DshPort) {
    Start-Process 'http://127.0.0.1:3080'
    Write-Host ('[INFO] Opened ' + $DisplayName + ': http://127.0.0.1:3080')
    exit 0
  }
  Start-Sleep -Seconds 1
}

throw ('DSH did not become ready within 20 seconds. See ' + $stderr)
