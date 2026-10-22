import { defineConfig } from 'vitest/config'
import owner from './ediel-source-owner-native.config'

// Reuse the owner's strict disposable status boundary, aliases and setup (FINDINGS F79).
export default defineConfig({ ...owner, test: { ...owner.test,
  include: ['scripts/customer-metering-access-native.test.ts'], fileParallelism: false } })
