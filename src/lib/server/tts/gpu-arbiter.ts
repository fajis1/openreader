import { isKokoroModel } from '@/lib/shared/kokoro';
import type { GpuArbiterState } from '@/lib/shared/audiobook-runtime-phase';

export interface GpuArbiterStatus {
  state: GpuArbiterState;
  holder?: string;
  requestedBy?: string;
  queuePosition?: number;
  message?: string;
  retryAfterMs?: number;
}

export interface GpuArbiterConfig {
  statusUrl: string;
  pollIntervalMs: number;
  requestTimeoutMs: number;
}

export interface GpuQueueRequestIdentity {
  provider: string;
  model?: string | null;
}

interface ObserveGpuQueueOptions<T> {
  request: GpuQueueRequestIdentity;
  operation: (signal: AbortSignal) => Promise<T>;
  signal?: AbortSignal;
  onStatus?: (status: GpuArbiterStatus | null) => void | Promise<void>;
  config?: GpuArbiterConfig | null;
  fetchImpl?: typeof fetch;
}

const KNOWN_GPU_STATES = new Set<GpuArbiterState>([
  'available',
  'waiting_for_qwen',
  'starting_kokoro',
  'qwen_active',
  'kokoro_active',
  'unknown',
]);

const DEFAULT_POLL_INTERVAL_MS = 1_500;
const DEFAULT_REQUEST_TIMEOUT_MS = 2_000;
const MIN_POLL_INTERVAL_MS = 1_000;
const MAX_POLL_INTERVAL_MS = 2_000;

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function optionalNonNegativeInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : undefined;
}

function optionalPositiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : undefined;
}

export function parseGpuArbiterStatus(value: unknown): GpuArbiterStatus | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.state !== 'string') return null;

  const state = KNOWN_GPU_STATES.has(record.state as GpuArbiterState)
    ? record.state as GpuArbiterState
    : 'unknown';

  return {
    state,
    ...(optionalString(record.holder) ? { holder: optionalString(record.holder) } : {}),
    ...(optionalString(record.requestedBy) ? { requestedBy: optionalString(record.requestedBy) } : {}),
    ...(optionalNonNegativeInteger(record.queuePosition) !== undefined
      ? { queuePosition: optionalNonNegativeInteger(record.queuePosition) }
      : {}),
    ...(optionalString(record.message) ? { message: optionalString(record.message) } : {}),
    ...(optionalPositiveInteger(record.retryAfterMs) !== undefined
      ? { retryAfterMs: optionalPositiveInteger(record.retryAfterMs) }
      : {}),
  };
}

function envEnabled(value: string | undefined): boolean {
  return ['1', 'true', 'yes', 'on'].includes(value?.trim().toLowerCase() || '');
}

export function getGpuArbiterConfig(
  environment: Record<string, string | undefined> = process.env,
): GpuArbiterConfig | null {
  if (!envEnabled(environment.GPU_QUEUE_STATUS_ENABLED)) return null;
  const rawUrl = environment.GPU_ARBITER_STATUS_URL?.trim();
  if (!rawUrl) return null;

  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return {
      statusUrl: url.toString(),
      pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
      requestTimeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
    };
  } catch {
    return null;
  }
}

export function shouldObserveGpuQueue(
  request: GpuQueueRequestIdentity,
  config: GpuArbiterConfig | null = getGpuArbiterConfig(),
): boolean {
  return Boolean(
    config
    && request.provider === 'custom-openai'
    && isKokoroModel(request.model || undefined),
  );
}

function abortError(): DOMException {
  return new DOMException('The operation was aborted.', 'AbortError');
}

function abortRejection(signal: AbortSignal): {
  promise: Promise<never>;
  cleanup: () => void;
} {
  let onAbort = () => {};
  const promise = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(abortError());
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
  });
  return {
    promise,
    cleanup: () => signal.removeEventListener('abort', onAbort),
  };
}

function sleepWithSignal(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      reject(abortError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function boundedPollInterval(status: GpuArbiterStatus, fallback: number): number {
  const requested = status.retryAfterMs ?? fallback;
  return Math.max(MIN_POLL_INTERVAL_MS, Math.min(MAX_POLL_INTERVAL_MS, requested));
}

async function fetchGpuArbiterStatus(
  config: GpuArbiterConfig,
  fetchImpl: typeof fetch,
  parentSignal: AbortSignal,
): Promise<GpuArbiterStatus | null> {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  parentSignal.addEventListener('abort', onAbort, { once: true });
  const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);
  try {
    const response = await fetchImpl(config.statusUrl, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!response.ok) return null;
    return parseGpuArbiterStatus(await response.json());
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
    parentSignal.removeEventListener('abort', onAbort);
  }
}

/**
 * Runs a real TTS request while observing the optional arbiter endpoint.
 * Arbiter transport/schema failures are advisory and never fail the operation.
 */
export async function runWithGpuQueueStatus<T>(
  options: ObserveGpuQueueOptions<T>,
): Promise<T> {
  const config = options.config === undefined ? getGpuArbiterConfig() : options.config;
  const operationController = new AbortController();
  const onExternalAbort = () => operationController.abort();
  if (options.signal?.aborted) operationController.abort();
  options.signal?.addEventListener('abort', onExternalAbort, { once: true });

  if (!shouldObserveGpuQueue(options.request, config)) {
    const aborted = abortRejection(operationController.signal);
    try {
      return await Promise.race([
        options.operation(operationController.signal),
        aborted.promise,
      ]);
    } finally {
      aborted.cleanup();
      options.signal?.removeEventListener('abort', onExternalAbort);
    }
  }

  const monitorController = new AbortController();
  let operationSettled = false;
  let monitorError: unknown = null;
  const operationPromise = options.operation(operationController.signal)
    .finally(() => { operationSettled = true; });
  const aborted = abortRejection(operationController.signal);

  const monitorPromise = (async () => {
    while (!operationSettled && !monitorController.signal.aborted) {
      const status = await fetchGpuArbiterStatus(
        config!,
        options.fetchImpl || fetch,
        monitorController.signal,
      );
      if (monitorController.signal.aborted || operationSettled) return;
      if (!status) {
        try {
          await options.onStatus?.(null);
        } catch (error) {
          monitorError = error;
          operationController.abort();
        }
        return;
      }
      try {
        await options.onStatus?.(status);
      } catch (error) {
        monitorError = error;
        operationController.abort();
        return;
      }
      if (operationSettled) return;
      try {
        await sleepWithSignal(
          boundedPollInterval(status, config!.pollIntervalMs),
          monitorController.signal,
        );
      } catch {
        return;
      }
    }
  })();

  try {
    const result = await Promise.race([operationPromise, aborted.promise]);
    if (monitorError) throw monitorError;
    return result;
  } catch (error) {
    if (monitorError) throw monitorError;
    throw error;
  } finally {
    monitorController.abort();
    aborted.cleanup();
    operationController.abort();
    options.signal?.removeEventListener('abort', onExternalAbort);
    await monitorPromise.catch(() => {});
    try {
      await options.onStatus?.(null);
    } catch {
      // Runtime-status cleanup is best effort after the operation has stopped.
    }
  }
}
