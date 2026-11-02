import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/domain/**/*.test.ts', 'tests/tooling/**/*.test.ts'],
    setupFiles: ['tests/deny-network.ts'],
    environment: 'node',
    // Native NTFS ACL validation launches Windows PowerShell. Bound both the
    // subprocess concurrency and the longer integration-test wall time.
    ...(process.platform === 'win32'
      ? { maxWorkers: 4, testTimeout: 30_000 }
      : { testTimeout: 10_000 }),
  },
});
