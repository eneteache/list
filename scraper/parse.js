import { extractLines, lineText, parseDataRow, headerX, closestDecimal, NIF_RE, DECIMAL_RE } from './lib/pdf.js';

/**
 * Detecta de qué tipo de documento se trata a partir del título impreso en el PDF.
 * @returns {'baremacion'|'primera_prueba'|'segunda_prueba'|'fase_oposicion'|'otro'}
 */
export async function detectTipoDocumento(pdfPath) {
  const lines = await extractLines(pdfPath);
  const titleText = lines
    .slice(0, 8)
    .map(lineText)
    .join(' ')
    .toUpperCase();
  if (titleText.includes('BAREMACION')) return 'baremacion';
  if (titleText.includes('FASE OPOSICIÓN') || titleText.includes('FASE OPOSICION')) return 'fase_oposicion';
  if (titleText.includes('SEGUNDA PRUEBA')) return 'segunda_prueba';
  if (titleText.includes('PRIMERA PRUEBA')) return 'primera_prueba';
  return 'otro';
}

function findTribunal(lines) {
  const tribunalLine = lines.find((l) => lineText(l).includes('TRIBUNAL Nº'));
  const m = tribunalLine ? lineText(tribunalLine).match(/TRIBUNAL\s*N[ºo.]*\s*(\d+)/i) : null;
  return m ? m[1] : null;
}

/**
 * Parsea un PDF de "BAREMACION DE LOS ASPIRANTES" (fase de concurso).
 * Devuelve el roster completo del tribunal con la nota de baremo (concurso) de
 * cada uno, desglosada en sus tres apartados (T.Ap.1, T.Ap.2, T.Ap.3).
 */
export async function parseBaremacion(pdfPath) {
  const lines = await extractLines(pdfPath);
  const tribunalLine = lines.find((l) => lineText(l).startsWith('Tribunal:'));
  const tribunal = tribunalLine ? lineText(tribunalLine).replace('Tribunal:', '').trim() : null;

  const rows = [];
  let headerXs = null;

  for (const line of lines) {
    const text = lineText(line);
    if (text.includes('Baremo') && text.includes('Apellidos')) {
      headerXs = {
        baremo: headerX(line, 'Baremo'),
        apartado1: headerX(line, 'T.Ap.1'),
        apartado2: headerX(line, 'T.Ap.2'),
        apartado3: headerX(line, 'T.Ap.3'),
      };
      continue;
    }
    const row = parseDataRow(line);
    if (!row || !headerXs) continue;

    const baremo = closestDecimal(row.decimals, headerXs.baremo);
    if (baremo == null) {
      console.warn(`[parseBaremacion] ${pdfPath}: no se pudo localizar Baremo para ${row.nif}`);
      continue;
    }
    const apartado1 = closestDecimal(row.decimals, headerXs.apartado1);
    const apartado2 = closestDecimal(row.decimals, headerXs.apartado2);
    const apartado3 = closestDecimal(row.decimals, headerXs.apartado3);

    rows.push({
      nif: row.nif,
      nombre: row.nombre,
      acceso: row.acceso,
      notaConcurso: baremo,
      apartado1,
      apartado2,
      apartado3,
    });
  }

  return { tribunal, rows };
}

/**
 * Parsea un PDF de "CALIFICACIONES DE OPOSITORES PRIMERA PRUEBA" (Parte A + Parte
 * B). Incluye a TODOS los presentados, también a quienes no la superan (se
 * imprime "-" o "NP" en vez de un Puntuación) — es la única fuente donde se ve
 * quién queda fuera ya en la primera prueba.
 */
export async function parsePrimeraPrueba(pdfPath) {
  const lines = await extractLines(pdfPath);
  const tribunal = findTribunal(lines);

  const rows = [];
  let parteAX = null;
  let parteBX = null;
  let puntuacionX = null;

  for (const line of lines) {
    const text = lineText(line);
    if (text.includes('Parte A') && text.includes('Parte B') && text.includes('Puntuación')) {
      parteAX = headerX(line, 'Parte A');
      parteBX = headerX(line, 'Parte B');
      puntuacionX = headerX(line, 'Puntuación');
      continue;
    }
    const row = parseDataRow(line);
    if (!row) continue;

    rows.push({
      nif: row.nif,
      nombre: row.nombre,
      acceso: row.acceso,
      orden: row.orden,
      // Parte A y Parte B pueden tener nota aunque la Puntuación (media)
      // quede en blanco: eso es "se presentó pero no le hace media", NO es
      // "no presentado" — solo es NP de verdad cuando ni Parte A ni Parte B
      // tienen nota (ver unify.js).
      parteA: closestDecimal(row.decimals, parteAX),
      parteB: closestDecimal(row.decimals, parteBX),
      notaFase1: closestDecimal(row.decimals, puntuacionX),
    });
  }

  return { tribunal, rows };
}

/**
 * Parsea un PDF de "CALIFICACIONES DE OPOSITORES SEGUNDA PRUEBA". Solo aparecen
 * aquí quienes llegaron a presentarse (ya superaron la primera prueba).
 */
