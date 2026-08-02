import { NextRequest, NextResponse } from 'next/server';
import { generateTTSBuffer } from '@/lib/server/tts/generate';
import { resolveTtsCredentials } from '@/lib/server/admin/resolve-credentials';
import { getResolvedRuntimeConfig } from '@/lib/server/runtime-config';
import { isBuiltInTtsProviderId } from '@/lib/shared/tts-provider-catalog';
import { resolveTtsPreviewVoice } from '@/lib/shared/tts-preview';
import { defaultModelForProviderType, resolveTtsModelForProvider } from '@/lib/shared/tts-provider-policy';
import { errorResponse } from '@/lib/server/errors/next-response';
import { serverLogger } from '@/lib/server/logger';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const text = typeof body.text === 'string' ? body.text : '';
    const requestedVoice = typeof body.voice === 'string' ? body.voice.trim() : '';

    if (!text) {
      return NextResponse.json({ error: 'Text is required' }, { status: 400 });
    }

    const providerHeader = req.headers.get('x-tts-provider');
    const apiKeyHeader = req.headers.get('x-openai-key');
    const baseUrlHeader = req.headers.get('x-openai-base-url');
    const modelHeader = req.headers.get('x-tts-model');

    const runtimeConfig = await getResolvedRuntimeConfig();
    const creds = await resolveTtsCredentials({
      providerHeader,
      apiKeyHeader,
      baseUrlHeader,
      fallbackProvider: runtimeConfig.defaultTtsProvider || 'custom-openai',
      restrictUserApiKeys: runtimeConfig.restrictUserApiKeys ?? false,
    });

    if ('error' in creds) {
      serverLogger.warn({
        event: 'tts.preview.credentials.unavailable',
        reason: creds.error,
        slug: creds.slug,
      }, 'Failed to resolve TTS credentials for preview');
      return NextResponse.json({ error: 'TTS provider not configured' }, { status: 503 });
    }

    const providerType = isBuiltInTtsProviderId(creds.provider) ? creds.provider : 'openai';
    const effectiveProviderRef = creds.adminRecord?.slug
      ?? providerHeader
      ?? runtimeConfig.defaultTtsProvider;
    const model = resolveTtsModelForProvider({
      providerRef: effectiveProviderRef,
      providerType,
      model: modelHeader,
      sharedProviders: creds.adminRecord ? [creds.adminRecord] : [],
      fallbackProviderRef: runtimeConfig.defaultTtsProvider,
      showAllProviderModels: runtimeConfig.showAllProviderModels,
    }) || defaultModelForProviderType(providerType);
    const voice = resolveTtsPreviewVoice({
      requestedVoice,
      providerRef: creds.provider,
      providerType,
      model,
    });
    if (!voice) {
      return NextResponse.json({ error: 'No TTS voice is configured for previews.' }, { status: 400 });
    }

    const buffer = await generateTTSBuffer({
      text,
      voice,
      speed: 1,
      format: 'mp3',
      provider: creds.provider,
      apiKey: creds.apiKey,
      baseUrl: creds.baseUrl,
      model,
    });

    return new NextResponse(buffer as unknown as BodyInit, {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'public, max-age=3600, s-maxage=3600',
      },
    });
  } catch (error) {
    return errorResponse(error, {
      logger: serverLogger,
      event: 'tts.preview.generate.failed',
      msg: 'Failed to generate TTS preview',
      apiErrorMessage: 'Failed to generate preview.',
    });
  }
}
