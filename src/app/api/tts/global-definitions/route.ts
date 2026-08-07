import { NextRequest, NextResponse } from 'next/server';
import { requireAuthContext } from '@/lib/server/auth/auth';
import { mergeGlobalDefinitions } from '@/lib/server/smart-audio/global-definition-library';
import { errorResponse } from '@/lib/server/errors/next-response';
import { serverLogger } from '@/lib/server/logger';

export async function POST(req: NextRequest) {
  try {
    const ctxOrRes = await requireAuthContext(req);
    if (ctxOrRes instanceof Response) return ctxOrRes;

    const body = await req.json().catch(() => ({}));
    const { word, definition } = body;
    
    if (!word) {
      return NextResponse.json({ error: 'Missing word' }, { status: 400 });
    }

    await mergeGlobalDefinitions({ [word]: definition || null });

    return NextResponse.json({ success: true, word, definition: definition || null });
  } catch (error) {
    return errorResponse(error, {
      logger: serverLogger,
      event: 'global_definitions.update.failed',
      msg: 'Failed to update global definition',
    });
  }
}
