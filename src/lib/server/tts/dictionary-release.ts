import crypto from 'node:crypto';

import type { SmartAudioProfile } from '@/types/client';
import {
  normalizeGlobalPronunciationLibrary,
  type GlobalPronunciationChoice,
  type GlobalPronunciationLibrary,
} from '@/lib/server/tts/global-pronunciation-library';
import { normalizeGlobalDefinitions } from '@/lib/server/smart-audio/global-definition-library';

export type DictionaryReleaseTombstone = {
  reasons: string[];
  pronunciations?: {
    fingerprint: string;
    choices: string[];
  };
  definition?: {
    fingerprint: string;
    value: string;
  };
};

export type DictionaryReleaseTombstones = {
  version: 1;
  generatedAt: string | null;
  entries: Record<string, DictionaryReleaseTombstone>;
};

export type DictionaryReleaseUpdate = {
  word: string;
  type: 'pronunciation' | 'definition' | 'pronunciation-removal' | 'definition-removal';
  status: 'new' | 'conflict' | 'remove' | 'deletion-conflict';
  git: string | null;
  local: string | null;
  gitChoices?: GlobalPronunciationChoice[];
  reasons?: string[];
  safeToApply: boolean;
};

export function pronunciationChoiceValues(value: unknown): string[] {
  const normalized = normalizeGlobalPronunciationLibrary({ word: value });
  return (normalized.word || [])
    .map((choice) => choice.phonetic.trim())
    .filter(Boolean);
}

function fingerprint(value: unknown): string {
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}

function definitionRecord(value: unknown): Record<string, string> {
  let parsed = value;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return {};
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  return Object.fromEntries(
    Object.entries(parsed as Record<string, unknown>).flatMap(([word, raw]) => {
      const definition = typeof raw === 'string'
        ? raw
        : raw && typeof raw === 'object' && typeof (raw as { definition?: unknown }).definition === 'string'
          ? (raw as { definition: string }).definition
          : null;
      return definition === null ? [] : [[word, definition]];
    }),
  );
}

export function fingerprintPronunciationChoices(value: unknown): string {
  return fingerprint(pronunciationChoiceValues(value));
}

export function fingerprintDefinition(value: unknown): string {
  return fingerprint(value);
}

export function parseDictionaryReleaseTombstones(value: unknown): DictionaryReleaseTombstones {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { version: 1, generatedAt: null, entries: {} };
  }
  const source = value as Record<string, unknown>;
  const rawEntries = source.entries;
  if (!rawEntries || typeof rawEntries !== 'object' || Array.isArray(rawEntries)) {
    return { version: 1, generatedAt: null, entries: {} };
  }

  const entries: Record<string, DictionaryReleaseTombstone> = {};
  for (const [word, rawEntry] of Object.entries(rawEntries as Record<string, unknown>)) {
    if (!rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) continue;
    const entry = rawEntry as Record<string, unknown>;
    const tombstone: DictionaryReleaseTombstone = {
      reasons: Array.isArray(entry.reasons)
        ? entry.reasons.filter((reason): reason is string => typeof reason === 'string')
        : [],
    };
    const rawPronunciations = entry.pronunciations;
    if (rawPronunciations && typeof rawPronunciations === 'object' && !Array.isArray(rawPronunciations)) {
      const pronunciations = rawPronunciations as Record<string, unknown>;
      const choices = Array.isArray(pronunciations.choices)
        ? pronunciations.choices.filter((choice): choice is string => typeof choice === 'string')
        : [];
      const expectedFingerprint = typeof pronunciations.fingerprint === 'string'
        ? pronunciations.fingerprint
        : '';
      if (choices.length > 0 && expectedFingerprint === fingerprint(choices)) {
        tombstone.pronunciations = { fingerprint: expectedFingerprint, choices };
      }
    }
    if (entry.definition && typeof entry.definition === 'object' && !Array.isArray(entry.definition)) {
      const definition = entry.definition as Record<string, unknown>;
      if (
        typeof definition.value === 'string'
        && typeof definition.fingerprint === 'string'
        && definition.fingerprint === fingerprint(definition.value)
      ) {
        tombstone.definition = {
          value: definition.value,
          fingerprint: definition.fingerprint,
        };
      }
    }
    if (word.trim() && (tombstone.pronunciations || tombstone.definition)) entries[word] = tombstone;
  }
  return {
    version: 1,
    generatedAt: typeof source.generatedAt === 'string' ? source.generatedAt : null,
    entries,
  };
}

