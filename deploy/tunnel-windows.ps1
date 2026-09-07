<#
.SYNOPSIS
  Publica el bridge por un tunel de Cloudflare en Windows / Windows Server.

.DESCRIPTION
  Deja el bridge alcanzable desde internet SIN abrir ningun puerto: cloudflared
  abre una conexion saliente hacia Cloudflare y el trafico entra por ahi.

  Usa un tunel gestionado en remoto: toda la configuracion (hostname, destino)
  vive en tu panel de Cloudflare y llega dentro del token. En el servidor del
  cliente no queda config.yml, ni cert.pem, ni hay que abrir un navegador.

  Descarga un unico binario. No instala Node, ni winget, ni gestor de paquetes.

.EXAMPLE
  # Una linea, como Administrador:
  $env:TUNNEL_TOKEN='eyJhIjoi...'; irm https://raw.githubusercontent.com/M0rs3-AI/api-codigobarras/main/deploy/tunnel-windows.ps1 | iex

.EXAMPLE
  # Descargando primero (preferible: el token no queda en el historial)
  .\tunnel-windows.ps1 -Token 'eyJhIjoi...'
#>
[CmdletBinding()]
param(
    # Token del tunel. Panel de Cloudflare > Zero Trust > Networks > Tunnels.
    [string] $Token = $env:TUNNEL_TOKEN,

    # Puerto local del bridge. Solo se usa para comprobar que responde.
    [int] $Port = 3001,

    [string] $InstallDir = "$env:ProgramFiles\cloudflared"
)

$ErrorActionPreference = 'Stop'

function Step { Write-Host "> $args" -ForegroundColor Cyan }
function Ok   { Write-Host "[OK] $args" -ForegroundColor Green }
function Warn { Write-Host "[!] $args" -ForegroundColor Yellow }

# Windows Server 2012/2016 negocia TLS 1.0 por defecto y GitHub lo rechaza.
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# -- Comprobaciones previas --------------------------------------------------
$principal = New-Object Security.Principal.WindowsPrincipal(
    [Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Ejecuta esto en PowerShell como Administrador.'
}

if ([string]::IsNullOrWhiteSpace($Token)) {
    throw @'
Falta el token del tunel.

Sacalo del panel: Cloudflare > Zero Trust > Networks > Tunnels > (tu tunel) >
Configure. Empieza por "eyJ". Luego:

    $env:TUNNEL_TOKEN='eyJ...'
'@
}

# El token es un JSON en base64. Si esta truncado o mal copiado, mejor fallar
# aqui que dejar un servicio instalado que reintenta en bucle.
if ($Token -notmatch '^eyJ[A-Za-z0-9+/=]+$') {
    throw 'El token no tiene la forma esperada (deberia empezar por "eyJ"). Copialo entero, sin espacios ni saltos de linea.'
}

Step "Comprobando que el bridge responde en 127.0.0.1:$Port"
try {
    Invoke-WebRequest -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 5 -UseBasicParsing | Out-Null
    Ok 'El bridge responde'
} catch {
    # Con HEALTH_PUBLIC=false (el valor por defecto) /health devuelve 401. Eso
    # significa que el bridge esta vivo: es la respuesta correcta.
    if ($_.Exception.Response.StatusCode.value__ -eq 401) {
        Ok 'El bridge responde (401 sin token, correcto)'
    } else {
        Warn "El bridge no responde en el puerto $Port. El tunel se instalara igual, pero no servira nada hasta que arranque el servicio BridgeCodigoBarras."
    }
}

# -- Descargar cloudflared ---------------------------------------------------
$arch = switch ($env:PROCESSOR_ARCHITECTURE) {
    'AMD64' { 'amd64' }
    'ARM64' { 'arm64' }
    'x86'   { '386' }
    default { 'amd64' }
}
$url = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-$arch.exe"
$exe = Join-Path $InstallDir 'cloudflared.exe'

Step "Descargando cloudflared ($arch)"
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

# Si ya hay un servicio corriendo, el .exe esta bloqueado: hay que pararlo antes.
$existing = Get-Service -Name 'cloudflared' -ErrorAction SilentlyContinue
if ($existing) {
    Step 'Ya habia un tunel instalado: se reemplaza (sirve para rotar el token)'
    Stop-Service -Name 'cloudflared' -Force -ErrorAction SilentlyContinue
    & $exe service uninstall 2>&1 | Out-Null
    Start-Sleep -Seconds 2
}

Invoke-WebRequest -Uri $url -OutFile $exe -UseBasicParsing
Ok "cloudflared en $exe"

# -- Instalar el servicio ----------------------------------------------------
Step 'Instalando el servicio del tunel'
& $exe service install $Token
if ($LASTEXITCODE -ne 0) {
    throw "cloudflared devolvio el codigo $LASTEXITCODE. Revisa que el token sea correcto y este entero."
}

Set-Service -Name 'cloudflared' -StartupType Automatic
Start-Service -Name 'cloudflared' -ErrorAction SilentlyContinue
Start-Sleep -Seconds 5

$status = (Get-Service -Name 'cloudflared').Status
if ($status -ne 'Running') {
    throw "El servicio del tunel no arranco (estado: $status). Revisa el Visor de eventos, origen cloudflared."
}
Ok 'Tunel conectado'

Write-Host @"

============================================================
   Tunel instalado
============================================================

  Servicio:  cloudflared  (services.msc)
  Binario:   $exe
  Puertos abiertos: NINGUNO

  Comprueba desde fuera (tu maquina, no esta):

    curl https://<subdominio>.tudominio.com/health
    -> 401 es CORRECTO: sin token el bridge no responde nada.

  Si da error 502, el tunel llega pero el bridge no: arranca el
  servicio BridgeCodigoBarras.

  Recuerda poner en Supabase:  vps_url = https://<subdominio>.tudominio.com

"@ -ForegroundColor Green
