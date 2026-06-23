# Configurar Cloudflare Tunnel para este bridge

Esto permite que el bridge sea accesible desde internet (para que Supabase
le pueda llamar) **sin abrir ningún puerto** en el firewall del servidor
del cliente. El servidor solo necesita salida a internet (puerto 443
saliente), que casi todos los servidores ya tienen.

Todo se hace desde el **dashboard de Cloudflare** (no hace falta correr
comandos de login ni crear el túnel desde la consola del servidor). Se
hace **una vez por cliente**.

## Requisitos previos

- Una cuenta de Cloudflare (gratis sirve).
- Un dominio agregado a esa cuenta de Cloudflare (ej. `tudominio.com`), con
  sus DNS gestionados por Cloudflare.

Si todavía no tienes un dominio en Cloudflare, agrégalo primero en
[dash.cloudflare.com](https://dash.cloudflare.com) → "Add a domain".

## Paso 1: Crear el túnel

1. Entra a [Cloudflare Zero Trust](https://one.dash.cloudflare.com/).
2. Ve a **Networks → Tunnels**.
3. Click en **Create a tunnel**.
4. Elige el tipo de conector **Cloudflared**.
5. Ponle un nombre identificable por cliente, por ejemplo:
   `bridge-nombre-del-cliente`.
6. Click en **Save tunnel**.

## Paso 2: Copiar el token (NO el comando completo)

En la pantalla "Install and run a connector", Cloudflare te muestra un
comando como este:

```
cloudflared service install eyJhIjoiMTIzNC...token-muy-largo...
```

Lo único que necesitas es el **token** (el texto largo después de
`install`). Cópialo completo.

No necesitas ejecutar ese comando en el servidor — el `docker-compose`
(`api-codigobarras.yml`) ya incluye un contenedor `cloudflared` que usa
ese mismo token, así que la instalación nativa de `cloudflared` en el
servidor no es necesaria.

Pega el token en el `.env` del bridge:

```
CLOUDFLARE_TUNNEL_TOKEN=eyJhIjoiMTIzNC...token-muy-largo...
```

## Paso 3: Configurar el hostname público

Sigue en el dashboard del túnel, pestaña **Public Hostname** → **Add a
public hostname**:

| Campo       | Valor                                          |
|-------------|-------------------------------------------------|
| Subdomain   | algo identificable, ej. `cliente1`             |
| Domain      | tu dominio en Cloudflare, ej. `tudominio.com`  |
| Type        | `HTTP`                                         |
| URL         | `api-codigobarras:3001`                        |

**Importante:** en "URL" usa el **nombre del servicio dentro de
Docker** (`api-codigobarras`), no `localhost` y no la IP del servidor. El
puerto debe ser el mismo valor que `PORT` en el `.env` de ese cliente. Si
cambias `PORT` en el `.env`, recuerda actualizar también este valor en el
dashboard.

Guarda. El hostname público quedará algo así:

```
https://cliente1.tudominio.com
```

Ese es el dominio que le vas a dar a Supabase para que llame al bridge de
este cliente.

## Paso 4: Levantar el bridge

Con `CLOUDFLARE_TUNNEL_TOKEN` ya en el `.env`, sigue con el resto del
[`README.md`](./README.md):

```
docker compose -f api-codigobarras.yml up -d --build
```

Esto levanta el contenedor `cloudflared`, que se conecta hacia Cloudflare
y deja el hostname público enrutando al bridge.

## Paso 5: Probar

```
curl https://cliente1.tudominio.com/health
```

Debe responder `{"status":"ok", ...}`. Si responde error o timeout, revisa
los logs del túnel:

```
docker compose -f api-codigobarras.yml logs -f cloudflared
```

Errores comunes:

- **"Unauthorized" / túnel no conecta**: el `CLOUDFLARE_TUNNEL_TOKEN` está
  mal copiado o incompleto en el `.env`.
- **502 / Bad Gateway en el hostname**: revisa que el "URL" del Public
  Hostname use `api-codigobarras:PUERTO` (nombre del servicio, no
  `localhost`) y que el puerto coincida con `PORT` del `.env`.

## Un túnel por cliente

Cada cliente tiene su propio túnel, su propio hostname y su propio
`CLOUDFLARE_TUNNEL_TOKEN`. No reutilices el token de un cliente en otro —
cada `.env` debe tener el token correspondiente a su propio túnel.

## Dar de baja a un cliente

Si un cliente deja de usar el bridge: en el dashboard, **Networks →
Tunnels**, selecciona su túnel y elimínalo (o solo el Public Hostname).
Eso invalida el token y el acceso público de inmediato, sin tener que
tocar nada en el servidor del cliente.
