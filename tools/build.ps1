# Build script for YaMusic Desktop Client (Windows, PowerShell)
# Usage: .\tools\build.ps1
# Output: dist\YaMusicDesktop.exe (один файл, без консоли)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location (Split-Path -Parent $root)

Write-Host "==> Installing dependencies..."
& ".\venv\Scripts\pip.exe" install pyinstaller pillow --quiet

$icon = "assets\icon.ico"
if (-not (Test-Path $icon)) {
    Write-Host "==> Icon not found, generating..."
    & ".\venv\Scripts\python.exe" "tools\make_icon.py"
}

# Убираем старую сборку
if (Test-Path "dist") { Remove-Item -Recurse -Force dist }
if (Test-Path "build") { Remove-Item -Recurse -Force build }

Write-Host "==> Running PyInstaller..."
& ".\venv\Scripts\pyinstaller.exe" `
    --onefile `
    --windowed `
    --name "YaMusicDesktop" `
    --icon $icon `
    --clean `
    --noconfirm `
    --add-data "assets;assets" `
    --hidden-import webview.platforms.win32 `
    --exclude-module numpy `
    --exclude-module pandas `
    --exclude-module matplotlib `
    --exclude-module scipy `
    main.py

if (-not $?) {
    Write-Error "PyInstaller failed"
    exit 1
}

$exe = Get-ChildItem "dist\YaMusicDesktop.exe" -ErrorAction SilentlyContinue
if ($exe) {
    $sizeMB = [math]::Round($exe.Length / 1MB, 2)
    Write-Host "==> DONE: dist\YaMusicDesktop.exe (${sizeMB} MB)"
} else {
    Write-Error "Exe not found in dist\"
    exit 1
}
