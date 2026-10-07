import {defineConfig} from 'vitest/config'
import ownerConfig from './ediel-source-owner-native.config'

// Reuse the canonical disposable-status guard, aliases and native permissions.
// Replace only suite selection; retain every canonical native guard.
export default defineConfig({
  ...ownerConfig,
  test: {
    ...ownerConfig.test,
    include: [
      'scripts/ediel-confirmed-customer-bilateral-native.test.ts',
      'scripts/ediel-requested-customer-change-source-native.test.ts',
      'scripts/ediel-at-z06e-primary-effect-native.test.ts',
      'scripts/ediel-at-z06e-physical-intake-native.test.ts',
      'scripts/ediel-at-z09e-received-ack-native.test.ts',
    ],
  },
})
