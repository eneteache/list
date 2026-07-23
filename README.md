# Listado unificado de oposiciones — Región de Murcia

Web no oficial que unifica, para las 8 especialidades convocadas del cuerpo de Maestros en la Región de Murcia (OPOPRI26), las notas de la fase de concurso y de la fase de oposición publicadas tribunal por tribunal en [servicios.educarm.es](https://servicios.educarm.es), en una única tabla ordenable y con buscador por especialidad, con la nota de corte según el nº de plazas configurado.

## Estructura

- `scraper/` — pipeline en Node que descubre, descarga y parsea los PDFs publicados por educarm y genera un JSON unificado por especialidad.
- `web/` — frontend estático (Vite + React) que consume esos JSON: tabla con búsqueda/orden y una vista de estadísticas.
- `.github/workflows/publish.yml` — Action programada (cada 4h) que reejecuta el pipeline completo (scraper + rebaremación de interinos + cruce con la lista oficial de interinos), commitea los datos si han cambiado, y publica `web/` en GitHub Pages; se salta el scraping sola en cuanto todos los tribunales de las 8 especialidades ya han publicado baremación y fase de oposición (la tabla principal ya no puede cambiar más); también se dispara con cada push a `main` que toque `web/` (sin volver a scrapear) y manualmente desde la pestaña Actions ("Run workflow", que siempre scrapea con independencia de si ya estaba completo).

## Uso local

```bash
cd scraper
npm install
npx playwright install chromium   # solo la primera vez
node run.js --all                 # descubre, descarga, parsea y copia el dataset de las 8 especialidades a web/src/data/
# o node run.js primaria          # solo una especialidad

cd ../web
npm install
npm run dev
```

Las 8 especialidades convocadas (`scraper/config/especialidades.json`) ya tienen su código de educarm, convocatoria y nº de plazas oficial (BORM nº 18/2026, Orden de 21 de enero de 2026, art. 3.4). Para añadir una especialidad nueva: añade una entrada análoga y ejecuta `node run.js <clave>`. El selector de especialidad del frontend aparece automáticamente en cuanto hay más de un dataset generado.

## Lista de interinos

Además de los resultados de la oposición, `scraper/interinos.js` genera **un único** listado (no uno por especialidad) a partir del Anexo I que publica la CARM — un único documento regional con todos los aspirantes acreditados en cualquiera de las 9 especialidades del cuerpo (038-039 incluida Alemán, sin plazas convocadas este año). Cada aspirante lleva sus especialidades acreditadas, con las que se puede filtrar la tabla en la web (incluida la opción "Todas").

```bash
cd scraper
node interinos.js      # necesita out/<especialidad>.json ya generado (node run.js --all), para rebaremar/excluir contra la oposición del año en curso
```

Por cada aspirante se calcula su **puntuación de bolsa ya rebaremada con los resultados de la oposición del año en curso**, en dos colas independientes (Bloque I se llama entero antes que Bloque II, con independencia de la puntuación de cada uno):

- **Bloque I** (ya tiene, esta convocatoria incluida, alguna oposición superada desde el año 2000 en la especialidad): nota más alta de esas oposiciones superadas + experiencia docente (topada a 10 puntos según el Acuerdo de Personal Docente Interino) + puntos por nº de oposiciones superadas (1/1,5/1,5/2, tope 6 — sube un escalón si aprueba también este año).
- **Bloque II** (nunca la ha superado): nota de la última oposición (la del año en curso, aunque sea un suspenso) + experiencia docente.

Se excluye de la bolsa (se listan igual, marcados) a quien **ya obtiene plaza definitiva** —nota final real, con concurso y oposición ya resueltos; ir dentro del nº de plazas con una nota todavía provisional no cuenta, puede cambiar o quedar sin cubrir— en **cualquier** especialidad de la oposición del año en curso, y a quien estando en Bloque II **no se ha presentado efectivamente a la Parte A de la primera prueba** de este año en ninguna especialidad acreditada (requisito de permanencia si no se está ya en Bloque I).

La nota que aporta la convocatoria del año en curso es **siempre la de la fase de oposición, nunca el concurso** (que ya cuenta aparte en la bolsa vía experiencia docente y puntos por oposiciones superadas — sumarlo también en la nota lo contaría dos veces): en cuanto un tribunal resuelve la fase de oposición para una persona (aprobados o suspensos definitivos) esa nota ya es cerrada, sin esperar a que se publique la baremación del concurso; hasta entonces se usa una aproximación provisional a partir de fase 1 y/o fase 2 sueltas, que se corrige sola en cuanto el tribunal publique más datos y se regenere este listado.

Esta puntuación sigue siendo aproximada, no el orden oficial: el Anexo I no indica a qué especialidad concreta corresponde cada calificación histórica cuando alguien está acreditado en varias, así que la nota más alta / bloque se calculan igual para todas sus especialidades acreditadas; y "ya tiene oposición superada desde 2000" se aproxima con las calificaciones que trae el propio Anexo I, no con el registro administrativo del Bloque I vigente (que este scraper no tiene forma de consultar).

A diferencia de los documentos por tribunal, el Anexo I es un enlace de descarga suelto sin mecanismo de descubrimiento automático: la URL vive en `scraper/config/interinos.json` (se cachea una sola vez en `raw/interinos/anexo.pdf`) y hay que actualizarla a mano cuando la CARM republique la lista, borrando el PDF cacheado para forzar una descarga nueva.

## Lista de interinos (oficial)

Una vez la CARM publica la Resolución que fija la lista **provisional oficial** de interinos para el curso siguiente (Anexo I = Bloque I, Anexo II = Bloque II, ya con la puntuación calculada por la propia Administración — a diferencia del Anexo I de más arriba, que es un documento previo de la fase de exposición pública sin puntuación cerrada), `scraper/interinos-oficial.js` genera un **segundo listado independiente** a partir de ese documento, sin recalcular nada:

```bash
cd scraper
node interinos-oficial.js   # necesita out/<especialidad>.json ya generado (node run.js --all), para cruzar contra la oposición del año en curso
```

Incluye a **todos** los aspirantes de Anexo I/II (varios miles, en las 9 especialidades del cuerpo), sin excluir a nadie: el resuelvo undécimo de la propia Resolución dice que la lista definitiva de interinidad para el curso siguiente "estará formada exclusivamente por aquellos aspirantes que cumplan los requisitos establecidos en el artículo 96" (acreditación de méritos) — nada exige haberse presentado también a la oposición del año en curso, que es un procedimiento selectivo aparte. Por eso, a diferencia de una versión anterior de este listado, **no se filtra por ser opositor** ni se excluye automáticamente a quien ya tiene plaza: esas decisiones quedan para quien mira la tabla, vía el botón "Eliminar los que optan por plaza" en la web.

Cuando un aspirante SÍ es opositor de la convocatoria en curso (cruzado por NIF enmascarado + nombre, igual que la rebaremación de más arriba), cada fila añade a sus datos oficiales de bolsa (bloque, puesto real dentro de su bloque, nota, experiencia docente, puntuación total) la especialidad concreta por la que ha optado este año (por la que se ha presentado a examen, columna "Esp. opta") y su estado en ella — no siempre coincide con sus especialidades acreditadas en la bolsa; si se presenta a más de una especialidad el mismo año (infrecuente) se toma la de código más bajo como principal. Quien no es opositor este año queda con esa columna en blanco, sin que eso le quite su sitio en el listado. El campo `plazaOpta` marca si, con la nota que se conoce hasta ahora (definitiva o todavía provisional), hoy iría dentro del nº de plazas de su especialidad opta — es la base del botón "Eliminar los que optan por plaza" de la web, que esconde a esas personas de forma reversible y renumera al vuelo las dos columnas de orden que se muestran: "# general" (puesto entre todos los aspirantes visibles, sea cual sea su especialidad) y "# especialidad" (puesto solo entre quienes optan a la misma especialidad, fijo con independencia del filtro de especialidad elegido — en blanco quien no opositó). El puesto real en la Resolución (con huecos si se ha filtrado) se conserva en el tooltip de "# general".

Igual que el Anexo I de la fase de exposición pública, la URL de esta Resolución vive suelta en `scraper/config/interinos-oficial.json` (se cachea en `raw/interinos-oficial/resolucion.pdf`) y hay que actualizarla a mano — borrando el PDF cacheado para forzar una descarga nueva — cuando la CARM publique una versión nueva (tras resolver alegaciones, o la lista definitiva).

## Nº de plazas y turnos

Turno general (ingreso libre) y turno de reserva para personas con discapacidad son cupos **independientes** (art. 3.4 y 42 de la convocatoria): cada uno compite solo contra los de su propio turno, con su propia nota de corte, y una plaza de discapacidad que queda vacante **no** se cubre con turno general (se acumula, por una sola vez, al turno de discapacidad de la convocatoria siguiente). Por eso `scraper/config/especialidades.json` guarda `plazasGeneral` y `plazasDiscapacidad` por separado en vez de un único total, y cada candidato lleva su `turno` (`general` | `discapacidad`, deducido de la columna "Acceso" que publica cada tribunal — código 1 = turno libre, código 2 = reserva discapacidad) para no mezclar ambos rankings. Si se añade una especialidad nueva sin estos datos (`null`), la web muestra el ranking y las notas de ese turno pero no puede marcar quién obtiene plaza ni calcular su nota de corte — y `interinos.js` no podrá excluir de la bolsa a nadie de esa especialidad hasta que se rellenen.

## Desplegar

- **GitHub Pages** (como está configurado ahora mismo): repo público, Settings → Pages → Source = "GitHub Actions". `.github/workflows/publish.yml` hace todo solo — no requiere secretos adicionales (usa el `GITHUB_TOKEN` por defecto tanto para commitear los datos como para publicar) y no depende de que tu ordenador esté encendido.
- **Vercel/Netlify/Cloudflare Pages** (alternativa): crear un proyecto nuevo apuntando a este repo con **Root Directory = `web`** (detectan Vite automáticamente). Cada push a la rama principal —incluidos los commits automáticos de `publish.yml`— dispara un redeploy; en ese caso puedes quitar los jobs `deploy`/`configure-pages`/`upload-pages-artifact` de `publish.yml`, ya no harían falta.

## Limitaciones conocidas

- El scraping depende de que la estructura HTML/AJAX del portal de educarm no cambie; si educarm rediseña el formulario, `scraper/lib/educarm.js` habrá que revisarlo.
- El parser de PDFs (`scraper/lib/pdf.js`, `scraper/parse.js`) se ha validado contra los documentos reales de las 8 especialidades de OPOPRI26, pero conviene contrastar puntualmente alguna fila contra el PDF oficial si en el futuro cambia el maquetado.
- Un candidato solo aparece con nota final cuando su tribunal ha publicado **tanto** el documento de baremación (concurso) como el de fase de oposición; hasta entonces se marca como "pendiente" en vez de asumir un resultado.
- Herramienta no oficial: no sustituye la publicación oficial de los tribunales.
- La rebaremación de la lista de interinos (exclusión por plaza, Bloque I/II, exclusión por no presentarse) cruza por NIF enmascarado + nombre (tolerando acentos/ñ y la abreviatura "Mª", que varían entre el Anexo I y los documentos por tribunal); un apodo distinto de pila (p. ej. "Mari Carmen" en vez de "María del Carmen") puede no detectarse y dejar a esa persona sin actualizar/excluir.
- La puntuación de la lista de interinos es informativa, no el orden oficial de la bolsa (ver sección "Lista de interinos" más arriba): a quien está acreditado en varias especialidades se le aplica la misma nota histórica y el mismo bloque en todas, y "Bloque I" se aproxima con las calificaciones del Anexo I, no con el registro administrativo del Bloque I vigente.
- La lista de interinos oficial (ver sección homónima) sí trae la puntuación tal cual la publica la CARM, pero el cruce con los opositores 2026 (y por tanto la columna "Esp. opta" y el campo `plazaOpta` que usa el botón "Eliminar los que optan por plaza") usa el mismo cruce por NIF enmascarado + nombre que el resto del proyecto, con la misma limitación: un apodo de pila distinto entre documentos puede dejar a alguien sin detectar como opositor. A diferencia de otros cruces del proyecto esto no hace desaparecer a nadie del listado (sigue apareciendo con "Esp. opta" en blanco), pero si esa persona ya tuviera plaza, el botón no la escondería.
- El campo `generadoEn` de cada dataset solo se actualiza cuando el contenido cambia de verdad respecto a la última vez (ver `scraper/lib/generadoEn.js`): si el pipeline se reejecuta (p.ej. la Action programada cada 4h) sin datos nuevos que scrapear, la fecha que se ve en la web sigue siendo la de la última actualización real, no la de la última ejecución.
