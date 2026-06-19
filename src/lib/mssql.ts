import { Connection, Request, TYPES, TediousType } from 'tedious';

export interface MssqlConfig {
  db_ip:       string;
  db_port?:    number;
  db_name:     string;
  db_user:     string;
  db_password: string;
  db_host?:    string | null;
  db_options?: Record<string, unknown> | null;
}

export interface QueryParam {
  name:  string;
  type:  string;
  value: unknown;
}

const TYPE_MAP: Record<string, TediousType> = {
  VarChar:  TYPES.VarChar,
  NVarChar: TYPES.NVarChar,
  Char:     TYPES.Char,
  NChar:    TYPES.NChar,
  Int:      TYPES.Int,
  BigInt:   TYPES.BigInt,
  SmallInt: TYPES.SmallInt,
  TinyInt:  TYPES.TinyInt,
  Decimal:  TYPES.Decimal,
  Numeric:  TYPES.Numeric,
  Float:    TYPES.Float,
  Real:     TYPES.Real,
  Bit:      TYPES.Bit,
  DateTime: TYPES.DateTime,
  Date:     TYPES.Date,
};

function resolveType(typeName: string): TediousType {
  return TYPE_MAP[typeName] ?? TYPES.VarChar;
}

function buildTediousConfig(cfg: MssqlConfig) {
  const extra = (cfg.db_options ?? {}) as Record<string, unknown>;
  return {
    server: cfg.db_ip,
    authentication: {
      type: 'default' as const,
      options: {
        userName: cfg.db_user,
        password: cfg.db_password,
      },
    },
    options: {
      port:                   cfg.db_port ?? 1433,
      database:               cfg.db_name,
      encrypt:                false,
      trustServerCertificate: true,
      connectTimeout:         10_000,
      requestTimeout:         15_000,
      ...(cfg.db_host && cfg.db_host !== cfg.db_ip ? { serverName: cfg.db_host } : {}),
      ...extra,
    },
  };
}

export async function testMssqlConnection(
  cfg: MssqlConfig,
): Promise<{ ok: boolean; latency_ms: number; message: string }> {
  const t0 = Date.now();

  return new Promise((resolve) => {
    const connection = new Connection(buildTediousConfig(cfg));
    let done = false;

    const finish = (ok: boolean, message: string) => {
      if (done) return;
      done = true;
      try { connection.close(); } catch { /* ignore */ }
      resolve({ ok, latency_ms: Date.now() - t0, message });
    };

    connection.on('connect', (err) => {
      if (err) { finish(false, err.message); return; }

      const req = new Request('SELECT 1 AS ping', (err2) => {
        if (err2) finish(false, err2.message);
        else finish(true, 'Conexion exitosa');
      });
      connection.execSql(req);
    });

    connection.on('error', (err) => finish(false, err.message));
    connection.connect();
  });
}

export async function callStoredProcedure(
  cfg: MssqlConfig,
  procedure: string,
  params: QueryParam[],
): Promise<{ rows: Record<string, unknown>[]; rowCount: number }> {
  return new Promise((resolve, reject) => {
    const connection = new Connection(buildTediousConfig(cfg));
    const rows: Record<string, unknown>[] = [];
    let done = false;

    const finish = (err?: Error) => {
      if (done) return;
      done = true;
      try { connection.close(); } catch { /* ignore */ }
      if (err) reject(err);
      else resolve({ rows, rowCount: rows.length });
    };

    connection.on('connect', (err) => {
      if (err) { finish(err); return; }

      const req = new Request(procedure, (err2) => finish(err2 ?? undefined));

      for (const p of params) {
        req.addParameter(p.name, resolveType(p.type), p.value);
      }

      req.on('row', (columns: Array<{ metadata: { colName: string }; value: unknown }>) => {
        const row: Record<string, unknown> = {};
        for (const col of columns) {
          row[col.metadata.colName] = col.value;
        }
        rows.push(row);
      });

      connection.callProcedure(req);
    });

    connection.on('error', (err) => finish(err));
    connection.connect();
  });
}
