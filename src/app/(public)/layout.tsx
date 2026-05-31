import type { ReactNode } from 'react';
import Link from 'next/link';
import { getResolvedRuntimeConfigForRsc } from '@/lib/server/runtime-config-rsc';
import { buttonClass } from '@/components/ui/buttonPrimitives';
import './public.css';

export default async function PublicLayout({ children }: { children: ReactNode }) {
  const runtimeConfig = await getResolvedRuntimeConfigForRsc();
  const enableUserSignups = runtimeConfig.enableUserSignups;

  return (
    <div className="public-shell">
      <div className="public-atmosphere" aria-hidden="true" />
      <div className="public-frame">
        <div className="public-topbar">
          <div className="public-wrap">
            <header className="public-topbar-inner public-reveal-1">
              <Link href="/" className="public-brand" aria-label="OpenReader home">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/icon.svg" alt="" className="public-brand-mark" aria-hidden="true" />
                <span>
                  <span className="public-brand-text">OpenReader</span>
                  <span className="public-brand-tag">Read + Listen</span>
                </span>
              </Link>

              <nav className="public-nav" aria-label="Primary">
                <Link href="/app" className={buttonClass({ variant: 'primary', size: 'sm' })}>
                  Open App
                </Link>
                <Link href="/signin" className={buttonClass({ variant: 'secondary', size: 'sm' })}>
                  Sign In
                </Link>
                {enableUserSignups ? (
                  <Link href="/signup" className={buttonClass({ variant: 'outline', size: 'sm' })}>
                    Sign Up
                  </Link>
                ) : null}
                <Link
                  href="https://docs.openreader.richardr.dev/"
                  className={buttonClass({ variant: 'ghost', size: 'sm' })}
                >
                  Docs
                </Link>
              </nav>
            </header>
          </div>
        </div>

        {children}

        <footer className="public-footer">
          <div className="public-wrap">
            <div className="public-footer-inner">
              <p className="public-footer-label">Open source document reader with synchronized text-to-speech playback.</p>
              <div className="public-footer-links">
                <Link href="/privacy">Privacy</Link>
                <a href="https://github.com/richardr1126/openreader#readme" target="_blank" rel="noopener noreferrer">
                  GitHub
                </a>
                <a href="https://github.com/richardr1126/openreader/discussions" target="_blank" rel="noopener noreferrer">
                  Discussions
                </a>
                <a href="https://docs.openreader.richardr.dev/" target="_blank" rel="noopener noreferrer">
                  Documentation
                </a>
              </div>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
