/**
 * Usuarios del ERP (SEG_USUARIOS).
 *
 * Solo stored procedures: el usuario de SQL del bridge tiene DENY SELECT sobre
 * todo el esquema y unicamente GRANT EXECUTE sobre estos. El codigo de usuario
 * viaja como parametro tipado, nunca concatenado.
 */
import { callProcedurePositional } from '../lib/mssql';
import { config } from '../config';

/**
 * Contrasena cifrada del usuario, o null si el SP no devuelve fila.
 *
 * El SP del ERP filtra por `Anulado = 0`, asi que "sin fila" cubre dos casos
 * indistinguibles desde aqui: no existe, o esta dado de baja. Ambos acaban en
 * el mismo 401 generico, que ademas evita que el endpoint sirva para averiguar
 * que usuarios hay en la empresa.
 */
export async function findUserSecret(usuario: string): Promise<string | Buffer | null> {
  const rows = await callProcedurePositional(config.auth.loginSpName, usuario);
  const stored = rows[0]?.Password;
  if (stored == null) return null;
  return Buffer.isBuffer(stored) ? stored : String(stored);
}

/**
 * Si el usuario sigue de alta. Se consulta en cada escaneo.
 *
 * Con AUTH_SP_STATUS_NAME se usa un SP ligero que no arrastra la contrasena
 * cifrada; sin el se reutiliza el de login, que ya filtra por Anulado.
 */
export async function isUserActive(usuario: string): Promise<boolean> {
  const spName = config.auth.statusSpName ?? config.auth.loginSpName;
  const rows = await callProcedurePositional(spName, usuario);
  return rows.length > 0;
}
