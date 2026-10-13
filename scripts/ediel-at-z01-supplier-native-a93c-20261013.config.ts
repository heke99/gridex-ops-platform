import { defineConfig } from 'vitest/config'
import ownerConfig from './ediel-source-owner-native.config'

// Import-only inheritance preserves local backend, permissions, aliases,
// serial execution and timeouts. This supplement needs owner-routed execution.
export default defineConfig({ ...ownerConfig, test: { ...ownerConfig.test,
  include: ['scripts/ediel-at-z01-supplier-native-a93c-20261013.test.ts'],
} })
