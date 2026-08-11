import { NextResponse, type NextRequest } from 'next/server';
import { decideJoinRequest } from '@/lib/server/access/join-requests';
import { errorToLog, serverLogger } from '@/lib/server/logger';

function html(title: string, body: string, status = 200): NextResponse {
  return new NextResponse(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <style>
      body { font-family: system-ui, sans-serif; margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0f172a; color: #e2e8f0; }
      main { width: min(92vw, 34rem); border: 1px solid #334155; border-radius: 1rem; padding: 2rem; background: #111827; }
      h1 { margin-top: 0; }
      a { color: #93c5fd; }
    </style>
  </head>
  <body><main><h1>${title}</h1><p>${body}</p><p><a href="/signin">Back to OpenReader</a></p></main></body>
</html>`, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
export async function GET(req: NextRequest) {
  try {
    const token = req.nextUrl.searchParams.get('token') || '';
    const rawDecision = req.nextUrl.searchParams.get('decision') || '';
    const decision = rawDecision === 'approve' ? 'approve' : rawDecision === 'deny' ? 'deny' : null;
    if (!token || !decision) {
      return html('Invalid request', 'This approval link is missing a token or decision.', 400);
    }
    const request = await decideJoinRequest({ token, decision });
    if (!request) {
      return html('Request not found', 'This approval link is invalid or no longer available.', 404);
    }
    return html(
      decision === 'approve' ? 'Request approved' : 'Request denied',
      decision === 'approve'
        ? `${request.email} can now sign in with Google or create an account.`
        : `${request.email} was denied access.`,
    );
  } catch (error) {
    serverLogger.error({ event: 'join_request.decision.failed', error: errorToLog(error) }, 'Join request decision failed');
    return html('Decision failed', 'OpenReader could not process this approval link.', 500);
  }
}
