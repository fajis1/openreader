import type { ChangelogManifestEntry, ChangelogReleaseBody } from '@/lib/shared/changelog';
import { sortManifestEntries } from '@/lib/shared/changelog';

interface ManifestDocument {
  generated_at?: string;
  releases?: ChangelogManifestEntry[];
}

export async function fetchChangelogManifest(url: string, signal?: AbortSignal): Promise<ChangelogManifestEntry[]> {
  const res = await fetch(url, {
    signal,
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch changelog manifest: HTTP ${res.status}`);
  }

  const data = (await res.json()) as ManifestDocument;
  if (!Array.isArray(data.releases)) {
    throw new Error('Invalid changelog manifest format');
  }

  const sanitized = data.releases.filter((entry) => (
    !!entry
    && typeof entry.tag_name === 'string'
    && typeof entry.name === 'string'
    && typeof entry.published_at === 'string'
    && typeof entry.html_url === 'string'
    && typeof entry.body_path === 'string'
    && typeof entry.prerelease === 'boolean'
  ));

  return sortManifestEntries(sanitized);
}

export async function fetchChangelogReleaseBody(baseManifestUrl: string, bodyPath: string, signal?: AbortSignal): Promise<ChangelogReleaseBody> {
  const bodyUrl = new URL(bodyPath.replace(/^\/+/, ''), `${new URL(baseManifestUrl).origin}/`).toString();
  const res = await fetch(bodyUrl, {
    signal,
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch changelog release body: HTTP ${res.status}`);
  }

  const data = await res.json() as ChangelogReleaseBody;
  if (typeof data.body !== 'string') {
    throw new Error('Invalid changelog release body format');
  }
  return data;
}
