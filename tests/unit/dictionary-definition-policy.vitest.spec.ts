import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  getDictionaryDefinitionQualityWarnings,
  normalizeDictionaryDefinition,
  shouldOmitDictionaryDefinition,
} from '@/lib/shared/dictionary-definition-policy';

describe('dictionary definition policy', () => {
  test('rejects form-description placeholders instead of speaking them', () => {
    for (const placeholder of [
      'Fragment or inflected form',
      'fragment or inflected form.',
      'An OCR fragment',
      'adoption fragment',
      'proper name fragment',
      'Inflected form',
    ]) {
      expect(shouldOmitDictionaryDefinition(placeholder)).toBe(true);
      expect(normalizeDictionaryDefinition(placeholder)).toBeNull();
      expect(getDictionaryDefinitionQualityWarnings(placeholder)).not.toHaveLength(0);
    }
  });

  test('preserves useful contextual definitions', () => {
    expect(normalizeDictionaryDefinition('a spoken word')).toBe('a spoken word');
    expect(normalizeDictionaryDefinition('to think')).toBe('to think');
    expect(shouldOmitDictionaryDefinition('fragment')).toBe(false);
    expect(shouldOmitDictionaryDefinition('broken piece')).toBe(false);
  });

  test('keeps one contextual gloss instead of narrating synonym lists', () => {
    expect(normalizeDictionaryDefinition('to think, set mind')).toBe('to think');
    expect(normalizeDictionaryDefinition('word or account')).toBe('word');
    expect(normalizeDictionaryDefinition('love / loyalty')).toBe('love');
    expect(normalizeDictionaryDefinition('think and understand')).toBe('think');
    expect(shouldOmitDictionaryDefinition('to think, set mind')).toBe(false);
    expect(getDictionaryDefinitionQualityWarnings('to think, set mind'))
      .toContain('Contains multiple meanings; only the first contextual gloss will be kept.');
  });

  test('omits connector-only glosses while retaining content words', () => {
    for (const connector of ['the', 'or', 'of', 'off', 'like', 'in or on']) {
      expect(normalizeDictionaryDefinition(connector)).toBeNull();
      expect(shouldOmitDictionaryDefinition(connector)).toBe(true);
      expect(getDictionaryDefinitionQualityWarnings(connector))
        .toContain('Gloss contains only common connecting or function words and should not be narrated.');
    }
    expect(normalizeDictionaryDefinition('to understand')).toBe('to understand');
    expect(normalizeDictionaryDefinition('covenant love')).toBe('covenant love');
  });

  test('exposes a document audit and cleanup tool in the scan window', () => {
    const modal = fs.readFileSync(
      path.join(process.cwd(), 'src/components/doclist/ScanForeignWordsModal.tsx'),
      'utf8',
    );
    const route = fs.readFileSync(
      path.join(process.cwd(), 'src/app/api/documents/scan-foreign-words/definitions/route.ts'),
      'utf8',
    );
    expect(modal).toContain('Saved definition health check');
    expect(modal).toContain('Clean Up All Suspect Definitions');
    expect(modal).toContain('Edit definition');
    expect(modal).toContain('Save Definition');
    expect(route).toContain('definitionOmitted: definition === null');
    expect(route).toContain('export async function DELETE');
    expect(route).toContain('export async function PATCH');
  });
});
