import { Request, Response, Router } from 'express';

import { InvalidInput, readBarcode } from '../lib/input';
import { callBarcodeProcedure, callStockProcedure } from '../lib/mssql';
import { requireBridgeToken } from '../middleware/requireBridgeToken';
import { requireSession } from '../middleware/requireSession';

const router = Router();

router.post('/', requireBridgeToken, requireSession, async (req: Request, res: Response) => {
  let barcode: string;
  try {
    barcode = readBarcode(req.body);
  } catch (err) {
    res.status(400).json({ success: false, error: (err as InvalidInput).message });
    return;
  }

  try {
    // Ambos SP arrancan a la vez. El de stock es complementario: si falla, no
    // tumba la consulta del producto, solo devuelve stock vacio.
    const productPromise = callBarcodeProcedure(barcode);
    const stockPromise = callStockProcedure(barcode).catch((err) => {
      console.error(`[query] stock SP barcode=${barcode} ERROR: ${(err as Error).message}`);
      return [] as Record<string, unknown>[];
    });

    const rows = await productPromise;

    if (rows.length === 0) {
      // El SP de stock sigue en vuelo; ya lleva su propio catch, asi que no
      // queda un rechazo sin manejar al salir por aqui.
      res.status(404).json({ success: false, error: 'Codigo de barras no encontrado.' });
      return;
    }

    // El SP deberia retornar un solo registro por barcode; si retorna varios,
    // se envian todos para no perder informacion.
    const data = rows.length === 1 ? rows[0] : rows;
    res.json({ success: true, data, stock: await stockPromise });
  } catch (err) {
    const message = (err as Error).message ?? 'Error desconocido';
    console.error(`[query] barcode=${barcode} EXCEPTION: ${message}`);
    res.status(503).json({ success: false, error: message });
  }
});

export default router;
