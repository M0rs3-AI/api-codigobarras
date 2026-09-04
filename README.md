npm run package -- --config clientes/acme.json 

# Bridge Codigo de Barras

Servicio que se instala en el servidor de cada cliente y traduce peticiones HTTP
del sistema de consulta de precios en llamadas a stored procedures de su
SQL Server. Las credenciales de la base **nunca salen** de ese servidor.

```
Edge Function de Supabase          Servidor del cliente
  (no conoce las credenciales)
        |  x-bridge-token                  |
        +-----> POST /query   ------------>+---> SQL Server (stored procedures)
        +-----> POST /search  ------------>+
```

## Novedades de la version 2

- **Se distribuye como un unico ejecutable por cliente**, con su configuracion
  dentro. Ya no se clona el repositorio en el servidor del cliente, ni hace
  falta Node, Git o npm en su maquina, ni queda un `.env` en disco.
- **Endpoint `/search`**: busqueda por codigo interno, nombre o codigo de barras.
- **Pool de conexiones**: antes cada escaneo abria dos conexiones nuevas a SQL
  Server. Ahora se reutilizan.
- **Endurecimiento**: servicio con cuenta de bajo privilegio, comparacion de
  token en tiempo constante, limite por token, topes de entrada, TLS opcional y
  sonda publica que no revela nada del sistema.

## Empaquetar para un cliente

1. Crear su configuracion en `clientes/<cliente>.json` (esa carpeta esta
   ignorada por git; contiene credenciales reales):

```json
{
  "BRIDGE_TOKEN": "<generado con: npm run token>",
  "SQL_SERVER": "localhost",
  "SQL_PORT": "1433",
  "SQL_DATABASE": "nombre_db",
  "SQL_USER": "bridge_codigobarras",
  "SQL_PASSWORD": "<contrasena del usuario de minimo privilegio>",
  "SP_NAME": "INV_Pproductos_Seek_Codigo_Barra",
  "SP_PARAM_NAME": "CodigoBarra",
  "SP_STOCK_NAME": "INV_Pproductos_GetStock_Codigo_Barra",
  "SP_SEARCH_NAME": "INV_Pproductos_Search",
  "BIND_HOST": "127.0.0.1",
  "PORT": "3001"
}
```

2. Generar el artefacto:

```bash
npm run package -- --config clientes/acme.json            # binario nativo
npm run package -- --config clientes/acme.json --bundle   # .cjs + json (Linux)
```

El binario **no se compila de forma cruzada**: el `.exe` de Windows se genera en
Windows y el de Linux en Linux. Para un cliente Linux teniendo tu Windows, usa
`--bundle`: produce un unico `.cjs` que solo necesita Node en el servidor.

> Al inyectar el blob, Windows avisa de que la firma del ejecutable queda
> invalidada. Es esperado. Si el cliente tiene SmartScreen estricto, firma el
> binario resultante con tu propio certificado de firma de codigo.

## Instalar en el servidor del cliente

**Windows** (PowerShell como Administrador):

```powershell
.\install-windows.ps1 -BinaryPath .\acme.exe
```

**Linux**:

```bash
sudo ./install-linux.sh --binary ./acme
sudo ./install-linux.sh --bundle ./bundle.cjs --config ./acme.env.json
```

Ambos instaladores dejan el servicio corriendo con una cuenta de bajo privilegio
y **sin abrir ningun puerto**. Ver `deploy/README-exposicion.md` para exponerlo.

## Preparar la base de datos

Ejecutar en orden, como administrador de SQL Server:

1. `sql/01-usuario-minimo-privilegio.sql` — crea el usuario del bridge. **No te
   lo saltes.** Es lo que hace que comprometer el bridge no signifique
   comprometer la base entera.
2. `sql/02-sp-busqueda.sql` — opcional, habilita `/search`.
3. `sql/03-auth-usuarios.sql` — opcional, habilita el login de usuario
   (`AUTH_ENABLED`). Es una plantilla: ajusta los nombres al esquema real del
   cliente antes de ejecutarla.

## Endpoints

| Metodo | Ruta | Auth | Descripcion |
|--------|------|------|-------------|
| GET | `/health` | no | Sonda. Responde `{"status":"ok"}` y nada mas |
| GET | `/health/deep` | si | Comprueba la conexion real a SQL Server |
| POST | `/auth/login` | si | `{ "usuario", "password" }` -> token de sesion |
| GET | `/auth/session` | si + sesion | Revalida la sesion y el estado de la cuenta |
| POST | `/query` | si + sesion | `{ "barcode": "..." }` -> producto + stock |
| POST | `/search` | si + sesion | `{ "q": "...", "limit": 25 }` -> coincidencias |

Auth: header `x-bridge-token` **siempre**; ademas `Authorization: Bearer
<sesion>` cuando `AUTH_ENABLED=true`. Respuestas: `200`, `400` entrada invalida,
`401` token/sesion, `403` cuenta inactiva, `404` no encontrado, `413` body
grande, `429` limite, `501` funcion no configurada, `503` base no disponible.

