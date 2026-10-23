import { defineConfig } from 'vitest/config'
import sourceOwner from './ediel-source-owner-native.config'

// Owned local Supabase only (reality finding F113). The PRODAT object-batch wire projection and the regulated supply
// scope accept the platform-shared grid owner that the tenant's own records name; another tenant's grid owner and
// ambiguous shared rows stay refused.
export default defineConfig({ ...sourceOwner, test: { ...sourceOwner.test,
  include: ['scripts/reality-f113-shared-grid-owner-object-batch-scope-native.test.ts'],
  testTimeout: 300_000, retry: 0, fileParallelism: false,
} })
