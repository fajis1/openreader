import { fork, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { SelectedOnnxProvider } from '@openreader/compute-core/onnx-runtime';

type ProviderSelection = {
  workload: 'pdf-layout' | 'whisper';
  provider: Exclude<SelectedOnnxProvider, null>;
};

type IsolatedRequest =
  | {
      kind: 'whisper';
      audioBuffer: ArrayBuffer;
      text: string;
      cacheKey?: string;
      lang?: string;
    }
  | {
      kind: 'pdf-layout';
      documentId: string;
      pdfBytes: ArrayBuffer;
    };

type ChildMessage =
  | { requestId: string; type: 'result'; result: unknown }
  | { requestId: string; type: 'error'; message: string; stack?: string }
  | { requestId: string; type: 'page-started'; pageNumber: number; totalPages: number }
  | { requestId: string; type: 'page-parsed'; pageNumber: number; totalPages: number; pageMs: number }
  | { requestId: string; type: 'provider'; selection: ProviderSelection };

const persistentChildren = new Map<IsolatedRequest['kind'], ChildProcess>();

function spawnInferenceChild(): ChildProcess {
  const childPath = fileURLToPath(new URL('./inference-child.ts', import.meta.url));
  return fork(childPath, [], {
    env: process.env,
    execArgv: ['--import', 'tsx'],
    serialization: 'advanced',
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  });
}

function getInferenceChild(kind: IsolatedRequest['kind'], reuseProcess: boolean): ChildProcess {
  if (!reuseProcess) return spawnInferenceChild();
  const existing = persistentChildren.get(kind);
  if (existing?.connected && !existing.killed) return existing;
  const child = spawnInferenceChild();
  persistentChildren.set(kind, child);
  child.once('exit', () => {
    if (persistentChildren.get(kind) === child) persistentChildren.delete(kind);
  });
  return child;
}

export type IsolatedInference<T> = {
  promise: Promise<T>;
  terminate: () => void;
};

export function startIsolatedInference<T>(input: {
  request: IsolatedRequest;
  onPageStarted?: (progress: { pageNumber: number; totalPages: number }) => void | Promise<void>;
  onPageParsed?: (
    progress: { pageNumber: number; totalPages: number; pageMs: number },
  ) => void | Promise<void>;
  onProviderSelection?: (selection: ProviderSelection) => void | Promise<void>;
  reuseProcess?: boolean;
}): IsolatedInference<T> {
  const reuseProcess = input.reuseProcess === true;
  const child = getInferenceChild(input.request.kind, reuseProcess);
  const requestId = randomUUID();
  let settled = false;
  let terminalReceived = false;
  let terminateRequested = false;

  const promise = new Promise<T>((resolve, reject) => {
    let messageQueue = Promise.resolve();
    const cleanup = () => {
      child.off('message', handleMessage);
      child.off('error', terminateForHandlerFailure);
      child.off('exit', handleExit);
    };
    const terminateForHandlerFailure = (error: unknown) => {
      if (settled) return;
      settled = true;
      terminateRequested = true;
      child.kill('SIGKILL');
      cleanup();
      reject(error);
    };
    const handleMessage = (rawMessage: unknown) => {
      const message = rawMessage as ChildMessage;
      if (message.requestId !== requestId) return;
      if (message.type === 'result' || message.type === 'error') terminalReceived = true;
      messageQueue = messageQueue.then(async () => {
        if (settled) return;
        if (message.type === 'page-started') {
          await input.onPageStarted?.(message);
          return;
        }
        if (message.type === 'page-parsed') {
          await input.onPageParsed?.(message);
          return;
        }
        if (message.type === 'provider') {
          await input.onProviderSelection?.(message.selection);
          return;
        }
        settled = true;
        cleanup();
        if (message.type === 'result') {
          resolve(message.result as T);
        } else {
          const error = new Error(message.message);
          if (message.stack) error.stack = message.stack;
          reject(error);
        }
        if (!reuseProcess && child.connected) child.disconnect();
      }).catch(terminateForHandlerFailure);
    };
    const handleExit = (code: number | null, signal: NodeJS.Signals | null) => {
      if (settled || terminalReceived) return;
      settled = true;
      cleanup();
      reject(new Error(
        terminateRequested
          ? 'Isolated ONNX inference was terminated after timeout.'
          : `Isolated ONNX inference exited unexpectedly (code=${code ?? 'null'}, signal=${signal ?? 'null'}).`,
      ));
    };
    child.on('message', handleMessage);
    child.once('error', terminateForHandlerFailure);
    child.once('exit', handleExit);

    child.send({
      requestId,
      keepAlive: reuseProcess,
      request: input.request,
    }, (error) => {
      if (error) terminateForHandlerFailure(error);
    });
  });

  return {
    promise,
    terminate: () => {
      if (settled || child.killed) return;
      terminateRequested = true;
      child.kill('SIGKILL');
    },
  };
}
