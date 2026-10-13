import { defineConfig } from 'vitest/config'
import ownerConfig from './ediel-source-owner-native.config'

// Import the current owner gates unchanged: local status/backend, aliases,
// catalog setup, serialization and timeouts. The serial owner selects the run.
export default defineConfig({ ...ownerConfig, test: { ...ownerConfig.test,
  include: [...(ownerConfig.test?.include ?? []), 'scripts/ediel-at-z03l-z03lk-supplier-ack-join-native.test.ts'],
} })
