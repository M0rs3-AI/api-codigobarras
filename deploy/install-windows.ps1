<#
.SYNOPSIS
  Instala el bridge en Windows / Windows Server a partir del BINARIO.

.DESCRIPTION
  Reemplaza al instalador anterior, que clonaba el repositorio completo y
  requeria Node, Git y npm en el servidor del cliente. Ahora se copia un solo
  ejecutable con su configuracion dentro.

  Endurecimiento que aplica este script:
    - El servicio corre bajo una cuenta virtual de bajo privilegio
      (NT SERVICE\BridgeCodigoBarras), no como LocalSystem. Si alguien
      compromete el bridge, no obtiene privilegios de administrador.
    - No abre ningun puerto en el firewall por defecto. La exposicion se
      resuelve con el tunel (recomendado) o con una regla explicita.
    - Sin .env en disco: las credenciales viajan dentro del binario.

.EXAMPLE
  # Como Administrador, en la carpeta que contiene bridge-acme.exe:
  .\install-windows.ps1 -BinaryPath .\bridge-acme.exe
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string] $BinaryPath,

    [string] $InstallDir = "$env:ProgramFiles\BridgeCodigoBarras",
    [string] $ServiceName = 'BridgeCodigoBarras',

    # Abre el puerto en el firewall de Windows. NO recomendado: preferir el
    # tunel, que no requiere ningun puerto entrante.
    [switch] $OpenFirewallPort,
    [int] $Port = 3001
)

$ErrorActionPreference = 'Stop'

function Write-Step { Write-Host "> $args" -ForegroundColor Cyan }
function Write-Ok   { Write-Host "[OK] $args" -ForegroundColor Green }
function Write-Warn { Write-Host "[!] $args" -ForegroundColor Yellow }

# -- Comprobar elevacion -----------------------------------------------------
$principal = New-Object Security.Principal.WindowsPrincipal(
    [Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Ejecuta este script en PowerShell como Administrador.'
}

if (-not (Test-Path $BinaryPath)) { throw "No existe el binario: $BinaryPath" }

# -- Copiar el binario -------------------------------------------------------
Write-Step "Instalando en $InstallDir"
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
$target = Join-Path $InstallDir 'bridge.exe'

if (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) {
    Write-Step 'Deteniendo el servicio existente para reemplazar el binario'
    Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
}
Copy-Item -Path $BinaryPath -Destination $target -Force
Write-Ok 'Binario copiado'

# -- Permisos del directorio -------------------------------------------------
# El binario lleva las credenciales del cliente dentro, asi que solo deben poder
# leerlo los administradores y la propia cuenta del servicio.
Write-Step 'Restringiendo permisos del directorio'
$acl = Get-Acl $InstallDir
$acl.SetAccessRuleProtection($true, $false)   # corta la herencia
$acl.Access | ForEach-Object { $acl.RemoveAccessRule($_) | Out-Null }
foreach ($account in @('BUILTIN\Administrators', 'NT AUTHORITY\SYSTEM')) {
    $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule(
        $account, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')))
}
Set-Acl -Path $InstallDir -AclObject $acl
Write-Ok 'Permisos restringidos a Administradores y SYSTEM'

# -- Crear / actualizar el servicio ------------------------------------------
Write-Step "Configurando el servicio $ServiceName"
if (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) {
    sc.exe config $ServiceName binPath= "`"$target`"" start= auto | Out-Null
} else {
    sc.exe create $ServiceName binPath= "`"$target`"" start= auto `
        DisplayName= 'Bridge Codigo de Barras' | Out-Null
}

sc.exe description $ServiceName 'Consulta de productos por codigo de barras contra SQL Server local.' | Out-Null

# Cuenta virtual: sin contrasena que gestionar y con privilegios minimos. Es la
# diferencia entre "comprometen el bridge" y "comprometen el servidor entero".
Write-Step 'Asignando cuenta de servicio de bajo privilegio'
sc.exe config $ServiceName obj= "NT SERVICE\$ServiceName" | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Warn 'No se pudo asignar la cuenta virtual. Cae a NETWORK SERVICE.'
    sc.exe config $ServiceName obj= 'NT AUTHORITY\NetworkService' | Out-Null
}

# Dar lectura y ejecucion del binario a la cuenta del servicio.
icacls $target /grant "NT SERVICE\${ServiceName}:(RX)" | Out-Null

# Reinicio automatico ante fallo.
sc.exe failure $ServiceName reset= 86400 actions= restart/5000/restart/10000/restart/30000 | Out-Null

Write-Ok 'Servicio configurado'

# -- Firewall ----------------------------------------------------------------
$ruleName = "$ServiceName inbound"
Remove-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
if ($OpenFirewallPort) {
    Write-Warn "Abriendo el puerto $Port a la red. Prefiere el tunel: no requiere puertos entrantes."
    New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Protocol TCP `
        -LocalPort $Port -Action Allow | Out-Null
} else {
    Write-Ok 'Sin reglas de firewall entrantes (modo tunel)'
}

# -- Arrancar ----------------------------------------------------------------
Write-Step 'Arrancando el servicio'
Start-Service -Name $ServiceName
Start-Sleep -Seconds 3

$status = (Get-Service -Name $ServiceName).Status
if ($status -ne 'Running') {
    throw "El servicio no arranco (estado: $status). Revisa el Visor de eventos."
}

try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 5
    Write-Ok "Bridge respondiendo: $($health.status)"
} catch {
    Write-Warn "El servicio corre pero /health no respondio en el puerto $Port."
}

Write-Host @"

============================================================
   Bridge instalado
============================================================

  Servicio:   $ServiceName  (services.msc)
  Binario:    $target
  Cuenta:     NT SERVICE\$ServiceName  (bajo privilegio)
  Sonda:      http://127.0.0.1:$Port/health

  Siguiente paso: exponerlo. Ver deploy/README-exposicion.md
    Recomendado:  tunel de Cloudflare (sin puertos abiertos)
    Alternativa:  HTTPS con certificado propio

"@ -ForegroundColor Green
