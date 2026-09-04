/**
 * POST /auth/login    { usuario, password } -> { token, expiresAt }
 * GET  /auth/session                        -> revalida sesion y estado
 *
 * Ambas exigen tambien el x-bridge-token: quien no lo tenga no puede ni
 * intentar adivinar contrasenas.
 */
import { Request, Response, Router } from 'express';
import rateLimit from 'express-rate-limit';

import { config } from '../config';
import { verifySession } from '../lib/crypto';
import { InvalidInput, readCredentials } from '../lib/input';
import { requireBridgeToken } from '../middleware/requireBridgeToken';
import { AuthError, assertActive, login } from '../services/auth';

const router = Router();

/**
 * Cubo por (usuario, IP): ni una IP puede recorrer usuarios, ni un atacante
 * repartido entre muchas IPs machacar a uno solo. Los aciertos no cuentan, para
 * que quien acierta a la primera no pague los fallos de otro.
 */
const loginLimiter = rateLimit({
  windowMs: 60_000,
  max: config.auth.loginRatePerMinute,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: (req: Request) => {
    const usuario = String((req.body as { usuario?: unknown } | null)?.usuario ?? '')
      .trim()
      .toLowerCase()
      .slice(0, 64);
    return `${req.ip}|${usuario}`;
  },
  message: { success: false, error: 'too_many_attempts' },
});

router.post('/login', requireBridgeToken, loginLimiter, async (req: Request, res: Response) => {
  if (!config.auth.enabled) {
    res.status(501).json({ success: false, error: 'auth_disabled' });
    return;
  }

  let usuario: string;
  let password: string;
  try {
    ({ usuario, password } = readCredentials(req.body));
  } catch (err) {
    res.status(400).json({ success: false, error: (err as InvalidInput).message });
    return;
  }

  try {
    const result = await login(usuario, password);
    // Nunca se registra la contrasena, ni truncada ni hasheada.
    console.log(`[auth] login OK usuario=${usuario}`);
    res.json({
      success: true,
      token: result.token,
      usuario: result.usuario,
      expiresAt: result.expiresAt,
    });
  } catch (err) {
    if (err instanceof AuthError) {
      if (err.code === 'auth_disabled') {
        res.status(501).json({ success: false, error: err.code });
        return;
      }
      if (err.code === 'credential_unreadable') {
        console.error(`[auth] credencial ilegible usuario=${usuario}: ${err.message}`);
        res.status(500).json({ success: false, error: 'credential_unreadable' });
        return;
      }
      console.warn(`[auth] login FALLIDO usuario=${usuario}`);
      res.status(401).json({ success: false, error: 'invalid_credentials' });
      return;
    }

    // Fallo de base: no se convierte en "credenciales invalidas", porque la app
    // borraria lo guardado por una caida pasajera.
    console.error(`[auth] login EXCEPTION usuario=${usuario}: ${(err as Error).message}`);
    res.status(503).json({ success: false, error: 'auth_unavailable' });
  }
});

/** La app la usa al arrancar, antes de escanear nada. */
router.get('/session', requireBridgeToken, async (req: Request, res: Response) => {
  if (!config.auth.enabled) {
    res.status(501).json({ success: false, error: 'auth_disabled' });
    return;
  }

  const header = req.headers.authorization;
  const value = Array.isArray(header) ? header[0] : header;
  const token = value?.startsWith('Bearer ') ? value.slice(7).trim() : '';

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
    res.json({ success: true, usuario: session.claims.sub, expiresAt: session.claims.exp });
  } catch (err) {
    if (err instanceof AuthError && err.code === 'account_inactive') {
      res.status(403).json({ success: false, error: 'account_inactive' });
      return;
    }
    console.error(`[auth] session check EXCEPTION: ${(err as Error).message}`);
    res.status(503).json({ success: false, error: 'auth_check_unavailable' });
  }
});

export default router;
