/**
 * Usuarios del ERP (SEG_USUARIOS). Solo por stored procedure: el usuario de SQL
 * del bridge tiene DENY SELECT sobre todo el esquema.
 */
import { callProcedurePositional } from '../lib/mssql';
import { config } from '../config';

/**
 * Contrasena cifrada, o null si el SP no devuelve fila. El SP filtra por
 * `Anulado = 0`, asi que "sin fila" es a la vez inexistente y dado de baja:
 * ambos acaban en el mismo 401 generico.
 */
export async function findUserSecret(usuario: string): Promise<string | Buffer | null> {
  const rows = await callProcedurePositional(config.auth.loginSpName, usuario);
  const stored = rows[0]?.Password;
  if (stored == null) return null;
  return Buffer.isBuffer(stored) ? stored : String(stored);
}

/** Si el usuario sigue de alta. Se consulta en cada escaneo. */
export async function isUserActive(usuario: string): Promise<boolean> {
  const spName = config.auth.statusSpName ?? config.auth.loginSpName;
  const rows = await callProcedurePositional(spName, usuario);
  return rows.length > 0;
}
