import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const srcDir = fileURLToPath(new URL('./src/', import.meta.url));
const alias = [
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
