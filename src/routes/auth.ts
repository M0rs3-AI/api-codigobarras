/**
 * Login de usuario contra la base del cliente.
 *
 *   POST /auth/login    { usuario, password } -> { token, expiresAt }
 *   GET  /auth/session                        -> revalida sesion + estado activo
 *
 * Ambas exigen ademas el x-bridge-token: el login NO es una puerta abierta a
 * internet, esta detras de la misma credencial que el resto del bridge. Quien
 * no tenga el token del bridge no puede ni intentar adivinar contrasenas.
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
 * Limite propio y mucho mas estrecho que el de las consultas.
 *
 * El cubo es (usuario, IP): asi ni una IP puede recorrer usuarios, ni un
 * atacante repartido entre muchas IPs puede machacar a un mismo usuario. Los
 * logins correctos no cuentan, para que quien acierta a la primera nunca se
 * quede fuera por culpa de los intentos fallidos de otro.
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
    // Nunca se registra la contrasena, ni siquiera truncada o hasheada.
    console.log(`[auth] login OK usuario=${usuario}`);
    res.json({
      success: true,
      token: result.token,
      usuario: result.usuario,
      expiresAt: result.expiresAt,
    });
  } catch (err) {
    if (err instanceof AuthError) {
      if (err.code === 'account_inactive') {
        res.status(403).json({ success: false, error: 'account_inactive' });
        return;
      }
      if (err.code === 'not_implemented' || err.code === 'auth_disabled') {
        console.error(`[auth] ${err.code}: ${err.message}`);
        res.status(501).json({ success: false, error: err.code });
        return;
      }
      console.warn(`[auth] login FALLIDO usuario=${usuario}`);
      res.status(401).json({ success: false, error: 'invalid_credentials' });
      return;
    }

    // Fallo de base: no se convierte en "credenciales invalidas", porque la app
    // borraria las credenciales del dispositivo por una caida pasajera.
    console.error(`[auth] login EXCEPTION usuario=${usuario}: ${(err as Error).message}`);
    res.status(503).json({ success: false, error: 'auth_unavailable' });
  }
});

/**
 * Revalidacion explicita. La app la usa al arrancar para saber, antes de
 * escanear nada, si debe borrar credenciales y volver a pedir activacion.
 */
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
