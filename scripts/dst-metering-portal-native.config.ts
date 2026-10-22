import { defineConfig } from 'vitest/config'
import owner from './ediel-source-owner-native.config'

// Reuse the owner's strict disposable status boundary, aliases and setup (reality scenario G, DST months).
export default defineConfig({ ...owner, test: { ...owner.test,
  include: ['scripts/dst-metering-portal-native.test.ts'], fileParallelism: false } })
