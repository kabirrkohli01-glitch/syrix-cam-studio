# Installs the built app for the current user (no admin rights needed) and
# adds shortcuts to the desktop and the Start menu.

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$src = Join-Path $root 'dist\SYRIX Cam'
$dest = Join-Path $env:LOCALAPPDATA 'Programs\SYRIX Cam'
$exe = Join-Path $dest 'SyrixCam.exe'

if (-not (Test-Path (Join-Path $src 'SyrixCam.exe'))) { throw 'Run build.ps1 first.' }

# Replace an existing install; the running app holds its files open.
Get-Process -Name SyrixCam -ErrorAction SilentlyContinue | ForEach-Object {
    $_.CloseMainWindow() | Out-Null
    if (-not $_.WaitForExit(3000)) { $_.Kill() }
}
if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
New-Item -ItemType Directory -Force (Split-Path $dest) | Out-Null
Copy-Item $src $dest -Recurse

# Windows caches icons per file path, so the shortcut icon gets a name derived
# from its contents; a changed logo is then always picked up immediately.
$hash = (Get-FileHash (Join-Path $dest 'syrixcam.ico') -Algorithm SHA256).Hash.Substring(0, 10).ToLower()
$icon = Join-Path $dest "syrixcam-$hash.ico"
Copy-Item (Join-Path $dest 'syrixcam.ico') $icon

$shell = New-Object -ComObject WScript.Shell
$targets = @(
    (Join-Path ([Environment]::GetFolderPath('Desktop')) 'SYRIX Cam.lnk'),
    (Join-Path ([Environment]::GetFolderPath('Programs')) 'SYRIX Cam.lnk')
)
foreach ($path in $targets) {
    $lnk = $shell.CreateShortcut($path)
    $lnk.TargetPath = $exe
    $lnk.WorkingDirectory = $dest
    $lnk.IconLocation = "$icon,0"
    $lnk.Description = 'SYRIX Cam - made by Kabirr Kohli, powered by SYRIX'
    $lnk.Save()
    Write-Host "Shortcut: $path"
}

# Ask Explorer to reload icons so the new shortcuts show the current logo.
Add-Type -Namespace Win32 -Name Shell -MemberDefinition '[DllImport("shell32.dll")] public static extern void SHChangeNotify(int eventId, int flags, IntPtr item1, IntPtr item2);'
[Win32.Shell]::SHChangeNotify(0x08000000, 0x0000, [IntPtr]::Zero, [IntPtr]::Zero)
& "$env:WINDIR\System32\ie4uinit.exe" -show

Write-Host "Installed to $dest"
