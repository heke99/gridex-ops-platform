import {defineConfig} from 'vitest/config'
import ownerConfig from './ediel-source-owner-native.config'

// Reuse the canonical disposable-status guard, aliases and native permissions.
// Replace only suite selection; both existing source pipelines stay unchanged.
export default defineConfig({
  ...ownerConfig,
  test: {
    ...ownerConfig.test,
    include: [
      'scripts/ediel-confirmed-customer-bilateral-native.test.ts',
      'scripts/ediel-requested-customer-change-source-native.test.ts',
      'scripts/ediel-at-z06e-primary-effect-native.test.ts',
    ],
  },
})
