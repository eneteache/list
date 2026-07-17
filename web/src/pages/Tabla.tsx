import { useMemo, useRef, useState } from 'react';
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
} from '@tanstack/react-table';
import type { Candidato, EspecialidadDataset } from '../lib/types';
import { useDebouncedValue } from '../lib/useDebouncedValue';
import { useRowVirtualizer } from '../lib/useRowVirtualizer';

const numFmt = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
const fmt = (n: number | null | undefined) => (n == null ? '—' : numFmt.format(n));

const PROV_TITLE =
  'Basado en una estimación provisional (falta alguno de los datos oficiales), puede cambiar cuando se publique lo que falta';

// Nunca se presentó a la primera prueba: ni Parte A ni Parte B tienen nota
// (guion en las dos, en el documento original). Es distinto de "se presentó
// pero no le hace media" — notaFase1 también queda en blanco cuando alguna
// de las dos partes no llega al mínimo, aunque la otra sí tenga nota, y ESO
// no es un no presentado.
function esNoPresentado(c: Candidato): boolean {
  return c.parteA == null && c.parteB == null;
}

// Orden por "hasta dónde llegó", de más a menos, para quien no tiene ni nota
// final ni notaFinalAprox que ordenar (ver notaFinalAprox anulado en
// aplicarFiltros, App.tsx, y el desempate en el useMemo de `data` más abajo):
// 0. aprobado en fase de oposición, solo le falta la baremación (se
//    desempata aparte por notaOposicion, no por este nº de tier)
// 1. llegó a fase 2 y tiene nota de las dos fases, pero la fase de oposición
//    en conjunto sigue en suspenso
// 2. superó la fase 1 pero no tiene nota de fase 2 (no se presentó, o su
//    tribunal no la ha publicado)
// 3. se presentó a las dos partes (A y B) de la fase 1 pero no le hizo media
//    (alguna de las dos no llega al mínimo)
// 4. solo se presentó a una de las dos partes de la fase 1
// 5. pendiente (su tribunal no ha publicado nada) — el NP real (esNoPresentado)
//    va aparte, siempre el último de todos, ver el useMemo de `data`.
function tierSinNotaOficial(c: Candidato): number {
  if (c.notaOposicion != null) return 0;
  if (c.estadoOposicion === 'suspenso') {
    if (c.notaFase1 != null && c.notaFase2 != null) return 1;
    if (c.notaFase1 != null) return 2;
    if (c.parteA != null && c.parteB != null) return 3;
    if (c.parteA != null || c.parteB != null) return 4;
  }
  return 5;
}

function EstadoBadge({ c }: { c: Candidato }) {
  // Un suspenso queda fuera con certeza, tenga o no una notaFinalAprox
  // meramente informativa — nunca entra en el ranking de plazas.
  if (c.estadoOposicion === 'suspenso') {
    if (esNoPresentado(c)) {
      return <span className="badge badge-suspenso">NP (no presentado)</span>;
    }
    if (c.notaFase1 == null) {
      return <span className="badge badge-suspenso">Suspenso primera prueba</span>;
    }
    if (c.notaFase2 == null) {
      return <span className="badge badge-suspenso">Suspenso/no presentado segunda prueba</span>;
    }
    return <span className="badge badge-suspenso">Suspenso fase oposición</span>;
  }

  // Aprobado en la fase de oposición (dato oficial y definitivo) pero sin
  // posición asignada: solo pasa en la vista "Solo oficial" con quien todavía
  // no tiene baremación — no se puede saber su nota final ni si obtiene plaza
  // hasta que su tribunal la publique (ver aplicarFiltros en App.tsx).
  if (c.estadoOposicion === 'aprobado' && c.posicion == null) {
    return (
      <span
        className="badge badge-pendiente"
        title="Ya ha superado la fase de oposición; falta la baremación (concurso) de su tribunal para saber su nota final y si obtiene plaza"
      >
        Falta baremación
      </span>
    );
  }

  if (c.plazaObtenida === true) {
    return c.posicionProvisional ? (
      <span className="badge badge-plaza-prov" title={PROV_TITLE}>
        Plaza (provisional)
      </span>
    ) : (
      <span className="badge badge-plaza">Plaza obtenida</span>
    );
  }
  if (c.plazaObtenida === false) {
    return c.posicionProvisional ? (
      <span className="badge badge-sinplaza-prov" title={PROV_TITLE}>
        Sin plaza (provisional)
      </span>
    ) : (
      <span className="badge badge-sinplaza">Sin plaza</span>
    );
  }
  if (c.plazaObtenida === null) {
    // En el ranking (aprobado o con estimación provisional), pero no hay
    // nº de plazas configurado para saber si entra o no.
    return <span className="badge badge-aprobado">{c.posicionProvisional ? 'En ranking (plazas sin configurar)' : 'Aprobado (plazas sin configurar)'}</span>;
  }

  // No hay ni nota real ni estimación provisional: el tribunal todavía no ha
  // publicado nada de la fase de oposición para este candidato.
  return <span className="badge badge-pendiente">Tribunal sin publicar fase oposición</span>;
}

