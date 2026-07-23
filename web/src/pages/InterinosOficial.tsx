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
// como "#" de la tabla en cuanto se filtra: por eso `renumerar` (más abajo)
// calcula dos secuencias 1..N propias, ambas sobre el subconjunto filtrado
// por especialidad/botón (no el buscador) — TODO el Bloque I antes que
// CUALQUIER Bloque II, con el Bloque II continuando la numeración justo donde
// termina el Bloque I, igual que `posicion` en la lista de interinos
// aproximada (scraper/interinos.js) — no dos secuencias que empiezan las dos
// en 1, que haría parecer competitivo a alguien de Bloque II que en el orden
// real va muy por detrás de todo el Bloque I:
//  - posicionGeneral: puesto entre TODOS los aspirantes filtrados, sea cual
//    sea su especialidad opta.
//  - posicionEspecialidad: puesto solo entre quienes comparten su misma
//    especialidad opta — se calcula sobre el conjunto SIN filtrar por el
//    desplegable de especialidad (para que se vea aunque el desplegable esté
//    en "Todas las especialidades"), aunque el botón "Eliminar los que optan
//    por plaza" sí afecta a ambas.
// El puesto real dentro de su propio bloque se conserva en el tooltip de la
// columna general. posicionEspecialidad es null cuando no es opositor 2026
// (especialidadOpta null): no participa en ningún ranking por especialidad.
type Fila = InterinoOficial & { posicionGeneral: number; posicionEspecialidad: number | null };

const columnHelper = createColumnHelper<Fila>();

