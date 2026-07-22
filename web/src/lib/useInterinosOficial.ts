import { useEffect, useState } from 'react';
import type { ListaInterinosOficialDataset } from './types';

// Igual que useInterinos: un único dataset regional, cargado una sola vez —
// el filtro por especialidad se aplica dentro de la tabla (ver
// InterinosOficial.tsx).
export function useInterinosOficial() {
  const [dataset, setDataset] = useState<ListaInterinosOficialDataset | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    import('../data/interinos-oficial.json')
      .then((m) => setDataset(m.default as ListaInterinosOficialDataset))
      .catch(() => setError('No se encontró la lista oficial de interinos generada'))
      .finally(() => setLoading(false));
  }, []);

  return { dataset, loading, error };
}
