import fs from 'node:fs';
import path from 'node:path';
import { listTribunales, fetchPublicaciones } from './lib/educarm.js';

function normalize(str) {
  return str
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/**
 * Clasifica un documento publicado según el título visible en la web.
 * El texto del título varía ligeramente entre tribunales (p.ej. "Aprobados
 * en la Fase de Oposición" vs "Puntuaciones obtenidas fase oposición"), así
 * que se hace por palabras clave y se excluyen explícitamente las citaciones
 * y avisos de plazo, que también mencionan "oposición" pero no son listados
 * de notas.
 */
export function classifyDoc(titulo) {
  const t = normalize(titulo);
  if (t.includes('citacion') || t.includes('reclamacion') || t.includes('plazo')) return 'otro';
  if (t.includes('baremacion')) return 'baremacion';
  if (t.includes('oposicion') && (t.includes('aprobados') || t.includes('puntuacion') || t.includes('calificacion'))) {
    return 'fase_oposicion';
  }
  if (t.includes('segunda prueba') && t.includes('calificacion')) return 'segunda_prueba';
  // el "superado prueba unica" es un subconjunto (solo aprobados de la primera
  // prueba); el que no dice "superado" trae a TODOS los presentados, incluidos
  // quienes no la superan — es el que necesitamos para no perder a nadie.
  if (t.includes('prueba unica') && !t.includes('superado')) return 'primera_prueba';
  return 'otro';
}

function timestampFromUrl(url) {
  const m = url.match(/_(\d{8})\.pdf$/i);
  return m ? m[1] : '00000000';
}

/**
 * Descubre, para una especialidad, todos sus tribunales y de cada uno el
 * documento MÁS RECIENTE de baremación (concurso) y de fase de oposición.
 * Escribe el manifiesto en scraper/raw/{especialidad}/manifest.json.
 */
export async function discover(especialidadKey, config) {
  const esp = config[especialidadKey];
  if (!esp) throw new Error(`Especialidad desconocida: ${especialidadKey}`);

  console.log(`[discover] ${especialidadKey}: buscando tribunales de ${esp.nombre}...`);
  const tribunales = await listTribunales({
    anyo: esp.anyo,
    convocatoria: esp.convocatoria,
    codCuerpo: esp.codigoCuerpo,
    codEspecialidad: esp.codigoEspecialidad,
  });
  console.log(`[discover] ${tribunales.length} tribunales encontrados: ${tribunales.join(', ')}`);

  const publicaciones = await fetchPublicaciones({
    anyo: esp.anyo,
    convocatoria: esp.convocatoria,
    codCuerpo: esp.codigoCuerpo,
    codEspecialidad: esp.codigoEspecialidad,
    tribunales,
    onProgress: (tribunal, count) => console.log(`[discover]   tribunal ${tribunal}: ${count} documentos`),
  });

  // Si el manifiesto de una ejecución anterior existe, sirve de fallback para
  // los tribunales cuya consulta falle esta vez (mejor mantener el último dato
  // bueno conocido que sobreescribirlo con un "no hay nada" incorrecto).
  const outDir = path.join('raw', especialidadKey);
  const manifestPath = path.join(outDir, 'manifest.json');
  const previousManifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : null;
  const previousByTribunal = new Map((previousManifest?.tribunales ?? []).map((t) => [t.tribunal, t]));

  const manifest = { especialidad: especialidadKey, generadoEn: null, tribunales: [] };

  for (const { tribunal, docs, ok } of publicaciones) {
    if (!ok) {
      const prev = previousByTribunal.get(tribunal);
      console.warn(
        `[discover] tribunal ${tribunal}: no se pudo consultar tras varios intentos — se mantiene el dato de la ejecución anterior`
      );
      manifest.tribunales.push(prev ?? { tribunal, baremacion: null, faseOposicion: null, primeraPrueba: null, segundaPrueba: [] });
      continue;
    }

    const porTipo = { baremacion: [], fase_oposicion: [], primera_prueba: [], segunda_prueba: [] };
    for (const doc of docs) {
      const tipo = classifyDoc(doc.titulo);
      if (tipo === 'otro') continue;
      porTipo[tipo].push({ ...doc, ts: timestampFromUrl(doc.url) });
    }
    const latest = (list) => list.sort((a, b) => (a.ts < b.ts ? 1 : -1))[0] ?? null;

    const baremacion = latest(porTipo.baremacion);
    const faseOposicion = latest(porTipo.fase_oposicion);
    const primeraPrueba = latest(porTipo.primera_prueba);
    // La segunda prueba se publica en tandas por fecha/sesión de examen, no
    // como un único listado acumulativo que se va corrigiendo (a diferencia
    // de los otros tres) — quedarse solo con la más reciente pierde la nota
    // de quien examinó en una tanda anterior. Se guardan todas.
    const segundaPrueba = porTipo.segunda_prueba;

    if (!primeraPrueba) {
      console.warn(`[discover] tribunal ${tribunal}: sin documento de primera prueba todavía`);
    }
    if (!baremacion) {
      console.warn(`[discover] tribunal ${tribunal}: sin documento de baremación (concurso) todavía`);
    }
    if (!faseOposicion) {
      console.warn(`[discover] tribunal ${tribunal}: sin documento de fase de oposición todavía`);
    }

    manifest.tribunales.push({ tribunal, baremacion, faseOposicion, primeraPrueba, segundaPrueba });
  }

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`[discover] manifiesto escrito en ${manifestPath}`);
  return manifest;
}

// CLI: node discover.js <especialidad>
import { pathToFileURL } from 'node:url';
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const key = process.argv[2];
  if (!key) {
    console.error('Uso: node discover.js <especialidad>');
    process.exit(1);
  }
  const config = JSON.parse(fs.readFileSync('config/especialidades.json', 'utf8'));
  await discover(key, config);
}
