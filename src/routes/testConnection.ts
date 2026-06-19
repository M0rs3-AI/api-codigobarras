import { Router, Request, Response } from 'express';
import { requireSecret } from '../middleware/requireSecret';
import { testMssqlConnection, MssqlConfig } from '../lib/mssql';

const router = Router();

router.post('/', requireSecret, async (req: Request, res: Response) => {
  const { db_ip, db_port, db_name, db_user, db_password, db_host, db_options } =
    req.body as MssqlConfig;

  if (!db_ip || !db_name || !db_user || !db_password) {
    res.status(400).json({
      ok: false,
      message: 'Faltan campos requeridos: db_ip, db_name, db_user, db_password',
    });
    return;
  }

  // Nunca logueamos el password
  console.log(
    `[test-connection] ip=${db_ip} port=${db_port ?? 1433} db=${db_name} user=${db_user}`,
  );

  try {
    const result = await testMssqlConnection({
      db_ip, db_port, db_name, db_user, db_password, db_host, db_options,
    });
    console.log(`[test-connection] ip=${db_ip} ok=${result.ok} ${result.latency_ms}ms`);
    res.status(result.ok ? 200 : 503).json(result);
  } catch (err) {
    const message = (err as Error).message ?? 'Error desconocido';
    console.error(`[test-connection] ip=${db_ip} EXCEPTION: ${message}`);
    res.status(503).json({ ok: false, latency_ms: 0, message });
  }
});

export default router;
