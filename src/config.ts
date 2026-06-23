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
};
