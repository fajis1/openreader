import {
  reconcileSmartAudioPronunciations,
  SmartAudioOutputValidationError,
  validateSmartAudioOutput,
} from '@/lib/shared/smart-audio-cleanup';
import { KOKORO_DEFAULT_VOICES } from '@/lib/shared/tts-provider-catalog';
import type {
  SmartAudioCharacterEntry,
  SmartAudioCharacterMap,
} from '@/types/document-settings';

export const MULTI_VOICE_WORKER_MODE = 'multi-voice' as const;
export const WAITING_FOR_VOICES_STATUS = 'waiting_for_voices' as const;

export const KOKORO_CHARACTER_VOICES = KOKORO_DEFAULT_VOICES;

const KOKORO_CHARACTER_VOICE_SET = new Set<string>(KOKORO_CHARACTER_VOICES);
const PRIVATE_MULTI_VOICE_MARKER = /\[(?:CONTINUITY|TITLE|CHAPTER_TITLE|LAYOUT_ENGINE_TAG|SYSTEM HINT)\s*:/iu;
const VOICE_TAG = /<voice\s+name="([^"]+)"(\s+omitted="true")?>([\s\S]*?)<\/voice>/giu;

export type MultiVoiceSegment = {
  speaker: string;
  voiceId: string;
  text: string;
  omitted?: boolean;
};

export type MultiVoiceCastMember = {
  name: string;
  voiceId: string;
  aliases: string[];
};

export type DuplicateVoiceAssignment = {
  voiceId: string;
  characterNames: string[];
};

export type ResolvedMultiVoiceWorkerResult = {
  taggedText: string;
  segments: MultiVoiceSegment[];
  continuityState: string;
  chapterTitle: string | null;
};

function normalizedName(value: unknown): string {
  return typeof value === 'string'
    ? value.normalize('NFC').replace(/\s+/gu, ' ').trim().slice(0, 120)
    : '';
}

function normalizedDescription(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, 1_000) : '';
}

function normalizedSample(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, 2_000) : '';
}

function characterEntry(value: unknown): SmartAudioCharacterEntry | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const name = normalizedName(source.name);
  if (!name) return null;
  const voiceId = typeof source.voiceId === 'string' && KOKORO_CHARACTER_VOICE_SET.has(source.voiceId)
    ? source.voiceId
    : null;
  const aliasFor = normalizedName(source.aliasFor) || null;
  return {
    name,
    description: normalizedDescription(source.description),
    sampleText: normalizedSample(source.sampleText),
    voiceId,
    aliasFor,
  };
}

export function normalizeSmartAudioCharacterMap(value: unknown): SmartAudioCharacterMap | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  if (source.schemaVersion !== 1 || !source.entries || typeof source.entries !== 'object') return null;
  const entries: Record<string, SmartAudioCharacterEntry> = {};
  const canonicalNames = new Set<string>();
  for (const rawEntry of Object.values(source.entries as Record<string, unknown>)) {
    const entry = characterEntry(rawEntry);
    const canonicalName = entry?.name.toLocaleLowerCase() || '';
    if (!entry || canonicalNames.has(canonicalName)) continue;
    canonicalNames.add(canonicalName);
    entries[entry.name] = entry;
  }
  if (Object.keys(entries).length === 0) return null;

  const entriesByCanonicalName = new Map(
    Object.values(entries).map((entry) => [entry.name.toLocaleLowerCase(), entry]),
  );
  for (const entry of Object.values(entries)) {
    if (!entry.aliasFor) continue;
    const target = entriesByCanonicalName.get(entry.aliasFor.toLocaleLowerCase());
    if (!target || target.aliasFor || target.name === entry.name) entry.aliasFor = null;
    if (entry.aliasFor && target) {
      entry.aliasFor = target.name;
      entry.voiceId = null;
    }
  }

  return {
    schemaVersion: 1,
    status: source.status === 'complete' ? 'complete' : 'partial',
    scannedAt: typeof source.scannedAt === 'number' && Number.isFinite(source.scannedAt)
      ? source.scannedAt
      : Date.now(),
    ...(typeof source.profileId === 'string' && source.profileId.trim()
      ? { profileId: source.profileId.trim() }
      : {}),
    ...(typeof source.sourceFingerprint === 'string' && source.sourceFingerprint.trim()
      ? { sourceFingerprint: source.sourceFingerprint.trim() }
      : {}),
    ...(source.needsRescan === true ? { needsRescan: true } : {}),
    entries,
  };
}

