import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

describe('AudiobookExportModal downloads', () => {
  const source = readFileSync(
    path.resolve(process.cwd(), 'src/components/AudiobookExportModal.tsx'),
    'utf8',
  );

  test('starts complete audiobook downloads without navigating the page', () => {
    expect(source).not.toContain('window.location.assign(url)');
    expect(source).toContain("downloadAudiobookWithBackgroundPolling");
  });
});
