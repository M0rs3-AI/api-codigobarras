/**
 * Repositorio de usuarios de la app.
 *
 * Las dos consultas son PLACEHOLDER: la tabla y las columnas reales del cliente
 * todavia no estan definidas (ver lib/db.ts). Lo que SI es definitivo es la
 * forma: se construyen con Kysely, que parametriza siempre, y devuelven un tipo
 * cerrado -nunca el registro crudo- para que ninguna columna sensible se
 * escape hacia una respuesta HTTP por descuido.
 */
import { db } from '../lib/db';

/** Lo unico que el resto del bridge necesita saber de un usuario. */
export interface UserRecord {
  id: string;
  usuario: string;
  /** Credencial cifrada. Se pasa a verifyPassword y no se usa para nada mas. */
  storedSecret: string;
  activo: boolean;
}

/**
 * PLACEHOLDER — busqueda del usuario para el login.
 *
 * Cuando llegue el esquema real, cambia el nombre de la tabla y de las columnas
 * en lib/db.ts y esta consulta compila tal cual.
 *
 * Si el cliente prefiere no dar SELECT sobre la tabla (recomendado: ver
 * sql/03-auth-usuarios.sql), sustituye el builder por una llamada al stored
 * procedure, tambien parametrizada:
 *
 *   import { sql } from 'kysely';
 *   const result = await sql<UsuariosTable>`
 *     EXEC dbo.BIZOR_App_Usuario_Login ${usuario}
 *   `.execute(db());
 *
 * En ningun caso se concatena `usuario` dentro del texto SQL.
 */
export async function findUserByUsername(usuario: string): Promise<UserRecord | null> {
  const row = await db()
    .selectFrom('BIZOR_APP_USUARIOS')
    .select(['id', 'usuario', 'password', 'activo'])
    .where('usuario', '=', usuario)
    .executeTakeFirst();

  if (!row) return null;

  return {
    id: String(row.id),
    usuario: String(row.usuario),
    storedSecret: String(row.password),
    activo: Boolean(row.activo),
  };
}

/**
 * PLACEHOLDER — comprobacion de si la cuenta sigue activa.
 *
 * Se consulta en CADA escaneo, asi que deliberadamente NO reutiliza
 * `findUserByUsername`: no tiene por que traer la credencial cifrada a memoria
 * para responder un booleano. Cuanto menos viaje ese dato, mejor.
 *
 * Devuelve null cuando el usuario ya no existe (borrado en la base), que para
 * la app significa lo mismo que inactivo: borrar credenciales y salir.
 */
export async function isUserActive(usuario: string): Promise<boolean | null> {
  const row = await db()
    .selectFrom('BIZOR_APP_USUARIOS')
    .select('activo')
    .where('usuario', '=', usuario)
    .executeTakeFirst();

  if (!row) return null;
  return Boolean(row.activo);
}
