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

/**
 * Ejecuta un stored procedure que recibe UN parametro string (el codigo de
 * barras) y retorna un recordset. Cada llamada abre y cierra su propia
 * conexion, por lo que dos SP pueden ejecutarse en paralelo con Promise.all.
 */
function callProcedure(
  spName: string,
  paramName: string,
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

      const req = new Request(spName, (err2) => finish(err2 ?? undefined));
      req.addParameter(paramName, TYPES.NVarChar, barcode);

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

/** SP principal: informacion del producto por codigo de barras. */
export function callBarcodeProcedure(barcode: string): Promise<Record<string, unknown>[]> {
  return callProcedure(config.spName, config.spParamName, barcode);
}

/**
 * SP de stock por bodega (opcional). Retorna [] si no esta configurado
 * (SP_STOCK_NAME vacio). Cada fila trae { Nombre: bodega, Stock: cantidad }.
 */
export function callStockProcedure(barcode: string): Promise<Record<string, unknown>[]> {
  if (!config.stockSpName) return Promise.resolve([]);
  return callProcedure(config.stockSpName, config.stockSpParamName, barcode);
}
