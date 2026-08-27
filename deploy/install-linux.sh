#!/usr/bin/env bash
#
# Instala el bridge en Linux (systemd) a partir del BINARIO o del bundle.
#
# Endurecimiento que aplica este script:
#   - Usuario de sistema propio, sin shell y sin directorio home.
#   - Unidad systemd con aislamiento fuerte: sistema de archivos de solo
#     lectura, /tmp privado, sin escalada de privilegios, sin acceso a los
#     dispositivos ni a los directorios personales.
#   - No abre ningun puerto en el firewall. La exposicion se resuelve con el
#     tunel (recomendado) o con una regla explicita.
#
# Uso:
#   sudo ./install-linux.sh --binary ./bridge-acme
#   sudo ./install-linux.sh --bundle ./bundle.cjs --config ./acme.env.json
#
set -euo pipefail

SERVICE_NAME="bridge-codigobarras"
INSTALL_DIR="/opt/${SERVICE_NAME}"
SERVICE_USER="${SERVICE_NAME}"
BINARY=""
BUNDLE=""
CONFIG=""
PORT="3001"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --binary) BINARY="$2"; shift 2 ;;
    --bundle) BUNDLE="$2"; shift 2 ;;
    --config) CONFIG="$2"; shift 2 ;;
    --port)   PORT="$2";   shift 2 ;;
    *) echo "Opcion desconocida: $1" >&2; exit 1 ;;
  esac
done

[[ $EUID -eq 0 ]] || { echo "Ejecuta con sudo." >&2; exit 1; }

if [[ -z "$BINARY" && -z "$BUNDLE" ]]; then
  echo "Indica --binary <archivo> o --bundle <archivo.cjs> --config <archivo.json>" >&2
  exit 1
fi

if [[ -n "$BUNDLE" ]]; then
  [[ -n "$CONFIG" ]] || { echo "--bundle requiere --config" >&2; exit 1; }
  command -v node >/dev/null || { echo "El modo bundle necesita Node.js instalado." >&2; exit 1; }
fi

echo "> Creando usuario de servicio ${SERVICE_USER}"
# Sin shell y sin home: esta cuenta no sirve para iniciar sesion.
if ! id -u "$SERVICE_USER" >/dev/null 2>&1; then
  useradd --system --no-create-home --shell /usr/sbin/nologin "$SERVICE_USER"
fi

echo "> Instalando en ${INSTALL_DIR}"
systemctl stop "$SERVICE_NAME" 2>/dev/null || true
mkdir -p "$INSTALL_DIR"

if [[ -n "$BINARY" ]]; then
  install -m 0500 -o "$SERVICE_USER" -g "$SERVICE_USER" "$BINARY" "${INSTALL_DIR}/bridge"
  EXEC_START="${INSTALL_DIR}/bridge"
  EXTRA_ENV=""
else
  install -m 0400 -o "$SERVICE_USER" -g "$SERVICE_USER" "$BUNDLE" "${INSTALL_DIR}/bundle.cjs"
  # 0400: el JSON lleva las credenciales de SQL Server, solo lo lee el servicio.
  install -m 0400 -o "$SERVICE_USER" -g "$SERVICE_USER" "$CONFIG" "${INSTALL_DIR}/config.json"
  EXEC_START="$(command -v node) ${INSTALL_DIR}/bundle.cjs"
  EXTRA_ENV="Environment=BRIDGE_CONFIG=${INSTALL_DIR}/config.json"
fi

chmod 0500 "$INSTALL_DIR"
chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"

echo "> Escribiendo la unidad de systemd"
cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<UNIT
[Unit]
Description=Bridge Codigo de Barras (consulta de productos contra SQL Server local)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${SERVICE_USER}
Group=${SERVICE_USER}
ExecStart=${EXEC_START}
${EXTRA_ENV}
Restart=always
RestartSec=5

# --- Aislamiento -----------------------------------------------------------
# Si alguien compromete el proceso, esto acota lo que puede alcanzar. Es la
# diferencia entre perder el bridge y perder el servidor.
NoNewPrivileges=true
PrivateTmp=true
PrivateDevices=true
ProtectSystem=strict
ProtectHome=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
ProtectClock=true
ProtectHostname=true
RestrictNamespaces=true
RestrictRealtime=true
RestrictSUIDSGID=true
LockPersonality=true
MemoryDenyWriteExecute=false
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
SystemCallArchitectures=native
SystemCallFilter=@system-service
SystemCallFilter=~@privileged @resources @mount @debug @reboot @swap
CapabilityBoundingSet=
UMask=0077

# Limites de recursos: un pico de carga no debe tumbar el servidor del cliente.
LimitNOFILE=4096
MemoryMax=512M
TasksMax=64

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable "$SERVICE_NAME" >/dev/null
systemctl start "$SERVICE_NAME"

sleep 3
if ! systemctl is-active --quiet "$SERVICE_NAME"; then
  echo "El servicio no arranco. Revisa: journalctl -u ${SERVICE_NAME} -n 50" >&2
  exit 1
fi

if command -v curl >/dev/null && curl -fsS "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; then
  echo "[OK] Bridge respondiendo en 127.0.0.1:${PORT}"
else
  echo "[!] El servicio corre pero /health no respondio en el puerto ${PORT}."
fi

cat <<FIN

============================================================
   Bridge instalado
============================================================

  Servicio:   ${SERVICE_NAME}   (systemctl status ${SERVICE_NAME})
  Directorio: ${INSTALL_DIR}
  Usuario:    ${SERVICE_USER}   (sin shell, sin privilegios)
  Sonda:      http://127.0.0.1:${PORT}/health
  Logs:       journalctl -u ${SERVICE_NAME} -f

  Siguiente paso: exponerlo. Ver deploy/README-exposicion.md
    Recomendado:  tunel de Cloudflare (sin puertos abiertos)
    Alternativa:  HTTPS con certificado propio

FIN
