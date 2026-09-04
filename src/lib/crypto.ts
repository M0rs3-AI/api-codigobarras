/**
 * Sesiones firmadas y descifrado de SEG_USUARIOS.Password.
 *
 * Todo lo que compara secretos lo hace en tiempo constante: un `===` sobre un
 * token lo filtra byte a byte ante un atacante con suficientes intentos.
 */
import { createHmac, hkdfSync, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

import { config } from '../config';

/**
 * Clave de firma. Sin AUTH_SECRET se deriva del BRIDGE_TOKEN con HKDF, para que
 * no sea el mismo secreto que viaja en cada peticion: si ese se filtra en un log
 * o un proxy, todavia no se pueden fabricar sesiones.
 */
const signingKey: Buffer = (() => {
  const material = config.auth.secret ?? config.bridgeToken;
  return Buffer.from(
    hkdfSync('sha256', Buffer.from(material, 'utf8'), Buffer.alloc(0), 'bridge:session:v1', 32),
  );
})();

function b64url(buffer: Buffer): string {
  return buffer.toString('base64url');
}

/** Comparacion en tiempo constante tolerante a longitudes distintas. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) {
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}

export interface SessionClaims {
  sub: string;
  jti: string;
  iat: number;
  exp: number;
}

/**
 * Token propio en vez de JWT: formato fijo `v1.<payload>.<hmac>` con un unico
 * algoritmo posible, asi que no hay `alg` que confundir ni libreria que auditar.
 */
export function signSession(username: string): { token: string; claims: SessionClaims } {
  const now = Math.floor(Date.now() / 1000);
  const claims: SessionClaims = {
    sub: username,
    jti: randomUUID(),
    iat: now,
    exp: now + config.auth.sessionTtlMinutes * 60,
  };

  const payload = b64url(Buffer.from(JSON.stringify(claims), 'utf8'));
  const mac = b64url(createHmac('sha256', signingKey).update(`v1.${payload}`).digest());

  return { token: `v1.${payload}.${mac}`, claims };
}

export type SessionResult =
  | { ok: true; claims: SessionClaims }
  | { ok: false; reason: 'malformed' | 'bad_signature' | 'expired' };

export function verifySession(token: string): SessionResult {
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') return { ok: false, reason: 'malformed' };

  const [, payload, mac] = parts;
  const expected = b64url(createHmac('sha256', signingKey).update(`v1.${payload}`).digest());

  // Primero la firma: si no es nuestra, el payload no merece ni ser parseado.
  if (!safeEqual(mac, expected)) return { ok: false, reason: 'bad_signature' };

  let claims: SessionClaims;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as SessionClaims;
  } catch {
    return { ok: false, reason: 'malformed' };
  }

  if (typeof claims?.sub !== 'string' || typeof claims?.exp !== 'number' || !claims.sub) {
    return { ok: false, reason: 'malformed' };
  }
  if (Math.floor(Date.now() / 1000) >= claims.exp) return { ok: false, reason: 'expired' };

  return { ok: true, claims };
}

/* -------------------------------------------------------------------------- */
/*  SEG_USUARIOS.Password                                                      */
/* -------------------------------------------------------------------------- */

/**
 * OJO: esto es ofuscacion, no cifrado. La columna guarda el "empaquetador de
 * claves" de FoxPro, un desplazamiento reversible cuyo unico secreto es el
 * propio algoritmo. No se puede cambiar sin tocar el ERP, que escribe esa misma
 * columna. La defensa real es que el usuario de SQL del bridge no puede leer
 * SEG_USUARIOS, solo ejecutar el SP.
 */

/**
 * Windows-1252, tramo 0x80-0x9F: los unicos bytes en los que difiere de
 * ISO-8859-1, y justo donde caen las contrasenas cifradas ('admin' produce los
 * bytes 175 169 172 162 158). Como la columna es varchar, el driver la entrega
 * ya decodificada a texto y sin esta tabla el byte 0x9E se leeria como 382.
 */
const CP1252_HIGH: readonly number[] = [
  0x20ac, 0x0081, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021,
  0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x008d, 0x017d, 0x008f,
  0x0090, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014,
  0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x009d, 0x017e, 0x0178,
];

