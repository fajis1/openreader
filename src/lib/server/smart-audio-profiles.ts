import fs from 'fs';
import path from 'path';
import { db } from '@/db';
import { userPreferences } from '@/db/schema';
import { eq } from 'drizzle-orm';
import type { SmartAudioProfile } from '@/types/client';
import defaultProfilesData from './default_smart_audio_profiles.json';

const configDir = path.join(process.cwd(), 'config');
const defaultProfileSourcePath = path.join(configDir, 'default_book_tts_settings.json');

export interface SmartAudioProfilesDocument {
  selectedProfileId: string;
  profiles: SmartAudioProfile[];
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
    aiModel: (profile.aiModel || 'gemini-2.5-flash').trim(),
    customTtsPrompt: profile.customTtsPrompt || '',
    abbreviations: profile.abbreviations || {},
    pronunciations: profile.pronunciations || {},
    books: profile.books || {},
    // Keep the key if already stored; never default to a non-empty string
    geminiApiKey: (profile.geminiApiKey || '').trim() || undefined,
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

function parseDataJson(val: unknown): Record<string, any> {
  if (typeof val === 'string') {
    try {
      const parsed = JSON.parse(val);
      if (typeof parsed === 'object' && parsed !== null) return parsed;
    } catch {
      return {};
    }
  } else if (typeof val === 'object' && val !== null) {
    return val as Record<string, any>;
  }
  return {};
}

function serializeDataJson(val: Record<string, any>): string | Record<string, any> {
  return process.env.POSTGRES_URL ? val : JSON.stringify(val);
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
  } catch (error) {
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
    const rows = await db.select({ dataJson: userPreferences.dataJson }).from(userPreferences).where(eq(userPreferences.userId, userId)).limit(1);
    const currentDataJson = rows && rows.length > 0 ? parseDataJson(rows[0].dataJson) : {};
    
    currentDataJson.smartAudioProfiles = sanitizedDocument;
    
    await db.insert(userPreferences)
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
  } catch (error) {
    console.error('Failed to write smart audio profiles', error);
  }
  return sanitizedDocument;
}

export function findSmartAudioProfileById(
  profilesDocument: SmartAudioProfilesDocument,
  profileId?: string | null,
): SmartAudioProfile | null {
  const normalizedId = (profileId || '').trim();
  if (!normalizedId) return profilesDocument.profiles[0] ?? null;
  return profilesDocument.profiles.find((profile) => profile.id === normalizedId) ?? profilesDocument.profiles[0] ?? null;
}
