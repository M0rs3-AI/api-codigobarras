/**
 * Instala el bridge como servicio de Windows usando node-windows.
 *
 * Requisitos previos (ver windows-server.md):
 *   1. npm ci && npm run build   (genera dist\server.js)
 *   2. .env creado con los datos reales
 *   3. npm install node-windows
 *
 * Ejecutar en PowerShell **como Administrador**:
 *   node service-install.js
 *
 * El servicio arranca solo con el servidor y se reinicia si se cae.
 * Se ve en services.msc como "BridgeCodigoBarras".
 */
const path = require('path');
const { Service } = require('node-windows');
require('dotenv/config');

const port = process.env.PORT || 3001;

const svc = new Service({
  name: 'BridgeCodigoBarras',
  description: 'Bridge de codigos de barras (Node/Express) -> SQL Server local',
  // Rutas relativas a este archivo: funciona sin importar dónde esté el repo.
  script: path.join(__dirname, 'dist', 'server.js'),
  workingDirectory: __dirname,
  // Reinicio automático si el proceso se cae.
  wait: 2,
  grow: 0.5,
  maxRestarts: 10,
});

svc.on('install', () => {
  svc.start();
  console.log('Servicio "BridgeCodigoBarras" instalado y arrancado.');
  console.log(`Verifica con:  curl http://localhost:${port}/health`);
});
svc.on('alreadyinstalled', () => {
  console.log('El servicio ya estaba instalado. Reinícialo desde services.msc si actualizaste el código.');
});
svc.on('error', (err) => {
  console.error('Error al instalar el servicio:', err);
});

svc.install();