const COLUMN_WIDTHS: Record<string, number> = {
  posicionGeneral: 70,
  posicionEspecialidad: 70,
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
    // posicionGeneral/posicionEspecialidad ya son secuencias propias
    // bloque-I-luego-bloque-II (ver renumerar), así que basta con usarlas tal
    // cual como valor de orden — a diferencia de notaOposicionColumn no hace
    // falta ningún desplazamiento artificial. El tooltip conserva el puesto
    // real dentro de su propio bloque en la Resolución oficial.
    columnHelper.accessor('posicionGeneral', {
      id: 'posicionGeneral',
      header: '# general',
      cell: (info) => {
        const r = info.row.original;
        return (
          <span title={`Puesto real en la Resolución oficial (Bloque ${r.bloque}): ${r.posicionOficial}`}>
            {info.getValue()}
          </span>
        );
      },
    }),
    columnHelper.accessor((r) => r.posicionEspecialidad ?? undefined, {
      id: 'posicionEspecialidad',
      header: '# especialidad',
      cell: (info) => {
        const r = info.row.original;
        if (r.posicionEspecialidad == null || r.especialidadOpta == null) {
          return <span title="No es opositor 2026: no participa en ningún ranking por especialidad">—</span>;
        }
        return (
          <span title={`Puesto entre quienes optan a ${especialidades[r.especialidadOpta] ?? r.especialidadOpta} (Bloque ${r.bloque})`}>
            {r.posicionEspecialidad}
          </span>
        );
      },
      sortUndefined: 'last',
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
    columnHelper.accessor((r) => r.especialidadOpta ?? undefined, {
      id: 'especialidadOpta',
      header: 'Esp. opta',
      cell: (info) => {
        const r = info.row.original;
        if (r.especialidadOpta == null || r.estadoOpta == null) {
          return <span title="No se ha presentado a la oposición 2026 en ninguna especialidad">—</span>;
        }
        return (
          <span
            className={`badge ${ESTADO_BADGE[r.estadoOpta]}`}
            title={`${especialidades[r.especialidadOpta] ?? r.especialidadOpta} — ${ESTADO_LABEL[r.estadoOpta]}`}
          >
            {SIGLAS[r.especialidadOpta] ?? r.especialidadOpta}
          </span>
        );
      },
      sortUndefined: 'last',
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

// Todo el Bloque I (por posicionOficial ascendente) antes que CUALQUIER
// Bloque II, con el Bloque II continuando la cuenta justo donde termina el
// Bloque I — ver el comentario de Fila para el porqué. Devuelve la lista en
// ese orden, sin numerar (cada llamador numera lo que necesite).
function ordenarPorBloqueYPuntuacion(lista: InterinoOficial[]): InterinoOficial[] {
  const porBloque = (bloque: 'I' | 'II') => lista.filter((i) => i.bloque === bloque).sort((a, b) => a.posicionOficial - b.posicionOficial);
  return [...porBloque('I'), ...porBloque('II')];
}

// Calcula posicionGeneral (entre todos) y posicionEspecialidad (solo entre
// quienes comparten especialidadOpta) sobre la lista ya filtrada por el botón
// "Eliminar los que optan por plaza" — sin filtrar todavía por el desplegable
// de especialidad, para que posicionEspecialidad quede fija con independencia
// de qué especialidad tenga seleccionada el desplegable (ver comentario de Fila).
function renumerar(lista: InterinoOficial[]): Fila[] {
  const posicionGeneralPorId = new Map(ordenarPorBloqueYPuntuacion(lista).map((i, idx) => [i.id, idx + 1]));

  // Quien no es opositor 2026 (especialidadOpta null) no participa en ningún
  // ranking por especialidad — se queda sin posicionEspecialidad.
  const porEspecialidad = new Map<string, InterinoOficial[]>();
  for (const i of lista) {
    if (i.especialidadOpta == null) continue;
    const grupo = porEspecialidad.get(i.especialidadOpta) ?? [];
    grupo.push(i);
    porEspecialidad.set(i.especialidadOpta, grupo);
  }
  const posicionEspecialidadPorId = new Map<string, number>();
  for (const grupo of porEspecialidad.values()) {
    ordenarPorBloqueYPuntuacion(grupo).forEach((i, idx) => posicionEspecialidadPorId.set(i.id, idx + 1));
  }

  return lista.map((i) => ({
    ...i,
    posicionGeneral: posicionGeneralPorId.get(i.id)!,
    posicionEspecialidad: posicionEspecialidadPorId.get(i.id) ?? null,
  }));
}

export function InterinosOficial({ dataset }: { dataset: ListaInterinosOficialDataset }) {
  const [sorting, setSorting] = useState<SortingState>([{ id: 'posicionGeneral', desc: false }]);
  const [searchInput, setSearchInput] = useState('');
  const globalFilter = useDebouncedValue(searchInput);
  const [especialidad, setEspecialidad] = useState('todas');
  const [eliminarOptanPlaza, setEliminarOptanPlaza] = useState(false);

  const columns = useMemo(() => columnas(dataset.especialidades), [dataset]);

  const data = useMemo(() => {
    // El botón sí afecta a ambas posiciones (quita filas del cálculo), pero
    // el desplegable de especialidad se aplica DESPUÉS de numerar, para que
    // posicionEspecialidad no cambie según qué especialidad esté seleccionada
    // (ver renumerar).
    const base = eliminarOptanPlaza ? dataset.interinos.filter((i) => !i.plazaOpta) : dataset.interinos;
    const numerados = renumerar(base);
    const visibles = especialidad === 'todas' ? numerados : numerados.filter((i) => i.especialidadOpta === especialidad);
    // Orden base alfabético (desempate estable para columnas con empates,
    // p.ej. puntuacionTotal repetida) — el orden por defecto lo aplica
    // getSortedRowModel a partir de `sorting`, ver más abajo.
    return visibles.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
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
        Anexo II = Bloque II), sin recalcular nada: puntuación y puesto real (en el tooltip de "# general") son tal
        cual los publica la propia Administración. Incluye a <strong>todos</strong> los aspirantes de Anexo I/II, no
        solo a quien se presenta a la oposición 2026 — la propia Resolución dice que la lista definitiva de
        interinidad para el curso 2026-2027 la forman quienes cumplan el artículo 96 (acreditación de méritos),
        con independencia de si opositan este año. Quien sí oposite lleva su especialidad y estado en la columna
        "Esp. opta" (en blanco quien no se ha presentado a ninguna); nadie se excluye por tener plaza de forma
        automática — usa el botón "Eliminar los que optan por plaza" para esconder, de forma reversible, a quien
        hoy va dentro del nº de plazas de su especialidad opta (con nota definitiva o todavía provisional). "#
        general" es el puesto entre todos los aspirantes de la tabla, sea cual sea su especialidad; "# especialidad"
        es el puesto solo entre quienes optan a la misma especialidad (en blanco quien no opositó) — ambos se
        recalculan sobre el subconjunto filtrado por el botón, pero "# especialidad" no cambia al elegir una
        especialidad en el desplegable, que solo oculta filas. No es una publicación oficial en sí misma: verifica
        siempre tu situación en la Resolución original.
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
            title="Esconde a quien, con la nota que se conoce hasta ahora, va dentro del nº de plazas de la especialidad por la que ha optado este año (columna Esp. opta) — tanto si la plaza ya es definitiva como si todavía es una estimación provisional"
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
