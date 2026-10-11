import { defineConfig } from 'vitest/config'
import native from './ediel-source-owner-native.config'

// Retain the shared local-stack/status, alias, catalog and serial execution
// guards. This wrapper registers only the P-08 packet without editing its owner.
export default defineConfig({ ...native, test: { ...native.test,
  include: ['scripts/ediel-p-08-production-contract-native.test.ts'], fileParallelism: false } })
