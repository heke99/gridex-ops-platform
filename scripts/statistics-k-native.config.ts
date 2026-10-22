import { defineConfig } from 'vitest/config'
import owner from './ediel-source-owner-native.config'

// Reality scenario K (statistics): the owner's strict disposable status boundary, aliases and setup.
export default defineConfig({ ...owner, test: { ...owner.test,
  include: ['scripts/statistics-k-native.test.ts'], fileParallelism: false } })
