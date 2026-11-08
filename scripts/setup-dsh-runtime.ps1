# Prepare an isolated, pinned DSH runtime. Never changes global Node or ~/.dsh.
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$runtimeRoot = Join-Path $projectRoot 'output\dsh-upgrade-runtime'
New-Item -ItemType Directory -Force -Path $runtimeRoot | Out-Null
$nodePathFile = Join-Path $runtimeRoot 'node-path.txt'
$nodeExe = if (Test-Path -LiteralPath $nodePathFile) { (Get-Content -LiteralPath $nodePathFile -Raw).Trim() }
if (-not $nodeExe -or -not (Test-Path -LiteralPath $nodeExe)) {
  $baseUrl = 'https://nodejs.org/dist/latest-v24.x/'
  $checksums = (Invoke-WebRequest -UseBasicParsing ($baseUrl + 'SHASUMS256.txt')).Content
  $match = [regex]::Match($checksums, '(?m)^([a-f0-9]{64})\s+(node-v24\.[\d.]+-win-x64\.zip)\s*$')
  if (-not $match.Success) { throw 'Official Node 24 Windows x64 checksum not found.' }
  $archive = Join-Path $runtimeRoot $match.Groups[2].Value
  Invoke-WebRequest -UseBasicParsing ($baseUrl + $match.Groups[2].Value) -OutFile $archive
  if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $match.Groups[1].Value) { throw 'Node archive checksum mismatch.' }
  Expand-Archive -LiteralPath $archive -DestinationPath $runtimeRoot -Force
  $nodeExe = Join-Path $runtimeRoot ($match.Groups[2].Value.Replace('.zip', '') + '\node.exe')
  Set-Content -LiteralPath $nodePathFile -Value $nodeExe -Encoding utf8
}
$version = & $nodeExe -p 'process.versions.node'
if ([version]$version -lt [version]'24.9.0') { throw 'Node >=24.9.0 is required.' }
$env:PATH = (Split-Path $nodeExe) + ';' + $env:PATH
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) { throw 'Install pnpm first: npm install -g pnpm' }
$hostRoot = Join-Path $runtimeRoot 'host'
$manifest = Join-Path $hostRoot 'node_modules\@deepseek-ai\dsh\package.json'
if (-not (Test-Path -LiteralPath $manifest) -or (Get-Content -LiteralPath $manifest -Raw | ConvertFrom-Json).version -ne '0.2.2-rc.1') {
  & $nodeExe (Join-Path (Split-Path $nodeExe) 'node_modules\npm\bin\npm-cli.js') install --prefix $hostRoot '@deepseek-ai/dsh@0.2.2-rc.1' --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw 'DSH runtime installation failed.' }
}
Write-Host "Ready: DSH 0.2.2-rc.1, Node $version ($runtimeRoot)"
