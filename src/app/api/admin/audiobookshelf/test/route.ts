import { NextRequest, NextResponse } from 'next/server';
import { requireAdminContext } from '@/lib/server/auth/admin';
import { fetchAudiobookshelfLibraries, resolveAudiobookshelfConfig } from '@/lib/server/audiobooks/audiobookshelf';
import { errorToLog, serverLogger } from '@/lib/server/logger';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const adminOrRes = await requireAdminContext(req);
  if (adminOrRes instanceof Response) return adminOrRes;

  try {
    const config = await resolveAudiobookshelfConfig();
    const url = req.nextUrl.searchParams.get('url') || config.url;
    const token = req.nextUrl.searchParams.get('token') || config.token;

    if (!url) {
      return NextResponse.json({ ok: false, error: 'Audiobookshelf server URL is required' }, { status: 400 });
    }
    if (!token) {
      return NextResponse.json({ ok: false, error: 'Audiobookshelf API token is required' }, { status: 400 });
    }

    const libraries = await fetchAudiobookshelfLibraries(url, token);
    return NextResponse.json({ ok: true, libraries });
  } catch (error) {
    serverLogger.warn(
      { event: 'admin.audiobookshelf.test_failed', error: errorToLog(error) },
      'Audiobookshelf connection test failed',
    );
    return NextResponse.json(
      { ok: false, error: (error as Error)?.message || 'Connection failed' },
      { status: 502 },
    );
  }
}

export async function POST(req: NextRequest) {
  const adminOrRes = await requireAdminContext(req);
  if (adminOrRes instanceof Response) return adminOrRes;

  try {
    const body = (await req.json().catch(() => ({}))) as { url?: string; token?: string };
    const config = await resolveAudiobookshelfConfig();
    const url = (body.url || config.url || '').trim();
    const token = (body.token || config.token || '').trim();

    if (!url) {
      return NextResponse.json({ ok: false, error: 'Audiobookshelf server URL is required' }, { status: 400 });
    }
    if (!token) {
      return NextResponse.json({ ok: false, error: 'Audiobookshelf API token is required' }, { status: 400 });
    }

    const libraries = await fetchAudiobookshelfLibraries(url, token);
    return NextResponse.json({ ok: true, libraries });
  } catch (error) {
    serverLogger.warn(
      { event: 'admin.audiobookshelf.test_failed', error: errorToLog(error) },
      'Audiobookshelf connection test failed',
    );
    return NextResponse.json(
      { ok: false, error: (error as Error)?.message || 'Connection failed' },
      { status: 502 },
    );
  }
}