export function getDuplicateVoiceAssignments(value: unknown): DuplicateVoiceAssignment[] {
  const map = normalizeSmartAudioCharacterMap(value);
  if (!map) return [];
  const namesByVoice = new Map<string, string[]>();
  for (const entry of Object.values(map.entries)) {
    if (entry.aliasFor || !entry.voiceId) continue;
    const names = namesByVoice.get(entry.voiceId) || [];
    names.push(entry.name);
    namesByVoice.set(entry.voiceId, names);
  }
  return [...namesByVoice.entries()]
    .filter(([, characterNames]) => characterNames.length > 1)
    .map(([voiceId, characterNames]) => ({ voiceId, characterNames }));
}

export function getNarratorVoiceId(value: unknown): string | null {
  const map = normalizeSmartAudioCharacterMap(value);
  const narrator = Object.values(map?.entries || {}).find(
    (entry) => !entry.aliasFor && entry.name.toLocaleLowerCase() === 'narrator',
  );
  return narrator?.voiceId || null;
}

export function requiresDramaAudiobookReplacement(input: {
  hasExistingChapters: boolean;
  requestedWorkerMode: string | null | undefined;
  previousUseSmartAudio: boolean;
  previousWorkerMode: string | null | undefined;
}): boolean {
  return input.hasExistingChapters
    && input.requestedWorkerMode === MULTI_VOICE_WORKER_MODE
    && !(input.previousUseSmartAudio && input.previousWorkerMode === MULTI_VOICE_WORKER_MODE);
}

export function estimateSpeakerSegmentAtTime(
  texts: readonly string[],
  currentTimeSeconds: number,
  durationSeconds: number,
): number | null {
  if (texts.length === 0 || !Number.isFinite(durationSeconds) || durationSeconds <= 0) return null;
  const weights = texts.map((text) => Math.max(
    1,
    text.trim().length
      + (text.match(/[.!?…]/gu)?.length || 0) * 12
      + (text.match(/\n/gu)?.length || 0) * 20,
  ));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const boundedTime = Math.min(Math.max(currentTimeSeconds, 0), durationSeconds);
  const targetWeight = (boundedTime / durationSeconds) * totalWeight;
  let elapsedWeight = 0;
  for (let index = 0; index < weights.length; index += 1) {
    elapsedWeight += weights[index];
    if (targetWeight < elapsedWeight || index === weights.length - 1) return index;
  }
  return texts.length - 1;
}

export function getCharacterMapReadiness(value: unknown): {
  ready: boolean;
  map: SmartAudioCharacterMap | null;
  unassigned: string[];
  errors: string[];
} {
  const map = normalizeSmartAudioCharacterMap(value);
  if (!map) return { ready: false, map: null, unassigned: [], errors: ['No character scan is available.'] };
  const primary = Object.values(map.entries).filter((entry) => !entry.aliasFor);
  const unassigned = primary
    .filter((entry) => !entry.voiceId || !KOKORO_CHARACTER_VOICE_SET.has(entry.voiceId))
    .map((entry) => entry.name);
  const errors: string[] = [];
  if (!primary.some((entry) => entry.name.toLocaleLowerCase() === 'narrator')) {
    errors.push('The cast must include a Narrator.');
  }
  if (primary.length === 0) errors.push('The cast has no primary characters.');
  if (unassigned.length > 0) errors.push('Every primary character needs a voice.');
  if (map.needsRescan) errors.push('The document narration filters changed; rescan the cast.');
  return {
    ready: map.status === 'complete' && errors.length === 0,
    map,
    unassigned,
    errors,
  };
}

export function finalizeSmartAudioCharacterMap(value: unknown): SmartAudioCharacterMap {
  const readiness = getCharacterMapReadiness(value);
  if (!readiness.map) throw new Error(readiness.errors[0] || 'Invalid character map.');
  if (readiness.unassigned.length > 0 || readiness.errors.length > 0) {
    throw new Error([...readiness.errors, ...readiness.unassigned.map((name) => `${name} is unassigned.`)].join(' '));
  }
  const finalized = { ...readiness.map, status: 'complete' as const };
  delete finalized.needsRescan;
  return finalized;
}

