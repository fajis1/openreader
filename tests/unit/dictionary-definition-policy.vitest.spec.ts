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
      'Inflected form',
    ]) {
      expect(shouldOmitDictionaryDefinition(placeholder)).toBe(true);
      expect(normalizeDictionaryDefinition(placeholder)).toBeNull();
      expect(getDictionaryDefinitionQualityWarnings(placeholder)).not.toHaveLength(0);
    }
  });

  test('preserves useful contextual definitions', () => {
    expect(normalizeDictionaryDefinition('a spoken word or account')).toBe('a spoken word or');
    expect(shouldOmitDictionaryDefinition('fragment')).toBe(false);
    expect(shouldOmitDictionaryDefinition('broken piece')).toBe(false);
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
    expect(modal).toContain('Remove All Suspect Definitions');
    expect(modal).toContain('Edit definition');
    expect(modal).toContain('Save Definition');
    expect(route).toContain('definitionOmitted: true');
    expect(route).toContain('export async function DELETE');
    expect(route).toContain('export async function PATCH');
  });
});
