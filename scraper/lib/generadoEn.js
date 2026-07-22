import fs from 'node:fs';

/**
 * El pipeline se reejecuta cada 4h (ver .github/workflows/publish.yml)
 * aunque no haya datos nuevos que scrapear (PDFs ya cacheados sin cambios),
 * y `generadoEn: new Date().toISOString()` puesto a pelo hace que la web
 * muestre "Datos generados: hace un momento" cada vez, aunque el contenido
 * sea idéntico al de la última vez — engañoso para quien mira esa fecha
 * pensando que hay algo nuevo. Aquí se compara el `output` recién calculado
 * contra el `outPath` ya existente (ignorando el propio campo `generadoEn`
 * de ambos) y, si son iguales, se conserva la fecha anterior en vez de
 * pisarla con la de ahora mismo.
 */
export function conGeneradoEnEstable(outPath, output) {
  if (!fs.existsSync(outPath)) return output;
  let anterior;
  try {
    anterior = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  } catch {
    return output; // fichero previo corrupto: se trata como si hubiera cambios
  }
  const { generadoEn: _generadoEnAnterior, ...restoAnterior } = anterior;
  const { generadoEn: _generadoEnNuevo, ...restoNuevo } = output;
  if (JSON.stringify(restoAnterior) === JSON.stringify(restoNuevo)) {
    return { ...output, generadoEn: anterior.generadoEn };
  }
  return output;
}
