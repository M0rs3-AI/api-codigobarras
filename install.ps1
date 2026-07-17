<#
.SYNOPSIS
  Instala Bridge Codigo de Barras en Windows / Windows Server.
  No requiere bash ni Git for Windows - funciona directamente desde PowerShell.
  Ejecutar:
    iex ((New-Object Net.WebClient).DownloadString('URL/install.ps1'))
#>

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$RepoUrl  = 'https://github.com/M0rs3-AI/api-codigobarras.git'
$RepoDir  = Join-Path $env:USERPROFILE '.bridge-codigobarras'

function Write-Step    { Write-Host "> $args" -ForegroundColor Cyan }
function Write-Ok      { Write-Host "[OK] $args" -ForegroundColor Green }
function Write-Warn    { Write-Host "[!] $args" -ForegroundColor Yellow }
function Write-Err     { Write-Host "[ERROR] $args" -ForegroundColor Red; exit 1 }

# -- Banner ------------------------------------------------------
Clear-Host
Write-Host @"

============================================================
   Bridge Codigo de Barras - Instalador (Windows)
   Express -> SQL Server
============================================================

"@ -ForegroundColor Cyan

# -- 1. Node.js ----------------------------------------------------
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Step "Node.js no esta instalado. Instalando..."
  $url = 'https://nodejs.org/dist/v20.18.0/node-v20.18.0-x64.msi'
  $msi = "$env:TEMP\node-install.msi"
  Invoke-WebRequest -Uri $url -OutFile $msi
  Start-Process msiexec.exe -ArgumentList "/i `"$msi`" /qn /norestart" -Wait
  # refrescar PATH para esta sesion
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  Write-Err "npm no esta disponible despues de instalar Node.js."
}
Write-Ok "Node.js $(node -v) - npm $(npm -v)"

# -- 2. Git (para clonar) --------------------------------------
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Write-Step "Git no esta instalado. Instalando..."
  $release = Invoke-RestMethod -Uri 'https://api.github.com/repos/git-for-windows/git/releases/latest' -Headers @{ 'User-Agent' = 'bridge-codigobarras-installer' }
  $asset = $release.assets | Where-Object { $_.name -like '*-64-bit.exe' } | Select-Object -First 1
  if (-not $asset) { Write-Err "No se pudo determinar la version mas reciente de Git for Windows." }
  $url = $asset.browser_download_url
  $exe = "$env:TEMP\git-install.exe"
  Invoke-WebRequest -Uri $url -OutFile $exe
  Start-Process $exe -ArgumentList '/VERYSILENT /NORESTART /NOCANCEL /SP- /CLOSEAPPLICATIONS /RESTARTAPPLICATIONS /COMPONENTS="ext,ext\shellhere,ext\guihere,gitlfs,assoc"' -Wait
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
}
Write-Ok "Git $(git --version)"

# -- 3. Clonar / actualizar repo ---------------------------------
if (Test-Path "$RepoDir\.git") {
  Write-Step "Actualizando repositorio..."
  Push-Location $RepoDir
  git pull
} else {
  Write-Step "Clonando repositorio en $RepoDir..."
  git clone $RepoUrl $RepoDir
  Push-Location $RepoDir
}
Write-Ok "Repositorio listo"

# -- 4. npm install ------------------------------------------------
Write-Step "Instalando dependencias de Node.js..."
npm install --silent 2>$null
Write-Ok "Dependencias instaladas"

# -- 5. Build --------------------------------------------------------
Write-Step "Compilando TypeScript..."
npm run build
Write-Ok "Compilacion exitosa"

# -- 6. Setup .env ---------------------------------------------------
if (-not (Test-Path ".env")) {
  Write-Step "Configura el bridge (TUI interactiva)...`n"
  node setup.js
  Write-Ok "Archivo .env generado"
} else {
  Write-Warn "Ya existe .env - se conserva sin cambios."
}

# -- 7. Instalar servicio ---------------------------------------
Write-Step "Instalando servicio de Windows..."
$identity  = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal] $identity
$isAdmin   = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
  Write-Warn "No se ejecuta como Administrador. Re-lanzando con elevation..."
  $psScript = Join-Path $RepoDir 'install-service.ps1'
  Start-Process powershell.exe -Verb RunAs -ArgumentList @(
    "-NoProfile -ExecutionPolicy Bypass -File `"$psScript`""
  ) -Wait
} else {
  Push-Location $RepoDir
  node service-install.js
}

Write-Ok "Servicio BridgeCodigoBarras instalado"

# -- 8. Mensaje final --------------------------------------------
$port = (Select-String '^PORT=(.+)' .env -ErrorAction SilentlyContinue).Matches.Groups[1].Value
if (-not $port) { $port = '3001' }

Write-Host @"

============================================================
   Bridge instalado y ejecutandose
============================================================

  Directorio:  $RepoDir
  Servicio:    BridgeCodigoBarras (services.msc)
  Endpoint:    http://localhost:$port/health

"@ -ForegroundColor Green

Pop-Location
