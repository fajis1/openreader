import type { ParseProgressEvent } from '@/lib/server/documents/parse-progress-events';

export interface ParseProgressBusSubscribeInput {
  documentId: string;
  userIdHashes: Set<string>;
  onEvent: (event: ParseProgressEvent) => void | Promise<void>;
  onError?: (error: unknown) => void;
}

export interface ParseProgressBus {
  readonly kind: 'memory';
  publish(event: ParseProgressEvent): Promise<void>;
  subscribe(input: ParseProgressBusSubscribeInput): Promise<() => void>;
}
