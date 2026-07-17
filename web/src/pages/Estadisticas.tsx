import { useMemo } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts';
import type { EspecialidadDataset, Turno } from '../lib/types';

const numFmt = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 4 });

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="kpi">
      <div className="kpi-value">{value}</div>
      <div className="kpi-label">{label}</div>
    </div>
  );
}

function buildHistograma(notas: number[]) {
  const bins: { rango: string; desde: number; count: number }[] = [];
  for (let i = 0; i < 20; i++) {
    const desde = i * 0.5;
    bins.push({ rango: desde.toFixed(1), desde, count: 0 });
  }
  for (const n of notas) {
    const idx = Math.min(19, Math.floor(n / 0.5));
    bins[idx].count++;
  }
  return bins;
}

export function Estadisticas({ dataset, turno }: { dataset: EspecialidadDataset; turno: Turno }) {
  // dataset.candidatos ya llega filtrado a un único turno (ver App.tsx): esta
  // vista solo necesita saber cuál es para leer su plazas/nota de corte y
  // etiquetar los KPIs, no para volver a filtrar.
  const { candidatos } = dataset;
  const corte = dataset[turno];

  const resueltos = useMemo(() => candidatos.filter((c) => c.notaFinal != null), [candidatos]);
  const aprobados = useMemo(() => candidatos.filter((c) => c.estadoOposicion === 'aprobado'), [candidatos]);
  const suspensos = useMemo(() => candidatos.filter((c) => c.estadoOposicion === 'suspenso'), [candidatos]);
  const sinTribunalPublicado = useMemo(
    () => candidatos.filter((c) => c.estadoOposicion === 'pendiente'),
    [candidatos]
  );
  const sinNotaConcurso = useMemo(
    () => aprobados.filter((c) => c.notaConcurso == null),
    [aprobados]
  );

  const histograma = useMemo(
    () => buildHistograma(resueltos.map((c) => c.notaFinal as number)),
    [resueltos]
  );

  const dispersión = useMemo(
    () =>
      aprobados
        .filter((c) => c.notaConcurso != null && c.notaOposicion != null)
        .map((c) => ({ x: c.notaConcurso, y: c.notaOposicion, nombre: c.nombre })),
    [aprobados]
  );

  const porTribunal = useMemo(() => {
    const map = new Map<string, { tribunal: string; total: number; aprobados: number; sumaOposicion: number }>();
    for (const c of candidatos) {
      const t = map.get(c.tribunal) ?? { tribunal: c.tribunal, total: 0, aprobados: 0, sumaOposicion: 0 };
      t.total++;
      if (c.estadoOposicion === 'aprobado') {
        t.aprobados++;
        t.sumaOposicion += c.notaOposicion ?? 0;
      }
      map.set(c.tribunal, t);
    }
    return Array.from(map.values())
      .map((t) => ({
        tribunal: t.tribunal,
        total: t.total,
        pctAprobados: t.total ? Math.round((t.aprobados / t.total) * 100) : 0,
        notaMedia: t.aprobados ? t.sumaOposicion / t.aprobados : null,
      }))
      .sort((a, b) => a.tribunal.localeCompare(b.tribunal));
  }, [candidatos]);

  const ratio = corte.plazas ? (candidatos.length / corte.plazas).toFixed(1) : '—';

  // OJO: "notaFase1 != null" NO equivale a "supera la primera prueba". Según
  // el art. 49.2 de la convocatoria, Parte A y Parte B necesitan cada una un
  // mínimo de 1,25 para que se calcule una nota combinada (si no, el
  // documento oficial imprime "-" en vez de una puntuación) — pero superar la
  // prueba exige además que esa combinada sea igual o superior a 5. Por eso
  // hay candidatos con notaFase1 real pero por debajo de 5 (p. ej. 4,99),
  // que NO la superan. Lo mismo aplica a la segunda prueba (art. 52.1): nota
  // global 0-10, se supera con 5 o más, y sí puede imprimirse por debajo de 5.
  const superanFase1 = useMemo(
    () => candidatos.filter((c) => c.notaFase1 != null && c.notaFase1 >= 5),
    [candidatos]
  );
  const superanFase2DeFase1 = useMemo(
    () => superanFase1.filter((c) => c.notaFase2 != null && c.notaFase2 >= 5),
    [superanFase1]
  );
  const pctFase2 = superanFase1.length ? Math.round((superanFase2DeFase1.length / superanFase1.length) * 100) : null;

  const notaMediaAprobados = useMemo(() => {
    if (aprobados.length === 0) return null;
    const suma = aprobados.reduce((acc, c) => acc + (c.notaOposicion ?? 0), 0);
    return suma / aprobados.length;
  }, [aprobados]);

  // "Presentados" = se presentaron a la primera prueba (no NP) y su resultado
  // en la fase de oposición ya es firme (aprobado o suspenso) — un "pendiente"
  // se presentó pero su tribunal aún no ha dicho si aprueba o no, así que no
  // se puede contar todavía ni como aprobado ni como los "0" de un suspenso.
  const presentadosConResultado = useMemo(
    () => candidatos.filter((c) => !(c.parteA == null && c.parteB == null) && c.estadoOposicion !== 'pendiente'),
    [candidatos]
  );
  const notaMediaGlobal = useMemo(() => {
    if (presentadosConResultado.length === 0) return null;
    const suma = presentadosConResultado.reduce((acc, c) => acc + (c.notaOposicion ?? 0), 0);
    return suma / presentadosConResultado.length;
  }, [presentadosConResultado]);

  return (
    <div>
      <div className="kpi-row">
        <Kpi label="Candidatos totales" value={String(candidatos.length)} />
        <Kpi label="Superan fase oposición" value={String(aprobados.length)} />
        <Kpi label="Suspenden fase oposición" value={String(suspensos.length)} />
        <Kpi label="Con nota final calculada" value={String(resueltos.length)} />
      </div>

      <div className="kpi-row">
        <Kpi label={`Plazas (${turno})`} value={corte.plazas != null ? String(corte.plazas) : 'sin configurar'} />
        <Kpi
          label={corte.notaCorteProvisional ? `Nota de corte ${turno} (provisional)` : `Nota de corte ${turno}`}
          value={corte.notaCorte != null ? numFmt.format(corte.notaCorte) : '—'}
        />
        <Kpi label="Candidatos por plaza" value={ratio} />
      </div>

      {(sinNotaConcurso.length > 0 || sinTribunalPublicado.length > 0) && (
        <p className="empty-note" style={{ marginBottom: 20 }}>
          {sinNotaConcurso.length > 0 &&
            `${sinNotaConcurso.length} candidatos superan la fase de oposición pero su tribunal aún no ha publicado la fase de concurso, así que no tienen nota final ni posición en el ranking todavía. `}
          {sinTribunalPublicado.length > 0 &&
            `${sinTribunalPublicado.length} candidatos pertenecen a tribunales que todavía no han publicado ningún resultado de la fase de oposición.`}
        </p>
      )}

      <section className="chart-section">
        <h3>Primera prueba → segunda prueba</h3>
        <div className="kpi-row">
          <Kpi label="Superan primera prueba" value={String(superanFase1.length)} />
          <Kpi
            label="Superan segunda prueba (de quienes superan la 1ª)"
            value={pctFase2 != null ? `${superanFase2DeFase1.length} de ${superanFase1.length} (${pctFase2}%)` : '—'}
          />
          <Kpi
            label="Nota media aprobados (oposición)"
            value={notaMediaAprobados != null ? numFmt.format(notaMediaAprobados) : '—'}
          />
          <Kpi
            label="Nota media global oposición (con 0 de quien no aprueba)"
            value={notaMediaGlobal != null ? numFmt.format(notaMediaGlobal) : '—'}
          />
        </div>
      </section>

      <section className="chart-section">
        <h3>Distribución de notas finales</h3>
        {resueltos.length === 0 ? (
          <p className="empty-note">Todavía no hay candidatos con nota final calculada.</p>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={histograma}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="rango" tick={{ fontSize: 11 }} interval={1} />
              <YAxis allowDecimals={false} />
              <Tooltip formatter={(v: number) => [v, 'Candidatos']} labelFormatter={(l) => `Nota ≥ ${l}`} />
              <Bar dataKey="count" fill="var(--color-accent)" />
              {corte.notaCorte != null && (
                <ReferenceLine
                  x={(Math.floor(corte.notaCorte / 0.5) * 0.5).toFixed(1)}
                  stroke="var(--color-danger)"
                  strokeWidth={2}
                  // Discontinua cuando la nota de corte es provisional, igual
                  // que la línea de corte de la Tabla (.row-corte-provisional).
                  strokeDasharray={corte.notaCorteProvisional ? '6 4' : undefined}
                  label={{
                    value: corte.notaCorteProvisional ? 'Corte (provisional)' : 'Corte',
                    position: 'top',
                    fill: 'var(--color-danger)',
                  }}
                />
              )}
            </BarChart>
          </ResponsiveContainer>
        )}
      </section>

      <section className="chart-section">
        <h3>Nota concurso vs. nota oposición (aprobados)</h3>
        {dispersión.length === 0 ? (
          <p className="empty-note">Todavía no hay candidatos con ambas notas disponibles.</p>
        ) : (
          <ResponsiveContainer width="100%" height={320}>
            <ScatterChart>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" dataKey="x" name="Nota concurso" domain={[0, 10]} tick={{ fontSize: 11 }} />
              <YAxis type="number" dataKey="y" name="Nota oposición" domain={[0, 10]} tick={{ fontSize: 11 }} />
              <ZAxis range={[40, 40]} />
              <Tooltip
                cursor={{ strokeDasharray: '3 3' }}
                formatter={(v: number, name: string) => [numFmt.format(v), name]}
                labelFormatter={() => ''}
              />
              <Scatter data={dispersión} fill="var(--color-accent)" />
            </ScatterChart>
          </ResponsiveContainer>
        )}
      </section>

      <section className="chart-section">
        <h3>Desglose por tribunal</h3>
        <div className="table-scroll">
          <table className="tabla-datos">
            <thead>
              <tr>
                <th>Tribunal</th>
                <th>Candidatos</th>
                <th>% supera oposición</th>
                <th>Nota media oposición</th>
              </tr>
            </thead>
            <tbody>
              {porTribunal.map((t) => (
                <tr key={t.tribunal}>
                  <td>{t.tribunal}</td>
                  <td>{t.total}</td>
                  <td>{t.pctAprobados}%</td>
                  <td>{t.notaMedia != null ? numFmt.format(t.notaMedia) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
