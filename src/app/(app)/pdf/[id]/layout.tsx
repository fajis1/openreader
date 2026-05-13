'use client';

import type { ReactNode } from 'react';

import { ConfigProvider } from '@/contexts/ConfigContext';
import { TTSProvider } from '@/contexts/TTSContext';
import { PDFProvider } from '@/contexts/PDFContext';

export default function PdfReaderLayout({ children }: { children: ReactNode }) {
  return (
    <ConfigProvider>
      <TTSProvider>
        <PDFProvider>{children}</PDFProvider>
      </TTSProvider>
    </ConfigProvider>
  );
}
