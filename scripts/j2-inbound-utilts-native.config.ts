import { defineConfig } from 'vitest/config'
import owner from './ediel-source-owner-native.config'

// Reality scenario J2 (inbound UTILTS: corrections, estimated vs measured values): the owner's strict disposable
// status boundary, aliases and setup.
export default defineConfig({ ...owner, test: { ...owner.test,
  include: ['scripts/j2-inbound-utilts-native.test.ts'], fileParallelism: false, testTimeout: 300_000 } })
