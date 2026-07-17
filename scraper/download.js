import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SLUGS = {
  baremacion: 'baremacion',
  faseOposicion: 'fase_oposicion',
  primeraPrueba: 'primera_prueba',
};

async function downloadOne(dir, slug, doc, entryLabel, downloaded) {
  const pdfPath = path.join(dir, `${slug}.pdf`);
  const metaPath = path.join(dir, `${slug}.meta.json`);

  const prevMeta = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, 'utf8')) : null;
  if (prevMeta?.ts === doc.ts && fs.existsSync(pdfPath)) {
    downloaded.push({ tribunal: entryLabel, tipo: slug, path: pdfPath, changed: false });
    return;
  }

  const res = await fetch(doc.url);
  if (!res.ok) {
    console.warn(`[download] fallo al descargar ${doc.url}: HTTP ${res.status}`);
    return;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(pdfPath, buf);
  fs.writeFileSync(metaPath, JSON.stringify({ url: doc.url, ts: doc.ts, titulo: doc.titulo }, null, 2));
  console.log(`[download] ${entryLabel}/${slug}: descargado (${buf.length} bytes)`);
  downloaded.push({ tribunal: entryLabel, tipo: slug, path: pdfPath, changed: true });
}

/**
 * Descarga los PDFs referenciados en el manifiesto de discover.js a
 * raw/{especialidad}/{tribunal}/{tipo}.pdf, saltando los que ya están
 * descargados con el mismo timestamp (no ha habido publicación nueva).
 * La segunda prueba es la excepción: el tribunal la publica en tandas por
 * fecha, así que cada documento del manifiesto se guarda por separado como
 * segunda_prueba_{ts}.pdf en vez de pisar siempre el mismo fichero.
 * @returns {Promise<Array<{tribunal:string, tipo:string, path:string}>>} rutas descargadas/reutilizadas
 */
export async function download(especialidadKey) {
  const manifestPath = path.join('raw', especialidadKey, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  const downloaded = [];

  for (const entry of manifest.tribunales) {
    const dir = path.join('raw', especialidadKey, entry.tribunal);
    fs.mkdirSync(dir, { recursive: true });

    for (const tipo of Object.keys(SLUGS)) {
      const doc = entry[tipo];
      if (!doc) continue;
      await downloadOne(dir, SLUGS[tipo], doc, entry.tribunal, downloaded);
    }

    for (const doc of entry.segundaPrueba ?? []) {
      await downloadOne(dir, `segunda_prueba_${doc.ts}`, doc, entry.tribunal, downloaded);
    }
  }

  return downloaded;
}

// CLI: node download.js <especialidad>
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const key = process.argv[2];
  if (!key) {
    console.error('Uso: node download.js <especialidad>');
    process.exit(1);
  }
  await download(key);
}
