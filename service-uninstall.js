/**
 * Desinstala el servicio de Windows "BridgeCodigoBarras".
 *
 * Ejecutar en PowerShell **como Administrador**:
 *   node service-uninstall.js
 *
 * No borra el código ni el .env; solo quita el servicio.
 */
const path = require('path');
const { Service } = require('node-windows');

const svc = new Service({
  name: 'BridgeCodigoBarras',
  script: path.join(__dirname, 'dist', 'server.js'),
  workingDirectory: __dirname,
});

svc.on('uninstall', () => {
  console.log('Servicio "BridgeCodigoBarras" desinstalado.');
});
svc.on('error', (err) => {
  console.error('Error al desinstalar el servicio:', err);
});

svc.uninstall();