export function buildMultiVoiceCast(value: unknown): MultiVoiceCastMember[] {
  const map = finalizeSmartAudioCharacterMap(value);
  return Object.values(map.entries)
    .filter((entry): entry is SmartAudioCharacterEntry & { voiceId: string } => (
      !entry.aliasFor && typeof entry.voiceId === 'string'
    ))
    .map((entry) => ({
      name: entry.name,
      voiceId: entry.voiceId,
      aliases: Object.values(map.entries)
        .filter((candidate) => candidate.aliasFor === entry.name)
        .map((candidate) => candidate.name),
    }));
}

export function mergeExtractedCharacters(input: {
  previous: unknown;
  characters: unknown;
  profileId: string;
  sourceFingerprint: string;
  scannedAt?: number;
}): SmartAudioCharacterMap {
  const previous = normalizeSmartAudioCharacterMap(input.previous);
  const previousByName = new Map(
    Object.values(previous?.entries || {}).map((entry) => [entry.name.toLocaleLowerCase(), entry]),
  );
  const rawCharacters = Array.isArray(input.characters) ? input.characters : [];
  const entries: Record<string, SmartAudioCharacterEntry> = {};
  const extractedNames = new Set<string>();

  for (const raw of rawCharacters) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const source = raw as Record<string, unknown>;
    const name = normalizedName(source.name);
    const canonicalName = name.toLocaleLowerCase();
    if (!name || extractedNames.has(canonicalName)) continue;
    extractedNames.add(canonicalName);
    const existing = previousByName.get(canonicalName);
    entries[name] = {
      name,
      description: normalizedDescription(source.description) || existing?.description || '',
      sampleText: normalizedSample(source.sample_text ?? source.sampleText) || existing?.sampleText || '',
      voiceId: existing?.voiceId || null,
      aliasFor: existing?.aliasFor && previous?.entries[existing.aliasFor]
        ? existing.aliasFor
        : null,
    };
  }

  const narratorKey = Object.keys(entries).find((name) => name.toLocaleLowerCase() === 'narrator');
  if (!narratorKey) {
    const existingNarrator = previousByName.get('narrator');
    entries.Narrator = {
      name: 'Narrator',
      description: existingNarrator?.description || 'Primary audiobook narrator.',
      sampleText: existingNarrator?.sampleText || '',
      voiceId: existingNarrator?.voiceId || null,
      aliasFor: null,
    };
  }

  if (Object.keys(entries).length === 0) {
    throw new Error('The character scan returned no usable cast members.');
  }
  return {
    schemaVersion: 1,
    status: 'partial',
    scannedAt: input.scannedAt ?? Date.now(),
    profileId: input.profileId,
    sourceFingerprint: input.sourceFingerprint,
    entries,
  };
}

function safeSegmentText(value: unknown, authoritativePronunciations?: Record<string, string>): string {
  if (typeof value !== 'string') return '';
  const text = value.trim();
  if (!text) return '';
  if (/<[^>]+>/u.test(text) || PRIVATE_MULTI_VOICE_MARKER.test(text)) {
    throw new SmartAudioOutputValidationError('Multi-voice output contained markup or private control markers.');
  }
  return validateSmartAudioOutput(authoritativePronunciations
    ? reconcileSmartAudioPronunciations(text, authoritativePronunciations)
    : text);
}

export function renderVoiceSegments(segments: readonly MultiVoiceSegment[]): string {
  return segments
    .map((segment) => `<voice name="${segment.voiceId}"${segment.omitted ? ' omitted="true"' : ''}>${segment.text}</voice>`)
    .join('\n\n');
}

