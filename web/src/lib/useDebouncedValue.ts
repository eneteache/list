import { useEffect, useState } from 'react';

// Evita relanzar el filtrado/re-render de la tabla en cada pulsación de
// teclado — solo aplica el valor cuando el usuario deja de escribir un rato.
export function useDebouncedValue<T>(value: T, delayMs = 150): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);

  return debounced;
}
