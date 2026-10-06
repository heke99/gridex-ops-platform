import { defineConfig } from 'vitest/config'
import ownerConfig from './ediel-source-owner-native.config'

// Retain the canonical real-status/loopback guard and all native setup.
// Replace its suite selection rather than merging the owner's include array.
export default defineConfig({
  ...ownerConfig,
  test: {
    ...ownerConfig.test,
    include: ['scripts/ediel-at-z03c-z05c-supplier-native.test.ts'],
  },
})
