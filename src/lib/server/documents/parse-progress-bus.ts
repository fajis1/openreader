import { InMemoryParseProgressBus } from '@/lib/server/documents/parse-progress-bus.memory';
import type { ParseProgressBus } from '@/lib/server/documents/parse-progress-bus.types';

let busPromise: Promise<ParseProgressBus> | null = null;

export async function getParseProgressBus(): Promise<ParseProgressBus> {
  if (busPromise) return busPromise;
  busPromise = Promise.resolve(new InMemoryParseProgressBus());
  return busPromise;
}

export function __resetParseProgressBusForTests(): void {
  busPromise = null;
}

export type { ParseProgressBus, ParseProgressBusSubscribeInput } from '@/lib/server/documents/parse-progress-bus.types';
