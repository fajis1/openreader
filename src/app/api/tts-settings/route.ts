import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

import {
  getDefaultSmartAudioProfile,
  mergeStoredSmartAudioProfileSecrets,
  readSmartAudioProfilesDocument,
  redactSmartAudioProfileSecrets,
  redactSmartAudioProfilesDocument,
  restoreMissingBuiltInSmartAudioProfilesForUser,
  writeSmartAudioProfilesDocument,
} from '@/lib/server/smart-audio-profiles';
import type { SmartAudioProfile } from '@/types/client';
import { errorResponse } from '@/lib/server/errors/next-response';
import { serverLogger } from '@/lib/server/logger';
import { requireAuthContext } from '@/lib/server/auth/auth';

export const dynamic = 'force-dynamic';

const configDir = path.join(process.cwd(), 'config');

// --- GET: Fetch profiles with key status metadata, never stored key values ---
export async function GET(request: NextRequest) {
  try {
    const ctxOrRes = await requireAuthContext(request);
    if (ctxOrRes instanceof Response) return ctxOrRes;
    const userId = ctxOrRes.userId;

    if (!fs.existsSync(configDir)) fs.mkdirSync(configDir);

    const profilesDocument = redactSmartAudioProfilesDocument(
      await readSmartAudioProfilesDocument(userId),
    );

    return NextResponse.json({
      smartAudioProfiles: profilesDocument.profiles,
      selectedSmartAudioProfileId: profilesDocument.selectedProfileId,
      defaultSmartAudioProfileId: getDefaultSmartAudioProfile().id,
    });
  } catch (error) {
    serverLogger.warn({ event: 'tts_settings.read.failed', error }, 'Error reading smart audio settings');
    const defaultProfile = getDefaultSmartAudioProfile();
    return NextResponse.json({
      smartAudioProfiles: [redactSmartAudioProfileSecrets(defaultProfile)],
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

    const currentDoc = await readSmartAudioProfilesDocument(userId);
    let savedDoc = currentDoc;
    let restoredProfiles: Array<{ id: string; name: string }> = [];

    if (body.restoreMissingBuiltInProfiles === true) {
      const restored = await restoreMissingBuiltInSmartAudioProfilesForUser(userId);
      savedDoc = restored.document;
      restoredProfiles = restored.restoredProfiles;
    } else if (Array.isArray(body.smartAudioProfiles)) {
      const selectedSmartAudioProfileId = typeof body.selectedSmartAudioProfileId === 'string'
        ? body.selectedSmartAudioProfileId
        : undefined;
      const incomingProfiles = body.smartAudioProfiles as SmartAudioProfile[];
      savedDoc = await writeSmartAudioProfilesDocument(userId, {
        selectedProfileId: selectedSmartAudioProfileId || currentDoc.selectedProfileId,
        profiles: mergeStoredSmartAudioProfileSecrets(incomingProfiles, currentDoc.profiles),
      });
    }

    serverLogger.info({
      event: 'tts_settings.saved',
      restoredBuiltInProfileIds: restoredProfiles.map((profile) => profile.id),
    }, 'Saved smart audio settings');
    const safeDocument = redactSmartAudioProfilesDocument(savedDoc);
    return NextResponse.json({
      success: true,
      message: 'Settings saved.',
      smartAudioProfiles: safeDocument.profiles,
      selectedSmartAudioProfileId: safeDocument.selectedProfileId,
      defaultSmartAudioProfileId: getDefaultSmartAudioProfile().id,
      restoredProfiles,
    });
  } catch (error) {
    serverLogger.error({ event: 'tts_settings.save.failed', error }, 'Error processing smart audio settings');
    return errorResponse(error, {
      apiErrorMessage: 'Failed to save smart audio settings',
      normalize: { code: 'SMART_AUDIO_SETTINGS_SAVE_FAILED', errorClass: 'db' },
    });
  }
}
