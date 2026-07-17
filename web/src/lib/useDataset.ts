import { useEffect, useState } from 'react';
import type { EspecialidadDataset, Manifest } from './types';

// import.meta.glob descubre automáticamente cualquier {especialidad}.json que
// haya en src/data — añadir una especialidad nueva no requiere tocar este archivo.
const datasetLoaders = import.meta.glob<{ default: EspecialidadDataset }>([
  '../data/*.json',
  '!../data/manifest.json',
]);

function loaderFor(key: string) {
  const entry = Object.entries(datasetLoaders).find(([path]) => path.endsWith(`/${key}.json`));
  return entry?.[1];
}

export function useManifest(): Manifest | null {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  useEffect(() => {
    import('../data/manifest.json').then((m) => setManifest(m.default as Manifest));
  }, []);
  return manifest;
}

export function useDataset(key: string | null) {
  const [dataset, setDataset] = useState<EspecialidadDataset | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!key) return;
    const loader = loaderFor(key);
    if (!loader) {
      setError(`No hay datos generados todavía para "${key}"`);
      return;
    }
    setLoading(true);
    setError(null);
    loader()
      .then((m) => setDataset(m.default))
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [key]);

  return { dataset, loading, error };
}
