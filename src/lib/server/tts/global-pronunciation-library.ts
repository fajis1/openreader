import {
  getKokoroPronunciationQualityWarnings,
  isKokoroCompatiblePronunciation,
} from '@/lib/shared/kokoro-pronunciation-policy';

export type GlobalPronunciationChoice = {
  phonetic: string;
  usageCount?: number;
  isUserCustom?: boolean;
  timestamp?: number;
};

export type GlobalPronunciationLibrary = Record<string, GlobalPronunciationChoice[]>;

export function removeGlobalPronunciationChoice(
  library: GlobalPronunciationLibrary,
  word: string,
  pronunciation: unknown,
): { removed: boolean; choices: GlobalPronunciationChoice[] } {
  const normalized = normalizeGlobalPronunciation(pronunciation);
  const raw = typeof pronunciation === 'string' ? pronunciation.trim() : '';
  if (!raw) return { removed: false, choices: library[word] || [] };
  const current = library[word] || [];
  const choices = current.filter(
    (choice) => normalized
      ? normalizeGlobalPronunciation(choice.phonetic) !== normalized
      : choice.phonetic.trim() !== raw,
  );
  return { removed: choices.length !== current.length, choices };
}

export function recordLearnedGlobalPronunciation(
  current: GlobalPronunciationChoice[],
  pronunciation: unknown,
): GlobalPronunciationChoice[] {
  const normalized = normalizeGlobalPronunciation(pronunciation);
  if (!normalized) return current;

  const choices = current.slice(0, 5).map((choice) => ({ ...choice }));
  const existingIndex = choices.findIndex(
    (choice) => normalizeGlobalPronunciation(choice.phonetic) === normalized,
  );
  if (existingIndex !== -1) {
    choices[existingIndex] = {
      ...choices[existingIndex],
      phonetic: normalized,
      usageCount: (choices[existingIndex].usageCount || 0) + 1,
    };
    return choices;
  }

  const learned: GlobalPronunciationChoice = {
    phonetic: normalized,
    usageCount: 1,
    isUserCustom: true,
    timestamp: Date.now(),
  };
  if (choices.length < 5) return [...choices, learned];

  // Index zero is the effective global default. Learning may refresh or evict
  // alternatives, but it must never silently replace the administrator's choice.
  let leastUsedAlternative = 1;
  for (let index = 2; index < choices.length; index += 1) {
    if ((choices[index].usageCount || 0) < (choices[leastUsedAlternative].usageCount || 0)) {
      leastUsedAlternative = index;
    }
  }
  choices[leastUsedAlternative] = learned;
  return choices;
}

export function normalizeGlobalPronunciation(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const wrapped = trimmed.startsWith('/') && trimmed.endsWith('/')
    ? trimmed
    : `/${trimmed.replace(/^\/+|\/+$/g, '')}/`;
  return isKokoroCompatiblePronunciation(wrapped) ? wrapped : null;
}

export function normalizeGlobalPronunciationLibrary(value: unknown): GlobalPronunciationLibrary {
  const parsed = typeof value === 'string' ? JSON.parse(value) : value;
  if (!parsed || typeof parsed !== 'object') return {};
  const normalized: GlobalPronunciationLibrary = {};
  for (const [word, raw] of Object.entries(parsed as Record<string, unknown>)) {
    const choices = Array.isArray(raw) ? raw : [raw];
    normalized[word] = choices.flatMap((choice) => {
      if (typeof choice === 'string') return [{ phonetic: choice, usageCount: 0 }];
      if (!choice || typeof choice !== 'object') return [];
      const record = choice as Record<string, unknown>;
      return typeof record.phonetic === 'string'
        ? [{ ...record, phonetic: record.phonetic } as GlobalPronunciationChoice]
        : [];
    }).slice(0, 5);
  }
  return normalized;
}

export function setGlobalPronunciationDefault(
  library: GlobalPronunciationLibrary,
  word: string,
  pronunciation: unknown,
): GlobalPronunciationChoice[] | null {
  const normalized = normalizeGlobalPronunciation(pronunciation);
  if (!normalized || getKokoroPronunciationQualityWarnings(word, normalized).length > 0) return null;

  const current = library[word] || [];
  const existing = current.find(
    (choice) => normalizeGlobalPronunciation(choice.phonetic) === normalized,
  );
  const selected: GlobalPronunciationChoice = existing
    ? { ...existing, phonetic: normalized }
    : {
        phonetic: normalized,
        usageCount: 0,
        isUserCustom: true,
        timestamp: Date.now(),
      };
  return [
    selected,
    ...current.filter((choice) => normalizeGlobalPronunciation(choice.phonetic) !== normalized),
  ].slice(0, 5);
}

export function replaceGlobalPronunciationChoices(
  word: string,
  pronunciations: unknown,
  defaultIndex: unknown,
): GlobalPronunciationChoice[] | null {
  if (!Array.isArray(pronunciations)) return null;
  const normalized = pronunciations
    .map(normalizeGlobalPronunciation)
    .filter((choice): choice is string => choice !== null)
    .filter((choice, index, all) => all.indexOf(choice) === index)
    .slice(0, 5);
  if (
    normalized.length === 0
    || normalized.some((choice) => getKokoroPronunciationQualityWarnings(word, choice).length > 0)
  ) {
    return null;
  }

  const selectedIndex = Number.isInteger(defaultIndex)
    ? Math.max(0, Math.min(Number(defaultIndex), normalized.length - 1))
    : 0;
  const ordered = [
    normalized[selectedIndex],
    ...normalized.filter((_choice, index) => index !== selectedIndex),
  ];
  const now = Date.now();
  return ordered.map((phonetic) => ({
    phonetic,
    usageCount: 0,
    isUserCustom: true,
    timestamp: now,
  }));
}
