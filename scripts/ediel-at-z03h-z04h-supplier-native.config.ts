import { defineConfig } from 'vitest/config'
import ownerConfig from './ediel-source-owner-native.config'

// Preserve the existing local-only status, setup and timeouts.
export default defineConfig({ ...ownerConfig, test: { ...ownerConfig.test,
  include: ['scripts/ediel-at-z03h-z04h-supplier-native.test.ts'],
} })
