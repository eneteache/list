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
import type { Interino, ListaInterinosDataset } from '../lib/types';
import { useDebouncedValue } from '../lib/useDebouncedValue';
import { useRowVirtualizer } from '../lib/useRowVirtualizer';

const numFmt = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
const fmt = (n: number | null | undefined) => (n == null ? '—' : numFmt.format(n));

const columnHelper = createColumnHelper<Interino>();

// Mismas siglas que usa el propio formulario de educarm para cada
// especialidad (ver codigoEspecialidad en scraper/config/especialidades.json)
// — más compactas que el nombre completo, que desbordaba la columna. "039"
// (Alemán) no está en esa convocatoria, así que no tiene sigla oficial
// conocida; se sigue el patrón F+inicial que usan FI (inglés) y FF (francés).
const SIGLAS: Record<string, string> = {
  '031': 'EI',
  '032': 'FI',
  '033': 'FF',
  '034': 'EF',
  '035': 'MU',
  '036': 'PT',
  '037': 'AL',
  '038': 'PRI',
  '039': 'FA',
};

function numberColumn(id: string, header: string, get: (row: Interino) => number) {
  return columnHelper.accessor(get, {
    id,
    header,
    cell: (info) => fmt(info.getValue()),
  });
}

const PROV_TITLE_INTERINO =
  'Su tribunal todavía no ha resuelto la fase de oposición para esta persona: nota provisional a partir de fase 1 y/o fase 2 sueltas, puede cambiar cuando se publique más';

// Bloque I usa notaMasAlta (mejor nota de oposiciones superadas); Bloque II
// usa notaUltimaOposicion (nota de la última oposición, 2026, aunque sea un
// suspenso — ver runInterinos, scraper/interinos.js). Una sola columna con
// el valor que corresponda a cada fila, en vez de dos columnas donde la mitad
// de cada una siempre estaría vacía.
function notaOposicionColumn() {
  return columnHelper.accessor((r) => (r.bloque === 'I' ? r.notaMasAlta : r.notaUltimaOposicion ?? undefined), {
    id: 'notaOposicion',
    header: 'Nota oposición',
    cell: (info) => {
      const r = info.row.original;
      const valor = r.bloque === 'I' ? r.notaMasAlta : r.notaUltimaOposicion;
      const esProvisional = r.bloque === 'I' ? r.notaMasAltaProvisional : r.notaUltimaOposicionProvisional;
      if (esProvisional) {
        return (
          <span className="nota-aprox" title={PROV_TITLE_INTERINO}>
            ≈ {fmt(valor)}
          </span>
        );
      }
      const title =
        r.bloque === 'I'
          ? 'Bloque I: nota más alta de sus oposiciones superadas desde el año 2000'
          : 'Bloque II: nota de la última oposición (2026) — nunca ha superado la oposición de esta especialidad';
      return <span title={title}>{fmt(valor)}</span>;
    },
    sortUndefined: 'last',
  });
}

function columnas(especialidades: Record<string, string>) {
  return [
    // sortUndefined solo trata como "sin valor" un `undefined` de verdad — el
    // dato viene de JSON, así que `posicion` ausente llega como `null`, no
    // `undefined` (ver runInterinos, scraper/interinos.js), y sin este `??
    // undefined` los excluidos (sin posición) se cuelan al PRINCIPIO en vez
    // de al final al ordenar por esta columna en ascendente.
    columnHelper.accessor((r) => r.posicion ?? undefined, {
      id: 'posicion',
      header: '#',
      cell: (info) => info.getValue() ?? '—',
      sortUndefined: 'last',
    }),
    columnHelper.accessor('bloque', {
      header: 'Bloque',
      cell: (info) => (
        <span title={info.getValue() === 'I' ? 'Ya superó la oposición de esta especialidad desde 2000' : 'Nunca ha superado la oposición de esta especialidad desde 2000'}>
          {info.getValue()}
        </span>
      ),
    }),
    columnHelper.accessor('nombre', { header: 'Apellidos y nombre' }),
    columnHelper.accessor('nif', { header: 'NIF' }),
    columnHelper.accessor('especialidades', {
      header: 'Especialidades acreditadas',
      cell: (info) => {
        const codigos = info.getValue();
        return (
          <span title={codigos.map((c) => especialidades[c] ?? c).join(', ')}>
            {codigos.map((c) => SIGLAS[c] ?? c).join(', ')}
          </span>
        );
      },
      enableSorting: false,
    }),
    notaOposicionColumn(),
    columnHelper.accessor('experienciaDocente', {
      header: 'Experiencia docente',
      cell: (info) => (
        <span title={`b.1 ${fmt(info.row.original.b1)} · b.2 ${fmt(info.row.original.b2)} · b.3 ${fmt(info.row.original.b3)} · b.4 ${fmt(info.row.original.b4)}`}>
          {fmt(info.getValue())}
        </span>
      ),
    }),
    numberColumn('ptosOposSuperadas', 'Ptos. opos. superadas', (r) => r.ptosOposSuperadas),
    columnHelper.accessor('puntuacionTotal', {
      header: 'Puntuación total',
      cell: (info) => <strong>{fmt(info.getValue())}</strong>,
    }),
    columnHelper.display({
      id: 'estado',
      header: 'Estado',
      cell: (info) => {
        const i = info.row.original;
        if (i.excluidoPorPlaza) {
          return (
            <span className="badge badge-plaza" title="Ya tiene plaza (real o provisional) en alguna especialidad de la oposición 2026, no cuenta en el orden de la bolsa">
              Plaza en oposición (excluido)
            </span>
          );
        }
        if (i.excluidoPorNoPresentarse) {
          return (
            <span className="badge badge-suspenso" title="Bloque II sin oposición superada que no se ha presentado efectivamente a la Parte A de la primera prueba de la convocatoria 2026 en ninguna especialidad acreditada — pierde el derecho a seguir en la bolsa">
              No presentado (excluido)
            </span>
          );
        }
        return <span className="badge badge-sinplaza">En bolsa</span>;
      },
    }),
  ];
}

