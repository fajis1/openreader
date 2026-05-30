import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    reporters: process.env.CI ? ['default', 'github'] : ['default'],
    projects: [
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
