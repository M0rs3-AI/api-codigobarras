import 'dotenv/config';

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Falta la variable de entorno ${name}. Revisa tu archivo .env.`);
  }
  return value;
}

export const config = {
  bridgeToken: required('BRIDGE_TOKEN'),
  port: parseInt(process.env.PORT ?? '3001', 10),
  nodeEnv: process.env.NODE_ENV ?? 'production',
  sql: {
    server: required('SQL_SERVER'),
    port: parseInt(process.env.SQL_PORT ?? '1433', 10),
    database: required('SQL_DATABASE'),
    user: required('SQL_USER'),
    password: required('SQL_PASSWORD'),
  },
  spName: required('SP_NAME'),
  spParamName: process.env.SP_PARAM_NAME || 'barcode',
  // Segundo SP OPCIONAL para stock por bodega. Si SP_STOCK_NAME está vacío, el
  // bridge no lo llama (retrocompatible con tenants que no tienen este SP).
  // El SP recibe el mismo código de barras y retorna filas { Nombre, Stock }
  // (Nombre = bodega). Param por defecto @CodigoBarra.
  stockSpName: (process.env.SP_STOCK_NAME || '').trim() || null,
  stockSpParamName: process.env.SP_STOCK_PARAM_NAME || 'CodigoBarra',
};
