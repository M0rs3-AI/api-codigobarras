/**
 * Validacion de la entrada. Cada peticion cuesta una consulta a la base del
 * cliente, asi que todo se acota antes de tocar SQL Server.
 */
import { config } from '../config';

export class InvalidInput extends Error {}

/** Quita caracteres de control, que no aportan nada y ensucian los logs. */
function sanitize(value: string): string {
  let out = '';
  for (const char of value) {
    if (char.codePointAt(0)! >= 32 && char.codePointAt(0)! !== 127) out += char;
  }
  return out.trim();
}

export function readBarcode(body: unknown): string {
  const value = (body as { barcode?: unknown } | null)?.barcode;
  if (typeof value !== 'string') {
    throw new InvalidInput('Falta el campo "barcode" en el body.');
  }
  const barcode = sanitize(value);
  if (barcode.length === 0) {
    throw new InvalidInput('El campo "barcode" no puede estar vacio.');
  }
  if (barcode.length > config.limits.maxBarcodeLength) {
    throw new InvalidInput(
      `El campo "barcode" supera ${config.limits.maxBarcodeLength} caracteres.`,
    );
  }
  return barcode;
}

export function readQuery(body: unknown): string {
  const value = (body as { q?: unknown } | null)?.q;
  if (typeof value !== 'string') {
    throw new InvalidInput('Falta el campo "q" en el body.');
  }
  const query = sanitize(value);
  if (query.length < config.limits.minQueryLength) {
    throw new InvalidInput(
      `El termino de busqueda requiere al menos ${config.limits.minQueryLength} caracteres.`,
    );
  }
  if (query.length > config.limits.maxQueryLength) {
    throw new InvalidInput(
      `El termino de busqueda supera ${config.limits.maxQueryLength} caracteres.`,
    );
  }
  return query;
}

/**
 * El limite lo decide el servidor; el cliente solo puede REDUCIRLO. Si no,
 * limit=999999 volcaria el catalogo entero en una peticion.
 */
export function readLimit(body: unknown): number {
  const max = config.limits.maxSearchResults;
  const value = (body as { limit?: unknown } | null)?.limit;
  const requested = typeof value === 'number' ? Math.trunc(value) : NaN;
  if (!Number.isFinite(requested) || requested < 1) return max;
  return Math.min(requested, max);
}

/**
 * Credenciales de login. El usuario se recorta pero no se normaliza: romperia
 * una instalacion con intercalacion sensible a mayusculas.
 */
export interface Credentials {
  usuario: string;
  password: string;
}

export function readCredentials(body: unknown): Credentials {
  const source = body as { usuario?: unknown; password?: unknown } | null;

  if (typeof source?.usuario !== 'string' || typeof source?.password !== 'string') {
    throw new InvalidInput('Se requieren los campos "usuario" y "password".');
  }

  const usuario = sanitize(source.usuario);
  const password = source.password;

  if (usuario.length === 0) {
    throw new InvalidInput('El campo "usuario" no puede estar vacio.');
  }
  if (usuario.length > config.auth.maxUsernameLength) {
    throw new InvalidInput(`El campo "usuario" supera ${config.auth.maxUsernameLength} caracteres.`);
  }
  if (password.length === 0) {
    throw new InvalidInput('El campo "password" no puede estar vacio.');
  }
  if (password.length > config.auth.maxPasswordLength) {
    throw new InvalidInput(`El campo "password" supera ${config.auth.maxPasswordLength} caracteres.`);
  }

  return { usuario, password };
}
