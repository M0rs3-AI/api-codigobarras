import { Request, Response, NextFunction } from 'express';
import { config } from '../config';

export function requireBridgeToken(req: Request, res: Response, next: NextFunction): void {
  const token = req.headers['x-bridge-token'];
  if (!token || token !== config.bridgeToken) {
    res.status(401).json({ success: false, error: 'Token invalido o ausente (header x-bridge-token).' });
    return;
  }
  next();
}