const columnHelper = createColumnHelper<Candidato>();

// Anchos fijos por columna (table-layout: fixed, ver .tabla-datos): sin esto
// el navegador recalcula el ancho de cada columna a partir del contenido de
// las filas actualmente montadas, y como la tabla virtualiza filas (solo
// monta las visibles), las columnas "bailaban" de ancho al hacer scroll cada
// vez que entraban filas con contenido más largo o más corto.
const COLUMN_WIDTHS: Record<string, number> = {
  posicion: 56,
  tribunal: 80,
  orden: 70,
  nombre: 260,
  nif: 100,
  notaFase1: 80,
  notaFase2: 80,
  notaOposicion: 110,
  apartado1: 100,
  apartado2: 100,
  apartado3: 100,
  notaConcurso: 110,
  notaFinal: 100,
  estado: 260,
};

function numberColumn(id: string, header: string, get: (row: Candidato) => number | null) {
  return columnHelper.accessor((row) => get(row) ?? undefined, {
    id,
    header,
    cell: (info) => fmt(info.getValue()),
    sortUndefined: 'last',
  });
}

// Orden por defecto: un único ranking numérico por nota final, sea real
// (concurso + oposición ya publicados) o provisional (notaFinalAprox, la
// estimación que ya calcula el backend con la parte que se conoce). No se
// separa en bloques "primero los reales, luego los provisionales" — alguien
// con una estimación de 6,4 va antes que alguien con una nota real de 4,9,
// tal cual pediría el número. Quien no se presentó (NP) cae siempre al
// final del todo, aunque tenga una notaFinalAprox residual por tener nota de
// concurso — esa estimación no dice nada de su situación en la oposición si
// ni siquiera se presentó.
function ordenKey(c: Candidato): number | undefined {
  if (esNoPresentado(c)) return undefined;
  return c.notaFinal ?? c.notaFinalAprox ?? undefined;
}

function NotaFinalCell({ c }: { c: Candidato }) {
  if (esNoPresentado(c)) return <>—</>;
  if (c.notaFinal != null) return <>{fmt(c.notaFinal)}</>;
  if (c.notaFinalAprox != null) {
    return (
      <span className="nota-aprox" title="Estimación provisional a partir de la parte que ya se conoce, no es la nota final oficial">
        ≈ {fmt(c.notaFinalAprox)}
      </span>
    );
  }
  return <>—</>;
}

const columns = [
  columnHelper.accessor('posicion', {
    header: '#',
    cell: (info) => {
      const v = info.getValue();
      if (v == null) return '—';
      return info.row.original.posicionProvisional ? (
        <span className="nota-aprox" title={PROV_TITLE}>
          ~{v}
        </span>
      ) : (
        v
      );
    },
    sortUndefined: 'last',
  }),
  columnHelper.accessor('tribunal', { header: 'Tribunal' }),
  columnHelper.accessor('orden', { header: 'Orden', cell: (info) => info.getValue() ?? '—' }),
  columnHelper.accessor('nombre', {
    header: 'Apellidos y nombre',
    // Columna de ancho fijo con elipsis (ver COLUMN_WIDTHS/.tabla-datos): el
    // title vuelve a mostrar el nombre completo al pasar el ratón por encima,
    // incluida la parte recortada por la elipsis.
    cell: (info) => <span title={info.getValue()}>{info.getValue()}</span>,
  }),
  columnHelper.accessor('nif', { header: 'NIF' }),
  numberColumn('notaFase1', 'Fase 1', (r) => r.notaFase1),
  numberColumn('notaFase2', 'Fase 2', (r) => r.notaFase2),
  numberColumn('notaOposicion', 'Nota oposición', (r) => r.notaOposicion),
  numberColumn('apartado1', 'Apartado 1', (r) => r.apartado1),
  numberColumn('apartado2', 'Apartado 2', (r) => r.apartado2),
  numberColumn('apartado3', 'Apartado 3', (r) => r.apartado3),
  numberColumn('notaConcurso', 'Nota concurso', (r) => r.notaConcurso),
  // La propia columna "Nota final" ordena por el mismo criterio real-o-estimado
  // que el orden por defecto (ordenKey), no solo por la nota oficial — si no,
  // hacer clic en la cabecera daría un resultado distinto al que se ve por
  // defecto, a pesar de que la celda ya muestra el valor estimado con "≈".
  columnHelper.accessor((row) => ordenKey(row), {
    id: 'notaFinal',
    header: 'Nota final',
    cell: (info) => <NotaFinalCell c={info.row.original} />,
    sortUndefined: 'last',
  }),
  columnHelper.display({
    id: 'estado',
    header: 'Estado',
    cell: (info) => <EstadoBadge c={info.row.original} />,
  }),
];

