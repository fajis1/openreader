import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

let cachedStandardFontDataUrl: string | null = null;
const require = createRequire(import.meta.url);

export function resolvePdfjsStandardFontDataUrl(): string {
  if (cachedStandardFontDataUrl) return cachedStandardFontDataUrl;

  const pdfjsPackageDir = path.dirname(require.resolve('pdfjs-dist/package.json'));
  const standardFontDir = path.join(pdfjsPackageDir, 'standard_fonts');

  if (!fs.existsSync(standardFontDir)) {
    throw new Error(`pdfjs-dist standard_fonts directory not found at ${standardFontDir}`);
  }

  cachedStandardFontDataUrl = `${standardFontDir.replace(/\/?$/, '/')}`;
  return cachedStandardFontDataUrl;
}
