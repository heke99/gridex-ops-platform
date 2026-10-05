import { defineConfig } from 'vitest/config'
import canonical from '../../../../scripts/ediel-source-owner-native.config'

// Reuses the sole canonical local-stack credential/alias/setup producer.
// Shared registration is carried by the retained integration coordinator.
export default defineConfig({ ...canonical, test: { ...canonical.test,
  include: ['scripts/ediel-sc-010-beneficiary-export-native.test.ts'],
} })
