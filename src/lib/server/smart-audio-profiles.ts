import fs from 'fs';
import path from 'path';

import type { SmartAudioProfile } from '@/types/client';

const configDir = path.join(process.cwd(), 'config');
const smartAudioProfilesPath = path.join(configDir, 'smart_audio_profiles.json');
const globalKeyPath = path.join(configDir, 'global_api_key.json');
const defaultProfileSourcePath = path.join(configDir, 'default_book_tts_settings.json');

export interface SmartAudioProfilesDocument {
  selectedProfileId: string;
  profiles: SmartAudioProfile[];
}

function ensureConfigDir(): void {
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
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

export function readGlobalGeminiApiKey(): string {
  try {
    if (!fs.existsSync(globalKeyPath)) return '';
    const globalData = JSON.parse(fs.readFileSync(globalKeyPath, 'utf8')) as { geminiApiKey?: string };
    return (globalData.geminiApiKey || '').trim();
  } catch {
    return '';
  }
}

export function writeGlobalGeminiApiKey(apiKey: string): void {
  ensureConfigDir();
  fs.writeFileSync(globalKeyPath, JSON.stringify({ geminiApiKey: apiKey.trim() }, null, 2));
}

export function readSmartAudioProfilesDocument(): SmartAudioProfilesDocument {
  try {
    if (!fs.existsSync(smartAudioProfilesPath)) {
      const defaultProfile = getDefaultSmartAudioProfile();
      return {
        selectedProfileId: defaultProfile.id,
        profiles: [defaultProfile],
      };
    }

    const raw = JSON.parse(fs.readFileSync(smartAudioProfilesPath, 'utf8')) as Partial<SmartAudioProfilesDocument>;
    const profiles = Array.isArray(raw.profiles)
      ? raw.profiles.map((profile) => sanitizeProfile(profile as SmartAudioProfile))
      : [getDefaultSmartAudioProfile()];
    const selectedProfileId = typeof raw.selectedProfileId === 'string' && raw.selectedProfileId.trim()
      ? raw.selectedProfileId.trim()
      : profiles[0]?.id || getDefaultSmartAudioProfile().id;

    return {
      selectedProfileId,
      profiles: profiles.length > 0 ? profiles : [getDefaultSmartAudioProfile()],
    };
  } catch {
    const defaultProfile = getDefaultSmartAudioProfile();
    return {
      selectedProfileId: defaultProfile.id,
      profiles: [defaultProfile],
    };
  }
}

export function writeSmartAudioProfilesDocument(document: SmartAudioProfilesDocument): SmartAudioProfilesDocument {
  ensureConfigDir();

  const profiles = document.profiles.length > 0
    ? document.profiles.map((profile) => sanitizeProfile(profile))
    : [getDefaultSmartAudioProfile()];
  const selectedProfileId = profiles.some((profile) => profile.id === document.selectedProfileId)
    ? document.selectedProfileId
    : profiles[0].id;

  const sanitizedDocument: SmartAudioProfilesDocument = {
    selectedProfileId,
    profiles,
  };

  fs.writeFileSync(smartAudioProfilesPath, JSON.stringify(sanitizedDocument, null, 2));
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
