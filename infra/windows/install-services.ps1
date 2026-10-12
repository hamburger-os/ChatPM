param(
  [Parameter(Mandatory=$true)][string]$WinSWPath,
  [switch]$StartNow
)
$ErrorActionPreference = 'Stop'
# Run elevated. Install WinSW only from an official verified release.
$WinSW = (Resolve-Path $WinSWPath).Path
$Root = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$EnvFile = Join-Path $Root '.env'
if (-not (Test-Path $EnvFile)) { throw 'Missing .env in installation directory.' }
$Node = (Get-Command node.exe -ErrorAction Stop).Source

$Logs = Join-Path $Root 'logs'
$NextCache = Join-Path $Root 'apps/web/.next'
if (-not (Test-Path (Join-Path $NextCache 'BUILD_ID'))) {
  throw 'Missing production Next.js build. Run npm run setup:native first.'
}
if (-not (Test-Path (Join-Path $Root 'dist/apps/api/src/server.js'))) {
  throw 'Missing compiled API. Run npm run setup:native first.'
}
New-Item -ItemType Directory -Path $Logs -Force | Out-Null
# LocalService SID S-1-5-19. Grant RX only on application tree, M on runtime caches/logs.
# Remove inherited access to secrets; grant only LocalService, SYSTEM, Administrators.
function Set-AclChecked {
  param([string]$Path, [string[]]$AclArguments)
  & icacls.exe $Path @AclArguments | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Failed setting ACL on $Path" }
}
Set-AclChecked -Path $Root -AclArguments @('/grant', '*S-1-5-19:(OI)(CI)(RX)')
Set-AclChecked -Path $Logs -AclArguments @('/grant', '*S-1-5-19:(OI)(CI)(M)')
Set-AclChecked -Path $NextCache -AclArguments @('/grant', '*S-1-5-19:(OI)(CI)(M)')
Set-AclChecked -Path $EnvFile -AclArguments @('/inheritance:r')
Set-AclChecked -Path $EnvFile -AclArguments @('/grant:r', '*S-1-5-19:(R)', '*S-1-5-18:(F)', '*S-1-5-32-544:(F)')

$Services = @{
  'api' = 'dist/apps/api/src/server.js'
  'worker' = 'dist/apps/worker/src/worker.js'
  'web' = 'node_modules/next/dist/bin/next'
}
foreach ($Component in @('api','worker','web')) {
  $Id = "chatpm-$Component"
  if (Get-Service -Name $Id -ErrorAction SilentlyContinue) {
    throw "Service $Id already exists; stop/uninstall it before reinstallation."
  }
  $Wrapper = Join-Path $Root "$Id.exe"
  $ExtraArgs = if ($Component -eq 'web') { ' start apps/web -p 3000 -H 127.0.0.1' } else { '' }
  $Arguments = "$($Services[$Component])$ExtraArgs"
  $Xml = @"
<service>
  <id>$Id</id>
  <name>ChatPM $Component</name>
  <description>ChatPM $Component process</description>
  <startmode>Automatic</startmode>
  <serviceaccount><username>NT AUTHORITY\LocalService</username></serviceaccount>
  <env name="NODE_ENV" value="production" />
  <executable>$([System.Security.SecurityElement]::Escape($Node))</executable>
  <arguments>$([System.Security.SecurityElement]::Escape($Arguments))</arguments>
  <workingdirectory>$([System.Security.SecurityElement]::Escape($Root))</workingdirectory>
  <logpath>$([System.Security.SecurityElement]::Escape($Logs))</logpath>
  <onfailure action="restart" delay="10 sec" />
  <log mode="roll" />
  <stoptimeout>60 sec</stoptimeout>
</service>
"@
  # Apply configuration before service registration; avoids partial installs with missing config.
  Set-Content -Path (Join-Path $Root "$Id.xml") -Value $Xml -Encoding utf8
  Copy-Item -LiteralPath $WinSW -Destination $Wrapper
  & $Wrapper install
  if ($LASTEXITCODE -ne 0) { throw "Failed to register $Id" }
  if ($StartNow) {
    & $Wrapper start
    if ($LASTEXITCODE -ne 0) { throw "Failed to start $Id" }
  }
  Write-Host "Installed $Id using the built-in least-privilege LocalService account."
}
Write-Host 'Check services with Get-Service chatpm-*. Protect all release directories against non-admin writes.'
