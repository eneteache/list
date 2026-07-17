import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseListaInterinos } from './parse.js';
import { groupByNif, nombresCompatibles } from './lib/personas.js';

// Tope oficial de experiencia docente (Resolución de 3 de junio de 2021,
// Acuerdo de Personal Docente Interino): máximo 10 puntos, independientemente
// de la suma de b.1+b.2+b.3+b.4. El Anexo I trae las puntuaciones "sin
// considerar los topes" (así lo dice la propia Resolución de la fase de
// exposición pública) — el tope se aplica aquí, no viene ya aplicado.
const TOPE_EXPERIENCIA = 10;

// Puntos por nº de oposiciones superadas desde el año 2000 en la especialidad
// (Bloque I): 1 punto por la 1ª, 1,5 por la 2ª, 1,5 por la 3ª y 2 por la 4ª,
// hasta un máximo de 6. PUNTOS_ACUMULADOS[n] es el acumulado tras la n-ésima
// oposición superada (índice 0 = ninguna superada todavía).
const PUNTOS_ACUMULADOS = [0, 1, 2.5, 4, 6];

// Dado el acumulado ANTES de contar una nueva oposición superada, devuelve el
// acumulado tras sumarle esa nueva (con el tope de 6 ya aplicado). Se busca
// por el acumulado ya alcanzado en vez de por un contador aparte porque
// ptosOposSuperadas viene ya calculado en el Anexo I y puede no coincidir
// exactamente con calificaciones.length (el Anexo no dice a qué especialidad
// concreta corresponde cada calificación histórica cuando alguien está
// acreditado en varias, ver parseListaInterinos) — este acumulado, no ese
// conteo, es la fuente fiable de "en qué escalón va".
function siguientePuntosOpo(acumuladoActual) {
  const idx = PUNTOS_ACUMULADOS.findIndex((p) => acumuladoActual <= p + 1e-9);
  const siguiente = idx === -1 ? PUNTOS_ACUMULADOS.length - 1 : Math.min(idx + 1, PUNTOS_ACUMULADOS.length - 1);
  return PUNTOS_ACUMULADOS[siguiente];
}

// La nota de OPOSICIÓN de un candidato 2026 — SOLO la fase de oposición, sin
// mezclar el concurso (a diferencia de notaFinal/notaFinalAprox en unify.js):
// el concurso (méritos) ya cuenta aparte en la bolsa vía experiencia docente
// y puntos por oposiciones superadas, así que sumarlo también aquí lo
// contaría dos veces. Si ya aprobó, notaOposicion es el resultado combinado
// de fase de oposición ya definitivo (no cambia aunque luego se publique la
// baremación, ver unify.js) — no es provisional. Si no (suspenso, o su
// tribunal aún no ha resuelto la fase de oposición), se aproxima con la media
// de fase 1 y fase 2 cuando se conocen ambas, o la que se conozca — esto SÍ
// puede cambiar cuando su tribunal publique más datos, así que se marca
// provisional.
function notaOposicionDe(c) {
  if (c.notaOposicion != null) return { nota: c.notaOposicion, provisional: false };
  if (c.notaFase1 != null && c.notaFase2 != null) return { nota: (c.notaFase1 + c.notaFase2) / 2, provisional: true };
  if (c.notaFase1 != null || c.notaFase2 != null) return { nota: c.notaFase1 ?? c.notaFase2, provisional: true };
  return { nota: null, provisional: false };
}

// La mejor nota de oposición entre varios candidatos 2026 de la misma
// persona (puede haber más de uno si se presentó a más de una especialidad).
function mejorNotaOposicion(matches) {
  let nota = null;
  let provisional = false;
  for (const c of matches) {
    const r = notaOposicionDe(c);
    if (r.nota != null && (nota == null || r.nota > nota)) {
      nota = r.nota;
      provisional = r.provisional;
    }
  }
  return { nota, provisional };
}

