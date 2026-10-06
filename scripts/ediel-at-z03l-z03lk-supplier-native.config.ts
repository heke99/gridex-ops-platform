import { defineConfig } from 'vitest/config'
import ownerConfig from './ediel-source-owner-native.config'

// Preserve actual native status/loopback guards and registered setup.
// This selector changes only the suite include, without modifying the owner config.
export default defineConfig({
  ...ownerConfig,
  test: {
    ...ownerConfig.test,
    include: ['scripts/ediel-at-z03l-z03lk-supplier-native.test.ts'],
  },
})
