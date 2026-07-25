import { NextRequest, NextResponse } from 'next/server';
import { generateTTSBuffer } from '@/lib/server/tts/generate';
import { resolveTtsCredentials } from '@/lib/server/admin/resolve-credentials';
import { getResolvedRuntimeConfig } from '@/lib/server/runtime-config';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { text, voice = 'default' } = body;

    if (!text) {
      return NextResponse.json({ error: 'Text is required' }, { status: 400 });
    }

    const providerHeader = req.headers.get('x-tts-provider');
    const apiKeyHeader = req.headers.get('x-openai-key');
    const baseUrlHeader = req.headers.get('x-openai-base-url');

    const runtimeConfig = await getResolvedRuntimeConfig();
    const creds = await resolveTtsCredentials({
      providerHeader,
      apiKeyHeader,
      baseUrlHeader,
      fallbackProvider: runtimeConfig.defaultTtsProvider || 'custom-openai',
      restrictUserApiKeys: runtimeConfig.restrictUserApiKeys ?? false,
    });

    if ('error' in creds) {
      console.error('Failed to resolve TTS credentials for preview:', creds);
      return NextResponse.json({ error: 'TTS provider not configured' }, { status: 503 });
    }

    const buffer = await generateTTSBuffer({
      text,
      voice,
      speed: 1,
      format: 'mp3',
      provider: creds.provider,
      apiKey: creds.apiKey,
      baseUrl: creds.baseUrl,
    });

    return new NextResponse(buffer as unknown as BodyInit, {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'public, max-age=3600, s-maxage=3600',
      },
    });
  } catch (error) {
    console.error('Failed to generate TTS preview:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to generate preview' }, { status: 500 });
  }
}