/**
 * Descarga (si hace falta) el Anexo I de la lista de interinos y calcula, por
 * cada aspirante acreditado en cualquier especialidad del cuerpo, la
 * puntuación de su bolsa tras la rebaremación con los resultados de la
 * oposición 2026 ya unificada (ver resumen de rebaremación aportado por el
 * usuario, no un documento público de la CARM):
 *
 *  - Bloque I (ya tiene, con este año incluido, alguna oposición superada
 *    desde el año 2000 en la especialidad): nota más alta de esas
 *    oposiciones superadas + experiencia docente (topada a 10) + puntos por
 *    nº de oposiciones superadas (1/1,5/1,5/2, tope 6). Si aprueba también la
 *    fase de oposición 2026, entra su nota de este año si es la más alta, y
 *    sube un escalón en los puntos por oposiciones superadas.
 *  - Bloque II (nunca la ha superado desde el año 2000): nota de la ÚLTIMA
 *    oposición (2026, aunque sea un suspenso) + experiencia docente — NO
 *    lleva puntos por oposiciones superadas (no tiene ninguna).
 *  - Requisito de permanencia en la bolsa si no se está ya en Bloque I:
 *    haberse presentado efectivamente a la Parte A de la primera prueba de
 *    la convocatoria 2026 (en cualquiera de las especialidades acreditadas).
 *    Quien no cumple esto queda excluido (excluidoPorNoPresentarse), igual
 *    que quien ya tiene plaza (excluidoPorPlaza) — ninguno de los dos cuenta
 *    en el orden de la bolsa, pero ambos se listan para que quede claro por
 *    qué no aparecen con posición.
 *  - Exclusión GLOBAL por plaza: cualquier plaza obtenida este año, en
 *    cualquiera de las especialidades convocadas, saca a esa persona de la
 *    bolsa por completo, con independencia de en qué especialidad la haya
 *    obtenido.
 *  - Bloque I y Bloque II son colas independientes de la bolsa: TODO Bloque I
 *    se llama antes que CUALQUIER Bloque II con independencia de la
 *    puntuación de cada uno — no es un único ranking numérico mezclado.
 *
 * Es UN ÚNICO listado, no uno por especialidad: el Anexo I no permite saber a
 * qué especialidad concreta corresponde cada calificación histórica cuando un
 * aspirante está acreditado en varias (no hay ninguna columna que lo diga),
 * así que la nota más alta / bloque / exclusión por no presentarse se
 * calculan cruzando TODAS las especialidades de la oposición 2026 (igual que
 * la exclusión por plaza), no solo las acreditadas de cada aspirante. No es
 * una publicación oficial de ninguna bolsa.
 */
