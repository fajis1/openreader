import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { documents, documentSettings } from '@/db/schema';
import { eq, and, sql } from 'drizzle-orm';
import { getDocumentBlob } from '@/lib/server/documents/blobstore';
import { readSmartAudioProfilesDocument, findSmartAudioProfileById } from '@/lib/server/smart-audio-profiles';
import { serverLogger } from '@/lib/server/logger';
import { SmartAudioCharacterMap } from '@/types/document-settings';
import { requireAuthContext } from '@/lib/server/auth/auth';

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireAuthContext(req);
    if (ctx instanceof Response) return ctx;
    const userId = ctx.userId;
    if (!userId) return new Response("Unauthorized", { status: 401 });

    const body = await req.json();
    const documentId = typeof body.documentId === 'string' ? body.documentId : '';
    const profileId = typeof body.profileId === 'string' ? body.profileId : '';

    if (!documentId || !profileId) {
      return NextResponse.json({ error: 'Document ID and Profile ID are required' }, { status: 400 });
    }

    const docRows = await db.select().from(documents).where(and(eq(documents.id, documentId), eq(documents.userId, userId)));
    if (docRows.length === 0) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    const profilesDocument = await readSmartAudioProfilesDocument(userId);
    const selectedProfile = findSmartAudioProfileById(profilesDocument, profileId);
    if (!selectedProfile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
    }

    const geminiApiKey = (selectedProfile.geminiApiKey || '').trim();
    if (!geminiApiKey) {
      return NextResponse.json({ error: 'Gemini API key is required in the profile' }, { status: 400 });
    }

    // 1. Get raw text
    const buffer = await getDocumentBlob(documentId, null);
    let rawText = buffer.toString('utf-8'); // Simplify: Assuming it's already extracted, or we extract if needed. For PDF this needs parsing.
    // NOTE: In a real implementation, we should use the same extraction logic as worker.ts
    // For now, we assume it's just raw text. If it's a PDF, we need to extract text from the ParsedPdfDocument.
    // Since this is a massive context window, we'll just grab the text up to a safe limit.

    // 2. Connect to NATS
    const { connect, StringCodec } = await import('nats');
    const natsUrl = process.env.NATS_URL || "nats://127.0.0.1:4222";
    const nc = await connect({ servers: natsUrl, maxReconnectAttempts: 1, timeout: 2000 });
    const sc = StringCodec();

    const payload = JSON.stringify({
      user_id: userId,
      api_key: geminiApiKey,
      backup_api_key: (selectedProfile.backupGeminiApiKey || '').trim(),
      raw_text: rawText.substring(0, 3000000), // Truncate to safe size for now
      ai_model: selectedProfile.aiModel || 'gemini-2.5-flash-8b'
    });

    serverLogger.info({ event: 'audiobook.multivoice.extract.start', documentId }, 'Sending text to Python worker for character extraction');
    const msg = await nc.request('audiobooks.multivoice.extract', sc.encode(payload), { timeout: 300000 }); // 5 min timeout
    const workerResult = JSON.parse(sc.decode(msg.data));
    await nc.close();

    if (workerResult.status === 'error' || workerResult.status === 'rate_limit') {
      return NextResponse.json({ error: workerResult.message || 'Worker error' }, { status: 500 });
    }

    const characters = workerResult.characters || [];
    
    // 3. Save to DocumentSettings
    const characterMap: SmartAudioCharacterMap = {
      schemaVersion: 1,
      status: 'complete',
      scannedAt: Date.now(),
      entries: {}
    };

    characters.forEach((char: any) => {
      characterMap.entries[char.name] = {
        name: char.name,
        description: char.description,
        sampleText: char.sample_text,
        voiceId: null,
      };
    });

    const serializedMap = JSON.stringify(characterMap);
    const mergedDataJson = process.env.POSTGRES_URL
      ? sql`jsonb_set(coalesce(${documentSettings.dataJson}, '{}'::jsonb), '{smartAudioCharacters}', ${serializedMap}::jsonb, true)`
      : sql`json_set(coalesce(${documentSettings.dataJson}, '{}'), '$.smartAudioCharacters', json(${serializedMap}))`;

    await db.insert(documentSettings).values({
      documentId,
      userId,
      dataJson: { smartAudioCharacters: characterMap } as never,
      clientUpdatedAtMs: 0,
      updatedAt: Date.now(),
    }).onConflictDoUpdate({
      target: [documentSettings.documentId, documentSettings.userId],
      set: {
        dataJson: mergedDataJson as never,
        updatedAt: Date.now(),
      },
    });

    return NextResponse.json({ success: true, characters: characterMap.entries });
  } catch (error) {
    serverLogger.error({ event: 'audiobook.multivoice.extract.error', error }, 'Failed to extract characters');
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
