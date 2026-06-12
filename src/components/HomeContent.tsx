'use client';

import { useState, useEffect } from 'react';
import { DocumentList } from '@/components/doclist/DocumentList';
import { SettingsModal, SettingsTrigger } from '@/components/SettingsModal';
import { UserMenu } from '@/components/auth/UserMenu';
import { SmartAudioSettings } from '@/components/SmartAudioSettings';
import { SidebarNavItem } from '@/components/ui';

const Brand = () => (
  <div className="flex items-center gap-2 min-w-0">
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src="/icon.svg" alt="" className="w-5 h-5 shrink-0" aria-hidden="true" />
    <h1 className="hidden sm:block text-xs sm:text-sm font-bold truncate text-foreground tracking-tight">
      OpenReader
    </h1>
  </div>
);

export function HomeContent() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [smartAiOpen, setSmartAiOpen] = useState(false);

  useEffect(() => {
    const handleOpen = () => setSmartAiOpen(true);
    window.addEventListener('open-smart-ai-profiles', handleOpen);
    return () => window.removeEventListener('open-smart-ai-profiles', handleOpen);
  }, []);

  const appActions = (
    <div className="flex flex-col gap-0.5 w-full">
      <SettingsTrigger
        variant="sidebar"
        triggerLabel="Settings"
        onOpen={() => setSettingsOpen(true)}
      />
      <SidebarNavItem
        compact
        onClick={() => setSmartAiOpen(true)}
        aria-label="Smart AI Profiles"
        icon={
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" />
          </svg>
        }
        label="Smart AI Profiles"
      />
      <UserMenu variant="sidebar" />
    </div>
  );

  return (
    <div className="w-full h-full">
      <DocumentList brand={<Brand />} appActions={appActions} />
      <SettingsModal open={settingsOpen} onOpenChange={setSettingsOpen} />

      {/* Smart AI Profiles Modal */}
      {smartAiOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Smart AI Profiles"
        >
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setSmartAiOpen(false)}
          />
          {/* Panel */}
          <div className="relative z-10 w-full max-w-4xl max-h-[90vh] flex flex-col bg-surface rounded-xl shadow-2xl border border-line overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-line shrink-0">
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" />
                </svg>
                <h2 className="text-base font-semibold text-foreground">Smart AI Profiles</h2>
              </div>
              <button
                onClick={() => setSmartAiOpen(false)}
                className="rounded-md p-1.5 text-soft hover:text-foreground hover:bg-surface-raised transition-colors"
                aria-label="Close Smart AI Profiles"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            {/* Scrollable content */}
            <div className="overflow-y-auto flex-1 p-5">
              <SmartAudioSettings />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
