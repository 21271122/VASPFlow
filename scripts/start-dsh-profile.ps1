param(
  [ValidateSet('web', 'web-dev')][string]$ProfileName = 'web-dev',
  [string]$DisplayName = 'VASPFlow / DSH 0.2.2',
  [int]$Port = 3090,
  [switch]$NoOpen,
  [switch]$NoWatch
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
& (Join-Path $PSScriptRoot 'setup-dsh-runtime.ps1')
$runtimeRoot = Join-Path $projectRoot 'output\dsh-upgrade-runtime'
$nodeExe = (Get-Content (Join-Path $runtimeRoot 'node-path.txt') -Raw).Trim()
$env:PATH = (Split-Path $nodeExe) + ';' + $env:PATH
$env:DSH_HOME = Join-Path $runtimeRoot 'user-home'
$cli = Join-Path $runtimeRoot 'host\node_modules\@deepseek-ai\dsh\lib\bin.js'
$plugin = Join-Path $projectRoot 'plugins\dsh-vaspflow'
$profileRoot = Join-Path $env:DSH_HOME ('profiles\' + $ProfileName)
# Initialize only missing profiles. --from-default-profile replaces existing data.
if (-not (Test-Path (Join-Path $profileRoot 'package.json'))) {
  if ($ProfileName -eq 'web') {
    & $nodeExe $cli --profile $ProfileName --dump-config | Out-Null
  } else {
    & $nodeExe $cli --profile $ProfileName --from-default-profile web --dump-config | Out-Null
  }
  if ($LASTEXITCODE -ne 0) { throw 'Profile initialization failed.' }
}
$client = New-Object Net.Sockets.TcpClient
try {
  $busy = $false
  try { $client.Connect('127.0.0.1', $Port); $busy = $true } catch {}
  if ($busy) { throw "Port $Port is already in use. Close that instance or pass another -Port." }
} finally { $client.Dispose() }
Push-Location $plugin
try {
  & pnpm install --frozen-lockfile
  if ($LASTEXITCODE -ne 0) { throw 'Plugin dependency installation failed.' }
  & $nodeExe scripts/build-client.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Plugin build failed.' }
} finally { Pop-Location }
& $nodeExe $cli plugin --profile $ProfileName add $plugin
if ($LASTEXITCODE -ne 0) { throw 'Plugin installation failed.' }
$logDir = Join-Path $runtimeRoot 'logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$stdout = Join-Path $logDir ($ProfileName + '.out.log')
$stderr = Join-Path $logDir ($ProfileName + '.err.log')
$arguments = '"' + $cli + '" --profile ' + $ProfileName + ' --host 127.0.0.1 --port ' + $Port
if ($NoOpen) { $arguments += ' --no-open' }
$process = Start-Process -FilePath $nodeExe -ArgumentList $arguments -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
for ($attempt = 0; $attempt -lt 40; $attempt++) {
  if ($process.HasExited) { throw "DSH exited. See $stderr" }
  try {
    $ping = Invoke-RestMethod ("http://127.0.0.1:$Port/plugins/dsh-vaspflow/ping")
    if ($ping.ok) {
      Write-Host "$DisplayName started (PID $($process.Id), port $Port). Logs: $logDir"
      if ($ProfileName -eq 'web-dev' -and -not $NoWatch) {
        $watchArguments = '"' + (Join-Path $plugin 'scripts\build-client.mjs') + '" --watch'
        Start-Process -FilePath $nodeExe -ArgumentList $watchArguments -WorkingDirectory $plugin -WindowStyle Hidden
      }
      return
    }
  } catch {}
  Start-Sleep -Milliseconds 500
}
throw "DSH startup timed out. See $stderr"
