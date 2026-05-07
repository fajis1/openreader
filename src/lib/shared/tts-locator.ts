import type { TTSSegmentLocator } from '@/types/client';

export function normalizeEpubLocationToken(location: string): string {
  return location
    .trim()
    .replace(/\[;s=[ab]\]/gi, '')
    .replace(/\s+/g, '');
}

export function locatorGroupKey(locator: TTSSegmentLocator | null): string {
  if (!locator) return 'none';
  const page = typeof locator.page === 'number' && Number.isFinite(locator.page)
    ? String(Math.floor(locator.page))
    : '';
  const location = typeof locator.location === 'string' ? locator.location : '';
  const readerType = locator.readerType || '';
  return `p:${page}|l:${location}|r:${readerType}`;
}
