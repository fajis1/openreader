import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Toaster } from 'react-hot-toast';

import { Providers } from '@/app/providers';
import { ConfigProvider } from '@/contexts/ConfigContext';
import { AppMain, AppShell } from '@/components/layout';
import { getAuthBaseUrl, isAnonymousAuthSessionsEnabled, isGithubAuthEnabled, isGoogleAuthEnabled } from '@/lib/server/auth/config';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
      'max-snippet': 0,
      'max-video-preview': 0,
    },
  },
};

export default function AppLayout({ children }: { children: ReactNode }) {
  const authBaseUrl = getAuthBaseUrl();
  const allowAnonymousAuthSessions = isAnonymousAuthSessionsEnabled();
  const githubAuthEnabled = isGithubAuthEnabled();
  const googleAuthEnabled = isGoogleAuthEnabled();

  return (
    <Providers
      authBaseUrl={authBaseUrl}
      allowAnonymousAuthSessions={allowAnonymousAuthSessions}
      githubAuthEnabled={githubAuthEnabled}
      googleAuthEnabled={googleAuthEnabled}
    >
      {/* ConfigProvider lives here, in the shared (app) layout, so it stays
          mounted across library <-> reader navigation. Mounting it per-route
          re-ran the Dexie/server hydration race on every navigation, causing
          the reader to briefly use the admin-default provider until a full
          page refresh. A single shared instance keeps the user's saved
          provider hydrated the whole time. */}
      <ConfigProvider>
        <AppShell>
          <AppMain>{children}</AppMain>
        </AppShell>
      </ConfigProvider>
      <Toaster
        toastOptions={{
          style: {
            background: 'var(--offbase)',
            color: 'var(--foreground)',
          },
          success: {
            iconTheme: {
              primary: 'var(--accent)',
              secondary: 'var(--background)',
            },
          },
          error: {
            iconTheme: {
              primary: 'var(--accent)',
              secondary: 'var(--background)',
            },
          },
        }}
      />
    </Providers>
  );
}
