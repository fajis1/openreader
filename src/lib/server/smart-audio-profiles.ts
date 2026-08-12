import fs from 'fs';
import path from 'path';
import { db } from '@/db';
import { userPreferences } from '@/db/schema';
import { eq, sql } from 'drizzle-orm';
import type { SmartAudioProfile } from '@/types/client';
import {
  DEFAULT_CLEANUP_AI_MODEL,
  resolvePronunciationAiModel,
} from '@/lib/shared/smart-audio-models';
import defaultProfilesData from './default_smart_audio_profiles.json';

const configDir = path.join(process.cwd(), 'config');
const defaultProfileSourcePath = path.join(configDir, 'default_book_tts_settings.json');

export interface SmartAudioProfilesDocument {
  selectedProfileId: string;
  profiles: SmartAudioProfile[];
}

export interface RestoredSmartAudioProfile {
  id: string;
  name: string;
}

export interface RestoreMissingBuiltInProfilesResult {
  document: SmartAudioProfilesDocument;
  restoredProfiles: RestoredSmartAudioProfile[];
}

export function mergeGeneratedPronunciations(
  profile: SmartAudioProfile,
  generatedPronunciations: Record<string, string>,
  pronunciationsAtScanStart: Record<string, string>,
): {
  profile: SmartAudioProfile;
  appliedWords: string[];
  preservedUserEdits: string[];
} {
  const pronunciations = { ...(profile.pronunciations || {}) };
  const appliedWords: string[] = [];
  const preservedUserEdits: string[] = [];
  for (const [word, pronunciation] of Object.entries(generatedPronunciations)) {
    if (pronunciations[word] !== pronunciationsAtScanStart[word]) {
      preservedUserEdits.push(word);
      continue;
    }
    pronunciations[word] = pronunciation;
    appliedWords.push(word);
  }
  return {
    profile: { ...profile, pronunciations },
    appliedWords,
    preservedUserEdits,
  };
}

export function redactSmartAudioProfileSecrets(profile: SmartAudioProfile): SmartAudioProfile {
  return {
    id: profile.id,
    name: profile.name,
    aiModel: profile.aiModel,
    pronunciationAiModel: profile.pronunciationAiModel,
    customTtsPrompt: profile.customTtsPrompt,
    abbreviations: profile.abbreviations,
    pronunciations: profile.pronunciations,
    books: profile.books,
    useGlobalPronunciations: profile.useGlobalPronunciations,
    pronunciationPromptMode: profile.pronunciationPromptMode,
    customPronunciationPrompt: profile.customPronunciationPrompt,
    workerMode: profile.workerMode,
    geminiApiKeyConfigured: Boolean(profile.geminiApiKey),
    geminiApiKeyLast4: profile.geminiApiKey ? profile.geminiApiKey.slice(-4) : undefined,
    backupGeminiApiKeyConfigured: Boolean(profile.backupGeminiApiKey),
    backupGeminiApiKeyLast4: profile.backupGeminiApiKey
      ? profile.backupGeminiApiKey.slice(-4)
      : undefined,
    geminiApiKeySourceProfileId: profile.geminiApiKeySourceProfileId || profile.id,
    backupGeminiApiKeySourceProfileId: profile.backupGeminiApiKeySourceProfileId || profile.id,
  };
}

export function redactSmartAudioProfilesDocument(
  document: SmartAudioProfilesDocument,
): SmartAudioProfilesDocument {
  return {
    selectedProfileId: document.selectedProfileId,
    profiles: document.profiles.map(redactSmartAudioProfileSecrets),
  };
}

