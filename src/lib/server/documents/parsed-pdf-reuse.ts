import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { documents } from '@/db/schema';
import {
  normalizeDocumentParseStateForCurrentParserVersion,
  parseDocumentParseState,
} from '@/lib/server/documents/parse-state';

type ReadyParsedPdfResult = {
  parsedJsonKey: string;
};

export async function findReusableParsedPdfResult(
  documentId: string,
): Promise<ReadyParsedPdfResult | null> {
  const rows = await db
    .select({
      parseState: documents.parseState,
      parsedJsonKey: documents.parsedJsonKey,
    })
    .from(documents)
    .where(eq(documents.id, documentId));

  for (const row of rows) {
    const parsedJsonKey = row.parsedJsonKey?.trim();
    if (!parsedJsonKey) continue;
    const parseState = normalizeDocumentParseStateForCurrentParserVersion(parseDocumentParseState(row.parseState));
    if (parseState.status !== 'ready') continue;
    return { parsedJsonKey };
  }

  return null;
}