export function buildDictionaryReleaseUpdates(input: {
  gitPronunciations: unknown;
  gitDefinitions: unknown;
  tombstones: unknown;
  globalPronunciations: unknown;
  globalDefinitions: unknown;
  activeProfile?: SmartAudioProfile | null;
  isAdmin: boolean;
}): DictionaryReleaseUpdate[] {
  const gitPronunciations = normalizeGlobalPronunciationLibrary(input.gitPronunciations);
  const gitDefinitions = normalizeGlobalDefinitions(input.gitDefinitions);
  const globalPronunciations = normalizeGlobalPronunciationLibrary(input.globalPronunciations);
  const globalDefinitions = definitionRecord(input.globalDefinitions);
  const tombstones = parseDictionaryReleaseTombstones(input.tombstones);
  const updates: DictionaryReleaseUpdate[] = [];

  for (const [word, gitChoices] of Object.entries(gitPronunciations)) {
    const localChoices = globalPronunciations[word] || [];
    if (fingerprintPronunciationChoices(gitChoices) === fingerprintPronunciationChoices(localChoices)) continue;
    const status = localChoices.length === 0 ? 'new' : 'conflict';
    updates.push({
      word,
      type: 'pronunciation',
      status,
      git: gitChoices[0]?.phonetic || null,
      local: localChoices[0]?.phonetic || null,
      gitChoices,
      safeToApply: status === 'new',
    });
  }

  if (input.isAdmin) {
    for (const [word, gitDefinition] of Object.entries(gitDefinitions)) {
      const localDefinition = globalDefinitions[word];
      if (localDefinition === gitDefinition) continue;
      const status = localDefinition === undefined ? 'new' : 'conflict';
      updates.push({
        word,
        type: 'definition',
        status,
        git: gitDefinition,
        local: localDefinition || null,
        safeToApply: status === 'new',
      });
    }
  }

  for (const [word, tombstone] of Object.entries(tombstones.entries)) {
    if (gitPronunciations[word]) continue;
    if (input.isAdmin) {
      const localChoices = globalPronunciations[word] || [];
      if (tombstone.pronunciations && localChoices.length > 0) {
        const safeToApply = fingerprintPronunciationChoices(localChoices)
          === tombstone.pronunciations.fingerprint;
        updates.push({
          word,
          type: 'pronunciation-removal',
          status: safeToApply ? 'remove' : 'deletion-conflict',
          git: null,
          local: localChoices[0]?.phonetic || null,
          reasons: tombstone.reasons,
          safeToApply,
        });
      }
      if (tombstone.definition && Object.hasOwn(globalDefinitions, word)) {
        const localDefinition = globalDefinitions[word];
        const safeToApply = fingerprintDefinition(localDefinition) === tombstone.definition.fingerprint;
        updates.push({
          word,
          type: 'definition-removal',
          status: safeToApply ? 'remove' : 'deletion-conflict',
          git: null,
          local: localDefinition,
          reasons: tombstone.reasons,
          safeToApply,
        });
      }
      continue;
    }

    if (!tombstone.pronunciations) continue;
    const personalValue = input.activeProfile?.pronunciations?.[word];
    if (!personalValue) continue;
    const safeToApply = tombstone.pronunciations.choices.includes(personalValue.trim());
    updates.push({
      word,
      type: 'pronunciation-removal',
      status: safeToApply ? 'remove' : 'deletion-conflict',
      git: null,
      local: personalValue,
      reasons: tombstone.reasons,
      safeToApply,
    });
  }
  return updates;
}

export function applyDictionaryReleaseToGlobal(input: {
  currentPronunciations: unknown;
  currentDefinitions: unknown;
  gitPronunciations: unknown;
  gitDefinitions: unknown;
  tombstones: unknown;
  selectedPronunciationWords: ReadonlySet<string>;
  selectedDefinitionWords: ReadonlySet<string>;
  selectedPronunciationRemovals: ReadonlySet<string>;
  selectedDefinitionRemovals: ReadonlySet<string>;
}): { pronunciations: GlobalPronunciationLibrary; definitions: Record<string, string> } {
  const pronunciations = normalizeGlobalPronunciationLibrary(input.currentPronunciations);
  const definitions = definitionRecord(input.currentDefinitions);
  const gitPronunciations = normalizeGlobalPronunciationLibrary(input.gitPronunciations);
  const gitDefinitions = normalizeGlobalDefinitions(input.gitDefinitions);
  const tombstones = parseDictionaryReleaseTombstones(input.tombstones);

  for (const word of input.selectedPronunciationWords) {
    if (gitPronunciations[word]) pronunciations[word] = gitPronunciations[word].map((choice) => ({ ...choice }));
  }
  for (const word of input.selectedDefinitionWords) {
    if (gitDefinitions[word]) definitions[word] = gitDefinitions[word];
  }
  for (const word of input.selectedPronunciationRemovals) {
    if (tombstones.entries[word] && !gitPronunciations[word]) delete pronunciations[word];
  }
  for (const word of input.selectedDefinitionRemovals) {
    if (tombstones.entries[word]?.definition && !gitDefinitions[word]) delete definitions[word];
  }
  return { pronunciations, definitions };
}

export function applyDictionaryReleaseToProfile(input: {
  profile: SmartAudioProfile;
  gitPronunciations: unknown;
  tombstones: unknown;
  selectedPronunciationWords: ReadonlySet<string>;
  selectedPronunciationRemovals: ReadonlySet<string>;
  resolvedDictionaryHash: string;
}): SmartAudioProfile {
  const gitPronunciations = normalizeGlobalPronunciationLibrary(input.gitPronunciations);
  const tombstones = parseDictionaryReleaseTombstones(input.tombstones);
  const pronunciations = { ...(input.profile.pronunciations || {}) };
  for (const word of input.selectedPronunciationWords) {
    const defaultPronunciation = gitPronunciations[word]?.[0]?.phonetic;
    if (defaultPronunciation) pronunciations[word] = defaultPronunciation;
  }
  for (const word of input.selectedPronunciationRemovals) {
    if (tombstones.entries[word] && !gitPronunciations[word]) delete pronunciations[word];
  }
  return {
    ...input.profile,
    pronunciations,
    resolvedDictionaryHash: input.resolvedDictionaryHash,
  };
}
