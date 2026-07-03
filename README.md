# Bridge Código de Barras

Mini API que se instala **en el servidor del cliente** (no en una nube
externa) y conecta el sistema de códigos de barras con la base de datos SQL
Server local del cliente, a través de un stored procedure.

Dos formas de instalarlo:

- **Docker** (Linux, o Windows con contenedores): no hay que instalar Node.js ni
  drivers; solo Docker. Es lo que describe este README.
- **Windows Server nativo (sin Docker)**: recomendado cuando el SQL Server está en
  el mismo Windows Server. Paso a paso en
  [`windows-server.md`](./windows-server.md).

Se expone a internet de una de dos formas, según cómo esté montado el servidor
del cliente (paso a paso en [`reverse-proxy.md`](./reverse-proxy.md)):

- **Opción A — Publicar un puerto**: abres un puerto del cliente/VPS en el
  firewall y el contenedor escucha ahí directamente.
- **Opción B — Reverse proxy**: un proxy (Traefik, nginx, Caddy...) enruta
  varios servicios por un único puerto (80/443) hacia este bridge.

## Requisitos

- Docker instalado en el servidor del cliente (Docker Desktop en Windows, o
  Docker Engine en Linux). Para la instalación **sin Docker** en Windows Server,
  ver [`windows-server.md`](./windows-server.md).
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
HOST_PORT=3001
```

`PORT` es el puerto interno del contenedor y `HOST_PORT` es el puerto que se
publica en el host (el que abres en el firewall). Si usas un reverse proxy en
vez de publicar el puerto, `HOST_PORT` se ignora; ver
[`reverse-proxy.md`](./reverse-proxy.md).

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

## 2. Elegir cómo exponer el bridge (una sola vez por cliente)

Decide entre publicar un puerto (Opción A) o usar un reverse proxy
(Opción B) según el servidor del cliente. El paso a paso de cada una está en
[`reverse-proxy.md`](./reverse-proxy.md):

- **Opción A**: ajusta `HOST_PORT` en el `.env` y abre ese puerto en el
  firewall del cliente/VPS.
- **Opción B**: comenta la sección `ports:` del compose y conecta el
  contenedor a la red del reverse proxy (Traefik/nginx/Caddy).

## 3. Levantar el contenedor

```
docker compose -f api-codigobarras.yml up -d --build
```

Esto levanta el bridge (`api-codigobarras`) en segundo plano. Si se cae o el
servidor reinicia, Docker lo vuelve a levantar solo (`restart: unless-stopped`).

## 4. Verificar que funciona

Desde fuera del servidor (tu propia máquina, o Supabase):

```
# Opción A (puerto publicado):
curl http://IP-O-DOMINIO-DEL-SERVIDOR:3001/health

# Opción B (reverse proxy):
curl https://cliente1.tudominio.com/health
```

Usa el puerto (`HOST_PORT`) o el hostname que configuraste. Debe responder
algo como:

```json
{ "status": "ok", "timestamp": "2026-06-23T12:00:00.000Z", "version": "1.0.0" }
```

Si quieres probar localmente desde el propio servidor:

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
  consultar el bridge debe conocerlo. Como el puerto/hostname es público en
  internet, `BRIDGE_TOKEN` es la única barrera contra quien intente llamar a
  `/query` sin autorización — no lo omitas ni lo debilites.
- Al publicar un puerto (Opción A), el tráfico va en HTTP plano. Si necesitas
  HTTPS, usa un reverse proxy (Opción B) que termine el TLS, o pon el servidor
  detrás de un balanceador/CDN con certificado. Ver
  [`reverse-proxy.md`](./reverse-proxy.md).
- Abre en el firewall únicamente el puerto que necesitas (`HOST_PORT`), y solo
  hacia donde haga falta. Si usas reverse proxy, no publiques el puerto del
  bridge directamente: deja que solo el proxy lo alcance por la red interna de
  Docker.
