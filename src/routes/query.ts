import { Router, Request, Response } from 'express';
import { requireSecret } from '../middleware/requireSecret';
import { callStoredProcedure, MssqlConfig, QueryParam } from '../lib/mssql';

const router = Router();

interface QueryBody extends MssqlConfig {
  procedure: string;
  params:    QueryParam[];
}

router.post('/', requireSecret, async (req: Request, res: Response) => {
  const {
    db_ip, db_port, db_name, db_user, db_password, db_host, db_options,
    procedure, params = [],
  } = req.body as QueryBody;

  if (!db_ip || !db_name || !db_user || !db_password || !procedure) {
    res.status(400).json({
      ok: false,
      message: 'Faltan campos requeridos: db_ip, db_name, db_user, db_password, procedure',
    });
    return;
  }

  // Nunca logueamos el password
  console.log(`[query] ip=${db_ip} db=${db_name} proc=${procedure}`);

  try {
    const result = await callStoredProcedure(
      { db_ip, db_port, db_name, db_user, db_password, db_host, db_options },
      procedure,
      params,
    );
    res.json({ ok: true, data: result.rows, rowCount: result.rowCount });
  } catch (err) {
    const message = (err as Error).message ?? 'Error desconocido';
    console.error(`[query] ip=${db_ip} proc=${procedure} EXCEPTION: ${message}`);
    res.status(503).json({ ok: false, message });
  }
});

export default router;
