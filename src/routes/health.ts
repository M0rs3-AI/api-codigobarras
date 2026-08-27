import { Request, Response, Router } from 'express';

import { ping } from '../lib/mssql';
import { requireBridgeToken } from '../middleware/requireBridgeToken';

const router = Router();

/**
 * Sonda publica. Deliberadamente muda: no revela version, base de datos ni de
 * que software se trata. Quien escanee el puerto solo ve que algo responde.
 */
router.get('/', (_req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

/**
 * Sonda profunda: comprueba de verdad la conexion a SQL Server. Lleva token
 * porque su respuesta si revela el estado interno del servidor del cliente.
 */
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
