import { describe, expect, test } from 'vitest';

import {
  mergeDocumentSettings,
  preserveServerManagedDocumentSettings,
} from '../../src/lib/shared/document-settings';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_DOCUMENT_SETTINGS } from '../../src/types/document-settings';

describe('document settings language', () => {
  test('defaults to automatic language resolution', () => {
    expect(mergeDocumentSettings(DEFAULT_DOCUMENT_SETTINGS, null).language).toBe('auto');
  });

  test('normalizes explicit BCP 47 language tags', () => {
    expect(mergeDocumentSettings(DEFAULT_DOCUMENT_SETTINGS, { language: 'zh-cn' }).language).toBe('zh-CN');
    expect(mergeDocumentSettings(DEFAULT_DOCUMENT_SETTINGS, { language: 'JA' }).language).toBe('ja');
  });

  test('preserves language when PDF settings are absent', () => {
    expect(mergeDocumentSettings(DEFAULT_DOCUMENT_SETTINGS, { language: 'fr' })).toMatchObject({
      language: 'fr',
      pdf: DEFAULT_DOCUMENT_SETTINGS.pdf,
    });
  });

  test('preserves a server-managed book lexicon across stale client saves', () => {
    const lexicon = {
      schemaVersion: 1 as const,
      status: 'complete' as const,
      definitionScanComplete: true,
      profileId: 'scholar',
      pronunciationModel: 'pronunciation-model',
      scannedAt: 123,
      entries: {},
    };
    const incoming = mergeDocumentSettings(DEFAULT_DOCUMENT_SETTINGS, {
      language: 'fr',
    });
    const existing = mergeDocumentSettings(DEFAULT_DOCUMENT_SETTINGS, {
      language: 'en',
      smartAudioLexicon: lexicon,
    });

    expect(preserveServerManagedDocumentSettings(incoming, existing)).toEqual({
      ...incoming,
      smartAudioLexicon: lexicon,
    });

    expect(preserveServerManagedDocumentSettings({
      ...incoming,
      smartAudioLexicon: lexicon,
    }, null)).toEqual(incoming);
  });

  test('document settings PUT preserves the latest lexicon atomically in the database', () => {
    const route = fs.readFileSync(
      path.join(process.cwd(), 'src/app/api/documents/[id]/settings/route.ts'),
      'utf8',
    );
    expect(route).toContain("${documentSettings.dataJson}->'smartAudioLexicon'");
    expect(route).toContain("json_extract(${documentSettings.dataJson}, '$.smartAudioLexicon')");
    expect(route).toContain('.returning({ dataJson: documentSettings.dataJson })');
  });
});
