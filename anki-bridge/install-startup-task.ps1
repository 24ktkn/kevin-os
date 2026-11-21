# Registers Kevin-OS Anki Bridge to start completely silently in the background on Windows login
$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$vbsScript = Join-Path $scriptDir "run-silent.vbs"
$wscriptPath = Join-Path $env:WINDIR "System32\wscript.exe"

$taskName = "KevinOS-AnkiBridge"
$action = New-ScheduledTaskAction -Execute $wscriptPath -Argument "//B //Nologo `"$vbsScript`"" -WorkingDirectory $scriptDir
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 2) -ExecutionTimeLimit (New-TimeSpan -Days 365)

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description "Silently syncs local Anki Desktop (AnkiConnect) with Kevin-OS cloud & Gemini MCP." -Force | Out-Null
Start-ScheduledTask -TaskName $taskName

Write-Host "Installed and started silent Windows Startup Task: $taskName" -ForegroundColor Green
