import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseListaInterinosOficial } from './parse.js';
import { groupByNif, nombresCompatibles } from './lib/personas.js';
import { conGeneradoEnEstable } from './lib/generadoEn.js';

/**
 * A partir de la Resolución que publica la lista PROVISIONAL OFICIAL de
 * interinos (Anexo I = bloque I, Anexo II = bloque II, ya con la puntuación
 * calculada por la propia CARM — a diferencia de scraper/interinos.js, que
 * aproxima esa misma bolsa desde un documento previo, el Anexo I de la fase
 * de exposición pública), genera un listado con TODOS los aspirantes de
 * Anexo I/II, sin excluir a nadie: el resuelvo undécimo de la propia
 * Resolución dice que la lista definitiva de interinidad para el curso
 * 2026-2027 "estará formada exclusivamente por aquellos aspirantes que
 * cumplan los requisitos establecidos en el artículo 96" — ese artículo trata
 * de acreditación de méritos, no de haberse presentado a la oposición 2026
 * (un procedimiento selectivo aparte); estar en Anexo I/II ya implica cumplir
 * ese requisito, con independencia de si esta persona opta también este año a
 * la oposición. Por eso NO se filtra por ser opositor 2026: se cruza por
 * NIF+nombre contra out/<especialidad>.json (igual que runInterinos) solo
 * para, cuando exista, anotar en qué especialidad opta este año y su estado
 * — especialidadOpta/estadoOpta/plazaOpta quedan a null/false cuando no hay
 * cruce, no se descarta la fila.
 *
 * Tampoco se excluye aquí a quien ya tiene plaza (definitiva o provisional):
 * esa decisión es del frontend, vía el botón "Eliminar los que optan por
 * plaza" (ver InterinosOficial.tsx), para que sea reversible y quede claro
 * cuánta gente afecta en vez de desaparecer en silencio del dataset.
 *
 * A diferencia de runInterinos (que SÍ rebarema y reordena toda la bolsa
 * regional), aquí no se recalcula nada: notaMasAlta/notaActual/experiencia
 * docente/puntuación total y la posición dentro de su bloque son tal cual las
 * publica la propia Resolución — de ahí "oficial" en el nombre del dataset.
 */
