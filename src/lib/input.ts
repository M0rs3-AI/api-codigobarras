/**
 * Validacion de la entrada.
 *
 * El bridge esta expuesto (aunque sea detras de un tunel) y cada peticion cuesta
 * una consulta a la base de datos del cliente. Todo lo que llega se acota antes
 * de tocar SQL Server.
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
 * El limite lo decide el servidor. Lo que manda el cliente solo puede REDUCIRLO,
 * nunca ampliarlo: si no, bastaria con pedir limit=999999 para volcar el
 * catalogo entero de una empresa en una sola peticion.
 */
export function readLimit(body: unknown): number {
  const max = config.limits.maxSearchResults;
  const value = (body as { limit?: unknown } | null)?.limit;
  const requested = typeof value === 'number' ? Math.trunc(value) : NaN;
  if (!Number.isFinite(requested) || requested < 1) return max;
  return Math.min(requested, max);
}
