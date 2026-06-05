'use client';

import type { ReactNode } from 'react';
import { DndProvider } from 'react-dnd';
import { TouchBackend } from 'react-dnd-touch-backend';
import { DocumentDragLayer } from './DocumentDragLayer';

/**
 * Single DnD backend for every input type. HTML5 drag-and-drop doesn't fire
 * from touch input, so rather than maintaining two backends and swapping per
 * device, we run the touch backend everywhere with `enableMouseEvents` so mouse
 * drags work too. One code path, identical behavior across devices.
 *
 * The touch backend renders no native drag image, so {@link DocumentDragLayer}
 * supplies the preview (a lightweight card) on all platforms.
 */
export function DocumentDndProvider({ children }: { children: ReactNode }) {
  return (
    <DndProvider
      backend={TouchBackend}
      options={{
        enableMouseEvents: true,
        enableTouchEvents: true,
        // Long-press to start a touch drag; mouse drags start immediately.
        delayTouchStart: 220,
        delayMouseStart: 0,
        // Require real movement before a drag begins, so a plain click (mouse or
        // tap) can never accidentally arm a drag and swallow the click/navigation.
        touchSlop: 10,
        ignoreContextMenu: true,
      }}
    >
      {children}
      <DocumentDragLayer />
    </DndProvider>
  );
}