export async function runInterinosOficial(config) {
  const dir = path.join('raw', 'interinos-oficial');
  fs.mkdirSync(dir, { recursive: true });
  const pdfPath = path.join(dir, 'resolucion.pdf');

  // Igual que el Anexo I de la fase de exposición pública (ver interinos.js),
  // el enlace de descarga no lleva timestamp: no hay forma de detectar "¿hay
  // una versión nueva?" solo con la URL. Se reutiliza el PDF ya descargado;
  // si la CARM republica la Resolución (p.ej. tras resolver alegaciones, o al
  // publicar la lista definitiva), hay que borrar este fichero a mano (o
  // actualizar la URL en config/interinos-oficial.json) para forzar una
  // descarga nueva.
  if (!fs.existsSync(pdfPath)) {
    console.log(`[interinos-oficial] descargando ${config.url}`);
    const res = await fetch(config.url);
    if (!res.ok) throw new Error(`fallo al descargar ${config.url}: HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(pdfPath, buf);
    console.log(`[interinos-oficial] descargado (${buf.length} bytes)`);
  } else {
    console.log(`[interinos-oficial] usando PDF ya descargado en ${pdfPath} (bórralo para forzar una nueva descarga)`);
  }

  const { bloqueI, bloqueII } = await parseListaInterinosOficial(pdfPath);
  console.log(`[interinos-oficial] parseados ${bloqueI.length} de bloque I y ${bloqueII.length} de bloque II`);

  // Cruce con la oposición 2026: igual que runInterinos, se agregan TODOS los
  // candidatos de las 8 especialidades convocadas ya unificadas, pero aquí
  // además se etiqueta cada uno con la especialidad de la que viene (código
  // 031-039, igual que usa este mismo documento para "especialidades
  // acreditadas") porque, a diferencia de runInterinos, sí hace falta saber
  // en qué especialidad concreta es opositor cada persona para mostrarlo.
  const especialidadesConfig = JSON.parse(fs.readFileSync('config/especialidades.json', 'utf8'));
  const codigoPorEspecialidadKey = {};
  for (const [key, esp] of Object.entries(especialidadesConfig)) {
    const codigo = Object.entries(config.especialidades).find(([, nombre]) => nombre === esp.nombre)?.[0];
    if (codigo) codigoPorEspecialidadKey[key] = codigo;
  }

  const todosCandidatos2026 = [];
  for (const key of Object.keys(especialidadesConfig)) {
    const oposicionPath = path.join('out', `${key}.json`);
    if (!fs.existsSync(oposicionPath)) {
      console.warn(`[interinos-oficial] no se encontró out/${key}.json — no se puede cruzar contra esa especialidad todavía`);
      continue;
    }
    const oposicion = JSON.parse(fs.readFileSync(oposicionPath, 'utf8'));
    for (const c of oposicion.candidatos) {
      todosCandidatos2026.push({ ...c, especialidadCodigo: codigoPorEspecialidadKey[key] ?? null });
    }
  }
  const candidatos2026PorNif = groupByNif(todosCandidatos2026);

  function cruzar(lista, bloque) {
    return lista.map((c, idx) => {
      const candidatosNif = candidatos2026PorNif.get(c.nif) ?? [];
      const matches = candidatosNif.filter((m) => nombresCompatibles(m.nombre, c.nombre));

      // La especialidad por la que ha optado este año (por la que se ha
      // presentado a examen), con su estado en ella — a diferencia de las
      // "especialidades acreditadas" del propio documento oficial (columnas
      // 031-039), que no dicen nada sobre si se ha presentado o no a la
      // oposición 2026. Null cuando no es opositor 2026 (la mayoría: estar en
      // la bolsa no requiere presentarse este año, ver docstring). Lo normal,
      // cuando sí lo es, es un único match; en el puñado de casos (~0,1%) en
      // que la misma persona se presenta a más de una especialidad el mismo
      // año se toma la de código más bajo como principal — no hay ningún dato
      // en las fuentes que diga cuál es "la" opositada.
      const matchesConEspecialidad = matches.filter((m) => m.especialidadCodigo).sort((a, b) => a.especialidadCodigo.localeCompare(b.especialidadCodigo));
      const principal = matchesConEspecialidad[0] ?? null;

      // Si a día de hoy va dentro del nº de plazas de su especialidad opta,
      // con la nota que se conozca hasta ahora (real o todavía provisional).
      // No excluye a nadie aquí: es solo el dato que usa el botón "Eliminar
      // los que optan por plaza" del frontend (ver docstring) para poder
      // esconder, de forma reversible, tanto a quien ya tiene la plaza
      // asegurada como a quien todavía va con una estimación provisional.
      const plazaOpta = principal?.plazaObtenida === true;

      return {
        id: `${c.nif}|${c.nombre}|${bloque}|${idx}`,
        nif: c.nif,
        nombre: c.nombre,
        especialidades: c.especialidades,
        bloque,
        posicionOficial: idx + 1,
        notaMasAlta: bloque === 'I' ? c.notaMasAlta : null,
        notaActual: bloque === 'II' ? c.notaActual : null,
        b1: c.b1,
        b2: c.b2,
        b3: c.b3,
        b4: c.b4,
        experienciaDocente: c.experienciaDocente,
        ptosOposSuperadas: bloque === 'I' ? c.ptosOposSuperadas : null,
        puntuacionTotal: c.puntuacionTotal,
        especialidadOpta: principal?.especialidadCodigo ?? null,
        estadoOpta: principal?.estadoOposicion ?? null,
        plazaOpta,
      };
    });
  }

  const interinos = [...cruzar(bloqueI, 'I'), ...cruzar(bloqueII, 'II')];

  const output = {
    generadoEn: new Date().toISOString(),
    publicadoEn: config.publicadoEn,
    especialidades: config.especialidades,
    interinos,
  };

  fs.mkdirSync('out', { recursive: true });
  const outPath = path.join('out', 'interinos-oficial.json');
  const outputEstable = conGeneradoEnEstable(outPath, output);
  fs.writeFileSync(outPath, JSON.stringify(outputEstable, null, 2));

  const conOpta = interinos.filter((i) => i.especialidadOpta != null).length;
  const conPlazaOpta = interinos.filter((i) => i.plazaOpta).length;
  console.log(
    `[interinos-oficial] ${interinos.length} interinos oficiales (Bloque I: ${bloqueI.length}, Bloque II: ${bloqueII.length}), de los cuales ${conOpta} son también opositores 2026 y ${conPlazaOpta} van hoy dentro del nº de plazas de su especialidad opta. Escrito en ${outPath}`
  );

  return outputEstable;
}

// CLI: node interinos-oficial.js
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = JSON.parse(fs.readFileSync('config/interinos-oficial.json', 'utf8'));
  await runInterinosOficial(config);

  fs.mkdirSync('../web/src/data', { recursive: true });
  fs.copyFileSync(path.join('out', 'interinos-oficial.json'), '../web/src/data/interinos-oficial.json');
  console.log('[interinos-oficial] copiado a web/src/data/');
}
