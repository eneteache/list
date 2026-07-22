import { useEffect, useState } from 'react';
import { Tabla } from './pages/Tabla';
import { Estadisticas } from './pages/Estadisticas';
import { Interinos } from './pages/Interinos';
import { InterinosOficial } from './pages/InterinosOficial';
import { useDataset, useManifest } from './lib/useDataset';
import { useInterinos } from './lib/useInterinos';
import { useInterinosOficial } from './lib/useInterinosOficial';
import type { CorteTurno, EspecialidadDataset, TribunalInfo, Turno } from './lib/types';

type Vista = 'tabla' | 'estadisticas' | 'interinos' | 'interinos-oficial';

const fechaFmt = new Intl.DateTimeFormat('es-ES', { dateStyle: 'long', timeStyle: 'short' });
const numFmt = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 4, maximumFractionDigits: 4 });

// Un tribunal cuenta como "pendiente" si aún le falta publicar alguno de los
// dos documentos que hacen falta para una nota final oficial (ver
// README "Limitaciones conocidas"). Se agrupan por lo que falta en vez de
// repetir "(falta baremación)" tribunal por tribunal.
function agruparPendientes(tribunales: TribunalInfo[]) {
  const faltaBaremacion = tribunales.filter((t) => !t.tieneBaremacion).map((t) => t.tribunal);
  const faltaFaseOposicion = tribunales.filter((t) => !t.tieneFaseOposicion).map((t) => t.tribunal);
  return { faltaBaremacion, faltaFaseOposicion };
}

// Turno general y turno de discapacidad son cupos independientes (ver README
// "Nº de plazas y turnos") que no se muestran mezclados: la Tabla y las
// Estadísticas siempre ven los candidatos de un único turno.
//
// "Solo oficial" además esconde a quien solo tiene una estimación provisional
// (posicionProvisional, ver unify.js) — deja aprobados con nota final real,
// suspensos, y quien su tribunal aún no ha publicado nada. Pero no basta con
// esconder filas: la posición, la plaza y la nota de corte que ya trae cada
// candidato están calculadas contra el ranking COMPLETO (con estimaciones
// incluidas), así que al ocultar a quien tiene estimación quedarían huecos en
// el "#" y una plaza/corte referidos a gente que ya no se está mostrando. Por
// eso se vuelve a numerar y a calcular plaza/corte SOLO entre quien queda.
//
// Dentro de quien tiene posicionProvisional, no todos están igual de "verdes":
// si notaOposicion ya tiene valor es porque su tribunal SÍ ha publicado el
// resultado combinado de la fase de oposición (dato oficial y definitivo, ver
// notaOposicion en unifyTribunal, unify.js) y lo único que falta es la
// baremación del concurso. Esa gente no debe desaparecer del listado: se
// sigue mostrando, después de quien ya tiene nota final, ordenada entre sí
// por su nota de oposición (lo único oficial que tiene todavía) — pero sin
// posición ni plaza, que no se pueden saber sin el concurso. Solo se
// descarta a quien ni siquiera tiene eso (suspenso, o su tribunal no ha
// publicado nada), que pasa tal cual, sin nota ni posición.
//
// notaFinalAprox (la estimación con "≈" de Tabla.tsx) se anula para todo el
// que no tenga nota final real: en esta vista no se hace media de una parte
// sí y otra no —ni cuando falta el concurso, ni cuando alguien ha suspendido
// una parte de la fase de oposición y notaFinalAprox solo queda como residuo
// informativo (ver unify.js)—, así que la celda de nota final debe verse
// como un guion, no como una aproximación. Quitarlo también evita que ese
// residuo numérico compita con la nota final real de otros en el orden por
// defecto de la tabla (ver el desempate por notaOposicion en Tabla.tsx).
function aplicarFiltros(dataset: EspecialidadDataset, turno: Turno, soloOficial: boolean): EspecialidadDataset {
  const delTurno = dataset.candidatos.filter((c) => c.turno === turno);
  if (!soloOficial) {
    return { ...dataset, candidatos: delTurno };
  }

  const conNotaFinal = delTurno.filter((c) => c.posicionProvisional === false);
  const faltaBaremacion = delTurno
    .filter((c) => c.posicionProvisional === true && c.notaOposicion != null)
    .sort((a, b) => (b.notaOposicion ?? 0) - (a.notaOposicion ?? 0))
    .map((c) => ({ ...c, posicion: undefined, plazaObtenida: null, notaFinalAprox: null }));
  const sinDatosOficiales = delTurno
    .filter((c) => c.posicionProvisional !== false && !(c.posicionProvisional === true && c.notaOposicion != null))
    .map((c) => ({ ...c, notaFinalAprox: null }));

  const conRanking = [...conNotaFinal].sort((a, b) => (b.notaFinal ?? 0) - (a.notaFinal ?? 0));

  const plazasTurno = dataset[turno].plazas;
  const reordenados = conRanking.map((c, i) => ({
    ...c,
    posicion: i + 1,
    posicionProvisional: false,
    plazaObtenida: plazasTurno != null ? i < plazasTurno : null,
  }));

  const corteIdx = plazasTurno != null ? Math.min(reordenados.length, plazasTurno) - 1 : -1;
  const corte: CorteTurno = {
    plazas: plazasTurno,
    notaCorte: corteIdx >= 0 ? reordenados[corteIdx].notaFinal : null,
    notaCorteProvisional: corteIdx >= 0 ? false : null,
  };

  const resultado: EspecialidadDataset = {
    ...dataset,
    candidatos: [...reordenados, ...faltaBaremacion, ...sinDatosOficiales],
  };
  resultado[turno] = corte;
  return resultado;
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="info-card">
      <div className="info-card-label">{label}</div>
      <div className="info-card-value">{value}</div>
    </div>
  );
}

