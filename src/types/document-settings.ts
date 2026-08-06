import type { ParsedPdfBlockKind } from '@/types/parsed-pdf';

export interface SmartAudioBookLexiconEntry {
  term: string;
  pronunciation: string;
  definition: string | null;
  definitionOmitted?: boolean;
  language: 'koine_greek' | 'biblical_hebrew' | 'other';
  context?: string;
  confidence?: number;
  needsReview?: boolean;
}

export interface SmartAudioBookLexicon {
  schemaVersion: 1;
  status: 'partial' | 'complete';
  definitionScanComplete: boolean;
  profileId: string;
  pronunciationModel: string;
  scannedAt: number;
  entries: Record<string, SmartAudioBookLexiconEntry>;
}

export interface SmartAudioCharacterEntry {
  name: string;
  description: string;
  sampleText: string;
  voiceId?: string | null;
  aliasFor?: string | null;
}

export interface SmartAudioCharacterMap {
  schemaVersion: 1;
  status: 'partial' | 'complete';
  scannedAt: number;
  entries: Record<string, SmartAudioCharacterEntry>;
}

export interface DocumentSettings {
  schemaVersion: 1;
  language?: string;
  pdf?: {
    skipBlockKinds: ParsedPdfBlockKind[];
  };
  smartAudioLexicon?: SmartAudioBookLexicon;
  smartAudioCharacters?: SmartAudioCharacterMap;
}

export const DEFAULT_DOCUMENT_SETTINGS: DocumentSettings = {
  schemaVersion: 1,
  language: 'auto',
  pdf: {
    skipBlockKinds: ['header', 'footer', 'footnote', 'vision_footnote'],
  },
};
