import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { config } from './config';
import healthRouter from './routes/health';
import queryRouter from './routes/query';

const app = express();

app.use(helmet());
app.use(express.json({ limit: '1mb' }));

// Limite de solicitudes a /query, ya que cada una abre una conexion a SQL Server.
const queryLimiter = rateLimit({
  windowMs: 60_000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Demasiadas solicitudes, intenta en un minuto.' },
});

app.use('/health', healthRouter);
app.use('/query', queryLimiter, queryRouter);

app.use((_req, res) => {
  res.status(404).json({ success: false, error: 'Ruta no encontrada.' });
});

app.listen(config.port, () => {
  console.log(`[server] Bridge codigo de barras escuchando en :${config.port} (${config.nodeEnv})`);
});

export default app;
