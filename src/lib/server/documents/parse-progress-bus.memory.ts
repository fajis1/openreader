import { EventEmitter } from 'node:events';
import type { ParseProgressBus, ParseProgressBusSubscribeInput } from '@/lib/server/documents/parse-progress-bus.types';
import type { ParseProgressEvent } from '@/lib/server/documents/parse-progress-events';

type Listener = (event: ParseProgressEvent) => void;

function topicForDocument(documentId: string): string {
  return `parse-progress.${documentId}`;
}

export class InMemoryParseProgressBus implements ParseProgressBus {
  readonly kind = 'memory' as const;
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(0);
  }

  async publish(event: ParseProgressEvent): Promise<void> {
    this.emitter.emit(topicForDocument(event.documentId), event);
  }

  async subscribe(input: ParseProgressBusSubscribeInput): Promise<() => void> {
    const listener: Listener = (event) => {
      if (!input.userIdHashes.has(event.userIdHash)) return;
      Promise.resolve(input.onEvent(event)).catch((error) => {
        input.onError?.(error);
      });
    };
    const topic = topicForDocument(input.documentId);
    this.emitter.on(topic, listener);
    return () => {
      this.emitter.off(topic, listener);
    };
  }
}
