export type EnvPatch = Record<string, string | undefined>;

export function captureEnv(keys: readonly string[]): EnvPatch {
  const snapshot: EnvPatch = {};
  for (const key of keys) {
    snapshot[key] = process.env[key];
  }
  return snapshot;
}

export function restoreEnv(snapshot: EnvPatch): void {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

export async function withEnv<T>(patch: EnvPatch, run: () => T | Promise<T>): Promise<T> {
  const keys = Object.keys(patch);
  const snapshot = captureEnv(keys);
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await run();
  } finally {
    restoreEnv(snapshot);
  }
}
