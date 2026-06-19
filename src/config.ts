import 'dotenv/config';
import { readFileSync } from 'fs';

// En Docker Swarm el secreto llega como archivo montado (Docker secret),
// no como variable de entorno en texto plano. INTERNAL_SECRET_FILE tiene
// prioridad; INTERNAL_SECRET queda como fallback para desarrollo local con .env.
function loadInternalSecret(): string {
  const secretFile = process.env.INTERNAL_SECRET_FILE;
  if (secretFile) {
    return readFileSync(secretFile, 'utf8').trim();
  }
  if (process.env.INTERNAL_SECRET) {
    return process.env.INTERNAL_SECRET;
  }
  throw new Error('INTERNAL_SECRET o INTERNAL_SECRET_FILE deben estar configurados.');
}

export const config = {
  internalSecret: loadInternalSecret(),
  port: parseInt(process.env.PORT ?? '3000', 10),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  // Cantidad de proxies (Traefik) delante del proceso, para que
  // express-rate-limit y req.ip resuelvan la IP real del cliente.
  trustProxyHops: parseInt(process.env.TRUST_PROXY_HOPS ?? '1', 10),
};
