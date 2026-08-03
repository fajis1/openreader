import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { adminSettings } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { requireAdminContext } from '@/lib/server/auth/admin';
import { normalizeGlobalPronunciationLibrary } from '@/lib/server/tts/global-pronunciation-library';
import { errorResponse } from '@/lib/server/errors/next-response';
import { serverLogger } from '@/lib/server/logger';

export async function GET(req: NextRequest) {
  try {
    const admin = await requireAdminContext(req);
    if (admin instanceof Response) return admin;

    const rows = await db.select({ valueJson: adminSettings.valueJson })
      .from(adminSettings)
      .where(eq(adminSettings.key, 'global_pronunciations'))
      .limit(1);
    const raw = rows[0]?.valueJson;
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const library = normalizeGlobalPronunciationLibrary(parsed || {});
    const payload = `${JSON.stringify({
      format: 'openreader-global-pronunciations',
      version: 1,
      exportedAt: new Date().toISOString(),
      pronunciations: library,
    }, null, 2)}\n`;

    return new NextResponse(payload, {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': 'attachment; filename="openreader-global-pronunciations.json"',
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    return errorResponse(error, {
      logger: serverLogger,
      event: 'tts.global_pronunciations.export.failed',
      msg: 'Failed to export global pronunciations',
      apiErrorMessage: 'Failed to export global pronunciations.',
    });
  }
}