export function mergeStoredSmartAudioProfileSecrets(
  incomingProfiles: SmartAudioProfile[],
  storedProfiles: SmartAudioProfile[],
): SmartAudioProfile[] {
  const storedById = new Map(storedProfiles.map((profile) => [profile.id, profile]));

  return incomingProfiles.map((profile) => {
    const storedProfile = storedById.get(profile.id);
    const primarySourceProfile = profile.geminiApiKeySourceProfileId
      ? storedById.get(profile.geminiApiKeySourceProfileId) || storedProfile
      : storedProfile;
    const backupSourceProfile = profile.backupGeminiApiKeySourceProfileId
      ? storedById.get(profile.backupGeminiApiKeySourceProfileId) || storedProfile
      : storedProfile;
    const suppliedPrimaryKey = (profile.geminiApiKey || '').trim();
    const suppliedBackupKey = (profile.backupGeminiApiKey || '').trim();

    return {
      ...profile,
      geminiApiKey: suppliedPrimaryKey || primarySourceProfile?.geminiApiKey,
      backupGeminiApiKey: suppliedBackupKey || backupSourceProfile?.backupGeminiApiKey,
    };
  });
}

function slugifyProfileName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || `profile-${Date.now()}`;
}

function sanitizeProfile(profile: Partial<SmartAudioProfile> & { id?: string; name?: string }): SmartAudioProfile {
  const id = (profile.id || slugifyProfileName(profile.name || 'profile')).trim();
  const name = (profile.name || 'Smart Audio Profile').trim();
  return {
    id,
    name,
    aiModel: (profile.aiModel || DEFAULT_CLEANUP_AI_MODEL).trim(),
    pronunciationAiModel: resolvePronunciationAiModel(profile),
    customTtsPrompt: profile.customTtsPrompt || '',
    abbreviations: profile.abbreviations || {},
    pronunciations: profile.pronunciations || {},
    books: profile.books || {},
    // Global pronunciations are always the baseline; local profile entries
    // override individual words. Keep this field for legacy clients.
    useGlobalPronunciations: true,
    pronunciationPromptMode: profile.pronunciationPromptMode === 'custom' ? 'custom' : 'default',
    customPronunciationPrompt: profile.customPronunciationPrompt || '',
    workerMode: profile.workerMode === 'bibliography-catcher' ? 'bibliography-catcher' : (profile.workerMode || 'standard'),
    // Keep the key if already stored; never default to a non-empty string
    geminiApiKey: (profile.geminiApiKey || '').trim() || undefined,
    backupGeminiApiKey: (profile.backupGeminiApiKey || '').trim() || undefined,
  };
}

export function getDefaultSmartAudioProfile(): SmartAudioProfile {
  try {
    if (fs.existsSync(defaultProfileSourcePath)) {
      const raw = JSON.parse(fs.readFileSync(defaultProfileSourcePath, 'utf8')) as Partial<SmartAudioProfile>;
      return sanitizeProfile({
        id: 'default',
        name: 'Default',
        ...raw,
      });
    }
  } catch {
    // Fall back to a hard-coded default if the template file is unavailable.
  }

  return sanitizeProfile({
    id: 'default',
    name: 'Default',
    customTtsPrompt: 'You are an expert audiobook preparation assistant.',
  });
}

const fallbackProfilesDocument: SmartAudioProfilesDocument = {
  selectedProfileId: defaultProfilesData.selectedProfileId,
  profiles: defaultProfilesData.profiles.map(p => sanitizeProfile(p as unknown as Partial<SmartAudioProfile>)),
};

function cloneSmartAudioProfile(profile: SmartAudioProfile): SmartAudioProfile {
  return {
    ...profile,
    abbreviations: { ...(profile.abbreviations || {}) },
    pronunciations: { ...(profile.pronunciations || {}) },
    books: { ...(profile.books || {}) },
  };
}

