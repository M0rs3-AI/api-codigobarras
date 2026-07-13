#Requires -RunAsAdministrator

<#
.SYNOPSIS
  Instala BridgeCodigoBarras como servicio de Windows con node-windows.
  Se auto-eleva a Administrador si no lo está.
#>

$RepoDir = $PSScriptRoot

# ── Auto-elevación ────────────────────────────────────────────
$identity  = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal] $identity
$isAdmin   = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
  Write-Host "Solicitando permisos de Administrador..." -ForegroundColor Yellow
  Start-Process powershell.exe -Verb RunAs -ArgumentList @(
    "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
  ) -Wait
  exit
}

# ── Ya somos Administrador ────────────────────────────────────
Write-Host "Instalando servicio BridgeCodigoBarras..." -ForegroundColor Cyan
Set-Location $RepoDir

node service-install.js

if ($LASTEXITCODE -eq 0) {
  Write-Host "Servicio instalado e iniciado correctamente." -ForegroundColor Green
} else {
  Write-Host "Error: el servicio no se instaló (código $LASTEXITCODE)." -ForegroundColor Red
  Write-Host "Asegúrate de haber ejecutado 'npm install' antes de este paso." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Presiona Enter para cerrar esta ventana..." -ForegroundColor Gray
Read-Host | Out-Null
