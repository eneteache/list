export type EstadoOposicion = 'aprobado' | 'suspenso' | 'pendiente';

// Turno general (ingreso libre) y turno de reserva para personas con
// discapacidad son cupos independientes que nunca se mezclan: cada uno tiene
// su propio nº de plazas y su propia nota de corte (art. 3.4 y 42 de la
// convocatoria). Puede ser null en el caso (no esperado en la práctica) de
// que el documento origen no traiga la columna "Acceso" para ese candidato.
export type Turno = 'general' | 'discapacidad';

export interface Candidato {
  id: string;
  tribunal: string;
  turno: Turno | null;
  orden: string | null;
  nif: string;
  nombre: string;
  parteA: number | null;
  parteB: number | null;
  notaFase1: number | null;
  notaFase2: number | null;
  notaConcurso: number | null;
  apartado1: number | null;
  apartado2: number | null;
  apartado3: number | null;
  notaOposicion: number | null;
  estadoOposicion: EstadoOposicion;
  notaFinal: number | null;
  notaFinalAprox: number | null;
  posicion?: number;
  posicionProvisional?: boolean;
  plazaObtenida?: boolean | null;
}

export interface TribunalInfo {
  tribunal: string;
  tieneBaremacion: boolean;
  tieneFaseOposicion: boolean;
  tienePrimeraPrueba: boolean;
  tieneSegundaPrueba: boolean;
  nCandidatos: number;
}

export interface CorteTurno {
  plazas: number | null;
  notaCorte: number | null;
  notaCorteProvisional: boolean | null;
}

export interface EspecialidadDataset {
  especialidad: string;
  nombreEspecialidad: string;
  convocatoria: string;
  general: CorteTurno;
  discapacidad: CorteTurno;
  generadoEn: string;
  tribunales: TribunalInfo[];
  candidatos: Candidato[];
}

export interface ManifestEspecialidad {
  key: string;
  nombre: string;
}

export interface Manifest {
  especialidades: ManifestEspecialidad[];
}

export interface InterinoCalificacion {
  anyo: number;
  nota: number;
}

// Bloque I: ya tiene (con la convocatoria 2026 incluida) alguna oposición
// superada desde el año 2000 en la especialidad. Bloque II: nunca la ha
// superado. Son colas independientes de la bolsa — TODO Bloque I se llama
// antes que CUALQUIER Bloque II con independencia de la puntuación de cada
// uno (ver runInterinos, scraper/interinos.js), por eso `posicion` ya viene
// numerada como una única secuencia I-luego-II y no hay que recalcularla en
// el frontend a partir de puntuacionTotal.
export type BloqueInterino = 'I' | 'II';

export interface Interino {
  id: string;
  nif: string;
  nombre: string;
  especialidades: string[];
  calificaciones: InterinoCalificacion[];
  b1: number;
  b2: number;
  b3: number;
  b4: number;
  bloque: BloqueInterino;
  ptosOposSuperadas: number;
  // Bloque I: nota más alta de sus oposiciones superadas, incluida la de 2026
  // en cuanto aprueba (con independencia de si ya está baremada — ver
  // notaMasAltaProvisional). No se usa en Bloque II (se queda a 0 ahí, ver
  // notaUltimaOposicion en su lugar).
  notaMasAlta: number;
  // true si notaMasAlta viene de la estimación provisional de 2026 (falta la
  // baremación de su tribunal) en vez de una nota ya cerrada — se corrige
  // sola en cuanto se publique y se regenere este listado.
  notaMasAltaProvisional: boolean;
  // Bloque II: nota de la última oposición (2026), aunque sea un suspenso —
  // es la base de su puntuación en vez de notaMasAlta. null si no se ha
  // encontrado ningún resultado 2026 para esta persona.
  notaUltimaOposicion: number | null;
  // true si notaUltimaOposicion viene de la estimación provisional (falta la
  // baremación de su tribunal) en vez de una nota final real.
  notaUltimaOposicionProvisional: boolean;
  experienciaDocente: number;
  puntuacionTotal: number;
  posicion: number | null;
  excluidoPorPlaza: boolean;
  // Bloque II que no se presentó efectivamente a la Parte A de la primera
  // prueba 2026 en ninguna especialidad: pierde el derecho a seguir en la
  // bolsa (ver runInterinos).
  excluidoPorNoPresentarse: boolean;
}

export interface ListaInterinosDataset {
  generadoEn: string;
  especialidades: Record<string, string>;
  interinos: Interino[];
}

// A diferencia de Interino (bolsa aproximada por este proyecto), estos datos
// vienen tal cual los publica la Resolución oficial de la CARM (Anexo I =
// bloque I, Anexo II = bloque II, ya con la puntuación calculada por la
// propia Administración) — no se recalcula nada aquí. El listado ya viene
// reducido a quien además es opositor 2026 y todavía no tiene plaza
// confirmada (ver runInterinosOficial); `posicionOficial` es su puesto real
// dentro de su bloque en la Resolución (con huecos, al no incluir a quien no
// es opositor 2026 o ya tiene plaza) — el frontend renumera este subconjunto
// para la columna que se muestra (ver InterinosOficial.tsx).
export interface InterinoOficial {
  id: string;
  nif: string;
  nombre: string;
  especialidades: string[];
  bloque: BloqueInterino;
  posicionOficial: number;
  notaMasAlta: number | null;
  notaActual: number | null;
  b1: number;
  b2: number;
  b3: number;
  b4: number;
  experienciaDocente: number;
  ptosOposSuperadas: number | null;
  puntuacionTotal: number;
  // Especialidad concreta de la oposición 2026 por la que ha optado (por la
  // que se ha presentado a examen) y su estado en ella — no siempre coincide
  // con sus especialidades acreditadas en la bolsa (`especialidades`): se
  // puede optar a una especialidad sin estar acreditado como interino en
  // ella, o al revés. Si se presenta a más de una (infrecuente), es la de
  // código más bajo — el propio Anexo no dice cuál es "la" principal.
  especialidadOpta: string;
  estadoOpta: EstadoOposicion;
  // true si a día de hoy va dentro del nº de plazas de esa especialidad, con
  // la nota que se conozca hasta ahora — puede ser una estimación todavía
  // provisional (nunca una plaza ya definitiva: esas se quitan del listado
  // por completo, ver runInterinosOficial). Es la base del botón "Eliminar
  // los que optan por plaza" de InterinosOficial.tsx.
  plazaOpta: boolean;
}

export interface ListaInterinosOficialDataset {
  generadoEn: string;
  publicadoEn: string;
  especialidades: Record<string, string>;
  interinos: InterinoOficial[];
}
