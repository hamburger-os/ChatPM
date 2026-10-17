param()
$ErrorActionPreference = 'Stop'
# The installed worker, API and database share the existing protected .env.
# This scheduled check never accepts a password or webhook on its CLI.
$Root = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$EnvFile = Join-Path $Root '.env'
if (-not (Test-Path -LiteralPath $EnvFile)) {
  throw 'Missing .env; configure the native installation first.'
}
$Node = (Get-Command node.exe -ErrorAction Stop).Source
$Name = 'ChatPM-Doctor'
if (Get-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue) {
  throw 'ChatPM-Doctor already exists. Inspect the existing schedule before replacing it.'
}
$Script = Join-Path $Root 'tools/ops/doctor.mjs'
if (-not (Test-Path -LiteralPath $Script)) {
  throw 'Missing ChatPM Doctor script.'
}
$Arguments = '"' + $Script + '"'
$Action = New-ScheduledTaskAction -Execute $Node -Argument $Arguments -WorkingDirectory $Root
$Trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(5) `
  -RepetitionInterval (New-TimeSpan -Minutes 5) `
  -RepetitionDuration (New-TimeSpan -Days 3650)
$Principal = New-ScheduledTaskPrincipal -UserId 'NT AUTHORITY\LocalService' `
  -LogonType ServiceAccount -RunLevel Limited
$Settings = New-ScheduledTaskSettingsSet -StartWhenAvailable `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 2)
Register-ScheduledTask -TaskName $Name -Action $Action -Trigger $Trigger `
  -Principal $Principal -Settings $Settings | Out-Null
Write-Host 'ChatPM Doctor scheduled every five minutes under LocalService.'
Write-Host 'Review non-zero Task Scheduler results and connect an external alert sink before production.'
