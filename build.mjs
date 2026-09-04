/**
 * Empaquetado del bridge.
 *
 * Produce UN solo archivo por cliente con su configuracion dentro. Reemplaza al
 * instalador anterior, que clonaba el repositorio completo en el servidor del
 * cliente: eso obligaba a repartir el codigo fuente, dejaba un .env suelto junto
 * a el y exigia Node, Git y npm en la maquina del cliente.
 *
 * Uso:
 *   node build.mjs --config clientes/acme.json            binario nativo
 *   node build.mjs --config clientes/acme.json --bundle   solo el .cjs
 *
 * El binario (SEA) NO se puede compilar de forma cruzada: el ejecutable de
 * Windows se genera en Windows y el de Linux en Linux, porque se inyecta el
 * blob dentro del propio binario de Node de la maquina que compila. Para el
 * cliente que corre Linux teniendo tu un Windows, usa --bundle: produce un
 * unico .cjs que solo necesita Node instalado.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as esbuild from 'esbuild';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(ROOT, 'build');

/** Claves que deben venir en el JSON del cliente. */
const REQUIRED = ['BRIDGE_TOKEN', 'SQL_SERVER', 'SQL_DATABASE', 'SQL_USER', 'SQL_PASSWORD', 'SP_NAME'];

function parseArgs(argv) {
  const args = { config: null, bundle: false, name: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--config') args.config = argv[++i];
    else if (argv[i] === '--bundle') args.bundle = true;
    else if (argv[i] === '--name') args.name = argv[++i];
  }
  return args;
}

/** Lee la configuracion del cliente desde JSON, o desde .env como respaldo. */
function loadConfig(configPath) {
  if (configPath) {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  }
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) {
    throw new Error('Pasa --config <archivo.json> o crea un .env en la raiz.');
  }
  const config = {};
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    config[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return config;
}

function validate(config) {
  const missing = REQUIRED.filter((key) => !config[key]);
  if (missing.length > 0) {
    throw new Error(`Faltan claves en la configuracion del cliente: ${missing.join(', ')}`);
  }
  if (String(config.BRIDGE_TOKEN).length < 24) {
    throw new Error('BRIDGE_TOKEN debe tener al menos 24 caracteres. Genera uno con: node build.mjs --token');
  }
}

async function bundle() {
  fs.mkdirSync(OUT, { recursive: true });
  const outfile = path.join(OUT, 'bundle.cjs');

  await esbuild.build({
    entryPoints: [path.join(ROOT, 'src', 'server.ts')],
    outfile,
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    // Sin sourcemap y minificado: el cliente recibe un artefacto, no el codigo.
    minify: true,
    sourcemap: false,
    legalComments: 'none',
    // node:sea se resuelve en tiempo de ejecucion dentro del binario.
    external: ['node:sea'],
    banner: {
      js: '/* Bridge Codigo de Barras. Software propietario. */',
    },
  });

  return outfile;
}

function packageBinary(bundlePath, config, name) {
  const isWindows = process.platform === 'win32';
  const target = path.join(OUT, isWindows ? `${name}.exe` : name);
  const seaConfigPath = path.join(OUT, 'sea-config.json');
  const blobPath = path.join(OUT, 'sea-prep.blob');
  const assetPath = path.join(OUT, 'config.json');

  fs.writeFileSync(assetPath, JSON.stringify(config));
  fs.writeFileSync(
    seaConfigPath,
    JSON.stringify({
      main: bundlePath,
      output: blobPath,
      disableExperimentalSEAWarning: true,
      // La configuracion del cliente viaja como asset dentro del ejecutable.
      assets: { 'config.json': assetPath },
    }),
  );

  execFileSync(process.execPath, ['--experimental-sea-config', seaConfigPath], { stdio: 'inherit' });

  fs.copyFileSync(process.execPath, target);

  const postject = path.join(ROOT, 'node_modules', 'postject', 'dist', 'cli.js');
  const args = [
    postject,
    target,
    'NODE_SEA_BLOB',
    blobPath,
    '--sentinel-fuse',
    'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
  ];
  if (process.platform === 'darwin') args.push('--macho-segment-name', 'NODE_SEA');

  execFileSync(process.execPath, args, { stdio: 'inherit' });

  // El asset con las credenciales ya vive dentro del binario; dejarlo suelto en
  // build/ seria filtrarlo por descuido al copiar la carpeta.
  fs.rmSync(assetPath, { force: true });
  fs.rmSync(blobPath, { force: true });
  fs.rmSync(seaConfigPath, { force: true });

  return target;
}

async function main() {
  const argv = process.argv.slice(2);

  if (argv.includes('--token')) {
    const { randomBytes } = await import('node:crypto');
    console.log(randomBytes(32).toString('base64url'));
    return;
  }

  const args = parseArgs(argv);
  const config = loadConfig(args.config);
  validate(config);

  const name =
    args.name ??
    (args.config ? path.basename(args.config, path.extname(args.config)) : 'bridge');

  console.log(`> Empaquetando "${name}" (${os.platform()}/${os.arch()})`);

  // Activar el login contra una app que no tiene pantalla de login deja al
  // cliente con 401 en cada escaneo. Mejor verlo aqui que en la tienda.
  if (String(config.AUTH_ENABLED ?? 'false').toLowerCase() === 'true') {
    console.log('  login de usuario: ACTIVO. La app de este cliente DEBE tener');
    console.log('                    pantalla de login (usuario y contrasena).');
  } else {
    console.log('  login de usuario: desactivado');
  }

  const bundlePath = await bundle();
  console.log(`  bundle: ${path.relative(ROOT, bundlePath)} (${(fs.statSync(bundlePath).size / 1024).toFixed(0)} KB)`);

  if (args.bundle) {
    // Modo bundle: la configuracion no puede ir dentro de un .cjs, asi que se
    // emite al lado. Es el modo para servidores Linux compilando desde Windows.
    const configOut = path.join(OUT, `${name}.env.json`);
    fs.writeFileSync(configOut, JSON.stringify(config, null, 2));
    console.log(`  config: ${path.relative(ROOT, configOut)}`);
    console.log('\nDespliegue: copia bundle.cjs y el .env.json al servidor y arranca con');
    console.log(`  BRIDGE_CONFIG=${name}.env.json node bundle.cjs`);
    return;
  }

  const binary = packageBinary(bundlePath, config, name);
  fs.rmSync(bundlePath, { force: true });
  console.log(`\nListo: ${path.relative(ROOT, binary)} (${(fs.statSync(binary).size / 1024 / 1024).toFixed(1)} MB)`);
  console.log('Un solo archivo. No requiere Node, ni npm, ni .env en el servidor del cliente.');
}

main().catch((err) => {
  console.error(`\nError: ${err.message}`);
  process.exit(1);
});
