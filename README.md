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

## Endpoints

| Metodo | Ruta | Auth | Descripcion |
|--------|------|------|-------------|
| GET | `/health` | no | Sonda. Responde `{"status":"ok"}` y nada mas |
| GET | `/health/deep` | si | Comprueba la conexion real a SQL Server |
| POST | `/query` | si | `{ "barcode": "..." }` -> producto + stock |
| POST | `/search` | si | `{ "q": "...", "limit": 25 }` -> coincidencias |

Auth: header `x-bridge-token`. Respuestas: `200`, `400` entrada invalida, `401`
token, `404` no encontrado, `413` body grande, `429` limite, `501` busqueda no
configurada, `503` base no disponible.

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

## Desarrollo

```bash
npm install
cp .env.example .env
npm run dev          # tsx watch
npm run typecheck
```
