import { defineConfig } from 'vitest/config'
import ownerConfig from './ediel-source-owner-native.config'

// claude-track3/005: the existing config reads actual local CLI status and
// refuses hosted/missing status. The test itself runs only in rolled-back
// transactions against the owned local stack.
export default defineConfig({
  ...ownerConfig,
  test: {
    ...ownerConfig.test,
    include: ['scripts/ediel-contrl-retained-source-scaling-native.test.ts'],
    testTimeout: 300_000,
    hookTimeout: 120_000,
    fileParallelism: false,
    maxWorkers: 1,
  },
})
