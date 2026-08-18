import { NextRequest, NextResponse } from 'next/server';
import { requireAuthContext } from '@/lib/server/auth/auth';
import { mergeGlobalDefinitions } from '@/lib/server/smart-audio/global-definition-library';
import { errorResponse } from '@/lib/server/errors/next-response';
import { serverLogger } from '@/lib/server/logger';
import { normalizeDictionaryDefinition } from '@/lib/shared/dictionary-definition-policy';

export async function POST(req: NextRequest) {
  try {
    const ctxOrRes = await requireAuthContext(req);
    if (ctxOrRes instanceof Response) return ctxOrRes;

    const body = await req.json().catch(() => ({}));
    const { word, definition } = body;
    
    if (!word) {
      return NextResponse.json({ error: 'Missing word' }, { status: 400 });
    }

    const normalizedDefinition = normalizeDictionaryDefinition(definition);
    await mergeGlobalDefinitions({ [word]: normalizedDefinition });

    return NextResponse.json({ success: true, word, definition: normalizedDefinition });
  } catch (error) {
    return errorResponse(error, {
      logger: serverLogger,
      event: 'global_definitions.update.failed',
      msg: 'Failed to update global definition',
    });
  }
}
