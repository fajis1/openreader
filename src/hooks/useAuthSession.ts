'use client';

import { useMemo } from 'react';
import { useAuthConfig } from '@/contexts/AuthRateLimitContext';
import { getAuthClient } from '@/lib/client/auth-client';

/**
 * Hook for session that uses the correct baseUrl from context.
 */
export function useAuthSession() {
  const { baseUrl } = useAuthConfig();

  const client = useMemo(() => {
    if (!baseUrl) {
      throw new Error('Auth base URL is required');
    }
    return getAuthClient(baseUrl);
  }, [baseUrl]);

  return client.useSession();
}
