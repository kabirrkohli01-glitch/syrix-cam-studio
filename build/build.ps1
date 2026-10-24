# Builds dist\SYRIX Cam: the native window host, its WebView2 libraries and
# the bundled web app. Uses the C# compiler that ships with .NET Framework 4.x,
# so no SDK install is required.

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$out = Join-Path $root 'dist\SYRIX Cam'
$lib = Join-Path $root 'host\lib'
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'

if (-not (Test-Path $csc)) { throw "C# compiler not found at $csc" }
# A development build links dist\SYRIX Cam\app to the source folder. Windows
# PowerShell's recursive delete follows junctions, so any link is removed on
# its own first; otherwise cleaning dist would empty the source app folder.
Get-ChildItem $out -Force -ErrorAction SilentlyContinue |
    Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint } |
    ForEach-Object { cmd /c rmdir "$($_.FullName)" | Out-Null }
if (Test-Path $out) { Remove-Item $out -Recurse -Force }
New-Item -ItemType Directory -Force $out | Out-Null

& $csc /nologo /target:winexe /platform:x64 /optimize+ `
    "/out:$out\SyrixCam.exe" `
    "/win32icon:$root\assets\syrixcam.ico" `
    "/win32manifest:$root\host\app.manifest" `
    "/r:$lib\Microsoft.Web.WebView2.Core.dll" `
    "/r:$lib\Microsoft.Web.WebView2.WinForms.dll" `
    /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:System.Web.Extensions.dll /r:System.Security.dll `
    "$root\host\SyrixCam.cs"
if ($LASTEXITCODE -ne 0) { throw 'Compilation failed' }

Copy-Item "$root\host\SyrixCam.exe.config" $out
Copy-Item "$lib\*.dll" $out
Copy-Item (Join-Path $root 'app') (Join-Path $out 'app') -Recurse
Copy-Item "$root\assets\syrixcam.ico" $out
Copy-Item "$root\build\uninstall.ps1" $out
Copy-Item "$root\THIRD_PARTY_NOTICES.txt" $out
Copy-Item "$lib\WebView2-LICENSE.txt" $out

$size = (Get-ChildItem $out -Recurse -File | Measure-Object Length -Sum).Sum / 1MB
Write-Host ("Built {0} ({1:N1} MB)" -f $out, $size)
