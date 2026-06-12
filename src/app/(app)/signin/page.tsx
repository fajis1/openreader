'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { getAuthClient } from '@/lib/client/auth-client';
import { useAuthConfig, useAuthRateLimit } from '@/contexts/AuthRateLimitContext';
import { useFeatureFlag } from '@/contexts/RuntimeConfigContext';
import { showPrivacyModal } from '@/components/PrivacyModal';
import { GithubIcon } from '@/components/icons/Icons';
import { LoadingSpinner } from '@/components/Spinner';
import { Button, Checkbox, Field, InlineButton, Input, Surface } from '@/components/ui';

function SessionExpiredLoader({ setSessionExpired, setErrorFromUrl }: { setSessionExpired: (v: boolean) => void, setErrorFromUrl: (v: string | null) => void }) {
  const searchParams = useSearchParams();
  useEffect(() => {
    const reason = searchParams.get('reason');
    setSessionExpired(reason === 'expired');
    const err = searchParams.get('error');
    if (err) setErrorFromUrl(err);
  }, [searchParams, setSessionExpired, setErrorFromUrl]);
  return null;
}

function SignInContent() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loadingEmail, setLoadingEmail] = useState(false);
  const [loadingGithub, setLoadingGithub] = useState(false);
  const [loadingGoogle, setLoadingGoogle] = useState(false);
  const [loadingAnonymous, setLoadingAnonymous] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { baseUrl, allowAnonymousAuthSessions, githubAuthEnabled, googleAuthEnabled } = useAuthConfig();
  const enableUserSignups = useFeatureFlag('enableUserSignups');
  const { refresh: refreshRateLimit } = useAuthRateLimit();

  const isAnyLoading = loadingEmail || loadingGithub || loadingGoogle || loadingAnonymous;

  const validateEmail = (email: string): boolean => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  };

  const handleSignIn = async () => {
    setError(null);

    if (!email.trim() || !validateEmail(email)) {
      setError('Please enter a valid email address');
      return;
    }
    if (!password.trim()) {
      setError('Password is required');
      return;
    }

    setLoadingEmail(true);

    try {
      const client = getAuthClient(baseUrl);
      const result = await client.signIn.email({
        email: email.trim(),
        password,
        rememberMe
      });

      if (result.error) {
        const errorMessage = result.error.message || 'An unknown error occurred';
        if (errorMessage.toLowerCase().includes('invalid') ||
          errorMessage.toLowerCase().includes('credentials')) {
          setError('Invalid email or password');
        } else {
          setError(errorMessage);
        }
      } else {
        // Immediately refresh rate-limit status so the banner clears without a full reload.
        // This is especially important when an anonymous user upgrades to an account.
        await refreshRateLimit();
        window.location.href = '/app';
      }
    } catch (err) {
      console.error('Sign in error:', err);
      setError('Unable to connect. Please try again.');
    } finally {
      setLoadingEmail(false);
    }
  };

  const handleGithubSignIn = async () => {
    setLoadingGithub(true);
    try {
      const client = getAuthClient(baseUrl);
      await client.signIn.social({
        provider: 'github',
        callbackURL: '/app'
      });
    } finally {
      setLoadingGithub(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setLoadingGoogle(true);
    try {
      const client = getAuthClient(baseUrl);
      await client.signIn.social({
        provider: 'google',
        callbackURL: '/app'
      });
    } finally {
      setLoadingGoogle(false);
    }
  };

  const handleAnonymousContinue = async () => {
    setLoadingAnonymous(true);
    setError(null);
    try {
      const client = getAuthClient(baseUrl);
      await client.signIn.anonymous();
      await refreshRateLimit();
      window.location.href = '/app';
    } catch (e) {
      console.error('Anonymous sign-in failed:', e);
      setError('Unable to continue anonymously. Please try again.');
    } finally {
      setLoadingAnonymous(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <Suspense fallback={null}>
        <SessionExpiredLoader setSessionExpired={setSessionExpired} setErrorFromUrl={setError} />
      </Suspense>

        <Surface elevation="3" className="w-full max-w-md p-6">
          <h1 className="text-xl font-semibold text-foreground">
            {sessionExpired ? 'Session Expired' : 'Connect Account'}
          </h1>
          <p className="text-sm text-soft mt-1">
            {sessionExpired
              ? 'Please sign in again to continue'
              : 'Connect an email account to sync your data across devices'}
          </p>

        {/* Alerts */}
        {sessionExpired && (
          <div className="mt-4 p-3 bg-accent-wash border border-accent-line rounded-lg">
            <p className="text-sm text-accent ">
              Your session has expired. Please sign in again.
            </p>
          </div>
        )}

        {error && (
          <div className="mt-4 p-3 bg-danger-wash border border-danger rounded-lg">
            <p className="text-sm text-danger">{error}</p>
          </div>
        )}

        <div className="mt-6 space-y-4">
          {/* Email */}
          <Field label="Email">
            <Input
              type="email"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setError(null); }}
              placeholder="me@example.com"
              controlSize="lg"
            />
          </Field>

          {/* Password */}
          <Field label="Password">
            <Input
              type="password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError(null); }}
              placeholder="Password"
              controlSize="lg"
            />
          </Field>

          {/* Remember Me */}
          <label className="flex items-center gap-2 cursor-pointer">
            <Checkbox
              checked={rememberMe}
              onChange={(e) => setRememberMe(e.target.checked)}
            />
            <span className="text-sm text-foreground">Remember me</span>
          </label>

          {/* Connect Button */}
          <Button
            type="submit"
            disabled={isAnyLoading}
            onClick={handleSignIn}
            variant="primary"
            size="md"
            className="w-full"
          >
            {loadingEmail ? <LoadingSpinner className="w-4 h-4 mx-auto" /> : 'Connect'}
          </Button>

          {/* GitHub */}
          {githubAuthEnabled && (
          <Button
            type="button"
            disabled={isAnyLoading}
            onClick={handleGithubSignIn}
            variant="outline"
            size="md"
            className="w-full gap-2"
          >
            {loadingGithub ? (
              <LoadingSpinner className="w-4 h-4" />
            ) : (
              <>
                <GithubIcon className="w-4 h-4" />
                Sign in with GitHub
              </>
            )}
          </Button>
          )}

          {/* Google */}
          {googleAuthEnabled && (
          <Button
            type="button"
            disabled={isAnyLoading}
            onClick={handleGoogleSignIn}
            variant="outline"
            size="md"
            className="w-full gap-2"
          >
            {loadingGoogle ? (
              <LoadingSpinner className="w-4 h-4" />
            ) : (
              <>
                <svg className="w-4 h-4" viewBox="0 0 24 24">
                  <path
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    fill="#4285F4"
                  />
                  <path
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    fill="#34A853"
                  />
                  <path
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                    fill="#FBBC05"
                  />
                  <path
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                    fill="#EA4335"
                  />
                  <path d="M1 1h22v22H1z" fill="none" />
                </svg>
                Sign in with Google
              </>
            )}
          </Button>
          )}

          {/* Anonymous */}
          {allowAnonymousAuthSessions && (
            <Button
              type="button"
              disabled={isAnyLoading}
              onClick={handleAnonymousContinue}
              variant="outline"
              size="md"
              className="w-full"
            >
              {loadingAnonymous ? <LoadingSpinner className="w-4 h-4 mx-auto" /> : 'Continue anonymously'}
            </Button>
          )}
        </div>

        {/* Footer */}
        <div className="mt-6 pt-4 border-t border-line-soft text-center space-y-2">
          {enableUserSignups && (
            <p className="text-xs text-soft">
              Don&apos;t have an account?{' '}
              <Link href="/signup" className="underline hover:text-foreground">
                Sign up
              </Link>
            </p>
          )}
          <p className="text-xs text-soft">
            By signing in, you agree to our{' '}
            <InlineButton onClick={() => showPrivacyModal()}>
              Privacy Policy
            </InlineButton>
          </p>
        </div>
      </Surface>
    </div>
  );
}

export default function SignInPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-background">
        <LoadingSpinner className="w-8 h-8" />
      </div>
    }>
      <SignInContent />
    </Suspense>
  );
}
