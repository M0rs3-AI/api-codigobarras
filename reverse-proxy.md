# Exponer el bridge a internet

El bridge escucha en el puerto `PORT` **dentro** del contenedor. Para que el
sistema que lo consulta (ej. Supabase) pueda llamarlo desde internet, tienes
dos opciones segun como este montado el servidor del cliente. Elige **una**.

- **Opcion A — Publicar un puerto** (Cliente con puertos disponibles).
- **Opcion B — Reverse proxy** (Cliente con un solo puerto que enruta varios
  servicios: Traefik, nginx, Caddy...).

En ambos casos, la unica barrera de autenticacion es el `BRIDGE_TOKEN`: el
hostname/puerto es publico, asi que trata ese token como una contrasena.

---

## Opcion A — Publicar un puerto directamente

Es la opcion por defecto del `api-codigobarras.yml`. El contenedor publica su
puerto en el host y tu abres ese puerto en el firewall del cliente.

### 1. Elige el puerto

En el `.env`:

```
PORT=3001        # puerto interno del contenedor (no hace falta cambiarlo)
HOST_PORT=3001   # puerto que se abre en el host / firewall del cliente
```

Si el cliente ya tiene el `3001` ocupado, cambia solo `HOST_PORT` a un puerto
libre (ej. `HOST_PORT=8085`). El mapeo en el compose es `HOST_PORT:PORT`.

### 2. Abre el puerto en el firewall

Abre el puerto `HOST_PORT` (TCP) hacia internet en el firewall del servidor y,
si aplica, en el router / grupo de seguridad del VPS.

- Windows Server: Firewall de Windows -> Reglas de entrada -> Nueva regla ->
  Puerto -> TCP -> `HOST_PORT`.
- VPS Linux (ufw): `sudo ufw allow 8085/tcp`.
- Cloud (AWS/GCP/Azure): agrega la regla de entrada en el Security Group /
  firewall de la instancia.

### 3. Levanta y prueba

```
docker compose -f api-codigobarras.yml up -d --build
curl http://IP-O-DOMINIO-DEL-SERVIDOR:8085/health
```

Debe responder `{"status":"ok", ...}`. Esa URL (`http://IP:PUERTO`) es la que
le das al sistema que consulta el bridge.

> HTTPS: al exponer el puerto directamente el trafico va en HTTP plano. Si
> necesitas TLS, usa la Opcion B (el proxy termina el HTTPS) o pon el servidor
> detras de un balanceador/CDN que agregue el certificado.

---

## Opcion B — Reverse proxy (Traefik / nginx / Caddy)

Cuando el cliente expone varios servicios por un unico puerto publico
(normalmente 443), un reverse proxy recibe todo el trafico y lo enruta por
hostname o por ruta. En este caso **no** publicas el puerto del bridge: lo
conectas a la red del proxy y el proxy enruta hacia el contenedor.

En el `api-codigobarras.yml`, para esta opcion normalmente:

- Comenta la seccion `ports:` (para no exponer el puerto directamente).
- Descomenta las `labels` (si usas Traefik), el `networks:` del servicio y el
  `networks:` de nivel raiz.

### B.1 — Traefik

Traefik descubre el servicio por las labels del contenedor. El
`api-codigobarras.yml` ya trae un ejemplo comentado:

```yaml
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.codigobarras.rule=Host(`cliente1.tudominio.com`)"
      - "traefik.http.routers.codigobarras.entrypoints=websecure"
      - "traefik.http.routers.codigobarras.tls.certresolver=letsencrypt"
      - "traefik.http.services.codigobarras.loadbalancer.server.port=${PORT:-3001}"
    networks:
      - proxy

networks:
  proxy:
    external: true
```

- `Host(...)`: el dominio publico que apuntara a este bridge.
- `server.port`: el puerto **interno** del contenedor (`PORT`), no `HOST_PORT`.
- `proxy`: la red externa que comparte Traefik. Debe existir; si no, creala con
  `docker network create proxy` y conecta Traefik a ella. El proxy alcanza al
  contenedor por su nombre de servicio (`api-codigobarras`) en esa red.
- Ajusta `entrypoints` / `certresolver` a como tengas configurado tu Traefik.

Prueba: `curl https://cliente1.tudominio.com/health`.

### B.2 — nginx

Con nginx no se usan labels. Conecta el contenedor a la misma red que nginx
(descomenta solo los bloques `networks:` del compose, deja `ports:` comentado)
y agrega un `server` en la config de nginx que haga `proxy_pass` al contenedor
por su nombre de servicio y su puerto interno (`PORT`):

```nginx
server {
    listen 443 ssl;
    server_name cliente1.tudominio.com;

    ssl_certificate     /etc/letsencrypt/live/cliente1.tudominio.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/cliente1.tudominio.com/privkey.pem;

    location / {
        proxy_pass         http://api-codigobarras:3001;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
    }
}
```

Si tu nginx corre fuera de Docker (en el host), en vez de apuntar al nombre del
servicio, deja publicado el puerto (Opcion A con `HOST_PORT`) y haz
`proxy_pass http://127.0.0.1:HOST_PORT;`.

Recarga nginx (`nginx -s reload`) y prueba
`curl https://cliente1.tudominio.com/health`.

---

## Un cliente por despliegue

Cada cliente tiene su propio `.env` (su `BRIDGE_TOKEN`, sus datos de SQL, su
`HOST_PORT` o su hostname en el proxy). No reutilices el `BRIDGE_TOKEN` de un
cliente en otro.

## Dar de baja a un cliente

- Opcion A: cierra el puerto en el firewall y baja el contenedor
  (`docker compose -f api-codigobarras.yml down`).
- Opcion B: elimina la ruta/hostname en el reverse proxy y baja el contenedor.