export async function parseSegundaPrueba(pdfPath) {
  const lines = await extractLines(pdfPath);
  const tribunal = findTribunal(lines);

  const rows = [];
  let puntuacionX = null;

  for (const line of lines) {
    const text = lineText(line);
    if (text.includes('Orden') && text.includes('Acceso') && text.includes('Puntuación')) {
      puntuacionX = headerX(line, 'Puntuación');
      continue;
    }
    const row = parseDataRow(line);
    if (!row) continue;

    rows.push({
      nif: row.nif,
      nombre: row.nombre,
      acceso: row.acceso,
      orden: row.orden,
      notaFase2: closestDecimal(row.decimals, puntuacionX),
    });
  }

  return { tribunal, rows };
}

/**
 * Parsea un PDF de "CALIFICACIONES DE OPOSITORES FASE OPOSICIÓN" (aprobados de la fase oposición).
 * Solo aparecen aquí quienes SUPERAN la fase de oposición.
 */
export async function parseFaseOposicion(pdfPath) {
  const lines = await extractLines(pdfPath);
  const tribunal = findTribunal(lines);

  const rows = [];
  for (const line of lines) {
    const row = parseDataRow(line);
    if (!row) continue;
    if (row.decimals.length === 0) {
      console.warn(`[parseFaseOposicion] ${pdfPath}: sin puntuación para ${row.nif}`);
      continue;
    }
    rows.push({
      nif: row.nif,
      nombre: row.nombre,
      acceso: row.acceso,
      orden: row.orden,
      notaOposicion: row.decimals[0].value,
    });
  }

  return { tribunal, rows };
}

const ANYO_RE = /^\d{4}:$/;
const CODIGOS_ESPECIALIDAD = ['031', '032', '033', '034', '035', '036', '037', '038', '039'];

/**
 * Parsea el Anexo I ("Lista de aspirantes... obran en poder de la
 * Administración") de la lista de interinos: un único listado regional con
 * todos los aspirantes acreditados en cualquiera de las especialidades del
 * cuerpo, cada uno con sus especialidades acreditadas (columnas de código con
 * "X"), puntos de experiencia docente (b.1-b.4), puntos por oposiciones
 * superadas sin plaza, y 0+ líneas de "AAAA: N,NNNN" con la calificación
 * obtenida en cada convocatoria superada.
 *
 * Importante: el documento NO indica a qué especialidad corresponde cada
 * calificación histórica cuando alguien está acreditado en más de una (no
 * hay columna/etiqueta que lo diga) — por eso esta función devuelve TODAS
 * las especialidades acreditadas de cada aspirante en vez de filtrar a una,
 * en lugar de fingir un cruce calificación-especialidad que el propio
 * documento no permite reconstruir con certeza.
 */
export async function parseListaInterinos(pdfPath) {
  const lines = await extractLines(pdfPath);

  const headerLine = lines.find((l) => lineText(l).includes('b.1') && lineText(l).includes('038'));
  if (!headerLine) {
    throw new Error('No se encontró la cabecera con las columnas de especialidad (031-039)');
  }
  const columnas = CODIGOS_ESPECIALIDAD.map((codigo) => ({ codigo, x: headerX(headerLine, codigo) }));

  const candidatos = [];
  let actual = null;

  for (const line of lines) {
    const nifItem = line.items.find((it) => NIF_RE.test(it.str));

    if (nifItem) {
      if (actual) candidatos.push(actual);

      const nombreTokens = [];
      const decimals = [];
      const especialidades = [];
      for (const it of line.items) {
        const s = it.str;
        if (s === nifItem.str) continue;
        if (s === 'X') {
          const col = columnas.find((c) => Math.abs(it.x - c.x) <= 13);
          if (col) especialidades.push(col.codigo);
          continue;
        }
        if (DECIMAL_RE.test(s)) {
          decimals.push({ value: parseFloat(s.replace(',', '.')), x: it.x });
        } else if (/[A-Za-zÀ-ÿ]/.test(s)) {
          nombreTokens.push(s);
        }
      }
      decimals.sort((a, b) => a.x - b.x);
      // Orden fijo por posición tras las columnas de especialidad: b.1, b.2,
      // b.3, b.4 y, por último, Ptos opos. superadas — verificado que cada
      // fila principal trae siempre exactamente estos 5 valores, nunca más
      // ni menos (las calificaciones de convocatorias van en líneas aparte).
      const [b1, b2, b3, b4, ptosOposSuperadas] = decimals.map((d) => d.value);

      actual = {
        nif: nifItem.str,
        nombre: nombreTokens.join(' ').replace(/\s+,/g, ',').trim(),
        especialidades,
        b1: b1 ?? 0,
        b2: b2 ?? 0,
        b3: b3 ?? 0,
        b4: b4 ?? 0,
        ptosOposSuperadas: ptosOposSuperadas ?? 0,
        calificaciones: [],
      };
      continue;
    }

    if (!actual) continue;
    const anyoItem = line.items.find((it) => ANYO_RE.test(it.str));
    const notaItem = line.items.find((it) => DECIMAL_RE.test(it.str));
    if (anyoItem && notaItem) {
      actual.calificaciones.push({ anyo: parseInt(anyoItem.str, 10), nota: parseFloat(notaItem.str.replace(',', '.')) });
    }
  }
  if (actual) candidatos.push(actual);

  return { candidatos: candidatos.filter((c) => c.especialidades.length > 0) };
}
