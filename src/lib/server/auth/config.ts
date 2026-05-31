export type RequiredAuthEnv = {
  authSecret: string;
  baseUrl: string;
};

function getRequiredEnvValue(name: 'AUTH_SECRET' | 'BASE_URL'): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. `
      + 'OpenReader v4 requires both AUTH_SECRET and BASE_URL at startup.',
    );
  }
  return value;
}

export function getRequiredAuthEnv(): RequiredAuthEnv {
  return {
    authSecret: getRequiredEnvValue('AUTH_SECRET'),
    baseUrl: getRequiredEnvValue('BASE_URL'),
  };
}

function parseBooleanEnv(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name];
  if (!raw || raw.trim() === '') return defaultValue;

  const normalized = raw.trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  return defaultValue;
}

/**
 * Anonymous sessions are opt-in.
 * Defaults to false when unset or invalid.
 */
export function isAnonymousAuthSessionsEnabled(): boolean {
  getRequiredAuthEnv();
  return parseBooleanEnv('USE_ANONYMOUS_AUTH_SESSIONS', false);
}

/**
 * GitHub sign-in is available when both GITHUB_CLIENT_ID and
 * GITHUB_CLIENT_SECRET are set.
 */
export function isGithubAuthEnabled(): boolean {
  return !!(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET);
}

/**
 * Get the required auth base URL.
 */
export function getAuthBaseUrl(): string {
  return getRequiredAuthEnv().baseUrl;
}
