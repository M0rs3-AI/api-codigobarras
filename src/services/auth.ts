/**
 * Reglas de autenticacion y de licencia activa.
 *
 * Dos operaciones:
 *   - login(usuario, password) -> token de sesion firmado.
 *   - assertActive(usuario)    -> se ejecuta en CADA consulta; si la cuenta deja
 *                                 de estar activa, la app debe borrar sus
 *                                 credenciales y su clave de activacion.
 */
import {
  burnVerificationTime,
  NotImplemented,
  signSession,
  verifyPassword,
} from '../lib/crypto';
import { config } from '../config';
import { findUserByUsername, isUserActive } from '../repositories/users';

/** Motivos por los que se rechaza. El codigo es el que interpreta la app. */
export type AuthFailure =
  | 'invalid_credentials'
  | 'account_inactive'
  | 'auth_disabled'
  | 'not_implemented';

export class AuthError extends Error {
  constructor(
    public readonly code: AuthFailure,
    message: string,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

/* -------------------------------------------------------------------------- */
/*  Cache de estado activo                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Solo se cachean los SI. Un usuario dado de baja deja de funcionar en la
 * siguiente peticion, sin esperar a que expire nada; lo unico que la cache
 * evita es que una rafaga de escaneos consulte la base una vez por codigo.
 */
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
  // Poda barata: la app de un cliente tiene decenas de usuarios, no miles, pero
  // no dejamos que el mapa crezca sin techo si alguien inventa usuarios.
  if (activeUntil.size > 1000) {
    const now = Date.now();
    for (const [key, value] of activeUntil) if (now >= value) activeUntil.delete(key);
  }
}

/** Invalida la cache de un usuario. Se llama en cuanto la base dice que no. */
export function forgetUser(usuario: string): void {
  activeUntil.delete(usuario);
}

/* -------------------------------------------------------------------------- */
/*  Operaciones                                                                */
/* -------------------------------------------------------------------------- */

export interface LoginResult {
  token: string;
  usuario: string;
  expiresAt: number;
}

/**
 * Valida usuario y contrasena contra la base del cliente.
 *
 * El mensaje de error es el MISMO tanto si el usuario no existe como si la
 * contrasena es incorrecta, y el camino "usuario no existe" quema un tiempo
 * comparable al camino real: de otro modo el endpoint sirve para enumerar que
 * usuarios existen en la empresa del cliente.
 *
 * La cuenta inactiva SI se distingue (403 account_inactive) porque la app tiene
 * que reaccionar borrando credenciales, y para llegar ahi ya hubo que acertar
 * la contrasena: no filtra nada a quien no la sepa.
 */
export async function login(usuario: string, password: string): Promise<LoginResult> {
  if (!config.auth.enabled) {
    throw new AuthError('auth_disabled', 'El login no esta habilitado en este bridge.');
  }

  const user = await findUserByUsername(usuario);

  if (!user) {
    burnVerificationTime();
    throw new AuthError('invalid_credentials', 'Usuario o contrasena incorrectos.');
  }

  let ok: boolean;
  try {
    ok = verifyPassword(password, user.storedSecret);
  } catch (err) {
    if (err instanceof NotImplemented) {
      throw new AuthError('not_implemented', err.message);
    }
    throw err;
  }

  if (!ok) {
    throw new AuthError('invalid_credentials', 'Usuario o contrasena incorrectos.');
  }

  if (!user.activo) {
    forgetUser(user.usuario);
    throw new AuthError('account_inactive', 'La cuenta no esta activa.');
  }

  const { token, claims } = signSession(user.usuario);
  rememberActive(user.usuario);

  return { token, usuario: user.usuario, expiresAt: claims.exp };
}

/**
 * Comprobacion de licencia por peticion. Lanza AuthError('account_inactive') si
 * el usuario ya no esta activo o ya no existe.
 *
 * Un fallo de conexion a la base NO se traduce en "inactivo": eso borraria las
 * credenciales de todos los dispositivos cada vez que el servidor del cliente
 * se reinicia. Se propaga como error para que la ruta responda 503.
 */
export async function assertActive(usuario: string): Promise<void> {
  if (!config.auth.enabled) return;
  if (cachedActive(usuario)) return;

  const activo = await isUserActive(usuario);

  if (activo === null || activo === false) {
    forgetUser(usuario);
    throw new AuthError('account_inactive', 'La cuenta no esta activa.');
  }

  rememberActive(usuario);
}
