param(
  [string]$BackupDirectory = '',
  [int]$Keep = 14
)
$ErrorActionPreference = 'Stop'
if ($Keep -lt 1 -or $Keep -gt 3650) { throw 'Keep must be 1..3650' }
$Root = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
if (-not $BackupDirectory) { $BackupDirectory = Join-Path $Root 'backups' }
$Node = (Get-Command node.exe -ErrorAction Stop).Source
if (-not (Test-Path (Join-Path $Root '.env'))) { throw 'Configure .env before installing backup task.' }
if (Get-ScheduledTask -TaskName 'ChatPM-Backup' -ErrorAction SilentlyContinue) {
  throw 'ChatPM-Backup already exists. Inspect it before replacing it.'
}
New-Item -ItemType Directory -Path $BackupDirectory -Force | Out-Null
# Built-in LocalService SID; the PostgreSQL password is read from the protected .env at runtime.
# Backup data must be stored on encrypted storage and copied off machine securely.
& icacls.exe $BackupDirectory '/grant' '*S-1-5-19:(OI)(CI)(M)' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Unable to grant write permission to backup directory' }

$Arguments = '"' + (Join-Path $Root 'tools/ops/backup.mjs') +
  '" --dir="' + (Resolve-Path $BackupDirectory).Path + '" --keep=' + $Keep
$Action = New-ScheduledTaskAction -Execute $Node -Argument $Arguments -WorkingDirectory $Root
$Trigger = New-ScheduledTaskTrigger -Daily -At '02:30'
$Principal = New-ScheduledTaskPrincipal -UserId 'NT AUTHORITY\LocalService' -LogonType ServiceAccount -RunLevel Limited
$Settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 3)
Register-ScheduledTask -TaskName 'ChatPM-Backup' -Action $Action -Trigger $Trigger -Principal $Principal -Settings $Settings | Out-Null
Write-Host 'Registered daily ChatPM-Backup using LocalService. Run and inspect the task before relying on it.'
