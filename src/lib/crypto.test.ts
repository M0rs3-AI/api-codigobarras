/**
 * Prueba del descifrado contra el algoritmo original de FoxPro.
 *
 * Ejecutar con: npm run test:crypto
 *
 * Reimplementa el EMPAQUETADOR (la inversa del desempaquetador que entrego el
 * cliente) y comprueba que el bridge recupera la contrasena, tanto por el
 * camino de texto (columna varchar decodificada por tedious como CP1252) como
 * por el de bytes (columna envuelta como varbinary).
 */
import { decryptStoredSecret, verifyPassword, InvalidStoredSecret } from './crypto';

/** Inversa del "Desempaquetador de Claves V.5". Produce los bytes almacenados. */
function packFoxPro(plain: string): Buffer {
  const length = plain.length;
  const out = Buffer.alloc(length);
  // cifrado[i] = plano[L-i+1] + 60 + (L-i+1), con i y las posiciones en base 1.
  for (let i = 1; i <= length; i += 1) {
    const j = length - i + 1;
    out[i - 1] = plain.charCodeAt(j - 1) + 60 + j;
  }
  return out;
}

/** Lo que hace tedious con una columna varchar de intercalacion latina. */
const CP1252_HIGH = [
  0x20ac, 0x0081, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021,
  0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x008d, 0x017d, 0x008f,
  0x0090, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014,
  0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x009d, 0x017e, 0x0178,
];

function decodeCp1252(bytes: Buffer): string {
  let out = '';
  for (const byte of bytes) {
    out += String.fromCharCode(byte >= 0x80 && byte <= 0x9f ? CP1252_HIGH[byte - 0x80] : byte);
  }
  return out;
}

let failures = 0;
function check(name: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FALLA'}  ${name}`);
  if (!condition) failures += 1;
}

const passwords = ['admin', 'Bizor2024', 'a', 'Pa$$w0rd!', 'clave con espacios', 'ABCDEFGHIJKLMNO'];

for (const password of passwords) {
  const packed = packFoxPro(password);

  // Camino varbinary: bytes exactos.
  check(`[buffer] ${password}`, decryptStoredSecret(packed) === password);
  check(`[buffer] verify ${password}`, verifyPassword(password, packed));

  // Camino varchar: tedious ya lo decodifico a texto con CP1252.
  const asText = decodeCp1252(packed);
  check(`[cp1252] ${password}`, decryptStoredSecret(asText) === password);
  check(`[cp1252] verify ${password}`, verifyPassword(password, asText));

  // Contrasena incorrecta.
  check(`[rechaza] ${password}`, !verifyPassword(password + 'x', packed));
  check(`[rechaza vacia] ${password}`, !verifyPassword('', packed));
}

// Relleno de la derecha, por si la columna fuese CHAR.
const padded = Buffer.concat([packFoxPro('admin'), Buffer.from('   ')]);
check('[padding] CHAR relleno con espacios', verifyPassword('admin', padded));

// Dato que no lo produjo este algoritmo.
try {
  decryptStoredSecret(Buffer.from([1, 2, 3]));
  check('[corrupto] detecta dato invalido', false);
} catch (err) {
  check('[corrupto] detecta dato invalido', err instanceof InvalidStoredSecret);
}

// Bytes que el camino de texto no puede representar.
check('[vacio] cadena vacia', decryptStoredSecret('') === '');

console.log(failures === 0 ? '\nTODO OK' : `\n${failures} FALLOS`);
process.exit(failures === 0 ? 0 : 1);
