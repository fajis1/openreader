import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { errorResponse } from '@/lib/server/errors/next-response';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const { message } = await req.json();
    const logPath = path.join(process.cwd(), 'batch_logs.txt');
    await fs.appendFile(logPath, message + '\n');
    return NextResponse.json({ success: true });
  } catch (error) {
    return errorResponse(error, { apiErrorMessage: String(error) });
  }
}
