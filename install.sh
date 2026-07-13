#!/usr/bin/env bash
set -euo pipefail

# ══════════════════════════════════════════════════════════════
# Bridge Código de Barras — Instalación automática
# Linux / macOS:  curl -fsSL URL | bash
# Windows:        iex ((New-Object Net.WebClient).DownloadString('URL/install.ps1'))
# ══════════════════════════════════════════════════════════════

REPO_URL="https://github.com/M0rs3-AI/api-codigobarras.git"
INSTALL_DIR="${INSTALL_DIR:-$HOME/.bridge-codigobarras}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

log()  { echo -e "${CYAN}▶${NC} $1"; }
ok()   { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}⚠${NC} $1"; }
fail() { echo -e "${RED}✗${NC} $1"; exit 1; }

echo -e "
${CYAN}╔══════════════════════════════════════════════════════╗${NC}
${CYAN}║   ${BOLD}Bridge Código de Barras — Instalador${NC}${CYAN}              ║${NC}
${CYAN}║   ${NC}Express → SQL Server${CYAN}                              ║${NC}
${CYAN}╚══════════════════════════════════════════════════════╝${NC}
"

# ── 1. Verificar / instalar Node.js ──────────────────────────

if ! command -v node &>/dev/null; then
  warn "Node.js no está instalado."

  if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    log "Instalando Node.js 20.x desde NodeSource..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
  elif [[ "$OSTYPE" == "darwin"* ]]; then
    log "Instalando Node.js 20.x con Homebrew..."
    brew install node@20
  elif [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "cygwin" ]]; then
    fail "Descarga Node.js manualmente desde https://nodejs.org (LTS 20.x), instálalo y vuelve a ejecutar este script."
  else
    fail "Sistema operativo no soportado. Instala Node.js manualmente."
  fi
fi

if ! command -v npm &>/dev/null; then
  fail "npm no está disponible después de instalar Node.js."
fi

ok "Node.js $(node -v) — npm $(npm -v)"

# ── 2. Verificar git ──────────────────────────────────────────

if ! command -v git &>/dev/null; then
  if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    log "Instalando git..."
    apt-get install -y git
  elif [[ "$OSTYPE" == "darwin"* ]]; then
    log "Instalando git con Homebrew..."
    brew install git
  else
    fail "Instala git manualmente y vuelve a ejecutar este script."
  fi
fi

ok "Git $(git --version | head -1)"

# ── 3. Clonar / actualizar repositorio ───────────────────────

if [[ -d "$INSTALL_DIR/.git" ]]; then
  log "Actualizando repositorio existente en ${INSTALL_DIR}..."
  cd "$INSTALL_DIR"
  git pull
else
  log "Clonando repositorio en ${INSTALL_DIR}..."
  git clone "$REPO_URL" "$INSTALL_DIR"
  cd "$INSTALL_DIR"
fi

ok "Repositorio listo en ${INSTALL_DIR}"
echo ""

# ── 4. Instalar dependencias ─────────────────────────────────

log "Instalando dependencias de Node.js..."
npm install --silent 2>/dev/null || npm install
ok "Dependencias instaladas"

# ── 5. Compilar TypeScript ───────────────────────────────────

log "Compilando TypeScript..."
npm run build
ok "Compilación exitosa"
echo ""

# ── 6. Configurar .env (interactivo) ─────────────────────────

if [[ ! -f ".env" ]]; then
  log "Configura el bridge respondiendo las siguientes preguntas:"
  echo ""
  node setup.js </dev/tty
  ok "Archivo .env generado"
else
  warn "Ya existe .env — se conserva sin cambios."
fi
echo ""

# ── 7. Instalar como servicio ────────────────────────────────

log "Instalando como servicio del sistema..."

if [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "cygwin" ]]; then
  log "Instalando servicio de Windows (se abrirá una ventana de UAC)..."

  # Convertir ruta MSYS ( /c/Users/... ) a ruta Windows ( C:\Users\... )
  WIN_INSTALL_DIR=$(echo "$INSTALL_DIR" | sed 's|^/\([a-zA-Z]\)/|\1:\\|' | sed 's|/|\\|g')

  powershell.exe -NoProfile -ExecutionPolicy Bypass \
    -File "${WIN_INSTALL_DIR}\\install-service.ps1"

  ok "Servicio BridgeCodigoBarras instalado (si aceptaste la UAC)"
else
  # Linux / macOS — crear servicio systemd
  SERVICE_NAME="bridge-codigobarras"
  SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

  if command -v systemctl &>/dev/null; then
    sudo tee "$SERVICE_FILE" >/dev/null <<EOF
[Unit]
Description=Bridge Código de Barras (Express → SQL Server)
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$INSTALL_DIR
ExecStart=$(which node) $INSTALL_DIR/dist/server.js
Restart=always
RestartSec=3
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF
    sudo systemctl daemon-reload
    sudo systemctl enable --now "$SERVICE_NAME"
    ok "Servicio systemd instalado e iniciado"
  else
    warn "systemd no disponible. Inicia la API manualmente:"
    warn "  cd \"$INSTALL_DIR\" && node dist/server.js &"
  fi
fi

echo ""

# ── 8. Mensaje final ─────────────────────────────────────────

PORT=$(grep ^PORT= .env 2>/dev/null | cut -d= -f2)
PORT=${PORT:-3001}

echo -e "${GREEN}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   ✅ Bridge instalado y ejecutándose                 ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  ${BOLD}Directorio:${NC}  ${CYAN}$INSTALL_DIR${NC}"
echo -e "  ${BOLD}Endpoint:${NC}    ${CYAN}http://localhost:${PORT}/health${NC}"

if [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "cygwin" ]]; then
  echo -e "  ${BOLD}Servicio:${NC}    ${CYAN}BridgeCodigoBarras (services.msc)${NC}"
else
  echo -e "  ${BOLD}Servicio:${NC}    ${CYAN}bridge-codigobarras${NC}"
  echo -e "  ${BOLD}Logs:${NC}        ${CYAN}sudo journalctl -u bridge-codigobarras -f${NC}"
fi
echo ""
