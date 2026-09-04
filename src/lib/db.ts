/**
 * Capa de acceso a datos tipada (Kysely) para la autenticacion de usuarios.
 *
 * POR QUE UN ORM AQUI Y NO EN /query
 * ----------------------------------
 * Las consultas de producto (/query, /search) llaman a stored procedures que ya
 * existen en la base del cliente: alli no hay SQL que construir, solo parametros
 * que pasar tipados con tedious. Para el login, en cambio, SI hay una consulta
 * que escribir, y escribirla a mano con concatenacion de strings seria abrir
 * exactamente el agujero que no queremos. Kysely la construye siempre
 * parametrizada -no existe la opcion de interpolar un valor en el texto SQL- y
 * ademas obliga a declarar el esquema en TypeScript, asi que un nombre de
 * columna mal escrito falla al compilar y no en produccion.
 *
 * La conexion es SEPARADA del pool de lib/pool.ts a proposito: ese pool esta
 * dimensionado para consultas de catalogo de alta frecuencia, y el login es una
 * operacion rara y lenta que no debe competir por esas conexiones. Este pool se
 * crea perezosamente: si AUTH_ENABLED es false, nunca se abre ni una conexion.
 */
import { Kysely, MssqlDialect } from 'kysely';
import type { MssqlDialectConfig } from 'kysely';
import * as Tarn from 'tarn';
import * as Tedious from 'tedious';

import { config } from '../config';

/* -------------------------------------------------------------------------- */
/*  Esquema                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * PLACEHOLDER — nombres reales pendientes del cliente.
 *
 * Este es el contrato que el bridge espera de la tabla de usuarios. Cuando se
 * conozca la tabla real solo hay que renombrar aqui: el resto del codigo es
 * type-safe contra esta definicion, asi que el compilador senala cada sitio que
 * haya que tocar.
 *
 * Nota sobre `password`: la columna guarda la credencial CIFRADA (asi la
 * describe el cliente). El bridge nunca la registra en logs ni la devuelve en
 * ninguna respuesta; solo la pasa a `verifyPassword` (ver lib/crypto.ts).
 */
export interface UsuariosTable {
  /** Identificador interno. Se usa para trazar en logs sin exponer el usuario. */
  id: string;
  /** Nombre de usuario que se teclea en la app. */
  usuario: string;
  /** Credencial cifrada. NUNCA sale del bridge. */
  password: string;
  /** Estado de la cuenta. La app deja de funcionar en cuanto deja de ser true. */
  activo: boolean;
}

export interface Database {
  /** PLACEHOLDER: sustituir por el nombre real de la tabla o vista. */
  BIZOR_APP_USUARIOS: UsuariosTable;
}

/* -------------------------------------------------------------------------- */
/*  Conexion                                                                   */
/* -------------------------------------------------------------------------- */

let instance: Kysely<Database> | null = null;

function createConnection(): Tedious.Connection {
  return new Tedious.Connection({
    server: config.sql.server,
    authentication: {
      type: 'default',
      options: { userName: config.sql.user, password: config.sql.password },
    },
    options: {
      port: config.sql.port,
      database: config.sql.database,
      encrypt: config.sql.encrypt,
      trustServerCertificate: config.sql.trustServerCertificate,
      connectTimeout: config.sql.connectTimeoutMs,
      requestTimeout: config.sql.requestTimeoutMs,
      camelCaseColumns: false,
      // Kysely gestiona sus propias transacciones sobre esta conexion.
      useColumnNames: false,
    },
  });
}

/**
 * Devuelve la instancia de Kysely, creandola la primera vez que se usa.
 *
 * Pool pequeno (max 2): el login no es una operacion de alta frecuencia y cada
 * conexion abierta contra la base del cliente es superficie que no regalamos.
 */
export function db(): Kysely<Database> {
  if (instance) return instance;

  instance = new Kysely<Database>({
    dialect: new MssqlDialect({
      tarn: {
        ...Tarn,
        options: {
          min: 0,
          max: 2,
          idleTimeoutMillis: config.pool.idleTimeoutMs,
          acquireTimeoutMillis: config.pool.acquireTimeoutMs,
        },
      },
      // Kysely tipa el paquete tedious contra la v18; este proyecto usa la v16,
      // que difiere en detalles irrelevantes para el dialecto (el retorno de
      // `cancel()`, la forma del enum ISOLATION_LEVEL). En vez de subir de major
      // el driver de todo el bridge por esto, el desajuste se cruza aqui, en un
      // unico punto y sin tocar el comportamiento en ejecucion.
      tedious: {
        ...Tedious,
        connectionFactory: createConnection,
      } as unknown as MssqlDialectConfig['tedious'],
    }),
  });

  return instance;
}

/** Cierre ordenado. No hace nada si nunca se llego a abrir el pool. */
export async function closeDb(): Promise<void> {
  if (!instance) return;
  const current = instance;
  instance = null;
  await current.destroy().catch(() => {
    /* ya estaba cerrada */
  });
}
