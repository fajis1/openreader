import type { ReactNode } from 'react';
import { TTSProvider } from '@/contexts/TTSContext';

export default function ListenLayout({ children }: { children: ReactNode }) {
  return (
    <TTSProvider>{children}</TTSProvider>
  );
}