export function restoreMissingBuiltInSmartAudioProfiles(
  document: SmartAudioProfilesDocument,
): RestoreMissingBuiltInProfilesResult {
  const existingIds = new Set(document.profiles.map((profile) => profile.id));
  const missingProfiles = fallbackProfilesDocument.profiles
    .filter((profile) => !existingIds.has(profile.id))
    .map(cloneSmartAudioProfile);
  const profiles = [...document.profiles, ...missingProfiles];
  const selectedProfileId = profiles.some((profile) => profile.id === document.selectedProfileId)
    ? document.selectedProfileId
    : profiles[0]?.id || fallbackProfilesDocument.selectedProfileId;

  return {
    document: {
      selectedProfileId,
      profiles,
    },
    restoredProfiles: missingProfiles.map(({ id, name }) => ({ id, name })),
  };
}

function parseDataJson(val: unknown): Record<string, unknown> {
  if (typeof val === 'string') {
    try {
      const parsed = JSON.parse(val);
      if (typeof parsed === 'object' && parsed !== null) return parsed;
    } catch {
      return {};
    }
  } else if (typeof val === 'object' && val !== null) {
    return val as Record<string, unknown>;
  }
  return {};
}

function serializeDataJson(val: Record<string, unknown>): string | Record<string, unknown> {
  return process.env.POSTGRES_URL ? val : JSON.stringify(val);
}

