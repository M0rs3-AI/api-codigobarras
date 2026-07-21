import { Router, Request, Response } from 'express';
import { requireBridgeToken } from '../middleware/requireBridgeToken';
import { callBarcodeProcedure, callStockProcedure } from '../lib/mssql';

const router = Router();

router.post('/', requireBridgeToken, async (req: Request, res: Response) => {
  const { barcode } = req.body as { barcode?: string };

  if (!barcode || typeof barcode !== 'string') {
    res.status(400).json({ success: false, error: 'Falta el campo "barcode" en el body.' });
    return;
  }

  try {
    // Ambos SP arrancan a la vez (mismo barcode). El de stock es complementario:
    // si falla, NO tumbamos la consulta del producto — solo devolvemos stock: [].
    const productPromise = callBarcodeProcedure(barcode);
    const stockPromise = callStockProcedure(barcode).catch((err) => {
      console.error(`[query] stock SP barcode=${barcode} ERROR: ${(err as Error).message}`);
      return [] as Record<string, unknown>[];
    });

    const rows = await productPromise;

    if (rows.length === 0) {
      res.status(404).json({ success: false, error: 'Codigo de barras no encontrado.' });
      return;
    }

    // El SP debe retornar un solo registro por barcode; si retorna varios,
    // se envian todos como arreglo para no perder informacion.
    const data = rows.length === 1 ? rows[0] : rows;
    const stock = await stockPromise;
    res.json({ success: true, data, stock });
  } catch (err) {
    const message = (err as Error).message ?? 'Error desconocido';
    console.error(`[query] barcode=${barcode} EXCEPTION: ${message}`);
    res.status(503).json({ success: false, error: message });
  }
});

export default router;
