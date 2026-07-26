import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { db } from '@/db';
import { userApiKeys } from '@/db/schema';
import { getAuthSession } from '@/lib/auth';
import { eq } from 'drizzle-orm';

export async function GET(req: NextRequest) {
  try {
    const session = await getAuthSession(req);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const keys = await db
      .select({
        id: userApiKeys.id,
        name: userApiKeys.name,
        keyLast4: userApiKeys.keyLast4,
        expiresAt: userApiKeys.expiresAt,
        createdAt: userApiKeys.createdAt,
        lastUsedAt: userApiKeys.lastUsedAt,
      })
      .from(userApiKeys)
      .where(eq(userApiKeys.userId, session.user.id));

    return NextResponse.json({ keys });
  } catch (error: any) {
    console.error('Error fetching API keys:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getAuthSession(req);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { name, expirationDays } = body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      return NextResponse.json({ error: 'Key name is required' }, { status: 400 });
    }

    // Generate random raw token e.g. or_live_...
    const randomHex = crypto.randomBytes(24).toString('hex');
    const rawKey = `or_live_${randomHex}`;
    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
    const keyLast4 = rawKey.slice(-4);
    const keyId = crypto.randomUUID();

    let expiresAt: number | null = null;
    if (expirationDays && typeof expirationDays === 'number' && expirationDays > 0) {
      expiresAt = Date.now() + expirationDays * 24 * 60 * 60 * 1000;
    }

    await db.insert(userApiKeys).values({
      id: keyId,
      userId: session.user.id,
      name: name.trim(),
      keyHash,
      keyLast4,
      expiresAt: expiresAt ? (process.env.POSTGRES_URL ? expiresAt : expiresAt) : null,
      createdAt: Date.now(),
    });

    return NextResponse.json({
      success: true,
      apiKey: {
        id: keyId,
        name: name.trim(),
        rawKey, // Returned ONLY ONCE to user
        keyLast4,
        expiresAt,
      },
    });
  } catch (error: any) {
    console.error('Error creating API key:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await getAuthSession(req);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Key ID is required' }, { status: 400 });
    }

    await db
      .delete(userApiKeys)
      .where(eq(userApiKeys.id, id));

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error deleting API key:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
