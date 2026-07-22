import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseBaremacion, parseFaseOposicion, parsePrimeraPrueba, parseSegundaPrueba } from './parse.js';
import { groupByNif, agruparPorPersona, pickMatch } from './lib/personas.js';
import { conGeneradoEnEstable } from './lib/generadoEn.js';

const PESO_CONCURSO = 1 / 3;
const PESO_OPOSICION = 2 / 3;

// Código "Acceso" tal como lo imprime educarm en cada fila (columna Acceso,
// valores "1"/"2"): mapeo oficial usado en la solicitud telemática de esta
// convocatoria (BORM nº 18/2026, Orden de 21 de enero de 2026) — código 1
// "Acceso libre", código 2 "Acceso de Reserva para personas con discapacidad".
const TURNO_POR_ACCESO = { 1: 'general', 2: 'discapacidad' };

/**
 * Cruza las cuatro fuentes de UN tribunal (primera prueba, segunda prueba,
 * fase de oposición ya combinada, y baremación/concurso) aplicando las reglas
 * de negocio:
 *  - Si suspende la primera prueba (aparece en ese listado sin puntuación:
 *    "-"/NP), queda excluido y NO se hace media, aunque el tribunal todavía no
 *    haya publicado el resultado combinado de la fase de oposición — ese dato
 *    ya es definitivo en cuanto se publica la primera prueba.
 *  - Si supera la primera prueba pero no aparece en el listado de aprobados de
 *    la fase de oposición (y ese listado ya está publicado), también queda
 *    excluido — habrá suspendido la segunda prueba o el conjunto.
 *  - Si el tribunal aún no ha publicado el documento que haría falta para
 *    saber cuál de los dos casos anteriores aplica, se marca "pendiente" en
 *    vez de asumir un resultado.
 */
