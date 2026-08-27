# Como exponer el bridge

El bridge tiene que ser alcanzable desde las Edge Functions de Supabase. Hay
tres formas, de mas a menos segura. **Elige la primera siempre que puedas.**

Resumen:

| Opcion | Puerto abierto | Cifrado | Necesita dominio | Coste |
|--------|----------------|---------|------------------|-------|
| A. Tunel de Cloudflare | **Ninguno** | Si | No (da un subdominio) | Gratis |
| B. HTTPS con certificado propio | 443 | Si | Si | Certificado |
| C. HTTP plano | 3001 | **No** | No | Gratis |

---

## Opcion A: tunel de Cloudflare (recomendado)

El servidor del cliente abre una conexion **saliente** hacia Cloudflare y el
trafico entra por ahi. Consecuencias:

- **No hay ningun puerto abierto** en el servidor del cliente. Nadie puede
  escanearlo ni alcanzarlo desde internet. Esto elimina la via de entrada mas
  comun de los ataques de ransomware contra servidores expuestos.
- No hace falta tocar el router, el firewall perimetral ni contratar IP fija.
- El cifrado TLS lo pone Cloudflare, sin gestionar certificados.
- Funciona igual en Windows y en Linux.

### Instalacion

Deja el bridge escuchando **solo en local** (`BIND_HOST=127.0.0.1` en la
configuracion del cliente). Asi, ni siquiera la red interna llega a el.

**Windows**

```powershell
winget install --id Cloudflare.cloudflared
cloudflared tunnel login
cloudflared tunnel create bridge-<cliente>
cloudflared tunnel route dns bridge-<cliente> <cliente>.tudominio.com
```

Crea `C:\Windows\System32\config\systemprofile\.cloudflared\config.yml`:

```yaml
tunnel: bridge-<cliente>
credentials-file: C:\Windows\System32\config\systemprofile\.cloudflared\<uuid>.json
ingress:
  - hostname: <cliente>.tudominio.com
    service: http://127.0.0.1:3001
  - service: http_status:404
```

```powershell
cloudflared service install
Start-Service cloudflared
```

**Linux**

```bash
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg \
  | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main" \
  | sudo tee /etc/apt/sources.list.d/cloudflared.list
sudo apt update && sudo apt install cloudflared

cloudflared tunnel login
cloudflared tunnel create bridge-<cliente>
cloudflared tunnel route dns bridge-<cliente> <cliente>.tudominio.com
sudo cloudflared service install
```

`/etc/cloudflared/config.yml`:

```yaml
tunnel: bridge-<cliente>
credentials-file: /root/.cloudflared/<uuid>.json
ingress:
  - hostname: <cliente>.tudominio.com
    service: http://127.0.0.1:3001
  - service: http_status:404
```

### En Supabase

```
vps_url = https://<cliente>.tudominio.com
```

El dominio es **tuyo**, no del cliente: un subdominio por cliente sobre tu
propio dominio. El cliente no necesita comprar nada.

---

## Opcion B: HTTPS directo con certificado propio

Para clientes que ya tienen dominio y prefieren no depender de un tercero.
Requiere abrir el puerto, con lo que el servidor vuelve a ser visible desde
internet: limita el origen en el firewall perimetral si el cliente puede.

Configuracion del cliente:

```json
{
  "TLS_ENABLED": "true",
  "TLS_CERT_PATH": "C:\\certs\\fullchain.pem",
  "TLS_KEY_PATH": "C:\\certs\\privkey.pem",
  "PORT": "443",
  "BIND_HOST": "0.0.0.0"
}
```

El bridge exige TLS 1.2 como minimo. Si el emisor entrega la cadena intermedia
por separado, indicala en `TLS_CA_PATH`.

**Obtener el certificado en Linux**

```bash
sudo apt install certbot
sudo certbot certonly --standalone -d <cliente>.tudominio.com
# fullchain.pem y privkey.pem quedan en /etc/letsencrypt/live/<dominio>/
```

Da acceso de lectura al usuario del servicio y programa la renovacion:

```bash
sudo setfacl -m u:bridge-codigobarras:r /etc/letsencrypt/live/<dominio>/privkey.pem
sudo systemctl edit --force --full certbot-renew.timer   # ya viene con certbot
```

**Obtener el certificado en Windows**

```powershell
# win-acme, interactivo
winget install --id WinAcme.WinAcme
wacs.exe --target manual --host <cliente>.tudominio.com --store pemfiles `
         --pemfilespath C:\certs
```

win-acme deja una tarea programada de renovacion. Tras cada renovacion hay que
reiniciar el servicio para que recargue el certificado:

```powershell
Restart-Service BridgeCodigoBarras
```

---

## Opcion C: HTTP plano (ultimo recurso)

```
vps_url = http://<ip-publica>:3001
```

**Que estas aceptando:** el `bridge_token` y todo el catalogo con sus precios
viajan sin cifrar. Cualquiera en el camino de red puede leerlos y quedarse con
el token, y con ese token consultar la base del cliente por su cuenta. Ademas el
puerto queda visible para cualquier escaneo de internet.

Si no queda mas remedio, mitiga al menos:

- Puerto no estandar y token largo (`npm run token` genera uno de 32 bytes).
- El usuario de SQL Server con minimo privilegio (`sql/01-usuario-minimo-privilegio.sql`).
  Sin esto, comprometer el bridge es comprometer la base entera.
- Servicio bajo cuenta de bajo privilegio: lo aplican los instaladores de `deploy/`.
- Revisar `journalctl -u bridge-codigobarras` o el Visor de eventos por picos de
  peticiones rechazadas.

Migra a la opcion A en cuanto puedas. No requiere nada del cliente.
