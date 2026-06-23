# Bridge Código de Barras

Mini API que se instala **en el servidor del cliente** (no en una nube
externa) y conecta el sistema de códigos de barras con la base de datos SQL
Server local del cliente, a través de un stored procedure.

Se distribuye como contenedor Docker: no hay que instalar Node.js, .NET ni
ningún driver de SQL Server en el servidor. Solo se necesita Docker.

Se expone a internet mediante **Cloudflare Tunnel** (`cloudflared`), por lo
que **no es necesario abrir ningún puerto** en el firewall del cliente. El
paso a paso para crear el túnel está en [`cloudflared.md`](./cloudflared.md).

## Requisitos

- Docker instalado en el servidor del cliente (Docker Desktop en Windows, o
  Docker Engine en Linux).
- Acceso de red desde el contenedor hacia el SQL Server (mismo servidor o
  servidor en la misma red).

## 1. Configurar

Copia `.env.example` a `.env`:

```
copy .env.example .env
```

Edita `.env` con los datos reales. **Es el único archivo que el cliente
necesita tocar.**

```
BRIDGE_TOKEN=xxxx-xxxx-xxxx-xxxx
SQL_SERVER=localhost
SQL_PORT=1435
SQL_DATABASE=nombre_db
SQL_USER=usuario
SQL_PASSWORD=contrasena
SP_NAME=nombre_stored_procedure
PORT=3001
CLOUDFLARE_TUNNEL_TOKEN=eyJ...
```

El valor de `CLOUDFLARE_TUNNEL_TOKEN` se obtiene creando un túnel en el
dashboard de Cloudflare — el procedimiento completo está en
[`cloudflared.md`](./cloudflared.md). Sin ese token, el contenedor
`cloudflared` no podrá conectarse y el bridge no será alcanzable desde
internet (pero seguirá funcionando si lo pruebas desde dentro del mismo
servidor).

### ⚠️ Importante: SQL_SERVER en Windows Server con Docker

Si el SQL Server corre en el **mismo Windows Server** donde corre Docker,
**NO uses `localhost`** en `SQL_SERVER`. Desde dentro del contenedor,
`localhost` apunta al propio contenedor, no al Windows Server que lo
hospeda.

Usa en su lugar:

```
SQL_SERVER=host.docker.internal
```

Esto le dice al contenedor "conéctate a la máquina que me hospeda". El
archivo `api-codigobarras.yml` ya viene preparado para que
`host.docker.internal` funcione también en Docker Engine para Windows.

Si el SQL Server está en **otro servidor** de la red, usa su IP o nombre de
red normalmente (ej. `192.168.1.50`).

## 2. Crear el túnel de Cloudflare (una sola vez por cliente)

Antes de levantar el contenedor necesitas el `CLOUDFLARE_TUNNEL_TOKEN`.
Sigue [`cloudflared.md`](./cloudflared.md) y pega el token en tu `.env`.

## 3. Levantar los contenedores

```
docker compose -f api-codigobarras.yml up -d --build
```

Esto levanta dos contenedores: el bridge (`api-codigobarras`) y el túnel
(`cloudflared`), ambos en segundo plano. Si alguno se cae o el servidor
reinicia, Docker los vuelve a levantar solo (`restart: unless-stopped`).

## 4. Verificar que funciona

Desde fuera del servidor (tu propia máquina, o Supabase):

```
curl https://TU-SUBDOMINIO.tudominio.com/health
```

Reemplaza por el hostname que configuraste en `cloudflared.md`. Debe
responder algo como:

```json
{ "status": "ok", "timestamp": "2026-06-23T12:00:00.000Z", "version": "1.0.0" }
```

Si quieres probar localmente desde el propio servidor sin pasar por el
túnel:

```
docker compose -f api-codigobarras.yml exec api-codigobarras wget -qO- http://localhost:3001/health
```

(cambia `3001` si usaste otro `PORT`).

## Endpoints

### `POST /query`

Headers:

```
x-bridge-token: xxxx-xxxx-xxxx-xxxx
Content-Type: application/json
```

Body:

```json
{ "barcode": "codigo_escaneado" }
```

Respuesta exitosa:

```json
{ "success": true, "data": { ...resultado_del_SP } }
```

Respuesta de error (token inválido, código no encontrado, falla de SQL,
etc.):

```json
{ "success": false, "error": "mensaje descriptivo" }
```

Si el token del header no coincide con `BRIDGE_TOKEN` del `.env`, responde
`401`.

### `GET /health`

Sin autenticación. Útil para monitoreo.

```json
{ "status": "ok", "timestamp": "...", "version": "1.0.0" }
```

## Cómo debe estar hecho el stored procedure (SP_NAME)

El bridge llama al SP definido en `SP_NAME` pasando **un solo parámetro**
llamado `@barcode` (texto). El SP debe:

1. Aceptar `@barcode NVARCHAR(...)` como parámetro de entrada.
2. Hacer `SET NOCOUNT ON;` al inicio (evita que mensajes de filas afectadas
   interfieran con el resultado).
3. Devolver el resultado con un `SELECT` (un recordset), no con `RETURN` ni
   parámetros de salida.
4. Idealmente devolver **una sola fila** por código de barras. Si no
   encuentra nada, simplemente no devolver filas (el bridge responde
   automáticamente `success: false` con "Código de barras no encontrado").

Ejemplo mínimo de SP compatible:

```sql
CREATE PROCEDURE nombre_stored_procedure
  @barcode NVARCHAR(50)
AS
BEGIN
  SET NOCOUNT ON;

  SELECT
    p.codigo_barras,
    p.nombre,
    p.precio,
    p.stock
  FROM Productos p
  WHERE p.codigo_barras = @barcode;
END
```

Si el SP devuelve más de una fila, el bridge las envía todas como arreglo
dentro de `data` (en vez de un solo objeto).

## Actualizar el bridge

Cuando recibas una nueva versión de los archivos del bridge:

```
docker compose -f api-codigobarras.yml up -d --build
```

Tu `.env` no se toca ni se sobreescribe.

## Comandos útiles

Ver los logs en vivo:

```
docker compose -f api-codigobarras.yml logs -f
```

Reiniciar el contenedor:

```
docker compose -f api-codigobarras.yml restart
```

Detenerlo:

```
docker compose -f api-codigobarras.yml down
```

## Seguridad

- El `.env` nunca se copia dentro de la imagen Docker; `docker-compose` lo
  lee desde el disco al levantar el contenedor (`env_file`). No lo subas a
  ningún repositorio ni lo compartas.
- Trata `BRIDGE_TOKEN` como una contraseña: solo el sistema autorizado a
  consultar el bridge debe conocerlo. Como el hostname del túnel es público
  en internet, `BRIDGE_TOKEN` es la única barrera contra quien intente
  llamar a `/query` sin autorización — no lo omitas ni lo debilites.
- Trata `CLOUDFLARE_TUNNEL_TOKEN` también como secreto: quien lo tenga
  puede hacer que ese túnel exponga otro servicio. No lo subas a ningún
  repositorio.
- El bridge no publica ningún puerto al host (no usa `ports:`); todo el
  tráfico entra exclusivamente a través de `cloudflared`. No agregues una
  sección `ports:` salvo que sepas que la necesitas para depurar.
