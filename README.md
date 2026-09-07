# Bridge Codigo de Barras

Servicio que se instala en el servidor de cada cliente y traduce peticiones HTTP
en llamadas a stored procedures de su SQL Server. Las credenciales de la base
nunca salen de ese servidor.

```
Edge Function de Supabase              Servidor del cliente
        |  x-bridge-token                     |
        +--> POST /query   ----------------> bridge --> SQL Server (solo SPs)
        +--> POST /search  ----------------> bridge --> SQL Server (solo SPs)
```

Se distribuye como **un unico ejecutable** con la configuracion incrustada: el
cliente no recibe codigo fuente, no necesita Node ni git, y no queda ningun
`.env` en su disco.

---

## Desplegar en un cliente

Guia detallada: [`deploy/GUIA-INSTALACION.md`](deploy/GUIA-INSTALACION.md).

### 1. SQL Server

Como administrador, en la base del cliente:

| Script | Obligatorio | Que hace |
|--------|-------------|----------|
| `sql/01-usuario-minimo-privilegio.sql` | **Si** | Crea `bridge_codigobarras`: no puede leer ninguna tabla, solo ejecutar los SPs que le concedas |
| `sql/02-sp-busqueda.sql` | No | Habilita `/search` |
| `sql/03-auth-usuarios.sql` | No | Habilita el login de usuario. No crea nada: es un `GRANT EXECUTE` sobre un SP del ERP |

Comprueba el resultado conectado **como** `bridge_codigobarras`:

```sql
EXEC dbo.INV_Pproductos_Seek_Codigo_Barra @CodigoBarra = '7501234567890';  -- funciona
SELECT TOP 1 * FROM dbo.INV_PRODUCTOS;                                     -- debe FALLAR
```

Si el `SELECT` funciona, el usuario tiene mas permisos de los que debe.

### 2. Configuracion del cliente

En tu maquina, `clientes/<cliente>.json` (carpeta ignorada por git):

```json
{
  "BRIDGE_TOKEN":  "<npm run token>",
  "SQL_SERVER":    "localhost",
  "SQL_PORT":      "1433",
  "SQL_DATABASE":  "BIZOR_ERP",
  "SQL_USER":      "bridge_codigobarras",
  "SQL_PASSWORD":  "<la del paso 1>",
  "SP_NAME":       "INV_Pproductos_Seek_Codigo_Barra",
  "SP_PARAM_NAME": "CodigoBarra",
  "BIND_HOST":     "127.0.0.1",
  "PORT":          "3001"
}
```

Eso es todo lo obligatorio; el resto tiene valores por defecto seguros. Añade
solo lo que ese cliente use:

```json
{
  "SP_STOCK_NAME":  "INV_Pproductos_GetStock_Codigo_Barra",
  "SP_SEARCH_NAME": "INV_Pproductos_Search",
  "AUTH_ENABLED":   "true",
  "SQL_ENCRYPT":    "false"
}
```

`AUTH_ENABLED` solo para clientes cuya app tenga pantalla de login.
`SQL_ENCRYPT: "false"` solo para instancias antiguas sin TLS.

### 3. Generar el ejecutable

```bash
npm run package -- --config clientes/<cliente>.json            # binario nativo
npm run package -- --config clientes/<cliente>.json --bundle   # .cjs + json
```

Sale `build/<cliente>.exe`: minificado, sin sourcemaps, con la configuracion
dentro.

El binario **no se compila de forma cruzada**: el `.exe` se genera en Windows y
el de Linux en Linux. Para un cliente Linux desde tu Windows usa `--bundle`, que
produce un `.cjs` que solo necesita Node — ahi la configuracion va en un JSON al
lado, y el instalador de Linux le pone permisos.

> Al inyectar la configuracion, Windows invalida la firma del ejecutable. Es
> esperado. Con SmartScreen estricto, firmalo con tu certificado.

### 4. Instalar como servicio

Copia al servidor **solo** el ejecutable y su instalador.

```powershell
.\install-windows.ps1 -BinaryPath .\<cliente>.exe          # como Administrador
```

```bash
sudo ./install-linux.sh --binary ./<cliente>
sudo ./install-linux.sh --bundle ./bundle.cjs --config ./<cliente>.env.json
```

Dejan el servicio con arranque automatico, bajo una cuenta de bajo privilegio
(cuenta virtual en Windows, usuario sin shell con aislamiento systemd en Linux)
y **sin abrir ningun puerto**.

### 5. Publicar el bridge

Hasta aqui solo responde en local. Opciones en
[`deploy/README-exposicion.md`](deploy/README-exposicion.md).

Recomendado, sin abrir puertos, un comando:

```powershell
$env:TUNNEL_TOKEN='eyJ...'
irm https://raw.githubusercontent.com/M0rs3-AI/api-codigobarras/main/deploy/tunnel-windows.ps1 | iex
```

```bash
curl -fsSL https://raw.githubusercontent.com/M0rs3-AI/api-codigobarras/main/deploy/tunnel-linux.sh \
  | sudo TUNNEL_TOKEN='eyJ...' bash
```

### 6. Registrar en Supabase

```
vps_url      = https://<cliente>.tudominio.com
bridge_token = <el BRIDGE_TOKEN del paso 2>
```

### 7. Comprobar

```bash
curl -H "x-bridge-token: <TOKEN>" http://127.0.0.1:3001/health/deep   # en el servidor
curl https://<cliente>.tudominio.com/health                           # desde fuera -> 401
```

El `401` desde fuera es lo correcto: sin token no responde nada.

---

## Actualizar y desinstalar

Reempaqueta con el **mismo** `clientes/<cliente>.json`, copia el binario nuevo y
relanza el instalador: para el servicio, reemplaza y arranca. El `BRIDGE_TOKEN`
no cambia, asi que no hay que tocar Supabase.

