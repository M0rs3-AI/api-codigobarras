import { Request, Response, Router } from 'express';

import { config } from '../config';
import { ping } from '../lib/mssql';
import { requireBridgeToken } from '../middleware/requireBridgeToken';

const router = Router();

/**
 * Sonda de vida. Con token por defecto: quien escanee el puerto no debe obtener
 * ni un 200. HEALTH_PUBLIC=true la abre para un monitor externo.
 */
router.get('/', config.healthPublic ? [] : [requireBridgeToken], (_req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

/** Sonda profunda: comprueba la conexion real a SQL Server. Siempre con token. */
router.get('/deep', requireBridgeToken, async (_req: Request, res: Response) => {
  try {
    await ping();
    res.json({ status: 'ok', database: 'ok' });
  } catch (err) {
    res
      .status(503)
      .json({ status: 'degraded', database: 'unreachable', error: (err as Error).message });
  }
});

export default router;
