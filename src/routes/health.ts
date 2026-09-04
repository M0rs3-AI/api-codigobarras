import { Request, Response, Router } from 'express';

import { config } from '../config';
import { ping } from '../lib/mssql';
import { requireBridgeToken } from '../middleware/requireBridgeToken';

const router = Router();

/**
 * Sonda de vida.
 *
 * Lleva token por defecto: si el bridge queda tras un puerto abierto, quien lo
 * escanee no debe obtener ni un 200. Sin token, todas las rutas responden 401 y
 * el servicio es indistinguible de cualquier otra cosa que no le sirve de nada.
 *
 * `HEALTH_PUBLIC=true` la deja abierta para un monitor externo que no pueda
 * enviar cabeceras. Aun asi solo devuelve {"status":"ok"}: ni version, ni base
 * de datos, ni de que software se trata.
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