export async function runInterinos(config) {
  const dir = path.join('raw', 'interinos');
  fs.mkdirSync(dir, { recursive: true });
  const pdfPath = path.join(dir, 'anexo.pdf');

  // El enlace de descarga no lleva timestamp (a diferencia de los documentos
  // por tribunal), así que no hay forma de detectar "¿hay una versión más
  // nueva?" solo con la URL: se reutiliza el PDF ya descargado y, si la CARM
  // republica la lista, hay que borrar el fichero a mano (o actualizar la
  // URL en config/interinos.json) para forzar una descarga nueva.
  if (!fs.existsSync(pdfPath)) {
    console.log(`[interinos] descargando ${config.url}`);
    const res = await fetch(config.url);
    if (!res.ok) throw new Error(`fallo al descargar ${config.url}: HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(pdfPath, buf);
    console.log(`[interinos] descargado (${buf.length} bytes)`);
  } else {
    console.log(`[interinos] usando PDF ya descargado en ${pdfPath} (bórralo para forzar una nueva descarga)`);
  }

  const { candidatos: brutos } = await parseListaInterinos(pdfPath);

  const interinos = brutos.map((c, idx) => {
    const notaMasAlta = c.calificaciones.length > 0 ? Math.max(...c.calificaciones.map((x) => x.nota)) : 0;
    const experienciaDocente = Math.min(c.b1 + c.b2 + c.b3 + c.b4, TOPE_EXPERIENCIA);
    // El NIF enmascarado + nombre no siempre es único: con miles de aspirantes
    // puede haber dos personas distintas con el mismo NIF enmascarado Y el
    // mismo nombre (coincidencia de nombre y apellidos comunes). El índice de
    // aparición en el PDF sí lo es, así que forma parte del id.
    return {
      id: `${c.nif}|${c.nombre}|${idx}`,
      ...c,
      // Se confirma/recalcula tras el cruce con la oposición 2026 más abajo
      // (puede pasar de 'II' a 'I' si aprueba este año).
      bloque: c.calificaciones.length > 0 ? 'I' : 'II',
      notaMasAlta,
      notaMasAltaProvisional: false,
      notaUltimaOposicion: null,
      notaUltimaOposicionProvisional: false,
      experienciaDocente,
      ptosOposSuperadas: c.ptosOposSuperadas,
      puntuacionTotal: 0,
      excluidoPorPlaza: false,
      excluidoPorNoPresentarse: false,
      posicion: null,
    };
  });

  // Un único cruce contra las 8 especialidades de la oposición 2026 ya
  // unificada, reutilizado para las tres cosas que dependen de "qué hizo esta
  // persona este año": exclusión por plaza, rebaremación de Bloque I/II y
  // exclusión por no presentarse (ver docstring de runInterinos). Igual que
  // en unify.js, el NIF enmascarado no es único por sí solo — nombresCompatibles
  // filtra las coincidencias de NIF que en realidad son otra persona.
  const especialidades = JSON.parse(fs.readFileSync('config/especialidades.json', 'utf8'));
  const todosCandidatos2026 = [];
  for (const key of Object.keys(especialidades)) {
    const oposicionPath = path.join('out', `${key}.json`);
    if (!fs.existsSync(oposicionPath)) {
      console.warn(`[interinos] no se encontró out/${key}.json — no se puede rebaremar contra esa especialidad todavía`);
      continue;
    }
    const oposicion = JSON.parse(fs.readFileSync(oposicionPath, 'utf8'));
    todosCandidatos2026.push(...oposicion.candidatos);
  }
  const candidatos2026PorNif = groupByNif(todosCandidatos2026);

  for (const interino of interinos) {
    const candidatosNif = candidatos2026PorNif.get(interino.nif) ?? [];
    const matches = candidatosNif.filter((c) => nombresCompatibles(c.nombre, interino.nombre));

    interino.excluidoPorPlaza = matches.some((c) => c.plazaObtenida === true);

    // "Ha superado la oposición" es haber aprobado la fase de oposición (con
    // independencia de si su tribunal ya ha publicado la baremación): esa
    // fase ya es un resultado definitivo del tribunal, y "puntos por
    // oposición superada SIN PLAZA" da por hecho precisamente que no hay
    // plaza aunque sí haya superado la oposición (ver unify.js). Aprobar dos
    // especialidades en la misma convocatoria 2026 solo cuenta como UNA
    // oposición superada este ciclo, no dos.
    const matchesAprobados = matches.filter((c) => c.estadoOposicion === 'aprobado');
    const aprobo2026 = matchesAprobados.length > 0;

    // Requisito de permanencia si no se está ya en Bloque I: haberse
    // presentado efectivamente a la Parte A de la primera prueba 2026 (ver
    // esNoPresentado en Tabla.tsx — parteA no nulo es justo "se presentó").
    // No encontrar a la persona en ninguna especialidad 2026 cuenta igual que
    // encontrarla con Parte A sin nota: en ambos casos no hay evidencia de
    // que se presentara.
    const presentadoParteA = matches.some((c) => c.parteA != null);

    interino.bloque = interino.calificaciones.length > 0 || aprobo2026 ? 'I' : 'II';
    interino.excluidoPorNoPresentarse = interino.bloque === 'II' && !presentadoParteA;

    if (interino.bloque === 'I') {
      // La nota más alta se actualiza con la nota de OPOSICIÓN de este año en
      // cuanto aprueba (nunca con el concurso, ver notaOposicionDe más
      // arriba) — y en cuanto aprueba ese dato ya es oficial y definitivo,
      // sin esperar a que su tribunal publique la baremación (que no forma
      // parte de esta nota). Solo entraría como provisional en el caso
      // (infrecuente) de que ya tuviera notaMasAlta 0 y todavía no conste
      // como aprobado pero sí con fase 1/2 conocidas.
      const { nota: mejorNota2026, provisional: mejorNotaProvisional } = mejorNotaOposicion(matchesAprobados);
      if (mejorNota2026 != null && mejorNota2026 > interino.notaMasAlta) {
        interino.notaMasAlta = mejorNota2026;
        interino.notaMasAltaProvisional = mejorNotaProvisional;
      }
      interino.ptosOposSuperadas = aprobo2026 ? siguientePuntosOpo(interino.ptosOposSuperadas) : interino.ptosOposSuperadas;
      interino.puntuacionTotal = Math.round((interino.notaMasAlta + interino.experienciaDocente + interino.ptosOposSuperadas) * 10000) / 10000;
    } else {
      // Nota de la ÚLTIMA oposición (2026): solo la fase de oposición, nunca
      // el concurso (ver notaOposicionDe más arriba). Bloque II es, por
      // construcción, quien NO ha aprobado este año (si hubiera aprobado
      // sería Bloque I), así que aquí nunca hay un notaOposicion ya cerrado
      // — siempre es una aproximación a partir de fase 1 y/o fase 2 sueltas,
      // provisional hasta que su tribunal resuelva la fase de oposición (y
      // esta persona pase a Bloque I, o quede definitivamente suspenso). 0 si
      // no hay ni eso.
      const { nota: mejorUltima, provisional: ultimaProvisional } = mejorNotaOposicion(matches);
      interino.notaUltimaOposicion = matches.length > 0 ? mejorUltima ?? 0 : null;
      interino.notaUltimaOposicionProvisional = matches.length > 0 && mejorUltima != null && ultimaProvisional;
      interino.ptosOposSuperadas = 0;
      interino.puntuacionTotal = Math.round(((interino.notaUltimaOposicion ?? 0) + interino.experienciaDocente) * 10000) / 10000;
    }
  }

  // Bloque I y Bloque II son colas independientes (ver docstring): se
  // concatena TODO Bloque I antes que TODO Bloque II para numerar la
  // posición, en vez de mezclarlos en un único sort numérico por puntuación.
  const enBolsa = interinos.filter((i) => !i.excluidoPorPlaza && !i.excluidoPorNoPresentarse);
  const bloqueI = enBolsa.filter((i) => i.bloque === 'I').sort((a, b) => b.puntuacionTotal - a.puntuacionTotal);
  const bloqueII = enBolsa.filter((i) => i.bloque === 'II').sort((a, b) => b.puntuacionTotal - a.puntuacionTotal);
  const ordenados = [...bloqueI, ...bloqueII];
  ordenados.forEach((i, idx) => {
    i.posicion = idx + 1;
  });
  const excluidos = interinos.filter((i) => i.excluidoPorPlaza || i.excluidoPorNoPresentarse);

  const output = {
    generadoEn: new Date().toISOString(),
    especialidades: config.especialidades,
    interinos: [...ordenados, ...excluidos],
  };

  fs.mkdirSync('out', { recursive: true });
  const outPath = path.join('out', 'interinos.json');
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));

  const excluidosPorPlaza = excluidos.filter((i) => i.excluidoPorPlaza).length;
  const excluidosPorNoPresentarse = excluidos.filter((i) => i.excluidoPorNoPresentarse).length;
  console.log(
    `[interinos] ${bloqueI.length} en Bloque I, ${bloqueII.length} en Bloque II, ${excluidosPorPlaza} excluidos por tener ya plaza, ${excluidosPorNoPresentarse} excluidos por no presentarse a la Parte A sin Bloque I. Escrito en ${outPath}`
  );

  return output;
}

// CLI: node interinos.js
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = JSON.parse(fs.readFileSync('config/interinos.json', 'utf8'));
  await runInterinos(config);

  fs.mkdirSync('../web/src/data', { recursive: true });
  fs.copyFileSync(path.join('out', 'interinos.json'), '../web/src/data/interinos.json');
  console.log('[interinos] copiado a web/src/data/');
}
