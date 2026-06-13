import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

import {
  getDefaultSmartAudioProfile,
  readSmartAudioProfilesDocument,
  writeSmartAudioProfilesDocument,
} from '@/lib/server/smart-audio-profiles';
import { errorResponse } from '@/lib/server/errors/next-response';
import { serverLogger } from '@/lib/server/logger';
import { requireAuthContext } from '@/lib/server/auth/auth';

export const dynamic = 'force-dynamic';

const configDir = path.join(process.cwd(), 'config');

// --- GET: Fetch the masked global key for the UI ---
export async function GET(request: NextRequest) {
  try {
    const ctxOrRes = await requireAuthContext(request);
    if (ctxOrRes instanceof Response) return ctxOrRes;
    const userId = ctxOrRes.userId;

    if (!fs.existsSync(configDir)) fs.mkdirSync(configDir);

    const profilesDocument = await readSmartAudioProfilesDocument(userId);

    return NextResponse.json({
      smartAudioProfiles: profilesDocument.profiles,
      selectedSmartAudioProfileId: profilesDocument.selectedProfileId,
      defaultSmartAudioProfileId: getDefaultSmartAudioProfile().id,
    });
  } catch (error) {
    serverLogger.warn({ event: 'tts_settings.read.failed', error }, 'Error reading smart audio settings');
    const defaultProfile = getDefaultSmartAudioProfile();
    return NextResponse.json({
      smartAudioProfiles: [defaultProfile],
      selectedSmartAudioProfileId: defaultProfile.id,
      defaultSmartAudioProfileId: defaultProfile.id,
    });
  }
}

// --- POST: Save book settings and update global key ---
export async function POST(request: NextRequest) {
  try {
    const ctxOrRes = await requireAuthContext(request);
    if (ctxOrRes instanceof Response) return ctxOrRes;
    const userId = ctxOrRes.userId;
    const body = await request.json();

    if (Array.isArray(body.smartAudioProfiles)) {
      const selectedSmartAudioProfileId = typeof body.selectedSmartAudioProfileId === 'string'
        ? body.selectedSmartAudioProfileId
        : undefined;
      const currentDoc = await readSmartAudioProfilesDocument(userId);
      await writeSmartAudioProfilesDocument(userId, {
        selectedProfileId: selectedSmartAudioProfileId || currentDoc.selectedProfileId,
        profiles: body.smartAudioProfiles,
      });
    }

    serverLogger.info({ event: 'tts_settings.saved' }, 'Saved smart audio settings');
    return NextResponse.json({ success: true, message: `Settings saved.` });
  } catch (error) {
    serverLogger.error({ event: 'tts_settings.save.failed', error }, 'Error processing smart audio settings');
    return errorResponse(error, {
      apiErrorMessage: 'Failed to save smart audio settings',
      normalize: { code: 'SMART_AUDIO_SETTINGS_SAVE_FAILED', errorClass: 'db' },
    });
  }
}
