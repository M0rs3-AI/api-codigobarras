/**
 * Pool minimo de conexiones sobre tedious.
 *
 * Regla de oro: una conexion que fallo NUNCA vuelve al pool. Ante la duda se
 * destruye; una conexion en estado dudoso es peor que reconectar.
 */
import { Connection } from 'tedious';

import { config } from '../config';

interface Entry {
  connection: Connection;
  createdAt: number;
  idleSince: number;
  /** Marca de descarte: la conexion se cierra al liberarla. */
  broken: boolean;
}

type Waiter = {
  resolve: (entry: Entry) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

const idle: Entry[] = [];
const waiting: Waiter[] = [];
let total = 0;
let sweeper: NodeJS.Timeout | null = null;

function connectionConfig() {
  return {
    server: config.sql.server,
    authentication: {
      type: 'default' as const,
      options: { userName: config.sql.user, password: config.sql.password },
    },
    options: {
      port: config.sql.port,
      database: config.sql.database,
      encrypt: config.sql.encrypt,
      trustServerCertificate: config.sql.trustServerCertificate,
      connectTimeout: config.sql.connectTimeoutMs,
      requestTimeout: config.sql.requestTimeoutMs,
      // Sin esto, tedious emite los numeros DECIMAL/NUMERIC como string.
      camelCaseColumns: false,
    },
  };
}

function destroy(entry: Entry) {
  entry.broken = true;
  total -= 1;
  try {
    entry.connection.close();
  } catch {
    /* ya estaba cerrada */
  }
}

function create(): Promise<Entry> {
  return new Promise((resolve, reject) => {
    const connection = new Connection(connectionConfig());
    const entry: Entry = { connection, createdAt: Date.now(), idleSince: Date.now(), broken: false };
    let settled = false;

    connection.on('connect', (err) => {
      if (settled) return;
      settled = true;
      if (err) {
        try {
          connection.close();
        } catch {
          /* ignore */
        }
        reject(err);
        return;
      }
      total += 1;
      resolve(entry);
    });

    // Un error despues de conectar invalida la conexion para siempre. Se marca
    // y quien la tenga la descartara al liberarla.
    connection.on('error', () => {
      entry.broken = true;
    });
    connection.on('end', () => {
      entry.broken = true;
    });

    connection.connect();
  });
}

function expired(entry: Entry): boolean {
  return entry.broken || Date.now() - entry.createdAt > config.pool.maxLifetimeMs;
}

/** Cierra conexiones ociosas que sobraron. Evita dejar sesiones abiertas. */
function sweep() {
  const now = Date.now();
  for (let i = idle.length - 1; i >= 0; i -= 1) {
    const entry = idle[i];
    if (expired(entry) || now - entry.idleSince > config.pool.idleTimeoutMs) {
      idle.splice(i, 1);
      destroy(entry);
    }
  }
  if (idle.length === 0 && total === 0 && sweeper) {
    clearInterval(sweeper);
    sweeper = null;
  }
}

function ensureSweeper() {
  if (sweeper) return;
  sweeper = setInterval(sweep, 30_000);
  // No mantiene vivo el proceso solo por el barrido.
  sweeper.unref?.();
}

export async function acquire(): Promise<Entry> {
  ensureSweeper();

  while (idle.length > 0) {
    const entry = idle.pop()!;
    if (expired(entry)) {
      destroy(entry);
      continue;
    }
    return entry;
  }

  if (total < config.pool.max) return create();

  // Pool lleno: esperar a que alguien libere, con tope de tiempo para que una
  // consulta atascada no encole peticiones indefinidamente.
  return new Promise<Entry>((resolve, reject) => {
    const timer = setTimeout(() => {
      const index = waiting.findIndex((w) => w.timer === timer);
      if (index >= 0) waiting.splice(index, 1);
      reject(new Error('Todas las conexiones a SQL Server estan ocupadas.'));
    }, config.pool.acquireTimeoutMs);
    waiting.push({ resolve, reject, timer });
  });
}

export function release(entry: Entry, failed: boolean) {
  if (failed || expired(entry)) {
    destroy(entry);
    // Un hueco libre puede desbloquear a quien espera: se le crea una conexion.
    const waiter = waiting.shift();
    if (waiter) {
      clearTimeout(waiter.timer);
      create().then(waiter.resolve, waiter.reject);
    }
    return;
  }

  entry.idleSince = Date.now();

  const waiter = waiting.shift();
  if (waiter) {
    clearTimeout(waiter.timer);
    waiter.resolve(entry);
    return;
  }

  idle.push(entry);
}

/** Cierre ordenado al apagar el servicio. */
export function drain() {
  if (sweeper) {
    clearInterval(sweeper);
    sweeper = null;
  }
  while (idle.length > 0) destroy(idle.pop()!);
}

export type PoolEntry = Entry;
