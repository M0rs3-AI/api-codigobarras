/**
 * Bridge de codigos de barras.
 *
 * Modelo de exposicion (ver README): la forma recomendada es un tunel saliente
 * (Cloudflare) con BIND_HOST=127.0.0.1, porque asi NO queda ningun puerto
 * abierto hacia internet en el servidor del cliente. Las alternativas son HTTPS
 * directo con certificado propio, y como ultimo recurso HTTP plano.
 */
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';

import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';

import { config, CONFIG_SOURCE } from './config';
import { drain } from './lib/pool';
import authRouter from './routes/auth';
import healthRouter from './routes/health';
import queryRouter from './routes/query';
import searchRouter from './routes/search';

const app = express();

// El bridge nunca sirve HTML ni assets: solo JSON. Se apagan las cabeceras que
// solo aplican a paginas y se deja el resto del endurecimiento de helmet.
app.disable('x-powered-by');
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  }),
);

// Cuerpo minimo: una peticion legitima son unos pocos cientos de bytes.
app.use(express.json({ limit: config.limits.bodyBytes }));

/**
 * Limite por token, no global.
 *
 * Antes el limite era unico para todo el bridge, asi que un dispositivo abusivo
 * dejaba sin servicio al resto de la empresa. Ahora cada token tiene su cuota;
 * las peticiones sin token caen en un cubo comun por IP.
 */
const limiter = rateLimit({
  windowMs: 60_000,
  max: config.limits.ratePerMinute,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const header = req.headers['x-bridge-token'];
    const token = Array.isArray(header) ? header[0] : header;
    return token ? `t:${token}` : `ip:${req.ip}`;
  },
  message: { success: false, error: 'Demasiadas solicitudes, intenta en un minuto.' },
});

app.use('/health', healthRouter);
// Limite propio, mucho mas estrecho (ver routes/auth.ts): un intento de fuerza
// bruta no debe consumir la cuota de escaneo de quien esta trabajando.
app.use('/auth', authRouter);
app.use('/query', limiter, queryRouter);
app.use('/search', limiter, searchRouter);

app.use((_req, res) => {
  res.status(404).json({ success: false, error: 'Ruta no encontrada.' });
});

/**
 * Manejador de errores final.
 *
 * Traduce los fallos de express.json a codigos correctos (un body demasiado
 * grande es 413 y un JSON roto es 400, no un 500 generico) y, sobre todo, evita
 * que un fallo inesperado devuelva el stack trace de Express al cliente.
 */
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const type = (err as { type?: string }).type;

  if (type === 'entity.too.large') {
    res.status(413).json({ success: false, error: 'Cuerpo de la peticion demasiado grande.' });
    return;
  }
  if (type === 'entity.parse.failed') {
    res.status(400).json({ success: false, error: 'Body JSON invalido.' });
    return;
  }

  console.error(`[server] error no manejado: ${err.message}`);
  res.status(500).json({ success: false, error: 'Error interno.' });
});

function createServer() {
  if (!config.tls.enabled) return http.createServer(app);

  if (!config.tls.certPath || !config.tls.keyPath) {
    throw new Error('TLS_ENABLED=true requiere TLS_CERT_PATH y TLS_KEY_PATH.');
  }

  return https.createServer(
    {
      cert: fs.readFileSync(config.tls.certPath),
      key: fs.readFileSync(config.tls.keyPath),
      ca: config.tls.caPath ? fs.readFileSync(config.tls.caPath) : undefined,
      minVersion: 'TLSv1.2',
    },
    app,
  );
}

const server = createServer();

server.listen(config.port, config.bindHost, () => {
  const scheme = config.tls.enabled ? 'https' : 'http';

  console.log(`[server] bridge escuchando en ${scheme}://${config.bindHost}:${config.port} (config: ${CONFIG_SOURCE})`);
  if (!config.tls.enabled && config.bindHost !== '127.0.0.1') {
    console.warn(
      '[server] AVISO: HTTP plano en una interfaz publica. Usa un tunel con ' +
        'BIND_HOST=127.0.0.1, o activa TLS. Ver README.',
    );
  }
});

/** Cierre ordenado: deja de aceptar peticiones y cierra el pool. */
function shutdown(signal: string) {
  console.log(`[server] ${signal} recibido, cerrando...`);
  server.close(() => {
    drain();
    process.exit(0);
  });
  // Si algo se atasca, no dejar el servicio colgado indefinidamente.
  setTimeout(() => process.exit(0), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export default app;