function globalFilterFn(row: { original: Candidato }, _colId: string, filterValue: string) {
  const q = filterValue.trim().toLowerCase();
  if (!q) return true;
  const { nombre, nif, tribunal } = row.original;
  return (
    nombre.toLowerCase().includes(q) || nif.toLowerCase().includes(q) || `tribunal ${tribunal}`.includes(q)
  );
}

export function Tabla({ dataset }: { dataset: EspecialidadDataset }) {
  const [sorting, setSorting] = useState<SortingState>([{ id: 'notaFinal', desc: true }]);
  const [searchInput, setSearchInput] = useState('');
  const globalFilter = useDebouncedValue(searchInput);

  // Base estable: dentro de un mismo escalón de ordenKey (p.ej. en "Solo
  // oficial", todo el que no tiene nota final real cae en el mismo escalón
  // "sin valor" — ver notaFinalAprox anulado en aplicarFiltros, App.tsx) el
  // sort por la columna "Nota final" es estable y conserva este orden, así
  // que aquí se desempata primero por tierSinNotaOficial (hasta dónde llegó),
  // luego por nota de oposición dentro del tier 0 (quien la tiene más alta,
  // delante), y solo alfabéticamente como último recurso. Los NP se colocan
  // antes que nada, siempre después de todos los demás (incluidos otros
  // suspensos sin nota), y no solo alfabéticamente: así quedan totalmente al
  // final de la tabla y no mezclados con el resto de filas que tampoco
  // tienen ordenKey.
  const data = useMemo(
    () =>
      [...dataset.candidatos].sort((a, b) => {
        const npDiff = Number(esNoPresentado(a)) - Number(esNoPresentado(b));
        if (npDiff !== 0) return npDiff;
        const tierDiff = tierSinNotaOficial(a) - tierSinNotaOficial(b);
        if (tierDiff !== 0) return tierDiff;
        const opoDiff = (b.notaOposicion ?? -Infinity) - (a.notaOposicion ?? -Infinity);
        return opoDiff !== 0 ? opoDiff : a.nombre.localeCompare(b.nombre, 'es');
      }),
    [dataset]
  );

  const table = useReactTable({
    data,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setSearchInput,
    globalFilterFn,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  const rows = table.getRowModel().rows;
  const scrollRef = useRef<HTMLDivElement>(null);
  const { virtualItems, paddingTop, paddingBottom, measureElement } = useRowVirtualizer(rows.length, scrollRef);

  return (
    <div>
      <div className="toolbar">
        <input
          className="search-input"
          type="search"
          placeholder="Buscar por nombre, NIF o tribunal..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
        />
        <span className="result-count">
          {rows.length} de {data.length} candidatos
        </span>
      </div>

      <div className="table-scroll" ref={scrollRef}>
        <table className="tabla-datos">
          <colgroup>
            {table.getAllLeafColumns().map((column) => (
              <col key={column.id} style={{ width: COLUMN_WIDTHS[column.id] ?? 100 }} />
            ))}
          </colgroup>
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((header) => (
                  <th key={header.id} onClick={header.column.getToggleSortingHandler()} className="sortable">
                    {flexRender(header.column.columnDef.header, header.getContext())}
                    {{ asc: ' ▲', desc: ' ▼' }[header.column.getIsSorted() as string] ?? ''}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {paddingTop > 0 && (
              <tr aria-hidden style={{ height: paddingTop }}>
                <td colSpan={columns.length} />
              </tr>
            )}
            {virtualItems.map((virtualRow) => {
              const row = rows[virtualRow.index];
              const c = row.original;
              // El corte es propio de cada turno (general y discapacidad no
              // se mezclan), así que hay que comparar contra las plazas del
              // turno al que pertenece este candidato, no un nº de plazas único.
              const plazasDeSuTurno = c.turno === 'discapacidad' ? dataset.discapacidad.plazas : dataset.general.plazas;
              const esCorte = plazasDeSuTurno != null && c.posicion === plazasDeSuTurno;
              const esCorteProvisional = esCorte && c.posicionProvisional;
              return (
                <tr
                  key={c.id}
                  ref={measureElement}
                  data-index={virtualRow.index}
                  className={[
                    c.estadoOposicion === 'pendiente' ? 'row-pendiente' : '',
                    c.estadoOposicion === 'suspenso' ? 'row-suspenso' : '',
                    esCorte && !esCorteProvisional ? 'row-corte' : '',
                    esCorteProvisional ? 'row-corte-provisional' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  {row
                    .getVisibleCells()
                    .map((cell) => (
                      <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
                    ))}
                </tr>
              );
            })}
            {paddingBottom > 0 && (
              <tr aria-hidden style={{ height: paddingBottom }}>
                <td colSpan={columns.length} />
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