function unifyTribunal(tribunal, sources, flags) {
  const primeraPruebaByNif = groupByNif(sources.primeraPrueba);
  const segundaPruebaByNif = groupByNif(sources.segundaPrueba);
  const faseOposicionByNif = groupByNif(sources.faseOposicion);
  const baremacionByNif = groupByNif(sources.baremacion);

  const nifs = new Set([
    ...primeraPruebaByNif.keys(),
    ...faseOposicionByNif.keys(),
    ...baremacionByNif.keys(),
    ...segundaPruebaByNif.keys(),
  ]);

  const candidatos = [];
  for (const nif of nifs) {
    const filasP1 = primeraPruebaByNif.get(nif) ?? [];
    const filasP2 = segundaPruebaByNif.get(nif) ?? [];
    const filasOp = faseOposicionByNif.get(nif) ?? [];
    const filasCon = baremacionByNif.get(nif) ?? [];

    // Caso normal (ninguna fuente tiene más de una fila para este NIF): un
    // único grupo con un único nombre y ya está. Caso colisión: agruparPorPersona
    // separa los nombres incompatibles entre sí en tantos grupos como personas
    // distintas comparten el NIF enmascarado, y se genera un candidato por grupo.
    const grupos = agruparPorPersona([...filasP1, ...filasP2, ...filasOp, ...filasCon].map((r) => r.nombre));

    for (const grupo of grupos) {
      const p1 = pickMatch(filasP1, grupo.miembros);
      const p2 = pickMatch(filasP2, grupo.miembros);
      const op = pickMatch(filasOp, grupo.miembros);
      const con = pickMatch(filasCon, grupo.miembros);

      const nombre = grupo.referencia;

      const notaFase1 = p1?.notaFase1 ?? null;
      const notaFase2 = p2?.notaFase2 ?? null;
      const notaOposicion = op?.notaOposicion ?? null;
      const notaConcurso = con?.notaConcurso ?? null;
      // Parte A y Parte B de la primera prueba, por separado: hacen falta
      // para distinguir "no presentado" (ninguna de las dos tiene nota) de
      // "presentado pero no le hace media" (notaFase1 en blanco pese a tener
      // nota en alguna de las dos partes) — ver EstadoBadge en Tabla.tsx.
      const parteA = p1?.parteA ?? null;
      const parteB = p1?.parteB ?? null;
      // Nº de orden del candidato tal como lo publica el tribunal (útil para
      // localizar la fila en el PDF oficial); puede venir de cualquiera de
      // los documentos por tribunal, todos usan la misma numeración.
      const orden = p1?.orden ?? op?.orden ?? p2?.orden ?? null;
      // Turno de acceso (columna "Acceso"): las plazas de turno general y de
      // discapacidad son cupos independientes que NUNCA se mezclan (art. 3.4 y
      // 42 de la convocatoria) — una plaza de discapacidad que queda vacante
      // no pasa a cubrirse con turno general, así que hace falta saber de cada
      // candidato a qué turno pertenece antes de calcular ranking/plaza.
      const accesoRaw = p1?.acceso ?? p2?.acceso ?? op?.acceso ?? con?.acceso ?? null;
      const turno = accesoRaw != null ? TURNO_POR_ACCESO[accesoRaw] ?? null : null;
      if (turno == null) {
        console.warn(`[unify] ${tribunal}: no se pudo determinar el turno (acceso="${accesoRaw}") de ${nombre} (${nif}) — quedará fuera del ranking de plazas`);
      }

      const suspendePrimeraPrueba = flags.tienePrimeraPrueba && p1 && notaFase1 == null;

      // El listado de "aprobados en fase de oposición" es la fuente más fiable
      // (es el resultado combinado ya definitivo), así que manda sobre lo que se
      // pueda inferir de la primera prueba por separado.
      let estadoOposicion;
      if (flags.tieneFaseOposicion && op) {
        estadoOposicion = 'aprobado';
      } else if (suspendePrimeraPrueba) {
        estadoOposicion = 'suspenso';
      } else if (flags.tieneFaseOposicion && p1 && notaFase1 != null && !op) {
        estadoOposicion = 'suspenso';
      } else {
        estadoOposicion = 'pendiente';
      }

      let notaFinal = null;
      if (estadoOposicion === 'aprobado' && notaConcurso != null) {
        notaFinal = notaConcurso * PESO_CONCURSO + notaOposicion * PESO_OPOSICION;
      }

      // Cuando todavía no hay nota final real, pero se conoce al menos una de
      // las dos partes, se calcula una estimación aplicando el peso de la parte
      // conocida (concurso 1/3, oposición 2/3). Para aproximar la oposición se
      // usa la media de fase 1 y fase 2 cuando se conocen ambas (así es como se
      // calcula el combinado real, ver notaOposicion en tribunales ya resueltos),
      // y si solo se conoce una de las dos, esa sola. Es solo para poder
      // comparar/ordenar candidatos entre sí, NO es una nota oficial.
      let notaFinalAprox = null;
      if (notaFinal == null) {
        let opoConocida = notaOposicion;
        if (opoConocida == null) {
          if (notaFase1 != null && notaFase2 != null) opoConocida = (notaFase1 + notaFase2) / 2;
          else opoConocida = notaFase1 ?? notaFase2;
        }
        if (notaConcurso != null || opoConocida != null) {
          notaFinalAprox = (notaConcurso ?? 0) * PESO_CONCURSO + (opoConocida ?? 0) * PESO_OPOSICION;
        }
      }

      candidatos.push({
        id: `${tribunal}|${nif}|${nombre}`,
        tribunal,
        turno,
        orden,
        nif,
        nombre,
        parteA,
        parteB,
        notaFase1,
        notaFase2,
        notaConcurso,
        apartado1: con?.apartado1 ?? null,
        apartado2: con?.apartado2 ?? null,
        apartado3: con?.apartado3 ?? null,
        notaOposicion,
        estadoOposicion,
        notaFinal: notaFinal != null ? Math.round(notaFinal * 10000) / 10000 : null,
        notaFinalAprox: notaFinalAprox != null ? Math.round(notaFinalAprox * 10000) / 10000 : null,
      });
    }
  }
  return candidatos;
}

/**
 * Procesa todos los tribunales descargados de una especialidad y produce el
 * ranking unificado: todos los candidatos con nota final ordenados de mayor
 * a menor, con la marca de plaza obtenida según el nº de plazas configurado.
 */
