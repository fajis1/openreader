import { randomUUID } from 'crypto';

// In development, Next.js can hot-reload and clear memory, so we store it in globalThis
const globalSecret = globalThis as unknown as { __internal_worker_secret?: string };

if (!globalSecret.__internal_worker_secret) {
  globalSecret.__internal_worker_secret = process.env.INTERNAL_WORKER_SECRET || randomUUID();
}

export const INTERNAL_WORKER_SECRET = globalSecret.__internal_worker_secret;
