import {defineConfig} from 'vitest/config'
import nativeOwnerConfig from './ediel-source-owner-native.config'

// Supplemental selection only. Preserve the shared localhost/credential guard,
// server aliases, permission setup and native timeouts; ordinary gates remain.
export default defineConfig({
  ...nativeOwnerConfig,
  test:{...nativeOwnerConfig.test,include:['scripts/ediel-sc-054-storage-failure-native.test.ts'],fileParallelism:false},
})
