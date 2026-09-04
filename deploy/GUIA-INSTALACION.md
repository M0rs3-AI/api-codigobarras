# Guia de instalacion en el servidor del cliente

Lo que se instala es **un solo archivo ejecutable** con la configuracion dentro.
No se copia codigo fuente, no hace falta Node ni npm en el servidor del cliente,
y no queda ningun `.env` en disco.

Tiempo estimado: 20 minutos la primera vez.

---

## Antes de empezar: que pedirle al cliente

| Dato | Ejemplo | Para que |
|------|---------|----------|
| Host y puerto de SQL Server | `localhost`, `1433` | Conexion |
| Nombre de la base | `BIZOR_ERP` | Conexion |
| Un administrador de SQL (temporal) | `sa` | Solo para ejecutar los scripts de `sql/` una vez |
| Acceso de Administrador / root al servidor | — | Instalar el servicio |

El cliente **no** te da la contrasena de `sa` para el bridge: solo la necesitas
una vez para crear el usuario de minimo privilegio.

---

## Paso 1. Preparar SQL Server

Ejecuta en la base del cliente, como administrador, **en este orden**:

1. **`sql/01-usuario-minimo-privilegio.sql`** — obligatorio. Crea el usuario
   `bridge_codigobarras`. Sustituye `<NOMBRE_BASE_DATOS>` y
   `<CONTRASENA_LARGA_ALEATORIA>` antes de ejecutar; apunta esa contrasena, va
   en la configuracion del paso 2.

   Este script es lo que hace que comprometer el bridge no signifique
   comprometer la base: el usuario no puede leer ni una tabla, solo ejecutar los
   procedimientos que le concedas.

2. **`sql/02-sp-busqueda.sql`** — opcional. Solo si el cliente quiere busqueda
   por nombre ademas del escaneo.

3. **`sql/03-auth-usuarios.sql`** — solo para clientes con login de usuario
   (`AUTH_ENABLED`). No crea tablas: da permiso sobre un procedimiento que el
   ERP ya tiene.

**Comprueba que quedo bien.** Conectado *como* `bridge_codigobarras`:

```sql
EXEC dbo.INV_Pproductos_Seek_Codigo_Barra @CodigoBarra = '7501234567890';  -- debe funcionar
SELECT TOP 1 * FROM dbo.INV_PRODUCTOS;                                     -- debe FALLAR
```

Si el `SELECT` funciona, el usuario tiene mas permisos de los que debe. No sigas
hasta arreglarlo.

---

## Paso 2. Crear la configuracion del cliente

En **tu** maquina, crea `clientes/<cliente>.json`. Esa carpeta esta ignorada por
git porque contiene credenciales reales.

```json
{
  "BRIDGE_TOKEN": "<genera uno con: npm run token>",
  "AUTH_SECRET":  "<genera otro distinto con: npm run token>",

  "SQL_SERVER":   "localhost",
  "SQL_PORT":     "1433",
  "SQL_DATABASE": "BIZOR_ERP",
  "SQL_USER":     "bridge_codigobarras",
  "SQL_PASSWORD": "<la contrasena del paso 1>",

  "SP_NAME":       "INV_Pproductos_Seek_Codigo_Barra",
  "SP_PARAM_NAME": "CodigoBarra",

  "BIND_HOST": "127.0.0.1",
  "PORT":      "3001"
}
```

Eso es todo lo obligatorio. El resto tiene valores por defecto seguros:
`/health` pide token, el limite de intentos esta puesto y el login viene
apagado (se enciende por cliente, ver abajo).

**Opcionales que quizas necesites:**

```json
{
  "SP_STOCK_NAME":  "INV_Pproductos_GetStock_Codigo_Barra",
  "SP_SEARCH_NAME": "INV_Pproductos_Search",
  "AUTH_ENABLED":   "true",
  "SQL_ENCRYPT":    "false"
}
```

- `AUTH_ENABLED: "true"` — **solo** para clientes cuya app tenga pantalla de
  login (usuario y contrasena). El mismo bridge sirve a las dos variantes de la
  app; una app sin login no envia sesion y recibiria un 401 en cada escaneo, sin
  forma de recuperarse desde el telefono. Por eso viene apagado.
- `SQL_ENCRYPT: "false"` — solo para instancias antiguas de SQL Server que no
  soporten TLS.

`BIND_HOST: "127.0.0.1"` es importante: deja el bridge escuchando solo en local,
alcanzable unicamente por el tunel del paso 4. Ni siquiera la red interna del
cliente llega a el.

---

## Paso 3. Generar el ejecutable

```bash
npm run package -- --config clientes/<cliente>.json
```

Sale `build/<cliente>.exe`: un unico archivo, minificado, sin sourcemaps y con
la configuracion incrustada dentro. **El cliente no recibe codigo fuente.**

> El binario **no se compila cruzado**. El `.exe` de Windows se genera en
> Windows y el de Linux en Linux. Para un cliente Linux teniendo tu Windows:
>
> ```bash
> npm run package -- --config clientes/<cliente>.json --bundle
> ```
>
> Eso produce `bundle.cjs` + `<cliente>.env.json`. Solo necesita Node en el
> servidor. **Ojo:** en este modo la configuracion va en un JSON al lado del
> ejecutable, no dentro; protege ese archivo con permisos (el instalador de
> Linux ya lo hace).

Al empaquetar, el comando te recuerda si el login quedo activo. Leelo.

---

## Paso 4. Instalar el servicio

Copia al servidor del cliente **solo** el ejecutable y el instalador que le
corresponda.

