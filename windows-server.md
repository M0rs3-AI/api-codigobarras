# Instalación en Windows Server (nativo, sin Docker)

Guía para correr el bridge **directamente con Node.js** en Windows Server, sin
Docker. Es la opción recomendada cuando el SQL Server está en el mismo Windows
Server (te conectas por `localhost`, sin el enredo de `host.docker.internal`).

> ¿Prefieres Docker (Linux o Windows con contenedores)? Usa el
> [`README.md`](./README.md).

## Por qué nativo

El bridge es solo Node + Express + `tedious` (sin módulos nativos que compilar),
así que corre perfecto en Windows sin Docker. Docker Desktop en Windows Server es
engorroso (pide WSL2/Hyper-V y su licencia en Server es un lío), y para contenedores
Linux necesitas WSL2. Nativo evita todo eso.

## Requisitos

- **Node.js 20 LTS** (instalador `.msi` de [nodejs.org](https://nodejs.org)).
- Acceso de red al SQL Server (mismo servidor o en la misma red).

---

## 1. Instalar Node.js

Instala el `.msi` de Node 20 LTS y verifica en PowerShell:

```powershell
node -v   # v20.x
```

## 2. Copiar el repo y compilar

Copia esta carpeta al servidor, p.ej. a `C:\bridge`, y luego:

```powershell
cd C:\bridge
npm ci
npm run build   # genera dist\server.js
```

## 3. Crear el `.env`

Copia `.env.example` a `.env` y complétalo. **Con el SQL Server en la misma
máquina, usa `localhost`** (a diferencia de Docker, que usaría `host.docker.internal`):

```
BRIDGE_TOKEN=<el mismo token guardado en Supabase>
SQL_SERVER=localhost
SQL_PORT=1435
SQL_DATABASE=nombre_db
SQL_USER=usuario
SQL_PASSWORD=contrasena
SP_NAME=INV_Pproductos_Seek_Codigo_Barra
PORT=3001
HOST_PORT=3001
```

Si el SQL Server está en **otro servidor** de la red, pon su IP o nombre en
`SQL_SERVER` (ej. `192.168.1.50`).

## 4. Probar a mano (antes de hacerlo servicio)

```powershell
npm start
```

En otra ventana:

```powershell
curl http://localhost:3001/health
```

Si responde `{ "status": "ok", ... }`, corta con `Ctrl+C` y sigue.

## 5. Instalarlo como servicio de Windows

Se usa **`node-windows`** (reemplazo moderno de NSSM, que ya está abandonado).
Los scripts `service-install.js` y `service-uninstall.js` ya vienen en el repo y
usan rutas relativas, así que funcionan sin importar dónde copiaste la carpeta.

```powershell
cd C:\bridge
npm install node-windows
```

Abre PowerShell **como Administrador** y ejecuta:

```powershell
node service-install.js
```

Esto:
- Registra el servicio **BridgeCodigoBarras** (visible en `services.msc`).
- Lo arranca de inmediato.
- Hace que **inicie solo con el servidor** y se **reinicie si se cae**.

El servicio corre con el directorio de trabajo en la carpeta del repo, así que
lee tu `.env` automáticamente.

## 6. Abrir el puerto en el firewall (público)

```powershell
New-NetFirewallRule -DisplayName "Bridge 3001" -Direction Inbound -Protocol TCP -LocalPort 3001 -Action Allow
```

Déjalo abierto a cualquier origen. **No** lo limites a IPs de Supabase: sus IPs de
salida son dinámicas. La seguridad la da el `BRIDGE_TOKEN`, no el firewall.

## 7. Verificar desde fuera

Desde un equipo con internet (no la misma red del servidor):

```
http://<IP-pública-del-cliente>:3001/health
```

Si responde, registra en la app admin:

```
vps_url = http://<IP-pública-del-cliente>:3001
```

---

## Mantenimiento

### Actualizar el código

```powershell
cd C:\bridge
# git pull  (o copiar los archivos nuevos)
npm ci
npm run build
# reiniciar el servicio:
Restart-Service BridgeCodigoBarras
```

El `.env` no se toca.

### Ver estado / logs

- Estado: `Get-Service BridgeCodigoBarras`
- `node-windows` escribe logs en la carpeta `daemon\` dentro del repo
  (`bridgecodigobarras.out.log` / `.err.log`).

### Desinstalar el servicio

Como Administrador:

```powershell
node service-uninstall.js
```

No borra el código ni el `.env`; solo quita el servicio.

---

## Notas de seguridad

- El tráfico va en **HTTP plano**: el `BRIDGE_TOKEN` y los datos viajan sin
  cifrar. Para búsquedas de productos es riesgo bajo, pero si quieres HTTPS
  necesitarías un dominio + certificado (reverse proxy con IIS/nginx/Caddy, o un
  balanceador/CDN delante). No es necesario para funcionar.
- Trata `BRIDGE_TOKEN` como una contraseña: es la única barrera contra quien
  intente llamar a `/query` sin autorización.
- El SQL Server queda privado detrás del bridge: nunca se expone a internet.
