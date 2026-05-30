import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const srcDir = fileURLToPath(new URL('./src/', import.meta.url));
const computeCoreIndex = fileURLToPath(new URL('./compute/core/src/index.ts', import.meta.url));
const computeCoreApiContracts = fileURLToPath(new URL('./compute/core/src/api-contracts/index.ts', import.meta.url));
const computeCoreControlPlane = fileURLToPath(new URL('./compute/core/src/control-plane/index.ts', import.meta.url));
const computeCoreLocalRuntime = fileURLToPath(new URL('./compute/core/src/local-runtime.ts', import.meta.url));
const computeCoreTypes = fileURLToPath(new URL('./compute/core/src/types/index.ts', import.meta.url));
const alias = [
  { find: /^@openreader\/compute-core$/, replacement: computeCoreIndex },
  { find: /^@openreader\/compute-core\/api-contracts$/, replacement: computeCoreApiContracts },
  { find: /^@openreader\/compute-core\/control-plane$/, replacement: computeCoreControlPlane },
  { find: /^@openreader\/compute-core\/local-runtime$/, replacement: computeCoreLocalRuntime },
  { find: /^@openreader\/compute-core\/types$/, replacement: computeCoreTypes },
  { find: /^@\//, replacement: `${srcDir}` },
  { find: '@', replacement: srcDir },
];

export default defineConfig({
  resolve: {
    alias,
  },
  test: {
    alias,
    reporters: process.env.CI ? ['default', 'github'] : ['default'],
    projects: [
      {
        resolve: {
          alias,
        },
        test: {
          name: 'openreader',
          environment: 'node',
          include: ['tests/unit/**/*.vitest.spec.ts'],
        },
      },
      {
        test: {
          name: 'compute-core',
          environment: 'node',
          include: ['compute/core/tests/control-plane/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'compute-worker',
          environment: 'node',
          include: ['compute/worker/tests/{unit,api}/**/*.test.ts'],
          setupFiles: ['compute/worker/tests/setup-env.ts'],
        },
      },
    ],
  },
});
