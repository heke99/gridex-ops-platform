import { defineConfig } from 'vitest/config'
import sourceOwner from './ediel-source-owner-native.config'

// Owned local Supabase only (reality finding F101 variants). Per-grid-owner statistics and the bilateral PRODAT
// scope accept the tenant's own grid owner or a platform-shared one that the tenant's own rows name.
export default defineConfig({ ...sourceOwner, test: { ...sourceOwner.test,
  include: ['scripts/shared-grid-owner-variants-native.test.ts'],
  testTimeout: 120_000, retry: 0, fileParallelism: false,
} })
