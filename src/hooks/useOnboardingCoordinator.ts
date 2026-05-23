'use client';

import { useCallback, useEffect, useRef } from 'react';
import {
  scheduleChangelogCheck,
  type ChangelogVersionCheckResponse,
} from '@/lib/client/changelog-check';

type OpenSettingsOptions = {
  changelog?: boolean;
};

type LocalOnboardingSnapshot = {
  privacyAccepted: boolean;
  firstVisitSettingsOpened: boolean;
};

type UseOnboardingCoordinatorArgs = {
  authEnabled: boolean;
  isSessionPending: boolean;
  sessionUserId: string | null | undefined;
  appVersion: string | null | undefined;
  isSettingsOpen: boolean;
  readLocalSnapshot: () => Promise<LocalOnboardingSnapshot>;
  markFirstVisitSettingsOpened: () => Promise<void>;
  postChangelogVersionCheck: (currentVersion: string) => Promise<ChangelogVersionCheckResponse>;
  openSettings: (options?: OpenSettingsOptions) => void;
  closeSettings: () => void;
};

type UseOnboardingCoordinatorResult = {
  requestOpenSettings: (options?: OpenSettingsOptions) => Promise<boolean>;
};

export function useOnboardingCoordinator(
  args: UseOnboardingCoordinatorArgs,
): UseOnboardingCoordinatorResult {
  const {
    authEnabled,
    isSessionPending,
    sessionUserId,
    appVersion,
    isSettingsOpen,
    readLocalSnapshot,
    markFirstVisitSettingsOpened,
    postChangelogVersionCheck,
    openSettings,
    closeSettings,
  } = args;

  const pendingChangelogOpenRef = useRef(false);
  const changelogVersionCheckKeyRef = useRef<string | null>(null);
  const changelogVersionCheckInFlightRef = useRef<string | null>(null);

  const canOpenSettingsNow = useCallback(async (): Promise<{
    allowed: boolean;
    local: LocalOnboardingSnapshot | null;
  }> => {
    if (!authEnabled) {
      return { allowed: true, local: null };
    }

    const local = await readLocalSnapshot();
    return {
      allowed: local.privacyAccepted,
      local,
    };
  }, [authEnabled, readLocalSnapshot]);

  const requestOpenSettings = useCallback(async (options?: OpenSettingsOptions): Promise<boolean> => {
    const gate = await canOpenSettingsNow();
    if (!gate.allowed) {
      if (options?.changelog) {
        pendingChangelogOpenRef.current = true;
      }
      closeSettings();
      return false;
    }

    openSettings({ changelog: Boolean(options?.changelog) });
    return true;
  }, [canOpenSettingsNow, closeSettings, openSettings]);

  const maybeOpenFirstVisitSettings = useCallback(async () => {
    const gate = await canOpenSettingsNow();
    if (!gate.allowed) {
      return;
    }

    const firstVisitSettingsOpened = gate.local
      ? gate.local.firstVisitSettingsOpened
      : (await readLocalSnapshot()).firstVisitSettingsOpened;

    if (firstVisitSettingsOpened) {
      return;
    }

    await markFirstVisitSettingsOpened();
    openSettings();
  }, [canOpenSettingsNow, markFirstVisitSettingsOpened, openSettings, readLocalSnapshot]);

  const replayDeferredChangelogOpen = useCallback(async () => {
    if (!pendingChangelogOpenRef.current) {
      return;
    }

    const opened = await requestOpenSettings({ changelog: true });
    if (opened) {
      pendingChangelogOpenRef.current = false;
    }
  }, [requestOpenSettings]);

  useEffect(() => {
    maybeOpenFirstVisitSettings().catch((err) => {
      console.error('First visit settings check failed:', err);
    });
  }, [maybeOpenFirstVisitSettings]);

  useEffect(() => {
    if (!authEnabled) {
      return;
    }

    const onPrivacyAccepted = () => {
      maybeOpenFirstVisitSettings().catch((err) => {
        console.error('First visit settings check after privacy acceptance failed:', err);
      });
      replayDeferredChangelogOpen().catch((err) => {
        console.error('Deferred changelog open after privacy acceptance failed:', err);
      });
    };

    window.addEventListener('openreader:privacyAccepted', onPrivacyAccepted);
    return () => {
      window.removeEventListener('openreader:privacyAccepted', onPrivacyAccepted);
    };
  }, [authEnabled, maybeOpenFirstVisitSettings, replayDeferredChangelogOpen]);

  useEffect(() => {
    if (!isSettingsOpen) {
      return;
    }

    let cancelled = false;
    void (async () => {
      const gate = await canOpenSettingsNow();
      if (!gate.allowed && !cancelled) {
        closeSettings();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [canOpenSettingsNow, closeSettings, isSettingsOpen]);

  useEffect(() => {
    return scheduleChangelogCheck({
      authEnabled,
      isSessionPending,
      sessionUserId,
      appVersion,
      completedRef: changelogVersionCheckKeyRef,
      inFlightRef: changelogVersionCheckInFlightRef,
      postCheck: postChangelogVersionCheck,
      onShouldOpen: () => {
        void requestOpenSettings({ changelog: true });
      },
      delayMs: 120,
      retryDelayMs: 400,
    });
  }, [
    appVersion,
    authEnabled,
    isSessionPending,
    postChangelogVersionCheck,
    sessionUserId,
    requestOpenSettings,
  ]);

  return {
    requestOpenSettings,
  };
}
