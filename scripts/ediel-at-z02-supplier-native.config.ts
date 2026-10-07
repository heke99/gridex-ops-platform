import { defineConfig } from 'vitest/config'
import ownerConfig from './ediel-source-owner-native.config'

// Keep the existing local-only status, setup and timeouts.
export default defineConfig({ ...ownerConfig, test: { ...ownerConfig.test,
  include: ['scripts/ediel-at-z02-supplier-native.test.ts'],
} })
