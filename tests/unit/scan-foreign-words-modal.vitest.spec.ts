import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, test } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/components/doclist/ScanForeignWordsModal.tsx'),
  'utf8',
);

describe('foreign-word scan modal', () => {
  test('starts a scan only from the explicit scan button', () => {
    expect(source.match(/loadWords\(/g)).toHaveLength(1);
    expect(source).toContain("hasScanned ? 'Scan Again' : 'Start Scan'");
    expect(source).toContain('Choose the scan settings, then click Start Scan.');
  });

  test('guards against duplicate in-flight scan requests', () => {
    expect(source).toContain('if (scanInFlight.current) return;');
    expect(source).toContain('scanInFlight.current = true;');
    expect(source).toContain('scanInFlight.current = false;');
  });
});
