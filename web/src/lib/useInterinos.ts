import { useEffect, useState } from 'react';
import type { ListaInterinosDataset } from './types';

// La lista de interinos es un único dataset regional (el Anexo I cubre las 9
// especialidades del cuerpo a la vez, no una por especialidad), así que se
// carga una sola vez — el filtro por especialidad se aplica dentro de la
// tabla (ver Interinos.tsx), no recargando un fichero distinto.
export function useInterinos() {
  const [dataset, setDataset] = useState<ListaInterinosDataset | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    import('../data/interinos.json')
      .then((m) => setDataset(m.default as ListaInterinosDataset))
      .catch(() => setError('No se encontró la lista de interinos generada'))
      .finally(() => setLoading(false));
  }, []);

  return { dataset, loading, error };
}
