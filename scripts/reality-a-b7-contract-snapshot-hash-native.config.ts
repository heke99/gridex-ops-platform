import { defineConfig } from 'vitest/config'
import owner from './ediel-source-owner-native.config'

// Reality A-B7: activating a website customer's confirmed switch (contract snapshot_hash from its bound price snapshot).
export default defineConfig({ ...owner, test: { ...owner.test,
  include: ['scripts/reality-a-b7-contract-snapshot-hash-native.test.ts'], fileParallelism: false, testTimeout: 120_000 } })
