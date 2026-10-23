import { defineConfig } from 'vitest/config'
import sourceOwner from './ediel-source-owner-native.config'

// Owned local Supabase only (reality finding F101). Bound UTILTS consumption accepts the
// tenant's own grid owner or a platform-shared one that the tenant's own rows name.
export default defineConfig({ ...sourceOwner, test: { ...sourceOwner.test,
  include: ['scripts/ediel-utilts-shared-grid-owner-native.test.ts'],
  testTimeout: 300_000, retry: 0, fileParallelism: false,
} })
