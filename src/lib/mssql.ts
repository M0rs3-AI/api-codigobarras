import { Connection, Request, TYPES } from 'tedious';
import { config } from '../config';

function buildConnectionConfig() {
  return {
    server: config.sql.server,
    authentication: {
      type: 'default' as const,
      options: {
        userName: config.sql.user,
        password: config.sql.password,
      },
    },
    options: {
      port: config.sql.port,
      database: config.sql.database,
      encrypt: false,
      trustServerCertificate: true,
      connectTimeout: 10_000,
      requestTimeout: 15_000,
    },
  };
}

export async function callBarcodeProcedure(
  barcode: string,
): Promise<Record<string, unknown>[]> {
  return new Promise((resolve, reject) => {
    const connection = new Connection(buildConnectionConfig());
    const rows: Record<string, unknown>[] = [];
    let done = false;

    const finish = (err?: Error) => {
      if (done) return;
      done = true;
      try { connection.close(); } catch { /* ignore */ }
      if (err) reject(err);
      else resolve(rows);
    };

    connection.on('connect', (err) => {
      if (err) { finish(err); return; }

      const req = new Request(config.spName, (err2) => finish(err2 ?? undefined));
      req.addParameter(config.spParamName, TYPES.NVarChar, barcode);

      req.on('row', (columns: Array<{ metadata: { colName: string }; value: unknown }>) => {
        const row: Record<string, unknown> = {};
        for (const col of columns) {
          // Columnas binarias (VARBINARY/IMAGE, p.ej. una foto guardada como
          // bytes) llegan como Buffer. Las enviamos en base64 para que viajen
          // como texto en el JSON y la app las reconstruya como imagen. La
          // conversion ocurre aqui, en el servidor propio del tenant.
          const value = col.value;
          row[col.metadata.colName] = Buffer.isBuffer(value)
            ? value.toString('base64')
            : value;
        }
        rows.push(row);
      });

      connection.callProcedure(req);
    });

    connection.on('error', (err) => finish(err));
    connection.connect();
  });
}
