import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    testTimeout: 30000, // 30 seconds for API tests that involve Docker operations
    hookTimeout: 10000, // 10 seconds for setup/teardown
    globals: true,
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    exclude: ['frontend/**/*'],
    setupFiles: ['./tests/setup.ts'],
  },
});