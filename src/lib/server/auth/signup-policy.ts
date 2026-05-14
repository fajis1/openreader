import { APIError } from 'better-auth/api';

export function assertUserSignupAllowed(input: {
  enableUserSignups: boolean;
  isAnonymous?: boolean;
}): void {
  if (input.enableUserSignups || input.isAnonymous) return;
  throw new APIError('BAD_REQUEST', {
    message: 'New account sign-ups are disabled by the site administrator.',
  });
}