```powershell
sc.exe stop BridgeCodigoBarras; sc.exe delete BridgeCodigoBarras
```

```bash
sudo systemctl disable --now bridge-codigobarras
sudo rm /etc/systemd/system/bridge-codigobarras.service && sudo systemctl daemon-reload
```

---

## Endpoints

| Metodo | Ruta | Auth | Descripcion |
|--------|------|------|-------------|
| GET | `/health` | si* | Sonda |
| GET | `/health/deep` | si | Comprueba la conexion real a SQL Server |
| POST | `/auth/login` | si | `{ usuario, password }` -> token de sesion |
| GET | `/auth/session` | si + sesion | Revalida sesion y estado de la cuenta |
| POST | `/query` | si + sesion | `{ barcode }` -> producto + stock |
| POST | `/search` | si + sesion | `{ q, limit }` -> coincidencias |

\* Con token por defecto, para que escanear el puerto no devuelva ni un `200`.
Se abre con `HEALTH_PUBLIC=true`.

Header `x-bridge-token` siempre; ademas `Authorization: Bearer <sesion>` cuando
`AUTH_ENABLED=true`. Codigos: `400` entrada invalida, `401` token o sesion, `403`
cuenta inactiva, `404` no encontrado, `413` body grande, `429` limite, `501`
funcion no configurada, `503` base no disponible.

---

## Configuracion

Obligatorias: `BRIDGE_TOKEN`, `SQL_SERVER`, `SQL_DATABASE`, `SQL_USER`,
`SQL_PASSWORD`, `SP_NAME`.

| Clave | Por defecto | Para que sirve |
|-------|-------------|----------------|
| `PORT` | `3001` | Puerto de escucha |
| `BIND_HOST` | `0.0.0.0` | `127.0.0.1` con tunel: deja de ser alcanzable desde la red |
| `SP_PARAM_NAME` | `barcode` | Parametro del SP principal, sin la `@` |
| `SP_STOCK_NAME` | vacio | SP de stock por bodega |
| `SP_SEARCH_NAME` | vacio | SP de busqueda. Vacio = `/search` responde 501 |
| `SQL_ENCRYPT` | `true` | TLS hacia SQL Server |
| `SQL_POOL_MAX` | `4` | Conexiones simultaneas |
| `RATE_LIMIT_PER_MINUTE` | `120` | Peticiones por minuto **por token** |
| `MAX_SEARCH_RESULTS` | `25` | Tope de resultados |
| `HEALTH_PUBLIC` | `false` | Deja `/health` sin token |
| `TLS_ENABLED` | `false` | HTTPS directo |
| `AUTH_ENABLED` | `false` | Exige login de usuario |
| `AUTH_SP_LOGIN_NAME` | `dbo.SEG_Usuarios_Select_Password` | SP de la contrasena cifrada |
| `AUTH_SP_STATUS_NAME` | vacio | SP ligero de "sigue de alta" |
| `AUTH_PASSWORD_ENCODING` | `cp1252` | Pagina de codigos de la columna `Password` |
| `AUTH_SECRET` | derivada | Firma de las sesiones. Mejor propia que derivada |
| `AUTH_SESSION_TTL_MINUTES` | `720` | Duracion de la sesion |
| `AUTH_STATUS_CACHE_SECONDS` | `15` | Reutiliza un "activo". `0` = consultar siempre |
| `AUTH_LOGIN_RATE_PER_MINUTE` | `10` | Intentos de login por (usuario, IP) |

Lista completa: [`.env.example`](.env.example).

---

## Login de usuario

Se activa por cliente con `AUTH_ENABLED=true`, porque el mismo bridge sirve a
apps con login y sin el.

`POST /auth/login` valida usuario y contrasena contra `SEG_USUARIOS` **en el SQL
Server del propio cliente** y devuelve un token firmado (HMAC-SHA256, 12 h).
Supabase no guarda ni comprueba contrasenas: solo las reenvia.

Cada `/query` y `/search` vuelve a preguntar a la base si la cuenta sigue activa.
Si deja de estarlo, el bridge responde `403 account_inactive` y la app borra del
dispositivo la sesion, el usuario, la contrasena y la clave de activacion. Un
fallo de conexion devuelve `503` y **nunca** se traduce en "inactivo": si lo
hiciera, cada reinicio del servidor desactivaria todos los dispositivos.

El mismo `401 invalid_credentials` para usuario inexistente, dado de baja y
contrasena incorrecta, con el tiempo de respuesta igualado: el endpoint no sirve
para averiguar que usuarios existen.

### La contrasena del ERP

`SEG_USUARIOS.Password` no guarda un hash sino el "Desempaquetador de Claves
V.5" de FoxPro, un desplazamiento reversible. Se reimplementa en
`src/lib/crypto.ts`; `npm run test:crypto` lo verifica contra el algoritmo
original.

> **Es ofuscacion, no cifrado:** quien pueda leer esa columna recupera las
> contrasenas en claro. No se puede cambiar sin tocar el ERP, que escribe esa
> misma columna. La defensa real es que el usuario de SQL del bridge no puede
> leer `SEG_USUARIOS`, solo ejecutar el SP. Por eso no se le da `db_datareader`.

Si el login falla siempre con credenciales correctas y el log dice `credencial
ilegible`, es la pagina de codigos: prueba `AUTH_PASSWORD_ENCODING=latin1` o usa
el SP envoltorio `varbinary` de `sql/03-auth-usuarios.sql`, que entrega los bytes
crudos y hace la codificacion irrelevante.

---

## Desarrollo

```bash
npm install
cp .env.example .env
npm run dev          # tsx watch
npm run typecheck
npm run test:crypto
```
