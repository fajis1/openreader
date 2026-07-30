export const PRONUNCIATION_GUIDE_FORMAT = 'openreader-pronunciation-guide';
export const PRONUNCIATION_GUIDE_VERSION = 1;

export interface PronunciationGuideEntry {
  word: string;
  phonetic: string;
}

export interface PronunciationGuide {
  format: typeof PRONUNCIATION_GUIDE_FORMAT;
  version: typeof PRONUNCIATION_GUIDE_VERSION;
  name: string;
  exportedAt: string;
  entries: PronunciationGuideEntry[];
}

export type PronunciationImportStrategy = 'add-new' | 'overwrite-matches' | 'replace-all';

function normalizeEntry(word: unknown, phonetic: unknown): PronunciationGuideEntry | null {
  if (typeof word !== 'string' || typeof phonetic !== 'string') return null;
  const normalizedWord = word.trim();
  const normalizedPhonetic = phonetic.trim();
  if (!normalizedWord || !normalizedPhonetic) return null;
  return { word: normalizedWord, phonetic: normalizedPhonetic };
}

function deduplicateEntries(entries: PronunciationGuideEntry[]): PronunciationGuideEntry[] {
  const byWord = new Map<string, PronunciationGuideEntry>();
  for (const entry of entries) byWord.set(entry.word, entry);
  return [...byWord.values()];
}

export function createPronunciationGuide(
  name: string,
  entries: PronunciationGuideEntry[],
  exportedAt = new Date().toISOString(),
): PronunciationGuide {
  return {
    format: PRONUNCIATION_GUIDE_FORMAT,
    version: PRONUNCIATION_GUIDE_VERSION,
    name: name.trim() || 'OpenReader Pronunciation Guide',
    exportedAt,
    entries: deduplicateEntries(entries.map((entry) => normalizeEntry(entry.word, entry.phonetic)).filter((entry): entry is PronunciationGuideEntry => entry !== null)),
  };
}

export function parsePronunciationGuide(text: string, fallbackName = 'Imported Pronunciation Guide'): PronunciationGuide {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('The pronunciation guide is empty.');

  if (trimmed.startsWith('{')) {
    const parsed = JSON.parse(trimmed) as Partial<PronunciationGuide>;
    if (parsed.format !== PRONUNCIATION_GUIDE_FORMAT || parsed.version !== PRONUNCIATION_GUIDE_VERSION || !Array.isArray(parsed.entries)) {
      throw new Error('This is not a supported OpenReader pronunciation guide.');
    }
    const entries = parsed.entries
      .map((entry) => normalizeEntry(entry?.word, entry?.phonetic))
      .filter((entry): entry is PronunciationGuideEntry => entry !== null);
    return createPronunciationGuide(parsed.name || fallbackName, entries, parsed.exportedAt || new Date().toISOString());
  }

  const entries = trimmed
    .split(/\r?\n/)
    .map((line) => {
      const separator = line.indexOf(',');
      if (separator < 0) return null;
      return normalizeEntry(line.slice(0, separator), line.slice(separator + 1));
    })
    .filter((entry): entry is PronunciationGuideEntry => entry !== null);

  if (entries.length === 0) throw new Error('No valid word and pronunciation pairs were found.');
  return createPronunciationGuide(fallbackName, entries);
}

export function mergePronunciationEntries(
  current: PronunciationGuideEntry[],
  incoming: PronunciationGuideEntry[],
  strategy: PronunciationImportStrategy,
): PronunciationGuideEntry[] {
  const cleanCurrent = deduplicateEntries(current.map((entry) => normalizeEntry(entry.word, entry.phonetic)).filter((entry): entry is PronunciationGuideEntry => entry !== null));
  const cleanIncoming = deduplicateEntries(incoming.map((entry) => normalizeEntry(entry.word, entry.phonetic)).filter((entry): entry is PronunciationGuideEntry => entry !== null));
  if (strategy === 'replace-all') return cleanIncoming;

  const result = new Map(cleanCurrent.map((entry) => [entry.word, entry]));
  for (const entry of cleanIncoming) {
    if (strategy === 'overwrite-matches' || !result.has(entry.word)) result.set(entry.word, entry);
  }
  return [...result.values()];
}
