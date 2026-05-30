export function isAbortLikeError(error: unknown): boolean {
  if (!error) return false;
  if (error instanceof DOMException) return error.name === 'AbortError';
  if (error instanceof Error) return error.name === 'AbortError' || error.message === 'This operation was aborted';
  if (typeof error === 'object' && error !== null && 'name' in error) {
    return (error as { name?: unknown }).name === 'AbortError';
  }
  return false;
}
