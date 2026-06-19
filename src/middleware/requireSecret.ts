import { Request, Response, NextFunction } from 'express';
import { config } from '../config';

export function requireSecret(req: Request, res: Response, next: NextFunction): void {
  const secret = req.headers['x-internal-secret'];
  if (!secret || secret !== config.internalSecret) {
    res.status(401).json({ ok: false, message: 'Cabecera x-internal-secret inválida o ausente.' });
    return;
  }
  next();
}
