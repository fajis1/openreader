'use client';

import { ReactNode, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { ThemeProvider } from '@/contexts/ThemeContext';
import { AuthRateLimitProvider } from '@/contexts/AuthRateLimitContext';
import { RuntimeConfigProvider } from '@/contexts/RuntimeConfigContext';
import { PrivacyModal } from '@/components/PrivacyModal';
import { AuthLoader } from '@/components/auth/AuthLoader';

interface ProvidersProps {
  children: ReactNode;
  authEnabled: boolean;
  authBaseUrl: string | null;
  allowAnonymousAuthSessions: boolean;
  githubAuthEnabled: boolean;
}

export function Providers({ children, authEnabled, authBaseUrl, allowAnonymousAuthSessions, githubAuthEnabled }: ProvidersProps) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        retry: 1,
        refetchOnWindowFocus: false,
      },
    },
  }));

  return (
    <QueryClientProvider client={queryClient}>
      <RuntimeConfigProvider>
        <AuthRateLimitProvider
          authEnabled={authEnabled}
          authBaseUrl={authBaseUrl}
          allowAnonymousAuthSessions={allowAnonymousAuthSessions}
          githubAuthEnabled={githubAuthEnabled}
        >
          <ThemeProvider>
            <AuthLoader>
              <>
                {children}
                {authEnabled && <PrivacyModal />}
              </>
            </AuthLoader>
          </ThemeProvider>
        </AuthRateLimitProvider>
      </RuntimeConfigProvider>
    </QueryClientProvider>
  );
}
