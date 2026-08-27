/**
 * Ejecucion de stored procedures.
 *
 * Todos los parametros van tipados a traves de tedious (`addParameter`), nunca
 * concatenados en el texto de la consulta: no hay superficie de inyeccion SQL
 * aunque el termino de busqueda venga del usuario final.
 */
import { Request, TYPES } from 'tedious';

import { config } from '../config';
import { acquire, release } from './pool';

type ParamType = 'string' | 'int';

interface Param {
  name: string;
  type: ParamType;
  value: string | number;
}

/**
 * Ejecuta un SP y devuelve sus filas.
 *
 * No se llama a `connection.reset()` al reutilizar la conexion porque el bridge
 * nunca toca el estado de sesion (sin tablas temporales, sin SET). Anadir ese
 * viaje extra por consulta no compraria nada.
 */
async function callProcedure(spName: string, params: Param[]): Promise<Record<string, unknown>[]> {
  const entry = await acquire();
  let failed = false;

  try {
    return await new Promise<Record<string, unknown>[]>((resolve, reject) => {
      const rows: Record<string, unknown>[] = [];

      const request = new Request(spName, (err) => {
        if (err) reject(err);
        else resolve(rows);
      });

      for (const param of params) {
        request.addParameter(
          param.name,
          param.type === 'int' ? TYPES.Int : TYPES.NVarChar,
          param.value,
        );
      }

      request.on('row', (columns: Array<{ metadata: { colName: string }; value: unknown }>) => {
        const row: Record<string, unknown> = {};
        for (const column of columns) {
          // Las columnas binarias (VARBINARY/IMAGE, p.ej. una foto guardada como
          // bytes) llegan como Buffer. Se envian en base64 para que viajen como
          // texto en el JSON. La conversion ocurre aqui, en el servidor del
          // propio cliente, no en un tercero.
          const value = column.value;
          row[column.metadata.colName] = Buffer.isBuffer(value) ? value.toString('base64') : value;
        }
        rows.push(row);
      });

      entry.connection.callProcedure(request);
    });
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    release(entry, failed);
  }
}

/** SP principal: producto por codigo de barras. */
export function callBarcodeProcedure(barcode: string): Promise<Record<string, unknown>[]> {
  return callProcedure(config.spName, [
    { name: config.spParamName, type: 'string', value: barcode },
  ]);
}

/**
 * SP de stock por bodega (opcional). Devuelve [] si el cliente no lo configuro.
 * Cada fila trae { Nombre: bodega, Stock: cantidad }.
 */
export function callStockProcedure(barcode: string): Promise<Record<string, unknown>[]> {
  if (!config.stockSpName) return Promise.resolve([]);
  return callProcedure(config.stockSpName, [
    { name: config.stockSpParamName, type: 'string', value: barcode },
  ]);
}

/**
 * SP de busqueda por texto (opcional). Busca por codigo interno, nombre o
 * codigo de barras. `limit` ya viene recortado por la ruta: el cliente no
 * decide cuanto trabajo se le pide a la base de datos.
 */
export function callSearchProcedure(
  query: string,
  limit: number,
): Promise<Record<string, unknown>[]> {
  if (!config.searchSpName) return Promise.resolve([]);
  return callProcedure(config.searchSpName, [
    { name: config.searchSpParamName, type: 'string', value: query },
    { name: config.searchSpLimitParamName, type: 'int', value: limit },
  ]);
}

/** Comprobacion de vida real contra la base, para /health?deep=1. */
export async function ping(): Promise<void> {
  const entry = await acquire();
  let failed = false;
  try {
    await new Promise<void>((resolve, reject) => {
      const request = new Request('SELECT 1', (err) => (err ? reject(err) : resolve()));
      entry.connection.execSql(request);
    });
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    release(entry, failed);
  }
}
