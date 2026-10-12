param(
  [Parameter(Mandatory=$true)][ValidateSet('api','worker','web')][string]$Component
)
$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
Set-Location $Root
if (-not (Test-Path '.env')) { throw 'Missing .env; configure database and secrets before starting.' }
switch ($Component) {
  'api'    { & node 'dist/apps/api/src/server.js' }
  'worker' { & node 'dist/apps/worker/src/worker.js' }
  'web'    { & node 'node_modules/next/dist/bin/next' 'start' 'apps/web' '-p' '3000' '-H' '127.0.0.1' }
}
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