export function resolveMultiVoiceWorkerResult(
  value: unknown,
  cast: readonly MultiVoiceCastMember[],
  options: { authoritativePronunciations?: Record<string, string> } = {},
): ResolvedMultiVoiceWorkerResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new SmartAudioOutputValidationError('Multi-voice worker returned an invalid response.');
  }
  const result = value as Record<string, unknown>;
  if (result.status !== 'success') {
    const message = typeof result.message === 'string' && result.message.trim()
      ? result.message.trim()
      : 'unknown worker error';
    throw new SmartAudioOutputValidationError(`Multi-voice worker failed: ${message}`);
  }
  if (!Array.isArray(result.segments) || result.segments.length === 0 || result.segments.length > 5_000) {
    throw new SmartAudioOutputValidationError('Multi-voice worker returned no valid speaker segments.');
  }

  const speakerMap = new Map<string, MultiVoiceCastMember>();
  for (const member of cast) {
    speakerMap.set(member.name.toLocaleLowerCase(), member);
    for (const alias of member.aliases) speakerMap.set(alias.toLocaleLowerCase(), member);
  }
  const segments: MultiVoiceSegment[] = [];
  for (const raw of result.segments) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new SmartAudioOutputValidationError('Multi-voice worker returned a malformed segment.');
    }
    const segment = raw as Record<string, unknown>;
    const speaker = normalizedName(segment.speaker);
    const member = speakerMap.get(speaker.toLocaleLowerCase());
    if (!speaker || !member) {
      throw new SmartAudioOutputValidationError(`Multi-voice worker used an unknown speaker: ${speaker || 'blank'}.`);
    }
    const suppliedVoice = typeof segment.voice_id === 'string'
      ? segment.voice_id
      : typeof segment.voiceId === 'string'
        ? segment.voiceId
        : '';
    if (suppliedVoice && suppliedVoice !== member.voiceId) {
      throw new SmartAudioOutputValidationError(`Multi-voice worker changed the assigned voice for ${speaker}.`);
    }
    const text = safeSegmentText(segment.text, options.authoritativePronunciations);
    if (!text) continue;
    const omitted = segment.omit_from_audio === true;
    if (omitted && member.name.toLocaleLowerCase() !== 'narrator') {
      throw new SmartAudioOutputValidationError('Only Narrator attribution segments may be omitted from Audio Drama TTS.');
    }
    const previous = segments.at(-1);
    if (!omitted && !previous?.omitted && previous?.speaker === member.name) {
      previous.text = `${previous.text}\n\n${text}`;
    } else {
      segments.push({ speaker: member.name, voiceId: member.voiceId, text, ...(omitted ? { omitted: true } : {}) });
    }
  }
  if (segments.length === 0) {
    throw new SmartAudioOutputValidationError('Multi-voice worker returned only empty segments.');
  }

  const continuityState = typeof result.continuity_state === 'string'
    ? result.continuity_state.trim().slice(0, 2_000)
    : '';
  const rawTitle = typeof result.chapter_title === 'string' ? result.chapter_title.trim() : '';
  const chapterTitle = rawTitle && !PRIVATE_MULTI_VOICE_MARKER.test(rawTitle) && !/<[^>]+>/u.test(rawTitle)
    ? rawTitle.slice(0, 160)
    : null;
  return {
    taggedText: renderVoiceSegments(segments),
    segments,
    continuityState,
    chapterTitle,
  };
}

export function parseVoiceTaggedText(
  text: string,
  options: { includeOmitted?: boolean } = {},
): MultiVoiceSegment[] {
  const segments: MultiVoiceSegment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  VOICE_TAG.lastIndex = 0;
  while ((match = VOICE_TAG.exec(text)) !== null) {
    if (text.slice(lastIndex, match.index).trim()) {
      throw new SmartAudioOutputValidationError('Multi-voice text contained narration outside a voice segment.');
    }
    const voiceId = match[1].trim();
    if (!KOKORO_CHARACTER_VOICE_SET.has(voiceId)) {
      throw new SmartAudioOutputValidationError(`Multi-voice text used an unsupported voice: ${voiceId}.`);
    }
    const omitted = Boolean(match[2]);
    const segmentText = safeSegmentText(match[3]);
    if (segmentText && (!omitted || options.includeOmitted)) {
      segments.push({ speaker: voiceId, voiceId, text: segmentText, ...(omitted ? { omitted: true } : {}) });
    }
    lastIndex = VOICE_TAG.lastIndex;
  }
  if (text.slice(lastIndex).trim()) {
    throw new SmartAudioOutputValidationError('Multi-voice text contained trailing narration outside a voice segment.');
  }
  if (segments.length === 0 && /<\/?voice\b/iu.test(text)) {
    throw new SmartAudioOutputValidationError('Multi-voice text contained malformed voice markup.');
  }
  return segments;
}
