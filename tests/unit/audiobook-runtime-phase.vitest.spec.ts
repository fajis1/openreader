import { describe, expect, test } from 'vitest';

import {
  AUDIOBOOK_WAITING_FOR_GPU_PHASE,
  readAudiobookRuntimeStatus,
  writeAudiobookGpuRuntimeStatus,
} from '../../src/lib/shared/audiobook-runtime-phase';

describe('audiobook runtime GPU phase', () => {
  test.each(['waiting_for_qwen', 'starting_kokoro'] as const)(
    'maps %s to the visible waiting phase while preserving job settings',
    (state) => {
      const settings = writeAudiobookGpuRuntimeStatus({ voice: 'af_heart' }, state, 123);
      expect(settings).toMatchObject({
        voice: 'af_heart',
        runtimePhase: AUDIOBOOK_WAITING_FOR_GPU_PHASE,
        gpuQueueState: state,
        runtimePhaseUpdatedAt: 123,
      });
      expect(readAudiobookRuntimeStatus(settings, 'running')).toEqual({
        phase: AUDIOBOOK_WAITING_FOR_GPU_PHASE,
        gpuQueueState: state,
        updatedAt: 123,
      });
    },
  );

  test.each(['available', 'qwen_active', 'kokoro_active', 'unknown'] as const)(
    'reports %s without showing Waiting for GPU',
    (state) => {
      const settings = writeAudiobookGpuRuntimeStatus({}, state, 456);
      expect(readAudiobookRuntimeStatus(settings, 'running')).toEqual({
        phase: null,
        gpuQueueState: state,
        updatedAt: 456,
      });
    },
  );

  test('clears runtime fields on release and suppresses stale phases for terminal jobs', () => {
    const waiting = writeAudiobookGpuRuntimeStatus('{"format":"m4b"}', 'waiting_for_qwen', 123);
    expect(readAudiobookRuntimeStatus(waiting, 'completed')).toEqual({
      phase: null,
      gpuQueueState: null,
      updatedAt: null,
    });
    expect(writeAudiobookGpuRuntimeStatus(waiting, null, 456)).toEqual({ format: 'm4b' });
  });
});
