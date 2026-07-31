export async function runWithCudaOomCpuFallback<T>(input: {
  enabled: boolean;
  isCudaOutOfMemory: (error: unknown) => boolean;
  runCuda: () => Promise<T>;
  releaseGpuLease: () => Promise<void>;
  beforeCpuRetry?: (error: unknown) => void | Promise<void>;
  runCpu: () => Promise<T>;
}): Promise<T> {
  try {
    return await input.runCuda();
  } catch (error) {
    if (!input.enabled || !input.isCudaOutOfMemory(error)) throw error;
    await input.beforeCpuRetry?.(error);
    // The isolated CUDA child has already been terminated by the workload
    // runner at this point. Release the cooperative lease before starting the
    // potentially long CPU retry so unrelated GPU services can proceed.
    await input.releaseGpuLease();
    return await input.runCpu();
  }
}
