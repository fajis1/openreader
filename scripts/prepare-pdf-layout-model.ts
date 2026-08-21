import path from 'node:path';
import { ensureModel } from '../compute/core/src/pdf/model';

async function main() {
  const modelPath = await ensureModel();
  console.log(`PP-DocLayout model assets are ready in ${path.dirname(modelPath)}.`);
}

main().catch((error) => {
  console.error('Failed to prepare PP-DocLayout model assets.', error);
  process.exitCode = 1;
});
