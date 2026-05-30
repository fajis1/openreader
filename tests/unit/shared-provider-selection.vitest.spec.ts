import { describe, expect, test } from 'vitest';

import { resolvePreferredSharedProviderSlug } from '../../src/lib/shared/shared-provider-selection';
import { makeSharedProviders } from './support/factories';

const PROVIDERS = makeSharedProviders(['shared-a', 'default-openai', 'shared-b']);

describe('resolvePreferredSharedProviderSlug', () => {
  test('prefers requested shared slug when present', () => {
    expect(resolvePreferredSharedProviderSlug({
      providers: PROVIDERS,
      requestedSlug: 'shared-b',
      runtimeDefaultSlug: 'shared-a',
    })).toBe('shared-b');
  });

  test('falls back to runtime default shared slug when requested is missing', () => {
    expect(resolvePreferredSharedProviderSlug({
      providers: PROVIDERS,
      requestedSlug: 'missing-slug',
      runtimeDefaultSlug: 'shared-a',
    })).toBe('shared-a');
  });

  test('falls back to default-openai before first provider', () => {
    expect(resolvePreferredSharedProviderSlug({
      providers: PROVIDERS,
      requestedSlug: null,
      runtimeDefaultSlug: null,
    })).toBe('default-openai');
  });

  test('ignores built-in provider ids for requested/runtime defaults', () => {
    expect(resolvePreferredSharedProviderSlug({
      providers: PROVIDERS,
      requestedSlug: 'openai',
      runtimeDefaultSlug: 'custom-openai',
    })).toBe('default-openai');
  });

  test('falls back to first enabled provider when default-openai is missing', () => {
    expect(resolvePreferredSharedProviderSlug({
      providers: [{ slug: 'shared-z' }, { slug: 'shared-y' }],
      requestedSlug: null,
      runtimeDefaultSlug: null,
    })).toBe('shared-z');
  });
});
