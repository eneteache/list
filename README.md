# Listado unificado de oposiciones — Región de Murcia

Web no oficial que unifica, para las 8 especialidades convocadas del cuerpo de Maestros en la Región de Murcia (OPOPRI26), las notas de la fase de concurso y de la fase de oposición publicadas tribunal por tribunal en [servicios.educarm.es](https://servicios.educarm.es), en una única tabla ordenable y con buscador por especialidad, con la nota de corte según el nº de plazas configurado.

## Estructura

- `scraper/` — pipeline en Node que descubre, descarga y parsea los PDFs publicados por educarm y genera un JSON unificado por especialidad.
- `web/` — frontend estático (Vite + React) que consume esos JSON: tabla con búsqueda/orden y una vista de estadísticas.
- `.github/workflows/refresh.yml` — Action programada que reejecuta el pipeline cada 4h y commitea los datos si han cambiado.

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

Se excluye de la bolsa (se listan igual, marcados) a quien **ya obtiene plaza** —real o provisional— en **cualquier** especialidad de la oposición del año en curso, y a quien estando en Bloque II **no se ha presentado efectivamente a la Parte A de la primera prueba** de este año en ninguna especialidad acreditada (requisito de permanencia si no se está ya en Bloque I).

La nota que aporta la convocatoria del año en curso es **siempre la de la fase de oposición, nunca el concurso** (que ya cuenta aparte en la bolsa vía experiencia docente y puntos por oposiciones superadas — sumarlo también en la nota lo contaría dos veces): en cuanto un tribunal resuelve la fase de oposición para una persona (aprobados o suspensos definitivos) esa nota ya es cerrada, sin esperar a que se publique la baremación del concurso; hasta entonces se usa una aproximación provisional a partir de fase 1 y/o fase 2 sueltas, que se corrige sola en cuanto el tribunal publique más datos y se regenere este listado.

Esta puntuación sigue siendo aproximada, no el orden oficial: el Anexo I no indica a qué especialidad concreta corresponde cada calificación histórica cuando alguien está acreditado en varias, así que la nota más alta / bloque se calculan igual para todas sus especialidades acreditadas; y "ya tiene oposición superada desde 2000" se aproxima con las calificaciones que trae el propio Anexo I, no con el registro administrativo del Bloque I vigente (que este scraper no tiene forma de consultar).

A diferencia de los documentos por tribunal, el Anexo I es un enlace de descarga suelto sin mecanismo de descubrimiento automático: la URL vive en `scraper/config/interinos.json` (se cachea una sola vez en `raw/interinos/anexo.pdf`) y hay que actualizarla a mano cuando la CARM republique la lista, borrando el PDF cacheado para forzar una descarga nueva.

## Nº de plazas y turnos

Turno general (ingreso libre) y turno de reserva para personas con discapacidad son cupos **independientes** (art. 3.4 y 42 de la convocatoria): cada uno compite solo contra los de su propio turno, con su propia nota de corte, y una plaza de discapacidad que queda vacante **no** se cubre con turno general (se acumula, por una sola vez, al turno de discapacidad de la convocatoria siguiente). Por eso `scraper/config/especialidades.json` guarda `plazasGeneral` y `plazasDiscapacidad` por separado en vez de un único total, y cada candidato lleva su `turno` (`general` | `discapacidad`, deducido de la columna "Acceso" que publica cada tribunal — código 1 = turno libre, código 2 = reserva discapacidad) para no mezclar ambos rankings. Si se añade una especialidad nueva sin estos datos (`null`), la web muestra el ranking y las notas de ese turno pero no puede marcar quién obtiene plaza ni calcular su nota de corte — y `interinos.js` no podrá excluir de la bolsa a nadie de esa especialidad hasta que se rellenen.

## Desplegar

- **Vercel**: crear un proyecto nuevo apuntando a este repo con **Root Directory = `web`** (Vercel detecta Vite automáticamente). Cada push a la rama principal —incluidos los commits automáticos de la Action de refresco— dispara un redeploy.
- **GitHub Action**: `.github/workflows/refresh.yml` necesita que el repo esté en GitHub con Actions habilitado; no requiere secretos adicionales (usa el `GITHUB_TOKEN` por defecto para commitear).

## Limitaciones conocidas

- El scraping depende de que la estructura HTML/AJAX del portal de educarm no cambie; si educarm rediseña el formulario, `scraper/lib/educarm.js` habrá que revisarlo.
- El parser de PDFs (`scraper/lib/pdf.js`, `scraper/parse.js`) se ha validado contra los documentos reales de las 8 especialidades de OPOPRI26, pero conviene contrastar puntualmente alguna fila contra el PDF oficial si en el futuro cambia el maquetado.
- Un candidato solo aparece con nota final cuando su tribunal ha publicado **tanto** el documento de baremación (concurso) como el de fase de oposición; hasta entonces se marca como "pendiente" en vez de asumir un resultado.
- Herramienta no oficial: no sustituye la publicación oficial de los tribunales.
- La rebaremación de la lista de interinos (exclusión por plaza, Bloque I/II, exclusión por no presentarse) cruza por NIF enmascarado + nombre (tolerando acentos/ñ y la abreviatura "Mª", que varían entre el Anexo I y los documentos por tribunal); un apodo distinto de pila (p. ej. "Mari Carmen" en vez de "María del Carmen") puede no detectarse y dejar a esa persona sin actualizar/excluir.
- La puntuación de la lista de interinos es informativa, no el orden oficial de la bolsa (ver sección "Lista de interinos" más arriba): a quien está acreditado en varias especialidades se le aplica la misma nota histórica y el mismo bloque en todas, y "Bloque I" se aproxima con las calificaciones del Anexo I, no con el registro administrativo del Bloque I vigente.
