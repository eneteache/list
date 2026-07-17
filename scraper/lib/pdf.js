import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import fs from 'node:fs';

const Y_TOLERANCE = 1.5;

// El NIF enmascarado no siempre usa el mismo nº de asteriscos a cada lado
// (p.ej. "***1464**" pero también "****5299*"); exigir un conteo fijo hacía
// que parseDataRow no reconociera esas filas y las descartara enteras.
export const NIF_RE = /^\*{2,4}\d{2,4}\*{1,2}$/;

// Huecos verticales entre líneas consecutivas de una misma tabla que SÍ son
// dos candidatos reales distintos nunca bajan de ~13.8pt en los documentos de
// esta especialidad; un hueco menor entre una línea con NIF y otra sin él es
// el mismo candidato partido en dos líneas (apellido u observación
// demasiado larga para caber en una).
const ROW_FRAGMENT_GAP_MAX = 12;

/**
 * Extrae todas las líneas de texto de un PDF, agrupando los items por su
 * coordenada Y (misma fila de tabla). Cada línea queda ordenada por X (izq->der).
 * @returns {Promise<Array<{page:number, y:number, items:Array<{str:string,x:number}>}>>}
 */
export async function extractLines(pdfPath) {
  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const doc = await getDocument({ data, verbosity: 0 }).promise;
  const lines = [];

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const items = content.items
      .map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5] }))
      .filter((it) => it.str.trim() !== '');

    const pageLines = [];
    for (const item of items) {
      let line = pageLines.find((l) => Math.abs(l.y - item.y) <= Y_TOLERANCE);
      if (!line) {
        line = { page: p, y: item.y, items: [] };
        pageLines.push(line);
      }
      line.items.push(item);
    }
    for (const line of pageLines) {
      line.items.sort((a, b) => a.x - b.x);
    }
    pageLines.sort((a, b) => b.y - a.y);

    // Cuando una fila no cabe en una sola línea (apellido largo que envuelve,
    // NIF que queda impreso por encima del resto de columnas...) el PDF la
    // reparte en 2 o más líneas muy pegadas verticalmente. parseDataRow
    // ignora cualquier línea sin NIF, así que sin fusionar aquí esos
    // fragmentos se pierden datos (o la fila entera) o el nombre reconstruido
    // queda incompleto y no coincide con el mismo candidato en otro documento
    // donde sí cupo en una sola línea. Se fusiona un fragmento con el anterior
    // cuando exactamente uno de los dos tiene NIF (evita mezclar dos
    // candidatos reales, que sí tienen NIF cada uno) y el hueco es pequeño.
    // Los items se concatenan en orden de lectura (línea de arriba primero)
    // SIN reordenar por X global, porque el fragmento envuelto no siempre cae
    // bajo la misma columna que el resto de la fila.
    const merged = [];
    let lastY = null;
    for (const line of pageLines) {
      const prev = merged[merged.length - 1];
      const gap = prev ? lastY - line.y : Infinity;
      const prevHasNif = prev ? prev.items.some((it) => NIF_RE.test(it.str)) : false;
      const curHasNif = line.items.some((it) => NIF_RE.test(it.str));
      if (prev && gap > 0 && gap <= ROW_FRAGMENT_GAP_MAX && prevHasNif !== curHasNif) {
        prev.items = prev.items.concat(line.items);
        lastY = line.y;
        continue;
      }
      merged.push({ page: line.page, y: line.y, items: [...line.items] });
      lastY = line.y;
    }

    lines.push(...merged);
  }
  return lines;
}

export function lineText(line) {
  return line.items.map((it) => it.str).join(' ').replace(/\s+/g, ' ').trim();
}

export const DECIMAL_RE = /^\d{1,2},\d{3,4}$/;
const ORDEN_RE = /^\d{5}$/;
const ACCESO_RE = /^[12]$/;

/**
 * A partir de una línea que contiene un NIF enmascarado, reconstruye la fila:
 * nif, nombre (apellidos y nombre), acceso, orden y los tokens decimales encontrados.
 */
export function parseDataRow(line) {
  const nifItem = line.items.find((it) => NIF_RE.test(it.str));
  if (!nifItem) return null;

  const nombreTokens = [];
  const decimals = [];
  let acceso = null;
  let orden = null;

  for (const it of line.items) {
    const s = it.str;
    if (s === nifItem.str) continue;
    if (/^-+$/.test(s)) continue; // placeholder de casilla vacía ("-", "--")
    if (s.toUpperCase() === 'NP') continue; // "No Presentado" abreviado
    if (/^(no|presentado)$/i.test(s)) continue; // "No Presentado" en vez de NP en algún documento de segunda prueba
    if (DECIMAL_RE.test(s)) {
      decimals.push({ value: parseFloat(s.replace(',', '.')), x: it.x });
    } else if (ORDEN_RE.test(s)) {
      orden = s;
    } else if (ACCESO_RE.test(s) && acceso === null) {
      acceso = s;
    } else if (/[A-Za-zÀ-ÿ]/.test(s)) {
      nombreTokens.push(s);
    }
  }

  return {
    nif: nifItem.str,
    nombre: nombreTokens.join(' ').replace(/\s+,/g, ',').trim(),
    acceso,
    orden,
    decimals,
  };
}

/** Encuentra en una línea de cabecera la X del token cuyo texto coincide con `label`. */
export function headerX(headerLine, label) {
  const item = headerLine.items.find((it) => it.str.trim() === label);
  return item ? item.x : null;
}

/**
 * De una lista de tokens decimales {value,x}, devuelve el más cercano a targetX,
 * o null si el más cercano está a más de maxDist puntos (evita emparejar con la
 * columna vecina cuando la celda buscada está realmente vacía/"-").
 */
export function closestDecimal(decimals, targetX, maxDist = 30) {
  if (targetX == null || decimals.length === 0) return null;
  let best = decimals[0];
  let bestDist = Math.abs(best.x - targetX);
  for (const d of decimals.slice(1)) {
    const dist = Math.abs(d.x - targetX);
    if (dist < bestDist) {
      best = d;
      bestDist = dist;
    }
  }
  return bestDist <= maxDist ? best.value : null;
}
