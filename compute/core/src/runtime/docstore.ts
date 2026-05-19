import path from 'path';

export const DOCSTORE_DIR = process.env.COMPUTE_DOCSTORE_DIR?.trim() || path.join(process.cwd(), 'docstore');

export function getDocstoreDir(): string {
  return DOCSTORE_DIR;
}
