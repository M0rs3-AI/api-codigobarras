/**
 * Login y comprobacion de licencia activa. `assertActive` corre en CADA
 * consulta: revocar un usuario corta el servicio en su siguiente escaneo.
 */
import { burnVerificationTime, InvalidStoredSecret, signSession, verifyPassword } from '../lib/crypto';
import { config } from '../config';
import { findUserSecret, isUserActive } from '../repositories/users';

export type AuthFailure =
  | 'invalid_credentials'
  | 'account_inactive'
  | 'auth_disabled'
  /** La columna Password no se pudo descifrar: fallo de configuracion. */
  | 'credential_unreadable';

export class AuthError extends Error {
  constructor(
    public readonly code: AuthFailure,
    message: string,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

/** Solo se cachean los SI: una baja surte efecto en la siguiente peticion. */
const activeUntil = new Map<string, number>();

function cachedActive(usuario: string): boolean {
  const until = activeUntil.get(usuario);
  if (until === undefined) return false;
  if (Date.now() >= until) {
    activeUntil.delete(usuario);
    return false;
  }
  return true;
}

function rememberActive(usuario: string): void {
  if (config.auth.statusCacheSeconds <= 0) return;
  activeUntil.set(usuario, Date.now() + config.auth.statusCacheSeconds * 1000);
  if (activeUntil.size > 1000) {
    const now = Date.now();
    for (const [key, value] of activeUntil) if (now >= value) activeUntil.delete(key);
  }
}

export function forgetUser(usuario: string): void {
  activeUntil.delete(usuario);
}

export interface LoginResult {
  token: string;
  usuario: string;
  expiresAt: number;
}

/**
 * Valida contra SEG_USUARIOS. Mismo error y tiempo comparable para los tres
 * casos que un atacante querria distinguir: inexistente, de baja e incorrecta.
 */
export async function login(usuario: string, password: string): Promise<LoginResult> {
  if (!config.auth.enabled) {
    throw new AuthError('auth_disabled', 'El login no esta habilitado en este bridge.');
  }

  const stored = await findUserSecret(usuario);

  if (stored === null) {
    burnVerificationTime();
    throw new AuthError('invalid_credentials', 'Usuario o contrasena incorrectos.');
  }

  let ok: boolean;
  try {
    ok = verifyPassword(password, stored);
  } catch (err) {
    if (err instanceof InvalidStoredSecret) {
      throw new AuthError('credential_unreadable', err.message);
    }
    throw err;
  }

  if (!ok) throw new AuthError('invalid_credentials', 'Usuario o contrasena incorrectos.');

  const { token, claims } = signSession(usuario);
  rememberActive(usuario);

  return { token, usuario, expiresAt: claims.exp };
}

/**
 * Lanza AuthError('account_inactive') si el usuario ya no esta de alta. Un fallo
 * de conexion NO es "inactivo" -borraria las credenciales de toda la tienda en
 * cada reinicio-: se propaga como 503.
 */
export async function assertActive(usuario: string): Promise<void> {
  if (!config.auth.enabled) return;
  if (cachedActive(usuario)) return;

  // false cubre "Anulado = 1" y "ya no existe": para la app significan lo mismo.
  if (!(await isUserActive(usuario))) {
    forgetUser(usuario);
    throw new AuthError('account_inactive', 'La cuenta no esta activa.');
  }

  rememberActive(usuario);
}
