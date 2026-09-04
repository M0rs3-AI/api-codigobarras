/**
 * Configuracion del bridge.
 *
 * Origen de los valores, en orden de prioridad:
 *   1. Configuracion EMBEBIDA en el binario (build por cliente). Ver build.mjs.
 *   2. Variables de entorno / archivo .env (modo desarrollo y compatibilidad
 *      con instalaciones antiguas).
 *
 * Con el binario por cliente ya no hace falta repartir el codigo fuente ni un
 * .env suelto junto al ejecutable.
 */
import 'dotenv/config';

/**
 * Lee la configuracion incrustada cuando el proceso corre como Single
 * Executable Application. Fuera de un binario SEA devuelve null y se cae a las
 * variables de entorno.
 */
function embeddedConfig(): Record<string, string> | null {
  try {
    // require dinamico: node:sea no existe en versiones antiguas de Node.
    const sea = require('node:sea') as {
      isSea(): boolean;
      getAsset(key: string, encoding: string): string;
    };
    if (!sea.isSea()) return null;
    return JSON.parse(sea.getAsset('config.json', 'utf8')) as Record<string, string>;
  } catch {
    return null;
  }
}

/**
 * Modo bundle: un unico .cjs mas un JSON de configuracion al lado, para
 * servidores Linux cuando el binario se compila desde Windows (SEA no permite
 * compilacion cruzada). Ver build.mjs.
 */
function fileConfig(): Record<string, string> | null {
  const configPath = process.env.BRIDGE_CONFIG;
  if (!configPath) return null;
  try {
    return JSON.parse(require('node:fs').readFileSync(configPath, 'utf8')) as Record<string, string>;
  } catch (err) {
    throw new Error(
      `No se pudo leer BRIDGE_CONFIG=${configPath}: ${(err as Error).message}`,
    );
  }
}

const sealed = embeddedConfig();
const embedded = sealed ?? fileConfig();

export const IS_PACKAGED = embedded !== null;

/** De donde salio la configuracion. Util para diagnosticar una instalacion. */
export const CONFIG_SOURCE = sealed ? 'binario' : embedded ? 'bundle' : 'entorno';

function raw(name: string): string | undefined {
  const value = embedded?.[name] ?? process.env[name];
  return value !== undefined && value !== '' ? value : undefined;
}

function required(name: string): string {
  const value = raw(name);
  if (!value) {
    throw new Error(
      IS_PACKAGED
        ? `Falta ${name} en la configuracion incrustada. Regenera el binario.`
        : `Falta la variable de entorno ${name}. Revisa tu archivo .env.`,
    );
  }
  return value;
}

function optional(name: string): string | null {
  return raw(name) ?? null;
}

function number(name: string, fallback: number): number {
  const value = raw(name);
  const parsed = value ? Number.parseInt(value, 10) : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Nombre de stored procedure. Un identificador no puede viajar como parametro,
 * tiene que ir en el texto de la consulta; estos salen de la configuracion
 * incrustada, no de una peticion HTTP. Se valida igualmente para que una
 * configuracion mal escrita falle al arrancar y no en produccion.
 */
function procedureName(name: string, fallback: string): string {
  const value = raw(name) ?? fallback;

  if (!/^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+){0,2}$/.test(value)) {
    throw new Error(
      `${name}="${value}" no es un nombre de procedimiento valido. ` +
        'Formato esperado: nombre, esquema.nombre o base.esquema.nombre.',
    );
  }

  return value;
}

function boolean(name: string, fallback: boolean): boolean {
  const value = raw(name)?.toLowerCase();
  if (value === undefined) return fallback;
  return value === '1' || value === 'true' || value === 'yes' || value === 'si';
}

/**
 * Interfaz de escucha. Con tunel (Cloudflare) lo correcto es 127.0.0.1: el
 * bridge deja de ser alcanzable desde la red y solo el tunel llega a el, que es
 * justamente lo que elimina el puerto expuesto a internet.
 */
const bindHost = optional('BIND_HOST') ?? '0.0.0.0';