## Login de usuario y licencia activa

Opcional, controlado por `AUTH_ENABLED`. Cuando esta activo:

1. La app pide **usuario y contrasena** ademas de la clave de activacion.
2. `POST /auth/login` los valida contra la base del cliente y devuelve un token
   de sesion firmado (HMAC-SHA256, 12 h por defecto).
3. **Cada** consulta de `/query` y `/search` vuelve a preguntar a la base si la
   cuenta sigue activa. No se espera a que caduque la sesion: dar de baja a un
   usuario corta el servicio en su siguiente escaneo.
4. Si la cuenta deja de estar activa, el bridge responde `403 account_inactive`
   y la app **borra del dispositivo la sesion, el usuario, la contrasena y la
   clave de activacion**.

```
POST /auth/login          x-bridge-token + { usuario, password }
  -> 200 { token, expiresAt }
  -> 401 invalid_credentials      usuario o contrasena mal (mismo error para
                                  ambos: el endpoint no sirve para saber que
                                  usuarios existen)
  -> 403 account_inactive         credenciales correctas, cuenta dada de baja
  -> 429 too_many_attempts        10 intentos/min por (usuario, IP)
  -> 503 auth_unavailable         la base no responde -> NO se borra nada
```

Un fallo de conexion nunca se traduce en "inactivo": si lo hiciera, cada
reinicio del servidor del cliente desactivaria todos los dispositivos.

### Lo que falta por implementar

Dos piezas dependen del esquema del cliente y estan marcadas como PLACEHOLDER:

| Pieza | Archivo | Que falta |
|-------|---------|-----------|
| Descifrado de la credencial | `src/lib/crypto.ts` | Algoritmo, origen de la clave y codificacion de la columna |
| Consulta a la base | `src/repositories/users.ts` + `src/lib/db.ts` | Nombre real de la tabla y de sus columnas |

`sql/03-auth-usuarios.sql` es la plantilla de la parte de base de datos, con la
alternativa recomendada: **descifrar dentro de SQL Server** (`DecryptByKey`), de
forma que ni el ciphertext ni la clave salgan nunca de la base y el bridge solo
reciba un booleano.

Mientras esos huecos sigan sin rellenar, `AUTH_ENABLED` debe quedarse en
`false`: con `true` el login responde `501 not_implemented`.

### Consultas tipadas (Kysely)

Las consultas del login se construyen con **Kysely**, no a mano. Las de producto
siguen llamando a stored procedures con tedious, que es lo correcto alli: no hay
SQL que construir, solo parametros que pasar tipados.

Donde si hay SQL que escribir -el login- un query builder aporta dos cosas: los
valores van **siempre** parametrizados (no existe la opcion de interpolarlos en
el texto) y el esquema esta declarado en TypeScript, asi que un nombre de columna
equivocado falla al compilar y no en el servidor del cliente. El pool de Kysely
es aparte y como mucho abre 2 conexiones: el login no debe competir por las
conexiones del catalogo, y si `AUTH_ENABLED` es false no se abre ninguna.

## Configuracion

Claves obligatorias: `BRIDGE_TOKEN`, `SQL_SERVER`, `SQL_DATABASE`, `SQL_USER`,
`SQL_PASSWORD`, `SP_NAME`.

| Clave | Por defecto | Para que sirve |
|-------|-------------|----------------|
| `PORT` | `3001` | Puerto de escucha |
| `BIND_HOST` | `0.0.0.0` | `127.0.0.1` con tunel: deja de ser alcanzable desde la red |
| `SP_PARAM_NAME` | `barcode` | Nombre del parametro del SP principal, sin la `@` |
| `SP_STOCK_NAME` | vacio | SP de stock por bodega. Vacio = el cliente no lo usa |
| `SP_SEARCH_NAME` | vacio | SP de busqueda. Vacio = `/search` responde 501 |
| `SQL_ENCRYPT` | `true` | TLS hacia SQL Server |
| `SQL_POOL_MAX` | `4` | Conexiones simultaneas |
| `RATE_LIMIT_PER_MINUTE` | `120` | Peticiones por minuto **por token** |
| `MAX_SEARCH_RESULTS` | `25` | Tope de resultados. El cliente solo puede pedir menos |
| `TLS_ENABLED` | `false` | HTTPS directo (ver `deploy/README-exposicion.md`) |
| `AUTH_ENABLED` | `false` | Exige login de usuario en `/query` y `/search` |
| `AUTH_SECRET` | derivada | Clave de firma de las sesiones. Mejor propia que derivada |
| `AUTH_SESSION_TTL_MINUTES` | `720` | Duracion de la sesion |
| `AUTH_STATUS_CACHE_SECONDS` | `15` | Reutiliza un "activo" ya comprobado. `0` = consultar siempre |
| `AUTH_LOGIN_RATE_PER_MINUTE` | `10` | Intentos de login por (usuario, IP) |

## Desarrollo

```bash
npm install
cp .env.example .env
npm run dev          # tsx watch
npm run typecheck
```
