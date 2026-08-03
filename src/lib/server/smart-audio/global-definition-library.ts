import { db } from '@/db';
import { adminSettings } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { normalizeDictionaryDefinition } from '@/lib/shared/dictionary-definition-policy';

const GLOBAL_DEFINITIONS_KEY = 'global_definitions';

function normalizeGlobalDefinitions(value: unknown): Record<string, string> {
  const parsed = typeof value === 'string' ? JSON.parse(value) : value;
  if (!parsed || typeof parsed !== 'object') return {};
  return Object.fromEntries(
    Object.entries(parsed as Record<string, unknown>).flatMap(([term, raw]) => {
      const definition = normalizeDictionaryDefinition(
        typeof raw === 'object' && raw !== null && 'definition' in raw
          ? (raw as { definition?: unknown }).definition
          : raw,
      );
      return definition ? [[term, definition]] : [];
    }),
  );
}

export async function readGlobalDefinitions(): Promise<Record<string, string>> {
  const rows = await db.select({ valueJson: adminSettings.valueJson })
    .from(adminSettings)
    .where(eq(adminSettings.key, GLOBAL_DEFINITIONS_KEY))
    .limit(1);
  try {
    return normalizeGlobalDefinitions(rows[0]?.valueJson || {});
  } catch {
    return {};
  }
}

export async function mergeGlobalDefinitions(
  definitions: Record<string, string | null | undefined>,
): Promise<string[]> {
  const additions = Object.fromEntries(
    Object.entries(definitions).flatMap(([term, value]) => {
      const definition = normalizeDictionaryDefinition(value);
      return definition ? [[term, definition]] : [];
    }),
  );
  if (Object.keys(additions).length === 0) return [];

  if (process.env.POSTGRES_URL) {
    return db.transaction(async (tx: typeof db) => {
      const rows = await tx.select({ valueJson: adminSettings.valueJson })
        .from(adminSettings)
        .where(eq(adminSettings.key, GLOBAL_DEFINITIONS_KEY))
        .limit(1);
      const current = normalizeGlobalDefinitions(rows[0]?.valueJson || {});
      Object.assign(current, additions);
      await tx.insert(adminSettings).values({
        key: GLOBAL_DEFINITIONS_KEY,
        valueJson: JSON.stringify(current),
      }).onConflictDoUpdate({
        target: adminSettings.key,
        set: { valueJson: JSON.stringify(current) },
      });
      return Object.keys(additions);
    });
  }

  return db.transaction((tx: typeof db) => {
    const rows = tx.select({ valueJson: adminSettings.valueJson })
      .from(adminSettings)
      .where(eq(adminSettings.key, GLOBAL_DEFINITIONS_KEY))
      .limit(1)
      .all();
    const current = normalizeGlobalDefinitions(rows[0]?.valueJson || {});
    Object.assign(current, additions);
    tx.insert(adminSettings).values({
      key: GLOBAL_DEFINITIONS_KEY,
      valueJson: JSON.stringify(current),
    }).onConflictDoUpdate({
      target: adminSettings.key,
      set: { valueJson: JSON.stringify(current) },
    }).run();
    return Object.keys(additions);
  });
}
