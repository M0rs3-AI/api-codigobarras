import { Router, Request, Response } from 'express';
import { requireBridgeToken } from '../middleware/requireBridgeToken';
import { callBarcodeProcedure } from '../lib/mssql';

const router = Router();

router.post('/', requireBridgeToken, async (req: Request, res: Response) => {
  const { barcode } = req.body as { barcode?: string };

  if (!barcode || typeof barcode !== 'string') {
    res.status(400).json({ success: false, error: 'Falta el campo "barcode" en el body.' });
    return;
  }

  try {
    const rows = await callBarcodeProcedure(barcode);

    if (rows.length === 0) {
      res.status(404).json({ success: false, error: 'Codigo de barras no encontrado.' });
      return;
    }

    // El SP debe retornar un solo registro por barcode; si retorna varios,
    // se envian todos como arreglo para no perder informacion.
    const data = rows.length === 1 ? rows[0] : rows;
    res.json({ success: true, data });
  } catch (err) {
    const message = (err as Error).message ?? 'Error desconocido';
    console.error(`[query] barcode=${barcode} EXCEPTION: ${message}`);
    res.status(503).json({ success: false, error: message });
  }
});

export default router;
