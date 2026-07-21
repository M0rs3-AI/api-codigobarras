# Bridge Código de Barras

Mini API que se instala **en el servidor del cliente** (no en una nube
externa) y conecta el sistema de códigos de barras con la base de datos SQL
Server local del cliente, a través de un stored procedure.

Corre **directamente con Node.js** (Express + `tedious`), sin módulos nativos
que compilar, así que funciona en Windows Server sin complicaciones. La
instalación paso a paso está en [`windows-server.md`](./windows-server.md).

Se expone a internet de una de dos formas, según cómo esté montado el servidor
del cliente (paso a paso en [`reverse-proxy.md`](./reverse-proxy.md)):

- **Opción A — Publicar un puerto**: abres un puerto del servidor en el
  firewall y el bridge escucha ahí directamente.
- **Opción B — Reverse proxy**: un proxy (nginx, IIS, Caddy...) enruta varios
  servicios por un único puerto (80/443) hacia este bridge.

## Requisitos

- **Node.js 20 LTS** en el servidor del cliente (instalador `.msi` de
  [nodejs.org](https://nodejs.org)).
- Acceso de red desde el bridge hacia el SQL Server (mismo servidor o
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
SP_PARAM_NAME=barcode
SP_STOCK_NAME=
SP_STOCK_PARAM_NAME=CodigoBarra
PORT=3001
```

`SP_STOCK_NAME` es **opcional**: un segundo stored procedure para consultar
stock por bodega. Si lo dejas vacío, el bridge no lo llama. Ver la sección
["Stock por bodega"](#stock-por-bodega-sp-opcional) más abajo.

`PORT` es el puerto en el que escucha el bridge: el que abres en el firewall
(Opción A) o al que apunta el reverse proxy (Opción B).

Si el SQL Server corre en el **mismo servidor** que el bridge, usa
`SQL_SERVER=localhost`. Si está en **otro servidor** de la red, usa su IP o
nombre de red (ej. `192.168.1.50`).

## 2. Instalar y levantar

La instalación como servicio de Windows (arranca solo con el servidor y se
reinicia si se cae) está detallada en [`windows-server.md`](./windows-server.md).
En resumen:

```powershell
npm install
npm run build             # genera dist\server.js
node service-install.js   # registra el servicio BridgeCodigoBarras
```

## 3. Elegir cómo exponer el bridge (una sola vez por cliente)

Decide entre publicar un puerto (Opción A) o usar un reverse proxy
(Opción B) según el servidor del cliente. El paso a paso de cada una está en
[`reverse-proxy.md`](./reverse-proxy.md):

- **Opción A**: abre el puerto `PORT` en el firewall del servidor.
- **Opción B**: no abras el puerto directamente; configura el reverse proxy
  (nginx/IIS/Caddy) para que enrute hacia `127.0.0.1:PORT`.

## 4. Verificar que funciona

Desde fuera del servidor (tu propia máquina, o Supabase):

```
# Opción A (puerto publicado):
curl http://IP-O-DOMINIO-DEL-SERVIDOR:3001/health

# Opción B (reverse proxy):
curl https://cliente1.tudominio.com/health
```

Usa el puerto (`PORT`) o el hostname que configuraste. Debe responder
algo como:

```json
{ "status": "ok", "timestamp": "2026-06-23T12:00:00.000Z", "version": "1.0.0" }
```

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
de texto, cuyo nombre se configura en `SP_PARAM_NAME` (por defecto
`barcode`, es decir `@barcode`). Si el cliente ya tiene un SP existente
con otro nombre de parámetro (ej. `@CodigoBarra`), no hace falta tocar el
SP: solo pon `SP_PARAM_NAME=CodigoBarra` en el `.env`. El SP debe:

1. Aceptar el parámetro de entrada como `NVARCHAR(...)`.
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

## Stock por bodega (SP opcional)

`SP_STOCK_NAME` configura un 2º SP para stock por bodega. El bridge lo llama en
paralelo con el mismo código y lo agrega en `stock`. Debe recibir un parámetro
de texto (`SP_STOCK_PARAM_NAME`, por defecto `@CodigoBarra`) y devolver columnas
**`Nombre`** (bodega) y **`Stock`** (cantidad):

```json
{ "success": true, "data": { ... }, "stock": [ { "Nombre": "Bodega Central", "Stock": 42 } ] }
```

Si falla o no está configurado, la consulta del producto no se ve afectada
(devuelve `stock: []`).

## Actualizar el bridge

Cuando recibas una nueva versión de los archivos del bridge:

```powershell
git pull
npm install
npm run build
Restart-Service BridgeCodigoBarras
```

Tu `.env` no se toca ni se sobreescribe.

## Seguridad

- El `.env` nunca se sube al repositorio ni se comparte. Contiene las
  credenciales del SQL Server y el `BRIDGE_TOKEN`.
- Trata `BRIDGE_TOKEN` como una contraseña: solo el sistema autorizado a
  consultar el bridge debe conocerlo. Como el puerto/hostname es público en
  internet, `BRIDGE_TOKEN` es la única barrera contra quien intente llamar a
  `/query` sin autorización — no lo omitas ni lo debilites.
- Al publicar un puerto (Opción A), el tráfico va en HTTP plano. Si necesitas
  HTTPS, usa un reverse proxy (Opción B) que termine el TLS. Ver
  [`reverse-proxy.md`](./reverse-proxy.md).
- Abre en el firewall únicamente el puerto que necesitas (`PORT`), y solo
  hacia donde haga falta. Si usas reverse proxy, no abras el puerto del bridge
  a internet: deja que solo el proxy lo alcance por `127.0.0.1`.
- El SQL Server queda privado detrás del bridge: nunca se expone a internet.
