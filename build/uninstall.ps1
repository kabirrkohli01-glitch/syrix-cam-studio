# Removes SYRIX Cam for the current user: shortcuts, program files and the
# display engine's working folder.

$ErrorActionPreference = 'SilentlyContinue'
Get-Process -Name SyrixCam | ForEach-Object { $_.CloseMainWindow() | Out-Null; if (-not $_.WaitForExit(3000)) { $_.Kill() } }

Remove-Item (Join-Path ([Environment]::GetFolderPath('Desktop')) 'SYRIX Cam.lnk') -Force
Remove-Item (Join-Path ([Environment]::GetFolderPath('Programs')) 'SYRIX Cam.lnk') -Force
Remove-Item (Join-Path $env:LOCALAPPDATA 'SYRIX Cam') -Recurse -Force

# The program folder is removed last, after this script has finished reading from it.
$dir = Join-Path $env:LOCALAPPDATA 'Programs\SYRIX Cam'
Start-Process -WindowStyle Hidden -FilePath "$env:WINDIR\System32\cmd.exe" -ArgumentList "/c timeout /t 2 /nobreak >nul & rmdir /s /q `"$dir`""
Write-Host 'SYRIX Cam has been removed.'
