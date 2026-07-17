import { useVirtualizer, type VirtualItem } from '@tanstack/react-virtual';
import type { RefObject } from 'react';

// Envuelve @tanstack/react-virtual con los valores por defecto que usan
// Tabla.tsx e Interinos.tsx: solo se montan en el DOM las filas visibles
// (+ colchón de overscan) en vez de las miles que puede tener la tabla
// completa, que es lo que hacía lenta tanto la carga como cada tecleo en el
// buscador (cada re-render tocaba todas las filas).
export function useRowVirtualizer(rowCount: number, scrollRef: RefObject<HTMLDivElement | null>) {
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 34,
    overscan: 15,
  });

  const virtualItems: VirtualItem[] = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();
  const paddingTop = virtualItems.length > 0 ? virtualItems[0].start : 0;
  const paddingBottom = virtualItems.length > 0 ? totalSize - virtualItems[virtualItems.length - 1].end : 0;

  return { virtualItems, paddingTop, paddingBottom, measureElement: virtualizer.measureElement };
}
