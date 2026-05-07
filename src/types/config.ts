import type { DocumentListState } from '@/types/documents';


const wordHighlightEnabledByDefault =
  process.env.NEXT_PUBLIC_ENABLE_WORD_HIGHLIGHT?.toLowerCase() !== 'false';

export type ViewType = 'single' | 'dual' | 'scroll';

export type SavedVoices = Record<string, string>;

export const SEGMENT_PRELOAD_DEPTH_MIN = 1;
export const SEGMENT_PRELOAD_DEPTH_MAX = 5;
export const SEGMENT_PRELOAD_SENTENCE_LOOKAHEAD_MIN = 1;
export const SEGMENT_PRELOAD_SENTENCE_LOOKAHEAD_MAX = 10;
export const TTS_SEGMENT_MAX_BLOCK_LENGTH_MIN = 150;
export const TTS_SEGMENT_MAX_BLOCK_LENGTH_MAX = 1200;
export const TTS_SEGMENT_MAX_BLOCK_LENGTH_STEP = 25;

export function clampSegmentPreloadDepth(value: number | undefined | null): number {
  const candidate = Math.floor(Number(value) || SEGMENT_PRELOAD_DEPTH_MIN);
  return Math.max(SEGMENT_PRELOAD_DEPTH_MIN, Math.min(SEGMENT_PRELOAD_DEPTH_MAX, candidate));
}

export function clampSegmentPreloadSentenceLookahead(value: number | undefined | null): number {
  const candidate = Math.floor(Number(value) || SEGMENT_PRELOAD_SENTENCE_LOOKAHEAD_MIN);
  return Math.max(SEGMENT_PRELOAD_SENTENCE_LOOKAHEAD_MIN, Math.min(SEGMENT_PRELOAD_SENTENCE_LOOKAHEAD_MAX, candidate));
}

export function clampTtsSegmentMaxBlockLength(value: number | undefined | null): number {
  const candidate = Math.floor(Number(value) || TTS_SEGMENT_MAX_BLOCK_LENGTH_MIN);
  return Math.max(TTS_SEGMENT_MAX_BLOCK_LENGTH_MIN, Math.min(TTS_SEGMENT_MAX_BLOCK_LENGTH_MAX, candidate));
}

export interface AppConfigValues {
  apiKey: string;
  baseUrl: string;
  viewType: ViewType;
  voiceSpeed: number;
  audioPlayerSpeed: number;
  voice: string;
  skipBlank: boolean;
  epubTheme: boolean;
  headerMargin: number;
  footerMargin: number;
  leftMargin: number;
  rightMargin: number;
  ttsProvider: string;
  ttsModel: string;
  ttsInstructions: string;
  savedVoices: SavedVoices;
  smartSentenceSplitting: boolean;
  segmentPreloadDepthPages: number;
  segmentPreloadSentenceLookahead: number;
  ttsSegmentMaxBlockLength: number;
  pdfHighlightEnabled: boolean;
  pdfWordHighlightEnabled: boolean;
  epubHighlightEnabled: boolean;
  epubWordHighlightEnabled: boolean;
  firstVisit: boolean;
  documentListState: DocumentListState;
  privacyAccepted: boolean;
  documentsMigrationPrompted: boolean;
}

export const APP_CONFIG_DEFAULTS: AppConfigValues = {
  apiKey: '',
  baseUrl: '',
  viewType: 'single',
  voiceSpeed: 1,
  audioPlayerSpeed: 1,
  voice: '',
  skipBlank: true,
  epubTheme: false,
  headerMargin: 0,
  footerMargin: 0,
  leftMargin: 0,
  rightMargin: 0,
  ttsProvider: process.env.NEXT_PUBLIC_DEFAULT_TTS_PROVIDER || 'custom-openai',
  ttsModel: process.env.NEXT_PUBLIC_DEFAULT_TTS_MODEL || 'kokoro',
  ttsInstructions: '',
  savedVoices: {},
  smartSentenceSplitting: true,
  segmentPreloadDepthPages: 1,
  segmentPreloadSentenceLookahead: 3,
  ttsSegmentMaxBlockLength: 450,
  pdfHighlightEnabled: true,
  pdfWordHighlightEnabled: wordHighlightEnabledByDefault,
  epubHighlightEnabled: true,
  epubWordHighlightEnabled: wordHighlightEnabledByDefault,
  firstVisit: false,
  documentListState: {
    sortBy: 'name',
    sortDirection: 'asc',
    folders: [],
    collapsedFolders: [],
    showHint: true,
    viewMode: 'grid',
  },
  privacyAccepted: false,
  documentsMigrationPrompted: false,
};

export interface AppConfigRow extends AppConfigValues {
  id: string;
}
