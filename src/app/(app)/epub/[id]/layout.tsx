'use client';

import type { ReactNode } from 'react';

import { ConfigProvider } from '@/contexts/ConfigContext';
import { TTSProvider } from '@/contexts/TTSContext';
import { EPUBProvider } from '@/contexts/EPUBContext';

export default function EpubReaderLayout({ children }: { children: ReactNode }) {
  return (
    <ConfigProvider>
      <TTSProvider>
        <EPUBProvider>{children}</EPUBProvider>
      </TTSProvider>
    </ConfigProvider>
  );
}
