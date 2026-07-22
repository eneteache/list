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
import type { InterinoOficial, ListaInterinosOficialDataset } from '../lib/types';
import { useDebouncedValue } from '../lib/useDebouncedValue';
import { useRowVirtualizer } from '../lib/useRowVirtualizer';
import { SIGLAS } from '../lib/siglas';

const numFmt = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
const fmt = (n: number | null | undefined) => (n == null ? '—' : numFmt.format(n));

// `posicionOficial` (puesto real en la Resolución, con huecos: no incluye a
// quien no es opositor 2026, ya tiene plaza definitiva, o —con el botón
// activo— va dentro del nº de plazas de su especialidad opta) deja de servir
// como "#" de la tabla en cuanto se filtra: por eso
// `data` (más abajo) añade `posicionFiltrada`, una única secuencia 1..N+M
// calculada sobre el subconjunto que esté visible en cada momento
// (especialidad + botón, no el buscador) — TODO el Bloque I filtrado antes
// que CUALQUIER Bloque II, con el Bloque II continuando la numeración justo
// donde termina el Bloque I (si el Bloque I filtrado tiene 10, el primero del
// Bloque II es el 11), igual que `posicion` en la lista de interinos
// aproximada (scraper/interinos.js) — no dos secuencias que empiezan las dos
// en 1, que haría parecer competitivo a alguien de Bloque II que en el orden
// real de la bolsa va muy por detrás de todo el Bloque I. El puesto real
// dentro de su propio bloque se conserva en el tooltip de la columna.
type Fila = InterinoOficial & { posicionFiltrada: number };

const columnHelper = createColumnHelper<Fila>();

const COLUMN_WIDTHS: Record<string, number> = {
  posicionOficial: 70,
  nombre: 220,
  nif: 100,
  especialidades: 140,
  especialidadOpta: 110,
  notaOposicion: 120,
  experienciaDocente: 130,
  ptosOposSuperadas: 130,
  puntuacionTotal: 120,
};

const ESTADO_BADGE: Record<string, string> = {
  aprobado: 'badge-aprobado',
  suspenso: 'badge-suspenso',
  pendiente: 'badge-pendiente',
};

const ESTADO_LABEL: Record<string, string> = {
  aprobado: 'Aprobado',
  suspenso: 'Suspenso',
  pendiente: 'Pendiente',
};

// Bloque I usa notaMasAlta (Mayor Calificación Oposición Superada); Bloque II
// usa notaActual (Calificación Oposición Actual) — mismo criterio de columna
// única que notaOposicionColumn en Interinos.tsx, pero sin marca de
// provisionalidad: estos valores vienen cerrados tal cual los publica la
// propia Resolución, no son una estimación de este proyecto.
function notaOposicionColumn() {
  return columnHelper.accessor((r) => r.notaMasAlta ?? r.notaActual ?? undefined, {
    id: 'notaOposicion',
    header: 'Nota oposición',
    cell: (info) => {
      const r = info.row.original;
      const title =
        r.bloque === 'I'
          ? 'Bloque I: Mayor Calificación Oposición Superada'
          : 'Bloque II: Calificación Oposición Actual';
      return <span title={title}>{fmt(r.notaMasAlta ?? r.notaActual)}</span>;
    },
    sortUndefined: 'last',
  });
}

