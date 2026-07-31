import {
  DEFAULT_DOCUMENT_SETTINGS,
  type DocumentSettings,
  type SmartAudioBookLexicon,
  type SmartAudioBookLexiconEntry,
} from '@/types/document-settings';
import { PARSED_PDF_BLOCK_KINDS, type ParsedPdfBlockKind } from '@/types/parsed-pdf';
import { normalizeLanguageTag } from '@/lib/shared/language';

function normalizeSkipKinds(value: unknown): ParsedPdfBlockKind[] {
  if (!Array.isArray(value)) return [...(DEFAULT_DOCUMENT_SETTINGS.pdf?.skipBlockKinds ?? [])];
  const allow = new Set(PARSED_PDF_BLOCK_KINDS);
  const out: ParsedPdfBlockKind[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    if (!allow.has(entry as ParsedPdfBlockKind)) continue;
    out.push(entry as ParsedPdfBlockKind);
  }
  return Array.from(new Set(out));
}

function normalizeLexicon(value: unknown): SmartAudioBookLexicon | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== 1) return undefined;
  if (record.status !== 'partial' && record.status !== 'complete') return undefined;
  if (typeof record.profileId !== 'string' || typeof record.pronunciationModel !== 'string') return undefined;
  if (typeof record.scannedAt !== 'number' || !Number.isFinite(record.scannedAt)) return undefined;
  if (!record.entries || typeof record.entries !== 'object') return undefined;

  const entries: Record<string, SmartAudioBookLexiconEntry> = {};
  for (const [key, rawEntry] of Object.entries(record.entries as Record<string, unknown>)) {
    if (!rawEntry || typeof rawEntry !== 'object') continue;
    const entry = rawEntry as Record<string, unknown>;
    const term = typeof entry.term === 'string' ? entry.term.normalize('NFC').trim() : '';
    const pronunciation = typeof entry.pronunciation === 'string' ? entry.pronunciation.trim() : '';
    if (!term || !pronunciation) continue;
    const language = entry.language === 'koine_greek' || entry.language === 'biblical_hebrew'
      ? entry.language
      : 'other';
    entries[key.normalize('NFC')] = {
      term,
      pronunciation,
      definition: typeof entry.definition === 'string' && entry.definition.trim()
        ? entry.definition.trim()
        : null,
      language,
      ...(typeof entry.context === 'string' && entry.context.trim() ? { context: entry.context.trim() } : {}),
      ...(typeof entry.confidence === 'number' && Number.isFinite(entry.confidence)
        ? { confidence: Math.max(0, Math.min(1, entry.confidence)) }
        : {}),
      ...(typeof entry.needsReview === 'boolean' ? { needsReview: entry.needsReview } : {}),
    };
  }

  return {
    schemaVersion: 1,
    status: record.status,
    definitionScanComplete: record.definitionScanComplete === true,
    profileId: record.profileId,
    pronunciationModel: record.pronunciationModel,
    scannedAt: record.scannedAt,
    entries,
  };
}

export function mergeDocumentSettings(
  defaults: DocumentSettings = DEFAULT_DOCUMENT_SETTINGS,
  stored: unknown,
): DocumentSettings {
  const base: DocumentSettings = {
    schemaVersion: 1,
    language: defaults.language || 'auto',
    pdf: {
      skipBlockKinds: [...(defaults.pdf?.skipBlockKinds ?? [])],
    },
  };

  if (!stored || typeof stored !== 'object') return base;
  const rec = stored as Record<string, unknown>;
  const rawLanguage = typeof rec.language === 'string' ? rec.language.trim() : '';
  const language = !rawLanguage || rawLanguage.toLowerCase() === 'auto'
    ? 'auto'
    : normalizeLanguageTag(rawLanguage, defaults.language || 'en');
  const pdf = rec.pdf;
  const smartAudioLexicon = normalizeLexicon(rec.smartAudioLexicon);
  if (!pdf || typeof pdf !== 'object') {
    return { ...base, language, ...(smartAudioLexicon ? { smartAudioLexicon } : {}) };
  }
  const pdfRec = pdf as Record<string, unknown>;

  return {
    schemaVersion: 1,
    language,
    pdf: {
      skipBlockKinds: normalizeSkipKinds(pdfRec.skipBlockKinds),
    },
    ...(smartAudioLexicon ? { smartAudioLexicon } : {}),
  };
}

export function preserveServerManagedDocumentSettings(
  incoming: DocumentSettings,
  existing: DocumentSettings | null | undefined,
): DocumentSettings {
  const clientManagedIncoming = { ...incoming };
  delete clientManagedIncoming.smartAudioLexicon;
  return {
    ...clientManagedIncoming,
    ...(existing?.smartAudioLexicon
      ? { smartAudioLexicon: existing.smartAudioLexicon }
      : {}),
  };
}
