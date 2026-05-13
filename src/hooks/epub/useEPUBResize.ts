import { useEffect, RefObject, useRef, useState } from 'react';
import { debounce } from '@/lib/client/pdf';

export function useEPUBResize(containerRef: RefObject<HTMLDivElement | null>) {
  const [isResizing, setIsResizing] = useState(false);
  const [dimensions, setDimensions] = useState<DOMRectReadOnly | null>(null);
  const hasBaselineRectRef = useRef(false);
  const lastRectRef = useRef<{ width: number; height: number } | null>(null);
  
  useEffect(() => {
    const debouncedResize = debounce((...args: unknown[]) => {
      const entries = args[0] as ResizeObserverEntry[];
      const rect = entries[0]?.contentRect;
      if (!rect) return;

      const nextWidth = Math.round(rect.width);
      const nextHeight = Math.round(rect.height);
      const prev = lastRectRef.current;
      lastRectRef.current = { width: nextWidth, height: nextHeight };

      // First callback after observer attach reflects initial layout, not a user
      // resize. Treat it as baseline to avoid pausing TTS on page load.
      if (!hasBaselineRectRef.current) {
        hasBaselineRectRef.current = true;
        setDimensions(rect);
        return;
      }

      if (prev && prev.width === nextWidth && prev.height === nextHeight) {
        return;
      }

      setDimensions(rect);
      setIsResizing((prev) => {
        if (!prev) return true;
        return prev;
      });
    }, 150);

    const resizeObserver = new ResizeObserver((entries) => {
      debouncedResize(entries);
    });

    const mutationObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.addedNodes.length) {
          const container = containerRef.current?.querySelector('.epub-container');
          if (container) {
            resizeObserver.observe(container);
            mutationObserver.disconnect();
            break;
          }
        }
      }
    });

    if (containerRef.current) {
      mutationObserver.observe(containerRef.current, {
        childList: true,
        subtree: true
      });

      const container = containerRef.current.querySelector('.epub-container');
      if (container) {
        resizeObserver.observe(container);
        mutationObserver.disconnect();
      }
    }

    return () => {
      mutationObserver.disconnect();
      resizeObserver.disconnect();
    };
  }, [containerRef]);

  return { isResizing, setIsResizing, dimensions };
}
