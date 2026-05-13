'use client';

import type { ReactNode } from 'react';

import { ConfigProvider } from '@/contexts/ConfigContext';
import { TTSProvider } from '@/contexts/TTSContext';
import { HTMLProvider } from '@/contexts/HTMLContext';

export default function HtmlReaderLayout({ children }: { children: ReactNode }) {
  return (
    <ConfigProvider>
      <TTSProvider>
        <HTMLProvider>{children}</HTMLProvider>
      </TTSProvider>
    </ConfigProvider>
  );
}
