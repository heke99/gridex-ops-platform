import { defineConfig } from 'vitest/config'
import owner from './ediel-source-owner-native.config'

// Reuse the owner's strict disposable status boundary, aliases and setup.
// No shared producer, permission catalog, fixture or ordinary gate is changed.
export default defineConfig({ ...owner, test: { ...owner.test,
  include: ['scripts/one-off-offer-binding-native.test.ts'], fileParallelism: false } })
