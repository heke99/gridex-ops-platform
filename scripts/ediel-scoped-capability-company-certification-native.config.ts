import { defineConfig } from 'vitest/config'
import sourceOwner from './ediel-source-owner-native.config'

// Owned local Supabase only (reality findings F89/F90/F91). The test clones a fresh synthetic
// tenant from a local production outbound PRODAT Z03 + Z01, installs the recorder migration
// inside its transaction and rolls everything back.
export default defineConfig({ ...sourceOwner, test: { ...sourceOwner.test,
  include: ['scripts/ediel-scoped-capability-company-certification-native.test.ts'],
  testTimeout: 300_000, retry: 0,
} })
