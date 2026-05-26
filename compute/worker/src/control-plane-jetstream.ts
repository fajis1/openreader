import { createHash } from 'node:crypto';
import type { JetStreamClient } from '@nats-io/jetstream';
import type {
  OperationEvent,
  OperationEventStream,
  OperationQueue,
  OperationState,
  OperationStateStore,
  QueuedOperation,
} from '@openreader/compute-core/control-plane';
import type {
  PdfLayoutJobRequest,
  WhisperAlignJobRequest,
  WorkerOperationKind,
} from '@openreader/compute-core/api-contracts';

export interface KvEntryLike {
  operation?: string;
  value: Uint8Array;
  revision: number;
}

export interface KvStoreLike {
  get(key: string): Promise<KvEntryLike | null>;
  put(key: string, data: Uint8Array): Promise<unknown>;
  create(key: string, data: Uint8Array): Promise<unknown>;
  update(key: string, data: Uint8Array, version: number): Promise<unknown>;
}

type JsonCodec<T> = {
  encode(value: T): Uint8Array;
  decode(data: Uint8Array): T;
};

function createJsonCodec<T>(): JsonCodec<T> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  return {
    encode(value: T): Uint8Array {
      return encoder.encode(JSON.stringify(value));
    },
    decode(data: Uint8Array): T {
      return JSON.parse(decoder.decode(data)) as T;
    },
  };
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}

function isCasConflictError(error: unknown): boolean {
  const message = toErrorMessage(error).toLowerCase();
  return message.includes('wrong last sequence') || message.includes('key exists') || message.includes('wrong last');
}

function isPut(entry: KvEntryLike | null): entry is KvEntryLike {
  return Boolean(entry && entry.operation === 'PUT');
}

interface OpIndexEntry {
  opId: string;
}

const OP_EVENTS_SUBJECT_PREFIX = 'ops.events';

export function hashOpKey(opKey: string): string {
  return createHash('sha256').update(opKey).digest('hex');
}

export function opIndexKvKey(opKey: string): string {
  return `op_index.${hashOpKey(opKey)}`;
}

export function opStateKvKey(opId: string): string {
  return `op_state.${opId}`;
}

export function opEventsSubject(opId: string): string {
  return `${OP_EVENTS_SUBJECT_PREFIX}.${opId}`;
}

export interface JetStreamOperationStateStoreDeps {
  getKv: () => Promise<KvStoreLike>;
}

export class JetStreamOperationStateStore<Result = unknown> implements OperationStateStore<Result> {
  private readonly getKv: () => Promise<KvStoreLike>;
  private readonly opStateCodec = createJsonCodec<OperationState<Result>>();
  private readonly opIndexCodec = createJsonCodec<OpIndexEntry>();

  constructor(deps: JetStreamOperationStateStoreDeps) {
    this.getKv = deps.getKv;
  }

  async getOpState(opId: string): Promise<OperationState<Result> | null> {
    const kv = await this.getKv();
    const entry = await kv.get(opStateKvKey(opId));
    if (!isPut(entry)) return null;
    return this.opStateCodec.decode(entry.value);
  }

  async putOpState(state: OperationState<Result>): Promise<void> {
    const kv = await this.getKv();
    await kv.put(opStateKvKey(state.opId), this.opStateCodec.encode(state));
  }

  async getOpIndex(opKey: string): Promise<{ opId: string } | null> {
    const kv = await this.getKv();
    const entry = await kv.get(opIndexKvKey(opKey));
    if (!isPut(entry)) return null;
    return this.opIndexCodec.decode(entry.value);
  }

