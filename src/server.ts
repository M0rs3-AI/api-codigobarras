import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { config } from './config';
import healthRouter from './routes/health';
import testConnectionRouter from './routes/testConnection';
import queryRouter from './routes/query';

const app = express();

// Detrás de Traefik: necesario para que rate-limit y req.ip vean la IP real.
app.set('trust proxy', config.trustProxyHops);

app.use(helmet());
app.use(express.json({ limit: '1mb' }));

// Rate limiting global: tope general de seguridad
const globalLimiter = rateLimit({
  windowMs: 60_000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, message: 'Demasiadas solicitudes, intenta en un minuto.' },
});

// Rate limiting más estricto para rutas que abren conexión MSSQL
const mssqlLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, message: 'Demasiadas solicitudes a la base de datos, intenta en un minuto.' },
});

app.use('/health', healthRouter);
app.use('/test-connection', globalLimiter, mssqlLimiter, testConnectionRouter);
app.use('/query',           globalLimiter, mssqlLimiter, queryRouter);

app.use((_req, res) => {
  res.status(404).json({ ok: false, message: 'Ruta no encontrada.' });
});

app.listen(config.port, () => {
  console.log(
    `[server] Bizor MSSQL Proxy en :${config.port} (${config.nodeEnv})`,
  );
});

export default app;
