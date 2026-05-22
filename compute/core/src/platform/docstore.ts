import path from 'path';

export const DOCSTORE_DIR = path.join(process.cwd(), 'docstore');

export function getDocstoreDir(): string {
  return DOCSTORE_DIR;
}
