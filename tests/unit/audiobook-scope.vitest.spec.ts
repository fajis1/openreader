import { describe, expect, test } from 'vitest';
import { buildAllowedAudiobookUserIds, pickAudiobookOwner } from '../../src/lib/server/audiobooks/user-scope';

describe('audiobook scope selection', () => {
  test('includes both preferred and unclaimed scopes', () => {
    const result = buildAllowedAudiobookUserIds('user-123', 'unclaimed::ns');
    expect(result.preferredUserId).toBe('user-123');
    expect(result.allowedUserIds).toEqual(['user-123', 'unclaimed::ns']);
  });

  test('deduplicates preferred/unclaimed ids when they are the same', () => {
    const result = buildAllowedAudiobookUserIds('unclaimed::ns', 'unclaimed::ns');
    expect(result.allowedUserIds).toEqual(['unclaimed::ns']);
  });

  test('prefers unclaimed owner when both scopes exist', () => {
    const owner = pickAudiobookOwner(['user-123', 'unclaimed::ns'], 'user-123', 'unclaimed::ns');
    expect(owner).toBe('unclaimed::ns');
  });

  test('falls back to preferred owner when unclaimed is missing', () => {
    const owner = pickAudiobookOwner(['user-123'], 'user-123', 'unclaimed::ns');
    expect(owner).toBe('user-123');
  });

  test('returns null when no matching owners exist', () => {
    const owner = pickAudiobookOwner([], 'user-123', 'unclaimed::ns');
    expect(owner).toBeNull();
  });
});
