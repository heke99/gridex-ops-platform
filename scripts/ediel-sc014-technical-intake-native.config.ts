import { defineConfig } from 'vitest/config'
import ownerConfig from './ediel-source-owner-native.config'

// The existing config reads actual local CLI status, refuses hosted/missing
// status and installs only the explicit native permission catalog fixture.
export default defineConfig({
  ...ownerConfig,
  test: {
    ...ownerConfig.test,
    include: ['scripts/ediel-sc014-technical-intake-native.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    fileParallelism: false,
    maxWorkers: 1,
  },
})
