/**
 * Exige una sesion valida Y que la cuenta siga activa.
 *
 * Se aplica a /query y /search, es decir, a cada escaneo. La comprobacion de
 * "activo" no se hace solo al iniciar sesion: una licencia revocada tiene que
 * cortar el servicio en la siguiente consulta, no cuando caduque el token.
 *
 * El codigo `account_inactive` es el que la app usa para borrar del dispositivo
 * las credenciales y la clave de activacion.
 */
import { NextFunction, Request, Response } from 'express';

import { config } from '../config';
import { verifySession } from '../lib/crypto';
import { AuthError, assertActive } from '../services/auth';

declare module 'express-serve-static-core' {
  interface Request {
    /** Usuario de la sesion. Solo presente cuando AUTH_ENABLED es true. */
    sessionUser?: string;
  }
}

function bearer(req: Request): string | null {
  const header = req.headers.authorization;
  const value = Array.isArray(header) ? header[0] : header;
  if (!value || !value.startsWith('Bearer ')) return null;
  const token = value.slice(7).trim();
  return token.length > 0 ? token : null;
}

export async function requireSession(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  // Bridge sin login habilitado: se mantiene el comportamiento anterior, donde
  // el x-bridge-token era la unica credencial.
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
    // Base caida: no es motivo para desactivar a nadie. 503 y la app reintenta.
    console.error(`[auth] no se pudo verificar el estado: ${(err as Error).message}`);
    res.status(503).json({ success: false, error: 'auth_check_unavailable' });
    return;
  }

  req.sessionUser = session.claims.sub;
  next();
}