  async compareAndSetOpIndex(input: {
    opKey: string;
    newOpId: string;
    expectedOpId: string | null;
  }): Promise<boolean> {
    const kv = await this.getKv();
    const key = opIndexKvKey(input.opKey);
    const value = this.opIndexCodec.encode({ opId: input.newOpId });

    if (input.expectedOpId === null) {
      try {
        await kv.create(key, value);
        return true;
      } catch (error) {
        if (isCasConflictError(error)) return false;
        throw error;
      }
    }

    const current = await kv.get(key);
    if (!isPut(current)) return false;
    const decoded = this.opIndexCodec.decode(current.value);
    if (decoded.opId !== input.expectedOpId) return false;

    try {
      await kv.update(key, value, current.revision);
      return true;
    } catch (error) {
      if (isCasConflictError(error)) return false;
      throw error;
    }
  }
}

export interface JetStreamOperationEventStreamDeps {
  getJs: () => Promise<Pick<JetStreamClient, 'publish'>>;
}

export class JetStreamOperationEventStream<Result = unknown> implements OperationEventStream<Result> {
  private readonly getJs: () => Promise<Pick<JetStreamClient, 'publish'>>;

  constructor(deps: JetStreamOperationEventStreamDeps) {
    this.getJs = deps.getJs;
  }

  async append(opId: string, snapshot: OperationState<Result>): Promise<OperationEvent<Result>> {
    const js = await this.getJs();
    const encoder = new TextEncoder();
    const ack = await js.publish(opEventsSubject(opId), encoder.encode(JSON.stringify(snapshot)));
    return {
      eventId: ack.seq,
      snapshot,
    };
  }

  async listSince(): Promise<OperationEvent<Result>[]> {
    return [];
  }

  async subscribe(): Promise<() => void> {
    return () => undefined;
  }
}

export interface JetStreamOperationQueueDeps<TPayload> {
  getJs: () => Promise<Pick<JetStreamClient, 'publish'>>;
  whisperSubject: string;
  layoutSubject: string;
  onEnqueued?: (job: QueuedOperation<TPayload>) => Promise<void> | void;
}

export class JetStreamOperationQueue implements OperationQueue<WhisperAlignJobRequest | PdfLayoutJobRequest> {
  private readonly getJs: () => Promise<Pick<JetStreamClient, 'publish'>>;
  private readonly whisperSubject: string;
  private readonly layoutSubject: string;
  private readonly onEnqueued?: (job: QueuedOperation<WhisperAlignJobRequest | PdfLayoutJobRequest>) => Promise<void> | void;
  private readonly whisperCodec = createJsonCodec<QueuedOperation<WhisperAlignJobRequest>>();
  private readonly layoutCodec = createJsonCodec<QueuedOperation<PdfLayoutJobRequest>>();

  constructor(deps: JetStreamOperationQueueDeps<WhisperAlignJobRequest | PdfLayoutJobRequest>) {
    this.getJs = deps.getJs;
    this.whisperSubject = deps.whisperSubject;
    this.layoutSubject = deps.layoutSubject;
    this.onEnqueued = deps.onEnqueued;
  }

  async enqueue(job: QueuedOperation<WhisperAlignJobRequest | PdfLayoutJobRequest>): Promise<void> {
    const js = await this.getJs();
    if (job.kind === 'whisper_align') {
      await js.publish(
        this.whisperSubject,
        this.whisperCodec.encode(job as QueuedOperation<WhisperAlignJobRequest>),
      );
    } else if (job.kind === 'pdf_layout') {
      await js.publish(
        this.layoutSubject,
        this.layoutCodec.encode(job as QueuedOperation<PdfLayoutJobRequest>),
      );
    } else {
      const exhaustive: never = job.kind;
      throw new Error(`Unsupported operation kind: ${String(exhaustive)}`);
    }

    await this.onEnqueued?.(job);
  }

  async claimNext(_kind: WorkerOperationKind): Promise<QueuedOperation<WhisperAlignJobRequest | PdfLayoutJobRequest> | null> {
    throw new Error('JetStreamOperationQueue.claimNext is not used by the worker runtime');
  }

  size(): number {
    return 0;
  }
}