function columnas(especialidades: Record<string, string>) {
  return [
    // posicionFiltrada ya es una única secuencia bloque-I-luego-bloque-II
    // (ver renumerar), así que basta con usarla tal cual como valor de orden
    // — a diferencia de notaOposicionColumn no hace falta ningún desplazamiento
    // artificial. El tooltip conserva el puesto real dentro de su propio
    // bloque en la Resolución oficial.
    columnHelper.accessor('posicionFiltrada', {
      id: 'posicionOficial',
      header: '#',
      cell: (info) => {
        const r = info.row.original;
        return (
          <span title={`Puesto real en la Resolución oficial (Bloque ${r.bloque}): ${r.posicionOficial}`}>
            {info.getValue()}
          </span>
        );
      },
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
    columnHelper.accessor('especialidadOpta', {
      header: 'Esp. opta',
      cell: (info) => {
        const r = info.row.original;
        return (
          <span
            className={`badge ${ESTADO_BADGE[r.estadoOpta]}`}
            title={`${especialidades[r.especialidadOpta] ?? r.especialidadOpta} — ${ESTADO_LABEL[r.estadoOpta]}`}
          >
            {SIGLAS[r.especialidadOpta] ?? r.especialidadOpta}
          </span>
        );
      },
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
    columnHelper.accessor('ptosOposSuperadas', {
      header: 'Ptos. opos. superadas',
      cell: (info) => fmt(info.getValue()),
      sortUndefined: 'last',
    }),
    columnHelper.accessor('puntuacionTotal', {
      header: 'Puntuación total',
      cell: (info) => <strong>{fmt(info.getValue())}</strong>,
    }),
  ];
}

function globalFilterFn(row: { original: Fila }, _colId: string, filterValue: string) {
  const q = filterValue.trim().toLowerCase();
  if (!q) return true;
  const { nombre, nif } = row.original;
  return nombre.toLowerCase().includes(q) || nif.toLowerCase().includes(q);
}

// Renumera en una única secuencia 1..N+M sobre la lista ya filtrada por
// especialidad/botón: todo el Bloque I (por posicionOficial ascendente)
// primero, y el Bloque II continúa la cuenta justo donde termina el Bloque I
// — ver el comentario de Fila para el porqué.
function renumerar(lista: InterinoOficial[]): Fila[] {
  const porBloque = (bloque: 'I' | 'II') => lista.filter((i) => i.bloque === bloque).sort((a, b) => a.posicionOficial - b.posicionOficial);
  return [...porBloque('I'), ...porBloque('II')].map((i, idx) => ({ ...i, posicionFiltrada: idx + 1 }));
}

export function InterinosOficial({ dataset }: { dataset: ListaInterinosOficialDataset }) {
  const [sorting, setSorting] = useState<SortingState>([{ id: 'posicionOficial', desc: false }]);
  const [searchInput, setSearchInput] = useState('');
  const globalFilter = useDebouncedValue(searchInput);
  const [especialidad, setEspecialidad] = useState('todas');
  const [eliminarOptanPlaza, setEliminarOptanPlaza] = useState(false);

  const columns = useMemo(() => columnas(dataset.especialidades), [dataset]);

  const data = useMemo(() => {
    let filtrados = dataset.interinos;
    if (especialidad !== 'todas') {
      filtrados = filtrados.filter((i) => i.especialidadOpta === especialidad);
    }
    if (eliminarOptanPlaza) {
      filtrados = filtrados.filter((i) => !i.plazaOpta);
    }
    // Orden base alfabético (desempate estable para columnas con empates,
    // p.ej. puntuacionTotal repetida) — el orden por defecto lo aplica
    // getSortedRowModel a partir de `sorting`, ver más abajo.
    return renumerar(filtrados).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  }, [dataset, especialidad, eliminarOptanPlaza]);

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
        Lista oficial de interinos publicada por la CARM (Resolución de {dataset.publicadoEn}, Anexo I = Bloque I,
        Anexo II = Bloque II), sin recalcular nada: puntuación y puesto real ("#", en el tooltip) son tal cual los
        publica la propia Administración. Reducida a quien además es <strong>opositor 2026</strong> — columna "Esp.
        opta", con la especialidad por la que se ha presentado a examen este año y su estado en ella — y todavía no
        tiene plaza <strong>definitiva</strong> en ninguna especialidad (nota final real, con concurso y oposición ya
        resueltos — no basta con ir dentro del nº de plazas con una nota todavía provisional, que puede cambiar o
        quedar sin cubrir): a quien ya la tiene se le quita de este listado por completo. No es una publicación
        oficial en sí misma: verifica siempre tu situación en la Resolución original.
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
        <div className="segmented" role="group" aria-label="Filtrar por plaza">
          <button
            className={eliminarOptanPlaza ? 'segmented-active' : ''}
            onClick={() => setEliminarOptanPlaza((v) => !v)}
            title="Esconde a quien, con la nota que se conoce hasta ahora (real o todavía provisional), va dentro del nº de plazas de la especialidad por la que ha optado este año (columna Esp. opta)"
          >
            Eliminar los que optan por plaza
          </button>
        </div>
        <span className="result-count">
          {rows.length} de {data.length} aspirantes
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
              const i = row.original;
              return (
                <tr key={i.id} ref={measureElement} data-index={virtualRow.index}>
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
