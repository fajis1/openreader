import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { adminSettings } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { requireAuthContext } from '@/lib/server/auth/auth';

export async function GET(req: NextRequest) {
  try {
    await requireAuthContext(req);

    const rows = await db.select().from(adminSettings).where(eq(adminSettings.key, 'global_pronunciations')).limit(1);
    let pronunciations = {};
    if (rows && rows.length > 0) {
      try {
        pronunciations = JSON.parse(rows[0].valueJson);
      } catch (e) {}
    }

    return NextResponse.json({ pronunciations });
  } catch (error) {
    console.error('Failed to get global pronunciations', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAuthContext(req);
    const body = await req.json();
    const newPronunciations = body.pronunciations;

    if (!newPronunciations || typeof newPronunciations !== 'object') {
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
    }

    const jsonString = JSON.stringify(newPronunciations);

    await db.insert(adminSettings)
      .values({
        id: 'global_pronunciations',
        valueJson: jsonString,
        source: 'user_contributed',
      })
      .onConflictDoUpdate({
        target: [adminSettings.key],
        set: {
          valueJson: jsonString,
          updatedAt: Date.now(),
        }
      });

    return NextResponse.json({ success: true, pronunciations: newPronunciations });
  } catch (error) {
    console.error('Failed to update global pronunciations', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
