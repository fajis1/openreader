import { NextRequest, NextResponse } from 'next/server';
import { requireAuthContext } from '@/lib/server/auth/auth';
import { readSmartAudioProfilesDocument, findSmartAudioProfileById } from '@/lib/server/smart-audio-profiles';
import { db } from '@/db';
import { adminSettings } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { generateTTSBuffer } from '@/lib/server/tts/generate';
import { resolveTtsCredentials } from '@/lib/server/admin/resolve-credentials';
import { getResolvedRuntimeConfig } from '@/lib/server/runtime-config';

const SEED_EXAMPLES = [
  "Make the ending sound more like -een instead of -ayn",
  "Soften the initial consonant transition and lengthen the final vowel",
  "Ensure the middle diphthong sounds like 'oy' in boy without a hard g sound",
  "Make the 'ch' sound a hard K sound like in choir",
  "Drop the double-N repetition so it flows smoothly into the next syllable"
];

async function getFeedbackExamples() {
  const rows = await db.select().from(adminSettings).where(eq(adminSettings.key, 'pronunciation_feedback_examples')).limit(1);
  if (rows.length > 0 && rows[0].valueJson) {
    try {
      const parsed = typeof rows[0].valueJson === 'string' ? JSON.parse(rows[0].valueJson) : rows[0].valueJson;
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch (e) {}
  }
  // Initialize if empty
  await db.insert(adminSettings).values({
    key: 'pronunciation_feedback_examples',
    valueJson: JSON.stringify(SEED_EXAMPLES)
  }).onConflictDoUpdate({
    target: adminSettings.key,
    set: { valueJson: JSON.stringify(SEED_EXAMPLES) }
  });
  return SEED_EXAMPLES;
}

export async function GET(req: NextRequest) {
  try {
    const ctxOrRes = await requireAuthContext(req);
    if (ctxOrRes instanceof Response) return ctxOrRes;
    const examples = await getFeedbackExamples();
    return NextResponse.json({ feedbackExamples: examples });
  } catch (error: any) {
    console.error('Refine pronunciations GET error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctxOrRes = await requireAuthContext(req);
    if (ctxOrRes instanceof Response) return ctxOrRes;
    const userId = ctxOrRes.userId;

    const body = await req.json();
    const { word, feedback, currentChoices } = body;
    if (!word || !feedback) {
      return NextResponse.json({ error: 'Missing word or feedback' }, { status: 400 });
    }

    // 1. Append feedback to global examples
    let examples = await getFeedbackExamples();
    // Add to front, take top 5
    examples = [feedback, ...examples.filter((e: string) => e !== feedback)].slice(0, 5);
    await db.update(adminSettings)
      .set({ valueJson: JSON.stringify(examples) })
      .where(eq(adminSettings.key, 'pronunciation_feedback_examples'));

    // 2. Resolve Gemini model and key
    const profilesDoc = await readSmartAudioProfilesDocument(userId);
    const activeProfile = findSmartAudioProfileById(profilesDoc, profilesDoc.selectedProfileId);
    
    if (!activeProfile?.geminiApiKey) {
      return NextResponse.json({ error: 'Gemini API key not configured in active profile' }, { status: 400 });
    }

    const model = activeProfile?.aiModel || 'gemini-3.6-flash';
    const apiKey = activeProfile.geminiApiKey;

    // 3. Call Gemini
    const prompt = `The user wants to adjust the Kokoro IPA pronunciation for the word '${word}'.
User Feedback: '${feedback}'.
DO NOT generate any of the following previous choices: ${JSON.stringify(currentChoices || [])}.
Generate 5 NEW distinct, plausible Kokoro IPA pronunciation variations that address the user's feedback.
Strictly follow Kokoro IPA constraints: no stress markers '\\u02c8', no standalone '/o/', no syllable boundary periods between vowels.
Return a JSON object: { "newChoices": ["pron1", "pron2", "pron3", "pron4", "pron5"] }`;

    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json" }
      })
    });

    if (!res.ok) {
      console.error('Gemini API returned error status:', res.status, await res.text());
      return NextResponse.json({ error: 'Failed to generate choices' }, { status: 500 });
    }

    const data = await res.json();
    let newChoices: string[] = [];
    if (data.candidates && data.candidates[0]?.content?.parts?.[0]?.text) {
      try {
        const generated = JSON.parse(data.candidates[0].content.parts[0].text);
        newChoices = generated.newChoices || [];
      } catch (e) {
        console.error('Failed to parse Gemini response:', e);
      }
    }

    if (!newChoices || newChoices.length === 0) {
      return NextResponse.json({ error: 'Failed to generate new choices' }, { status: 500 });
    }

    // 4. Pre-cache Kokoro Audio buffers
    try {
      const runtimeConfig = await getResolvedRuntimeConfig();
      const creds = await resolveTtsCredentials({
        providerHeader: null,
        apiKeyHeader: null,
        baseUrlHeader: null,
        fallbackProvider: runtimeConfig.defaultTtsProvider || 'custom-openai',
        restrictUserApiKeys: runtimeConfig.restrictUserApiKeys ?? false,
      });

      if (!('error' in creds)) {
        const cachePromises = newChoices.map((phonetic) => {
          const textToSynthesize = phonetic.startsWith('/') ? `[${word}](${phonetic})` : `[${word}](/${phonetic}/)`;
          return generateTTSBuffer({
            text: textToSynthesize,
            voice: 'af_heart', // Defaulting to af_heart as used in pre-caching elsewhere
            speed: 1,
            format: 'mp3',
            provider: creds.provider,
            apiKey: creds.apiKey,
            baseUrl: creds.baseUrl,
          }).catch(e => console.error('Failed to pre-cache refined', word, phonetic, e));
        });
        await Promise.all(cachePromises);
      }
    } catch (e) {
      console.error('Error in pre-caching refined audio', e);
    }

    return NextResponse.json({ newChoices, feedbackExamples: examples });
  } catch (error: any) {
    console.error('Refine pronunciations POST error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
