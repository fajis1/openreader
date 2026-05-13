'use client';

import type { ReactNode } from 'react';

import { ConfigProvider } from '@/contexts/ConfigContext';
import { DocumentProvider } from '@/contexts/DocumentContext';
import { DexieMigrationModal } from '@/components/documents/DexieMigrationModal';

export default function AppHomeLayout({ children }: { children: ReactNode }) {
  return (
    <ConfigProvider>
      <DocumentProvider>
        <>
          {children}
          <DexieMigrationModal />
        </>
      </DocumentProvider>
    </ConfigProvider>
  );
}
