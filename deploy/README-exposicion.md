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

El tunel se gestiona **en remoto**: la configuracion (que hostname, a que
puerto local) vive en tu panel de Cloudflare y le llega al cliente dentro del
token. En su servidor no queda `config.yml`, ni `cert.pem`, ni hay que abrir un
navegador — cosa que en un Windows Server sin escritorio no era viable.

Son dos partes: una en tu panel (2 minutos, una vez por cliente) y una en su
servidor (un comando).

---

### Parte 1 — En tu panel de Cloudflare

[Zero Trust](https://one.dash.cloudflare.com) > **Networks** > **Tunnels** >
**Create a tunnel** > **Cloudflared**.

1. Nombre: `bridge-<cliente>`.
2. Salta la pantalla de instalacion (la hace el script) y **copia el token**:
   es la cadena larga que empieza por `eyJ`, dentro del comando que te muestra.
3. En **Public Hostnames** > **Add a public hostname**:

   | Campo | Valor |
   |-------|-------|
   | Subdomain | `<cliente>` |
   | Domain | `tudominio.com` |
   | Type | `HTTP` |
   | URL | `127.0.0.1:3001` |

El DNS se crea solo. El dominio es **tuyo**: un subdominio por cliente. El
cliente no compra nada.

> `Type: HTTP` es correcto y no resta seguridad. Ese salto es dentro del propio
> servidor, entre cloudflared y el bridge en `127.0.0.1`. El tramo que cruza
> internet lo cifra Cloudflare.

### Parte 2 — En el servidor del cliente

Un solo comando. Descarga un unico binario; no instala Node, ni winget, ni
añade repositorios de paquetes.

**Windows** (PowerShell como Administrador)

```powershell
$env:TUNNEL_TOKEN='eyJhIjoi...'
irm https://raw.githubusercontent.com/M0rs3-AI/api-codigobarras/main/deploy/tunnel-windows.ps1 | iex
```

**Linux** (como root)

```bash
curl -fsSL https://raw.githubusercontent.com/M0rs3-AI/api-codigobarras/main/deploy/tunnel-linux.sh \
  | sudo TUNNEL_TOKEN='eyJhIjoi...' bash
```

El script comprueba que el bridge responde, descarga `cloudflared`, lo instala
como servicio con arranque automatico y verifica que el tunel conecta. Volver a
ejecutarlo es seguro: desinstala el anterior y lo reemplaza, que es la forma de
**rotar el token**.

> **El token es un secreto.** Quien lo tenga puede levantar ese tunel. Pegado en
> la linea de comandos queda en el historial del shell; si te importa, descarga
> el script y pasalo con `-Token` / `--token`, o limpia el historial despues. Si
> se filtra: en el panel, **Refresh token**, y vuelve a lanzar el script.

### Parte 3 — Comprobar

Desde **tu** maquina, no desde la del cliente:

```bash
curl -i https://<cliente>.tudominio.com/health
```

| Respuesta | Significa |
|-----------|-----------|
| `401` | Correcto. El tunel llega y el bridge responde; sin token no da nada |
| `502` | El tunel llega pero el bridge no esta arrancado |
| `530` / no resuelve | El tunel no esta conectado. Mira los registros abajo |

Registros del tunel:

```powershell
Get-EventLog -LogName Application -Source cloudflared -Newest 30   # Windows
```

```bash
journalctl -u cloudflared -n 50 --no-pager                         # Linux
```

### Parte 4 — En Supabase

```
vps_url = https://<cliente>.tudominio.com
```

Tiene que ser un **hostname**, no una IP: las Edge Functions no abren conexiones
salientes a IPv4.

---

### Variante: el tunel en la cuenta del CLIENTE

Todo lo de arriba asume que el tunel esta en tu cuenta de Cloudflare y el
subdominio es de tu dominio. Funciona y es lo mas rapido, pero hay clientes que
no quieren que su acceso dependa de una cuenta tuya, y es una objecion legitima:
si tu cuenta se cierra o cambias de proveedor, se quedan sin servicio.

Se resuelve sin cambiar nada tecnico. El tunel se crea en **su** cuenta, con
**su** dominio, y a ti te pasan el token.

Que hace el cliente, una vez:

1. Crea una cuenta gratuita en [cloudflare.com](https://cloudflare.com) con su
   correo.
2. Añade su dominio (el que ya use para su web o su correo) y cambia los
   servidores DNS a los que le indique Cloudflare. Esto no afecta a su web ni a
   su correo: Cloudflare importa los registros existentes.
3. Sigue la **Parte 1** de arriba tal cual, con su propio subdominio, por
   ejemplo `barras.sudominio.com`.
4. Te pasa el token.

A partir de ahi todo es igual: lanzas el mismo script de la Parte 2 con ese
token, y en Supabase pones `vps_url = https://barras.sudominio.com`.

Diferencias reales:

| | Tu cuenta | Cuenta del cliente |
|---|---|---|
| Quien controla el dominio | Tu | El cliente |
| Si el cliente se va | Le quitas el subdominio | Se lleva lo suyo |
| Alta | Ninguna, ya la tienes | El cliente migra su DNS |
| Puerto abierto | Ninguno | Ninguno |
| Coste | Gratis | Gratis |

Si el cliente no tiene dominio propio y no quiere comprarlo, no hay variante:
o va en tu cuenta, o toca la opcion B o la C.

---

### Migrar un cliente que hoy esta en HTTP plano

El orden importa, para no dejar la tienda sin servicio:

1. Monta el tunel con los pasos de arriba. Convive con el HTTP actual.
2. Comprueba que `https://<cliente>.tudominio.com/health` da `401`.
3. Cambia `vps_url` en Supabase al `https://`. Escanea un producto: debe ir.
4. **Rota el `BRIDGE_TOKEN`.** El viejo ha viajado sin cifrar, hay que darlo por
   quemado: reempaqueta el binario con uno nuevo (`npm run token`), reinstala y
   actualiza a la vez la fila del cliente en Supabase.
5. Cierra el puerto en el router y en el firewall del servidor.
6. Pon `BIND_HOST: "127.0.0.1"` en su `clientes/<cliente>.json` y reinstala. Asi
   el bridge deja de ser alcanzable incluso desde la red interna.

Hasta el paso 5 el servidor sigue expuesto. No lo dejes a medias.

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
