import { defineConfig } from 'vitest/config'
import owner from './ediel-source-owner-native.config'

// Reality scenario H (the customer leaves): the owner's strict disposable status boundary, aliases and setup.
export default defineConfig({ ...owner, test: { ...owner.test,
  include: ['scripts/customer-leaves-native.test.ts', 'scripts/customer-leaves-z05-native.test.ts'], fileParallelism: false } })