function App() {
  const manifest = useManifest();
  const [especialidad, setEspecialidad] = useState<string | null>(null);
  const [vista, setVista] = useState<Vista>('tabla');
  const [turno, setTurno] = useState<Turno>('general');
  const [soloOficial, setSoloOficial] = useState(false);

  useEffect(() => {
    if (!especialidad && manifest?.especialidades.length) {
      setEspecialidad(manifest.especialidades[0].key);
    }
  }, [manifest, especialidad]);

  const { dataset, loading, error } = useDataset(especialidad);
  // Las dos listas de interinos son datasets únicos e independientes (cubren
  // las especialidades del cuerpo a la vez): no siguen al selector de
  // especialidad de arriba, que es solo para la tabla/estadísticas de la
  // oposición. El filtro por especialidad vive dentro de cada tabla.
  const interinosResult = useInterinos();
  const interinosOficialResult = useInterinosOficial();
  // El selector de turno y el de "con estimaciones/solo oficial" solo tienen
  // sentido para la tabla/estadísticas de la oposición por especialidad —
  // ninguna de las dos listas de interinos usa esos conceptos.
  const esVistaOposicion = vista === 'tabla' || vista === 'estadisticas';

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header-top">
          <h1>Listado unificado de oposiciones — Región de Murcia</h1>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {manifest && manifest.especialidades.length > 1 && (
              <select
                className="especialidad-select"
                value={especialidad ?? ''}
                onChange={(e) => setEspecialidad(e.target.value)}
              >
                {manifest.especialidades.map((e) => (
                  <option key={e.key} value={e.key}>
                    {e.nombre}
                  </option>
                ))}
              </select>
            )}
            {esVistaOposicion && (
              <div className="segmented" role="group" aria-label="Turno">
                <button
                  className={turno === 'general' ? 'segmented-active' : ''}
                  onClick={() => setTurno('general')}
                >
                  Turno 1 · General
                </button>
                <button
                  className={turno === 'discapacidad' ? 'segmented-active' : ''}
                  onClick={() => setTurno('discapacidad')}
                >
                  Turno 2 · Discapacidad
                </button>
              </div>
            )}
            {esVistaOposicion && (
              <div className="segmented" role="group" aria-label="Datos a mostrar">
                <button className={!soloOficial ? 'segmented-active' : ''} onClick={() => setSoloOficial(false)}>
                  Con estimaciones
                </button>
                <button className={soloOficial ? 'segmented-active' : ''} onClick={() => setSoloOficial(true)}>
                  Solo oficial
                </button>
              </div>
            )}
          </div>
        </div>
        <p className="disclaimer">
          Herramienta no oficial. No sustituye a la publicación oficial de los tribunales en{' '}
          <a href="https://servicios.educarm.es" target="_blank" rel="noreferrer">
            servicios.educarm.es
          </a>
          . Verifica siempre tu situación en la fuente oficial.
        </p>
      </header>

      <nav className="tabs">
        <button className={vista === 'tabla' ? 'tab-active' : ''} onClick={() => setVista('tabla')}>
          Tabla
        </button>
        <button className={vista === 'estadisticas' ? 'tab-active' : ''} onClick={() => setVista('estadisticas')}>
          Estadísticas
        </button>
        <button className={vista === 'interinos' ? 'tab-active' : ''} onClick={() => setVista('interinos')}>
          Lista de interinos
        </button>
        <button
          className={vista === 'interinos-oficial' ? 'tab-active' : ''}
          onClick={() => setVista('interinos-oficial')}
        >
          Lista de interinos (oficial)
        </button>
      </nav>

      {vista === 'interinos' ? (
        <>
          {interinosResult.loading && <p className="status-msg">Cargando datos…</p>}
          {interinosResult.error && <p className="status-msg status-error">{interinosResult.error}</p>}
          {interinosResult.dataset && (
            <>
              <div className="dataset-meta">
                <span>
                  <strong>Cuerpo de Maestros</strong> · Todas las especialidades
                </span>
                <span>Datos generados: {fechaFmt.format(new Date(interinosResult.dataset.generadoEn))}</span>
              </div>
              <main>
                <Interinos dataset={interinosResult.dataset} />
              </main>
            </>
          )}
        </>
      ) : vista === 'interinos-oficial' ? (
        <>
          {interinosOficialResult.loading && <p className="status-msg">Cargando datos…</p>}
          {interinosOficialResult.error && <p className="status-msg status-error">{interinosOficialResult.error}</p>}
          {interinosOficialResult.dataset && (
            <>
              <div className="dataset-meta">
                <span>
                  <strong>Cuerpo de Maestros</strong> · Todas las especialidades
                </span>
                <span>
                  Resolución publicada: {interinosOficialResult.dataset.publicadoEn} · Datos generados:{' '}
                  {fechaFmt.format(new Date(interinosOficialResult.dataset.generadoEn))}
                </span>
              </div>
              <main>
                <InterinosOficial dataset={interinosOficialResult.dataset} />
              </main>
            </>
          )}
        </>
      ) : (
        <>
          {loading && <p className="status-msg">Cargando datos…</p>}
          {error && <p className="status-msg status-error">{error}</p>}
          {dataset &&
            (() => {
              const datasetFiltrado = aplicarFiltros(dataset, turno, soloOficial);
              const corte: CorteTurno = datasetFiltrado[turno];
              return (
                <>
                  <div className="dataset-meta">
                    <span>
                      <strong>{dataset.nombreEspecialidad}</strong> · Convocatoria {dataset.convocatoria}
                    </span>
                    <span>Datos generados: {fechaFmt.format(new Date(dataset.generadoEn))}</span>
                  </div>
                  {/* Estas tarjetas ya se repetían en la vista de Estadísticas (que además
                      tiene su propio bloque más compacto de plazas/nota de corte, necesario
                      como leyenda de su histograma) — se muestran solo en la Tabla. */}
                  {vista === 'tabla' && (
                    <div className="info-cards">
                      <InfoCard
                        label={`Plazas (${turno})`}
                        value={corte.plazas != null ? String(corte.plazas) : 'sin configurar'}
                      />
                      <InfoCard
                        label={
                          corte.notaCorteProvisional ? `Nota de corte ${turno} (provisional)` : `Nota de corte ${turno}`
                        }
                        value={corte.notaCorte != null ? numFmt.format(corte.notaCorte) : '—'}
                      />
                      <InfoCard
                        label="Con nota final oficial"
                        value={`${datasetFiltrado.candidatos.filter((c) => c.notaFinal != null).length} de ${datasetFiltrado.candidatos.length}`}
                      />
                      <InfoCard
                        label="No presentados"
                        value={String(
                          datasetFiltrado.candidatos.filter((c) => c.parteA == null && c.parteB == null).length
                        )}
                      />
                      {(() => {
                        const { faltaBaremacion, faltaFaseOposicion } = agruparPendientes(dataset.tribunales);
                        return (
                          <>
                            {faltaBaremacion.length > 0 && (
                              <InfoCard
                                label={`Falta baremación (${faltaBaremacion.length})`}
                                value={faltaBaremacion.join(', ')}
                              />
                            )}
                            {faltaFaseOposicion.length > 0 && (
                              <InfoCard
                                label={`Falta fase oposición (${faltaFaseOposicion.length})`}
                                value={faltaFaseOposicion.join(', ')}
                              />
                            )}
                          </>
                        );
                      })()}
                    </div>
                  )}
                  <main>
                    {vista === 'tabla' ? (
                      <Tabla dataset={datasetFiltrado} />
                    ) : (
                      <Estadisticas dataset={datasetFiltrado} turno={turno} />
                    )}
                  </main>
                </>
              );
            })()}
        </>
      )}
    </div>
  );
}

export default App;
