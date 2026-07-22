// Mismas siglas que usa el propio formulario de educarm para cada
// especialidad (ver codigoEspecialidad en scraper/config/especialidades.json)
// — más compactas que el nombre completo, que desborda columnas estrechas de
// tabla. "039" (Alemán) no está en la convocatoria 2026, así que no tiene
// sigla oficial conocida; se sigue el patrón F+inicial que usan FI (inglés) y
// FF (francés). Compartido entre Interinos.tsx e InterinosOficial.tsx, las
// dos tablas que muestran especialidades acreditadas por código 031-039.
export const SIGLAS: Record<string, string> = {
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
