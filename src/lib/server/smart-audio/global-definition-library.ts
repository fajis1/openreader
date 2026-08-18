import { db } from '@/db';
import { adminSettings } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { normalizeDictionaryDefinition } from '@/lib/shared/dictionary-definition-policy';

const GLOBAL_DEFINITIONS_KEY = 'global_definitions';

export function normalizeGlobalDefinitions(value: unknown): Record<string, string> {
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

export type GlobalDefinitionImportPreview = {
  definitions: Record<string, string>;
  validDefinitions: number;
  issues: Array<{ term: string; reason: string }>;
};

export function previewGlobalDefinitionImport(value: unknown): GlobalDefinitionImportPreview {
  if (value === undefined || value === null) {
    return { definitions: {}, validDefinitions: 0, issues: [] };
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    return {
      definitions: {},
      validDefinitions: 0,
      issues: [{ term: '', reason: 'Definitions must be an object keyed by term.' }],
    };
  }
  const definitions: Record<string, string> = {};
  const issues: Array<{ term: string; reason: string }> = [];
  for (const [rawTerm, rawDefinition] of Object.entries(value as Record<string, unknown>)) {
    const term = rawTerm.trim();
    if (!term) {
      issues.push({ term: rawTerm, reason: 'Term is blank.' });
      continue;
    }
    const definition = normalizeDictionaryDefinition(
      typeof rawDefinition === 'object' && rawDefinition !== null && 'definition' in rawDefinition
        ? (rawDefinition as { definition?: unknown }).definition
        : rawDefinition,
    );
    if (!definition) {
      issues.push({ term, reason: 'Definition is empty or an unusable placeholder.' });
      continue;
    }
    definitions[term] = definition;
  }
  return { definitions, validDefinitions: Object.keys(definitions).length, issues };
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
  const updates = Object.entries(definitions).flatMap(([term, value]) => (
    value === undefined ? [] : [[term, normalizeDictionaryDefinition(value)] as const]
  ));
  if (updates.length === 0) return [];

  const applyUpdates = (current: Record<string, string>) => {
    for (const [term, definition] of updates) {
      if (definition) current[term] = definition;
      else delete current[term];
    }
    return current;
  };

  if (process.env.POSTGRES_URL) {
    return db.transaction(async (tx: typeof db) => {
      const rows = await tx.select({ valueJson: adminSettings.valueJson })
        .from(adminSettings)
        .where(eq(adminSettings.key, GLOBAL_DEFINITIONS_KEY))
        .limit(1);
      const current = applyUpdates(normalizeGlobalDefinitions(rows[0]?.valueJson || {}));
      await tx.insert(adminSettings).values({
        key: GLOBAL_DEFINITIONS_KEY,
        valueJson: JSON.stringify(current),
      }).onConflictDoUpdate({
        target: adminSettings.key,
        set: { valueJson: JSON.stringify(current) },
      });
      return updates.map(([term]) => term);
    });
  }

  return db.transaction((tx: typeof db) => {
    const rows = tx.select({ valueJson: adminSettings.valueJson })
      .from(adminSettings)
      .where(eq(adminSettings.key, GLOBAL_DEFINITIONS_KEY))
      .limit(1)
      .all();
    const current = applyUpdates(normalizeGlobalDefinitions(rows[0]?.valueJson || {}));
    tx.insert(adminSettings).values({
      key: GLOBAL_DEFINITIONS_KEY,
      valueJson: JSON.stringify(current),
    }).onConflictDoUpdate({
      target: adminSettings.key,
      set: { valueJson: JSON.stringify(current) },
    }).run();
    return updates.map(([term]) => term);
  });
}