function globalFilterFn(row: { original: Interino }, _colId: string, filterValue: string) {
  const q = filterValue.trim().toLowerCase();
  if (!q) return true;
  const { nombre, nif } = row.original;
  return nombre.toLowerCase().includes(q) || nif.toLowerCase().includes(q);
}

export function Interinos({ dataset }: { dataset: ListaInterinosDataset }) {
  // Por posición, no por puntuación: Bloque I y Bloque II son colas
  // independientes de la bolsa (ver runInterinos, scraper/interinos.js) y
  // `posicion` ya viene numerada como esa única secuencia I-luego-II — un
  // sort por puntuacionTotal a secas mezclaría a alguien de Bloque II con
  // más puntos por encima de alguien de Bloque I, que nunca es el orden real.
  const [sorting, setSorting] = useState<SortingState>([{ id: 'posicion', desc: false }]);
  const [searchInput, setSearchInput] = useState('');
  const globalFilter = useDebouncedValue(searchInput);
  const [especialidad, setEspecialidad] = useState('todas');

  const columns = useMemo(() => columnas(dataset.especialidades), [dataset]);

  const data = useMemo(() => {
    const filtrados =
      especialidad === 'todas'
        ? dataset.interinos
        : dataset.interinos.filter((i) => i.especialidades.includes(especialidad));
    return [...filtrados].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  }, [dataset, especialidad]);

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
      <p className="nota-aprox" style={{ display: 'block', marginBottom: 16 }}>
        Puntuación orientativa ya rebaremada con los resultados de la oposición 2026: <strong>Bloque I</strong> (ya
        superó alguna oposición desde el año 2000, esta convocatoria incluida) suma nota más alta de oposiciones
        superadas + experiencia docente (topada a 10 puntos) + puntos por nº de oposiciones superadas (1/1,5/1,5/2,
        tope 6); <strong>Bloque II</strong> (nunca la ha superado) suma la nota de la última oposición (2026, aunque
        sea un suspenso) + experiencia docente. Todo Bloque I se ordena antes que cualquier Bloque II con
        independencia de la puntuación de cada uno — no es un único ranking numérico mezclado. Se excluye de la
        bolsa a quien ya tiene plaza —real o provisional— en cualquier especialidad de la oposición 2026, y a quien
        estando en Bloque II no se ha presentado efectivamente a la Parte A de la primera prueba 2026 en ninguna
        especialidad acreditada (ambos se listan igualmente, marcados como excluidos). La nota de este año es
        siempre la de la fase de oposición (nunca el concurso, que ya cuenta aparte vía experiencia docente y puntos
        por oposiciones superadas): en cuanto un tribunal publica sus aprobados de fase de oposición esa nota ya es
        definitiva, sin esperar a la baremación; hasta entonces se muestra una aproximación provisional a partir de
        fase 1 y/o fase 2 sueltas. El Anexo I no indica a qué especialidad concreta corresponde cada calificación
        histórica cuando alguien está acreditado en varias, así que esta puntuación es la misma para todas sus
        especialidades acreditadas. No es una publicación oficial.
      </p>
      <div className="toolbar">
        <select
          className="especialidad-select filtro-especialidad-interinos"
          value={especialidad}
          onChange={(e) => setEspecialidad(e.target.value)}
        >
          <option value="todas">Todas las especialidades</option>
          {Object.entries(dataset.especialidades).map(([codigo, nombre]) => (
            <option key={codigo} value={codigo}>
              {nombre}
            </option>
          ))}
        </select>
        <input
          className="search-input"
          type="search"
          placeholder="Buscar por nombre o NIF..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
        />
        <span className="result-count">
          {rows.length} de {data.length} aspirantes
        </span>
      </div>

      <div className="table-scroll" ref={scrollRef}>
        <table className="tabla-datos">
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
              const i = row.original;
              return (
                <tr
                  key={i.id}
                  ref={measureElement}
                  data-index={virtualRow.index}
                  className={i.excluidoPorPlaza || i.excluidoPorNoPresentarse ? 'row-pendiente' : ''}
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