export const config = {
  bridgeToken: required('BRIDGE_TOKEN'),
  port: number('PORT', 3001),
  bindHost,
  nodeEnv: optional('NODE_ENV') ?? 'production',

  /**
   * Deja GET /health sin token. Por defecto false: si el bridge queda tras un
   * puerto abierto, un escaneo no debe obtener ni un 200.
   */
  healthPublic: boolean('HEALTH_PUBLIC', false),

  sql: {
    server: required('SQL_SERVER'),
    port: number('SQL_PORT', 1433),
    database: required('SQL_DATABASE'),
    user: required('SQL_USER'),
    password: required('SQL_PASSWORD'),
    /**
     * TLS hacia SQL Server. Por defecto activo: el trafico de precios no deberia
     * ir en claro ni dentro de la red del cliente. Se puede desactivar para
     * instancias antiguas que no lo soporten.
     */
    encrypt: boolean('SQL_ENCRYPT', true),
    trustServerCertificate: boolean('SQL_TRUST_CERT', true),
    connectTimeoutMs: number('SQL_CONNECT_TIMEOUT_MS', 10_000),
    requestTimeoutMs: number('SQL_REQUEST_TIMEOUT_MS', 15_000),
  },

  /** Pool de conexiones: evita el handshake TCP + login en cada escaneo. */
  pool: {
    max: number('SQL_POOL_MAX', 4),
    idleTimeoutMs: number('SQL_POOL_IDLE_MS', 60_000),
    maxLifetimeMs: number('SQL_POOL_LIFETIME_MS', 900_000),
    acquireTimeoutMs: number('SQL_POOL_ACQUIRE_TIMEOUT_MS', 12_000),
  },

  /** SP principal: producto por codigo de barras. */
  spName: required('SP_NAME'),
  spParamName: optional('SP_PARAM_NAME') ?? 'barcode',

  /** SP opcional de stock por bodega. Vacio = el tenant no lo usa. */
  stockSpName: optional('SP_STOCK_NAME'),
  stockSpParamName: optional('SP_STOCK_PARAM_NAME') ?? 'CodigoBarra',

  /** SP opcional de busqueda por texto. Vacio = /search responde 501. */
  searchSpName: optional('SP_SEARCH_NAME'),
  searchSpParamName: optional('SP_SEARCH_PARAM_NAME') ?? 'q',
  searchSpLimitParamName: optional('SP_SEARCH_LIMIT_PARAM_NAME') ?? 'top',

  /**
   * Login contra SEG_USUARIOS. Desactivado salvo que el cliente lo pida
   * explicitamente en su JSON.
   *
   * El mismo bridge sirve a apps con login y sin el. Activarlo por defecto
   * significaria que empaquetar el bridge de un cliente cuya app no tiene
   * pantalla de login lo deja con 401 en cada escaneo y sin forma de entrar.
   */
  auth: {
    enabled: boolean('AUTH_ENABLED', false),

    /** SP de la contrasena cifrada. El del ERP ya filtra por Anulado = 0. */
    loginSpName: procedureName('AUTH_SP_LOGIN_NAME', 'dbo.SEG_Usuarios_Select_Password'),

    /** SP ligero de "sigue de alta". Vacio = se reutiliza el de login. */
    statusSpName: optional('AUTH_SP_STATUS_NAME')
      ? procedureName('AUTH_SP_STATUS_NAME', '')
      : null,

    /** Pagina de codigos de la columna Password. Ver lib/crypto.ts. */
    passwordEncoding: (optional('AUTH_PASSWORD_ENCODING') ?? 'cp1252') as 'cp1252' | 'latin1',

    /** Sin valor se deriva del BRIDGE_TOKEN por HKDF (lib/crypto.ts). */
    secret: optional('AUTH_SECRET'),
    sessionTtlMinutes: number('AUTH_SESSION_TTL_MINUTES', 720),

    /**
     * Segundos que se reutiliza un "activo" ya comprobado; 0 = consultar
     * siempre. Solo evita que una rafaga de escaneos golpee la base una vez por
     * codigo. Los negativos nunca se cachean: la baja es inmediata.
     */
    statusCacheSeconds: number('AUTH_STATUS_CACHE_SECONDS', 15),
    loginRatePerMinute: number('AUTH_LOGIN_RATE_PER_MINUTE', 10),
    /** 15 = ancho de SEG_USUARIOS.Codigo. */
    maxUsernameLength: number('AUTH_MAX_USERNAME_LENGTH', 15),
    maxPasswordLength: number('AUTH_MAX_PASSWORD_LENGTH', 128),
  },

  limits: {
    /** Topes de entrada. El cliente no decide cuanto trabajo pedirle a la BD. */
    maxBarcodeLength: number('MAX_BARCODE_LENGTH', 64),
    maxQueryLength: number('MAX_QUERY_LENGTH', 100),
    minQueryLength: number('MIN_QUERY_LENGTH', 3),
    maxSearchResults: number('MAX_SEARCH_RESULTS', 25),
    /** Peticiones por minuto y por token. */
    ratePerMinute: number('RATE_LIMIT_PER_MINUTE', 120),
    bodyBytes: number('MAX_BODY_BYTES', 4096),
  },

  tls: {
    /** HTTPS directo. Alternativa al tunel para clientes con dominio propio. */
    enabled: boolean('TLS_ENABLED', false),
    certPath: optional('TLS_CERT_PATH'),
    keyPath: optional('TLS_KEY_PATH'),
    /** Cadena intermedia, si el emisor la entrega aparte. */
    caPath: optional('TLS_CA_PATH'),
  },
} as const;

export type Config = typeof config;
