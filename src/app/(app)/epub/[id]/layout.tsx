'use client';

import type { ReactNode } from 'react';

import { TTSProvider } from '@/contexts/TTSContext';

// ConfigProvider is mounted once in the shared (app) layout so it survives
// library <-> reader navigation; do not re-wrap it here.
export default function EpubReaderLayout({ children }: { children: ReactNode }) {
  return (
    <TTSProvider>
      {children}
    </TTSProvider>
  );
}
