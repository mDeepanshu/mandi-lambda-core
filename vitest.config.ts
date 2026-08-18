import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/api/**/*.test.ts'],
    // All money tests assert deltas on the same TEST_ party rows — never parallelize.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    globalSetup: 'tests/api/global-setup.ts',
  },
});
