import { timingSafeEqual } from 'node:crypto';
import { NextFunction, Request, Response } from 'express';

import { config } from '../config';

const expected = Buffer.from(config.bridgeToken, 'utf8');

/**
 * Comparacion en tiempo constante. Con `!==` el tiempo de respuesta depende de
 * cuantos caracteres coinciden, lo que filtra el token byte a byte ante un
 * atacante con suficientes intentos.
 */
function matches(received: string): boolean {
  const actual = Buffer.from(received, 'utf8');
  // timingSafeEqual exige la misma longitud; compararla aparte no filtra nada
  // util porque la longitud del token es publica por diseno.
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

export function requireBridgeToken(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers['x-bridge-token'];
  const token = Array.isArray(header) ? header[0] : header;

  if (!token || !matches(token)) {
    res.status(401).json({ success: false, error: 'Token invalido o ausente (header x-bridge-token).' });
    return;
  }
  next();
}
