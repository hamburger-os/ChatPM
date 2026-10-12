param(
  [Parameter(Mandatory=$true)][string]$WinSWPath,
  [switch]$StartNow
)
$ErrorActionPreference = 'Stop'
# WinSW is an external Windows service wrapper. Obtain and verify a signed release yourself.
$WinSW = (Resolve-Path $WinSWPath).Path
$Root = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
if (-not (Test-Path (Join-Path $Root '.env'))) { throw 'Missing .env in installation directory.' }
$Node = (Get-Command node.exe -ErrorAction Stop).Source
$Services = @{
  'api' = 'dist/apps/api/src/server.js'
  'worker' = 'dist/apps/worker/src/worker.js'
  'web' = 'node_modules/next/dist/bin/next'
}
foreach ($Component in @('api','worker','web')) {
  $Id = "chatpm-$Component"
  $Wrapper = Join-Path $Root "$Id.exe"
  Copy-Item -LiteralPath $WinSW -Destination $Wrapper -Force
  $ExtraArgs = if ($Component -eq 'web') { ' start apps/web -p 3000 -H 127.0.0.1' } else { '' }
  $Arguments = "$($Services[$Component])$ExtraArgs"
  $Xml = @"
<service>
  <id>$Id</id>
  <name>ChatPM $Component</name>
  <description>ChatPM $Component process</description>
  <startmode>Automatic</startmode>
  <executable>$([System.Security.SecurityElement]::Escape($Node))</executable>
  <arguments>$([System.Security.SecurityElement]::Escape($Arguments))</arguments>
  <workingdirectory>$([System.Security.SecurityElement]::Escape($Root))</workingdirectory>
  <onfailure action="restart" delay="10 sec" />
  <log mode="roll" />
  <stoptimeout>60 sec</stoptimeout>
</service>
"@
  Set-Content -Path (Join-Path $Root "$Id.xml") -Value $Xml -Encoding utf8
  & $Wrapper install
  if ($LASTEXITCODE -ne 0) { throw "Failed to register $Id" }
  Write-Host "Registered $Id for automatic start; configure a least-privilege account before production use."
  if ($StartNow) {
    & $Wrapper start
    if ($LASTEXITCODE -ne 0) { throw "Failed to start $Id" }
    Write-Host "Started $Id"
  }
}
