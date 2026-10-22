import { defineConfig } from 'vitest/config'
import sourceOwner from './ediel-source-owner-native.config'

// Owned local Supabase only (reality finding F90). The test clones a fresh synthetic
// tenant from a local production outbound PRODAT Z03 + Z01 and rolls everything back.
export default defineConfig({ ...sourceOwner, test: { ...sourceOwner.test,
  include: ['scripts/ediel-scoped-capability-f90-native.test.ts'],
  testTimeout: 300_000, retry: 0,
} })