### Windows (PowerShell como Administrador)

```powershell
.\install-windows.ps1 -BinaryPath .\<cliente>.exe
```

Deja:
- Servicio `BridgeCodigoBarras`, arranque automatico.
- Cuenta virtual `NT SERVICE\BridgeCodigoBarras`, sin permisos sobre el sistema.
- Reinicio automatico si se cae (5 s, 10 s, 30 s).
- **Ningun puerto abierto en el firewall.**

### Linux (root)

```bash
sudo ./install-linux.sh --binary ./<cliente>
# o, en modo bundle:
sudo ./install-linux.sh --bundle ./bundle.cjs --config ./<cliente>.env.json
```

Deja:
- Servicio systemd `bridge-codigobarras`, habilitado al arranque.
- Usuario de sistema sin shell ni home.
- `NoNewPrivileges=true`, `ProtectSystem=strict`.
- **Ningun puerto abierto.**

No pases `-OpenFirewallPort` en Windows salvo que sepas exactamente por que.

---

## Paso 5. Publicar el bridge (tunel de Cloudflare)

Hasta aqui el bridge funciona pero solo es alcanzable desde el propio servidor.
Falta que las Edge Functions de Supabase lleguen a el.

**Usa el tunel.** El servidor del cliente abre una conexion *saliente* hacia
Cloudflare: no queda **ningun puerto abierto** hacia internet, que es la via de
entrada mas comun del ransomware contra servidores expuestos. Tampoco hay que
tocar el router ni contratar IP fija, y el TLS lo pone Cloudflare.

Los comandos exactos para Windows y Linux estan en
[`README-exposicion.md`](README-exposicion.md), opcion A.

Resumen:

```bash
cloudflared tunnel login
cloudflared tunnel create bridge-<cliente>
cloudflared tunnel route dns bridge-<cliente> <cliente>.tudominio.com
cloudflared service install
```

Con el `config.yml` apuntando a `http://127.0.0.1:3001`.

El subdominio es de **tu** dominio, uno por cliente. El cliente no compra nada.

Las opciones B (HTTPS propio) y C (HTTP plano) estan documentadas, pero abren
puerto. La C ademas manda el token y los precios sin cifrar: solo como ultimo
recurso.

---

## Paso 6. Registrar el cliente en Supabase

En la tabla de licencias:

```
vps_url      = https://<cliente>.tudominio.com
bridge_token = <el BRIDGE_TOKEN del paso 2>
```

Tiene que ser un **hostname**, no una IP: las Edge Functions de Supabase no
abren conexiones salientes a IPv4.

---

## Paso 7. Comprobar

Desde el servidor del cliente:

```bash
curl -H "x-bridge-token: <BRIDGE_TOKEN>" http://127.0.0.1:3001/health/deep
# {"status":"ok","database":"ok"}
```

Desde fuera, por el tunel:

```bash
curl https://<cliente>.tudominio.com/health
# 401 -> correcto: sin token no responde nada
```

Login de un usuario real del ERP:

```bash
curl -X POST https://<cliente>.tudominio.com/auth/login \
  -H "x-bridge-token: <BRIDGE_TOKEN>" -H "Content-Type: application/json" \
  -d '{"usuario":"jperez","password":"suclave"}'
# {"success":true,"token":"v1...."}
```

Y por ultimo, escanea un producto con la app.

---

## Si algo falla

| Sintoma | Causa habitual |
|---------|----------------|
| `401` en todo, incluido `/health` | Falta o no coincide el `x-bridge-token`. Es el comportamiento correcto ante un escaneo |
| `503 auth_unavailable` | El bridge no llega a SQL Server. Revisa `SQL_*` y que la instancia acepte TCP |
| `500 credential_unreadable` | La columna `Password` no se pudo descifrar. Usa el SP envoltorio `varbinary` de `sql/03`, o prueba `AUTH_PASSWORD_ENCODING=latin1` |
| `401 invalid_credentials` con la clave correcta | El usuario tiene `Anulado = 1` en `SEG_USUARIOS`, o falta el `GRANT EXECUTE` de `sql/03` |
| `401 session_missing` al escanear | La app de ese telefono es antigua. Actualizala, o `AUTH_ENABLED: "false"` temporalmente |
| `501 auth_disabled` | El bridge se empaqueto con `AUTH_ENABLED: "false"` |

Registros del servicio:

```powershell
Get-EventLog -LogName Application -Source BridgeCodigoBarras -Newest 50   # Windows
```

```bash
journalctl -u bridge-codigobarras -n 50 --no-pager                        # Linux
```

---

## Actualizar a una version nueva

1. Vuelve a empaquetar con el **mismo** `clientes/<cliente>.json`.
2. Copia el ejecutable nuevo al servidor.
3. Relanza el instalador: detecta el servicio existente, lo para, reemplaza el
   binario y lo arranca.

El `BRIDGE_TOKEN` no cambia, asi que no hay que tocar Supabase. Si decides
rotarlo, actualiza tambien la fila del cliente en Supabase o dejaras la tienda
sin servicio.

---

## Desinstalar

```powershell
sc.exe stop BridgeCodigoBarras; sc.exe delete BridgeCodigoBarras   # Windows
```

```bash
sudo systemctl disable --now bridge-codigobarras
sudo rm /etc/systemd/system/bridge-codigobarras.service && sudo systemctl daemon-reload
```

En SQL Server, para revocar el acceso del todo:

```sql
DROP USER  [bridge_codigobarras];
DROP LOGIN [bridge_codigobarras];
```
