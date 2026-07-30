import * as ort from 'onnxruntime-node';
import { existsSync, readdirSync } from 'node:fs';
import { AsyncLocalStorage } from 'node:async_hooks';

export type OnnxWorkload = 'pdf-layout' | 'whisper';
export type OnnxExecutionProviderMode = 'cpu' | 'cuda' | 'auto';

export interface OnnxExecutionProviderConfig {
  mode: OnnxExecutionProviderMode;
  deviceId: number;
  allowCpuFallback: boolean;
  releaseAfterJob: boolean;
}

export type SelectedOnnxProvider = 'cpu' | 'cuda';
type ProviderObserver = (input: {
  workload: OnnxWorkload;
  provider: SelectedOnnxProvider;
}) => void | Promise<void>;

const providerObservers = new AsyncLocalStorage<ProviderObserver>();
const selectedProviders = new Map<OnnxWorkload, SelectedOnnxProvider>();

export function rememberSelectedOnnxProvider(
  workload: OnnxWorkload,
  provider: SelectedOnnxProvider,
): void {
  if (provider === 'cuda' || !selectedProviders.has(workload)) {
    selectedProviders.set(workload, provider);
  }
}

async function recordSelectedProvider(
  workload: OnnxWorkload,
  provider: SelectedOnnxProvider,
): Promise<void> {
  rememberSelectedOnnxProvider(workload, provider);
  await providerObservers.getStore()?.({ workload, provider });
}

export function getSelectedOnnxProvider(workload: OnnxWorkload): SelectedOnnxProvider | null {
  return selectedProviders.get(workload) ?? null;
}

export function clearSelectedOnnxProvider(workload: OnnxWorkload): void {
  selectedProviders.delete(workload);
}

export async function runWithOnnxProviderObserver<T>(
  observer: ProviderObserver,
  run: () => Promise<T>,
): Promise<T> {
  return await providerObservers.run(observer, run);
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (!value?.trim()) return fallback;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function parseDeviceId(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function parseMode(value: string | undefined): OnnxExecutionProviderMode {
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'cuda' || normalized === 'auto') return normalized;
  return 'cpu';
}

function workloadProviderEnvName(workload: OnnxWorkload): string {
  return workload === 'pdf-layout'
    ? 'PDF_LAYOUT_ONNX_EXECUTION_PROVIDER'
    : 'WHISPER_ONNX_EXECUTION_PROVIDER';
}

export function getOnnxExecutionProviderConfig(workload: OnnxWorkload): OnnxExecutionProviderConfig {
  const workloadMode = process.env[workloadProviderEnvName(workload)];
  const mode = parseMode(workloadMode || process.env.COMPUTE_ONNX_EXECUTION_PROVIDER);
  return {
    mode,
    deviceId: parseDeviceId(process.env.COMPUTE_CUDA_DEVICE_ID),
    // `cuda` is an explicit requirement and must never degrade silently.
    // Use `auto` when a deployment intentionally permits CPU fallback.
    allowCpuFallback: mode === 'auto'
      && parseBoolean(process.env.COMPUTE_CUDA_ALLOW_CPU_FALLBACK, true),
    releaseAfterJob: parseBoolean(process.env.COMPUTE_RELEASE_ONNX_SESSIONS_AFTER_JOB, false),
  };
}

function providersForConfig(
  config: OnnxExecutionProviderConfig,
): ort.InferenceSession.ExecutionProviderConfig[] {
  if (config.mode === 'cpu') return ['cpu'];
  const providers: ort.InferenceSession.ExecutionProviderConfig[] = [
    { name: 'cuda', deviceId: config.deviceId },
  ];
  if (config.allowCpuFallback) providers.push('cpu');
  return providers;
}

function hasVisibleCudaDevice(): boolean {
  if (process.platform !== 'linux') return true;
  // CUDA device ordinals are relative to CUDA_VISIBLE_DEVICES and do not
  // necessarily match the host device-node suffix.
  return existsSync('/dev/nvidiactl')
    && readdirSync('/dev').some((entry) => /^nvidia\d+$/.test(entry));
}

export async function createConfiguredOnnxSession(input: {
  workload: OnnxWorkload;
  modelPath: string;
  sessionOptions: Omit<ort.InferenceSession.SessionOptions, 'executionProviders'>;
}): Promise<ort.InferenceSession> {
  const config = getOnnxExecutionProviderConfig(input.workload);
  const executionProviders = providersForConfig(config);
  const strictCudaOptions = config.mode === 'cuda'
    ? {
      extra: {
        ...input.sessionOptions.extra,
        session: {
          ...((input.sessionOptions.extra?.session as Record<string, unknown> | undefined) ?? {}),
          disable_cpu_ep_fallback: '1',
        },
      },
    }
    : {};

  if (config.mode !== 'cpu' && !hasVisibleCudaDevice()) {
    const deviceError = new Error(
      `${input.workload} requires CUDA device ${config.deviceId}, but its NVIDIA device nodes are not visible.`,
    );
    if (config.mode === 'cuda' || !config.allowCpuFallback) throw deviceError;
    console.warn(`[compute] ${deviceError.message} Using CPU because provider mode is auto.`);
    const session = await ort.InferenceSession.create(input.modelPath, {
      ...input.sessionOptions,
      executionProviders: ['cpu'],
    });
    await recordSelectedProvider(input.workload, 'cpu');
    return session;
  }

  try {
    const session = await ort.InferenceSession.create(input.modelPath, {
      ...input.sessionOptions,
      ...strictCudaOptions,
      executionProviders,
    });
    await recordSelectedProvider(input.workload, config.mode === 'cpu' ? 'cpu' : 'cuda');
    console.info(
      `[compute] ${input.workload} ONNX session initialized with ${config.mode === 'cpu' ? 'CPU' : `CUDA device ${config.deviceId} (CPU operator fallback ${config.allowCpuFallback ? 'enabled' : 'disabled'})`}.`,
    );
    return session;
  } catch (cudaError) {
    if (config.mode !== 'auto' || !config.allowCpuFallback) throw cudaError;

    console.warn(
      `[compute] ${input.workload} CUDA session initialization failed; retrying on CPU.`,
      cudaError,
    );
    const session = await ort.InferenceSession.create(input.modelPath, {
      ...input.sessionOptions,
      executionProviders: ['cpu'],
    });
    await recordSelectedProvider(input.workload, 'cpu');
    return session;
  }
}
