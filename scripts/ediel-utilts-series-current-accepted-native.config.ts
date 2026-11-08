import { defineConfig } from 'vitest/config'
import ownerConfig from './ediel-source-owner-native.config'

// claude-track3/017: the existing config reads actual local CLI status and
// refuses hosted/missing status. The test itself runs only in rolled-back
// transactions against the owned local stack.
export default defineConfig({
  ...ownerConfig,
  test: {
    ...ownerConfig.test,
    include: ['scripts/ediel-utilts-series-current-accepted-native.test.ts'],
    testTimeout: 300_000,
    hookTimeout: 120_000,
    fileParallelism: false,
    maxWorkers: 1,
    // No permission-catalog setup: this suite never commits a stack write.
    setupFiles: [],
  },
})
