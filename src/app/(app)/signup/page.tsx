'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { getAuthClient } from '@/lib/client/auth-client';
import { useAuthConfig, useAuthRateLimit } from '@/contexts/AuthRateLimitContext';
import { useFeatureFlag } from '@/contexts/RuntimeConfigContext';
import { showPrivacyModal } from '@/components/PrivacyModal';
import { LoadingSpinner } from '@/components/Spinner';
import { GithubIcon } from '@/components/icons/Icons';
import { Button, Field, IconButton, InlineButton, Input, Surface } from '@/components/ui';
import toast from 'react-hot-toast';

export default function SignUpPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingGithub, setLoadingGithub] = useState(false);
  const [loadingGoogle, setLoadingGoogle] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { baseUrl, githubAuthEnabled, googleAuthEnabled } = useAuthConfig();
  const enableUserSignups = useFeatureFlag('enableUserSignups');
  const { refresh: refreshRateLimit } = useAuthRateLimit();

  const isAnyLoading = loading || loadingGithub || loadingGoogle;

  const validateEmail = (email: string): boolean => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  };

  const validatePassword = (password: string) => {
    const checks = {
      length: password.length >= 8,
      uppercase: /[A-Z]/.test(password),
      lowercase: /[a-z]/.test(password),
      number: /\d/.test(password),
      special: /[!@#$%^&*(),.?":{}|<>]/.test(password)
    };
    const strength = Object.values(checks).filter(Boolean).length;
    return { checks, strength };
  };

  const handleSignUp = async () => {
    setError(null);
    if (!enableUserSignups) {
      setError('New account sign-ups are currently disabled by the site administrator.');
      return;
    }

    if (!email.trim() || !validateEmail(email)) {
      setError('Please enter a valid email address');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    const { strength } = validatePassword(password);
    if (strength < 3) {
      setError('Password is too weak');
      return;
    }
    if (password !== passwordConfirmation) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);

    try {
      const client = getAuthClient(baseUrl);
      const result = await client.signUp.email({
        email: email.trim(),
        password,
        name: email.trim().split('@')[0], // Use part of email as name
      });

      if (result.error) {
        const errorMessage = result.error.message || 'An unknown error occurred';
        if (errorMessage.toLowerCase().includes('already exists')) {
          setError('An account with this email already exists');
        } else {
          setError(errorMessage);
        }
      } else {
        // Auto sign in
        const signInResult = await client.signIn.email({ email: email.trim(), password });
        if (signInResult.error) {
          toast.success('Account created! Please sign in.');
          router.push('/signin');
        } else {
          await refreshRateLimit();
          toast.success('Account created successfully!');
          router.push('/app');
        }
      }
    } catch (err) {
      console.error('Signup error:', err);
      setError('Unable to connect. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleGithubSignUp = async () => {
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

  const handleGoogleSignUp = async () => {
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

  if (!enableUserSignups) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-background">
        <Surface elevation="3" className="w-full max-w-md p-6">
          <h1 className="text-xl font-semibold text-foreground">Sign-ups unavailable</h1>
          <p className="text-sm text-soft mt-1">
            New account sign-ups are currently disabled by the site administrator.
          </p>
          <div className="mt-6 pt-4 border-t border-line-soft text-center">
            <p className="text-xs text-soft">
              Already have an account?{' '}
              <Link href="/signin" className="underline hover:text-foreground">
                Sign in
              </Link>
            </p>
          </div>
        </Surface>
      </div>
    );
  }

  const { checks, strength } = validatePassword(password);
  const strengthLabels = ['Very Weak', 'Weak', 'Fair', 'Good', 'Strong'];
  const strengthColors = ['bg-danger', 'bg-danger', 'bg-accent', 'bg-accent', 'bg-accent'];

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <Surface elevation="3" className="w-full max-w-md p-6">
        <h1 className="text-xl font-semibold text-foreground">Sign Up</h1>
        <p className="text-sm text-soft mt-1">Create your account to get started</p>

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
              onChange={(e) => setEmail(e.target.value)}
              placeholder="me@example.com"
              controlSize="lg"
            />
          </Field>

          {/* Password */}
          <Field label="Password">
            <div className="relative">
              <Input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                controlSize="lg"
                className="pr-10"
              />
              <IconButton
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-2 top-1/2 h-7 w-7 -translate-y-1/2"
              >
                {showPassword ? '👁️' : '👁️‍🗨️'}
              </IconButton>
            </div>

            {/* Password Strength */}
            {password && (
              <div className="mt-2 space-y-1">
                <div className="flex gap-1">
                  {[0, 1, 2, 3, 4].map((i) => (
                    <div
                      key={i}
                      className={`h-1 flex-1 rounded ${i < strength ? strengthColors[strength - 1] : 'bg-surface-sunken'
                        }`}
                    />
                  ))}
                </div>
                <p className={`text-xs ${strength >= 3 ? 'text-accent' : 'text-danger'}`}>
                  {strengthLabels[strength - 1] || 'Very Weak'}
                </p>
                <div className="text-xs space-y-0.5 text-soft">
                  {Object.entries(checks).map(([key, passed]) => (
                    <div key={key} className={`flex items-center gap-1 ${passed ? 'text-accent' : ''}`}>
                      <span>{passed ? '✓' : '○'}</span>
                      <span>
                        {key === 'length' && 'At least 8 characters'}
                        {key === 'uppercase' && 'Uppercase letter'}
                        {key === 'lowercase' && 'Lowercase letter'}
                        {key === 'number' && 'Number'}
                        {key === 'special' && 'Special character'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Field>

          {/* Confirm Password */}
          <Field label="Confirm Password">
            <Input
              type={showPassword ? 'text' : 'password'}
              value={passwordConfirmation}
              onChange={(e) => setPasswordConfirmation(e.target.value)}
              placeholder="Confirm Password"
              controlSize="lg"
            />
            {passwordConfirmation && password && (
              <p className={`text-xs mt-1 ${password === passwordConfirmation ? 'text-accent' : 'text-danger'}`}>
                {password === passwordConfirmation ? '✓ Passwords match' : '✗ Passwords do not match'}
              </p>
            )}
          </Field>

          {/* Sign Up Button */}
          <Button
            type="submit"
            disabled={isAnyLoading}
            onClick={handleSignUp}
            variant="primary"
            size="md"
            className="w-full"
          >
            {loading ? <LoadingSpinner className="w-4 h-4 mx-auto" /> : 'Create Account'}
          </Button>

          {/* GitHub */}
          {githubAuthEnabled && (
          <Button
            type="button"
            disabled={isAnyLoading}
            onClick={handleGithubSignUp}
            variant="outline"
            size="md"
            className="w-full gap-2"
          >
            {loadingGithub ? (
              <LoadingSpinner className="w-4 h-4" />
            ) : (
              <>
                <GithubIcon className="w-4 h-4" />
                Sign up with GitHub
              </>
            )}
          </Button>
          )}

          {/* Google */}
          {googleAuthEnabled && (
          <Button
            type="button"
            disabled={isAnyLoading}
            onClick={handleGoogleSignUp}
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
                Sign up with Google
              </>
            )}
          </Button>
          )}
        </div>

        {/* Footer */}
        <div className="mt-6 pt-4 border-t border-line-soft text-center space-y-2">
          <p className="text-xs text-soft">
            Already have an account?{' '}
            <Link href="/signin" className="underline hover:text-foreground">
              Sign in
            </Link>
          </p>
          <p className="text-xs text-soft">
            By creating an account, you agree to our{' '}
            <InlineButton onClick={() => showPrivacyModal()}>
              Privacy Policy
            </InlineButton>
          </p>
        </div>
      </Surface>
    </div>
  );
}
