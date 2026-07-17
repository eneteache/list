import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { discover } from './discover.js';
import { download } from './download.js';
import { unify } from './unify.js';

/** Orquesta el pipeline completo (discover -> download -> unify) para una especialidad. */
export async function run(especialidadKey) {
  const config = JSON.parse(fs.readFileSync('config/especialidades.json', 'utf8'));
  if (!config[especialidadKey]) {
    throw new Error(`Especialidad desconocida: "${especialidadKey}". Revisa config/especialidades.json`);
  }

  await discover(especialidadKey, config);
  await download(especialidadKey);
  const result = await unify(especialidadKey, config);

  // Copia el dataset generado al frontend para que el build de Vite lo incluya.
  fs.mkdirSync('../web/src/data', { recursive: true });
  fs.copyFileSync(`out/${especialidadKey}.json`, `../web/src/data/${especialidadKey}.json`);

  updateManifestFrontend(config);

  return result;
}

/** Regenera web/src/data/manifest.json con las especialidades que ya tienen dataset generado. */
function updateManifestFrontend(config) {
  const especialidades = Object.entries(config)
    .filter(([key]) => fs.existsSync(`out/${key}.json`))
    .map(([key, esp]) => ({ key, nombre: esp.nombre }));
  fs.writeFileSync('../web/src/data/manifest.json', JSON.stringify({ especialidades }, null, 2));
}

// CLI: node run.js <especialidad>  (o "node run.js --all" para todas las de la config)
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = process.argv[2];
  if (!arg) {
    console.error('Uso: node run.js <especialidad> | node run.js --all');
    process.exit(1);
  }
  if (arg === '--all') {
    const config = JSON.parse(fs.readFileSync('config/especialidades.json', 'utf8'));
    for (const key of Object.keys(config)) {
      console.log(`\n=== ${key} ===`);
      await run(key);
    }
  } else {
    await run(arg);
  }
}
