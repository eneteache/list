// El NIF enmascarado solo conserva unos pocos dígitos (p.ej. "***0991**"), y
// con miles de candidatos hay una probabilidad real (no anecdótica) de que
// dos personas distintas compartan el mismo NIF enmascarado. Por eso NO se
// cruza por NIF a secas: se agrupa por NIF y, cuando una fuente tiene más de
// una fila para el mismo NIF (colisión real), se desambigua por nombre. El
// nombre en sí NO sirve como parte fija de la clave de cruce porque no es
// estable entre documentos: cada PDF puede truncar o envolver el nombre de
// pila de forma distinta (ver el merge de líneas en lib/pdf.js), así que
// exigir coincidencia exacta separaba en dos personas a un mismo candidato
// cuyo nombre venía completo en un documento y recortado en otro.
export function groupByNif(rows) {
  const map = new Map();
  for (const r of rows ?? []) {
    if (!map.has(r.nif)) map.set(r.nif, []);
    map.get(r.nif).push(r);
  }
  return map;
}

// Normaliza para comparar: quita acentos/diéresis (ñ incluida, vía
// descomposición NFD a n + tilde combinante) y expande la abreviatura "Mª"
// a "MARIA". Hace falta porque el mismo candidato puede venir de fuentes muy
// distintas (documentos por tribunal vs. Anexo I de interinos) generadas por
// sistemas distintos de la Administración que no son consistentes entre sí
// imprimiendo el mismo nombre — visto en real: un documento imprime "LUDENA"
// y otro "LUDEÑA" para la misma persona (mismo NIF).
function normalizar(s) {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/Mª/gi, 'MARIA')
    .trim()
    .toUpperCase();
}

// Compara tolerando que uno de los dos venga truncado (el más corto debe ser
// un prefijo del más largo), que es como aparece el mismo candidato entre
// documentos que no envuelven/imprimen el nombre de pila igual.
export function nombresCompatibles(a, b) {
  if (!a || !b) return true;
  const [corto, largo] = a.length <= b.length ? [a, b] : [b, a];
  return normalizar(largo).startsWith(normalizar(corto));
}

// Agrupa los nombres vistos para un mismo NIF en "personas" distintas: dos
// nombres van al mismo grupo si uno es compatible con el otro (mismo
// candidato con el nombre truncado en algún documento); si no lo son, son dos
// personas distintas que colisionan en el NIF enmascarado y deben quedar
// separadas. Se procesa de más largo a más corto para que el nombre completo
// (si algún documento lo tiene) sea siempre la referencia del grupo.
export function agruparPorPersona(nombres) {
  const ordenados = [...new Set(nombres)].sort((a, b) => b.length - a.length);
  const grupos = [];
  for (const nombre of ordenados) {
    const grupo = grupos.find((g) => nombresCompatibles(nombre, g.referencia));
    if (grupo) grupo.miembros.add(nombre);
    else grupos.push({ referencia: nombre, miembros: new Set([nombre]) });
  }
  return grupos;
}

// De las filas de una fuente para un NIF dado, la que pertenece al grupo
// (persona) indicado.
export function pickMatch(rowsForNif, miembros) {
  if (!rowsForNif || rowsForNif.length === 0) return undefined;
  return rowsForNif.find((r) => miembros.has(r.nombre));
}