export async function unify(especialidadKey, config) {
  const esp = config[especialidadKey];
  const rawDir = path.join('raw', especialidadKey);
  const manifest = JSON.parse(fs.readFileSync(path.join(rawDir, 'manifest.json'), 'utf8'));

  let candidatos = [];
  const tribunalesInfo = [];

  for (const entry of manifest.tribunales) {
    const dir = path.join(rawDir, entry.tribunal);
    const paths = {
      baremacion: path.join(dir, 'baremacion.pdf'),
      faseOposicion: path.join(dir, 'fase_oposicion.pdf'),
      primeraPrueba: path.join(dir, 'primera_prueba.pdf'),
    };

    const flags = Object.fromEntries(
      Object.entries(paths).map(([tipo, p]) => [`tiene${tipo[0].toUpperCase()}${tipo.slice(1)}`, fs.existsSync(p)])
    );

    // A diferencia de baremación/primera prueba/fase de oposición (cada una
    // un listado "definitivo" acumulativo que se va corrigiendo), la segunda
    // prueba la publica el tribunal en tandas por fecha/sesión de examen, y
    // cada PDF trae solo esa tanda — no es una revisión de la anterior. Hay
    // que descargarlas y sumarlas TODAS o se pierde la nota de quien examinó
    // en una tanda que no sea la última.
    const segundaPruebaPaths = fs.existsSync(dir)
      ? fs
          .readdirSync(dir)
          .filter((f) => f.startsWith('segunda_prueba_') && f.endsWith('.pdf'))
          .sort()
          .map((f) => path.join(dir, f))
      : [];
    flags.tieneSegundaPrueba = segundaPruebaPaths.length > 0;

    let segundaPruebaRows = null;
    if (flags.tieneSegundaPrueba) {
      // Clave nif+nombre, NO solo nif: el NIF enmascarado puede coincidir
      // entre dos personas distintas del mismo tribunal (ver lib/personas.js),
      // y si se deduplica solo por NIF, la fila de una persona se sobreescribe
      // silenciosamente con la de la otra en cuanto comparten NIF enmascarado
      // — perdiendo su nota de fase 2 aunque sí aparezca en el resto de
      // documentos. agruparPorPersona/pickMatch, más abajo, ya sabe separar
      // dos personas con el mismo NIF por nombre; aquí solo hace falta no
      // destruir esa distinción antes de llegar allí.
      const porNifNombre = new Map();
      for (const p of segundaPruebaPaths) {
        const { rows } = await parseSegundaPrueba(p);
        for (const r of rows) porNifNombre.set(`${r.nif}|${r.nombre}`, r);
      }
      segundaPruebaRows = [...porNifNombre.values()];
    }

    const sources = {
      baremacion: flags.tieneBaremacion ? (await parseBaremacion(paths.baremacion)).rows : null,
      faseOposicion: flags.tieneFaseOposicion ? (await parseFaseOposicion(paths.faseOposicion)).rows : null,
      primeraPrueba: flags.tienePrimeraPrueba ? (await parsePrimeraPrueba(paths.primeraPrueba)).rows : null,
      segundaPrueba: segundaPruebaRows,
    };

    const rows = unifyTribunal(entry.tribunal, sources, flags);
    candidatos.push(...rows);

    tribunalesInfo.push({ tribunal: entry.tribunal, ...flags, nCandidatos: rows.length });
  }

  // Ranking: nota final real si ya existe, si no la estimación provisional
  // (notaFinalAprox) — un mismo ranking por número, sin separar "primero los
  // reales, luego los provisionales". Solo entran quienes siguen en la carrera
  // (aprobado, o pendiente de que su tribunal publique algo más). Un suspenso
  // puede tener una notaFinalAprox informativa (lo que llevaba antes de
  // suspender) pero NUNCA una posición ni una plaza — ya sabemos con certeza
  // que queda fuera, no es una incógnita que ponderar.
  const rankingValue = (c) => c.notaFinal ?? c.notaFinalAprox;
  const enCarrera = (c) => c.estadoOposicion !== 'suspenso' && rankingValue(c) != null;

  // Turno general y turno de reserva para personas con discapacidad son cupos
  // independientes (art. 3.4 y 42 de la convocatoria): cada uno compite solo
  // contra los de su propio turno, con su propio nº de plazas y su propia
  // nota de corte — una plaza de discapacidad que queda vacante NO se cubre
  // con turno general (ni al revés), así que NUNCA se calcula un ranking
  // conjunto de los dos turnos.
  function calcularTurno(turnoNombre, plazasTurno) {
    const delTurno = candidatos.filter((c) => c.turno === turnoNombre);
    const conNota = delTurno.filter(enCarrera).sort((a, b) => rankingValue(b) - rankingValue(a));
    const sinNota = delTurno.filter((c) => !enCarrera(c));

    conNota.forEach((c, i) => {
      c.posicion = i + 1;
      // La posición (y por tanto la plaza) se apoya en una nota provisional
      // cuando todavía no hay notaFinal real — puede cambiar cuando se
      // publique lo que falte, así que se marca para no presentarla como
      // definitiva.
      c.posicionProvisional = c.notaFinal == null;
      c.plazaObtenida = plazasTurno != null ? i < plazasTurno : null;
    });

    let notaCorte = null;
    let notaCorteProvisional = null;
    if (plazasTurno != null) {
      if (conNota.length >= plazasTurno) {
        notaCorte = rankingValue(conNota[plazasTurno - 1]) ?? null;
        notaCorteProvisional = conNota[plazasTurno - 1]?.posicionProvisional ?? null;
      } else {
        // Menos aprobados que plazas en este turno: no hay a nadie a quien
        // dejar fuera, así que la nota de corte es la última (más baja) nota
        // de quien ya ha aprobado la fase de oposición, no un "sin corte
        // todavía" — a diferencia de "pendiente", "aprobado" es un resultado
        // ya definitivo del tribunal.
        const aprobados = conNota.filter((c) => c.estadoOposicion === 'aprobado');
        const ultimoAprobado = aprobados[aprobados.length - 1];
        if (ultimoAprobado) {
          notaCorte = rankingValue(ultimoAprobado) ?? null;
          notaCorteProvisional = ultimoAprobado.posicionProvisional ?? null;
        }
      }
    }

    return { plazas: plazasTurno, notaCorte, notaCorteProvisional, candidatos: [...conNota, ...sinNota] };
  }

  const general = calcularTurno('general', esp.plazasGeneral);
  const discapacidad = calcularTurno('discapacidad', esp.plazasDiscapacidad);
  // No debería ocurrir en la práctica (la columna Acceso siempre trae "1" o
  // "2"), pero si algún día no se puede determinar el turno de alguien se
  // deja fuera del ranking de plazas en vez de asumir uno de los dos turnos.
  const sinTurno = candidatos.filter((c) => c.turno == null);
  if (sinTurno.length > 0) {
    console.warn(
      `[unify] ${especialidadKey}: ${sinTurno.length} candidatos sin turno determinado, quedan fuera del ranking de plazas`
    );
  }

  const output = {
    especialidad: especialidadKey,
    nombreEspecialidad: esp.nombre,
    convocatoria: esp.convocatoria,
    general: { plazas: general.plazas, notaCorte: general.notaCorte, notaCorteProvisional: general.notaCorteProvisional },
    discapacidad: {
      plazas: discapacidad.plazas,
      notaCorte: discapacidad.notaCorte,
      notaCorteProvisional: discapacidad.notaCorteProvisional,
    },
    generadoEn: new Date().toISOString(),
    tribunales: tribunalesInfo,
    candidatos: [...general.candidatos, ...discapacidad.candidatos, ...sinTurno],
  };

  const outPath = path.join('out', `${especialidadKey}.json`);
  const outputEstable = conGeneradoEnEstable(outPath, output);
  fs.mkdirSync('out', { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(outputEstable, null, 2));

  const todosEnCarrera = [...general.candidatos, ...discapacidad.candidatos].filter(enCarrera);
  const conNotaReal = todosEnCarrera.filter((c) => c.notaFinal != null).length;
  const conNotaProvisional = todosEnCarrera.length - conNotaReal;
  const suspensos = candidatos.filter((c) => c.estadoOposicion === 'suspenso').length;
  console.log(
    `[unify] ${especialidadKey}: ${conNotaReal} con nota final real, ${conNotaProvisional} con estimación provisional, ${suspensos} sin ninguna nota (suspenso primera prueba). Escrito en ${outPath}`
  );
  if (esp.plazasGeneral == null || esp.plazasDiscapacidad == null) {
    console.warn(
      `[unify] ATENCIÓN: no hay nº de plazas por turno configurado para "${especialidadKey}" — no se puede marcar quién obtiene plaza.`
    );
  }

  return outputEstable;
}

// CLI: node unify.js <especialidad>
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const key = process.argv[2];
  if (!key) {
    console.error('Uso: node unify.js <especialidad>');
    process.exit(1);
  }
  const config = JSON.parse(fs.readFileSync('config/especialidades.json', 'utf8'));
  await unify(key, config);
}
