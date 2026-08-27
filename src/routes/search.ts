/**
 * Busqueda por texto: codigo interno, nombre o codigo de barras.
 * Contrato en docs/02-contrato-datos.md seccion 2.5 del repo de la app.
 */
import { Request, Response, Router } from 'express';

import { config } from '../config';
import { InvalidInput, readLimit, readQuery } from '../lib/input';
import { callSearchProcedure } from '../lib/mssql';
import { requireBridgeToken } from '../middleware/requireBridgeToken';

const router = Router();

router.post('/', requireBridgeToken, async (req: Request, res: Response) => {
  // Sin SP configurado la busqueda no existe para este cliente. Es 501 y no 503:
  // no hay nada roto, la funcion no esta habilitada. La app lo distingue para
  // ocultar la busqueda por texto en vez de mostrar un error.
  if (!config.searchSpName) {
    res.status(501).json({ success: false, error: 'search_not_configured' });
    return;
  }

  let query: string;
  let limit: number;
  try {
    query = readQuery(req.body);
    limit = readLimit(req.body);
  } catch (err) {
    res.status(400).json({ success: false, error: (err as InvalidInput).message });
    return;
  }

  try {
    const rows = await callSearchProcedure(query, limit);
    res.json({ success: true, data: rows });
  } catch (err) {
    const message = (err as Error).message ?? 'Error desconocido';
    console.error(`[search] q="${query}" EXCEPTION: ${message}`);
    res.status(503).json({ success: false, error: message });
  }
});

export default router;
