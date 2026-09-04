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
  y ninguna ruta que responda sin token.

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

Guia paso a paso, de SQL Server al tunel: **[`deploy/GUIA-INSTALACION.md`](deploy/GUIA-INSTALACION.md)**.

Resumen:

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
   (`AUTH_ENABLED`). No crea tablas: el SP ya existe en el ERP y lo unico
   obligatorio es un `GRANT EXECUTE`.

## Endpoints

| Metodo | Ruta | Auth | Descripcion |
|--------|------|------|-------------|
| GET | `/health` | si* | Sonda. Responde `{"status":"ok"}` y nada mas |
| GET | `/health/deep` | si | Comprueba la conexion real a SQL Server |
| POST | `/auth/login` | si | `{ "usuario", "password" }` -> token de sesion |
| GET | `/auth/session` | si + sesion | Revalida la sesion y el estado de la cuenta |
| POST | `/query` | si + sesion | `{ "barcode": "..." }` -> producto + stock |
| POST | `/search` | si + sesion | `{ "q": "...", "limit": 25 }` -> coincidencias |

\* `/health` se puede abrir con `HEALTH_PUBLIC=true`. Por defecto lleva token,
para que escanear el puerto no devuelva ni un `200`.

Auth: header `x-bridge-token` **siempre**; ademas `Authorization: Bearer
<sesion>` cuando `AUTH_ENABLED=true`. Respuestas: `200`, `400` entrada invalida,
`401` token/sesion, `403` cuenta inactiva, `404` no encontrado, `413` body
grande, `429` limite, `501` funcion no configurada, `503` base no disponible.

## Login de usuario y licencia activa

Se activa por cliente con `AUTH_ENABLED=true`. El mismo bridge sirve a apps con
login y sin el, asi que por defecto esta apagado. Cuando esta activo:

1. La app pide **usuario y contrasena** ademas de la clave de activacion.
2. `POST /auth/login` los valida contra `SEG_USUARIOS` **en el SQL Server del
   propio cliente** y devuelve un token de sesion firmado (HMAC-SHA256, 12 h por
   defecto). Ni Supabase ni ningun servicio intermedio guarda o comprueba
   contrasenas: solo las reenvia.
3. **Cada** consulta de `/query` y `/search` vuelve a preguntar a la base si la
   cuenta sigue activa. No se espera a que caduque la sesion: dar de baja a un
   usuario corta el servicio en su siguiente escaneo.
4. Si la cuenta deja de estar activa, el bridge responde `403 account_inactive`
   y la app **borra del dispositivo la sesion, el usuario, la contrasena y la
   clave de activacion**.

```
POST /auth/login          x-bridge-token + { usuario, password }
  -> 200 { token, expiresAt }
  -> 401 invalid_credentials      usuario inexistente, dado de baja o
                                  contrasena incorrecta. El MISMO error para los
                                  tres: el endpoint no sirve para averiguar que
                                  usuarios existen ni cuales siguen de alta
  -> 429 too_many_attempts        10 intentos/min por (usuario, IP)
  -> 500 credential_unreadable    la columna Password no la produjo el
                                  algoritmo del ERP -> fallo de configuracion
  -> 503 auth_unavailable         la base no responde -> NO se borra nada
```

La baja (`Anulado = 1`) se detecta donde importa: en cada escaneo. `/query`
responde entonces `403 account_inactive` y la app borra todo lo que tenga
guardado.

Un fallo de conexion nunca se traduce en "inactivo": si lo hiciera, cada
reinicio del servidor del cliente desactivaria todos los dispositivos.

### Como se valida la contrasena

`SEG_USUARIOS.Password` no guarda un hash: guarda el **"Desempaquetador de
Claves V.5"** de FoxPro, un desplazamiento reversible. El bridge lo reimplementa
byte a byte en `src/lib/crypto.ts` (`npm run test:crypto` lo comprueba contra el
algoritmo original, incluidos los casos de codificacion).

> **Esto es ofuscacion, no cifrado.** Su unico secreto es el propio algoritmo:
> quien pueda leer esa columna recupera las contrasenas en claro. No se puede
> cambiar sin tocar el ERP, que escribe esa misma columna. La defensa real es
> que el usuario de SQL del bridge **no puede leer `SEG_USUARIOS`**: solo
> ejecutar el SP. Por eso no hay que "simplificar" dandole `db_datareader`.

**Detalle de codificacion que importa:** la contrasena cifrada cae siempre en
bytes altos (`'admin'` -> `175 169 172 162 158`), y como la columna es `varchar`
el driver la entrega ya convertida a texto segun la pagina de codigos de la
intercalacion — justo en el tramo `0x80-0x9F`, donde CP1252 e ISO-8859-1 no
coinciden. El bridge asume CP1252 y lo deja cambiar con `AUTH_PASSWORD_ENCODING`.
Si una instalacion usa otra pagina de codigos, `sql/03-auth-usuarios.sql` incluye
un SP envoltorio que devuelve `varbinary`: con el, el bridge recibe los bytes
crudos y la pagina de codigos deja de importar.

Sintoma de que hace falta: el login falla siempre con credenciales correctas y en
el log aparece `credencial ilegible`.

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
| `HEALTH_PUBLIC` | `false` | Deja `/health` sin token |
| `TLS_ENABLED` | `false` | HTTPS directo (ver `deploy/README-exposicion.md`) |
| `AUTH_ENABLED` | `false` | Exige login de usuario. Solo para clientes cuya app lo tenga |
| `AUTH_SP_LOGIN_NAME` | `dbo.SEG_Usuarios_Select_Password` | SP que devuelve la contrasena cifrada |
| `AUTH_SP_STATUS_NAME` | vacio | SP ligero de "sigue de alta". Vacio = usa el de login |
| `AUTH_PASSWORD_ENCODING` | `cp1252` | Pagina de codigos de la columna `Password` |
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
