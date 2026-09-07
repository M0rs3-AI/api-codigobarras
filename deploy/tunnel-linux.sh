#!/usr/bin/env bash
#
# Publica el bridge por un tunel de Cloudflare en Linux.
#
# Deja el bridge alcanzable desde internet SIN abrir ningun puerto: cloudflared
# abre una conexion saliente hacia Cloudflare y el trafico entra por ahi.
#
# Usa un tunel gestionado en remoto: la configuracion (hostname, destino) vive
# en tu panel de Cloudflare y llega dentro del token. En el servidor del cliente
# no queda config.yml, ni cert.pem, ni hay que abrir un navegador.
#
# Descarga un unico binario. No usa apt, ni yum, ni añade repositorios.
#
# Uso, en una linea como root:
#   curl -fsSL https://raw.githubusercontent.com/M0rs3-AI/api-codigobarras/main/deploy/tunnel-linux.sh \
#     | sudo TUNNEL_TOKEN='eyJhIjoi...' bash
#
# O descargando primero (preferible: el token no queda en el historial):
#   sudo ./tunnel-linux.sh --token 'eyJhIjoi...'

set -euo pipefail

TOKEN="${TUNNEL_TOKEN:-}"
PORT="${BRIDGE_PORT:-3001}"
BIN=/usr/local/bin/cloudflared

while [ $# -gt 0 ]; do
  case "$1" in
    --token) TOKEN="$2"; shift 2 ;;
    --port)  PORT="$2";  shift 2 ;;
    *) echo "Opcion desconocida: $1" >&2; exit 1 ;;
  esac
done

step() { printf '\033[36m> %s\033[0m\n' "$*"; }
ok()   { printf '\033[32m[OK] %s\033[0m\n' "$*"; }
warn() { printf '\033[33m[!] %s\033[0m\n' "$*"; }
die()  { printf '\033[31m[X] %s\033[0m\n' "$*" >&2; exit 1; }

# -- Comprobaciones previas ---------------------------------------------------
[ "$(id -u)" -eq 0 ] || die 'Ejecuta esto como root (sudo).'

command -v systemctl >/dev/null 2>&1 \
  || die 'Este script instala un servicio de systemd y aqui no hay systemd.'

if [ -z "$TOKEN" ]; then
  die 'Falta el token del tunel.

Sacalo del panel: Cloudflare > Zero Trust > Networks > Tunnels > (tu tunel) >
Configure. Empieza por "eyJ". Luego:

    sudo TUNNEL_TOKEN='"'"'eyJ...'"'"' bash tunnel-linux.sh'
fi

# El token es un JSON en base64. Si esta truncado o mal copiado, mejor fallar
# aqui que dejar un servicio reintentando en bucle.
case "$TOKEN" in
  eyJ*) ;;
  *) die 'El token no tiene la forma esperada (deberia empezar por "eyJ"). Copialo entero, sin espacios ni saltos de linea.' ;;
esac

step "Comprobando que el bridge responde en 127.0.0.1:$PORT"
# Con HEALTH_PUBLIC=false (el valor por defecto) /health devuelve 401. Eso
# significa que el bridge esta vivo: es la respuesta correcta.
code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://127.0.0.1:$PORT/health" || echo 000)"
case "$code" in
  200) ok 'El bridge responde' ;;
  401) ok 'El bridge responde (401 sin token, correcto)' ;;
  *)   warn "El bridge no responde en el puerto $PORT (codigo $code). El tunel se instalara igual, pero no servira nada hasta que arranque bridge-codigobarras." ;;
esac

# -- Descargar cloudflared ----------------------------------------------------
case "$(uname -m)" in
  x86_64|amd64)  ARCH=amd64 ;;
  aarch64|arm64) ARCH=arm64 ;;
  armv7l|armv6l) ARCH=arm   ;;
  i386|i686)     ARCH=386   ;;
  *) die "Arquitectura no soportada: $(uname -m)" ;;
esac

step "Descargando cloudflared ($ARCH)"

# Si ya hay un tunel instalado, se desinstala antes: asi este script tambien
# sirve para rotar el token.
if systemctl list-unit-files 2>/dev/null | grep -q '^cloudflared\.service'; then
  step 'Ya habia un tunel instalado: se reemplaza (sirve para rotar el token)'
  systemctl stop cloudflared 2>/dev/null || true
  "$BIN" service uninstall >/dev/null 2>&1 || true
fi

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
curl -fsSL --retry 3 \
  "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-$ARCH" \
  -o "$tmp" || die 'No se pudo descargar cloudflared. Revisa la salida a internet del servidor.'

install -m 0755 "$tmp" "$BIN"
ok "cloudflared en $BIN ($("$BIN" --version 2>/dev/null | head -1))"

# -- Instalar el servicio -----------------------------------------------------
step 'Instalando el servicio del tunel'
"$BIN" service install "$TOKEN" \
  || die 'cloudflared fallo al instalar. Revisa que el token sea correcto y este entero.'

systemctl enable cloudflared >/dev/null 2>&1 || true
systemctl restart cloudflared
sleep 5

systemctl is-active --quiet cloudflared \
  || die 'El servicio del tunel no arranco. Revisa: journalctl -u cloudflared -n 50 --no-pager'
ok 'Tunel conectado'

cat <<'FIN'

============================================================
   Tunel instalado
============================================================

  Servicio:  cloudflared     (systemctl status cloudflared)
  Registros: journalctl -u cloudflared -f
  Puertos abiertos: NINGUNO

  Comprueba desde fuera (tu maquina, no esta):

    curl https://<subdominio>.tudominio.com/health
    -> 401 es CORRECTO: sin token el bridge no responde nada.

  Si da error 502, el tunel llega pero el bridge no: arranca el
  servicio bridge-codigobarras.

  Recuerda poner en Supabase:  vps_url = https://<subdominio>.tudominio.com

FIN
