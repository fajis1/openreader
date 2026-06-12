import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

import {
  getDefaultSmartAudioProfile,
  readGlobalGeminiApiKey,
  readSmartAudioProfilesDocument,
  writeGlobalGeminiApiKey,
  writeSmartAudioProfilesDocument,
} from '@/lib/server/smart-audio-profiles';
import { errorResponse } from '@/lib/server/errors/next-response';
import { serverLogger } from '@/lib/server/logger';

export const dynamic = 'force-dynamic';

const configDir = path.join(process.cwd(), 'config');

// --- GET: Fetch the masked global key for the UI ---
export async function GET() {
  try {
    if (!fs.existsSync(configDir)) fs.mkdirSync(configDir);

    const key = readGlobalGeminiApiKey();
    const profilesDocument = readSmartAudioProfilesDocument();
    const maskedKey = key.length > 4 ? `••••••••••••${key.slice(-4)}` : null;

    return NextResponse.json({
      maskedKey,
      smartAudioProfiles: profilesDocument.profiles,
      selectedSmartAudioProfileId: profilesDocument.selectedProfileId,
      defaultSmartAudioProfileId: getDefaultSmartAudioProfile().id,
    });
  } catch (error) {
    serverLogger.warn({ event: 'tts_settings.read.failed', error }, 'Error reading smart audio settings');
    const defaultProfile = getDefaultSmartAudioProfile();
    return NextResponse.json({
      maskedKey: null,
      smartAudioProfiles: [defaultProfile],
      selectedSmartAudioProfileId: defaultProfile.id,
      defaultSmartAudioProfileId: defaultProfile.id,
    });
  }
}

// --- POST: Save book settings and update global key ---
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const targetBook = body.bookId || "default";
    
    if (!fs.existsSync(configDir)) fs.mkdirSync(configDir);

    // 1. If the user typed a NEW API key, save it globally
    if (body.geminiApiKey && body.geminiApiKey.trim() !== "") {
      writeGlobalGeminiApiKey(body.geminiApiKey.trim());
    }

    if (Array.isArray(body.smartAudioProfiles)) {
      const selectedSmartAudioProfileId = typeof body.selectedSmartAudioProfileId === 'string'
        ? body.selectedSmartAudioProfileId
        : undefined;
      writeSmartAudioProfilesDocument({
        selectedProfileId: selectedSmartAudioProfileId || readSmartAudioProfilesDocument().selectedProfileId,
        profiles: body.smartAudioProfiles,
      });
    }

    // 2. Save the Book-Specific Settings (excluding the raw API key for security)
    const bookSettings = {
      aiModel: body.aiModel,
      customTtsPrompt: body.customTtsPrompt,
      abbreviations: body.abbreviations,
      pronunciations: body.pronunciations,
      books: body.books
    };
    
    const fileName = `${targetBook}_tts_settings.json`;
    const filePath = path.join(configDir, fileName);
    fs.writeFileSync(filePath, JSON.stringify(bookSettings, null, 2));

    serverLogger.info({ event: 'tts_settings.saved', targetBook }, 'Saved smart audio settings');
    return NextResponse.json({ success: true, message: `Settings saved for ${targetBook}.` });

  } catch (error) {
    serverLogger.error({ event: 'tts_settings.save.failed', error }, 'Error processing smart audio settings');
    return errorResponse(error, {
      apiErrorMessage: 'Failed to save smart audio settings',
      normalize: { code: 'SMART_AUDIO_SETTINGS_SAVE_FAILED', errorClass: 'db' },
    });
  }
}