async function lockSmartAudioProfilesRow(tx: typeof db, userId: string): Promise<void> {
  if (!process.env.POSTGRES_URL) return;
  // The row may not exist yet, so SELECT FOR UPDATE cannot cover first-write
  // races. Every Smart Audio profile writer takes this transaction-scoped lock.
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`openreader-smart-audio:${userId}`}, 0))`,
  );
}

export async function readSmartAudioProfilesDocument(userId?: string | null): Promise<SmartAudioProfilesDocument> {
  if (!userId) return fallbackProfilesDocument;
  
  try {
    const rows = await db.select({ dataJson: userPreferences.dataJson }).from(userPreferences).where(eq(userPreferences.userId, userId)).limit(1);
    if (!rows || rows.length === 0) return fallbackProfilesDocument;
    
    const data = parseDataJson(rows[0].dataJson);
    const raw = data.smartAudioProfiles as Partial<SmartAudioProfilesDocument> | undefined;
    
    if (!raw || !Array.isArray(raw.profiles)) return fallbackProfilesDocument;
    
    const profiles = raw.profiles.map((profile) => sanitizeProfile(profile as SmartAudioProfile));
    const selectedProfileId = typeof raw.selectedProfileId === 'string' && raw.selectedProfileId.trim()
      ? raw.selectedProfileId.trim()
      : profiles[0]?.id || defaultProfilesData.selectedProfileId;

    return {
      selectedProfileId,
      profiles: profiles.length > 0 ? profiles : fallbackProfilesDocument.profiles,
    };
  } catch {
    return fallbackProfilesDocument;
  }
}

export async function writeSmartAudioProfilesDocument(userId: string | null | undefined, document: SmartAudioProfilesDocument): Promise<SmartAudioProfilesDocument> {
  if (!userId) return document;

  const profiles = document.profiles.length > 0
    ? document.profiles.map((profile) => sanitizeProfile(profile))
    : fallbackProfilesDocument.profiles;
  const selectedProfileId = profiles.some((profile) => profile.id === document.selectedProfileId)
    ? document.selectedProfileId
    : profiles[0].id;

  const sanitizedDocument: SmartAudioProfilesDocument = {
    selectedProfileId,
    profiles,
  };

  try {
    if (process.env.POSTGRES_URL) {
      await db.transaction(async (tx: typeof db) => {
        await lockSmartAudioProfilesRow(tx, userId);
        const rows = await tx.select({ dataJson: userPreferences.dataJson }).from(userPreferences).where(eq(userPreferences.userId, userId)).limit(1);
        const currentDataJson = rows && rows.length > 0 ? parseDataJson(rows[0].dataJson) : {};

        currentDataJson.smartAudioProfiles = sanitizedDocument;

        await tx.insert(userPreferences)
          .values({
            userId,
            dataJson: serializeDataJson(currentDataJson),
          })
          .onConflictDoUpdate({
            target: [userPreferences.userId],
            set: {
              dataJson: serializeDataJson(currentDataJson),
            }
          });
      });
    } else {
      db.transaction((tx: typeof db) => {
        const rows = tx.select({ dataJson: userPreferences.dataJson }).from(userPreferences).where(eq(userPreferences.userId, userId)).limit(1).all();
        const currentDataJson = rows && rows.length > 0 ? parseDataJson(rows[0].dataJson) : {};

        currentDataJson.smartAudioProfiles = sanitizedDocument;

        tx.insert(userPreferences)
          .values({
            userId,
            dataJson: serializeDataJson(currentDataJson),
          })
          .onConflictDoUpdate({
            target: [userPreferences.userId],
            set: {
              dataJson: serializeDataJson(currentDataJson),
            }
          }).run();
      });
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to write smart audio profiles', error);
  }
  return sanitizedDocument;
}

export async function restoreMissingBuiltInSmartAudioProfilesForUser(
  userId: string | null | undefined,
): Promise<RestoreMissingBuiltInProfilesResult> {
  if (!userId) {
    return {
      document: {
        selectedProfileId: fallbackProfilesDocument.selectedProfileId,
        profiles: fallbackProfilesDocument.profiles.map(cloneSmartAudioProfile),
      },
      restoredProfiles: [],
    };
  }

  const restoreFromRows = (
    rows: Array<{ dataJson: unknown }>,
  ): RestoreMissingBuiltInProfilesResult & { dataJson: Record<string, unknown> } => {
    const dataJson = rows.length > 0 ? parseDataJson(rows[0].dataJson) : {};
    const raw = dataJson.smartAudioProfiles as Partial<SmartAudioProfilesDocument> | undefined;
    const profiles = Array.isArray(raw?.profiles) && raw.profiles.length > 0
      ? raw.profiles.map((profile) => sanitizeProfile(profile as SmartAudioProfile))
      : fallbackProfilesDocument.profiles.map(cloneSmartAudioProfile);
    const selectedProfileId = typeof raw?.selectedProfileId === 'string'
      && profiles.some((profile) => profile.id === raw.selectedProfileId)
      ? raw.selectedProfileId
      : profiles[0]?.id || fallbackProfilesDocument.selectedProfileId;
    const result = restoreMissingBuiltInSmartAudioProfiles({ selectedProfileId, profiles });

    if (result.restoredProfiles.length > 0) {
      dataJson.smartAudioProfiles = result.document;
    }

    return { ...result, dataJson };
  };

  if (process.env.POSTGRES_URL) {
    return db.transaction(async (tx: typeof db) => {
      await lockSmartAudioProfilesRow(tx, userId);
      const rows = await tx
        .select({ dataJson: userPreferences.dataJson })
        .from(userPreferences)
        .where(eq(userPreferences.userId, userId))
        .limit(1);
      const { dataJson, ...result } = restoreFromRows(rows);
      if (result.restoredProfiles.length === 0) return result;

      await tx.insert(userPreferences)
        .values({ userId, dataJson: serializeDataJson(dataJson) })
        .onConflictDoUpdate({
          target: [userPreferences.userId],
          set: { dataJson: serializeDataJson(dataJson) },
        });
      return result;
    });
  }

  return db.transaction((tx: typeof db) => {
    const rows = tx
      .select({ dataJson: userPreferences.dataJson })
      .from(userPreferences)
      .where(eq(userPreferences.userId, userId))
      .limit(1)
      .all();
    const { dataJson, ...result } = restoreFromRows(rows);
    if (result.restoredProfiles.length === 0) return result;

    tx.insert(userPreferences)
      .values({ userId, dataJson: serializeDataJson(dataJson) })
      .onConflictDoUpdate({
        target: [userPreferences.userId],
        set: { dataJson: serializeDataJson(dataJson) },
      })
      .run();
    return result;
  });
}

export async function mergeGeneratedPronunciationsIntoLatestProfile(
  userId: string,
  profileId: string,
  generatedPronunciations: Record<string, string>,
  pronunciationsAtScanStart: Record<string, string>,
): Promise<{
  document: SmartAudioProfilesDocument;
  profile: SmartAudioProfile;
  appliedWords: string[];
  preservedUserEdits: string[];
} | null> {
  const mergeDocument = (
    rows: Array<{ dataJson: unknown }>,
  ): {
    document: SmartAudioProfilesDocument;
    profile: SmartAudioProfile;
    appliedWords: string[];
    preservedUserEdits: string[];
  } | null => {
    const currentDataJson = rows.length > 0 ? parseDataJson(rows[0].dataJson) : {};
    const raw = currentDataJson.smartAudioProfiles as Partial<SmartAudioProfilesDocument> | undefined;
    const currentProfiles = Array.isArray(raw?.profiles)
      ? raw.profiles.map((profile) => sanitizeProfile(profile as SmartAudioProfile))
      : fallbackProfilesDocument.profiles.map((profile) => ({ ...profile }));
    const profileIndex = currentProfiles.findIndex((profile) => profile.id === profileId);
    if (profileIndex < 0) return null;

    const merged = mergeGeneratedPronunciations(
      currentProfiles[profileIndex],
      generatedPronunciations,
      pronunciationsAtScanStart,
    );
    currentProfiles[profileIndex] = merged.profile;
    const selectedProfileId = typeof raw?.selectedProfileId === 'string'
      && currentProfiles.some((profile) => profile.id === raw.selectedProfileId)
      ? raw.selectedProfileId
      : currentProfiles[0].id;
    const document: SmartAudioProfilesDocument = {
      selectedProfileId,
      profiles: currentProfiles,
    };
    currentDataJson.smartAudioProfiles = document;

    return {
      document,
      profile: merged.profile,
      appliedWords: merged.appliedWords,
      preservedUserEdits: merged.preservedUserEdits,
    };
  };

  if (process.env.POSTGRES_URL) {
    return db.transaction(async (tx: typeof db) => {
      await lockSmartAudioProfilesRow(tx, userId);
      const rows = await tx
        .select({ dataJson: userPreferences.dataJson })
        .from(userPreferences)
        .where(eq(userPreferences.userId, userId))
        .limit(1);
      const result = mergeDocument(rows);
      if (!result) return null;
      const dataJson = rows.length > 0 ? parseDataJson(rows[0].dataJson) : {};
      dataJson.smartAudioProfiles = result.document;
      await tx.insert(userPreferences)
        .values({ userId, dataJson: serializeDataJson(dataJson) })
        .onConflictDoUpdate({ target: [userPreferences.userId], set: { dataJson: serializeDataJson(dataJson) } });
      return result;
    });
  }

  return db.transaction((tx: typeof db) => {
    const rows = tx
      .select({ dataJson: userPreferences.dataJson })
      .from(userPreferences)
      .where(eq(userPreferences.userId, userId))
      .limit(1)
      .all();
    const result = mergeDocument(rows);
    if (!result) return null;
    const dataJson = rows.length > 0 ? parseDataJson(rows[0].dataJson) : {};
    dataJson.smartAudioProfiles = result.document;
    tx.insert(userPreferences)
      .values({ userId, dataJson: serializeDataJson(dataJson) })
      .onConflictDoUpdate({ target: [userPreferences.userId], set: { dataJson: serializeDataJson(dataJson) } })
      .run();
    return result;
  });
}

export function findSmartAudioProfileById(
  profilesDocument: SmartAudioProfilesDocument,
  profileId?: string | null,
): SmartAudioProfile | null {
  const normalizedId = (profileId || '').trim();
  if (!normalizedId) return profilesDocument.profiles[0] ?? null;
  return profilesDocument.profiles.find((profile) => profile.id === normalizedId) ?? profilesDocument.profiles[0] ?? null;
}
