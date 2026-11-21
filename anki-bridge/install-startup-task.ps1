# Registers Kevin-OS Anki Bridge to start silently in the background on Windows login
$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$syncScript = Join-Path $scriptDir "sync.mjs"
$nodePath = (Get-Command node).Source

$taskName = "KevinOS-AnkiBridge"
$action = New-ScheduledTaskAction -Execute $nodePath -Argument "`"$syncScript`"" -WorkingDirectory $scriptDir
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 2) -ExecutionTimeLimit (New-TimeSpan -Days 365)

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description "Syncs local Anki Desktop (AnkiConnect) with Kevin-OS cloud & Gemini MCP." -Force | Out-Null
Start-ScheduledTask -TaskName $taskName

Write-Host "✅ Installed and started Windows Startup Task: $taskName" -ForegroundColor Green
Write-Host "It will run silently whenever you log in and sync automatically whenever Anki Desktop is open."
