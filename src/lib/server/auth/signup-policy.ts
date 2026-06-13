import { APIError } from 'better-auth/api';

/**
 * Parse the ALLOWED_EMAILS environment variable into a lowercase array.
 * Example: ALLOWED_EMAILS=alice@gmail.com,bob@gmail.com
 */
function getEnvAllowedEmails(): string[] {
  const raw = process.env.ALLOWED_EMAILS?.trim();
  if (!raw) return [];
  return raw.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
}

/**
 * Returns the effective allowlist — the union of the env var list and the
 * DB-managed list. Returns null when both are empty (no allowlist active).
 */
export function buildEffectiveAllowlist(dbAllowedEmails: string[]): Set<string> | null {
  const combined = [...getEnvAllowedEmails(), ...dbAllowedEmails];
  return combined.length > 0 ? new Set(combined) : null;
}

export function assertUserSignupAllowed(input: {
  enableUserSignups: boolean;
  isAnonymous?: boolean;
  email?: string;
  allowedEmails?: string[];
}): void {
  // Anonymous sessions are always allowed.
  if (input.isAnonymous) return;

  const allowlist = buildEffectiveAllowlist(input.allowedEmails ?? []);

  if (allowlist) {
    // Allowlist mode: only explicitly listed emails may create an account.
    const email = input.email?.trim().toLowerCase() ?? '';
    if (!allowlist.has(email)) {
      throw new APIError('FORBIDDEN', {
        message: 'This site is invite-only. Your email address is not on the access list.',
      });
    }
    return;
  }

  // No allowlist set — fall back to the global signups-enabled flag.
  if (input.enableUserSignups) return;
  throw new APIError('BAD_REQUEST', {
    message: 'New account sign-ups are disabled by the site administrator.',
  });
}
