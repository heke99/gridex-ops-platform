import { defineConfig } from 'vitest/config'
import ownerConfig from './ediel-source-owner-native.config'

// claude-track3/017: committing readers suite on the owned local stack only
// (the owner config refuses hosted/missing CLI status).
export default defineConfig({
  ...ownerConfig,
  test: {
    ...ownerConfig.test,
    include: ['scripts/ediel-utilts-series-current-readers-native.test.ts'],
    testTimeout: 600_000,
    hookTimeout: 120_000,
    fileParallelism: false,
    maxWorkers: 1,
  },
})
