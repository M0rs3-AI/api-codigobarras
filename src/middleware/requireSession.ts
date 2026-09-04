/**
 * Exige sesion valida Y cuenta de alta. Se aplica a cada escaneo.
 *
 * `account_inactive` es el codigo con el que la app borra del dispositivo las
 * credenciales y la clave de activacion.
 */
import { NextFunction, Request, Response } from 'express';

import { config } from '../config';
import { verifySession } from '../lib/crypto';
import { AuthError, assertActive } from '../services/auth';

declare module 'express-serve-static-core' {
  interface Request {
    sessionUser?: string;
  }
}

function bearer(req: Request): string | null {
  const header = req.headers.authorization;
  const value = Array.isArray(header) ? header[0] : header;
  if (!value?.startsWith('Bearer ')) return null;
  const token = value.slice(7).trim();
  return token.length > 0 ? token : null;
}

export async function requireSession(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  // Sin login habilitado, el x-bridge-token sigue siendo la unica credencial.
  if (!config.auth.enabled) {
    next();
    return;
  }

  const token = bearer(req);
  if (!token) {
    res.status(401).json({ success: false, error: 'session_missing' });
    return;
  }

  const session = verifySession(token);
  if (!session.ok) {
    res.status(401).json({
      success: false,
      error: session.reason === 'expired' ? 'session_expired' : 'session_invalid',
    });
    return;
  }

  try {
    await assertActive(session.claims.sub);
  } catch (err) {
    if (err instanceof AuthError && err.code === 'account_inactive') {
      res.status(403).json({ success: false, error: 'account_inactive' });
      return;
    }
    // Base caida: no es motivo para desactivar a nadie.
    console.error(`[auth] no se pudo verificar el estado: ${(err as Error).message}`);
    res.status(503).json({ success: false, error: 'auth_check_unavailable' });
    return;
  }

  req.sessionUser = session.claims.sub;
  next();
}
