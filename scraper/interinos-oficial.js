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
 * de exposición pública), genera un listado reducido a quienes son también
 * OPOSITORES de la convocatoria 2026 en curso (cruzando por NIF+nombre contra
 * out/<especialidad>.json de las 8 especialidades convocadas, igual que
 * runInterinos) y que todavía no tienen plaza DEFINITIVA en ninguna de ellas
 * (notaFinal real, concurso y oposición ya resueltos — una estimación
 * provisional dentro del nº de plazas no cuenta, puede cambiar o quedar sin
 * cubrir) — a quien ya la tiene se le "quita" de este listado (no se marca,
 * se excluye del todo): esa persona deja de necesitar la bolsa.
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
    const resultado = [];
    lista.forEach((c, idx) => {
      const candidatosNif = candidatos2026PorNif.get(c.nif) ?? [];
      const matches = candidatosNif.filter((m) => nombresCompatibles(m.nombre, c.nombre));
      if (matches.length === 0) return; // no es opositor 2026 — fuera de este listado

      // Solo cuenta como plaza obtenida la que ya es definitiva: notaFinal
      // real (concurso Y oposición resueltos, ver unify.js), no una
      // estimación provisional (posicionProvisional true, notaFinalAprox) —
      // un "pendiente" puede figurar dentro del nº de plazas con la nota que
      // lleva hasta ahora y acabar sin plaza en cuanto su tribunal resuelva.
      // Tampoco todas las plazas convocadas tienen por qué cubrirse (turno
      // general o de discapacidad pueden quedar con menos aprobados
      // definitivos que plazas), así que no basta con "va dentro del nº de
      // plazas" sin más.
      const tienePlaza = matches.some((m) => m.plazaObtenida === true && m.posicionProvisional === false);
      if (tienePlaza) return; // ya tiene plaza definitiva — se "quita" del listado

      // La especialidad por la que ha optado este año (por la que se ha
      // presentado a examen), con su estado en ella — a diferencia de las
      // "especialidades acreditadas" del propio documento oficial (columnas
      // 031-039), que no dicen nada sobre si se ha presentado o no a la
      // oposición 2026. Lo normal es un único match; en el puñado de casos
      // (~0,1%) en que la misma persona se presenta a más de una especialidad
      // el mismo año se toma la de código más bajo como principal — no hay
      // ningún dato en las fuentes que diga cuál es "la" opositada.
      const matchesConEspecialidad = matches.filter((m) => m.especialidadCodigo).sort((a, b) => a.especialidadCodigo.localeCompare(b.especialidadCodigo));
      const principal = matchesConEspecialidad[0];
      if (!principal) return; // no se pudo determinar la especialidad opositada — no aporta nada a este listado

      // Si a día de hoy va dentro del nº de plazas de su especialidad opta,
      // con la nota que se conozca hasta ahora (real o todavía provisional) —
      // a diferencia de `tienePlaza` de más arriba, aquí SÍ vale una
      // estimación provisional: es solo para el botón "Eliminar los que
      // optan por plaza" del frontend (una vista informativa que se puede
      // alternar), no para excluir a nadie del listado de forma permanente.
      // Como `tienePlaza` ya ha descartado cualquier plaza DEFINITIVA, un
      // `plazaOpta: true` aquí es, por construcción, siempre provisional.
      const plazaOpta = principal.plazaObtenida === true;

      resultado.push({
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
        especialidadOpta: principal.especialidadCodigo,
        estadoOpta: principal.estadoOposicion,
        plazaOpta,
      });
    });
    return resultado;
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

  console.log(
    `[interinos-oficial] ${interinos.length} interinos oficiales que también son opositores 2026 sin plaza confirmada (de ${bloqueI.length + bloqueII.length} en la Resolución). Escrito en ${outPath}`
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
