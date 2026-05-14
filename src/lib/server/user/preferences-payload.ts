import { normalizeVersion } from '@/lib/shared/changelog';

export const USER_PREFERENCES_META_KEY = '_meta';
export const USER_PREFERENCES_LAST_SEEN_APP_VERSION_KEY = 'lastSeenAppVersion';

export type UserPreferencesMeta = Record<string, unknown> & {
  lastSeenAppVersion?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function deserializeUserPreferencesPayload(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return isRecord(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return isRecord(value) ? value : {};
}

export function extractUserPreferencesMeta(payload: unknown): UserPreferencesMeta {
  const record = deserializeUserPreferencesPayload(payload);
  const rawMeta = record[USER_PREFERENCES_META_KEY];
  if (!isRecord(rawMeta)) return {};

  const out: UserPreferencesMeta = { ...rawMeta };
  const rawLastSeen = out[USER_PREFERENCES_LAST_SEEN_APP_VERSION_KEY];
  if (typeof rawLastSeen === 'string') {
    out[USER_PREFERENCES_LAST_SEEN_APP_VERSION_KEY] = normalizeVersion(rawLastSeen);
  } else {
    delete out[USER_PREFERENCES_LAST_SEEN_APP_VERSION_KEY];
  }

  return out;
}

export function withUserPreferencesMeta(
  payload: Record<string, unknown>,
  meta: UserPreferencesMeta,
): Record<string, unknown> {
  const out = { ...payload };
  delete out[USER_PREFERENCES_META_KEY];
  if (Object.keys(meta).length > 0) {
    out[USER_PREFERENCES_META_KEY] = meta;
  }
  return out;
}
