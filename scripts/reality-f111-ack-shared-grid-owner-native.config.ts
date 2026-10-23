import { defineConfig } from 'vitest/config'
import sourceOwner from './ediel-source-owner-native.config'

// Owned local Supabase only (reality finding F111). The atomic ACK creators accept the platform-shared grid owner
// that the tenant's own source message names; another tenant's grid owner stays refused.
export default defineConfig({ ...sourceOwner, test: { ...sourceOwner.test,
  include: ['scripts/reality-f111-ack-shared-grid-owner-native.test.ts'],
  testTimeout: 400_000, retry: 0, fileParallelism: false,
} })