const CP1252_REVERSE: ReadonlyMap<number, number> = new Map(
  CP1252_HIGH.map((codePoint, offset) => [codePoint, 0x80 + offset]),
);

export class InvalidStoredSecret extends Error {
  constructor(reason: string) {
    super(`Credencial almacenada ilegible: ${reason}`);
    this.name = 'InvalidStoredSecret';
  }
}

/** Texto -> bytes, deshaciendo la decodificacion del driver. */
function textToBytes(value: string): Buffer {
  const bytes = Buffer.alloc(value.length);

  for (let i = 0; i < value.length; i += 1) {
    const codePoint = value.charCodeAt(i);

    if (codePoint <= 0xff) {
      bytes[i] = codePoint;
      continue;
    }

    const mapped =
      config.auth.passwordEncoding === 'cp1252' ? CP1252_REVERSE.get(codePoint) : undefined;

    if (mapped === undefined) {
      throw new InvalidStoredSecret(
        `caracter fuera de la pagina de codigos en la posicion ${i}`,
      );
    }

    bytes[i] = mapped;
  }

  return bytes;
}

/** Con el SP envoltorio que devuelve varbinary llega un Buffer y no hay conversion. */
function toBytes(stored: string | Buffer): Buffer {
  return Buffer.isBuffer(stored) ? stored : textToBytes(stored);
}

/**
 * Quita el relleno de la derecha por si la columna fuese CHAR. Hay que hacerlo
 * antes de descifrar: la posicion de cada byte entra en la cuenta, asi que un
 * espacio de mas desplaza el resultado entero.
 */
function trimPadding(bytes: Buffer): Buffer {
  let end = bytes.length;
  while (end > 0 && (bytes[end - 1] === 0x20 || bytes[end - 1] === 0x00)) end -= 1;
  return bytes.subarray(0, end);
}

/**
 * "Desempaquetador de Claves V.5" de FoxPro. El original recorre el texto del
 * final al principio restando 60 mas la distancia al final; como concatena en
 * ese mismo orden, equivale a esto en terminos de la posicion de salida j:
 *
 *     salida[j] = cifrado[L-j+1] - 60 - j
 */
function unpackFoxProSecret(bytes: Buffer): Buffer {
  const length = bytes.length;
  const plain = Buffer.alloc(length);

  for (let j = 1; j <= length; j += 1) {
    const code = bytes[length - j] - 60 - j;

    // Fuera de rango = la columna no la produjo este algoritmo. Es un fallo de
    // configuracion, no un login fallido, y se distingue para que se vea.
    if (code < 0 || code > 0xff) {
      throw new InvalidStoredSecret(
        `byte fuera de rango en la posicion ${j} de ${length}; revisa la columna y AUTH_PASSWORD_ENCODING`,
      );
    }

    plain[j - 1] = code;
  }

  return plain;
}

/** Uso interno. No registrar ni devolver nunca el resultado. */
export function decryptStoredSecret(stored: string | Buffer): string {
  return unpackFoxProSecret(trimPadding(toBytes(stored))).toString('latin1');
}

/**
 * Compara en bytes y en tiempo constante. En bytes porque los dos lados vienen
 * de codificaciones distintas y normalizar a texto invitaria a dar por iguales
 * dos secuencias que no lo son.
 */
export function verifyPassword(plain: string, stored: string | Buffer): boolean {
  const expected = unpackFoxProSecret(trimPadding(toBytes(stored)));

  let received: Buffer;
  try {
    received = textToBytes(plain);
  } catch {
    burnVerificationTime();
    return false;
  }

  if (received.length !== expected.length) {
    burnVerificationTime();
    return false;
  }

  return timingSafeEqual(received, expected);
}

/**
 * Trabajo simulado para el caso "sin fila". Sin esto ese camino responde antes
 * que el real y se pueden enumerar usuarios validos solo cronometrando.
 */
export function burnVerificationTime(): void {
  const decoy = randomBytes(32).toString('base64');
  safeEqual(decoy, decoy);
}
