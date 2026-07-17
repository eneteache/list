import { chromium } from 'playwright';

function formUrl(anyo, convocatoria) {
  return `https://servicios.educarm.es/admin/index2.php?aplicacion=PUBLICACIONES_TRIBUNALES&module=publicacionesTribunales&anyo=${anyo}&convocatoria=${convocatoria}`;
}

/**
 * Abre el formulario de búsqueda de educarm y devuelve los códigos de tribunal
 * disponibles para un cuerpo+especialidad dados (el sitio los sirve vía AJAX
 * protegido por Incapsula, por eso hace falta un navegador real, no fetch()).
 */
export async function listTribunales({ anyo, convocatoria, codCuerpo, codEspecialidad }) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(formUrl(anyo, convocatoria), { waitUntil: 'networkidle' });
    await page.selectOption('#cuerpos_lista', codCuerpo);
    await page.waitForTimeout(800);
    await page.selectOption('#especialidades_lista', codEspecialidad);
    await page.waitForTimeout(800);
    const tribunales = await page.evaluate(() =>
      Array.from(document.querySelectorAll('#tribunales_lista option'))
        .map((o) => o.value)
        .filter(Boolean)
    );
    return tribunales;
  } finally {
    await browser.close();
  }
}

async function fetchOne(page, { anyo, convocatoria, codCuerpo, codEspecialidad, tribunal }) {
  await page.goto(formUrl(anyo, convocatoria), { waitUntil: 'networkidle' });
  await page.selectOption('#cuerpos_lista', codCuerpo);
  await page.waitForTimeout(500);
  await page.selectOption('#especialidades_lista', codEspecialidad);
  await page.waitForTimeout(500);
  await page.selectOption('#tribunales_lista', tribunal);
  await page.waitForTimeout(300);
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle', timeout: 20000 }),
    page.click('#botonBusquedaGenerica'),
  ]);

  return page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('table.fichadatosvcal tbody tr'));
    return rows
      .map((row) => {
        const link = row.querySelector('a[href$=".pdf"]');
        if (!link) return null;
        const cells = Array.from(row.querySelectorAll('td')).map((td) => td.textContent.trim());
        return { url: link.href, titulo: cells[2] || '', fechaPublicacion: cells[3] || '' };
      })
      .filter(Boolean);
  });
}

/**
 * Para cada tribunal de la lista, rellena y envía el formulario de búsqueda y
 * extrae los enlaces a documentos publicados (PDFs) junto a su título visible.
 * Lanza varias pestañas del mismo navegador en paralelo (limitadas por
 * `concurrency`) en vez de consultar los tribunales uno a uno — es la parte
 * lenta del pipeline porque toca abrir una página real por cada consulta.
 */
export async function fetchPublicaciones({
  anyo,
  convocatoria,
  codCuerpo,
  codEspecialidad,
  tribunales,
  onProgress,
  concurrency = 6,
}) {
  const browser = await chromium.launch();
  const results = new Array(tribunales.length);
  let nextIndex = 0;

  async function worker() {
    const page = await browser.newPage();
    try {
      while (true) {
        const i = nextIndex++;
        if (i >= tribunales.length) break;
        const tribunal = tribunales[i];

        let docs = null;
        for (let attempt = 1; attempt <= 2 && docs === null; attempt++) {
          try {
            docs = await fetchOne(page, { anyo, convocatoria, codCuerpo, codEspecialidad, tribunal });
          } catch (err) {
            console.warn(`[educarm] tribunal ${tribunal}: fallo al consultar (intento ${attempt}/2): ${err.message}`);
          }
        }

        results[i] = { tribunal, docs: docs ?? [], ok: docs !== null };
        onProgress?.(tribunal, docs?.length ?? 0);
      }
    } finally {
      await page.close();
    }
  }

  try {
    const workerCount = Math.min(concurrency, tribunales.length);
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    return results;
  } finally {
    await browser.close();
  }
}
