import { NextResponse, type NextRequest } from 'next/server';
import { createJoinRequest } from '@/lib/server/access/join-requests';
import { errorToLog, serverLogger } from '@/lib/server/logger';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const result = await createJoinRequest({
      email: body?.email,
      name: body?.name,
      intendedUse: body?.intendedUse,
      heardAbout: body?.heardAbout,
      requestUrl: req.url,
    });
    return NextResponse.json({
      ok: true,
      status: result.request.status,
    });
  } catch (error) {
    serverLogger.warn({ event: 'join_request.submit.failed', error: errorToLog(error) }, 'Join request submission failed');
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Unable to submit join request.',
    }, { status: 400 });
  }
}
