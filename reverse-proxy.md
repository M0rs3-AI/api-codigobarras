# Exponer el bridge a internet

El bridge escucha en el puerto `PORT` en el servidor del cliente. Para que el
sistema que lo consulta (ej. Supabase) pueda llamarlo desde internet, tienes
dos opciones segun como este montado el servidor del cliente. Elige **una**.

- **Opcion A — Publicar un puerto** (Cliente con puertos disponibles).
- **Opcion B — Reverse proxy** (Cliente con un solo puerto que enruta varios
  servicios: nginx, IIS, Caddy...).

En ambos casos, la unica barrera de autenticacion es el `BRIDGE_TOKEN`: el
hostname/puerto es publico, asi que trata ese token como una contrasena.

---

## Opcion A — Publicar un puerto directamente

El bridge escucha en `PORT` y tu abres ese puerto en el firewall del servidor.

### 1. Elige el puerto

En el `.env`:

```
PORT=3001   # puerto en el que escucha el bridge y que abres en el firewall
```

Si el cliente ya tiene el `3001` ocupado, cambia `PORT` a un puerto libre
(ej. `PORT=8085`) y reinicia el servicio.

### 2. Abre el puerto en el firewall

Abre el puerto `PORT` (TCP) hacia internet en el firewall del servidor y,
si aplica, en el router / grupo de seguridad del VPS.

- Windows Server: Firewall de Windows -> Reglas de entrada -> Nueva regla ->
  Puerto -> TCP -> `PORT`. O por PowerShell:

  ```powershell
  New-NetFirewallRule -DisplayName "Bridge 3001" -Direction Inbound -Protocol TCP -LocalPort 3001 -Action Allow
  ```

- VPS Linux (ufw): `sudo ufw allow 8085/tcp`.
- Cloud (AWS/GCP/Azure): agrega la regla de entrada en el Security Group /
  firewall de la instancia.

### 3. Prueba

```
curl http://IP-O-DOMINIO-DEL-SERVIDOR:3001/health
```

Debe responder `{"status":"ok", ...}`. Esa URL (`http://IP:PUERTO`) es la que
le das al sistema que consulta el bridge.

> HTTPS: al exponer el puerto directamente el trafico va en HTTP plano. Si
> necesitas TLS, usa la Opcion B (el proxy termina el HTTPS).

---

## Opcion B — Reverse proxy (nginx / IIS / Caddy)

Cuando el cliente expone varios servicios por un unico puerto publico
(normalmente 443), un reverse proxy recibe todo el trafico y lo enruta por
hostname o por ruta. En este caso **no** abres el puerto del bridge a internet:
el proxy lo alcanza localmente por `127.0.0.1:PORT` y solo el proxy queda
expuesto.

### B.1 — nginx

Agrega un `server` en la config de nginx que haga `proxy_pass` al bridge en
`127.0.0.1` y su puerto (`PORT`):

```nginx
server {
    listen 443 ssl;
    server_name cliente1.tudominio.com;

    ssl_certificate     /etc/letsencrypt/live/cliente1.tudominio.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/cliente1.tudominio.com/privkey.pem;

    location / {
        proxy_pass         http://127.0.0.1:3001;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
    }
}
```

Recarga nginx (`nginx -s reload`) y prueba
`curl https://cliente1.tudominio.com/health`.

### B.2 — IIS (Windows Server)

En Windows Server con IIS ya instalado, usa **Application Request Routing
(ARR)** + **URL Rewrite**:

1. Instala los módulos ARR y URL Rewrite (Web Platform Installer o los `.msi`
   de Microsoft).
2. En IIS habilita el proxy: **Application Request Routing Cache -> Server
   Proxy Settings -> Enable proxy**.
3. En el sitio (con su certificado / binding HTTPS) agrega una regla de
   **URL Rewrite** que reenvíe a `http://127.0.0.1:3001/{R:1}`.

Prueba `curl https://cliente1.tudominio.com/health`.

### B.3 — Caddy

Con Caddy el TLS es automático. En el `Caddyfile`:

```
cliente1.tudominio.com {
    reverse_proxy 127.0.0.1:3001
}
```

Prueba `curl https://cliente1.tudominio.com/health`.

> En todos los casos: deja el puerto del bridge **cerrado** en el firewall
> hacia internet (o limitado a `127.0.0.1`) para que solo el proxy lo alcance.

---

## Un cliente por despliegue

Cada cliente tiene su propio `.env` (su `BRIDGE_TOKEN`, sus datos de SQL, su
`PORT` o su hostname en el proxy). No reutilices el `BRIDGE_TOKEN` de un
cliente en otro.

## Dar de baja a un cliente

- Opcion A: cierra el puerto en el firewall y detén el servicio
  (`Stop-Service BridgeCodigoBarras`, o desinstálalo con
  `node service-uninstall.js`).
- Opcion B: elimina la ruta/hostname en el reverse proxy y detén el servicio.
