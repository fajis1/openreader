export const AUDIOBOOK_WAITING_FOR_GPU_PHASE = 'waiting_for_gpu' as const;

export const GPU_ARBITER_STATES = [
  'available',
  'waiting_for_qwen',
  'starting_kokoro',
  'qwen_active',
  'kokoro_active',
  'unknown',
] as const;

export type GpuArbiterState = typeof GPU_ARBITER_STATES[number];
export type AudiobookRuntimePhase = typeof AUDIOBOOK_WAITING_FOR_GPU_PHASE;

export interface AudiobookRuntimeStatus {
  phase: AudiobookRuntimePhase | null;
  gpuQueueState: GpuArbiterState | null;
  updatedAt: number | null;
}

function settingsRecord(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : {};
    } catch {
      return {};
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function isGpuArbiterState(value: unknown): value is GpuArbiterState {
  return typeof value === 'string'
    && (GPU_ARBITER_STATES as readonly string[]).includes(value);
}

export function readAudiobookRuntimeStatus(
  settingsJson: unknown,
  jobStatus = 'running',
): AudiobookRuntimeStatus {
  if (jobStatus !== 'running') {
    return { phase: null, gpuQueueState: null, updatedAt: null };
  }

  const settings = settingsRecord(settingsJson);
  const phase = settings.runtimePhase === AUDIOBOOK_WAITING_FOR_GPU_PHASE
    ? AUDIOBOOK_WAITING_FOR_GPU_PHASE
    : null;
  const gpuQueueState = isGpuArbiterState(settings.gpuQueueState)
    ? settings.gpuQueueState
    : null;
  const updatedAt = typeof settings.runtimePhaseUpdatedAt === 'number'
    && Number.isFinite(settings.runtimePhaseUpdatedAt)
    ? settings.runtimePhaseUpdatedAt
    : null;

  return { phase, gpuQueueState, updatedAt };
}

export function writeAudiobookGpuRuntimeStatus(
  settingsJson: unknown,
  state: GpuArbiterState | null,
  updatedAt = Date.now(),
): Record<string, unknown> {
  const settings = { ...settingsRecord(settingsJson) };

  if (state === null) {
    delete settings.runtimePhase;
    delete settings.gpuQueueState;
    delete settings.runtimePhaseUpdatedAt;
    return settings;
  }

  settings.gpuQueueState = state;
  settings.runtimePhaseUpdatedAt = updatedAt;
  if (state === 'waiting_for_qwen' || state === 'starting_kokoro') {
    settings.runtimePhase = AUDIOBOOK_WAITING_FOR_GPU_PHASE;
  } else {
    delete settings.runtimePhase;
  }
  return settings;
}
